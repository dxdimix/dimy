#!/usr/bin/env node
// クラウドの開発用セッションから、DIMY の記録を読む・PC の DIMY に再起動を頼む（supabase/migrations/20261115500000_maintenance.sql の窓口）。
// 使い方:
//   node scripts/maint.mjs read <messages|agent_logs|activity_log|pc_commands|pc_state> [件数]
//   node scripts/maint.mjs restart        … PC の DIMY に「再起動して最新にして」と頼み、結果を待つ
//   node scripts/maint.mjs read notes      … 覚えていること（使っていないものも。id 付き）
//   node scripts/maint.mjs read feedback   … 返事への評価（GOOD / BAD と、その返事・発言）
//   node scripts/maint.mjs note-add <style|fact|rule> <中身>
//   node scripts/maint.mjs note-edit <id> <中身> [style|fact|rule]
//   node scripts/maint.mjs note-off <id> / note-on <id>   … 使わないようにする / 戻す（消さない）
//   node scripts/maint.mjs screenshot [保存先.jpg]   … 開いているディミの画面の写真を撮ってもらい、保存する（拡張機能が必要）
// 必要な環境変数（秘密ではない）: DIMY_MAINT_URL（Supabase の URL）、DIMY_MAINT_ANON（publishable キー）
// 合言葉（dimy-maint-key）は、この環境の通信の仕組み（ネットワークの秘密の保存）が自動で付ける。ここには書かない。

import fs from "node:fs";
import { spawnSync } from "node:child_process";

// クラウドの作業環境では、通信が中継（HTTPS_PROXY）を通る。Node の fetch は中継を使う設定が要るので、付けて起動し直す
if (process.env.HTTPS_PROXY && process.env.NODE_USE_ENV_PROXY !== "1") {
  const r = spawnSync(process.execPath, ["--no-warnings", ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } });
  process.exit(r.status ?? 1);
}

const url = (process.env.DIMY_MAINT_URL || "").replace(/\/+$/, "");
const anon = process.env.DIMY_MAINT_ANON || "";
if (!url || !anon) {
  console.error("DIMY_MAINT_URL と DIMY_MAINT_ANON を設定してください。");
  process.exit(1);
}
const headers = { apikey: anon, authorization: `Bearer ${anon}`, "content-type": "application/json" };
const rpc = async (fn, body) => {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return JSON.parse(text);
};
const time = (iso) => new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" });

const [cmd, what, n] = process.argv.slice(2);
try {
  if (cmd === "read") {
    const rows = await rpc("dimy_maint_read", { p_what: what, p_limit: Number(n) || 50 });
    for (const r of rows) {
      if (what === "messages") console.log(`[${time(r.created_at)}] ${r.role === "user" ? "あなた" : "DIMY"}（${r.status}）${r.error ? ` エラー: ${r.error}` : ""}\n  ${String(r.content).replace(/\n/g, "\n  ")}`);
      else if (what === "agent_logs") console.log(`[${time(r.created_at)}] ${r.level === "error" ? "エラー " : ""}${r.message}`);
      else if (what === "activity_log") console.log(`[${time(r.created_at)}] ${r.kind}: ${r.detail}（${r.device}）`);
      else if (what === "notes") console.log(`${r.active ? "◯" : "×（使っていない）"} [${r.kind}] ${r.content}\n    id=${r.id}  ${r.source === "kymis" ? "DIMY が書いた" : "利用者"}・${time(r.updated_at)}`);
      else if (what === "feedback") console.log(`[${time(r.created_at)}] ${r.rating > 0 ? "GOOD" : "BAD"}${r.comment ? `（${r.comment}）` : ""}\n  発言: ${r.question ?? ""}\n  返事: ${String(r.reply).replace(/\n/g, " ")}`);
      else if (what === "pc_commands") console.log(`[${time(r.created_at)}] ${r.kind} ${JSON.stringify(r.payload)} → ${r.status}${r.result ? `: ${r.result}` : ""}`);
      else console.log(JSON.stringify(r, null, 2));
    }
    if (!rows.length) console.log("（記録はありません）");
  } else if (cmd === "note-add") {
    const [, kind, ...rest] = process.argv.slice(2);
    console.log(`足しました: ${await rpc("dimy_maint_note", { p_action: "add", p_kind: kind, p_content: rest.join(" ") })}`);
  } else if (cmd === "note-edit") {
    const [, id, content, kind] = process.argv.slice(2);
    console.log(`直しました: ${await rpc("dimy_maint_note", { p_action: "update", p_id: id, p_content: content, p_kind: kind ?? null })}`);
  } else if (cmd === "note-off" || cmd === "note-on") {
    console.log(`${cmd === "note-off" ? "使わないようにしました" : "戻しました"}: ${await rpc("dimy_maint_note", { p_action: cmd === "note-off" ? "off" : "on", p_id: what })}`);
  } else if (cmd === "restart") {
    const id = await rpc("dimy_maint_command", { p_kind: "restart" });
    console.log(`再起動を頼みました（${id}）。返事を待っています…`);
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const rows = await rpc("dimy_maint_read", { p_what: "pc_commands", p_limit: 20 });
      const row = rows.find((r) => r.id === id);
      if (row && row.status !== "pending") {
        console.log(`PC の DIMY: ${row.status}${row.result ? `（${row.result}）` : ""}`);
        process.exit(0);
      }
    }
    console.log("60 秒待ちましたが、PC の DIMY から返事がありません（PC が止まっているか、古い版の可能性）。");
  } else if (cmd === "screenshot") {
    const file = what || "dimy-screen.jpg";
    const id = await rpc("dimy_maint_screenshot", {});
    console.log(`画面の写真を頼みました（${id}）。待っています…`);
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const row = await rpc("dimy_maint_screenshot_get", { p_id: id });
      if (row?.status === "done" && row.image) {
        fs.writeFileSync(file, Buffer.from(String(row.image).replace(/^data:image\/\w+;base64,/, ""), "base64"));
        console.log(`保存しました: ${file}（画面の大きさ ${row.note ?? "不明"}）`);
        process.exit(0);
      }
      if (row?.status === "error") {
        console.log(`撮れませんでした: ${row.note}`);
        process.exit(1);
      }
    }
    console.log("30 秒待ちましたが、写真が届きません（ディミの画面が開いていない・見えていない、または拡張機能がない可能性）。");
    process.exit(1);
  } else {
    console.log("使い方: node scripts/maint.mjs read <messages|agent_logs|activity_log|pc_commands|pc_state> [件数] / node scripts/maint.mjs restart");
  }
} catch (e) {
  console.error(`失敗しました: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
