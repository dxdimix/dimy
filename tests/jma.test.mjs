import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJmaForecast, findJmaArea, jmaToWmo, yahooWeatherUrl } from "../agent/lib/jma.mjs";

afterEach(() => vi.unstubAllGlobals());

// 気象庁の area.json / forecast.json と同じ形の、小さな見本
const AREA = {
  offices: { "140000": { name: "神奈川県" } },
  class10s: { "140010": { name: "東部", parent: "140000" } },
  class15s: { "140011": { name: "横浜・川崎", parent: "140010" } },
  class20s: { "1410000": { name: "横浜市", parent: "140011" }, "1413000": { name: "川崎市", parent: "140011" } },
};
const FORECAST = [
  {
    publishingOffice: "横浜地方気象台",
    reportDatetime: "2026-11-15T05:00:00+09:00",
    timeSeries: [
      {
        timeDefines: ["2026-11-15T05:00:00+09:00", "2026-11-16T00:00:00+09:00", "2026-11-17T00:00:00+09:00"],
        areas: [{ area: { name: "東部", code: "140010" }, weatherCodes: ["101", "300", "200"], weathers: ["晴れ　時々　くもり", "雨", "くもり"] }],
      },
      {
        timeDefines: ["2026-11-15T06:00:00+09:00", "2026-11-15T12:00:00+09:00", "2026-11-15T18:00:00+09:00", "2026-11-16T00:00:00+09:00", "2026-11-16T06:00:00+09:00"],
        areas: [{ area: { name: "東部", code: "140010" }, pops: ["10", "20", "0", "60", "80"] }],
      },
      {
        timeDefines: ["2026-11-15T09:00:00+09:00", "2026-11-16T00:00:00+09:00", "2026-11-16T09:00:00+09:00"],
        areas: [{ area: { name: "横浜", code: "46106" }, temps: ["18", "11", "15"] }],
      },
    ],
  },
  {
    timeSeries: [
      { timeDefines: ["2026-11-16T00:00:00+09:00", "2026-11-17T00:00:00+09:00"], areas: [{ area: { code: "140000" }, weatherCodes: ["300", "101"], pops: ["", "20"] }] },
      { timeDefines: ["2026-11-16T00:00:00+09:00", "2026-11-17T00:00:00+09:00"], areas: [{ area: { code: "46106" }, tempsMin: ["", "9"], tempsMax: ["", "17"] }] },
    ],
  },
];

describe("気象庁の予報", () => {
  it("市区町村の名前から地域を探す", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(AREA)));
    expect(await findJmaArea("神奈川県 横浜市")).toEqual({ office: "140000", officeName: "神奈川県", class10: "140010", class10Name: "東部", name: "横浜市" });
  });
  it("今日・明日の天気・降水確率・気温と、1 週間を読む", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(FORECAST)));
    const f = await fetchJmaForecast({ office: "140000", class10: "140010" });
    expect(f.office).toBe("横浜地方気象台");
    expect(f.days[0]).toMatchObject({ date: "2026-11-15", weather: "晴れ 時々 くもり", pop: 20, min: null, max: 18, wmo: 2 });
    expect(f.days[1]).toMatchObject({ date: "2026-11-16", weather: "雨", pop: 80, min: 11, max: 15, wmo: 61 });
    expect(f.week[1]).toMatchObject({ date: "2026-11-17", pop: 20, min: 9, max: 17 });
  });
  it("天気コードとリンク", () => {
    expect(jmaToWmo("100")).toBe(0);
    expect(jmaToWmo("402")).toBe(71);
    expect(yahooWeatherUrl("神奈川県 横浜市")).toBe("https://weather.yahoo.co.jp/weather/search/?p=%E6%A8%AA%E6%B5%9C%E5%B8%82");
  });
});
