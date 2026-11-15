// DIMY の道具: 天気予報（気象庁）。地域は、画面の設定（表 user_settings の prefs の weatherPlace）を使う。
import { fetchJmaForecast, findJmaArea, yahooWeatherUrl } from "../lib/jma.mjs";
import { readUserSetting } from "./settings.mjs";

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
const label = (date) => {
  const d = new Date(`${date}T00:00:00+09:00`);
  return `${d.getUTCMonth() + 1}月${new Date(`${date}T12:00:00+09:00`).getUTCDate()}日（${WEEK[new Date(`${date}T12:00:00+09:00`).getUTCDay()]}）`;
};

export async function weatherForecast({ place } = {}) {
  let name = place;
  if (!name) {
    const prefs = (await readUserSetting("prefs")) ?? {};
    try {
      name = JSON.parse(prefs.weatherPlace ?? "null")?.name;
    } catch {}
  }
  if (!name) return "天気の地域が決まっていません。画面の設定 →「表示」→「天気の地域」で決めてもらってください。";
  const area = await findJmaArea(name);
  if (!area) return `気象庁の地域に「${name}」が見つかりませんでした。`;
  const f = await fetchJmaForecast(area);
  const lines = [`地域: ${name}（気象庁「${area.officeName} ${area.class10Name}」の予報。発表: ${f.office}）`];
  for (const d of f.days.slice(0, 2)) {
    const temp = [d.min !== null ? `最低 ${d.min}℃` : "", d.max !== null ? `最高 ${d.max}℃` : ""].filter(Boolean).join("・");
    lines.push(`${label(d.date)}: ${d.weather}${temp ? `／${temp}` : ""}${d.pop !== null ? `／降水確率 最大 ${d.pop}%` : ""}`);
  }
  lines.push(`Yahoo!天気（同じ地域）: ${yahooWeatherUrl(name)}`);
  return lines.join("\n");
}
