import { describe, expect, it } from "vitest";
import { describeScreens } from "../src/lib/screens";

const s = (x: number, y: number, w: number, h: number, isPrimary = false) => ({ availLeft: x, availTop: y, availWidth: w, availHeight: h, isPrimary });

describe("モニターの名前", () => {
  it("横に 3 枚、真ん中の上に 1 枚", () => {
    expect(describeScreens([s(-2048, 0, 2048, 1104), s(0, 0, 2048, 1104, true), s(0, -1080, 1920, 1032), s(2048, 0, 2048, 1104)])).toEqual([
      "左",
      "中央",
      "中央の上",
      "右",
    ]);
  });
  it("1 枚だけ・下の段・同じ名前", () => {
    expect(describeScreens([s(0, 0, 1920, 1080, true)])).toEqual(["このモニター"]);
    expect(describeScreens([s(0, 0, 1000, 1000, true), s(0, 1000, 500, 500), s(500, 1000, 500, 500)])).toEqual(["中央", "左の下", "右の下"]);
    expect(describeScreens([s(0, 0, 3000, 1000, true), s(0, 1000, 400, 400), s(400, 1000, 400, 400)])).toEqual(["中央", "左の下（2）", "左の下（3）"]);
  });
});
