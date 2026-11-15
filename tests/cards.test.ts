import { describe, expect, it } from "vitest";
import { builtinCardsFor, youtubeEmbed } from "../src/lib/cards";

describe("画面のカード", () => {
  it("言葉から、すぐ出すカードを決める", () => {
    expect(builtinCardsFor("おはよう")).toEqual(["weather", "date"]);
    expect(builtinCardsFor("明日の天気は？")).toEqual(["weather"]);
    expect(builtinCardsFor("今日は何曜日")).toEqual(["date"]);
    expect(builtinCardsFor("今日の予定を教えて")).toEqual(["schedule"]);
    expect(builtinCardsFor("FXの損益は")).toEqual([]);
  });
  it("YouTube の URL を埋め込みの形にする", () => {
    expect(youtubeEmbed("https://www.youtube.com/watch?v=abcdEFG1234")).toBe("https://www.youtube.com/embed/abcdEFG1234");
    expect(youtubeEmbed("https://youtu.be/abcdEFG1234")).toBe("https://www.youtube.com/embed/abcdEFG1234");
    expect(youtubeEmbed("https://example.com/watch?v=abc")).toBeNull();
  });
});

import { emphasize } from "../src/lib/cards";

describe("強調", () => {
  it("**で囲んだところと数字を強調する", () => {
    expect(emphasize("最高 **18°** で降水確率 30% です")).toEqual([
      { text: "最高 ", strong: false },
      { text: "18°", strong: true },
      { text: " で降水確率 ", strong: false },
      { text: "30%", strong: true },
      { text: " です", strong: false },
    ]);
    expect(emphasize("数字なし")).toEqual([{ text: "数字なし", strong: false }]);
  });
});

import { mapEmbedUrl, mapOpenUrl } from "../src/lib/cards";

describe("地図", () => {
  it("Google マップの URL", () => {
    expect(mapEmbedUrl("砂川公園 総社市")).toBe("https://maps.google.com/maps?q=%E7%A0%82%E5%B7%9D%E5%85%AC%E5%9C%92%20%E7%B7%8F%E7%A4%BE%E5%B8%82&z=14&hl=ja&output=embed");
    expect(mapOpenUrl("a b")).toBe("https://www.google.com/maps/search/?api=1&query=a%20b");
  });
});

import { snapshotCards } from "../src/lib/cards";

describe("会話の控え", () => {
  it("呼び出した会話のカードとピンは残さない", () => {
    const c = (id: string, kind: "list" | "talk", pinned: boolean) => ({ id, kind, title: id, data: {}, pinned, at: 0 });
    expect(snapshotCards([c("a", "list", true), c("b", "talk", false)])).toEqual([c("a", "list", false)]);
  });
});

import { splitColumns } from "../src/lib/cards";

describe("左右の列", () => {
  it("取り出したカードは離した側の上、ほかは右・左の互い違い", () => {
    const c = (id: string, side?: "left" | "right") => ({ id, kind: "text" as const, title: id, data: {}, pinned: false, at: 0, side });
    const r = splitColumns([c("a"), c("b"), c("c"), c("x", "left"), c("y", "left")]);
    expect(r.right.map((x) => x.id)).toEqual(["a", "c"]);
    expect(r.left.map((x) => x.id)).toEqual(["y", "x", "b"]);
  });
});
