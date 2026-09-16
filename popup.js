"use strict";

const count = document.getElementById("count");
const blur = document.getElementById("blur");
const amountGenreOptions = document.getElementById("amount-genre-options");
const amountGenreEmpty = document.getElementById("amount-genre-empty");
const folderForm = document.getElementById("folder-form");
const folderName = document.getElementById("folder-name");
const folderList = document.getElementById("folder-list");
const exportData = document.getElementById("export-data");
const importData = document.getElementById("import-data");
const importFile = document.getElementById("import-file");
const clear = document.getElementById("clear");
const message = document.getElementById("message");
const BACKUP_FORMAT = "skeb-local-following-backup";
const BACKUP_VERSION = 1;
const BACKUP_KEYS = ["creators", "settings", "folders", "folderAssignments"];
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
let clearArmed = false;
let clearTimer = null;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeString(value, maxLength = 500) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function safeHttpsUrl(value, skebOnly = false) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "";
    if (skebOnly && url.hostname !== "skeb.jp") return "";
    return url.href;
  } catch {
    return "";
  }
}

function sanitizeCreators(value) {
  if (!isPlainObject(value)) throw new Error("クリエイター情報の形式が正しくありません。");
  const creators = Object.create(null);

  for (const [storedKey, record] of Object.entries(value)) {
    if (!isPlainObject(record)) continue;
    const screenName = safeString(record.screenName, 100).trim();
    const key = screenName.toLowerCase();
    if (!screenName || !key || key !== storedKey.toLowerCase()) continue;

    const profileUrl = safeHttpsUrl(record.profileUrl, true);
    const capturedAt = Number(record.capturedAt);
    if (!profileUrl || !Number.isFinite(capturedAt)) continue;

    const amounts = Array.isArray(record.amounts)
      ? record.amounts.slice(0, 8).filter(isPlainObject).map((item) => ({
          genre: safeString(item.genre, 100),
          amount: safeString(item.amount, 100)
        }))
      : [];
    const works = Array.isArray(record.works)
      ? record.works.slice(0, 3).filter(isPlainObject).map((work) => ({
          workUrl: safeHttpsUrl(work.workUrl, true),
          thumbnailUrl: safeHttpsUrl(work.thumbnailUrl),
          genre: safeString(work.genre, 100),
          sensitive: work.sensitive === true
        })).filter((work) => work.workUrl && work.thumbnailUrl)
      : [];

    creators[key] = {
      schemaVersion: 1,
      screenName,
      displayName: safeString(record.displayName, 500) || `@${screenName}`,
      acceptable: record.acceptable === true,
      statusLabel: safeString(record.statusLabel, 100),
      amounts,
      works,
      profileUrl,
      capturedAt
    };
  }
  return creators;
}

function sanitizeBackup(parsed) {
  if (!isPlainObject(parsed) || parsed.format !== BACKUP_FORMAT || parsed.version !== BACKUP_VERSION) {
    throw new Error("Skeb Local Followingのバックアップファイルではありません。");
  }
  if (!isPlainObject(parsed.data)) throw new Error("バックアップデータが壊れています。");

  const creators = sanitizeCreators(parsed.data.creators || {});
  const folders = Array.isArray(parsed.data.folders)
    ? [...new Set(parsed.data.folders
        .filter((name) => typeof name === "string")
        .map((name) => name.trim().slice(0, 30))
        .filter(Boolean))]
    : [];
  const folderAssignments = Object.create(null);
  if (isPlainObject(parsed.data.folderAssignments)) {
    for (const [screenName, folder] of Object.entries(parsed.data.folderAssignments)) {
      const key = safeString(screenName, 100).toLowerCase();
      if (key && folders.includes(folder)) folderAssignments[key] = folder;
    }
  }
  const sourceSettings = isPlainObject(parsed.data.settings) ? parsed.data.settings : {};
  const settings = {
    blurThumbnails: sourceSettings.blurThumbnails !== false,
    hiddenAmountGenres: Array.isArray(sourceSettings.hiddenAmountGenres)
      ? [...new Set(sourceSettings.hiddenAmountGenres
          .filter((genre) => typeof genre === "string")
          .map((genre) => genre.slice(0, 100)))]
      : []
  };
  return { creators, settings, folders, folderAssignments };
}

async function refresh() {
  const { creators = {}, settings = {}, folders = [] } =
    await chrome.storage.local.get(["creators", "settings", "folders"]);
  count.textContent = `${Object.keys(creators).length}人分をこの端末に保存中`;
  blur.checked = settings.blurThumbnails !== false;
  renderAmountGenres(creators, settings.hiddenAmountGenres || []);
  renderFolders(folders);
}

function renderFolders(folders) {
  folderList.replaceChildren();
  for (const name of folders) {
    const row = document.createElement("div");
    row.className = "folder-row";
    const label = document.createElement("span");
    label.textContent = name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "削除";
    remove.addEventListener("click", () => removeFolder(name));
    row.append(label, remove);
    folderList.append(row);
  }
}

folderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = folderName.value.trim();
  if (!name) return;
  try {
    const { folders = [] } = await chrome.storage.local.get("folders");
    if (!folders.includes(name)) folders.push(name);
    await chrome.storage.local.set({ folders });
    folderName.value = "";
    await refresh();
    message.textContent = `「${name}」を追加しました。`;
  } catch (error) {
    message.textContent = `フォルダを追加できませんでした: ${error.message}`;
  }
});

async function removeFolder(name) {
  try {
    const { folders = [], folderAssignments = {} } =
      await chrome.storage.local.get(["folders", "folderAssignments"]);
    const nextFolders = folders.filter((folder) => folder !== name);
    for (const [screenName, folder] of Object.entries(folderAssignments)) {
      if (folder === name) delete folderAssignments[screenName];
    }
    await chrome.storage.local.set({ folders: nextFolders, folderAssignments });
    await refresh();
    message.textContent = `「${name}」を削除しました。`;
  } catch (error) {
    message.textContent = `フォルダを削除できませんでした: ${error.message}`;
  }
}

function renderAmountGenres(creators, hiddenGenres) {
  const genres = [];
  const seen = new Set();

  for (const creator of Object.values(creators)) {
    for (const item of creator.amounts || []) {
      const genre = (item.genre || "").trim();
      if (!genre || seen.has(genre)) continue;
      seen.add(genre);
      genres.push(genre);
    }
  }

  amountGenreOptions.replaceChildren();
  amountGenreEmpty.hidden = genres.length > 0;
  for (const genre of genres) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = genre;
    checkbox.checked = !hiddenGenres.includes(genre);
    checkbox.addEventListener("change", saveAmountGenreVisibility);
    label.append(checkbox, document.createTextNode(genre));
    amountGenreOptions.append(label);
  }
}

async function updateSettings(patch) {
  const { settings = {} } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ settings: { ...settings, ...patch } });
}

async function saveAmountGenreVisibility() {
  try {
    const hiddenAmountGenres = [...amountGenreOptions.querySelectorAll('input[type="checkbox"]')]
      .filter((checkbox) => !checkbox.checked)
      .map((checkbox) => checkbox.value);
    await updateSettings({ hiddenAmountGenres });
    message.textContent = "表示する種類を保存しました。";
  } catch (error) {
    message.textContent = `設定を保存できませんでした: ${error.message}`;
  }
}

blur.addEventListener("change", async () => {
  try {
    await updateSettings({ blurThumbnails: blur.checked });
    message.textContent = "設定を保存しました。";
  } catch (error) {
    message.textContent = `設定を保存できませんでした: ${error.message}`;
  }
});

exportData.addEventListener("click", async () => {
  try {
    exportData.disabled = true;
    const stored = await chrome.storage.local.get(BACKUP_KEYS);
    const backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        creators: stored.creators || {},
        settings: stored.settings || {},
        folders: stored.folders || [],
        folderAssignments: stored.folderAssignments || {}
      }
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `skeb-local-following-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message.textContent = "バックアップを書き出しました。";
  } catch (error) {
    message.textContent = `バックアップを書き出せませんでした: ${error.message}`;
  } finally {
    exportData.disabled = false;
  }
});

importData.addEventListener("click", () => importFile.click());

importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (!file) return;
  try {
    importData.disabled = true;
    if (file.size > MAX_BACKUP_BYTES) throw new Error("バックアップファイルが大きすぎます。");
    const imported = sanitizeBackup(JSON.parse(await file.text()));
    const current = await chrome.storage.local.get(BACKUP_KEYS);
    const mergedFolders = [...new Set([...(current.folders || []), ...imported.folders])];
    await chrome.storage.local.set({
      creators: { ...(current.creators || {}), ...imported.creators },
      settings: { ...(current.settings || {}), ...imported.settings },
      folders: mergedFolders,
      folderAssignments: { ...(current.folderAssignments || {}), ...imported.folderAssignments }
    });
    await refresh();
    message.textContent = `${Object.keys(imported.creators).length}人分のバックアップを読み込みました。`;
  } catch (error) {
    message.textContent = `バックアップを読み込めませんでした: ${error.message}`;
  } finally {
    importData.disabled = false;
  }
});

clear.addEventListener("click", async () => {
  if (!clearArmed) {
    clearArmed = true;
    clear.classList.add("is-armed");
    clear.textContent = "本当に削除する（元に戻せません）";
    message.textContent = "確認のため、もう一度ボタンを押してください。";
    clearTimer = setTimeout(resetClearButton, 5000);
    return;
  }

  try {
    clear.disabled = true;
    await chrome.storage.local.remove("creators");
    await refresh();
    message.textContent = "保存情報を削除しました。";
  } catch (error) {
    message.textContent = `保存情報を削除できませんでした: ${error.message}`;
  } finally {
    clear.disabled = false;
    resetClearButton();
  }
});

function resetClearButton() {
  clearArmed = false;
  clear.classList.remove("is-armed");
  clear.textContent = "保存したクリエイター情報を削除";
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = null;
}

refresh().catch(() => {
  count.textContent = "保存情報を読み込めませんでした。";
});
