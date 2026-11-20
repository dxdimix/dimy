// 画面のカード（返事の中身を目でも見せる）の形と、言葉から出すカードを決める決まり。

export type CardKind = "weather" | "date" | "schedule" | "list" | "video" | "points" | "page" | "image" | "text" | "stats" | "map" | "talk" | "chat" | "web" | "place" | "week";
export type CardData = {
  items?: { title: string; url?: string; note?: string; image?: string }[];
  /** 大事な数字。series は直近の推移（古い順。株価・為替は PC の DIMY が ticker から書き足す）。change は前日比 */
  stats?: { label: string; value: string; unit?: string; change?: string; ticker?: string; series?: number[]; seriesFrom?: string; seriesTo?: string }[];
  places?: { name: string; query: string; note?: string; from?: string }[];
  /** image: 言葉で探した写真（PC の DIMY が Wikimedia Commons から探して書き足す） */
  images?: { url: string; title: string; page: string }[];
  /** どのカードにも付けられるリンク（公式サイト・情報元など） */
  links?: { title: string; url: string }[];
  /** 返事の中で、このカードを出したい言葉（読み上げがこの言葉を含む文に来たら出す。「|」で言い換えを並べられる） */
  say?: string;
  count?: number;
  /** place: 施設 1 か所分 */
  area?: string;
  query?: string;
  address?: string;
  hours?: string;
  phone?: string;
  prices?: { label: string; value: string }[];
  /** talk: 履歴から呼び出した会話（あなたの発言と DIMY の返事） */
  q?: string;
  a?: string;
  at?: string;
  image?: string;
  points?: string[];
  style?: "points" | "steps";
  url?: string;
  note?: string;
  text?: string;
  /** 調べもののとき、同じ質問を ChatGPT に渡したカード（1 枚だけ。新しい調べもので入れ替える） */
  chatgpt?: boolean;
  /** ChatGPT のカードの置き場所の決まりの版（2 = 左端に縦いっぱい） */
  gptv?: number;
};
export type Card = {
  id: string;
  kind: CardKind;
  title: string;
  data: CardData;
  pinned: boolean;
  at: number;
  /** 読み上げがこの言葉（say）に来るまで隠しておく（話に合わせて 1 枚ずつ出すため） */
  hidden?: boolean;
  /** 利用者がドラッグで好きな場所に置いたカード（画面の中の位置と大きさ。px）。列には並べない */
  float?: { x: number; y: number; w: number; h?: number };
  /** 上へ折りたたんで、帯だけにしたカード（ChatGPT のカード。中のページは読み込み直さないよう、隠すだけ） */
  collapsed?: boolean;
};

/** 列に並べるカードを左右に分ける（右・左の互い違い）。好きな場所に置いたカードは除く。
 * perSide = 2 のときは、右の内側・左の内側・右の外側・左の外側の順に配る（カードが多いとき、画面いっぱいに並べるため） */
export function splitColumns(cards: Card[], perSide = 1, skipLeftOuter = false): { left: Card[][]; right: Card[][] } {
  const left: Card[][] = Array.from({ length: perSide }, () => []);
  const right: Card[][] = Array.from({ length: perSide }, () => []);
  // 配る順: 右の内側・左の内側・右の外側・左の外側。skipLeftOuter（左端に ChatGPT を固定しているとき）は左の外側を使わない
  const slots: [Card[][], number][] = [];
  for (let col = 0; col < perSide; col++) {
    slots.push([right, col]);
    if (!(skipLeftOuter && perSide > 1 && col === perSide - 1)) slots.push([left, col]);
  }
  let n = 0;
  for (const c of cards) {
    if (c.float) continue;
    const [side, col] = slots[n++ % slots.length];
    side[col].push(c);
  }
  return { left, right };
}

/** ChatGPT のカードの置き場所（利用者の決まり 2026-11-17: 左端に縦いっぱいで固定。左の外側の列の場所を使う） */
export function chatgptFloat(vw: number, vh: number) {
  const x = 64; // 左端のアプリのアイコンの右
  const y = 10;
  const w = Math.max(300, Math.min(400, Math.round(vw * 0.2)));
  const h = Math.max(320, vh - y - 72); // 左下の日時の上まで
  return { x, y, w, h };
}

/** 置き場所を画面の中に収める（帯が画面の外に出て、つかめなくならないように） */
export function clampFloat(f: { x: number; y: number; w: number; h?: number }, vw: number, vh: number) {
  const w = Math.max(280, Math.min(f.w, vw - 16));
  const h = f.h === undefined ? undefined : Math.max(160, Math.min(f.h, vh - 16));
  return { x: Math.round(Math.max(8 - w + 120, Math.min(f.x, vw - 120))), y: Math.round(Math.max(8, Math.min(f.y, vh - 48))), w: Math.round(w), h: h === undefined ? undefined : Math.round(h) };
}

/**
 * 発言の言葉から、画面がすぐ（PC の DIMY に聞かずに）出すカードを決める。
 * morning: その日はじめての「おはよう」かもしれないとき（日付と天気を出す）
 */
export function builtinCardsFor(text: string): BuiltinKind[] {
  const t = text.replace(/\s+/g, "");
  const out: BuiltinKind[] = [];
  const morning = /^(おはよう|おはよー|おっはよ|お早う)/.test(t);
  const weatherWords = /(天気|気温|雨|雪|晴れ|傘|暑い|寒い|降水)/.test(t);
  // 週間の天気（利用者の決まり: 1 週間より少し長く、晴れ・雨のマークで週間カレンダーのように見せる）
  if (weatherWords && /(週間|一週間|1週間|１週間|今週|来週|週末|土日|数日|この先|これから|10日|十日|2週間|二週間)/.test(t)) out.push("week");
  if (morning || weatherWords) out.push("weather");
  if (morning || /(何日|何曜|日付|曜日|今日は何|カレンダー)/.test(t)) out.push("date");
  if (/(予定|スケジュール|会議|打ち合わせ|アポ)/.test(t)) out.push("schedule");
  return out;
}

/** YouTube の URL を、画面の中で再生できる形（embed）にする。YouTube でなければ null */
export function youtubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    let id = "";
    if (u.hostname === "youtu.be") id = u.pathname.slice(1);
    else if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      if (u.pathname === "/watch") id = u.searchParams.get("v") ?? "";
      else {
        const m = u.pathname.match(/^\/(embed|shorts|live)\/([^/?]+)/);
        if (m) id = m[2];
      }
    }
    return /^[\w-]{6,20}$/.test(id) ? `https://www.youtube.com/embed/${id}` : null;
  } catch {
    return null;
  }
}

export type BuiltinKind = "weather" | "date" | "schedule" | "week";
/** 画面が自分で出すカードの見出し */
export const BUILTIN_TITLE: Record<BuiltinKind, string> = { weather: "天気", date: "今日の日付", schedule: "今日の予定", week: "週間の天気（2 週間）" };

/**
 * 文を「ふつう」と「強調」の断片に分ける。**〇〇** で囲んだところと、数字（単位つき）を強調する。
 * 離れた場所からでも大事な数字が目に入るようにするため。
 */
export function emphasize(text: string): { text: string; strong: boolean }[] {
  const out: { text: string; strong: boolean }[] = [];
  const push = (t: string, strong: boolean) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.strong === strong) last.text += t;
    else out.push({ text: t, strong });
  };
  const NUM = /[+\-−]?\d[\d,，.]*\s*(?:%|％|°C?|℃|円|ドル|万円?|億円?|兆円?|件|人|時間?|分|秒|日|か月|ヶ月|月|年|歳|km|kg|mm|cm|m|g|倍|位|点|度|枚|本|個|回)?/g;
  text.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return push(part.slice(2, -2), true);
    let i = 0;
    for (const m of part.matchAll(NUM)) {
      push(part.slice(i, m.index), false);
      push(m[0], true);
      i = (m.index ?? 0) + m[0].length;
    }
    push(part.slice(i), false);
  });
  return out;
}

/** Google マップを画面の中に出す URL（API キーの要らない埋め込み）。from（出発地）があれば道順 */
export function mapEmbedUrl(query: string, zoom = 14, from?: string): string {
  if (from) return `https://maps.google.com/maps?saddr=${encodeURIComponent(from)}&daddr=${encodeURIComponent(query)}&hl=ja&output=embed`;
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=${zoom}&hl=ja&output=embed`;
}

/** 道順を Google マップで開く URL。origin を省くと、その端末の現在地から（スマホは地図のアプリが開く） */
export function mapDirUrl(to: string, from?: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(to)}${from ? `&origin=${encodeURIComponent(from)}` : ""}&travelmode=driving`;
}

/** Google マップで開く URL */
export function mapOpenUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** カードを枠の外へドラッグして、そのリンク・場所だけを別のカードにするときの、ドラッグの中身の種類 */
export const CARD_DRAG_TYPE = "application/x-dimy-card";
export type CardDrag = { from: string; kind: CardKind; title: string; data: CardData };

/** 会話の控えに残す形（ピンの有無と、呼び出した会話のカードは残さない） */
export function snapshotCards(cards: Card[]): Card[] {
  return cards.filter((c) => c.kind !== "talk" && c.kind !== "chat").map((c) => ({ ...c, pinned: false, float: undefined }));
}

/** 会話のカード（文字入力と会話の履歴）。正面の真ん中に、字幕にかからない高さで出す。最初からピン留め */
export function chatCard(vw: number, vh: number): Card {
  const w = Math.min(640, vw - 16);
  // スマホでは、上の段（PC の状態・日時・天気・アプリ）の下から
  const top = vw < 768 ? 188 : 96;
  const h = Math.max(260, vh - top - (vw < 768 ? 250 : 290));
  return { id: "chat", kind: "chat", title: "会話", data: {}, pinned: true, at: Date.now() + 2e13, float: { x: Math.round((vw - w) / 2), y: top, w, h } };
}

/** Web ページのカード（拡張機能があるとき、ディミの画面の中でページをそのまま開く）。正面に大きく、字幕にかからない高さで出す。利用者が開いたものなのでピン留め */
export function webCard(url: string, title: string, vw: number, vh: number): Card {
  const w = Math.min(1100, vw < 768 ? vw - 16 : vw - 160);
  const top = vw < 768 ? 188 : 96;
  const h = Math.max(260, vh - top - (vw < 768 ? 250 : 290));
  return {
    id: `web-${Date.now()}`,
    kind: "web",
    title: title || url,
    data: { url },
    pinned: true,
    at: Date.now() + 1e13,
    float: { x: Math.round((vw - w) / 2), y: top, w, h },
  };
}

/** YouTube の動画の番号（YouTube でなければ null）。スマホの小さなカードで、見出しの画像を出すため */
export function youtubeId(url: string): string | null {
  const e = youtubeEmbed(url);
  return e ? e.split("/").pop() ?? null : null;
}

/** Google 画像検索のページ（写真のカードで、デスクトップでは中にそのまま出す） */
export function googleImagesUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&udm=2&hl=ja`;
}

/** 読み上げている文に、カードを出す言葉（say）が入っているか。空白・記号・大文字小文字の違いは見ない。「|」「、」で区切った言い換えのどれかが入っていればよい */
export function sayMatches(sentence: string, say?: string): boolean {
  if (!say) return true;
  const norm = (t: string) => t.toLowerCase().replace(/[\s、。,.!！?？・「」『』（）()*:：\-]/g, "");
  const s = norm(sentence);
  return say
    .split(/[|｜、,]/)
    .map(norm)
    .filter(Boolean)
    .some((w) => s.includes(w));
}

/** 読み上げる文を 1 文ずつに分ける（文ごとに、合うカードを出すため） */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])/)
    .map((x) => x.trim())
    .filter(Boolean);
}
