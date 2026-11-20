import { describe, expect, it } from "vitest";
import { guessTicker, parseStooqCsv } from "../agent/lib/markets.mjs";
import { normalizeCard } from "../agent/tools/cards.mjs";

describe("株価のグラフ", () => {
  it("名前から ticker を推し量る", () => {
    expect(guessTicker("日経平均")).toBe("nikkei");
    expect(guessTicker("NYダウ")).toBe("dow");
    expect(guessTicker("S&P 500")).toBe("sp500");
    expect(guessTicker("ドル円")).toBe("usdjpy");
    expect(guessTicker("失業率")).toBeUndefined();
  });
  it("Stooq の CSV を読む", () => {
    const csv = "Date,Open,High,Low,Close,Volume\n2026-11-18,1,2,0.5,38500.5,100\n2026-11-19,1,2,0.5,38700,100\n";
    expect(parseStooqCsv(csv)).toEqual([{ date: "2026-11-18", close: 38500.5 }, { date: "2026-11-19", close: 38700 }]);
    expect(parseStooqCsv("No data")).toEqual([]);
  });
  it("数字のカードに ticker と推移を残す", () => {
    const c = normalizeCard({ kind: "stats", title: "市場", stats: [{ label: "日経平均", value: "38,700", change: "+0.5%" }, { label: "失業率", value: "2.5", unit: "%", series: [2.6, 2.5, 2.5] }] });
    expect(c.data.stats[0]).toMatchObject({ ticker: "nikkei", change: "+0.5%" });
    expect(c.data.stats[1].series).toEqual([2.6, 2.5, 2.5]);
  });
});
