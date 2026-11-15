"use client";

// 画面のカード（返事の中身を目でも見せる「ショーウィンドウ」）。
// - 球体の左右に互い違いに、大きく出す（1 枚目は右、2 枚目は左…）。球体には少しかかってよいが、下の字幕にはかけない
// - 離れた場所から見えるよう、文字は大きく、大事な数字は太く。文字だけでなく、写真・動画・天気マーク・図で見せる
// - 天気・日付・今日の予定は、画面が言葉からすぐ出す（PC の DIMY に聞かないので、返事は遅くならない）
// - 一覧（写真つき）・動画・数字・要点の図・ページ・画像・文は、DIMY が返事を書いたあとに出す（表 cards）
// - 各カードに「残す」（次の質問でも消えない）と「閉じる」。上に「すべて閉じる」
// - スマホなど幅の狭い画面では、上に 1 列で出す

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Card } from "@/lib/cards";
import { emphasize, mapEmbedUrl, mapOpenUrl, youtubeEmbed } from "@/lib/cards";
import { fetchForecast, fetchJma, weatherLabel, yahooWeatherUrl, type Forecast, type JmaResult, type Place, type Weather } from "@/lib/weather";
import { CloseIcon, ExternalIcon, PinIcon } from "./Icons";

const TZ = "Asia/Tokyo";

type Props = {
  cards: Card[];
  onClose: (id: string) => void;
  onPin: (id: string) => void;
  onCloseAll: () => void;
  /** リンクを開く（DIMY の外で開く決まりに合わせる） */
  onOpenLink: (url: string, title: string) => void;
  /** ページを固定ウィンドウで開く */
  onOpenPage: (url: string, title: string) => void;
  weather: Weather | null;
  place: Place | null;
  session: Session;
};

const NARROW = "(max-width: 767px)";
function useNarrow() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(NARROW);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

// 球体（直径 min(62vmin, 640px)）の中心から、カードの内側の端までの距離。球体の縁に少しかかる
const INNER = "min(22vmin, 230px)";
// 字幕（下から 8rem、高さ最大 7.5rem + 余白）にかからない高さ
const COLUMN_BASE: CSSProperties = { top: "6.5rem", maxHeight: "calc(100dvh - 6.5rem - 17.5rem)", width: `min(680px, calc(50% - ${INNER} - 80px))` };

export function Showcase(p: Props) {
  const narrow = useNarrow();
  if (!p.cards.length) return null;
  const column = (list: Card[], side: "left" | "right" | "top") => {
    const style: CSSProperties =
      side === "top"
        ? { top: "4.5rem", left: 12, right: 12, maxHeight: "45dvh" }
        : side === "right"
          ? { ...COLUMN_BASE, left: `calc(50% + ${INNER})` }
          : { ...COLUMN_BASE, right: `calc(50% + ${INNER})` };
    return (
      <div style={style} className="pointer-events-none absolute z-[700] flex flex-col gap-4 overflow-y-auto overscroll-contain pb-2 [scrollbar-width:thin]">
        {list.map((c) => (
          <CardView key={c.id} card={c} side={side === "left" ? "left" : "right"} {...p} />
        ))}
      </div>
    );
  };
  return (
    <>
      {narrow ? (
        column(p.cards, "top")
      ) : (
        <>
          {column(
            p.cards.filter((_, i) => i % 2 === 0),
            "right",
          )}
          {column(
            p.cards.filter((_, i) => i % 2 === 1),
            "left",
          )}
        </>
      )}
      <button
        onClick={p.onCloseAll}
        className={
          "absolute z-[710] rounded-full border border-cyan-400/40 bg-slate-950/85 px-4 py-1.5 text-sm text-cyan-100 backdrop-blur hover:border-cyan-300/80 " +
          (narrow ? "bottom-[17rem] right-3" : "left-1/2 top-[4.4rem] -translate-x-1/2")
        }
        title="出ているカードをすべて閉じる（残したものも閉じる）"
      >
        カードをすべて閉じる（{p.cards.length}）
      </button>
    </>
  );
}

/** 大事な数字と **〇〇** を太く、明るく */
function Emph({ text }: { text: string }) {
  return (
    <>
      {emphasize(text).map((s, i) =>
        s.strong ? (
          <strong key={i} className="font-bold text-white">
            {s.text}
          </strong>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/** 外の画像。読めなければ代わりの枠（サイトの名前）を出す */
function Photo({ src, alt, className }: { src?: string; alt: string; className: string }) {
  const [bad, setBad] = useState(false);
  if (!src || bad)
    return (
      <div className={className + " grid place-items-center bg-gradient-to-br from-cyan-900/60 via-slate-900 to-indigo-950 text-sm text-cyan-300/70"}>
        {host(alt)}
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element -- 外のサイトの画像をそのまま出す
  return <img src={src} alt={alt} referrerPolicy="no-referrer" loading="eager" onError={() => setBad(true)} className={className + " object-cover"} />;
}
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

function CardView({ card, side, onClose, onPin, onOpenLink, onOpenPage, weather, place, session }: Props & { card: Card; side: "left" | "right" }) {
  const head = { weather: "WEATHER", date: "DATE", schedule: "SCHEDULE", list: "NEWS", video: "VIDEO", points: "POINTS", page: "PAGE", image: "IMAGE", text: "NOTE", stats: "DATA", map: "MAP" }[card.kind];
  return (
    <div
      className={
        "pointer-events-auto shrink-0 rounded-xl border bg-slate-950/88 p-4 text-lg text-slate-100 shadow-[0_0_32px_rgba(34,211,238,0.18)] backdrop-blur " +
        (card.pinned ? "border-cyan-300/80" : "border-cyan-400/35") +
        (side === "right" ? " dimy-card-in-right" : " dimy-card-in-left")
      }
    >
      <div className="mb-3 flex items-center gap-3">
        <span className="font-mono text-xs tracking-[0.3em] text-cyan-400/80">{head}</span>
        <span className="min-w-0 flex-1 truncate text-xl font-semibold text-cyan-50">{card.title}</span>
        <button onClick={() => onPin(card.id)} title={card.pinned ? "残すのをやめる" : "残す（次の質問でも消えない）"} className={"p-1 " + (card.pinned ? "text-cyan-100" : "text-cyan-400/60 hover:text-cyan-100")}>
          <PinIcon className="h-5 w-5" />
        </button>
        <button onClick={() => onClose(card.id)} title="閉じる" className="p-1 text-cyan-400/70 hover:text-cyan-100">
          <CloseIcon className="h-6 w-6" />
        </button>
      </div>
      {card.kind === "weather" && <WeatherCard weather={weather} place={place} />}
      {card.kind === "date" && <DateCard />}
      {card.kind === "schedule" && <ScheduleCard session={session} />}
      {card.kind === "list" && <ListCard card={card} onOpenLink={onOpenLink} />}
      {card.kind === "map" && <MapCard card={card} onOpenLink={onOpenLink} />}
      {card.kind === "stats" && (
        <div className={"grid gap-3 " + ((card.data.stats?.length ?? 0) > 4 ? "grid-cols-3" : "grid-cols-2")}>
          {card.data.stats?.map((s, i) => (
            <div key={i} className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-2">
              <div className="truncate text-sm text-cyan-300/80">{s.label}</div>
              <div className="font-mono text-4xl font-bold leading-tight text-white">
                {s.value}
                {s.unit && <span className="ml-1 text-xl font-semibold text-cyan-200">{s.unit}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {card.kind === "points" && card.data.style === "steps" && (
        <ol className="relative space-y-3 pl-1">
          {card.data.points?.map((pt, i, all) => (
            <li key={i} className="relative flex gap-3">
              {i < all.length - 1 && <span className="absolute left-[17px] top-9 h-[calc(100%-1.5rem)] w-px bg-cyan-400/40" />}
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cyan-400/20 font-mono text-lg font-bold text-cyan-100 ring-1 ring-cyan-300/60">{i + 1}</span>
              <span className="pt-1 leading-snug">
                <Emph text={pt} />
              </span>
            </li>
          ))}
        </ol>
      )}
      {card.kind === "points" && card.data.style !== "steps" && (
        <ul className="space-y-2.5">
          {card.data.points?.map((pt, i) => (
            <li key={i} className="flex gap-3 leading-snug">
              <span className="mt-2.5 h-2.5 w-2.5 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.8)]" />
              <span>
                <Emph text={pt} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {card.kind === "text" && (
        <p className="whitespace-pre-wrap leading-relaxed">
          <Emph text={card.data.text ?? ""} />
        </p>
      )}
      {card.kind === "image" && card.data.url && <Photo src={card.data.url} alt={card.title} className="max-h-[60vh] w-full rounded-lg !object-contain" />}
      {card.kind === "video" && card.data.url && <VideoCard url={card.data.url} title={card.title} onOpenLink={onOpenLink} />}
      {card.kind === "page" && card.data.url && (
        <div className="space-y-3">
          {card.data.image && <Photo src={card.data.image} alt={card.data.url} className="aspect-video w-full rounded-lg" />}
          {card.data.note && (
            <p className="leading-snug">
              <Emph text={card.data.note} />
            </p>
          )}
          <div className="flex gap-2 text-base">
            <button onClick={() => onOpenPage(card.data.url!, card.title)} className="rounded-md border border-cyan-500/50 px-3 py-1.5 text-cyan-100 hover:bg-cyan-400/10">
              小窓で開く
            </button>
            <button onClick={() => onOpenLink(card.data.url!, card.title)} className="flex items-center gap-1.5 rounded-md border border-slate-600 px-3 py-1.5 hover:bg-slate-800">
              <ExternalIcon className="h-4 w-4" />
              Chrome で開く
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** ニュースなどの一覧。写真があれば、1 件目を大きく、残りを 2 列の写真つきで並べる */
function ListCard({ card, onOpenLink }: { card: Card; onOpenLink: (url: string, title: string) => void }) {
  const items = card.data.items ?? [];
  const open = (it: (typeof items)[number]) => it.url && onOpenLink(it.url, it.title);
  if (!items.some((it) => it.image))
    return (
      <ol className="space-y-2.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-3">
            <span className="w-6 shrink-0 text-right font-mono font-bold text-cyan-300">{i + 1}</span>
            <div className="min-w-0">
              <button onClick={() => open(it)} disabled={!it.url} className="text-left font-semibold leading-snug text-cyan-50 enabled:hover:underline">
                <Emph text={it.title} />
              </button>
              {it.note && (
                <p className="text-base leading-snug text-slate-300">
                  <Emph text={it.note} />
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    );
  const [first, ...rest] = items;
  return (
    <div className="space-y-3">
      <button onClick={() => open(first)} className="group block w-full text-left">
        <div className="relative overflow-hidden rounded-lg">
          <Photo src={first.image} alt={first.url ?? first.title} className="aspect-video w-full" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent p-3 pt-10">
            <div className="text-xl font-bold leading-snug text-white group-hover:underline">
              <Emph text={first.title} />
            </div>
            {first.note && (
              <div className="text-base leading-snug text-slate-200">
                <Emph text={first.note} />
              </div>
            )}
          </div>
        </div>
      </button>
      {rest.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {rest.map((it, i) => (
            <button key={i} onClick={() => open(it)} className="group text-left">
              <Photo src={it.image} alt={it.url ?? it.title} className="aspect-video w-full rounded-md" />
              <div className="mt-1 line-clamp-2 text-base font-semibold leading-snug text-cyan-50 group-hover:underline">
                <Emph text={it.title} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 地図（Google マップの埋め込み）。場所が複数なら、番号のボタンで切り替える */
function MapCard({ card, onOpenLink }: { card: Card; onOpenLink: (url: string, title: string) => void }) {
  const places = card.data.places ?? [];
  const [sel, setSel] = useState(0);
  const p = places[Math.min(sel, places.length - 1)];
  if (!p) return null;
  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-slate-800">
        <iframe key={p.query} src={mapEmbedUrl(p.query)} title={p.name} className="h-full w-full" loading="eager" referrerPolicy="no-referrer-when-downgrade" />
      </div>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xl font-bold leading-snug text-white">
            {places.length > 1 && <span className="mr-2 font-mono text-cyan-300">{sel + 1}</span>}
            {p.name}
          </div>
          {p.note && (
            <p className="text-base leading-snug text-slate-300">
              <Emph text={p.note} />
            </p>
          )}
        </div>
        <button onClick={() => onOpenLink(mapOpenUrl(p.query), `${p.name}の地図`)} className="flex shrink-0 items-center gap-1.5 rounded-md border border-slate-600 px-3 py-1.5 text-base hover:bg-slate-800">
          <ExternalIcon className="h-4 w-4" />
          Google マップ
        </button>
      </div>
      {places.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {places.map((x, i) => (
            <button
              key={i}
              onClick={() => setSel(i)}
              className={
                "flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-base " +
                (i === sel ? "border-cyan-300 bg-cyan-400/25 font-semibold text-white" : "border-cyan-400/30 text-cyan-100 hover:bg-cyan-400/10")
              }
            >
              <span className="font-mono font-bold">{i + 1}</span>
              <span className="truncate">{x.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function VideoCard({ url, title, onOpenLink }: { url: string; title: string; onOpenLink: (url: string, title: string) => void }) {
  const embed = youtubeEmbed(url);
  if (!embed)
    return (
      <button onClick={() => onOpenLink(url, title)} className="text-cyan-200 underline">
        動画を開く
      </button>
    );
  return (
    <div className="aspect-video w-full overflow-hidden rounded-lg">
      <iframe src={embed} title={title} className="h-full w-full" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" />
    </div>
  );
}

/** 色つきの天気マーク（WMO の天気の番号）。遠くからでも晴れ・くもり・雨が分かるように */
function WeatherArt({ code, size = 40, night = false }: { code: number; size?: number; night?: boolean }) {
  const sun = night ? (
    <path d="M26 10a10 10 0 1 0 10 12A8 8 0 0 1 26 10z" fill="#fde68a" />
  ) : (
    <g>
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return <line key={i} x1={24 + Math.cos(a) * 13} y1={20 + Math.sin(a) * 13} x2={24 + Math.cos(a) * 17} y2={20 + Math.sin(a) * 17} stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />;
      })}
      <circle cx="24" cy="20" r="9" fill="#fbbf24" />
    </g>
  );
  const cloud = (fill: string, dx = 0, dy = 0) => (
    <path transform={`translate(${dx} ${dy})`} d="M14 38h22a8 8 0 0 0 .8-16 11 11 0 0 0-21 3A6.5 6.5 0 0 0 14 38z" fill={fill} />
  );
  const drops = (
    <g stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round">
      <line x1="17" y1="41" x2="15" y2="46" />
      <line x1="25" y1="41" x2="23" y2="46" />
      <line x1="33" y1="41" x2="31" y2="46" />
    </g>
  );
  let body;
  if (code <= 1) body = <g transform="translate(0 4)">{sun}</g>;
  else if (code === 2)
    body = (
      <>
        <g transform="translate(-6 -4) scale(0.85)">{sun}</g>
        {cloud("#e2e8f0", 4, 2)}
      </>
    );
  else if (code === 3 || code === 45 || code === 48) body = cloud("#cbd5e1", 0, 2);
  else if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    body = (
      <>
        {cloud("#cbd5e1", 0, -2)}
        <g fill="#f8fafc">
          <circle cx="16" cy="43" r="2" />
          <circle cx="24" cy="45" r="2" />
          <circle cx="32" cy="43" r="2" />
        </g>
      </>
    );
  else if (code >= 95)
    body = (
      <>
        {cloud("#94a3b8", 0, -2)}
        <path d="M25 37l-5 7h5l-3 6 8-9h-5l3-4z" fill="#facc15" />
      </>
    );
  else
    body = (
      <>
        {cloud("#94a3b8", 0, -2)}
        {drops}
      </>
    );
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-label={weatherLabel(code)}>
      {body}
    </svg>
  );
}

function WeatherCard({ weather, place }: { weather: Weather | null; place: Place | null }) {
  const [jma, setJma] = useState<JmaResult | null>(null);
  const [fc, setFc] = useState<Forecast | null>(null);
  useEffect(() => {
    if (!place) return;
    fetchJma(place).then(setJma).catch(() => {});
    fetchForecast(place).then(setFc).catch(() => {});
  }, [place]);
  if (!place) return <p className="text-slate-400">天気の地域が決まっていません（設定 →「表示」）。</p>;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
  const jmaToday = jma?.forecast.days.find((d) => d.date === today);
  const days = (fc?.days ?? []).filter((d) => d.date >= today).slice(0, 5);
  const hours = (fc?.hours ?? []).slice(0, 24);
  const sun = fc?.days.find((d) => d.date === today);
  const isNight = (time: string) => {
    const d = fc?.days.find((x) => x.date === time.slice(0, 10));
    return d ? time < d.sunrise || time > d.sunset : false;
  };
  return (
    <div className="space-y-4">
      {weather && (
        <div className="flex items-center gap-4">
          <WeatherArt code={weather.code} size={88} night={hours[0] ? isNight(hours[0].time) : false} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-6xl font-bold leading-none text-white">{Math.round(weather.temperature)}°</span>
              <span className="truncate text-xl text-cyan-100">{jmaToday?.weather.split(" ")[0] ?? weather.text ?? weatherLabel(weather.code)}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 font-mono text-xl">
              <span className="font-bold text-rose-300">↑{Math.round(jmaToday?.max ?? weather.max)}°</span>
              <span className="font-bold text-sky-300">↓{Math.round(jmaToday?.min ?? weather.min)}°</span>
              {(jmaToday?.pop ?? weather.rain) !== null && <span className="font-bold text-sky-200">☂ {jmaToday?.pop ?? weather.rain}%</span>}
            </div>
          </div>
        </div>
      )}
      {jmaToday?.weather && <p className="text-base leading-snug text-slate-300">{jmaToday.weather}</p>}

      {hours.length > 0 && (
        <div className="-mx-1 overflow-x-auto pb-1 [scrollbar-width:thin]">
          <div className="flex w-max gap-1 px-1">
            {hours.map((h) => {
              const hr = Number(h.time.slice(11, 13));
              return (
                <div key={h.time} className={"flex w-14 flex-col items-center rounded-md py-1.5 " + (hr === 0 ? "border-l border-cyan-400/40 " : "") + (h === hours[0] ? "bg-cyan-400/15" : "bg-slate-800/40")}>
                  <span className="font-mono text-sm text-cyan-300/90">{h === hours[0] ? "今" : `${hr}時`}</span>
                  <WeatherArt code={h.code} size={36} night={isNight(h.time)} />
                  <span className="font-mono text-lg font-bold text-white">{Math.round(h.temperature)}°</span>
                  <div className="mt-0.5 h-1.5 w-9 overflow-hidden rounded bg-slate-700">
                    <div className="h-full bg-sky-400" style={{ width: `${h.rain ?? 0}%` }} />
                  </div>
                  <span className="font-mono text-xs text-sky-300">{h.rain ?? "-"}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {days.length > 0 && (
        <div className="grid grid-cols-5 gap-1 text-center">
          {days.map((d, i) => {
            const jd = jma?.forecast.days.find((x) => x.date === d.date) ?? jma?.forecast.week.find((x) => x.date === d.date);
            const w = new Date(`${d.date}T12:00:00+09:00`).toLocaleDateString("ja-JP", { timeZone: TZ, weekday: "short" });
            return (
              <div key={d.date} className="rounded-md bg-slate-800/40 py-1.5">
                <div className="text-sm text-cyan-200">{i === 0 ? "今日" : i === 1 ? "明日" : w}</div>
                <div className="flex justify-center">
                  <WeatherArt code={jd?.wmo ?? d.code} size={40} />
                </div>
                <div className="font-mono text-base">
                  <span className="font-bold text-rose-300">{Math.round(jd?.max ?? d.max)}</span>
                  <span className="text-slate-500">/</span>
                  <span className="font-bold text-sky-300">{Math.round(jd?.min ?? d.min)}</span>
                </div>
                <div className="font-mono text-xs text-sky-300">{jd?.pop ?? d.rain ?? "-"}%</div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex justify-between text-sm text-slate-400">
        <span>
          {place.name}
          {jma ? "・気象庁" : ""}
          {sun?.sunrise && ` ・日の出 ${sun.sunrise.slice(11, 16)} 日の入 ${sun.sunset.slice(11, 16)}`}
        </span>
        <a href={yahooWeatherUrl(place.name)} target="_blank" rel="noopener" className="text-cyan-300 hover:underline">
          Yahoo!天気
        </a>
      </div>
    </div>
  );
}

function DateCard() {
  const [now] = useState(() => new Date());
  const ymd = now.toLocaleDateString("sv-SE", { timeZone: TZ });
  const [y, m, d] = ymd.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Array.from({ length: first + days }, (_, i) => (i < first ? null : i - first + 1));
  const week = now.toLocaleDateString("ja-JP", { timeZone: TZ, weekday: "long" });
  return (
    <div>
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-6xl font-bold leading-none text-white">
          {m}/{d}
        </span>
        <span className="text-2xl font-semibold text-cyan-200">{week}</span>
        <span className="ml-auto font-mono text-base text-slate-400">{y}年</span>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center font-mono text-base">
        {["日", "月", "火", "水", "木", "金", "土"].map((w, i) => (
          <span key={w} className={"text-sm " + (i === 0 ? "text-rose-300" : i === 6 ? "text-sky-300" : "text-slate-400")}>
            {w}
          </span>
        ))}
        {cells.map((c, i) => (
          <span key={i} className={"rounded py-1 " + (c === d ? "bg-cyan-400/40 font-bold text-white ring-1 ring-cyan-200" : c ? (i % 7 === 0 ? "text-rose-200/80" : i % 7 === 6 ? "text-sky-200/80" : "text-slate-200") : "")}>
            {c ?? ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function ScheduleCard({ session }: { session: Session }) {
  const [events, setEvents] = useState<{ id: string; title: string; start: string; end: string; allDay: boolean; color?: string; holiday?: boolean }[] | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const day = new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
    const from = new Date(`${day}T00:00:00+09:00`).toISOString();
    const to = new Date(`${day}T23:59:59+09:00`).toISOString();
    fetch(`/api/google/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: { authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((j) => {
        if (!j.connected) setMsg("Google カレンダーとつながっていません。");
        setEvents((j.events ?? []).filter((e: { holiday?: boolean }) => !e.holiday));
      })
      .catch(() => setMsg("予定を読めませんでした。"));
  }, [session.access_token]);
  if (msg) return <p className="text-slate-400">{msg}</p>;
  if (!events) return <p className="text-slate-400">読み込んでいます…</p>;
  if (!events.length) return <p className="text-xl text-slate-200">今日の予定はありません。</p>;
  const time = (s: string) => new Date(s).toLocaleTimeString("ja-JP", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  return (
    <ul className="space-y-2">
      {events.map((e) => (
        <li key={e.id} className="flex items-stretch gap-3 rounded-md bg-slate-800/40 py-1.5 pr-2">
          <span className="w-1.5 shrink-0 rounded-full" style={{ background: e.color || "#22d3ee" }} />
          <span className="w-24 shrink-0 font-mono text-xl font-bold text-white">{e.allDay ? "終日" : time(e.start)}</span>
          <span className="min-w-0 flex-1 leading-snug">
            {e.title}
            {!e.allDay && <span className="block font-mono text-sm text-slate-400">〜{time(e.end)}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
