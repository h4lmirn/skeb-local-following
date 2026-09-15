(() => {
  "use strict";

  const STORAGE_KEY = "creators";
  const SETTINGS_KEY = "settings";
  const MAX_WORKS = 3;
  const PROFILE_PATH = /^\/@([^/]+)\/?$/;
  const FOLLOWING_PATH = /\/(following_users|following_creators)\/?$/;
  const STATUS_WORDS = new Map([
    ["募集中", true],
    ["停止中", false],
    ["Accepting", true],
    ["Closed", false]
  ]);

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

  async function mountProfileControls() {
    const screenName = profileNameFromPath();
    const main = document.querySelector("main");
    const existing = document.getElementById("skeb-local-profile-controls");
    if (!screenName || !main) {
      existing?.remove();
      return;
    }

    const { [STORAGE_KEY]: creators } = await chrome.storage.local.get({ [STORAGE_KEY]: {} });
    const isSaved = Boolean(creators[screenName.toLowerCase()]);
    const controlState = `${screenName.toLowerCase()}:${isSaved ? "saved" : "unsaved"}`;
    if (existing?.dataset.state === controlState) return;

    const controls = existing || document.createElement("div");
    controls.id = "skeb-local-profile-controls";
    controls.dataset.state = controlState;
    controls.replaceChildren();

    const save = document.createElement("button");
    save.type = "button";
    save.className = "skeb-local-save-button";
    save.textContent = isSaved ? "一覧用情報を更新" : "この人を一覧用に保存";
    save.addEventListener("click", () => captureProfile().catch(console.warn));
    controls.append(save);

    if (isSaved) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "skeb-local-remove-button";
      remove.textContent = "保存解除";
      remove.addEventListener("click", () => removeCurrentProfile().catch(console.warn));
      controls.append(remove);
    }

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

  function makePanel(record, blurThumbnails) {
    const panel = document.createElement("div");
    panel.className = "skeb-local-panel";
    panel.dataset.creator = record.screenName.toLowerCase();
    panel.dataset.capturedAt = String(record.capturedAt);

    const summary = document.createElement("div");
    summary.className = "skeb-local-summary";

    const status = document.createElement("span");
    status.className = `skeb-local-status ${record.acceptable ? "is-open" : "is-closed"}`;
    status.textContent = record.acceptable ? "最終閲覧時：募集中" : "最終閲覧時：停止中";
    summary.append(status);

    for (const item of record.amounts.slice(0, 4)) {
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
        if (blurThumbnails || work.sensitive) image.classList.add("is-blurred");
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

    const [{ [STORAGE_KEY]: creators }, { [SETTINGS_KEY]: settings }] = await Promise.all([
      chrome.storage.local.get({ [STORAGE_KEY]: {} }),
      chrome.storage.local.get({ [SETTINGS_KEY]: { blurThumbnails: true } })
    ]);

    const linksByCreator = new Map();
    for (const link of main.querySelectorAll('a[href^="/@"]')) {
      const href = link.getAttribute("href") || "";
      const match = href.match(/^\/@([^/]+)\/?$/);
      if (!match) continue;
      const key = decodeURIComponent(match[1]).toLowerCase();
      if (!linksByCreator.has(key)) linksByCreator.set(key, []);
      linksByCreator.get(key).push(link);
    }

    for (const [key, links] of linksByCreator) {
      const record = creators[key];
      if (!record) continue;
      const card = chooseCard(links);
      if (!card) continue;
      const existing = card.querySelector(`.skeb-local-panel[data-creator="${CSS.escape(key)}"]`);
      if (existing) {
        if (existing.dataset.capturedAt !== String(record.capturedAt)) {
          existing.replaceWith(makePanel(record, settings.blurThumbnails !== false));
        } else {
          for (const image of existing.querySelectorAll(".skeb-local-works img")) {
            image.classList.toggle(
              "is-blurred",
              settings.blurThumbnails !== false || image.dataset.sensitive === "true"
            );
          }
        }
        continue;
      }
      card.classList.add("skeb-local-enhanced-card");
      card.append(makePanel(record, settings.blurThumbnails !== false));
    }
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
