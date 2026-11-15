// 気象庁の天気予報（公式・無料。Yahoo!天気やテレビの予報と同じもとになる予報）。
// 画面（Vercel のサーバー側 /api/weather/*）と、PC の DIMY（MCP の道具 weather_forecast）の両方から使う。
// - 地域: 気象庁の地域の一覧（area.json）から、市区町村の名前で探す（class20 → class15 → class10 → 府県予報区 office）
// - 予報: forecast/<office>.json の、今日・明日・あさって（天気の文・降水確率・最低 / 最高気温）と、1 週間
// 気象庁の JSON の形が変わったときに困らないよう、読めないところは空にして、読めたところだけ返す。

const BASE = "https://www.jma.go.jp/bosai";

async function getJson(url) {
  const res = await fetch(url, { headers: { "user-agent": "DIMY (personal assistant)" } });
  if (!res.ok) throw new Error(`気象庁のデータを取れませんでした（${res.status}）`);
  return res.json();
}

let areaCache = null;
async function areas() {
  areaCache ??= await getJson(`${BASE}/common/const/area.json`);
  return areaCache;
}

/**
 * 市区町村などの名前から、気象庁の地域を探す（例: 「横浜市」「神奈川県 横浜市」）。
 * @returns {Promise<{ office: string, officeName: string, class10: string, class10Name: string, name: string } | null>}
 */
export async function findJmaArea(query) {
  const a = await areas();
  const words = String(query).split(/[\s　]+/).filter(Boolean);
  const want = words[words.length - 1] ?? "";
  if (!want) return null;
  const pref = words.length > 1 ? words[0] : "";
  const up = (code, level) => a[level]?.[code];
  const chain = (c20code) => {
    const c20 = a.class20s[c20code];
    const c15 = up(c20.parent, "class15s");
    const c10 = c15 && up(c15.parent, "class10s");
    const off = c10 && up(c10.parent, "offices");
    if (!off) return null;
    return { office: c10.parent, officeName: off.name, class10: c15.parent, class10Name: c10.name, name: c20.name };
  };
  const hits = Object.entries(a.class20s ?? {}).filter(([, v]) => v.name === want || v.name.startsWith(want) || want.startsWith(v.name));
  for (const [code] of hits) {
    const c = chain(code);
    if (c && (!pref || c.officeName.startsWith(pref.replace(/[都道府県]$/, "")))) return c;
  }
  return hits.length ? chain(hits[0][0]) : null;
}

/** 気象庁の天気コード（100 番台 = 晴れ、200 = くもり、300 = 雨、400 = 雪）を、画面の天気のアイコン（WMO の番号）に合わせる */
export function jmaToWmo(code) {
  const c = Number(code);
  const head = Math.floor(c / 100);
  if (head === 1) return c === 100 ? 0 : 2;
  if (head === 2) return 3;
  if (head === 3) return 61;
  if (head === 4) return 71;
  return 3;
}

/**
 * 予報を読む。
 * @returns {Promise<{ office: string, area: string, reportedAt: string, days: { date: string, weather: string, code: string, wmo: number, pops: (number|null)[], pop: number|null, min: number|null, max: number|null }[], week: { date: string, code: string, wmo: number, pop: number|null, min: number|null, max: number|null }[] }>}
 */
export async function fetchJmaForecast({ office, class10 }) {
  const json = await getJson(`${BASE}/forecast/data/forecast/${office}.json`);
  const [short, week] = json;
  const num = (v) => (v === "" || v === undefined || v === null || Number.isNaN(Number(v)) ? null : Number(v));
  const pick = (ts) => ts?.areas?.find((x) => x.area?.code === class10) ?? ts?.areas?.[0];

  // 今日・明日・あさって（天気の文）
  const ts0 = short?.timeSeries?.[0];
  const a0 = pick(ts0);
  const byDate = new Map();
  (ts0?.timeDefines ?? []).forEach((t, i) => {
    const date = t.slice(0, 10);
    byDate.set(date, { date, weather: (a0?.weathers?.[i] ?? "").replace(/\s+/g, " "), code: a0?.weatherCodes?.[i] ?? "", pops: [], min: null, max: null });
  });
  // 降水確率（6 時間ごと）
  const ts1 = short?.timeSeries?.[1];
  const a1 = pick(ts1);
  (ts1?.timeDefines ?? []).forEach((t, i) => {
    const d = byDate.get(t.slice(0, 10));
    if (d) d.pops.push(num(a1?.pops?.[i]));
  });
  // 気温（観測地点ごと。00 時 = 朝の最低、09 時 = 日中の最高。いちばん初めの地点を使う）
  const ts2 = short?.timeSeries?.[2];
  const a2 = ts2?.areas?.[0];
  (ts2?.timeDefines ?? []).forEach((t, i) => {
    const d = byDate.get(t.slice(0, 10));
    const v = num(a2?.temps?.[i]);
    if (!d || v === null) return;
    if (t.slice(11, 13) === "00") d.min = v;
    else d.max = v;
  });
  const days = [...byDate.values()].map((d) => {
    const ps = d.pops.filter((p) => p !== null);
    return { ...d, wmo: jmaToWmo(d.code), pop: ps.length ? Math.max(...ps) : null };
  });

  // 1 週間
  const w0 = week?.timeSeries?.[0];
  const wa = w0?.areas?.[0];
  const w1 = week?.timeSeries?.[1];
  const wt = w1?.areas?.[0];
  const weekDays = (w0?.timeDefines ?? []).map((t, i) => ({
    date: t.slice(0, 10),
    code: wa?.weatherCodes?.[i] ?? "",
    wmo: jmaToWmo(wa?.weatherCodes?.[i]),
    pop: num(wa?.pops?.[i]),
    min: num(wt?.tempsMin?.[i]),
    max: num(wt?.tempsMax?.[i]),
  }));

  return {
    office: short?.publishingOffice ?? "",
    area: a0?.area?.name ?? "",
    reportedAt: short?.reportDatetime ?? "",
    days,
    week: weekDays,
  };
}

/** Yahoo!天気で、その地域を探すページ */
export function yahooWeatherUrl(name) {
  const word = String(name).split(/[\s　]+/).filter(Boolean).pop() ?? "";
  return `https://weather.yahoo.co.jp/weather/search/?p=${encodeURIComponent(word)}`;
}
