"use client";

// 画面のカード（返事の中身を目でも見せる「ショーウィンドウ」）。
// - 球体の左右に互い違いに、大きく出す（1 枚目は右、2 枚目は左…）。球体には少しかかってよいが、下の字幕にはかけない
// - 離れた場所から見えるよう、文字は大きく、大事な数字は太く。文字だけでなく、写真・動画・天気マーク・図で見せる
// - 天気・日付・今日の予定は、画面が言葉からすぐ出す（PC の DIMY に聞かないので、返事は遅くならない）
// - 一覧（写真つき）・動画・数字・要点の図・ページ・画像・文は、DIMY が返事を書いたあとに出す（表 cards）
// - 各カードに「残す」（次の質問でも消えない）と「閉じる」。上に「すべて閉じる」
// - スマホなど幅の狭い画面では、上に 1 列で出す
// - DIMY が出したカードは決まった列に並べる。利用者がドラッグしたカード（帯をつかむ・中のリンクを外へ出す）は、
//   画面の中の好きな場所に置け、右下の角で大きさを変えられる（利用者の決まり）
// - カードは、周りのボタンや表記（右上のボタン・左のアイコン・日時・天気・SYSTEM・LOG・字幕・マイク）より後ろに出す

import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Card, CardDrag } from "@/lib/cards";
import { CARD_DRAG_TYPE, clampFloat, emphasize, googleImagesUrl, splitColumns, mapDirUrl, mapEmbedUrl, mapOpenUrl, youtubeEmbed, youtubeId } from "@/lib/cards";
import { fetchDaily, fetchForecast, fetchJma, findPlace, weatherLabel, yahooWeatherUrl, type Forecast, type DayWeather, type JmaResult, type Place, type Weather } from "@/lib/weather";
import { CloseIcon, ExternalIcon, PinIcon } from "./Icons";
import { getPref } from "@/lib/prefs";
import { hasDimyExtension, WEB_FRAME_SANDBOX } from "@/lib/extension";

const TZ = "Asia/Tokyo";
/** 上に写真を出すカード（ほかの種類は、それぞれの形で写真を出す） */
const PHOTO_KINDS = ["stats", "points", "text"];

type Props = {
  cards: Card[];
  onClose: (id: string) => void;
  onPin: (id: string) => void;
  onCloseAll: () => void;
  /** リンクを開く（拡張機能があればディミの中の Web のカード、なければ Chrome） */
  onOpenLink: (url: string, title: string) => void;
  /** Chrome で開く（ボタンの「Chrome で開く」） */
  onOpenChrome: (url: string, title: string) => void;
  /** ページを固定ウィンドウで開く */
  onOpenPage: (url: string, title: string) => void;
  /** カードの中のリンク・場所を枠の外へドラッグして離したとき、それだけを別のカードにする */
  onExtract: (c: Omit<CardDrag, "from">, at: { x: number; y: number }) => void;
  /** カードを動かした・大きさを変えた・前に出した */
  onUpdate: (id: string, patch: Partial<Card>) => void;
  /** カードを画面（ブラウザのウィンドウ）の外で離した: そこにあるパレットへ移す。移せたら true */
  onDropOut: (card: Card, screenX: number, screenY: number, grab: { x: number; y: number }) => Promise<boolean>;
  /** 動作の記録（管理の「動作」に残す） */
  onLog: (text: string) => void;
  /** 会話のカードの中身（文字入力と会話の履歴） */
  renderChat: () => ReactNode;
  weather: Weather | null;
  place: Place | null;
  session: Session;
};

/** ドラッグして枠の外へ出せるようにする（リンク・場所）。ほかの場所（固定ウィンドウなど）には渡さない */
function dragOut(payload: CardDrag) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.clearData();
      e.dataTransfer.setData(CARD_DRAG_TYPE, JSON.stringify(payload));
      e.dataTransfer.effectAllowed = "copy";
    },
  };
}

const WIDE = "(min-width: 1600px)";
function useWide() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(WIDE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

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
// 字幕（下から 8rem、高さ最大 7.5rem）の上の端のすぐ上まで使う（内側の列は字幕と横に少し重なるため）
const COLUMN_BASE: CSSProperties = { top: "6.5rem", maxHeight: "calc(100dvh - 6.5rem - 16rem)", width: `min(680px, calc(50% - ${INNER} - 80px))` };
// 外側の列（左右 2 列のとき）は、字幕とも下の入力欄とも重ならないので、右下の LOG の上まで使う
const OUTER_MAX_HEIGHT = "calc(100dvh - 6.5rem - 12.5rem)";

export function Showcase(p: Props) {
  const narrow = useNarrow();
  const wide = useWide();
  const { onExtract } = p;
  // カードの中のリンクを、元のカードの外で離したら、それだけのカードを作る（残す）
  useEffect(() => {
    const isOurs = (e: globalThis.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes(CARD_DRAG_TYPE);
    const over = (e: globalThis.DragEvent) => {
      if (!isOurs(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const drop = (e: globalThis.DragEvent) => {
      if (!isOurs(e)) return;
      e.preventDefault();
      try {
        const d = JSON.parse(e.dataTransfer!.getData(CARD_DRAG_TYPE)) as CardDrag;
        const under = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-card-id]");
        if (under?.getAttribute("data-card-id") === d.from) return; // 元のカードの中で離した
        onExtract({ kind: d.kind, title: d.title, data: d.data }, { x: e.clientX, y: e.clientY });
      } catch {
        /* 読めないものは無視 */
      }
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [onExtract]);
  // 帯をつかんで動かす・右下の角で大きさを変える（列のカードは、動かし始めたら好きな場所のカードになる）
  const { onUpdate, onDropOut, onLog } = p;
  const [moving, setMoving] = useState(false);
  const [outside, setOutside] = useState(false);
  // 指の動きを受け取り続けるための、いつもある小さな板（固定ウィンドウと同じやり方。ウィンドウの外へ出ても届く）
  const captureRef = useRef<HTMLDivElement>(null);
  const startDrag = (card: Card, e: ReactPointerEvent, mode: "move" | "resize") => {
    if (e.button !== 0 || (mode === "move" && (e.target as HTMLElement).closest("button"))) return;
    e.preventDefault();
    const el = (e.currentTarget as HTMLElement).closest("[data-card-id]") as HTMLElement | null;
    // ウィンドウの外へ出ても指の動きを受け取り続ける（パレットへ移すため）
    try {
      captureRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* 受け取れなくても、ウィンドウの中では動かせる */
    }
    const r = el?.getBoundingClientRect();
    if (!r) return;
    const start = card.float ?? { x: r.left, y: r.top, w: r.width };
    const sx = e.clientX;
    const sy = e.clientY;
    const startH = card.float?.h ?? r.height;
    let begun = false;
    let wentOut = false;
    let done = false;
    // 最後に見えた指の位置（モニター上）と、そのときウィンドウの外だったか。
    // 別のモニターで離したとき、離した位置が正しく届かないことがあるため、最後に見えた位置で決める
    let last = { out: false, screenX: e.screenX, screenY: e.screenY };
    let lastF = start as { x: number; y: number; w: number; h?: number };
    const isOut = (ev: PointerEvent) => ev.clientX < 0 || ev.clientY < 0 || ev.clientX > window.innerWidth || ev.clientY > window.innerHeight;
    const move = (ev: PointerEvent) => {
      const out = isOut(ev);
      last = { out, screenX: ev.screenX, screenY: ev.screenY };
      if (!wentOut && out) {
        wentOut = true;
        onLog(`カード「${card.title}」をウィンドウの外へ動かした（モニター上 ${Math.round(ev.screenX)}, ${Math.round(ev.screenY)}）`);
      }
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!begun) {
        if (Math.abs(dx) + Math.abs(dy) < 5) return;
        begun = true;
        setMoving(true);
      }
      const f =
        mode === "move" ? { ...start, x: start.x + dx, y: start.y + dy } : { ...start, w: start.w + dx, h: startH + dy };
      // ウィンドウの外へ出ている間は、カードも指について画面の外へ出す（パレットへ持っていけることが目で分かるように）
      lastF = mode === "move" && out ? { ...f, x: Math.round(f.x), y: Math.round(f.y) } : clampFloat(f, window.innerWidth, window.innerHeight);
      setOutside(mode === "move" && out);
      onUpdate(card.id, { float: lastF, pinned: true, at: Date.now() + 1e13 });
    };
    const finish = (ev: PointerEvent | null) => {
      if (done) return;
      done = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      captureRef.current?.removeEventListener("lostpointercapture", lost);
      setMoving(false);
      setOutside(false);
      if (!begun || mode !== "move") return;
      const outNow = ev ? isOut(ev) : false;
      const outside = outNow || last.out;
      if (!outside) {
        if (wentOut) onLog(`カード「${card.title}」はウィンドウの外へ出たが、中に戻って離した`);
        return;
      }
      const at = outNow && ev ? { x: ev.screenX, y: ev.screenY } : { x: last.screenX, y: last.screenY };
      onLog(`カード「${card.title}」をウィンドウの外で離した（モニター上 ${Math.round(at.x)}, ${Math.round(at.y)}${outNow ? "" : "。最後に見えた位置で判断"}）`);
      const back = clampFloat(lastF, window.innerWidth, window.innerHeight);
      void onDropOut({ ...card, float: lastF }, at.x, at.y, { x: sx - start.x, y: sy - start.y }).then((ok) => {
        // 移せなかったときは、画面の中へ戻す（見えなくならないように）
        if (!ok) onUpdate(card.id, { float: back });
      });
    };
    const up = (ev: PointerEvent) => finish(ev);
    // 指の受け取りが途中で切れたとき（別のウィンドウで離したなど）も、最後に見えた位置で終える
    const lost = () => finish(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    captureRef.current?.addEventListener("lostpointercapture", lost);
  };
  if (!p.cards.length) return null;
  // スマホでは、会話のカードだけを大きく出し、ほかは小さなカードの一覧にする（押すとページ・地図のアプリを開く。利用者の決まり）
  const floats = p.cards.filter((c) => c.float && (!narrow || c.kind === "chat")).sort((a, b) => a.at - b.at);
  // カードが多いとき（4 枚より多く、画面が広いとき）は、左右それぞれ 2 列にして画面いっぱいに並べる（利用者の希望）
  const perSide = wide && p.cards.filter((c) => !c.float).length > 4 ? 2 : 1;
  const colW = perSide === 2 ? `calc((50% - ${INNER} - 96px) / 2)` : COLUMN_BASE.width;
  // 左端に固定の ChatGPT のカード（利用者の決まり 2026-11-17）。左の外側の列は使わず、左の内側の列はこれと重ならない幅にする。
  // 折りたたんでいるときは、帯の下から列を使う
  const gpt = floats.find((c) => c.data.chatgpt && !c.collapsed);
  const gptLeft = Boolean(gpt && gpt.float!.x < 300);
  const column = (list: Card[], side: "left" | "right" | "top", j = 0) => {
    const offset = j === 0 ? INNER : `${INNER} + ${colW} + 16px`;
    let style: CSSProperties =
      side === "top"
        ? { top: "11.75rem", left: 12, right: 12, maxHeight: "calc(100dvh - 11.75rem - 17rem)" }
        : side === "right"
          ? { ...COLUMN_BASE, width: colW, left: `calc(50% + ${offset})`, ...(j > 0 ? { maxHeight: OUTER_MAX_HEIGHT } : {}) }
          : { ...COLUMN_BASE, width: colW, right: `calc(50% + ${offset})`, ...(j > 0 ? { maxHeight: OUTER_MAX_HEIGHT } : {}) };
    if (gpt && gptLeft && side === "left" && j === 0) {
      style = { ...style, width: `min(${colW}, calc(50% - ${INNER} - ${gpt.float!.x + gpt.float!.w + 16}px))` };
    }
    if (gpt && !gptLeft && side === "right" && j === perSide - 1) {
      if (perSide === 1) {
        // 1 列のときは、ChatGPT のカードの左までの幅にする
        style = { ...style, width: `min(${colW}, calc(50% - ${INNER} - ${gpt.float!.w + 40}px))` };
      } else {
        // 2 列のときは、外側の列を ChatGPT のカードの下から始める
        const top = gpt.float!.y + (gpt.float!.h ?? 320) + 16;
        style = { ...style, top, maxHeight: `calc(100dvh - ${top}px - 12.5rem)` };
      }
    }
    return (
      <div style={style} className="pointer-events-none absolute z-[700] flex flex-col gap-4 overflow-y-auto overscroll-contain pb-2 [scrollbar-width:thin]">
        {list.map((c) => (
          <CardView key={c.id} card={c} side={side === "left" ? "left" : "right"} {...p} onGrab={startDrag} />
        ))}
      </div>
    );
  };
  return (
    <>
      {/* 好きな場所に置いたカード（新しく触ったものほど前） */}
      {floats.map((c, i) => (
        <div key={c.id} className="absolute flex flex-col" style={{ left: c.float!.x, top: c.float!.y, width: c.float!.w, height: c.collapsed ? undefined : c.float!.h, zIndex: 720 + i }}>
          <CardView card={c} side="right" {...p} onGrab={startDrag} floating />
        </div>
      ))}
      <div ref={captureRef} className="pointer-events-none fixed left-0 top-0 h-px w-px" aria-hidden />
      {/* 動かしている間は、地図や動画（iframe）に指の動きを取られないよう、透明な板をかぶせる */}
      {moving && <div className="fixed inset-0 z-[990] cursor-grabbing" />}
      {outside && (
        <div className="pointer-events-none fixed inset-x-0 top-6 z-[995] mx-auto w-fit rounded-full border border-cyan-300/70 bg-slate-950/90 px-5 py-2 text-base text-cyan-100 shadow-[0_0_20px_rgba(34,211,238,0.4)]">
          離すと、そのモニターのパレットへ移します
        </div>
      )}
      {narrow ? (
        <CompactList {...p} cards={p.cards.filter((c) => c.kind !== "chat")} />
      ) : (
        <>
          {splitColumns(p.cards, perSide, gptLeft).right.map((list, j) => (
            <Fragment key={`r${j}`}>{column(list, "right", j)}</Fragment>
          ))}
          {splitColumns(p.cards, perSide, gptLeft).left.map((list, j) => (
            <Fragment key={`l${j}`}>{column(list, "left", j)}</Fragment>
          ))}
        </>
      )}
      <button
        onClick={p.onCloseAll}
        className={
          "absolute z-[790] rounded-full border border-cyan-400/40 bg-slate-950/85 text-cyan-100 backdrop-blur hover:border-cyan-300/80 " +
          (narrow ? "right-3 top-[9.4rem] px-3 py-1 text-xs" : "left-1/2 top-[4.4rem] -translate-x-1/2 px-4 py-1.5 text-sm")
        }
        title="出ているカードをすべて閉じる（残したものも閉じる）"
      >
        カードをすべて閉じる（{p.cards.length}）
      </button>
    </>
  );
}

/** スマホの小さなカードの一覧。カードは入口（見出しと要点だけ）にして、押すとページ・地図のアプリ・動画のアプリを開く */
function CompactList(p: Props & { cards: Card[] }) {
  // 一覧と地図は、最初の 2 件だけを出し、残りは「ほか N 件」で開く（たくさんのカードを一度に見渡せるように）
  const [opened, setOpened] = useState<Set<string>>(new Set());
  if (!p.cards.length) return null;
  const open = (url: string, title: string) => p.onOpenChrome(url, title);
  return (
    <div
      // 上の段の下から、マイクのすぐ上まで使う（スマホは高さが少ないため。字幕は話している間だけ、この上に重なって出る）
      style={{ top: "11.75rem", left: 12, right: 12, maxHeight: "calc(100dvh - 11.75rem - 7.5rem)" }}
      className="absolute z-[700] flex flex-col gap-2 overflow-y-auto overscroll-contain pb-2"
    >
      {p.cards.map((card) => (
        <div key={card.id} className={"rounded-lg border bg-slate-950/90 px-3 py-2 backdrop-blur " + (card.pinned ? "border-cyan-300/70" : "border-cyan-400/30")}>
          <div className="mb-1 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-cyan-50">{card.title}</span>
            <button onClick={() => p.onPin(card.id)} aria-label={card.pinned ? "残すのをやめる" : "残す"} className={"p-1 " + (card.pinned ? "text-cyan-100" : "text-cyan-400/60")}>
              <PinIcon className="h-4 w-4" />
            </button>
            <button onClick={() => p.onClose(card.id)} aria-label="閉じる" className="p-1 text-cyan-400/70">
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
          {PHOTO_KINDS.includes(card.kind) && card.data.image && (
            <Photo src={card.data.image} alt={card.data.links?.[0]?.url ?? card.title} className="mb-1.5 h-24 w-full rounded" />
          )}
          <CompactBody card={card} open={open} weather={p.weather} session={p.session} all={opened.has(card.id)} />
          {!!card.data.links?.length && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {card.data.links.map((l, i) => (
                <button key={i} onClick={() => open(l.url, l.title)} className="flex max-w-full items-center gap-1 rounded-full border border-cyan-400/40 px-2.5 py-1 text-xs text-cyan-100 active:bg-cyan-400/10">
                  <ExternalIcon className="h-3 w-3 shrink-0" />
                  <span className="truncate">{l.title}</span>
                </button>
              ))}
            </div>
          )}
          {!opened.has(card.id) && (card.data.items?.length ?? card.data.places?.length ?? 0) > 2 && (
            <button onClick={() => setOpened((s) => new Set(s).add(card.id))} className="mt-1 w-full rounded py-1 text-xs text-cyan-300 active:bg-cyan-400/10">
              ほか {(card.data.items?.length ?? card.data.places?.length ?? 0) - 2} 件を見る
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** 押せる 1 行（小さな画像・見出し・ひとこと） */
function Row({ onClick, img, icon, title, note }: { onClick: () => void; img?: string; icon?: React.ReactNode; title: string; note?: string }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 rounded-md py-1.5 text-left active:bg-cyan-400/10">
      {img ? (
        <Photo src={img} alt={title} className="h-11 w-16 shrink-0 rounded" />
      ) : (
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded bg-cyan-400/10 text-cyan-300">{icon ?? <ExternalIcon className="h-4 w-4" />}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-semibold leading-snug text-cyan-50">{title}</span>
        {note && <span className="line-clamp-1 text-xs text-slate-400">{note}</span>}
      </span>
      <ExternalIcon className="h-4 w-4 shrink-0 text-cyan-400/60" />
    </button>
  );
}

function CompactBody({ card, open, weather, session, all }: { card: Card; open: (url: string, title: string) => void; weather: Weather | null; session: Session; all: boolean }) {
  const d = card.data;
  const cut = <T,>(xs: T[] | undefined) => (all ? xs : xs?.slice(0, 2));
  const pinIcon = (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 21s-6-5.3-6-11a6 6 0 1 1 12 0c0 5.7-6 11-6 11z" />
      <circle cx="12" cy="10" r="2.2" />
    </svg>
  );
  switch (card.kind) {
    case "list":
      return <div className="divide-y divide-cyan-400/10">{cut(d.items)?.map((it, i) => <Row key={i} onClick={() => it.url && open(it.url, it.title)} img={it.image} title={it.title} note={it.note} />)}</div>;
    case "map":
      // 地図はアプリで開く（Google マップのリンク。iPhone ではアプリが入っていればアプリ、なければ Safari）
      return <div className="divide-y divide-cyan-400/10">{cut(d.places)?.map((pl, i) => <Row key={i} onClick={() => open(pl.from ? mapDirUrl(pl.query) : mapOpenUrl(pl.query), pl.name)} icon={pinIcon} title={pl.name} note={pl.note ?? (pl.from ? "地図のアプリで、現在地からの道順を開く" : "地図のアプリで開く")} />)}</div>;
    case "video": {
      const id = d.url ? youtubeId(d.url) : null;
      return d.url ? <Row onClick={() => open(d.url!, card.title)} img={id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : undefined} title={card.title} note="動画を開く" /> : null;
    }
    case "place":
      return <PlaceCompact card={card} open={open} />;
    case "page":
    case "web":
      return d.url ? <Row onClick={() => open(d.url!, card.title)} img={d.image} title={card.title} note={d.note ?? host(d.url)} /> : null;
    case "image":
      return d.images?.length ? (
        <div className="grid grid-cols-2 gap-1.5">
          {d.images.map((im, i) => (
            <button key={i} onClick={() => open(im.page || im.url, im.title)}>
              <Photo src={im.url} alt={im.title} className="aspect-[4/3] w-full rounded" />
            </button>
          ))}
        </div>
      ) : d.url ? (
        <Row onClick={() => open(d.url!, card.title)} img={d.url} title={card.title} note="画像を開く" />
      ) : d.query ? (
        <Row onClick={() => open(googleImagesUrl(d.query!), card.title)} title={d.query} note="Google 画像で見る" />
      ) : null;
    case "stats":
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {d.stats?.map((st, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-xs text-slate-300">
              {st.label} <b className="font-mono text-base text-white">{st.value}</b>
              {st.unit}
              {st.change && <span className={"font-mono " + changeColor(st.change)}>{st.change}</span>}
              {st.series && st.series.length >= 2 && <Sparkline values={st.series} className="h-4 w-12" />}
            </span>
          ))}
        </div>
      );
    case "points":
      return (
        <ul className="space-y-0.5 text-xs leading-snug text-slate-200">
          {d.points?.map((pt, i) => (
            <li key={i}>
              {i + 1}. <Emph text={pt} />
            </li>
          ))}
        </ul>
      );
    case "text":
      return (
        <p className="line-clamp-4 text-xs leading-snug text-slate-200">
          <Emph text={d.text ?? ""} />
        </p>
      );
    case "talk":
      return (
        <p className="line-clamp-3 text-xs leading-snug text-slate-300">
          <span className="text-cyan-300">あなた</span> {d.q}
          <br />
          <span className="text-cyan-300">DIMY</span> {d.a}
        </p>
      );
    case "weather":
      return weather ? (
        <div className="flex items-center gap-3">
          <WeatherArt code={weather.code} size={36} />
          <span className="font-mono text-2xl font-bold text-white">{Math.round(weather.temperature)}°</span>
          <span className="font-mono text-sm">
            <b className="text-rose-300">{Math.round(weather.max)}°</b> / <b className="text-sky-300">{Math.round(weather.min)}°</b>
            {weather.rain !== null && <span className="ml-2 text-sky-200">☂{weather.rain}%</span>}
          </span>
        </div>
      ) : null;
    case "week":
      return <WeekWeatherCard place={null} compact />;
    case "date":
      return <DateLine />;
    case "schedule":
      return (
        <div style={{ zoom: 0.72 }}>
          <ScheduleCard session={session} />
        </div>
      );
    default:
      return null;
  }
}

function DateLine() {
  const [now] = useState(() => new Date());
  return (
    <p className="font-mono text-lg text-white">
      {now.toLocaleDateString("ja-JP", { timeZone: TZ, month: "numeric", day: "numeric", weekday: "long" })}
    </p>
  );
}

/** その場所（市区町村）の 3 日分の天気。地名から場所を調べて（Open-Meteo の地名検索）、予報を読む。同じ地名は一度だけ調べる */
type AreaDay = { date: string; code: number; max: number; min: number; rain: number | null };
const areaWeatherCache = new Map<string, Promise<AreaDay[] | null>>();
function useAreaWeather(area?: string): AreaDay[] | null {
  const [days, setDays] = useState<AreaDay[] | null>(null);
  useEffect(() => {
    if (!area) return;
    let alive = true;
    if (!areaWeatherCache.has(area)) {
      areaWeatherCache.set(
        area,
        findPlace(area)
          .then(async (pl) => {
            if (!pl) return null;
            const today = new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
            return (await fetchForecast(pl)).days.filter((d) => d.date >= today).slice(0, 3);
          })
          .catch(() => null),
      );
    }
    areaWeatherCache.get(area)!.then((d) => alive && setDays(d));
    return () => {
      alive = false;
    };
  }, [area]);
  return days;
}

function AreaWeather({ area, compact = false }: { area?: string; compact?: boolean }) {
  const days = useAreaWeather(area);
  if (!area || !days?.length) return null;
  const label = (i: number, date: string) => (i === 0 ? "今日" : i === 1 ? "明日" : new Date(`${date}T12:00:00+09:00`).toLocaleDateString("ja-JP", { timeZone: TZ, weekday: "short" }));
  return (
    <div className={"flex gap-1.5 " + (compact ? "" : "rounded-lg bg-slate-800/40 p-2")}>
      {days.map((d, i) => (
        <div key={d.date} className="flex flex-1 items-center justify-center gap-1.5">
          <span className={"text-cyan-200 " + (compact ? "text-[10px]" : "text-sm")}>{label(i, d.date)}</span>
          <WeatherArt code={d.code} size={compact ? 22 : 32} />
          <span className={"font-mono " + (compact ? "text-[11px]" : "text-sm")}>
            <b className="text-rose-300">{Math.round(d.max)}</b>/<b className="text-sky-300">{Math.round(d.min)}</b>
            {d.rain !== null && <span className="ml-1 text-sky-200">{d.rain}%</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 施設 1 か所分（写真・営業時間・料金表・特徴・その場所の天気・地図・公式ページ） */
function PlaceCard({ card, onOpenLink, onOpenChrome }: { card: Card; onOpenLink: (url: string, title: string) => void; onOpenChrome: (url: string, title: string) => void }) {
  const d = card.data;
  const [showMap, setShowMap] = useState(false);
  return (
    <div className="space-y-3">
      {d.image && (
        <button onClick={() => d.url && onOpenLink(d.url, card.title)} className="block w-full">
          <Photo src={d.image} alt={d.url ?? card.title} className="aspect-[16/7] w-full rounded-lg" />
        </button>
      )}
      {(d.area || d.address) && <p className="text-sm text-slate-400">{d.address ?? d.area}</p>}
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-base">
        {d.hours && (
          <>
            <dt className="text-sm text-cyan-300/80">営業時間</dt>
            <dd className="leading-snug">
              <Emph text={d.hours} />
            </dd>
          </>
        )}
        {d.phone && (
          <>
            <dt className="text-sm text-cyan-300/80">電話</dt>
            <dd className="font-mono">{d.phone}</dd>
          </>
        )}
      </dl>
      {!!d.prices?.length && (
        <div className="overflow-hidden rounded-lg border border-cyan-400/20">
          <div className="bg-cyan-400/10 px-3 py-1 text-sm text-cyan-200">料金</div>
          <table className="w-full text-base">
            <tbody>
              {d.prices.map((p, i) => (
                <tr key={i} className="border-t border-cyan-400/10">
                  <td className="px-3 py-1 text-slate-300">{p.label}</td>
                  <td className="px-3 py-1 text-right font-mono font-bold text-white">{p.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!d.points?.length && (
        <ul className="space-y-1">
          {d.points.map((pt, i) => (
            <li key={i} className="flex gap-2 text-base leading-snug">
              <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-cyan-300" />
              <span>
                <Emph text={pt} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {d.note && (
        <p className="text-sm leading-snug text-slate-300">
          <Emph text={d.note} />
        </p>
      )}
      <AreaWeather area={d.area} />
      {showMap && d.query && (
        <div className="aspect-[4/3] w-full overflow-hidden rounded-lg bg-slate-800">
          <iframe src={mapEmbedUrl(d.query)} title={card.title} className="h-full w-full" />
        </div>
      )}
      <div className="flex flex-wrap gap-2 text-base">
        {d.url && (
          <button onClick={() => onOpenLink(d.url!, card.title)} className="rounded-md border border-cyan-500/50 px-3 py-1.5 text-cyan-100 hover:bg-cyan-400/10">
            公式ページ
          </button>
        )}
        {d.query && (
          <button onClick={() => setShowMap((v) => !v)} className="rounded-md border border-cyan-500/50 px-3 py-1.5 text-cyan-100 hover:bg-cyan-400/10">
            {showMap ? "地図を閉じる" : "地図"}
          </button>
        )}
        {d.query && (
          <button onClick={() => onOpenChrome(mapOpenUrl(d.query!), `${card.title}の地図`)} className="flex items-center gap-1.5 rounded-md border border-slate-600 px-3 py-1.5 hover:bg-slate-800">
            <ExternalIcon className="h-4 w-4" />
            Google マップ
          </button>
        )}
      </div>
    </div>
  );
}

/** スマホの施設カード（要点だけ。押すと公式ページ・地図のアプリ） */
function PlaceCompact({ card, open }: { card: Card; open: (url: string, title: string) => void }) {
  const d = card.data;
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2.5">
        {d.image && <Photo src={d.image} alt={d.url ?? card.title} className="h-14 w-20 shrink-0 rounded" />}
        <div className="min-w-0 flex-1 text-xs leading-snug">
          {d.area && <p className="text-slate-400">{d.area}</p>}
          {d.hours && (
            <p className="line-clamp-2 text-slate-200">
              🕘 <Emph text={d.hours} />
            </p>
          )}
          {!!d.prices?.length && (
            <p className="line-clamp-2 text-slate-200">
              ¥ {d.prices.slice(0, 3).map((p) => `${p.label} ${p.value}`).join("・")}
            </p>
          )}
        </div>
      </div>
      {!!d.points?.length && (
        <p className="line-clamp-2 text-xs text-slate-300">
          <Emph text={d.points.join("・")} />
        </p>
      )}
      <AreaWeather area={d.area} compact />
      <div className="flex gap-2">
        {d.url && (
          <button onClick={() => open(d.url!, card.title)} className="flex-1 rounded-md border border-cyan-500/50 py-1.5 text-xs text-cyan-100 active:bg-cyan-400/10">
            公式ページ
          </button>
        )}
        {d.query && (
          <button onClick={() => open(mapOpenUrl(d.query!), card.title)} className="flex-1 rounded-md border border-cyan-500/50 py-1.5 text-xs text-cyan-100 active:bg-cyan-400/10">
            地図のアプリ
          </button>
        )}
      </div>
    </div>
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
  return <img src={src} alt={alt} draggable={false} referrerPolicy="no-referrer" loading="eager" onError={() => setBad(true)} className={className + " object-cover"} />;
}
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

function CardView({
  card,
  side,
  onClose,
  onPin,
  onOpenLink,
  onOpenChrome,
  onOpenPage,
  onUpdate,
  onGrab,
  renderChat,
  floating = false,
  weather,
  place,
  session,
}: Props & { card: Card; side: "left" | "right"; onGrab: (card: Card, e: ReactPointerEvent, mode: "move" | "resize") => void; floating?: boolean }) {
  const head = { weather: "WEATHER", date: "DATE", schedule: "SCHEDULE", list: "NEWS", video: "VIDEO", points: "POINTS", page: "PAGE", image: "IMAGE", text: "NOTE", stats: "DATA", map: "MAP", talk: "HISTORY", chat: "CHAT", web: "WEB", place: "SPOT", week: "WEEK" }[card.kind];
  return (
    <div
      data-card-id={card.id}
      onPointerDown={() => floating && onUpdate(card.id, { at: Date.now() + 1e13 })}
      className={
        (floating ? "relative flex min-h-0 flex-1 flex-col overflow-hidden " : "") +
        "pointer-events-auto shrink-0 rounded-xl border bg-slate-950/88 p-4 text-lg text-slate-100 shadow-[0_0_32px_rgba(34,211,238,0.18)] backdrop-blur " +
        (card.pinned ? "border-cyan-300/80" : "border-cyan-400/35") +
        (side === "right" ? " dimy-card-in-right" : " dimy-card-in-left")
      }
    >
      <div
        onPointerDown={(e) => onGrab(card, e, "move")}
        className="mb-3 flex shrink-0 cursor-grab touch-none select-none items-center gap-3"
        title="帯をつかんで、好きな場所へ動かせます"
      >
        {card.data.chatgpt && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onUpdate(card.id, { collapsed: !card.collapsed })}
            title={card.collapsed ? "広げる" : "上へ折りたたむ"}
            aria-label={card.collapsed ? "広げる" : "上へ折りたたむ"}
            className="-ml-1 rounded p-1 text-cyan-300 hover:bg-cyan-400/15 hover:text-cyan-50"
          >
            <svg viewBox="0 0 20 20" className={"h-5 w-5 transition-transform " + (card.collapsed ? "rotate-180" : "")}>
              <path d="M5 12l5-5 5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <span className="font-mono text-xs tracking-[0.3em] text-cyan-400/80">{head}</span>
        <span className="min-w-0 flex-1 truncate text-xl font-semibold text-cyan-50">{card.title}</span>
        {card.kind === "web" && card.data.url && (
          <button onClick={() => onOpenChrome(card.data.url!, card.title)} title="Chrome で開く" className="p-1 text-cyan-400/70 hover:text-cyan-100">
            <ExternalIcon className="h-5 w-5" />
          </button>
        )}
        <button onClick={() => onPin(card.id)} title={card.pinned ? "残すのをやめる" : "残す（次の質問でも消えない）"} className={"p-1 " + (card.pinned ? "text-cyan-100" : "text-cyan-400/60 hover:text-cyan-100")}>
          <PinIcon className="h-5 w-5" />
        </button>
        <button onClick={() => onClose(card.id)} title="閉じる" className="p-1 text-cyan-400/70 hover:text-cyan-100">
          <CloseIcon className="h-6 w-6" />
        </button>
      </div>
      {card.kind === "chat" ? (
        <div className="-mx-4 -mb-4 min-h-0 flex-1 overflow-hidden text-base">{renderChat()}</div>
      ) : card.kind === "web" ? (
        <div className={"-mx-4 -mb-4 overflow-hidden rounded-b-xl " + (card.collapsed ? "hidden" : floating ? "min-h-0 flex-1" : "aspect-[4/3]")}>
          <WebFrame url={card.data.url ?? ""} title={card.title} image={card.data.image} onOpen={() => onOpenChrome(card.data.url ?? "", card.title)} />
        </div>
      ) : (
      <div className={floating ? "-mr-2 min-h-0 flex-1 overflow-y-auto pr-2 [scrollbar-width:thin]" : ""}>
        <CardBody card={card} onOpenLink={onOpenLink} onOpenChrome={onOpenChrome} onOpenPage={onOpenPage} weather={weather} place={place} session={session} />
      </div>
      )}
      {floating && !card.collapsed && (
        <div
          onPointerDown={(e) => onGrab(card, e, "resize")}
          className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize touch-none"
          title="角をつかんで、大きさを変えられます"
        >
          <svg viewBox="0 0 20 20" className="h-full w-full text-cyan-300/70">
            <path d="M18 8v10H8M18 13v5h-5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </div>
      )}
    </div>
  );
}

/** カードの中身（メイン画面のカードと、パレットへ移したカードの両方で使う） */
export function CardBody({
  card,
  onOpenLink,
  onOpenChrome = onOpenLink,
  onOpenPage,
  weather,
  place,
  session,
}: {
  card: Card;
  onOpenLink: (url: string, title: string) => void;
  onOpenChrome?: (url: string, title: string) => void;
  onOpenPage: (url: string, title: string) => void;
  weather: Weather | null;
  place: Place | null;
  session: Session;
}) {
  return (
    <>
      {/* 数字・要点・文のカードにも、話の中身が伝わる写真を上に出す（利用者の希望: 文字だけだと見づらい） */}
      {PHOTO_KINDS.includes(card.kind) && card.data.image && (
        <Photo src={card.data.image} alt={card.data.links?.[0]?.url ?? card.title} className="mb-3 aspect-[16/7] w-full rounded-lg" />
      )}
      {card.kind === "weather" && <WeatherCard weather={weather} place={place} />}
      {card.kind === "week" && <WeekWeatherCard place={place} />}
      {card.kind === "date" && <DateCard />}
      {card.kind === "schedule" && <ScheduleCard session={session} />}
      {card.kind === "chat" && <p className="text-base text-slate-400">会話は、メイン画面の会話のカードで使えます。</p>}
      {card.kind === "web" && card.data.url && (
        <div className="h-full min-h-[300px]">
          <WebFrame url={card.data.url} title={card.title} />
        </div>
      )}
      {card.kind === "talk" && (
        <div className="space-y-3">
          {card.data.at && <div className="font-mono text-sm text-cyan-300/80">{new Date(card.data.at).toLocaleString("ja-JP", { timeZone: TZ, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>}
          <div className="rounded-lg bg-cyan-700/40 px-3 py-2 leading-snug">
            <span className="mr-2 text-sm text-cyan-200">あなた</span>
            {card.data.q}
          </div>
          {card.data.a && (
            <div className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-800/60 px-3 py-2 leading-relaxed">
              <span className="mr-2 text-sm text-cyan-300">DIMY</span>
              <Emph text={card.data.a} />
            </div>
          )}
        </div>
      )}
      {card.kind === "list" && <ListCard card={card} onOpenLink={onOpenLink} />}
      {card.kind === "map" && <MapCard card={card} onOpenLink={onOpenLink} />}
      {card.kind === "place" && <PlaceCard card={card} onOpenLink={onOpenLink} onOpenChrome={onOpenChrome} />}
      {card.kind === "stats" && (
        <div className="@container"><div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
          {card.data.stats?.map((s, i) => (
            <div key={i} className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-2">
              <div className="truncate text-sm text-cyan-300/80">{s.label}</div>
              <div className="whitespace-nowrap font-mono text-2xl font-bold leading-tight text-white @[30rem]:text-3xl">
                {s.value}
                {s.unit && <span className="ml-1 text-lg font-semibold text-cyan-200">{s.unit}</span>}
              </div>
              {s.change && <div className={"font-mono text-base font-bold " + changeColor(s.change)}>{s.change}</div>}
              {/* 直近の推移（利用者の決まり: 価格とグラフをセットで） */}
              {s.series && s.series.length >= 2 && (
                <div className="mt-1">
                  <Sparkline values={s.series} className="h-12 w-full" />
                  {s.seriesFrom && s.seriesTo && (
                    <div className="flex justify-between font-mono text-[11px] text-slate-500">
                      <span>{s.seriesFrom.slice(5).replace("-", "/")}</span>
                      <span>{s.seriesTo.slice(5).replace("-", "/")}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div></div>
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
      {card.kind === "image" && <ImageCard card={card} onOpenChrome={onOpenChrome} />}
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
            <button onClick={() => onOpenChrome(card.data.url!, card.title)} className="flex items-center gap-1.5 rounded-md border border-slate-600 px-3 py-1.5 hover:bg-slate-800">
              <ExternalIcon className="h-4 w-4" />
              Chrome で開く
            </button>
          </div>
        </div>
      )}
      {!!card.data.links?.length && <LinkChips card={card} onOpenLink={onOpenLink} />}
    </>
  );
}

/** ニュースなどの一覧。写真があれば、1 件目を大きく、残りを 2 列の写真つきで並べる */
function ListCard({ card, onOpenLink }: { card: Card; onOpenLink: (url: string, title: string) => void }) {
  const items = card.data.items ?? [];
  const open = (it: (typeof items)[number]) => it.url && onOpenLink(it.url, it.title);
  const drag = (it: (typeof items)[number]) =>
    it.url
      ? // 拡張機能があれば、取り出したリンクはページそのもの（web）のカードにする
        dragOut(
          hasDimyExtension()
            ? { from: card.id, kind: "web", title: it.title, data: { url: it.url } }
            : { from: card.id, kind: "page", title: it.title, data: { url: it.url, image: it.image, note: it.note } },
        )
      : {};
  if (!items.some((it) => it.image))
    return (
      <ol className="space-y-2.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-3" {...drag(it)} title={it.url ? "押すと開きます。カードの外へドラッグすると、これだけのカードにして残します" : undefined}>
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
      <button onClick={() => open(first)} {...drag(first)} title="押すと開きます。カードの外へドラッグすると、これだけのカードにして残します" className="group block w-full text-left">
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
            <button key={i} onClick={() => open(it)} {...drag(it)} title="押すと開きます。カードの外へドラッグすると、これだけのカードにして残します" className="group text-left">
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

/** カードのリンク（公式サイト・情報元など）。押すと開く。カードの外へ引っ張り出すと、そのページのカードにしてピン留めできる */
function LinkChips({ card, onOpenLink }: { card: Card; onOpenLink: (url: string, title: string) => void }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {card.data.links!.map((l, i) => (
        <button
          key={i}
          onClick={() => onOpenLink(l.url, l.title)}
          {...dragOut(
            hasDimyExtension()
              ? { from: card.id, kind: "web", title: l.title, data: { url: l.url } }
              : { from: card.id, kind: "page", title: l.title, data: { url: l.url } },
          )}
          title={`${l.url}（押すと開きます。カードの外へドラッグすると、このページのカードにして残します）`}
          className="flex max-w-full items-center gap-1.5 rounded-full border border-cyan-400/40 bg-cyan-400/5 px-3 py-1 text-sm text-cyan-100 hover:border-cyan-300/80 hover:bg-cyan-400/15"
        >
          <ExternalIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{l.title}</span>
        </button>
      ))}
    </div>
  );
}

/** 写真（言葉で探した写真は、2 列で並べる。出典は Wikimedia Commons） */
function ImageCard({ card, onOpenChrome }: { card: Card; onOpenChrome?: (url: string, title: string) => void }) {
  const d = card.data;
  // デスクトップ（拡張機能あり）では、Google 画像検索の結果をそのまま出す（写真を探す待ち時間がなく、ひと目でイメージが伝わる。利用者の案）
  if (d.query && hasDimyExtension())
    return (
      <div className="-mx-4 -mb-4 aspect-[4/3] overflow-hidden rounded-b-xl">
        <WebFrame url={googleImagesUrl(d.query)} title={card.title} />
      </div>
    );
  const google = d.query && onOpenChrome && (
    <button onClick={() => onOpenChrome(googleImagesUrl(d.query!), card.title)} className="flex items-center gap-1.5 rounded-md border border-slate-600 px-3 py-1.5 text-base hover:bg-slate-800">
      <ExternalIcon className="h-4 w-4" />
      Google 画像で見る
    </button>
  );
  if (d.images?.length)
    return (
      <div className="space-y-1.5">
        <div className={"grid gap-2 " + (d.images.length > 1 ? "grid-cols-2" : "")}>
          {d.images.map((im, i) => (
            <a key={i} href={im.page || im.url} target="_blank" rel="noopener" title={im.title}>
              <Photo src={im.url} alt={im.title} className={(d.images!.length > 1 ? "aspect-[4/3]" : "max-h-[50vh]") + " w-full rounded-lg"} />
            </a>
          ))}
        </div>
        {d.note && <p className="text-base text-slate-300">{d.note}</p>}
        <div className="flex items-center justify-between gap-2">
          {google || <span />}
          <p className="text-xs text-slate-500">写真: Wikimedia Commons</p>
        </div>
      </div>
    );
  if (d.url) return <Photo src={d.url} alt={card.title} className="max-h-[60vh] w-full rounded-lg !object-contain" />;
  return (
    <div className="space-y-2">
      <p className="text-base text-slate-400">写真を探しています…</p>
      {google}
    </div>
  );
}

/** ディミの画面の中で開いた Web ページ（拡張機能が「中に表示しないで」の印を外す） */
function WebFrame({ url, title, image, onOpen }: { url: string; title: string; image?: string; onOpen?: () => void }) {
  // 拡張機能がない端末（ノート・スマホ）は、ページの代わりに見出しの写真と「ページを開く」を出す
  if (!hasDimyExtension())
    return (
      <div className="flex h-full flex-col">
        <Photo src={image} alt={url} className="min-h-0 w-full flex-1" />
        <button onClick={onOpen} className="flex items-center justify-center gap-2 border-t border-cyan-400/20 py-3 text-base text-cyan-100 hover:bg-cyan-400/10">
          <ExternalIcon className="h-4 w-4" />
          ページを開く（{host(url)}）
        </button>
      </div>
    );
  return (
    <iframe
      src={url}
      title={title}
      sandbox={WEB_FRAME_SANDBOX}
      allow="autoplay; fullscreen; clipboard-read; clipboard-write; encrypted-media; picture-in-picture; geolocation"
      className="h-full w-full bg-white"
    />
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
        <iframe key={p.query + (p.from ?? "")} src={mapEmbedUrl(p.query, 14, p.from)} title={p.name} className="h-full w-full" loading="eager" referrerPolicy="no-referrer-when-downgrade" />
      </div>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 cursor-grab" {...dragOut({ from: card.id, kind: "map", title: p.name, data: { places: [p] } })} title="カードの外へドラッグすると、この場所だけの地図のカードにして残します">
          <div className="text-xl font-bold leading-snug text-white">
            {places.length > 1 && <span className="mr-2 font-mono text-cyan-300">{sel + 1}</span>}
            {p.name}
          </div>
          {p.from && <p className="text-sm text-cyan-300/80">{p.from} からの道順</p>}
          {p.note && (
            <p className="text-base leading-snug text-slate-300">
              <Emph text={p.note} />
            </p>
          )}
        </div>
        <button onClick={() => onOpenLink(p.from ? mapDirUrl(p.query, p.from) : mapOpenUrl(p.query), `${p.name}の地図`)} className="flex shrink-0 items-center gap-1.5 rounded-md border border-slate-600 px-3 py-1.5 text-base hover:bg-slate-800">
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
              {...dragOut({ from: card.id, kind: "map", title: x.name, data: { places: [x] } })}
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

function WeatherCard({ weather: given, place: givenPlace }: { weather: Weather | null; place: Place | null }) {
  // パレットへ移したカードでは、地域を設定から読む
  const [place] = useState<Place | null>(() => {
    if (givenPlace) return givenPlace;
    try {
      return JSON.parse(getPref("weatherPlace") ?? "null") as Place | null;
    } catch {
      return null;
    }
  });
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
  // 今の天気（メイン画面からもらえないときは、1 時間ごとの予報の今の分を使う）
  const weather: Weather | null =
    given ??
    (hours[0] && sun ? { temperature: hours[0].temperature, code: hours[0].code, max: sun.max, min: sun.min, rain: sun.rain, source: "Open-Meteo" } : null);
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

/** 地域（カードに渡されないとき＝パレットなどでは、設定から読む） */
function usePlace(given: Place | null): Place | null {
  const [place] = useState<Place | null>(() => {
    if (given) return given;
    try {
      return JSON.parse(getPref("weatherPlace") ?? "null") as Place | null;
    } catch {
      return null;
    }
  });
  return place;
}

/**
 * 週間の天気（利用者の決まり: 1 週間より少し長い 2 週間分を、晴れ・雨のマークで週間カレンダーのように見せる。文字だけにしない）。
 * 曜日の列（日〜土）にそろえ、今日から 14 日分。気象庁の週間予報がある日は気象庁、それ以外は Open-Meteo。
 */
function WeekWeatherCard({ place: given, compact = false }: { place: Place | null; compact?: boolean }) {
  const place = usePlace(given);
  const [days, setDays] = useState<DayWeather[] | null>(null);
  const [jma, setJma] = useState<JmaResult | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!place) return;
    fetchDaily(place, 14).then(setDays).catch((e) => setError(String(e?.message ?? e)));
    fetchJma(place).then(setJma).catch(() => {});
  }, [place]);
  if (!place) return <p className="text-slate-400">天気の地域が決まっていません（設定 →「表示」）。</p>;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
  // 気象庁の予報で上書きした 1 日分
  type Cell = { date: string; code: number; max: number | null; min: number | null; rain: number | null };
  const merged: Cell[] = (days ?? [])
    .filter((d) => d.date >= today)
    .slice(0, 14)
    .map((d) => {
      const j = jma?.forecast.days.find((x) => x.date === d.date) ?? jma?.forecast.week.find((x) => x.date === d.date);
      return { date: d.date, code: j?.wmo ?? d.code, max: j?.max ?? d.max, min: j?.min ?? d.min, rain: j?.pop ?? d.rain };
    });
  // Open-Meteo が取れなくても、気象庁の週間予報だけで出す
  if (!merged.length && jma) {
    for (const j of [...jma.forecast.days, ...jma.forecast.week]) {
      if (j.date >= today && !merged.some((m) => m.date === j.date)) merged.push({ date: j.date, code: j.wmo, max: j.max, min: j.min, rain: j.pop });
    }
    merged.sort((a, b) => a.date.localeCompare(b.date));
  }
  if (!merged.length) return <p className="text-slate-400">{error || "週間の天気を読み込んでいます…"}</p>;
  const wd = (date: string) => new Date(`${date}T12:00:00+09:00`).getUTCDay();
  if (compact) {
    return (
      <div className="flex gap-1 overflow-x-auto">
        {merged.slice(0, 8).map((c) => (
          <div key={c.date} className="flex w-10 shrink-0 flex-col items-center text-[11px]">
            <span className={wd(c.date) === 0 ? "text-rose-300" : wd(c.date) === 6 ? "text-sky-300" : "text-cyan-200"}>{Number(c.date.slice(8))}</span>
            <WeatherArt code={c.code} size={24} />
            <span className="font-mono text-rose-300">{c.max === null ? "-" : Math.round(c.max)}</span>
          </div>
        ))}
      </div>
    );
  }
  // 曜日の列にそろえる（最初の週は今日より前を空ける）
  const lead = wd(merged[0].date);
  const cells: (Cell | null)[] = [...Array.from({ length: lead }, () => null), ...merged];
  while (cells.length % 7) cells.push(null);
  const names = ["日", "月", "火", "水", "木", "金", "土"];
  const color = (i: number) => (i === 0 ? "text-rose-300" : i === 6 ? "text-sky-300" : "text-cyan-200");
  return (
    <div className="@container space-y-2">
      <div className="grid grid-cols-7 gap-1 text-center">
        {names.map((n, i) => (
          <div key={n} className={"text-sm font-bold " + color(i)}>
            {n}
          </div>
        ))}
        {cells.map((c, i) =>
          c ? (
            <div key={c.date} className={"flex flex-col items-center rounded-md py-1.5 " + (c.date === today ? "bg-cyan-400/20 ring-1 ring-cyan-300/60" : "bg-slate-800/50")}>
              <span className={"font-mono text-sm " + color(i % 7)}>
                {c.date === today ? "今日" : `${Number(c.date.slice(5, 7))}/${Number(c.date.slice(8))}`}
              </span>
              <WeatherArt code={c.code} size={36} />
              <span className="hidden text-[11px] leading-tight text-slate-300 @[520px]:block">{weatherLabel(c.code)}</span>
              <span className="font-mono text-base leading-tight">
                <b className="text-rose-300">{c.max === null ? "-" : Math.round(c.max)}</b>
                <span className="text-slate-500">/</span>
                <b className="text-sky-300">{c.min === null ? "-" : Math.round(c.min)}</b>
              </span>
              <span className={"font-mono text-xs " + ((c.rain ?? 0) >= 50 ? "font-bold text-sky-300" : "text-sky-300/70")}>☂{c.rain ?? "-"}%</span>
            </div>
          ) : (
            <div key={`e${i}`} />
          ),
        )}
      </div>
      <div className="flex justify-between text-sm text-slate-400">
        <span>
          {place.name}
          {jma ? "・気象庁（週間予報の範囲）＋Open-Meteo" : "・Open-Meteo"}
        </span>
        <a href={yahooWeatherUrl(place.name)} target="_blank" rel="noopener" className="text-cyan-300 hover:underline">
          Yahoo!天気
        </a>
      </div>
    </div>
  );
}

/** 上げ下げの色（上げは緑・下げは赤） */
function changeColor(change: string) {
  return /^\s*[-−▼]/.test(change) ? "text-rose-300" : /^\s*[+＋▲]/.test(change) ? "text-emerald-300" : "text-slate-300";
}

/** 直近の推移の小さなグラフ（線と、下を薄く塗る。最初より上がっていれば緑・下がっていれば赤） */
function Sparkline({ values, className = "" }: { values: number[]; className?: string }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const W = 100;
  const H = 30;
  const pts = values.map((v, i) => [Math.round((i / (values.length - 1)) * W * 10) / 10, Math.round((H - 2 - ((v - min) / span) * (H - 4)) * 10) / 10]);
  const line = pts.map(([x, y]) => `${x},${y}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  const color = up ? "#6ee7b7" : "#fda4af";
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} aria-label={`推移 ${values[0]} → ${values[values.length - 1]}`}>
      <polygon points={`0,${H} ${line} ${W},${H}`} fill={color} opacity="0.12" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="1.8" fill={color} />
    </svg>
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
