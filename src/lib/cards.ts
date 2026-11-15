// 画面のカード（返事の中身を目でも見せる）の形と、言葉から出すカードを決める決まり。

export type CardKind = "weather" | "date" | "schedule" | "list" | "video" | "points" | "page" | "image" | "text" | "stats" | "map" | "talk" | "chat" | "web" | "place";
export type CardData = {
  items?: { title: string; url?: string; note?: string; image?: string }[];
  stats?: { label: string; value: string; unit?: string }[];
  places?: { name: string; query: string; note?: string }[];
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
};
export type Card = {
  id: string;
  kind: CardKind;
  title: string;
  data: CardData;
  pinned: boolean;
  at: number;
  /** 利用者がドラッグで好きな場所に置いたカード（画面の中の位置と大きさ。px）。列には並べない */
  float?: { x: number; y: number; w: number; h?: number };
};

/** 列に並べるカードを左右に分ける（右・左の互い違い）。好きな場所に置いたカードは除く */
export function splitColumns(cards: Card[]): { left: Card[]; right: Card[] } {
  const left: Card[] = [];
  const right: Card[] = [];
  let n = 0;
  for (const c of cards) if (!c.float) (n++ % 2 === 0 ? right : left).push(c);
  return { left, right };
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
export function builtinCardsFor(text: string): ("weather" | "date" | "schedule")[] {
  const t = text.replace(/\s+/g, "");
  const out: ("weather" | "date" | "schedule")[] = [];
  const morning = /^(おはよう|おはよー|おっはよ|お早う)/.test(t);
  if (morning || /(天気|気温|雨|雪|晴れ|傘|暑い|寒い|降水)/.test(t)) out.push("weather");
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

/** 画面が自分で出すカードの見出し */
export const BUILTIN_TITLE: Record<"weather" | "date" | "schedule", string> = { weather: "天気", date: "今日の日付", schedule: "今日の予定" };

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

/** Google マップを画面の中に出す URL（API キーの要らない埋め込み） */
export function mapEmbedUrl(query: string, zoom = 14): string {
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=${zoom}&hl=ja&output=embed`;
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
