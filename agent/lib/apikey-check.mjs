// 料金の安全確認: Anthropic の API キーが PC のどこかに設定されていないかを調べる。
// API キーがあると、Claude Code はサブスクの枠ではなく、使った分だけ API の料金がかかる動き方をすることがある。
// ここでは「どこにあるか（場所の名前）」だけを返す。キーの中身は読まない・記録しない。
// DIMY 自身は、Claude Code に渡す環境変数から API キーを外している（claude-session.mjs の safeEnv）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** 料金のかかる動き方になる設定の名前 */
export const BILLING_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

/** Windows の設定（レジストリ）に、その名前の環境変数があるか（中身は見ない） */
function regHas(key, name) {
  if (process.platform !== "win32") return false;
  try {
    const out = execFileSync("reg", ["query", key, "/v", name], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    return new RegExp(`${name}\\s+REG_`, "i").test(out);
  } catch {
    return false;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** .env の形のファイルに、その名前の行があるか（中身が空でない行だけ） */
export function envFileHas(text, name) {
  return new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*\\S`, "m").test(text);
}

/**
 * API キーが設定されている場所の一覧（例: 「Windows の利用者の環境変数 ANTHROPIC_API_KEY」）。なければ空。
 * @param {{ env?: Record<string, string | undefined>, home?: string, extraEnvFiles?: string[], reg?: (key: string, name: string) => boolean }} [o]
 */
export function findApiKeyPlaces(o = {}) {
  const env = o.env ?? process.env;
  const home = o.home ?? os.homedir();
  const reg = o.reg ?? regHas;
  const places = [];
  for (const name of BILLING_VARS) {
    if (env[name]) places.push(`DIMY が起動したときの環境変数 ${name}`);
    if (reg("HKCU\\Environment", name)) places.push(`Windows の利用者の環境変数 ${name}`);
    if (reg("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment", name)) places.push(`Windows の PC 全体の環境変数 ${name}`);
  }
  // Claude Code の設定（すべてのセッションに効く）
  for (const file of [path.join(home, ".claude", "settings.json"), path.join(home, ".claude", "settings.local.json")]) {
    const j = readJson(file);
    if (!j) continue;
    for (const name of BILLING_VARS) if (j.env?.[name]) places.push(`Claude Code の設定 ${file} の env.${name}`);
    if (j.apiKeyHelper) places.push(`Claude Code の設定 ${file} の apiKeyHelper`);
  }
  // Claude Code に API キーでログインしたときの控え
  // （claude.ai のサブスクでもログインしていれば、その控えは使われない。/status の表示は「/login managed key · not in use」）
  const state = readJson(path.join(home, ".claude.json"));
  if (state?.primaryApiKey && !state?.oauthAccount)
    places.push(`Claude Code のログイン情報 ${path.join(home, ".claude.json")}（API キーでログインしていて、サブスクのログインがない）`);
  // DIMY のフォルダなどの .env.local
  for (const file of o.extraEnvFiles ?? []) {
    try {
      const text = fs.readFileSync(file, "utf8");
      for (const name of BILLING_VARS) if (envFileHas(text, name)) places.push(`${file} の ${name}`);
    } catch {
      /* ファイルがなければ飛ばす */
    }
  }
  return places;
}

/**
 * DIMY の Claude Code が API の料金で動いてしまう設定（場所の名前）。なければ空。
 * 環境変数の API キーは DIMY が外して渡すので含めない。Claude Code 自身の設定とログインだけを見る。
 */
export function claudeCodeBillingPlaces(o = {}) {
  return findApiKeyPlaces({ ...o, env: {}, reg: () => false, extraEnvFiles: [] });
}
