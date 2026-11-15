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
