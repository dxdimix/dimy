"use client";

// 画面のカード（返事の中身を目でも見せる「ショーウィンドウ」）。
// - 左右の端に互い違いに出す（1 枚目は右、2 枚目は左…）。中央の球体と字幕は隠さない
// - 天気・日付・今日の予定は、画面が言葉からすぐ出す（PC の DIMY に聞かないので、返事は遅くならない）
// - 一覧・動画・要点の図・ページ・画像・文は、DIMY が返事を書いたあとに出す（表 cards）
// - 各カードに「残す」（次の質問でも消えない）と「閉じる」。上に「すべて閉じる」

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Card } from "@/lib/cards";
import { youtubeEmbed } from "@/lib/cards";
import { fetchJma, weatherLabel, yahooWeatherUrl, type JmaResult, type Place, type Weather } from "@/lib/weather";
import { CloseIcon, ExternalIcon, PinIcon, WeatherIcon } from "./Icons";

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

export function Showcase(p: Props) {
  if (!p.cards.length) return null;
  const right = p.cards.filter((_, i) => i % 2 === 0);
  const left = p.cards.filter((_, i) => i % 2 === 1);
  const column = (list: Card[], side: "left" | "right") => (
    <div
      className={
        "pointer-events-none absolute top-24 z-[700] flex max-h-[calc(100dvh-14rem)] w-[300px] max-w-[42vw] flex-col gap-3 overflow-y-auto pb-2 " +
        (side === "right" ? "right-6" : "left-[80px]")
      }
    >
      {list.map((c) => (
        <CardView key={c.id} card={c} side={side} {...p} />
      ))}
    </div>
  );
  return (
    <>
      {column(right, "right")}
      {column(left, "left")}
      <button
        onClick={p.onCloseAll}
        className="absolute right-6 top-[4.6rem] z-[710] rounded-full border border-cyan-400/30 bg-slate-950/80 px-3 py-1 text-[11px] text-cyan-200 backdrop-blur hover:border-cyan-300/70"
        title="出ているカードをすべて閉じる（残したものも閉じる）"
      >
        すべて閉じる（{p.cards.length}）
      </button>
    </>
  );
}

function CardView({ card, side, onClose, onPin, onOpenLink, onOpenPage, weather, place, session }: Props & { card: Card; side: "left" | "right" }) {
  const head = { weather: "WEATHER", date: "DATE", schedule: "SCHEDULE", list: "LIST", video: "VIDEO", points: "POINTS", page: "PAGE", image: "IMAGE", text: "NOTE" }[card.kind];
  return (
    <div
      className={
        "pointer-events-auto rounded-lg border bg-slate-950/90 p-3 text-sm shadow-[0_0_24px_rgba(34,211,238,0.15)] backdrop-blur " +
        (card.pinned ? "border-cyan-300/70" : "border-cyan-400/30") +
        (side === "right" ? " dimy-card-in-right" : " dimy-card-in-left")
      }
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[10px] tracking-[0.3em] text-cyan-400/80">{head}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-cyan-100">{card.title}</span>
        <button onClick={() => onPin(card.id)} title={card.pinned ? "残すのをやめる" : "残す（次の質問でも消えない）"} className={card.pinned ? "text-cyan-100" : "text-cyan-400/60 hover:text-cyan-100"}>
          <PinIcon className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => onClose(card.id)} title="閉じる" className="text-cyan-400/70 hover:text-cyan-100">
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      {card.kind === "weather" && <WeatherCard weather={weather} place={place} />}
      {card.kind === "date" && <DateCard />}
      {card.kind === "schedule" && <ScheduleCard session={session} />}
      {card.kind === "list" && (
        <ul className="space-y-1.5">
          {card.data.items?.map((it, i) => (
            <li key={i} className="text-xs">
              {it.url ? (
                <button onClick={() => onOpenLink(it.url!, it.title)} className="text-left text-cyan-100 hover:text-cyan-50 hover:underline">
                  {it.title}
                </button>
              ) : (
                <span className="text-cyan-100">{it.title}</span>
              )}
              {it.note && <span className="block text-[11px] text-slate-400">{it.note}</span>}
            </li>
          ))}
        </ul>
      )}
      {card.kind === "points" && (
        <ol className="space-y-1.5">
          {card.data.points?.map((pt, i) => (
            <li key={i} className="flex gap-2 text-xs">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-cyan-400/50 font-mono text-[10px] text-cyan-200">{i + 1}</span>
              <span className="text-slate-200">{pt}</span>
              {card.data.style === "steps" && i < (card.data.points?.length ?? 0) - 1 && <span className="sr-only">→</span>}
            </li>
          ))}
        </ol>
      )}
      {card.kind === "text" && <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-200">{card.data.text}</p>}
      {card.kind === "image" && card.data.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.data.url} alt={card.title} className="max-h-60 w-full rounded object-contain" />
      )}
      {card.kind === "video" && card.data.url && <VideoCard url={card.data.url} title={card.title} onOpenLink={onOpenLink} />}
      {card.kind === "page" && card.data.url && (
        <div className="space-y-2 text-xs">
          {card.data.note && <p className="text-slate-300">{card.data.note}</p>}
          <div className="flex gap-2">
            <button onClick={() => onOpenPage(card.data.url!, card.title)} className="rounded border border-cyan-500/50 px-2 py-1 text-cyan-200 hover:bg-cyan-400/10">
              小窓で開く
            </button>
            <button onClick={() => onOpenLink(card.data.url!, card.title)} className="flex items-center gap-1 rounded border border-slate-600 px-2 py-1 text-slate-200 hover:bg-slate-800">
              <ExternalIcon className="h-3.5 w-3.5" />
              Chrome で開く
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function VideoCard({ url, title, onOpenLink }: { url: string; title: string; onOpenLink: (url: string, title: string) => void }) {
  const embed = youtubeEmbed(url);
  if (!embed)
    return (
      <button onClick={() => onOpenLink(url, title)} className="text-xs text-cyan-200 underline">
        動画を開く
      </button>
    );
  return (
    <div className="aspect-video w-full overflow-hidden rounded">
      <iframe src={embed} title={title} className="h-full w-full" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" />
    </div>
  );
}

function WeatherCard({ weather, place }: { weather: Weather | null; place: Place | null }) {
  const [jma, setJma] = useState<JmaResult | null>(null);
  useEffect(() => {
    if (!place) return;
    fetchJma(place).then(setJma).catch(() => {});
  }, [place]);
  if (!place) return <p className="text-xs text-slate-400">天気の地域が決まっていません（設定 →「表示」）。</p>;
  const tomorrow = jma?.forecast.days[1];
  return (
    <div className="space-y-2 text-xs">
      {weather && (
        <div className="flex items-center gap-3">
          <WeatherIcon code={weather.code} className="h-10 w-10 text-cyan-300" />
          <div>
            <div className="text-cyan-50">{weather.text ?? weatherLabel(weather.code)}</div>
            <div className="font-mono text-slate-300">
              今 {Math.round(weather.temperature)}°／{Math.round(weather.max)}° / {Math.round(weather.min)}°{weather.rain !== null && `／${weather.rain}%`}
            </div>
          </div>
        </div>
      )}
      {tomorrow && (
        <p className="text-slate-300">
          <span className="text-cyan-200">明日</span>：{tomorrow.weather}
          {tomorrow.max !== null && `／最高 ${tomorrow.max}°`}
          {tomorrow.pop !== null && `／${tomorrow.pop}%`}
        </p>
      )}
      <div className="flex justify-between text-[10px] text-slate-500">
        <span>{place.name}{jma ? "・気象庁" : ""}</span>
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
    <div className="text-xs">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="font-mono text-2xl text-cyan-100">
          {m}/{d}
        </span>
        <span className="text-cyan-300">{week}</span>
        <span className="ml-auto font-mono text-[10px] text-slate-500">{y}</span>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center font-mono text-[10px]">
        {["日", "月", "火", "水", "木", "金", "土"].map((w, i) => (
          <span key={w} className={i === 0 ? "text-rose-300/70" : i === 6 ? "text-sky-300/70" : "text-slate-500"}>
            {w}
          </span>
        ))}
        {cells.map((c, i) => (
          <span key={i} className={"rounded py-0.5 " + (c === d ? "bg-cyan-400/30 text-cyan-50" : c ? "text-slate-300" : "")}>
            {c ?? ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function ScheduleCard({ session }: { session: Session }) {
  const [events, setEvents] = useState<{ id: string; title: string; start: string; allDay: boolean; holiday?: boolean }[] | null>(null);
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
  if (msg) return <p className="text-xs text-slate-400">{msg}</p>;
  if (!events) return <p className="text-xs text-slate-400">読み込んでいます…</p>;
  if (!events.length) return <p className="text-xs text-slate-400">今日の予定はありません。</p>;
  return (
    <ul className="space-y-1 text-xs">
      {events.map((e) => (
        <li key={e.id} className="flex gap-2">
          <span className="w-12 shrink-0 font-mono text-cyan-300">
            {e.allDay ? "終日" : new Date(e.start).toLocaleTimeString("ja-JP", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })}
          </span>
          <span className="text-slate-200">{e.title}</span>
        </li>
      ))}
    </ul>
  );
}
