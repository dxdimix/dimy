// 画面のカード（返事の中身を目でも見せる）の形と、言葉から出すカードを決める決まり。

export type CardKind = "weather" | "date" | "schedule" | "list" | "video" | "points" | "page" | "image" | "text";
export type CardData = {
  items?: { title: string; url?: string; note?: string }[];
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
