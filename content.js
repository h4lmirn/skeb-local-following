(() => {
  "use strict";

  const STORAGE_KEY = "creators";
  const SETTINGS_KEY = "settings";
  const FOLDERS_KEY = "folders";
  const FOLDER_ASSIGNMENTS_KEY = "folderAssignments";
  const MAX_WORKS = 3;
  const PROFILE_PATH = /^\/@([^/]+)\/?$/;
  const FOLLOWING_PATH = /\/(following_users|following_creators)\/?$/;
  const STATUS_WORDS = new Map([
    ["募集中", true],
    ["停止中", false],
    ["Accepting", true],
    ["Closed", false]
  ]);

  // v0.5.1以前の廃止済みローカルフォロー記録を削除する。
  chrome.storage.local.remove("followingSnapshot").catch(console.warn);

  let scheduled = false;
  const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();

  function profileNameFromPath(pathname = location.pathname) {
    const match = pathname.match(PROFILE_PATH);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function absoluteUrl(value) {
    try {
      return new URL(value, location.origin).href;
    } catch {
      return null;
    }
  }

  function visibleImageUrl(image) {
    const value = image.currentSrc || image.getAttribute("src");
    return value && /^https:\/\//.test(value) ? value : null;
  }

  function exactTextElement(root, candidates) {
    const elements = root.querySelectorAll("div, span, small, strong, p");
    return [...elements].find((element) => {
      if (element.children.length > 0) return false;
      return candidates.has(normalize(element.textContent));
    });
  }

  function readStatus(main) {
    const element = exactTextElement(main, new Set(STATUS_WORDS.keys()));
    if (!element) return null;
    const label = normalize(element.textContent);
    return { acceptable: STATUS_WORDS.get(label), statusLabel: label };
  }

  function readAmounts(main) {
    const amounts = [];
    let currentGenre = null;

    for (const row of main.querySelectorAll("table tr")) {
      const cells = [...row.querySelectorAll("td, th")].map((cell) => normalize(cell.textContent));
      if (cells.length < 2) continue;

      if (/^(ジャンル|Genre)$/i.test(cells[0])) {
        currentGenre = cells[1];
        continue;
      }

      if (/^(おまかせ金額|Recommended amount)$/i.test(cells[0])) {
        amounts.push({ genre: currentGenre || "", amount: cells[1] });
      }
    }

    return amounts.slice(0, 8);
  }

  function readWorks(main, screenName) {
    const works = [];
    const seen = new Set();

    for (const anchor of main.querySelectorAll('a[href*="/works/"]')) {
      let url;
      try {
        url = new URL(anchor.getAttribute("href"), location.origin);
      } catch {
        continue;
      }

      const match = url.pathname.match(/^\/@([^/]+)\/works\/[^/]+\/?$/);
      if (!match || match[1].toLowerCase() !== screenName.toLowerCase()) continue;

      const image = anchor.querySelector("img");
      const thumbnailUrl = image ? visibleImageUrl(image) : null;
      if (!thumbnailUrl || seen.has(url.href)) continue;

      const cardText = normalize(anchor.textContent);
      const cardClass = anchor.querySelector(".card")?.className || "";
      works.push({
        workUrl: url.href,
        thumbnailUrl,
        genre: cardText.split(" ")[0] || "",
        sensitive: /nsfw|r-?18|adult|sensitive|センシティブ/i.test(`${cardText} ${cardClass}`)
      });
      seen.add(url.href);
      if (works.length >= MAX_WORKS) break;
    }

    return works;
  }

  function readDisplayName(main, screenName) {
    const expectedPath = `/@${screenName}`.toLowerCase();
    const links = [...main.querySelectorAll('a[href^="/@"]')].filter((link) => {
      try {
        return new URL(link.getAttribute("href"), location.origin).pathname.replace(/\/$/, "").toLowerCase() === expectedPath;
      } catch {
        return false;
      }
    });
    const title = links.map((link) => link.querySelector(".title"))
      .find((element) => element && normalize(element.textContent));
    if (title) return normalize(title.textContent);

    const image = links.map((link) => link.querySelector("img[alt]"))
      .find((element) => normalize(element?.alt));
    return normalize(image?.alt) || `@${screenName}`;
  }

  async function captureProfile() {
    const screenName = profileNameFromPath();
    const main = document.querySelector("main");
    if (!screenName || !main) return false;

    const status = readStatus(main);
    const amounts = readAmounts(main);
    const works = readWorks(main, screenName);
    if (!status) {
      showCaptureNotice("まだプロフィール情報を読み取れません。少し待ってから再度お試しください。", true);
      return false;
    }

    const record = {
      schemaVersion: 1,
      screenName,
      displayName: readDisplayName(main, screenName),
      acceptable: status.acceptable,
      statusLabel: status.statusLabel,
      amounts,
      works,
      profileUrl: location.origin + location.pathname,
      capturedAt: Date.now()
    };

    const stored = await chrome.storage.local.get({ [STORAGE_KEY]: {} });
    const creators = stored[STORAGE_KEY];
    creators[screenName.toLowerCase()] = record;
    await chrome.storage.local.set({ [STORAGE_KEY]: creators });
    showCaptureNotice(`${record.displayName} の一覧用情報をこの端末に保存しました`);
    await mountProfileControls();
    return true;
  }

  function showCaptureNotice(message, isError = false) {
    document.getElementById("skeb-local-capture-notice")?.remove();
    const notice = document.createElement("div");
    notice.id = "skeb-local-capture-notice";
    notice.textContent = message;
    notice.classList.toggle("is-error", isError);
    document.body.append(notice);
    requestAnimationFrame(() => notice.classList.add("is-visible"));
    setTimeout(() => notice.classList.remove("is-visible"), 2600);
    setTimeout(() => notice.remove(), 3100);
  }

  async function removeCurrentProfile() {
    const screenName = profileNameFromPath();
    if (!screenName) return;
    const stored = await chrome.storage.local.get({ [STORAGE_KEY]: {} });
    const creators = stored[STORAGE_KEY];
    const record = creators[screenName.toLowerCase()];
    delete creators[screenName.toLowerCase()];
    await chrome.storage.local.set({ [STORAGE_KEY]: creators });
    showCaptureNotice(`${record?.displayName || `@${screenName}`} を一覧保存から外しました`);
    await mountProfileControls();
  }

  async function assignProfileFolder(screenName, folderName) {
    const key = screenName.toLowerCase();
    const { [FOLDER_ASSIGNMENTS_KEY]: assignments = {} } =
      await chrome.storage.local.get(FOLDER_ASSIGNMENTS_KEY);
    if (folderName) assignments[key] = folderName;
    else delete assignments[key];
    await chrome.storage.local.set({ [FOLDER_ASSIGNMENTS_KEY]: assignments });
    showCaptureNotice(folderName ? `@${screenName} を「${folderName}」に分類しました` : `@${screenName} を未分類に戻しました`);
  }

  function promptForFolderName() {
    const input = window.prompt("作成するローカルフォルダ名を入力してください（30文字まで）");
    if (input === null) return null;
    const name = input.trim();
    if (!name) {
      showCaptureNotice("フォルダ名を入力してください。", true);
      return null;
    }
    if (name.length > 30) {
      showCaptureNotice("フォルダ名は30文字以内にしてください。", true);
      return null;
    }
    return name;
  }

  async function createLocalFolder() {
    const name = promptForFolderName();
    if (!name) return;
    const { [FOLDERS_KEY]: folders = [] } = await chrome.storage.local.get(FOLDERS_KEY);
    if (folders.includes(name)) {
      showCaptureNotice(`「${name}」はすでにあります`);
      return;
    }
    folders.push(name);
    await chrome.storage.local.set({ [FOLDERS_KEY]: folders });
    showCaptureNotice(`ローカルフォルダ「${name}」を作成しました`);
  }

  async function createAndAssignProfileFolder(screenName) {
    const name = promptForFolderName();
    if (!name) return;

    const {
      [FOLDERS_KEY]: folders = [],
      [FOLDER_ASSIGNMENTS_KEY]: assignments = {}
    } = await chrome.storage.local.get([FOLDERS_KEY, FOLDER_ASSIGNMENTS_KEY]);
    if (!folders.includes(name)) folders.push(name);
    assignments[screenName.toLowerCase()] = name;
    await chrome.storage.local.set({
      [FOLDERS_KEY]: folders,
      [FOLDER_ASSIGNMENTS_KEY]: assignments
    });
    showCaptureNotice(`「${name}」を作成し、@${screenName} を分類しました`);
  }

  async function mountProfileControls() {
    const screenName = profileNameFromPath();
    const main = document.querySelector("main");
    const existing = document.getElementById("skeb-local-profile-controls");
    if (!screenName || !main) {
      existing?.remove();
      return;
    }

    const {
      [STORAGE_KEY]: creators,
      [FOLDERS_KEY]: folders,
      [FOLDER_ASSIGNMENTS_KEY]: assignments
    } = await chrome.storage.local.get({
      [STORAGE_KEY]: {},
      [FOLDERS_KEY]: [],
      [FOLDER_ASSIGNMENTS_KEY]: {}
    });
    const key = screenName.toLowerCase();
    const isSaved = Boolean(creators[screenName.toLowerCase()]);
    const assignment = folders.includes(assignments[key]) ? assignments[key] : "";
    const controlState = JSON.stringify({ key, isSaved, folders, assignment });
    if (existing?.dataset.state === controlState) return;

    const controls = existing || document.createElement("div");
    controls.id = "skeb-local-profile-controls";
    controls.dataset.state = controlState;
    controls.replaceChildren();

    const saveRow = document.createElement("div");
    saveRow.className = "skeb-local-profile-save-row";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "skeb-local-save-button";
    save.textContent = isSaved ? "一覧用情報を更新" : "この人を一覧用に保存";
    save.addEventListener("click", () => captureProfile().catch(console.warn));
    saveRow.append(save);

    if (isSaved) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "skeb-local-remove-button";
      remove.textContent = "保存解除";
      remove.addEventListener("click", () => removeCurrentProfile().catch(console.warn));
      saveRow.append(remove);
    }
    controls.append(saveRow);

    const folderRow = document.createElement("div");
    folderRow.className = "skeb-local-profile-folder-row";
    const folder = document.createElement("select");
    folder.className = "skeb-local-profile-folder";
    folder.setAttribute("aria-label", "ローカルフォルダ");
    folder.append(new Option("未分類", ""));
    for (const name of folders) folder.append(new Option(name, name));
    folder.value = assignment;
    folder.addEventListener("change", () => assignProfileFolder(screenName, folder.value).catch(console.warn));
    folderRow.append(folder);

    const createFolder = document.createElement("button");
    createFolder.type = "button";
    createFolder.className = "skeb-local-folder-create-button";
    createFolder.textContent = "＋フォルダ作成";
    createFolder.addEventListener("click", () => createAndAssignProfileFolder(screenName).catch(console.warn));
    folderRow.append(createFolder);
    controls.append(folderRow);

    if (!existing) document.body.append(controls);
  }

  function formatCapturedAt(timestamp) {
    const age = Date.now() - timestamp;
    const formatter = new Intl.DateTimeFormat("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    const suffix = age > 30 * 86400000 ? "・古い情報" : age > 7 * 86400000 ? "・要確認" : "";
    return `最終閲覧 ${formatter.format(new Date(timestamp))}${suffix}`;
  }

  function chooseCard(links) {
    return links.reduce((best, link) => {
      const bestArea = best ? best.getBoundingClientRect().width * best.getBoundingClientRect().height : -1;
      const rect = link.getBoundingClientRect();
      return rect.width * rect.height > bestArea ? link : best;
    }, null);
  }

  function creatorLinksByKey(main) {
    const linksByCreator = new Map();
    for (const link of main.querySelectorAll('a[href^="/@"]')) {
      const href = link.getAttribute("href") || "";
      const match = href.match(/^\/@([^/]+)\/?$/);
      if (!match || link.closest("#skeb-local-following-toolbar")) continue;
      const key = decodeURIComponent(match[1]).toLowerCase();
      if (!linksByCreator.has(key)) linksByCreator.set(key, []);
      linksByCreator.get(key).push(link);
    }
    return linksByCreator;
  }

  function creatorCards(main) {
    const cards = new Map();
    for (const [key, links] of creatorLinksByKey(main)) {
      const card = chooseCard(links);
      const rect = card?.getBoundingClientRect();
      const isKnownCard = Boolean(card?.closest(".skeb-local-folder-hidden")) ||
        card?.querySelector(".skeb-local-card-organizer");
      if (!card || !card.querySelector("img") || !rect || (!isKnownCard && rect.width * rect.height < 12000)) continue;
      cards.set(key, card);
    }
    return cards;
  }

  function creatorLayoutItems(main) {
    const items = new Map();
    for (const [key, links] of creatorLinksByKey(main)) {
      const card = chooseCard(links);
      if (!card) continue;
      items.set(key, layoutItemForCard(card, main, key));
    }
    return items;
  }

  function folderFilterValue() {
    return document.querySelector("#skeb-local-folder-filter")?.value || "all";
  }

  function creatorKeysWithin(element) {
    const keys = new Set();
    for (const link of element.querySelectorAll('a[href^="/@"]')) {
      const match = (link.getAttribute("href") || "").match(/^\/@([^/]+)\/?$/);
      if (match) keys.add(decodeURIComponent(match[1]).toLowerCase());
      if (keys.size > 1) break;
    }
    return keys;
  }

  function layoutItemForCard(card, boundary, creatorKey) {
    let item = card;
    while (item.parentElement && item.parentElement !== boundary) {
      const parent = item.parentElement;
      const keys = creatorKeysWithin(parent);
      if (keys.size > 1 || (keys.size === 1 && !keys.has(creatorKey))) return item;
      item = parent;
    }
    return card;
  }

  function clearFolderEmptyState(main) {
    main.querySelectorAll(".skeb-local-folder-empty").forEach((element) => element.remove());
    main.querySelectorAll(".skeb-local-folder-empty-container")
      .forEach((element) => element.classList.remove("skeb-local-folder-empty-container"));
  }

  function showFolderEmptyState(main, layoutItems, selectedFolder) {
    const firstItem = layoutItems[0];
    const container = firstItem?.parentElement;
    if (!container) return;

    for (const oldContainer of main.querySelectorAll(".skeb-local-folder-empty-container")) {
      if (oldContainer !== container) oldContainer.classList.remove("skeb-local-folder-empty-container");
    }
    container.classList.add("skeb-local-folder-empty-container");
    const existing = main.querySelector(".skeb-local-folder-empty");
    const empty = existing?.parentElement === container ? existing : document.createElement("div");
    main.querySelectorAll(".skeb-local-folder-empty").forEach((element) => {
      if (element !== empty) element.remove();
    });
    empty.className = "skeb-local-folder-empty";
    const message = selectedFolder === "unassigned"
      ? "未分類のクリエイターはいません"
      : `「${selectedFolder}」に分類したクリエイターはいません`;
    if (empty.textContent !== message) empty.textContent = message;
    if (!empty.isConnected) container.prepend(empty);
  }

  function applyFolderFilter(main, assignments, selectedFolder) {
    main.querySelectorAll(".skeb-local-folder-hidden")
      .forEach((element) => element.classList.remove("skeb-local-folder-hidden"));
    const items = creatorLayoutItems(main);
    const layoutItems = [...items.values()];
    let visibleCount = 0;
    for (const [key, layoutItem] of items) {
      const assigned = assignments[key] || "";
      const visible = selectedFolder === "all" ||
        (selectedFolder === "unassigned" ? !assigned : assigned === selectedFolder);
      layoutItem.classList.toggle("skeb-local-folder-hidden", !visible);
      if (visible) visibleCount += 1;
    }

    if (selectedFolder !== "all" && items.size > 0 && visibleCount === 0) {
      showFolderEmptyState(main, layoutItems, selectedFolder);
    } else clearFolderEmptyState(main);
  }

  function makeFollowingToolbar(folders, assignments) {
    const toolbar = document.createElement("section");
    toolbar.id = "skeb-local-following-toolbar";
    toolbar.dataset.state = JSON.stringify({ folders, assignments });

    const title = document.createElement("strong");
    title.textContent = "ローカル整理";
    toolbar.append(title);

    const filterLabel = document.createElement("label");
    filterLabel.textContent = "フォルダ";
    const filter = document.createElement("select");
    filter.id = "skeb-local-folder-filter";
    filter.append(new Option("すべて", "all"), new Option("未分類", "unassigned"));
    for (const folder of folders) filter.append(new Option(folder, folder));
    const previousFilter = folderFilterValue();
    filter.value = [...filter.options].some((option) => option.value === previousFilter)
      ? previousFilter
      : "all";
    filter.addEventListener("change", () => {
      const main = document.querySelector("main");
      if (main) applyFolderFilter(main, assignments, filter.value);
    });
    filterLabel.append(filter);
    toolbar.append(filterLabel);

    const createFolder = document.createElement("button");
    createFolder.type = "button";
    createFolder.textContent = "＋フォルダ作成";
    createFolder.addEventListener("click", () => createLocalFolder().catch(console.warn));
    toolbar.append(createFolder);
    return toolbar;
  }

  function makeCardOrganizer(key, folders, assignment) {
    const organizer = document.createElement("div");
    organizer.className = "skeb-local-card-organizer";
    organizer.dataset.creator = key;
    organizer.dataset.state = JSON.stringify({ folders, assignment });

    const folder = document.createElement("select");
    folder.className = "skeb-local-card-folder";
    folder.setAttribute("aria-label", "ローカルフォルダ");
    folder.append(new Option("未分類", ""));
    for (const name of folders) folder.append(new Option(name, name));
    folder.value = folders.includes(assignment) ? assignment : "";
    folder.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    for (const eventName of ["mousedown", "pointerdown"]) {
      folder.addEventListener(eventName, (event) => event.stopPropagation());
    }
    folder.addEventListener("change", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const { [FOLDER_ASSIGNMENTS_KEY]: assignments = {} } =
        await chrome.storage.local.get(FOLDER_ASSIGNMENTS_KEY);
      if (folder.value) assignments[key] = folder.value;
      else delete assignments[key];
      await chrome.storage.local.set({ [FOLDER_ASSIGNMENTS_KEY]: assignments });
      showCaptureNotice(folder.value ? `@${key} を「${folder.value}」に分類しました` : `@${key} を未分類に戻しました`);
    });
    organizer.append(folder);
    return organizer;
  }

  function settingsSignature(settings) {
    return JSON.stringify({
      blurThumbnails: settings.blurThumbnails !== false,
      hiddenAmountGenres: [...(settings.hiddenAmountGenres || [])].sort()
    });
  }

  function makePanel(record, settings) {
    const panel = document.createElement("div");
    panel.className = "skeb-local-panel";
    panel.dataset.creator = record.screenName.toLowerCase();
    panel.dataset.capturedAt = String(record.capturedAt);
    panel.dataset.settings = settingsSignature(settings);

    const summary = document.createElement("div");
    summary.className = "skeb-local-summary";

    const status = document.createElement("span");
    status.className = `skeb-local-status ${record.acceptable ? "is-open" : "is-closed"}`;
    status.textContent = record.acceptable ? "最終閲覧時：募集中" : "最終閲覧時：停止中";
    summary.append(status);

    const hiddenAmountGenres = new Set(settings.hiddenAmountGenres || []);
    const visibleAmounts = record.amounts.filter((item) => !hiddenAmountGenres.has(item.genre));
    for (const item of visibleAmounts.slice(0, 4)) {
      const amount = document.createElement("span");
      amount.className = "skeb-local-amount";
      amount.textContent = `${item.genre ? `${item.genre} ` : ""}${item.amount}`;
      summary.append(amount);
    }
    panel.append(summary);

    if (record.works.length) {
      const workList = document.createElement("div");
      workList.className = "skeb-local-works";
      for (const work of record.works) {
        const image = document.createElement("img");
        image.src = work.thumbnailUrl;
        image.alt = work.genre ? `${work.genre}の作品例` : "作品例";
        image.loading = "lazy";
        image.referrerPolicy = "strict-origin-when-cross-origin";
        image.dataset.sensitive = work.sensitive ? "true" : "false";
        if (settings.blurThumbnails !== false || work.sensitive) image.classList.add("is-blurred");
        workList.append(image);
      }
      panel.append(workList);
    }

    const timestamp = document.createElement("div");
    timestamp.className = "skeb-local-timestamp";
    timestamp.textContent = formatCapturedAt(record.capturedAt);
    panel.append(timestamp);
    return panel;
  }

  async function enhanceFollowing() {
    if (!FOLLOWING_PATH.test(location.pathname)) return;
    const main = document.querySelector("main");
    if (!main) return;

    const [
      { [STORAGE_KEY]: creators },
      { [SETTINGS_KEY]: settings },
      { [FOLDERS_KEY]: folders },
      { [FOLDER_ASSIGNMENTS_KEY]: assignments }
    ] = await Promise.all([
      chrome.storage.local.get({ [STORAGE_KEY]: {} }),
      chrome.storage.local.get({ [SETTINGS_KEY]: { blurThumbnails: true, hiddenAmountGenres: [] } }),
      chrome.storage.local.get({ [FOLDERS_KEY]: [] }),
      chrome.storage.local.get({ [FOLDER_ASSIGNMENTS_KEY]: {} })
    ]);

    const cards = creatorCards(main);
    const oldToolbar = document.getElementById("skeb-local-following-toolbar");
    const nextToolbar = makeFollowingToolbar(folders, assignments);
    let toolbar = oldToolbar;
    if (oldToolbar?.dataset.state !== nextToolbar.dataset.state) {
      if (oldToolbar) oldToolbar.replaceWith(nextToolbar);
      else main.prepend(nextToolbar);
      toolbar = nextToolbar;
    }

    for (const [key, card] of cards) {
      const existingOrganizer = card.querySelector(`.skeb-local-card-organizer[data-creator="${CSS.escape(key)}"]`);
      const organizer = makeCardOrganizer(key, folders, assignments[key] || "");
      if (existingOrganizer?.dataset.state !== organizer.dataset.state) {
        if (existingOrganizer) existingOrganizer.replaceWith(organizer);
        else card.append(organizer);
      }

      const record = creators[key];
      if (!record) continue;
      const existing = card.querySelector(`.skeb-local-panel[data-creator="${CSS.escape(key)}"]`);
      if (existing) {
        if (
          existing.dataset.capturedAt !== String(record.capturedAt) ||
          existing.dataset.settings !== settingsSignature(settings)
        ) {
          existing.replaceWith(makePanel(record, settings));
        }
        continue;
      }
      card.classList.add("skeb-local-enhanced-card");
      card.append(makePanel(record, settings));
    }
    applyFolderFilter(main, assignments, toolbar.querySelector("#skeb-local-folder-filter").value);
  }

  async function run() {
    scheduled = false;
    await mountProfileControls();
    if (FOLLOWING_PATH.test(location.pathname)) await enhanceFollowing();
  }

  function scheduleRun() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => run().catch(console.warn), 250);
  }

  const observer = new MutationObserver(scheduleRun);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", scheduleRun);
  chrome.storage.onChanged.addListener(scheduleRun);
  scheduleRun();
})();
