import { describe, expect, it } from "vitest";
import { TOOLS, handle as rawHandle } from "../agent/tools/mcp-server.mjs";

type Res = { result?: { serverInfo?: { name: string }; tools?: { name: string }[] }; error?: { message: string } } | null;
const handle = async (msg: object) => (await rawHandle(msg)) as Res;

describe("ディミの道具（MCP サーバー）", () => {
  it("初期化と道具の一覧に答える", async () => {
    const init = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect(init?.result?.serverInfo?.name).toBe("dimy");
    const list = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(list?.result?.tools?.map((t) => t.name)).toEqual([
      "show_card",
      "weather_forecast",
      "calendar_events",
      "calendar_add",
      "chrome_accounts",
      "open_in_chrome",
      "claude_sessions",
      "open_claude_session",
      "app_list",
      "app_tables",
      "app_columns",
      "app_read",
      "app_count",
      "memory_list",
      "memory_add",
    ]);
  });

  it("通知には返事をしない", async () => {
    expect(await handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });

  it("app_read の引数を、読み取りのコマンドに直す", () => {
    const read = TOOLS.find((t) => t.name === "app_read")!;
    expect(
      read.argv!({ app: "fx", table: "jfx_runs", order: "started_at.desc", limit: 5, where: ["status=eq.error"] }),
    ).toEqual(["read", "fx", "jfx_runs", "--order", "started_at.desc", "--limit", "5", "--where", "status=eq.error"]);
  });

  it("知らない道具はエラーにする", async () => {
    const res = await handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "delete_rows", arguments: {} } });
    expect(res?.error?.message).toContain("知らない道具");
  });
});

import { normalizeCard } from "../agent/tools/cards.mjs";

describe("カードの中身を整える", () => {
  it("一覧・要点・動画", () => {
    expect(normalizeCard({ kind: "list", title: "今日のニュース", items: [{ title: "見出し", url: "https://example.com/a" }, { title: "" }] })).toEqual({
      kind: "list",
      title: "今日のニュース",
      data: { items: [{ title: "見出し", url: "https://example.com/a", note: undefined, image: undefined }] },
    });
    expect(normalizeCard({ kind: "points", title: "手順", points: ["a", "b"], style: "steps" }).data).toEqual({ points: ["a", "b"], style: "steps" });
    expect(() => normalizeCard({ kind: "video", title: "x", url: "javascript:alert(1)" })).toThrow("url");
    expect(() => normalizeCard({ kind: "bad", title: "x" })).toThrow("kind");
  });
});

import { pageImageFromHtml } from "../agent/tools/cards.mjs";

describe("カードの写真と数字", () => {
  it("ページの見出し画像を取り出す", () => {
    const html = `<head><meta name="twitter:image" content="/b.jpg"><meta content="https://img.example.com/a.jpg?x=1&amp;y=2" property="og:image"></head>`;
    expect(pageImageFromHtml(html, "https://news.example.com/news/x")).toBe("https://img.example.com/a.jpg?x=1&y=2");
    expect(pageImageFromHtml(`<meta name="twitter:image" content="/b.jpg">`, "https://news.example.com/x/y")).toBe("https://news.example.com/b.jpg");
    expect(pageImageFromHtml("<meta charset=utf-8>", "https://e.com")).toBeUndefined();
  });
  it("数字のカード", () => {
    expect(normalizeCard({ kind: "stats", title: "市場", stats: [{ label: "日経平均", value: "38,500", unit: "円" }, { label: "", value: "1" }] }).data).toEqual({
      stats: [{ label: "日経平均", value: "38,500", unit: "円" }],
    });
  });
});

describe("地図のカード", () => {
  it("query がなければ名前で探す", () => {
    expect(normalizeCard({ kind: "map", title: "キャンプ場", places: [{ name: "砂川公園", query: "砂川公園 総社市" }, { name: "高間キャンプ場" }, { name: "" }] }).data).toEqual({
      places: [
        { name: "砂川公園", query: "砂川公園 総社市", note: undefined },
        { name: "高間キャンプ場", query: "高間キャンプ場", note: undefined },
      ],
    });
  });
});

describe("カードをまとめて出す", () => {
  it("show_card は kind なしでも cards で呼べる", () => {
    const t = TOOLS.find((x) => x.name === "show_card")!;
    expect(t.inputSchema.required).toEqual([]);
    expect(Object.keys(t.inputSchema.properties)).toContain("cards");
  });
});

describe("施設のカード", () => {
  it("営業時間・料金・特徴を整え、地図の言葉を作る", () => {
    const c = normalizeCard({ kind: "place", title: "経ヶ丸オートキャンプ場", area: "井原市", hours: "9:00〜17:00", prices: [{ label: "オートサイト", value: "4,000円" }, { label: "" }], points: ["80m 滑り台"] });
    expect(c.data.query).toBe("経ヶ丸オートキャンプ場 井原市");
    expect(c.data.prices).toEqual([{ label: "オートサイト", value: "4,000円" }]);
    expect(c.data.points).toEqual(["80m 滑り台"]);
    expect(() => normalizeCard({ kind: "place", title: "" })).toThrow("title");
  });
});

import { commonsResults } from "../agent/tools/cards.mjs";

describe("写真と道順のカード", () => {
  it("言葉で探す写真・道順の出発地", () => {
    expect(normalizeCard({ kind: "image", title: "景色", query: "瀬戸大橋", count: 9 }).data).toEqual({ query: "瀬戸大橋", count: 4 });
    expect(() => normalizeCard({ kind: "image", title: "x" })).toThrow("query");
    expect(normalizeCard({ kind: "map", title: "道順", places: [{ name: "鷲羽山", from: "総社市" }] }).data.places[0].from).toBe("総社市");
    expect(normalizeCard({ kind: "web", title: "公式", url: "https://example.com" }).data).toEqual({ url: "https://example.com" });
  });
  it("Wikimedia Commons の答えから写真だけを取り出す", () => {
    const json = { query: { pages: {
      "2": { index: 2, title: "File:B.png", imageinfo: [{ mime: "image/png", thumburl: "https://u/b.png", descriptionurl: "https://p/b" }] },
      "1": { index: 1, title: "File:A.jpg", imageinfo: [{ mime: "image/jpeg", thumburl: "https://u/a.jpg", descriptionurl: "https://p/a" }] },
      "3": { index: 3, title: "File:C.svg", imageinfo: [{ mime: "image/svg+xml", url: "https://u/c.svg" }] },
    } } };
    expect(commonsResults(json, 4)).toEqual([
      { url: "https://u/a.jpg", title: "A", page: "https://p/a" },
      { url: "https://u/b.png", title: "B", page: "https://p/b" },
    ]);
  });
});

describe("話に合わせて出す言葉", () => {
  it("say を残す", () => {
    expect(normalizeCard({ kind: "stats", title: "料金", say: "料金", stats: [{ label: "小学生", value: "3,200", unit: "円" }] }).data.say).toBe("料金");
  });
});

describe("どのカードにも写真", () => {
  it("数字のカードにも写真の URL を残す", () => {
    expect(normalizeCard({ kind: "stats", title: "料金", image: "https://e.com/a.jpg", stats: [{ label: "大人", value: "1" }] }).data.image).toBe("https://e.com/a.jpg");
    expect(normalizeCard({ kind: "points", title: "x", image: "javascript:1", points: ["a"] }).data.image).toBeUndefined();
  });
});
