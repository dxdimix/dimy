import { describe, expect, it } from "vitest";
import { chatgptUrl } from "../agent/lib/chatgpt.mjs";

describe("chatgptUrl", () => {
  it("質問をそのまま q に入れる", () => {
    expect(chatgptUrl("鷲羽山の営業時間は？")).toBe(`https://chatgpt.com/?q=${encodeURIComponent("鷲羽山の営業時間は？")}&dimy=1`);
  });
  it("DIMY への合図は渡さない", () => {
    expect(chatgptUrl("天気\n\n[DIMY への合図] 調べてから")).toBe(`https://chatgpt.com/?q=${encodeURIComponent("天気")}&dimy=1`);
  });
});

import { fallbackCard } from "../agent/lib/chatgpt.mjs";
describe("fallbackCard", () => {
  it("箇条書きの項目を要点にする", () => {
    const c = fallbackCard("月曜にやる気が出る方法", "コツは前日の夜に最初の一歩を軽くしておくことです。\n\n1. **朝は小さな作業から。** 勢いがつきます。\n2. **最初の仕事を決めておく。** 迷いません。");
    expect(c?.kind).toBe("points");
    expect(c?.data.points).toEqual(["朝は小さな作業から。 勢いがつきます。", "最初の仕事を決めておく。 迷いません。"]);
  });
  it("短い返事は出さない", () => {
    expect(fallbackCard("ありがとう", "どういたしまして。")).toBeNull();
  });
});
