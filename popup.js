"use strict";

const count = document.getElementById("count");
const blur = document.getElementById("blur");
const clear = document.getElementById("clear");
const message = document.getElementById("message");
let clearArmed = false;
let clearTimer = null;

async function refresh() {
  const { creators = {}, settings = { blurThumbnails: true } } =
    await chrome.storage.local.get(["creators", "settings"]);
  count.textContent = `${Object.keys(creators).length}人分をこの端末に保存中`;
  blur.checked = settings.blurThumbnails !== false;
}

blur.addEventListener("change", async () => {
  try {
    await chrome.storage.local.set({ settings: { blurThumbnails: blur.checked } });
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
