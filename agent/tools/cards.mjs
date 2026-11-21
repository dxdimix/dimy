// DIMY の道具: 画面にカードを出す（返事の中身を目でも見せる）。表 cards に書くと、画面が Realtime で受け取ってすぐ出す。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { aliasLegacyEnv } from "../lib/env.mjs";
import { TICKERS, fetchSeries, guessTicker } from "../lib/markets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
loadEnv({ path: path.join(ROOT, ".env.local"), quiet: true });
aliasLegacyEnv();

const KINDS = ["list", "video", "points", "page", "image", "text", "stats", "map", "place", "web"];
const isUrl = (u) => typeof u === "string" && /^https?:\/\//i.test(u);

/** 道具に渡された中身を、画面に出せる形に整える（変なものは落とす） */
export function normalizeCard(a) {
  const kind = String(a.kind ?? "");
  if (!KINDS.includes(kind)) throw new Error(`kind は ${KINDS.join(" / ")} のどれかにしてください。`);
  const title = String(a.title ?? "").slice(0, 120);
  const data = {};
  if (kind === "list") {
    data.items = (Array.isArray(a.items) ? a.items : [])
      .slice(0, 10)
      .map((it) => ({
        title: String(it?.title ?? "").slice(0, 200),
        url: isUrl(it?.url) ? it.url : undefined,
        note: it?.note ? String(it.note).slice(0, 200) : undefined,
        image: isUrl(it?.image) && !isTitleOnlyImage(it.image) ? it.image : undefined,
      }))
      .filter((it) => it.title);
    if (!data.items.length) throw new Error("items が空です。");
  } else if (kind === "points") {
    data.points = (Array.isArray(a.points) ? a.points : []).slice(0, 8).map((p) => String(p).slice(0, 200)).filter(Boolean);
    data.style = a.style === "steps" ? "steps" : "points";
    if (!data.points.length) throw new Error("points が空です。");
  } else if (kind === "stats") {
    data.stats = (Array.isArray(a.stats) ? a.stats : [])
      .slice(0, 6)
      .map((x) => {
        const st = { label: String(x?.label ?? "").slice(0, 40), value: String(x?.value ?? "").slice(0, 20), unit: x?.unit ? String(x.unit).slice(0, 10) : undefined };
        if (x?.change) st.change = String(x.change).slice(0, 20);
        // 直近の推移のグラフ（利用者の決まり）: ticker（株価・為替）か、ディミが渡した数字の並び
        const ticker = TICKERS[x?.ticker] ? x.ticker : guessTicker(st.label);
        if (ticker) st.ticker = ticker;
        const series = Array.isArray(x?.series) ? x.series.map(Number).filter(Number.isFinite).slice(-60) : [];
        if (series.length >= 2) st.series = series;
        return st;
      })
      .filter((x) => x.label && x.value);
    if (!data.stats.length) throw new Error("stats が空です。");
  } else if (kind === "place") {
    // 施設（キャンプ場・動物園・ホテル・店など）1 か所分。調べものの候補ごとに 1 枚
    const str = (v, n) => (v ? String(v).slice(0, n) : undefined);
    if (isUrl(a.url)) data.url = a.url;
    if (isUrl(a.image)) data.image = a.image;
    data.area = str(a.area, 40); // 市区町村（天気と地図に使う）
    data.query = str(a.query || [a.title, a.area].filter(Boolean).join(" "), 200); // 地図で探す言葉
    data.address = str(a.address, 120);
    data.hours = str(a.hours, 200);
    data.phone = str(a.phone, 30);
    data.note = str(a.note, 300);
    data.prices = (Array.isArray(a.prices) ? a.prices : [])
      .slice(0, 8)
      .map((x) => ({ label: String(x?.label ?? "").slice(0, 40), value: String(x?.value ?? "").slice(0, 40) }))
      .filter((x) => x.label && x.value);
    data.points = (Array.isArray(a.points) ? a.points : []).slice(0, 5).map((x) => String(x).slice(0, 120)).filter(Boolean);
    if (!title) throw new Error("title（施設の名前）が必要です。");
  } else if (kind === "map") {
    data.places = (Array.isArray(a.places) ? a.places : [])
      .slice(0, 8)
      .map((x) => ({
        name: String(x?.name ?? "").slice(0, 80),
        query: String(x?.query || x?.address || x?.name || "").slice(0, 200),
        note: x?.note ? String(x.note).slice(0, 200) : undefined,
        // 道順: 出発地（例: 総社市）。あれば、出発地からの道順の地図にする
        from: x?.from ? String(x.from).slice(0, 120) : undefined,
      }))
      .filter((x) => x.name && x.query);
    if (!data.places.length) throw new Error("places が空です。");
  } else if (kind === "text") {
    data.text = String(a.text ?? "").slice(0, 1000);
    if (!data.text) throw new Error("text が空です。");
  } else if (kind === "image" && !isUrl(a.url)) {
    // 画像を言葉で探す（例: 「瀬戸大橋 鷲羽山 景色」）。写真は PC の DIMY が無料の写真集（Wikimedia Commons）から探して、あとから書き足す
    data.query = String(a.query ?? "").slice(0, 120);
    data.count = Math.min(4, Math.max(1, Number(a.count) || 1));
    if (!data.query) throw new Error("image には url か query（探す言葉）が必要です。");
    if (a.note) data.note = String(a.note).slice(0, 300);
  } else {
    if (!isUrl(a.url)) throw new Error("url（http / https）が必要です。");
    data.url = a.url;
    if (a.note) data.note = String(a.note).slice(0, 300);
    if ((kind === "page" || kind === "web") && isUrl(a.image) && !isTitleOnlyImage(a.image)) data.image = a.image;
  }
  // 返事の中で、このカードを出したい言葉（画面は、読み上げがこの言葉を含む文に来たときに出す）
  if (a.say) data.say = String(a.say).slice(0, 60);
  // どのカードにも付けられるリンク（公式サイト・情報元など。画面ではボタンになり、引っ張り出してピン留めもできる）
  const links = (Array.isArray(a.links) ? a.links : [])
    .slice(0, 6)
    .map((x) => ({ title: String(x?.title ?? "").slice(0, 60), url: isUrl(x?.url) ? x.url : "" }))
    .filter((x) => x.title && x.url);
  if (links.length) data.links = links;
  // どのカードにも付けられる写真（話の中身が伝わる写真。利用者の希望: 文字だけだと見づらい）。
  // なければ、PC の DIMY がリンクのページの見出し画像を探して、あとから添える
  if (!data.image && isUrl(a.image) && kind !== "list" && kind !== "image" && !isTitleOnlyImage(a.image)) data.image = a.image;
  return { kind, title, data };
}

/**
 * ページの見出し画像（og:image / twitter:image）を探す。ニュースの一覧やページのカードに写真を添えるため。
 * 3 秒で諦め、先頭の 300KB だけを読む。見つからなければ undefined。
 */
export async function findPageImage(url, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (DIMY personal assistant)", accept: "text/html" } });
    if (!res.ok || !/html/i.test(res.headers.get("content-type") ?? "")) return undefined;
    const reader = res.body?.getReader();
    if (!reader) return undefined;
    let html = "";
    const dec = new TextDecoder();
    while (html.length < 300_000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += dec.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
    return pageImageFromHtml(html, res.url || url);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 言葉で写真を探す（Wikimedia Commons。無料・キーなし。名所や景色に強い）。見つからなければ空。
 * @returns {Promise<{ url: string, title: string, page: string }[]>}
 */
export async function findCommonsImages(query, count = 1, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const u = new URL("https://commons.wikimedia.org/w/api.php");
    for (const [k, v] of Object.entries({
      action: "query",
      format: "json",
      generator: "search",
      gsrsearch: `${query} filetype:bitmap`,
      gsrnamespace: "6",
      gsrlimit: String(Math.min(10, count * 3)),
      prop: "imageinfo",
      iiprop: "url|mime",
      iiurlwidth: "1280",
    }))
      u.searchParams.set(k, v);
    const res = await fetch(u, { signal: ctrl.signal, headers: { "user-agent": "DIMY personal assistant" } });
    if (!res.ok) return [];
    return commonsResults(await res.json(), count);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Wikimedia Commons の答えから、写真（JPEG・PNG）を検索の順に取り出す */
export function commonsResults(json, count) {
  const pages = Object.values(json?.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages
    .map((p) => ({ info: p.imageinfo?.[0], title: String(p.title ?? "").replace(/^File:|\.[a-z]+$/gi, "") }))
    .filter((x) => x.info && /image\/(jpeg|png)/.test(x.info.mime ?? ""))
    .slice(0, count)
    .map((x) => ({ url: x.info.thumburl || x.info.url, title: x.title, page: x.info.descriptionurl ?? "" }));
}

/** HTML の頭から見出し画像の URL を取り出す（相対の URL は絶対にする） */
/**
 * サイトの名前・タイトル・ロゴだけの画像か（利用者の決まり 2026-11-17: 「天気予報」「Yahoo!天気・災害」のような
 * タイトルだけの大きな画像は、見ても情報にならないので出さない）。
 * - サイトのトップや分類のページ（記事でないページ）の見出し画像は、たいていサイト共通の看板の画像
 * - 画像のアドレスに logo・ogp・default・common・share・banner などが入っているもの
 */
export function isTitleOnlyImage(imageUrl, pageUrl) {
  if (/(logo|ogp|og[-_]?image|og[-_]img|default|common|share|banner|social|sns|site[-_]?image|top[-_]?image|no[-_]?image|noimage|icon|brand|header|thumbnail[-_]?default|fb[-_]?image|twitter[-_]?card)/i.test(imageUrl)) return true;
  if (!pageUrl) return false;
  try {
    const u = new URL(pageUrl);
    const segs = u.pathname.split("/").filter(Boolean).filter((x) => !/^index\.\w+$/.test(x));
    // 記事らしいページ: 深い階層か、番号の入った階層がある
    const article = segs.length >= 2 || segs.some((x) => /\d{3,}/.test(x) || x.length >= 15) || /[?&](id|p|article|no)=\w/.test(u.search);
    return !article;
  } catch {
    return false;
  }
}

export function pageImageFromHtml(html, base) {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const want of ["og:image", "og:image:url", "twitter:image", "twitter:image:src"]) {
    for (const m of metas) {
      const key = m.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
      if (key !== want) continue;
      const content = m.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!content) continue;
      try {
        const u = new URL(content.replace(/&amp;/g, "&"), base);
        if (u.protocol !== "https:" && u.protocol !== "http:") continue;
        // サイトの名前やタイトルだけの画像は使わない（利用者の決まり。見ても情報にならない）
        if (isTitleOnlyImage(u.href, base)) return undefined;
        return u.href;
      } catch {
        /* 次を探す */
      }
    }
  }
  return undefined;
}

/** 一覧とページのカードに、画像がなければページの見出し画像を添える（並べて同時に探す） */
/** 株価・為替の項目に、直近 30 営業日の終値を書き足す（グラフ用）。前日比がなければ終値から作る */
async function addSeries(card) {
  await Promise.all(
    (card.data.stats ?? []).map(async (st) => {
      if (!st.ticker || st.series) return;
      const rows = await fetchSeries(st.ticker, 30);
      if (rows.length < 2) return;
      st.series = rows.map((r) => r.close);
      st.seriesFrom = rows[0].date;
      st.seriesTo = rows[rows.length - 1].date;
      if (!st.change) {
        const [a, b] = rows.slice(-2).map((r) => r.close);
        const pct = ((b - a) / a) * 100;
        st.change = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
      }
    }),
  );
}

async function addImages(card) {
  if (card.kind === "stats") await addSeries(card);
  if (card.kind === "list") {
    await Promise.all(
      card.data.items.map(async (it) => {
        if (!it.image && it.url) it.image = await findPageImage(it.url);
      }),
    );
    // 同じ画像が 2 件以上に付いたら、まとめ記事やサイト共通の画像なので外す（利用者の決まり 2026-11-21）
    const count = new Map();
    for (const it of card.data.items) if (it.image) count.set(it.image, (count.get(it.image) ?? 0) + 1);
    for (const it of card.data.items) if (it.image && count.get(it.image) > 1) delete it.image;
  } else if (PHOTO_FROM_LINK.includes(card.kind) && !card.data.image && card.data.links?.[0]?.url) {
    // リンクを上から順に試し、最初に見つかった見出し画像を使う
    for (const l of card.data.links.slice(0, 3)) {
      const img = await findPageImage(l.url);
      if (img) {
        card.data.image = img;
        break;
      }
    }
  } else if (card.kind === "image" && card.data.query) {
    const found = await findCommonsImages(card.data.query, card.data.count ?? 1);
    if (found.length) {
      card.data.images = found;
      card.data.url = found[0].url;
    }
  } else if ((card.kind === "page" || card.kind === "place" || card.kind === "web") && !card.data.image && card.data.url) {
    card.data.image = await findPageImage(card.data.url);
  }
}

export async function showCard(a) {
  // 何枚かをまとめて出せる（cards に並べる）。道具を 1 回で済ませると、返事が早く終わる
  // 1 回で 12 枚まで（利用者の希望: 話した中身ごとにカードを、画面が埋まるくらい出す）
  const list = (Array.isArray(a.cards) && a.cards.length ? a.cards : [a]).slice(0, 12).map(normalizeCard);
  const raw = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  const owner = process.env.DIMY_OWNER_ID;
  if (!raw || !key || !owner) throw new Error("DIMY のデータベースの設定がありません。");
  const sb = createClient(new URL(raw).origin, key, { auth: { persistSession: false, autoRefreshToken: false } });
  // 先にカードを出す（返事を待たせない）。写真はあとから探して書き足す（画面は Realtime の更新で差し替える）
  const { data: rows, error } = await sb.from("cards").insert(list.map((card) => ({ user_id: owner, ...card }))).select("id");
  if (error) throw new Error(`カードを出せませんでした（${error.message}）`);
  list.forEach((card, i) => {
    if (!needsImages(card) || !rows?.[i]) return;
    addImages(card)
      .then(() => sb.from("cards").update({ data: card.data }).eq("id", rows[i].id))
      .catch(() => {});
  });
  return `画面にカードを ${list.length} 枚出しました。say を付けたカードは、読み上げがその言葉に来たときに出ます。これから、カードの中身（料金・時間・乗り物・注意点など）を、各カードの say の言葉をそのまま使って 2〜4 文で話してください（検索の前に話した概要だけでは足りません。話しながらカードが 1 枚ずつ出ます）。すでに検索のあとで中身を話していれば、何も書かずに終えてください。説明やかっこ書きの独り言（「すでにお話ししたので書き足しません」など）は書かないでください。`;
}

/** 数字・要点・文・地図・動画のカードで、写真がなくリンクがあるもの（リンクのページの見出し画像を添える） */
const PHOTO_FROM_LINK = ["stats", "points", "text", "map"];
function needsImages(card) {
  if (card.kind === "stats" && card.data.stats?.some((st) => st.ticker && !st.series)) return true;
  if (PHOTO_FROM_LINK.includes(card.kind)) return !card.data.image && Boolean(card.data.links?.[0]?.url);
  if (card.kind === "image") return Boolean(card.data.query) && !card.data.url;
  if (card.kind === "list") return card.data.items.some((it) => !it.image && it.url);
  return (card.kind === "page" || card.kind === "place" || card.kind === "web") && !card.data.image && Boolean(card.data.url);
}
