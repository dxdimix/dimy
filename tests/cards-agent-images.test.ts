import { describe, expect, it } from "vitest";
import { isTitleOnlyImage, pageImageFromHtml } from "../agent/tools/cards.mjs";

describe("isTitleOnlyImage", () => {
  it("ロゴ・OGP の共通画像は使わない", () => {
    expect(isTitleOnlyImage("https://s.yimg.jp/images/weather/general/ogp_weather.png", "https://weather.yahoo.co.jp/weather/jp/33/6610/33208.html")).toBe(true);
    expect(isTitleOnlyImage("https://static.tenki.jp/images/logo/tenkijp.png")).toBe(true);
  });
  it("サイトのトップの見出し画像は使わない", () => {
    expect(isTitleOnlyImage("https://example.com/img/a.jpg", "https://weathernews.jp/")).toBe(true);
    expect(isTitleOnlyImage("https://example.com/img/a.jpg", "https://example.com/forecast")).toBe(true);
  });
  it("記事の写真は使う", () => {
    expect(isTitleOnlyImage("https://news.example.com/photo/12345.jpg", "https://news.example.com/articles/2026/11/17/12345")).toBe(false);
  });
  it("pageImageFromHtml もタイトルだけの画像を返さない", () => {
    const html = '<meta property="og:image" content="https://example.com/ogp.png">';
    expect(pageImageFromHtml(html, "https://example.com/a/b/c/123")).toBeUndefined();
  });
});
