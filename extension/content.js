// DIMY の拡張機能（ディミの画面の中で動く部分）
// ディミの画面（ページ）と、拡張機能の裏の部分（background.js）の間の取り次ぎだけをする。
// - 拡張機能が入っていることと版を、ページに知らせる（<html data-dimy-ext="1.0.0">）
// - ページからの頼み（window.postMessage の { dimyExt: "capture", id }）を裏へ渡し、答えをページへ返す

(() => {
  if (window.__dimyExtLoaded === chrome.runtime.id + chrome.runtime.getManifest().version) return;
  window.__dimyExtLoaded = chrome.runtime.id + chrome.runtime.getManifest().version;
  const version = chrome.runtime.getManifest().version;
  const mark = () => document.documentElement?.setAttribute("data-dimy-ext", version);
  mark();
  document.addEventListener("DOMContentLoaded", mark);

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.origin !== location.origin) return;
    const m = ev.data;
    if (!m || typeof m !== "object" || m.dimyExt !== "capture") return;
    // 拡張機能が新しい版になると、古い取り次ぎはつながらなくなる。そのときは何もしない（新しい取り次ぎが答える）
    if (!chrome.runtime?.id) return;
    chrome.runtime.sendMessage({ type: "capture" }, (res) => {
      const out = res ?? { ok: false, error: chrome.runtime.lastError?.message || "拡張機能から返事がありません" };
      window.postMessage({ dimyExtReply: "capture", id: m.id, ...out }, location.origin);
    });
  });

  // このタブの枠の中で、ページを開けるようにしてもらう
  chrome.runtime.sendMessage({ type: "hello" }, () => void chrome.runtime.lastError);

  window.postMessage({ dimyExtReady: version }, location.origin);
})();
