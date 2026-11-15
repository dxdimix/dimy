// 気象庁の天気予報（地域の名前で探して、その地域の予報を返す）。気象庁のデータを、画面の代わりに取りに行く。
import { fetchJmaForecast, findJmaArea, yahooWeatherUrl } from "../../../../../agent/lib/jma.mjs";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return Response.json({ error: "地域の名前（q）が必要です" }, { status: 400 });
  try {
    const area = await findJmaArea(q);
    if (!area) return Response.json({ error: `気象庁の地域に「${q}」が見つかりませんでした` }, { status: 404 });
    const forecast = await fetchJmaForecast(area);
    return Response.json(
      { area, forecast, yahoo: yahooWeatherUrl(q) },
      // 気象庁の予報は 1 日に数回しか変わらないので、10 分は同じものを使う
      { headers: { "cache-control": "public, s-maxage=600, stale-while-revalidate=600" } },
    );
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
