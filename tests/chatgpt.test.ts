import { describe, expect, it } from "vitest";
import { chatgptUrl } from "../agent/lib/chatgpt.mjs";

describe("chatgptUrl", () => {
  it("質問をそのまま q に入れる", () => {
    expect(chatgptUrl("鷲羽山の営業時間は？")).toBe(`https://chatgpt.com/?q=${encodeURIComponent("鷲羽山の営業時間は？")}`);
  });
  it("DIMY への合図は渡さない", () => {
    expect(chatgptUrl("天気\n\n[DIMY への合図] 調べてから")).toBe(`https://chatgpt.com/?q=${encodeURIComponent("天気")}`);
  });
});
