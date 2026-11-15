// DIMY の道具: 画面にカードを出す（返事の中身を目でも見せる）。表 cards に書くと、画面が Realtime で受け取ってすぐ出す。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { aliasLegacyEnv } from "../lib/env.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
loadEnv({ path: path.join(ROOT, ".env.local"), quiet: true });
aliasLegacyEnv();

const KINDS = ["list", "video", "points", "page", "image", "text", "stats"];
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
        image: isUrl(it?.image) ? it.image : undefined,
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
      .map((x) => ({ label: String(x?.label ?? "").slice(0, 40), value: String(x?.value ?? "").slice(0, 20), unit: x?.unit ? String(x.unit).slice(0, 10) : undefined }))
      .filter((x) => x.label && x.value);
    if (!data.stats.length) throw new Error("stats が空です。");
  } else if (kind === "text") {
    data.text = String(a.text ?? "").slice(0, 1000);
    if (!data.text) throw new Error("text が空です。");
  } else {
    if (!isUrl(a.url)) throw new Error("url（http / https）が必要です。");
    data.url = a.url;
    if (a.note) data.note = String(a.note).slice(0, 300);
    if (kind === "page" && isUrl(a.image)) data.image = a.image;
  }
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

/** HTML の頭から見出し画像の URL を取り出す（相対の URL は絶対にする） */
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
        if (u.protocol === "https:" || u.protocol === "http:") return u.href;
      } catch {
        /* 次を探す */
      }
    }
  }
  return undefined;
}

/** 一覧とページのカードに、画像がなければページの見出し画像を添える（並べて同時に探す） */
async function addImages(card) {
  if (card.kind === "list") {
    await Promise.all(
      card.data.items.map(async (it) => {
        if (!it.image && it.url) it.image = await findPageImage(it.url);
      }),
    );
  } else if (card.kind === "page" && !card.data.image) {
    card.data.image = await findPageImage(card.data.url);
  }
}

export async function showCard(a) {
  const card = normalizeCard(a);
  await addImages(card);
  const raw = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  const owner = process.env.DIMY_OWNER_ID;
  if (!raw || !key || !owner) throw new Error("DIMY のデータベースの設定がありません。");
  const sb = createClient(new URL(raw).origin, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await sb.from("cards").insert({ user_id: owner, ...card });
  if (error) throw new Error(`カードを出せませんでした（${error.message}）`);
  return "画面にカードを出しました。";
}
