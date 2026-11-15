// 調べもののときに、利用者の質問をそのまま ChatGPT に渡すためのアドレス（利用者の希望: 調べものでは必ず ChatGPT も使う）。
// chatgpt.com/?q=〇〇 は、質問を入れた状態で ChatGPT を開く（画面を自動で操作するのではなく、アドレスを開くだけ）。

/** 質問から ChatGPT のアドレスを作る。DIMY への合図など、利用者が言っていない部分は渡さない */
export function chatgptUrl(question) {
  const q = String(question)
    .replace(/\n*（DIMY への合図[\s\S]*$/, "")
    .replace(/\n*\[DIMY への合図\][\s\S]*$/, "")
    .trim()
    .slice(0, 2000);
  return `https://chatgpt.com/?q=${encodeURIComponent(q)}`;
}
