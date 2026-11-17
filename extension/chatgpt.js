// DIMY の拡張機能（ディミの画面の中の ChatGPT だけで動く部分）
// 利用者の決まり（2026-11-15。規約に触れる可能性を了承して選んだ）: 調べものでディミが開いた ChatGPT は、質問が入った状態で開くが、
// ログインしていると送信まではされない。そのため送信ボタンを押して、質問を 1 回だけ送る。答えを読み取ることはしない。
// 動くのは、ディミの画面（*.dxdimix.com）の中の枠で、アドレスに dimy=1 と q= が付いているときだけ。普段の ChatGPT のタブでは何もしない。
//
// 2026-11-17: 質問は入るが送信されなかった。ページの準備（React の読み込み）が終わる前に押すと、押しても何も起きないため。
// そこで、送られたこと（入力欄が空になる・会話のページ /c/ に移る）を確かめ、まだ送られていなければ間をあけて押し直す（最大 3 回）。
// 送られたら二度と押さない。同じ質問（dimyid）は、ディミの画面を読み込み直して枠が開き直しても送らない。
// 様子は、親のディミの画面に知らせ、ディミの「動作」の記録に残す（答えの中身は知らせない）。
(() => {
  if (window.top === window) return;
  const origins = Array.from(location.ancestorOrigins ?? []);
  const parentOrigin = origins.find((o) => /^https:\/\/([\w-]+\.)*dxdimix\.com$/.test(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o));
  if (!parentOrigin) return;
  const params = new URLSearchParams(location.search);
  if (params.get("dimy") !== "1" || !params.get("q")) return;

  const report = (status, detail = "") => {
    try {
      window.parent.postMessage({ dimyChatgpt: status, detail }, parentOrigin);
    } catch {
      /* 知らせられなくても続ける */
    }
  };
  const key = `dimy-chatgpt-sent:${params.get("dimyid") || params.get("q")}`;
  try {
    if (localStorage.getItem(key)) return report("skip", "この質問はもう送ってあります（読み込み直し）");
  } catch {
    /* 保存できない環境では、そのまま進める */
  }
  const markSent = () => {
    try {
      localStorage.setItem(key, String(Date.now()));
    } catch {
      /* 保存できなくてもよい */
    }
  };

  const started = Date.now();
  let clicks = 0;
  let lastClick = 0;
  report("start");
  const composerText = () => (document.querySelector("#prompt-textarea")?.innerText ?? document.querySelector("textarea")?.value ?? "").trim();
  const timer = setInterval(() => {
    // 送られた: 会話のページに移った、または押したあとに入力欄が空になった
    if (/^\/c\//.test(location.pathname) || (clicks > 0 && !composerText())) {
      clearInterval(timer);
      markSent();
      return report("sent", `${clicks} 回押して送信できました（${Math.round((Date.now() - started) / 100) / 10} 秒）`);
    }
    if (Date.now() - started > 30000) {
      clearInterval(timer);
      const btn = document.querySelector('#composer-submit-button, button[data-testid="send-button"]');
      return report("timeout", `30 秒で送れませんでした（押した回数 ${clicks}・送信ボタン ${btn ? "あり" : "なし"}・入力欄の文字 ${composerText().length}）`);
    }
    if (clicks >= 3 || Date.now() - lastClick < 2500) return;
    const btn = document.querySelector('#composer-submit-button, button[data-testid="send-button"]');
    if (!btn || btn.disabled || btn.getAttribute("aria-disabled") === "true" || !composerText()) return;
    // ページの準備が終わるのを少し待ってから押す（最初は読み込み開始から 1.5 秒以上あける）
    if (Date.now() - started < 1500) return;
    clicks++;
    lastClick = Date.now();
    btn.click();
    report("clicked", `${clicks} 回目`);
  }, 400);
})();
