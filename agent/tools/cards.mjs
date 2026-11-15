// DIMY の道具: 画面にカードを出す（返事の中身を目でも見せる）。表 cards に書くと、画面が Realtime で受け取ってすぐ出す。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { aliasLegacyEnv } from "../lib/env.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
loadEnv({ path: path.join(ROOT, ".env.local"), quiet: true });
aliasLegacyEnv();

const KINDS = ["list", "video", "points", "page", "image", "text"];
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
      .map((it) => ({ title: String(it?.title ?? "").slice(0, 200), url: isUrl(it?.url) ? it.url : undefined, note: it?.note ? String(it.note).slice(0, 200) : undefined }))
      .filter((it) => it.title);
    if (!data.items.length) throw new Error("items が空です。");
  } else if (kind === "points") {
    data.points = (Array.isArray(a.points) ? a.points : []).slice(0, 8).map((p) => String(p).slice(0, 200)).filter(Boolean);
    data.style = a.style === "steps" ? "steps" : "points";
    if (!data.points.length) throw new Error("points が空です。");
  } else if (kind === "text") {
    data.text = String(a.text ?? "").slice(0, 1000);
    if (!data.text) throw new Error("text が空です。");
  } else {
    if (!isUrl(a.url)) throw new Error("url（http / https）が必要です。");
    data.url = a.url;
    if (a.note) data.note = String(a.note).slice(0, 300);
  }
  return { kind, title, data };
}

export async function showCard(a) {
  const card = normalizeCard(a);
  const raw = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  const owner = process.env.DIMY_OWNER_ID;
  if (!raw || !key || !owner) throw new Error("DIMY のデータベースの設定がありません。");
  const sb = createClient(new URL(raw).origin, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await sb.from("cards").insert({ user_id: owner, ...card });
  if (error) throw new Error(`カードを出せませんでした（${error.message}）`);
  return "画面にカードを出しました。";
}
