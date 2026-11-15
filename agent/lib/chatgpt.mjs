// 調べもののときに、利用者の質問をそのまま ChatGPT に渡すためのアドレス（利用者の希望: 調べものでは必ず ChatGPT も使う）。
// chatgpt.com/?q=〇〇 は、質問を入れた状態で ChatGPT を開く（画面を自動で操作するのではなく、アドレスを開くだけ）。

/** 質問から ChatGPT のアドレスを作る。DIMY への合図など、利用者が言っていない部分は渡さない */
export function chatgptUrl(question) {
  const q = String(question)
    .replace(/\n*（DIMY への合図[\s\S]*$/, "")
    .replace(/\n*\[DIMY への合図\][\s\S]*$/, "")
    .trim()
    .slice(0, 2000);
  // dimy=1: ディミの中の枠で、拡張機能が送信ボタンを 1 回押す印（extension/chatgpt.js）
  return `https://chatgpt.com/?q=${encodeURIComponent(q)}&dimy=1`;
}

/**
 * ディミが show_card を使わなかった返事から、要点のカードを作る（利用者の決まり: 調べものでなくても、いつもカードで関連した情報を出す）。
 * 箇条書きがあればその項目、なければ文ごとに。短い返事（あいさつ・相づち）は null。
 */
export function fallbackCard(question, reply) {
  const text = String(reply).trim();
  if (text.replace(/\s/g, "").length < 60) return null;
  const clean = (t) => t.replace(/\*\*/g, "").replace(/^\s*(?:\d+[.)．、]|[-・*])\s*/, "").trim();
  const lines = text.split(/\n+/).filter((l) => /^\s*(?:\d+[.)．、]|[-・*])\s+/.test(l)).map(clean).filter(Boolean);
  const points = (lines.length >= 2 ? lines : text.split(/(?<=[。！？!?])/).map(clean).filter((s) => s.length > 4)).slice(0, 6);
  if (points.length < 2) return null;
  const q = String(question).trim().slice(0, 100);
  const firstLine = clean(text.split(/\n/)[0]).replace(/[。！？!?].*$/, "");
  return {
    kind: "points",
    title: firstLine.length >= 4 && firstLine.length <= 30 ? firstLine : q.slice(0, 30),
    data: {
      points,
      style: "points",
      links: [
        { title: "Google で調べる", url: `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=ja` },
        { title: "Google 画像", url: `https://www.google.com/search?q=${encodeURIComponent(q)}&udm=2&hl=ja` },
      ],
    },
  };
}
