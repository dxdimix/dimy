"use client";

// 天気の詳細（右下の天気を押すと開く）。これから 36 時間の 1 時間ごと（Open-Meteo）と、おととい〜7 日後の日ごと（気象庁を選んでいれば気象庁の予報を重ねる）。
// 右上の「Yahoo!天気」で、その地域の Yahoo!天気のページを開く。

import { useEffect, useState } from "react";
import { fetchForecast, fetchJma, weatherLabel, yahooWeatherUrl, type Forecast, type JmaResult, type Place, type WeatherSource } from "@/lib/weather";
import { CloseIcon, ExternalIcon, WeatherIcon } from "./Icons";
import { useDismiss } from "@/hooks/useDismiss";

const todayKey = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

function dayLabel(date: string) {
  const today = todayKey();
  const d = new Date(`${date}T00:00:00+09:00`);
  const diff = Math.round((d.getTime() - new Date(`${today}T00:00:00+09:00`).getTime()) / 86_400_000);
  const names: Record<number, string> = { [-2]: "おととい", [-1]: "昨日", 0: "今日", 1: "明日", 2: "あさって" };
  const md = d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short" });
  return { name: names[diff] ?? "", md, past: diff < 0, today: diff === 0 };
}

export function WeatherPanel({ place, source, onClose }: { place: Place; source: WeatherSource; onClose: () => void }) {
  const [data, setData] = useState<Forecast | null>(null);
  const [jma, setJma] = useState<JmaResult | null>(null);
  const [error, setError] = useState("");
  const ref = useDismiss<HTMLDivElement>(onClose); // 外をクリック・Esc で閉じる
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchForecast(place)
        .then((f) => alive && setData(f))
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
      // 日ごとの予報は気象庁（選んでいるとき）。取れなければ Open-Meteo のまま
      if (source === "jma")
        fetchJma(place)
          .then((j) => alive && setJma(j))
          .catch(() => alive && setJma(null));
    };
    load();
    const t = setInterval(load, 15 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [place, source]);

  // 気象庁の予報を、日ごとの行に重ねる（天気・最高 / 最低・降水確率。気象庁にない日は Open-Meteo のまま）
  const days = (data?.days ?? []).map((d) => {
    const j = jma?.forecast.days.find((x) => x.date === d.date);
    const w = jma?.forecast.week.find((x) => x.date === d.date);
    if (!j && !w) return { ...d, text: weatherLabel(d.code) };
    return {
      ...d,
      code: j?.wmo ?? w?.wmo ?? d.code,
      text: j?.weather || weatherLabel(j?.wmo ?? w?.wmo ?? d.code),
      max: j?.max ?? w?.max ?? d.max,
      min: j?.min ?? w?.min ?? d.min,
      rain: j?.pop ?? w?.pop ?? d.rain,
    };
  });
  const temps = days.flatMap((d) => [d.max, d.min]);
  const lo = Math.min(...temps);
  const hi = Math.max(...temps);
  const pct = (v: number) => (hi === lo ? 50 : ((v - lo) / (hi - lo)) * 100);

  return (
    <div ref={ref} className="dimy-fade-in absolute bottom-24 right-5 z-[860] w-[460px] max-w-[calc(100vw-2.5rem)] rounded-lg border border-cyan-400/30 bg-slate-950/[0.97] p-4 text-sm backdrop-blur">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <span className="font-mono text-xs tracking-[0.3em] text-cyan-300">WEATHER</span>
          <span className="ml-3 text-xs text-slate-400">{place.name}</span>
        </div>
        <a href={yahooWeatherUrl(place.name)} target="_blank" rel="noopener" className="ml-auto mr-3 flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-100" title="Yahoo!天気で、この地域の天気を開く">
          <ExternalIcon className="h-3.5 w-3.5" />
          Yahoo!天気
        </a>
        <button onClick={onClose} aria-label="閉じる" className="text-cyan-400 hover:text-cyan-100">
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      {!data && !error && <p className="text-xs text-slate-400">読み込んでいます…</p>}
      {data && (
        <>
          {/* 1 時間ごと（横にスクロール） */}
          <div className="dimy-caption -mx-1 flex gap-1 overflow-x-auto pb-2">
            {data.hours.map((h, i) => {
              const hour = Number(h.time.slice(11, 13));
              return (
                <div key={h.time} className={"flex w-12 shrink-0 flex-col items-center rounded py-1.5 " + (i === 0 ? "bg-cyan-400/10" : "")}>
                  <span className="font-mono text-[10px] text-slate-400">{i === 0 ? "今" : hour === 0 ? `${Number(h.time.slice(8, 10))}日` : `${hour}時`}</span>
                  <WeatherIcon code={h.code} className="my-1 h-5 w-5 text-cyan-300" />
                  <span className="font-mono text-xs text-cyan-100">{Math.round(h.temperature)}°</span>
                  <span className="font-mono text-[10px] text-sky-300/80">{h.rain ?? "-"}%</span>
                </div>
              );
            })}
          </div>
          {/* 日ごと */}
          <div className="mt-2 space-y-0.5">
            {days.map((d) => {
              const l = dayLabel(d.date);
              return (
                <div
                  key={d.date}
                  title={`${d.text} 日の出 ${d.sunrise.slice(11)} 日の入り ${d.sunset.slice(11)}`}
                  className={"grid grid-cols-[6.5rem_1.5rem_1fr_2.5rem] items-center gap-2 rounded px-2 py-1 " + (l.today ? "bg-cyan-400/10" : "") + (l.past ? " opacity-55" : "")}
                >
                  <span className="truncate text-xs">
                    <span className="text-cyan-100">{l.md}</span>
                    {l.name && <span className="ml-1 text-slate-400">{l.name}</span>}
                  </span>
                  <WeatherIcon code={d.code} className="h-5 w-5 text-cyan-300" />
                  {/* 最低〜最高の幅を、期間全体の気温の中で見せる */}
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="w-7 text-right text-sky-300">{Math.round(d.min)}°</span>
                    <div className="relative h-1 flex-1 rounded bg-slate-800">
                      <div
                        className="absolute h-1 rounded bg-gradient-to-r from-sky-400 to-amber-300"
                        style={{ left: `${pct(d.min)}%`, width: `${Math.max(2, pct(d.max) - pct(d.min))}%` }}
                      />
                    </div>
                    <span className="w-7 text-amber-200">{Math.round(d.max)}°</span>
                  </div>
                  <span className="text-right font-mono text-[11px] text-sky-300/80">{d.rain ?? "-"}%</span>
                </div>
              );
            })}
          </div>
          {/* 今日・明日の予報の文（気象庁） */}
          {jma && jma.forecast.days.length > 0 && (
            <div className="mt-2 space-y-0.5 text-xs text-slate-300">
              {jma.forecast.days.slice(0, 2).map((d) => (
                <p key={d.date}>
                  <span className="text-cyan-200">{dayLabel(d.date).name || dayLabel(d.date).md}</span>：{d.weather}
                </p>
              ))}
            </div>
          )}
          <p className="mt-2 text-[10px] text-slate-500">
            {jma
              ? `日ごとの予報は気象庁（${jma.forecast.office}）、1 時間ごとは Open-Meteo。`
              : "予報は Open-Meteo。"}
            % は降水確率。行にマウスを乗せると、天気と日の出・日の入りが出ます。
          </p>
        </>
      )}
    </div>
  );
}
