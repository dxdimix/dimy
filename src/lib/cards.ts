// 画面のカード（返事の中身を目でも見せる）の形と、言葉から出すカードを決める決まり。

export type CardKind = "weather" | "date" | "schedule" | "list" | "video" | "points" | "page" | "image" | "text" | "stats" | "map";
export type CardData = {
  items?: { title: string; url?: string; note?: string; image?: string }[];
  stats?: { label: string; value: string; unit?: string }[];
  places?: { name: string; query: string; note?: string }[];
  image?: string;
  points?: string[];
  style?: "points" | "steps";
  url?: string;
  note?: string;
  text?: string;
};
export type Card = { id: string; kind: CardKind; title: string; data: CardData; pinned: boolean; at: number };

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
