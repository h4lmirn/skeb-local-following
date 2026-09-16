"use strict";

const count = document.getElementById("count");
const blur = document.getElementById("blur");
const amountGenreOptions = document.getElementById("amount-genre-options");
const amountGenreEmpty = document.getElementById("amount-genre-empty");
const folderForm = document.getElementById("folder-form");
const folderName = document.getElementById("folder-name");
const folderList = document.getElementById("folder-list");
const followingSnapshot = document.getElementById("following-snapshot");
const clear = document.getElementById("clear");
const message = document.getElementById("message");
let clearArmed = false;
let clearTimer = null;

async function refresh() {
  const { creators = {}, settings = {}, folders = [], followingSnapshot: snapshot = null } =
    await chrome.storage.local.get(["creators", "settings", "folders", "followingSnapshot"]);
  count.textContent = `${Object.keys(creators).length}人分をこの端末に保存中`;
  blur.checked = settings.blurThumbnails !== false;
  renderAmountGenres(creators, settings.hiddenAmountGenres || []);
  renderFolders(folders);
  followingSnapshot.textContent = Array.isArray(snapshot?.screenNames)
    ? `自分のフォロー記録：${snapshot.screenNames.length}人を個別登録中`
    : "自分のフォロー記録は未登録です。フォロー中ページの各カードから登録できます。";
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
  clear.textContent = "保存情報をすべて削除";
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = null;
}

refresh().catch(() => {
  count.textContent = "保存情報を読み込めませんでした。";
});
