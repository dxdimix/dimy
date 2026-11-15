"use client";

// DIMY の設定の保存場所（利用者の決まり: すべてデータベースで共通。どの端末で開いても同じ設定）。
// - 本体は表 user_settings の key "prefs"（{ 名前: 文字列 } の 1 つの JSON）
// - このブラウザにも控えを置く（開いた直後や、つながらないときにすぐ使えるように）。控えより、データベースが優先
// - ほかの端末・ほかのタブで変わったら、すぐ反映する（Realtime と、同じブラウザの BroadcastChannel、画面に戻ったときの読み直し）
// - 書き込みは 0.8 秒まとめてから。ほかの端末が同時に変えたものを消さないよう、変えた名前だけを最新の値に重ねて保存する
// - 以前このブラウザに保存していた設定（dimy.〇〇・kymis.〇〇）は、データベースにまだなければ引き継ぐ
// 端末そのものの区別（どのタブが話すか など）だけは、このブラウザに置く（設定ではないため）。

import { useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type Prefs = Record<string, string>;
const DB_KEY = "prefs";
const CACHE = "dimy.prefs";
// 以前ブラウザに置いていたもののうち、設定ではないもの（引き継がない）
const NOT_PREFS = new Set(["prefs", "voiceTab", "deviceId", "openOn"]); // openOn は Hud が共通の名前（openOn）へ引き継ぐ

let prefs: Prefs = {};
let client: SupabaseClient | null = null;
let started: Promise<void> | null = null;
let ready = false;
let version = 0;
const listeners = new Set<() => void>();
const dirty = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let chan: BroadcastChannel | null = null;
let lastError = "";

function notify() {
  version++;
  listeners.forEach((l) => l());
}

function writeCache() {
  try {
    localStorage.setItem(CACHE, JSON.stringify(prefs));
  } catch {}
}

/** 以前ブラウザに 1 つずつ置いていた設定を集める（dimy.〇〇 を優先、なければ kymis.〇〇・jarvis.〇〇） */
function legacyLocal(): Prefs {
  const out: Prefs = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const m = k?.match(/^(dimy|kymis|jarvis)\.(.+)$/);
      if (!k || !m || NOT_PREFS.has(m[2])) continue;
      const v = localStorage.getItem(k);
      if (v === null) continue;
      if (m[1] === "dimy" || !(m[2] in out)) out[m[2]] = v;
    }
  } catch {}
  return out;
}

async function fetchDb(): Promise<Prefs | null> {
  if (!client) return null;
  const { data, error } = await client.from("user_settings").select("value").eq("key", DB_KEY).maybeSingle();
  if (error) {
    lastError = error.message;
    return null;
  }
  lastError = "";
  return (data?.value as Prefs) ?? {};
}

async function flush() {
  saveTimer = null;
  if (!client || !dirty.size) return;
  const keys = [...dirty];
  dirty.clear();
  const { data: u } = await client.auth.getUser();
  if (!u.user) return;
  // 最新の値に、変えた名前だけを重ねる（ほかの端末の変更を消さない）
  const latest = (await fetchDb()) ?? {};
  for (const k of keys) {
    if (k in prefs) latest[k] = prefs[k];
    else delete latest[k];
  }
  const { error } = await client.from("user_settings").upsert({ user_id: u.user.id, key: DB_KEY, value: latest, updated_at: new Date().toISOString() });
  if (error) {
    lastError = error.message;
    keys.forEach((k) => dirty.add(k)); // 次の機会にもう一度
  }
}

function apply(remote: Prefs) {
  // 自分がまだ保存していない変更は残す
  const next: Prefs = { ...remote };
  for (const k of dirty) {
    if (k in prefs) next[k] = prefs[k];
    else delete next[k];
  }
  if (JSON.stringify(next) === JSON.stringify(prefs)) return;
  prefs = next;
  writeCache();
  notify();
}

/** 設定を読み込み、変化を見張り始める（画面を開いたときに 1 回呼ぶ。何度呼んでもよい） */
export function initPrefs(supabase: SupabaseClient): Promise<void> {
  if (started) return started;
  client = supabase;
  try {
    prefs = JSON.parse(localStorage.getItem(CACHE) ?? "{}");
  } catch {
    prefs = {};
  }
  // 控えがなければ、以前の 1 つずつの保存から作る
  const legacy = legacyLocal();
  for (const [k, v] of Object.entries(legacy)) if (!(k in prefs)) prefs[k] = v;
  notify();

  started = (async () => {
    const db = await fetchDb();
    if (db) {
      // データベースにないものだけ、このブラウザの控えから引き継ぐ
      const missing = Object.keys(prefs).filter((k) => !(k in db));
      prefs = { ...prefs, ...db };
      missing.forEach((k) => dirty.add(k));
      writeCache();
      if (dirty.size) await flush();
    }
    ready = true;
    notify();

    // ほかの端末での変更（Realtime）
    supabase
      .channel("dimy-prefs")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_settings", filter: `key=eq.${DB_KEY}` }, (p) => {
        const v = (p.new as { value?: Prefs } | null)?.value;
        if (v) apply(v);
      })
      .subscribe();
    // 同じブラウザのほかのタブ（パレットなど）での変更
    if (typeof BroadcastChannel !== "undefined") {
      chan = new BroadcastChannel("dimy-prefs");
      chan.onmessage = (e) => e.data && apply(e.data as Prefs);
    }
    // 画面に戻ったとき・1 分ごとにも読み直す（Realtime を取りこぼしても追いつくように）
    const refresh = () => fetchDb().then((v) => v && apply(v));
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refresh());
    setInterval(refresh, 60_000);
  })();
  return started;
}

/** 設定を読む（なければ null） */
export function getPref(key: string): string | null {
  return key in prefs ? prefs[key] : null;
}

/** 設定を変える（null で消す）。すぐに画面に反映し、0.8 秒後にデータベースへ保存する */
export function setPref(key: string, value: string | null) {
  if (value === null) {
    if (!(key in prefs)) return;
    const next = { ...prefs };
    delete next[key];
    prefs = next;
  } else {
    if (prefs[key] === value) return;
    prefs = { ...prefs, [key]: value };
  }
  dirty.add(key);
  writeCache();
  chan?.postMessage(prefs);
  notify();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush(), 800);
}

/** 名前が prefix で始まる設定の名前の一覧 */
export function prefKeys(prefix: string) {
  return Object.keys(prefs).filter((k) => k.startsWith(prefix));
}

/** 設定が変わるたびに呼ばれる（戻り値で見張りをやめる） */
export function onPrefs(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function prefsStatus() {
  return { ready, error: lastError };
}

/** 設定が変わったら描き直す。戻り値は変わるたびに増える番号（effect の依存に使う） */
export function usePrefsVersion() {
  return useSyncExternalStore(onPrefs, () => version, () => 0);
}

/** この端末を見分ける番号（このブラウザに置く。端末ごとに変えたい設定の名前に使う） */
export function deviceId() {
  try {
    let id = localStorage.getItem("dimy.deviceId");
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      localStorage.setItem("dimy.deviceId", id);
    }
    return id;
  } catch {
    return "unknown";
  }
}
