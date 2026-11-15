import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { envFileHas, findApiKeyPlaces } from "../agent/lib/apikey-check.mjs";
import { safeEnv } from "../agent/lib/claude-session.mjs";

describe("API キーの確認", () => {
  it("場所の名前だけを返す（中身は返さない）", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "dimy-"));
    fs.mkdirSync(path.join(home, ".claude"));
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ env: { ANTHROPIC_API_KEY: "sk-ant-xxx" } }));
    const envFile = path.join(home, "app.env");
    fs.writeFileSync(envFile, "FOO=1\nANTHROPIC_API_KEY=sk-ant-yyy\n");
    const places = findApiKeyPlaces({ env: { ANTHROPIC_API_KEY: "sk-ant-zzz" }, home, extraEnvFiles: [envFile], reg: (k) => k === "HKCU\\Environment" });
    expect(places.join("\n")).not.toMatch(/sk-ant/);
    expect(places.length).toBe(5); // 起動時の環境変数・利用者の環境変数（2 つの名前）・settings.json・.env
    expect(findApiKeyPlaces({ env: {}, home: path.join(home, "none"), reg: () => false })).toEqual([]);
  });
  it(".env の行", () => {
    expect(envFileHas("ANTHROPIC_API_KEY=abc", "ANTHROPIC_API_KEY")).toBe(true);
    expect(envFileHas("ANTHROPIC_API_KEY=", "ANTHROPIC_API_KEY")).toBe(false);
    expect(envFileHas("# ANTHROPIC_API_KEY=abc", "ANTHROPIC_API_KEY")).toBe(false);
  });
  it("Claude Code に API キーを渡さない（サブスクのログインは残す）", () => {
    const e = safeEnv({ ANTHROPIC_API_KEY: "a", ANTHROPIC_AUTH_TOKEN: "b", CLAUDE_CODE_OAUTH_TOKEN: "c", PATH: "/bin" });
    expect(e).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: "c", PATH: "/bin" });
  });
});
