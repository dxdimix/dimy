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
  // 入力欄: ChatGPT は見えない textarea と、文字を書く欄（contenteditable）を両方持つことがある。文字が入っているものを探す
  const composer = () => {
    const els = [...document.querySelectorAll('#prompt-textarea, [contenteditable="true"], textarea')];
    let best = null;
    let len = 0;
    for (const el of els) {
      const t = (el.tagName === "TEXTAREA" ? el.value : el.innerText || el.textContent || "").trim();
      if (t.length > len) {
        best = el;
        len = t.length;
      }
    }
    return best;
  };
  const composerText = () => {
    const el = composer();
    return el ? (el.tagName === "TEXTAREA" ? el.value : el.innerText || el.textContent || "").trim() : "";
  };
  const sendButton = () =>
    document.querySelector('#composer-submit-button, button[data-testid="send-button"], button[aria-label="プロンプトを送信する"], button[aria-label*="送信"], button[aria-label*="Send"], form button[type="submit"]');
  // 送れなかったときに、画面の作りを確かめるための様子（ボタンの名前と数だけ。会話の中身は含めない）
  const diag = () => {
    const btns = [...document.querySelectorAll("button")];
    const ids = btns.map((b) => b.getAttribute("data-testid") || b.id || b.getAttribute("aria-label")).filter(Boolean).slice(0, 25);
    return `ボタン ${btns.length} 個 [${ids.join(", ")}]・入力欄の候補 ${document.querySelectorAll('#prompt-textarea, [contenteditable="true"], textarea').length} 個・枠 ${document.querySelectorAll("iframe").length} 個・${document.readyState}・${location.pathname}`;
  };
  const timer = setInterval(() => {
    // 送られた: 会話のページに移った、または押したあとに入力欄が空になった
    if (/^\/c\//.test(location.pathname) || (clicks > 0 && !composerText())) {
      clearInterval(timer);
      markSent();
      return report("sent", `${clicks} 回押して送信できました（${Math.round((Date.now() - started) / 100) / 10} 秒）`);
    }
    if (Date.now() - started > 30000) {
      clearInterval(timer);
      return report("timeout", `30 秒で送れませんでした（押した回数 ${clicks}・送信ボタン ${sendButton() ? "あり" : "なし"}・入力欄の文字 ${composerText().length}・${diag()}）`);
    }
    if (clicks >= 3 || Date.now() - lastClick < 2500) return;
    if (!composerText()) return;
    // ページの準備が終わるのを少し待ってから押す（最初は読み込み開始から 1.5 秒以上あける）
    if (Date.now() - started < 1500) return;
    const btn = sendButton();
    if (btn && (btn.disabled || btn.getAttribute("aria-disabled") === "true")) return;
    clicks++;
    lastClick = Date.now();
    if (btn) {
      btn.click();
      report("clicked", `${clicks} 回目（送信ボタン）`);
    } else {
      // 送信ボタンが見つからないときは、入力欄で Enter を押す（送信ボタンと同じ働き。1 回の送信）
      const el = composer();
      el?.focus();
      for (const type of ["keydown", "keypress", "keyup"]) el?.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      report("clicked", `${clicks} 回目（Enter・${diag()}）`);
    }
  }, 400);
})();
