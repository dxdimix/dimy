import { describe, expect, it } from "vitest";
import { dropAsides, joinBlocks } from "../agent/lib/claude-session.mjs";

describe("ディミの独り言を読まない", () => {
  it("かっこ書きの独り言を取り除く", () => {
    expect(dropAsides("最新の情報を調べますね。）（答えはすでに文章でお話ししたので、書き足すことはありません。）")).toBe("最新の情報を調べますね。");
    expect(dropAsides("料金は 1,000 円（税込）です。")).toBe("料金は 1,000 円（税込）です。");
  });
  it("塊をつなぐときも取り除く", () => {
    expect(joinBlocks(["おもちゃ王国は玉野市にあります。", "（すでにお話ししたので書き足しません）"])).toBe("おもちゃ王国は玉野市にあります。");
  });
});
