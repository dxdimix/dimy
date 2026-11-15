// Windows: プログラムを探す場所（PATH）を、Windows に保存されている最新のものに合わせる。
// デスクトップのショートカットから起動すると、サインインした時点の古い PATH のまま動くことがある
// （Claude Code を入れたあとにサインインし直していないと、'claude' が見つからない）。
// そこで、利用者と PC 全体の PATH を Windows の設定（レジストリ）から読み直して足し、
// それでも見つからなければ、Claude Code がよく入る場所を探す。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function regPath(key) {
  try {
    const out = execFileSync("reg", ["query", key, "/v", "Path"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    const m = out.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
    // %USERPROFILE% などを展開する
    return m ? m[1].trim().replace(/%([^%]+)%/g, (_, v) => process.env[v] ?? `%${v}%`) : "";
  } catch {
    return "";
  }
}

/** PATH を最新にする（今の PATH にない場所だけを後ろに足す） */
export function refreshWindowsPath() {
  if (process.platform !== "win32") return;
  const sep = ";";
  const cur = (process.env.Path || process.env.PATH || "").split(sep).filter(Boolean);
  const seen = new Set(cur.map((p) => p.toLowerCase()));
  for (const extra of [regPath("HKCU\\Environment"), regPath("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment")]) {
    for (const p of extra.split(sep).filter(Boolean)) {
      if (!seen.has(p.toLowerCase())) {
        cur.push(p);
        seen.add(p.toLowerCase());
      }
    }
  }
  process.env.Path = cur.join(sep);
  process.env.PATH = process.env.Path;
}

/** Claude Code の場所。CLAUDE_BIN の指定 → PATH の中 → よく入る場所、の順に探す。見つからなければ "claude" */
export function findClaudeBin(env = process.env) {
  if (env.CLAUDE_BIN) return env.CLAUDE_BIN;
  if (process.platform !== "win32") return "claude";
  const home = os.homedir();
  const names = ["claude.exe", "claude.cmd"];
  const dirs = [
    ...(env.Path || env.PATH || "").split(";").filter(Boolean),
    path.join(home, ".local", "bin"),
    path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "npm"),
    path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Programs", "claude"),
    path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "AnthropicClaude"),
  ];
  for (const d of dirs) for (const n of names) {
    const f = path.join(d, n);
    try {
      if (fs.existsSync(f)) return f;
    } catch {}
  }
  return "claude";
}

/** 利用者の PATH に dir が入っているか（大文字・小文字と、最後の \ の違いは見ない） */
export function pathHas(pathValue, dir, expand = (s) => s) {
  const norm = (p) => expand(p).replace(/[\\/]+$/, "").toLowerCase();
  return String(pathValue).split(";").filter(Boolean).some((p) => norm(p) === norm(dir));
}

/**
 * Claude Code の入っている場所（C:\Users\<名前>\.local\bin）を、Windows の「利用者の PATH」に足す（利用者が頼んだこと: 2026-11-15）。
 * これで、新しく開いたコマンドプロンプトで `claude` だけで起動できる。
 * - 入っていれば何もしない。今の PATH の中身は消さずに、いちばん後ろに足すだけ。
 * - setx は 1024 文字で切れるので使わない。レジストリを %〇〇% のまま読み、同じ種類（REG_EXPAND_SZ）で書き戻す。
 * - 書いたあと、Windows に「環境変数が変わった」と知らせる（新しく開くウィンドウに反映される）。
 * @returns {"added" | "already" | "skipped" | string} string はエラーの内容
 */
export function ensureClaudeInUserPath() {
  if (process.platform !== "win32") return "skipped";
  const dir = path.join(os.homedir(), ".local", "bin");
  if (!fs.existsSync(path.join(dir, "claude.exe"))) return "skipped";
  const expand = (s) => s.replace(/%([^%]+)%/g, (_, v) => process.env[v] ?? `%${v}%`);
  if (pathHas(regPath("HKCU\\Environment"), dir, expand)) return "already";
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    `$dir = '${dir.replace(/'/g, "''")}'`,
    "$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)",
    "$v = [string]$k.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)",
    "$parts = @($v -split ';' | Where-Object { $_ -ne '' })",
    "if ($parts | Where-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\\') -ieq $dir }) { 'already'; exit }",
    "$k.SetValue('Path', (($parts + $dir) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)",
    "$k.Close()",
    // 変わったことを Windows に知らせる（ダミーの変数を作って消すと、知らせが届く）
    "[Environment]::SetEnvironmentVariable('DIMY_PATH_NOTIFY', '1', 'User')",
    "[Environment]::SetEnvironmentVariable('DIMY_PATH_NOTIFY', $null, 'User')",
    "'added'",
  ].join("\n");
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(ps, "utf16le").toString("base64")], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20_000,
    });
    return out.includes("already") ? "already" : out.includes("added") ? "added" : `想定外の結果: ${out.trim().slice(0, 200)}`;
  } catch (e) {
    return e instanceof Error ? e.message.slice(0, 300) : String(e);
  }
}
