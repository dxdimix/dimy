// DIMY の拡張機能（ディミの画面の中の ChatGPT だけで動く部分）
// 利用者の決まり（2026-11-15。規約に触れる可能性を了承して選んだ）: 調べものでディミが開いた ChatGPT は、質問が入った状態で開くが、
// ログインしていると送信まではされない。そのため送信ボタンを 1 回だけ押す。答えを読み取ることはしない。
// 動くのは、ディミの画面（*.dxdimix.com）の中の枠で、アドレスに dimy=1 と q= が付いているときだけ。普段の ChatGPT のタブでは何もしない。
(() => {
  if (window.top === window) return;
  const origins = Array.from(location.ancestorOrigins ?? []);
  if (!origins.some((o) => /^https:\/\/([\w-]+\.)*dxdimix\.com$/.test(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o))) return;
  const params = new URLSearchParams(location.search);
  if (params.get("dimy") !== "1" || !params.get("q")) return;

  const started = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - started > 20000) return clearInterval(timer);
    const btn = document.querySelector('button[data-testid="send-button"], #composer-submit-button');
    if (!btn || btn.disabled || btn.getAttribute("aria-disabled") === "true") return;
    clearInterval(timer);
    // 入力欄に質問が入るのを少し待ってから押す
    setTimeout(() => btn.click(), 300);
  }, 400);
})();
