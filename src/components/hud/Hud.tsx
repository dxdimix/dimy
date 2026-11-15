"use client";

// ディミのメイン画面（声が中心）。文字は最小限にし、操作はアイコンだけ。
// - 中央: 光る球体とリング。周りをデータが流れ続ける
// - 下中央: マイク。左下: 日時。右下: 天気。左上: PC の状態
// - 右上のアイコン: 会話（履歴と文字入力のパネル）、ブックマーク、覚えていること、設定、全画面
//   読み上げ・声・呼びかけなどの設定は、すべて設定の画面（Settings.tsx）にまとめる

import { captureScreen, shrinkImage, useDimyExtension, useIsDimyPc } from "@/lib/extension";
import { Showcase } from "./Showcase";
import { BUILTIN_TITLE, builtinCardsFor, chatCard, webCard, clampFloat, snapshotCards, type Card, type CardData, type CardDrag, type CardKind } from "@/lib/cards";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { Message } from "@/lib/types";
import { takeSpeakable } from "@/lib/speech";
import { fetchJma, fetchWeather, findPlace, weatherLabel, yahooWeatherUrl, type Place, type Weather, type WeatherSource } from "@/lib/weather";
import { useAgentOnline } from "@/hooks/useAgentOnline";
import { useSpeaker } from "@/hooks/useSpeaker";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useWakeWord } from "@/hooks/useWakeWord";
import { useAutoReload } from "@/hooks/useAutoReload";
import { deviceId, getPref, initPrefs, setPref, usePrefsVersion } from "@/lib/prefs";
import { useActiveDevice } from "@/hooks/useActiveDevice";
import { isEcho, toSpeech } from "@/lib/wake";
import {
  extractAccount,
  matchSession,
  parseMoveCommand,
  parseOpenSite,
  parseSearchCommand,
  parseSessionCommand,
  searchUrl,
  stripBrowser,
} from "@/lib/commands";
import { loadPcState, sendPcCommand, type PcState } from "@/lib/pc";
import { loadUserSetting, NICKNAMES_KEY, saveUserSetting, SITE_ACCOUNTS_KEY as SHARED_SITE_ACCOUNTS_KEY } from "@/lib/userSettings";
import { boardLabel, loadPins, newPinId, savePins, sendPin, type Pin } from "@/lib/pins";
import { Chat } from "@/components/Chat";
import { APPS, detectOpenCommand } from "@/lib/apps";
import { matchBookmark, type Bookmark } from "@/lib/bookmarks";
import { AppDock, AppWindows, useAppWindows } from "./AppWindows";
import { Ring, type RingMode, type RingTone } from "./Ring";
import { DataField } from "./DataField";
import { Settings } from "./Settings";
import { HudChrome } from "./HudChrome";
import { WeatherPanel } from "./WeatherPanel";
import { CalendarPanel } from "./CalendarPanel";
import { DismissBox } from "./DismissBox";
import { AdminPanel } from "./AdminPanel";
import { logActivity } from "@/lib/activity";
import { DropOverlay, PinBoard, usePinBoard, usePinDrop } from "@/components/pins/PinBoard";
import { PinAdd } from "@/components/pins/PinAdd";
import { ScreenPicker } from "@/components/pins/ScreenPicker";
import {
  ChatIcon,
  CloseIcon,
  ExpandIcon,
  GearIcon,
  MemoryIcon,
  AdminIcon,
  PaletteIcon,
  PinIcon,
  BookmarkIcon,
  MicIcon,
  PcIcon,
  ShrinkIcon,
  StopIcon,
  WeatherIcon,
} from "./Icons";

const PLACE_KEY = "dimy.weatherPlace";
const SPEAK_KEY = "dimy.speak";
const WAKE_KEY = "dimy.wake"; // 「ディミ」の呼びかけを待つか（端末ごと。最初はオフ）
const VOICE_KEY = "dimy.voice";
const RATE_KEY = "dimy.rate"; // 話す速さ
const PITCH_KEY = "dimy.pitch"; // 声の高さ
const VOLUME_KEY = "dimy.volume"; // ディミの声の大きさ（PC 全体の音量とは別）
const SITE_ACCOUNTS_KEY = "dimy.siteAccounts"; // サイトごとに開く Chrome のプロフィール（{ サイト名: プロフィールのフォルダ名 }。"*" は指定がないとき）
const SILENCE_KEY = "dimy.silenceSec"; // 話し終わりとみなすまでの無音の時間（秒）
// 返事のあと、続けて話せる時間（秒）。利用者の決まりで、既定は 0 = 返事が終わったらマイクを切る
// （以前の既定 8 秒が保存されていても使わないよう、名前を変えた）
const FOLLOW_KEY = "dimy.followSecV2";
const HOTKEY_KEY = "dimy.hotkey"; // 右 Ctrl を 2 回で話すか
const CAPTION_KEY = "dimy.captionSec"; // 返事の字幕を出しておく時間（秒）

// 設定はデータベースに保存する（どの端末でも共通。src/lib/prefs.ts）。名前の頭の「dimy.」は付けない
function load(key: string) {
  return getPref(key.replace(/^dimy\./, ""));
}
function save(key: string, value: string) {
  setPref(key.replace(/^dimy\./, ""), value);
}
function loadNumber(key: string, fallback: number) {
  const v = load(key);
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const iconBtn =
  "grid h-11 w-11 place-items-center rounded-full border border-cyan-400/25 bg-slate-950/50 text-cyan-300 backdrop-blur transition hover:border-cyan-300/70 hover:text-cyan-100 hover:shadow-[0_0_18px_rgba(34,211,238,0.35)]";

function useNow() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function useWeather(place: Place | null, source: WeatherSource) {
  const [weather, setWeather] = useState<Weather | null>(null);
  useEffect(() => {
    if (!place) return;
    let cancelled = false;
    // 気象庁を選んでいるとき: 今の気温は Open-Meteo、今日の天気・最高 / 最低・降水確率は気象庁（取れなければ Open-Meteo のまま）
    const run = () =>
      Promise.all([fetchWeather(place), source === "jma" ? fetchJma(place).catch(() => null) : Promise.resolve(null)])
        .then(([w, j]) => {
          if (cancelled) return;
          const today = j?.forecast.days[0];
          if (!today) return setWeather(w);
          setWeather({
            ...w,
            code: today.wmo,
            text: today.weather,
            max: today.max ?? w.max,
            min: today.min ?? j?.forecast.week.find((d) => d.date === today.date)?.min ?? w.min,
            rain: today.pop ?? w.rain,
            source: "気象庁",
          });
        })
        .catch(() => {});
    run();
    const t = setInterval(run, 30 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [place, source]);
  return weather;
}

/** マイクで聞いている間のボタンの印（押すと話し終わって送る。止める印と区別するため） */
function SendGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}

export function Hud({ supabase, session }: { supabase: SupabaseClient; session: Session }) {
  const online = useAgentOnline(supabase);
  // ディミの画面が複数開いているときは、最後に操作した画面だけが話す・聞く
  const { leader: isLeader, leaderRef } = useActiveDevice(supabase);
  const now = useNow();
  const [messages, setMessages] = useState<Message[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  // いまの会話（あなたの発言）と、その間に出たカード。次の会話に移ってもカードを呼び出せるよう、表 card_snapshots に控える
  const turnRef = useRef<{ id: string; cards: Map<string, Card> } | null>(null);
  const [panel, setPanel] = useState<"none" | "chat" | "settings" | "bookmarks" | "pin" | "palette" | "weather" | "calendar" | "admin">("none");
  const panelRef = useRef(panel);
  // Chrome のブックマーク（PC のディミが写したもの）。表がまだないときは空のまま
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const bookmarksRef = useRef<Bookmark[]>([]);
  const [bookmarkQuery, setBookmarkQuery] = useState("");
  // ブラウザに別タブを止められたときに、押して開くためのリンク
  const [pendingLink, setPendingLink] = useState<Bookmark | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [speakOn, setSpeakOn] = useState(true);
  const [wakeOn, setWakeOn] = useState(false);
  const [followSec, setFollowSec] = useState(0);
  const [silenceSec, setSilenceSec] = useState(1.5);
  const [hotkeyOn, setHotkeyOn] = useState(true);
  const [captionSec, setCaptionSec] = useState(12);
  // 返事を言い終えたら、続けて話せる状態にする（呼びかけを待つ設定のとき）
  const followUpAfterSpeech = useRef(false);
  const wakeRef = useRef<{ followUp: () => void; reset: () => void } | null>(null);
  // 強制停止した発言（この発言への返事は、あとから届いても読み上げない）
  const stoppedReplies = useRef(new Set<string>());
  // 最近読み上げた文（マイクが拾った自分の声を見分けるため）
  const recentSpoken = useRef<{ text: string; at: number }[]>([]);
  // 常駐プログラムへの合図（強制停止）を送るチャンネル
  const controlRef = useRef<ReturnType<SupabaseClient["channel"]> | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [error, setError] = useState("");
  const [captionUntil, setCaptionUntil] = useState(0);
  // 天気の元（設定の「表示」タブ。既定は気象庁）
  const weatherSource: WeatherSource = getPref("weatherSource") === "open-meteo" ? "open-meteo" : "jma";
  const weather = useWeather(place, weatherSource);
  const liveIds = useRef(new Set<string>());
  const spokenUpTo = useRef(new Map<string, number>());

  // Google カレンダーのログインから戻ってきたとき: 結果を知らせて、カレンダーを開く
  useEffect(() => {
    const g = new URLSearchParams(location.search).get("google");
    if (!g) return;
    history.replaceState(null, "", location.pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPanel("calendar");
    if (!g.startsWith("connected")) setError(`Google カレンダーとつなげませんでした（${g}）`);
  }, []);

  // 設定を読む（データベースから。ほかの端末で変わったときも、ここで読み直す）
  const prefsVersion = usePrefsVersion();
  useEffect(() => {
    initPrefs(supabase);
  }, [supabase]);
  useEffect(() => {
    const p = load(PLACE_KEY);
    /* eslint-disable react-hooks/set-state-in-effect */
    if (p) setPlace(JSON.parse(p) as Place);
    setSpeakOn(load(SPEAK_KEY) !== "off");
    setWakeOn(load(WAKE_KEY) === "on");
    setFollowSec(loadNumber(FOLLOW_KEY, 0));
    setSilenceSec(Math.min(3, Math.max(0.5, loadNumber(SILENCE_KEY, 1.5)))); // 0.5〜3 秒
    setHotkeyOn(load(HOTKEY_KEY) !== "off");
    setCaptionSec(loadNumber(CAPTION_KEY, 12));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [prefsVersion]);

  // 会話：直近の分を読み、変化を Realtime で受け取る
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(`会話を読み込めませんでした: ${error.message}`);
        else setMessages((data as Message[]).reverse());
      });
    const channel = supabase
      .channel("hud-messages")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) => {
        if (payload.eventType === "INSERT" && (payload.new as Message).role === "assistant") {
          liveIds.current.add((payload.new as Message).id);
        }
        // 新しい発言: 残していないカードを片付け、言葉から分かるカード（天気・日付・予定）をすぐ出す
        if (payload.eventType === "INSERT" && (payload.new as Message).role === "user") {
          const kinds = builtinCardsFor((payload.new as Message).content);
          turnRef.current = { id: (payload.new as Message).id, cards: new Map() };
          setCards((prev) => [
            ...prev.filter((c) => c.pinned),
            ...kinds.map((k) => ({ id: `builtin-${k}-${(payload.new as Message).id}`, kind: k, title: BUILTIN_TITLE[k], data: {}, pinned: false, at: Date.now() })),
          ]);
          if (kinds.length) logActivity(supabase, "card", `画面のカード: ${kinds.map((k) => BUILTIN_TITLE[k]).join("・")}`);
        }
        setMessages((prev) => {
          if (payload.eventType === "DELETE") return prev.filter((m) => m.id !== (payload.old as Message).id);
          const row = payload.new as Message;
          const i = prev.findIndex((m) => m.id === row.id);
          if (i === -1) return [...prev, row].slice(-10);
          const next = prev.slice();
          next[i] = row;
          return next;
        });
      })
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  // 画面のカード: DIMY が show_card で出したもの（表 cards）を受け取る
  useEffect(() => {
    const channel = supabase
      .channel("hud-cards")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cards" }, (payload) => {
        const row = payload.new as { id: string; kind: CardKind; title: string; data: CardData };
        setCards((prev) => (prev.some((c) => c.id === row.id) ? prev : [...prev, { id: row.id, kind: row.kind, title: row.title, data: row.data ?? {}, pinned: false, at: Date.now() }]));
        logActivity(supabase, "card", `画面のカード（DIMY）: ${row.kind} ${row.title}`);
      })
      // あとから写真が書き足されたとき
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "cards" }, (payload) => {
        const row = payload.new as { id: string; data: CardData };
        setCards((prev) => prev.map((c) => (c.id === row.id ? { ...c, data: row.data ?? c.data } : c)));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  // 会話の控え: その会話の間に出たカードを、閉じたものも含めて残す（1 秒まとめて書く）
  useEffect(() => {
    const turn = turnRef.current;
    if (!turn || !cards.length) return;
    let added = false;
    for (const c of snapshotCards(cards)) {
      if (!turn.cards.has(c.id)) added = true;
      turn.cards.set(c.id, c);
    }
    if (!added) return;
    const t = setTimeout(() => {
      supabase
        .from("card_snapshots")
        .upsert({ message_id: turn.id, cards: [...turn.cards.values()], updated_at: new Date().toISOString() })
        .then(({ error }) => {
          if (error) logActivity(supabase, "error", `カードの控えを残せませんでした: ${error.message}`);
        });
    }, 1000);
    return () => clearTimeout(t);
  }, [cards, supabase]);

  /** 履歴を押したとき: そのときの会話とカードを出し直す（残しているカードはそのまま） */
  const recall = useCallback(
    async (userMessageId: string) => {
      const [{ data: rows }, { data: snap }] = await Promise.all([
        supabase.from("messages").select("*").or(`id.eq.${userMessageId},reply_to.eq.${userMessageId}`).order("created_at"),
        supabase.from("card_snapshots").select("cards").eq("message_id", userMessageId).maybeSingle(),
      ]);
      const list = (rows ?? []) as Message[];
      const q = list.find((m) => m.id === userMessageId);
      if (!q) return;
      const a = list.filter((m) => m.role === "assistant").map((m) => m.content).join("\n\n");
      const old = ((snap?.cards ?? []) as Card[]).map((c) => ({ ...c, id: `r-${userMessageId}-${c.id}`, pinned: false, at: Date.now() }));
      turnRef.current = null; // 呼び出したカードで、いまの会話の控えを書き換えない
      setCards((prev) => [
        ...prev.filter((c) => c.pinned && c.kind !== "talk"),
        { id: `talk-${userMessageId}`, kind: "talk", title: "そのときの会話", data: { q: q.content, a, at: q.created_at }, pinned: false, at: Date.now() },
        ...old.filter((c) => !prev.some((p) => p.pinned && p.id === c.id)),
      ]);
      logActivity(supabase, "card", `履歴から呼び出した: 「${q.content.slice(0, 40)}」（カード ${old.length} 枚）`);
    },
    [supabase],
  );

  // 出ているカードは、この端末に控える。新しい版で画面を自動で読み込み直しても、そのまま戻す（利用者の決まり:
  // 次の会話になるまでは全部残す。ピン留めのカードは消すまで残す）
  const cardsKey = () => `device.${deviceId()}.cards`;
  const cardsLoaded = useRef(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(getPref(cardsKey()) ?? getPref(`device.${deviceId()}.pinnedCards`) ?? "[]") as Card[];
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 開いたときに、出ていたカードを戻す
      if (saved.length) setCards((prev) => [...saved.filter((c) => !prev.some((p) => p.id === c.id)), ...prev]);
    } catch {
      /* 読めなければ何もしない */
    }
    cardsLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!cardsLoaded.current) return;
    const t = setTimeout(() => {
      const next = JSON.stringify(cards);
      if (next !== (getPref(cardsKey()) ?? "[]")) setPref(cardsKey(), next);
    }, 800);
    return () => clearTimeout(t);
  }, [cards]);

  // DIMY の Chrome の拡張機能（入っていれば、ディミの画面の中でどのページも開ける）
  const extVersion = useDimyExtension();
  useEffect(() => {
    logActivity(supabase, "ui", extVersion ? `DIMY の拡張機能: あり（${extVersion}）` : "DIMY の拡張機能: なし");
  }, [extVersion, supabase]);
  /** ページをディミの画面の中で開く（Web のカード。正面に大きく・ピン留め） */
  function openWebCard(url: string, title: string) {
    setCards((prev) => [...prev, webCard(url, title, window.innerWidth, window.innerHeight)]);
    logActivity(supabase, "card", `ページをディミの中で開いた: ${title} ${url}`);
  }

  // 画面の写真（クラウドの開発用セッションから頼まれたとき。表 screen_shots。拡張機能で撮る）
  useEffect(() => {
    const ch = supabase
      .channel("hud-screenshots")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "screen_shots" }, async (payload) => {
        const row = payload.new as { id: string; status: string };
        if (row.status !== "requested" || document.visibilityState !== "visible") return;
        try {
          const image = await shrinkImage(await captureScreen());
          await supabase
            .from("screen_shots")
            .update({ status: "done", image, note: `${window.innerWidth}×${window.innerHeight}`, done_at: new Date().toISOString() })
            .eq("id", row.id)
            .eq("status", "requested");
          logActivity(supabase, "ui", "開発用のセッションに頼まれて、画面の写真を撮った");
        } catch (e) {
          await supabase
            .from("screen_shots")
            .update({ status: "error", note: e instanceof Error ? e.message : String(e), done_at: new Date().toISOString() })
            .eq("id", row.id)
            .eq("status", "requested");
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase]);

  /** 会話（文字入力と会話の履歴）のカードを開く・閉じる。正面に、最初からピン留めで出す（利用者の決まり） */
  const chatOpen = cards.some((c) => c.kind === "chat");
  function toggleChat(open = !chatOpen) {
    setCards((prev) => {
      const has = prev.some((c) => c.kind === "chat");
      if (open && !has) return [...prev, chatCard(window.innerWidth, window.innerHeight)];
      if (!open && has) return prev.filter((c) => c.kind !== "chat");
      return prev;
    });
    logActivity(supabase, "ui", open ? "会話のカードを開いた" : "会話のカードを閉じた");
  }

  /** カードをブラウザのウィンドウの外で離したとき: そのモニターのパレットへ、固定ウィンドウとして移す */
  async function dropCardOut(card: Card, screenX: number, screenY: number, grab: { x: number; y: number }) {
    if (card.kind === "chat") {
      logActivity(supabase, "card", "会話のカードはパレットへ移せない（メイン画面だけで使える）");
      return false;
    }
    const f = card.float ?? { x: 0, y: 0, w: 520 };
    const pin: Pin = { id: newPinId(), kind: "card", card: { ...card, float: undefined, pinned: true }, title: card.title, x: 0, y: 0, w: Math.round(f.w), h: Math.round(f.h ?? 560), z: 10 };
    const opened = pins.dropTo(pin, screenX, screenY, grab);
    const ok = opened || (await pins.dropToNewPalette(pin, screenX, screenY, grab));
    if (ok) setCards((prev) => prev.filter((c) => c.id !== card.id));
    logActivity(
      supabase,
      ok ? "card" : "error",
      ok
        ? `カードをパレットへ移した: ${card.title}（${opened ? "開いていたパレット" : "新しく開いたパレット"}）`
        : `カードをパレットへ移せなかった: ${card.title}（離した場所 ${screenX}, ${screenY}。近くに開いたパレットがなく、新しく開くこともできなかった）`,
    );
    return ok;
  }

  /** カードの中のリンク・場所を外へドラッグしたとき: それだけのカードを作って残す */
  const extractCard = useCallback(
    (c: Omit<CardDrag, "from">, at: { x: number; y: number }) => {
      // 離した場所に置く（帯の真ん中あたりが指の位置に来るように）
      const w = Math.min(520, window.innerWidth - 16);
      const float = clampFloat({ x: at.x - w / 2, y: at.y - 24, w }, window.innerWidth, window.innerHeight);
      setCards((prev) => [...prev, { ...c, id: `x-${Date.now()}`, pinned: true, at: Date.now() + 1e13, float }]);
      logActivity(supabase, "card", `カードから取り出して残した: ${c.title}`);
    },
    [supabase],
  );

  // ブックマークを読む（開いたときと、一覧を開いたとき）
  const loadBookmarks = useCallback(() => {
    supabase
      .from("bookmarks")
      .select("title, url, folder")
      .order("sort")
      .limit(3000)
      .then(({ data, error }) => {
        if (error || !data) return;
        bookmarksRef.current = data as Bookmark[];
        setBookmarks(data as Bookmark[]);
      });
  }, [supabase]);
  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  const speaker = useSpeaker(() => {
    setCaptionUntil(Date.now() + captionSec * 1000);
    if (followUpAfterSpeech.current) {
      followUpAfterSpeech.current = false;
      wakeRef.current?.followUp();
    }
  }, {
    voiceName: load(VOICE_KEY),
    rate: loadNumber(RATE_KEY, NaN) || undefined,
    pitch: loadNumber(PITCH_KEY, NaN) || undefined,
    volume: loadNumber(VOLUME_KEY, NaN),
  });
  const { speak: speakRaw, cancel: cancelSpeech } = speaker;
  // 声・速さ・高さ・大きさも、設定が変わったら（ほかの端末で変えたときも）読み直す
  const { setVoiceName, setRate, setPitch, setVolume } = speaker;
  useEffect(() => {
    const v = load(VOICE_KEY);
    if (v) setVoiceName(v);
    const r = loadNumber(RATE_KEY, NaN);
    if (Number.isFinite(r)) setRate(r);
    const pi = loadNumber(PITCH_KEY, NaN);
    if (Number.isFinite(pi)) setPitch(pi);
    const vo = loadNumber(VOLUME_KEY, NaN);
    if (Number.isFinite(vo)) setVolume(Math.min(1, Math.max(0, vo)));
  }, [prefsVersion, setVoiceName, setRate, setPitch, setVolume]);
  const speak = useCallback(
    (text: string) => {
      // 念のため: 同じ文を 5 秒以内に 2 回読まない
      const norm = (t: string) => t.replace(/[\s、。,.!！?？]/g, "");
      if (recentSpoken.current.some((x) => Date.now() - x.at < 5_000 && norm(x.text) === norm(text))) {
        logActivity(supabase, "speak", `（同じ文を 5 秒以内に読もうとしたので読まなかった）${text}`);
        return;
      }
      logActivity(supabase, "speak", text);
      recentSpoken.current = [...recentSpoken.current.filter((x) => Date.now() - x.at < 60_000), { text, at: Date.now() }];
      speakRaw(text);
    },
    [speakRaw, supabase],
  );

  const appWins = useAppWindows();
  const { open: openApp } = appWins;
  // 画面からのお知らせ（「FX を開きます」など）。字幕に少しだけ出す
  const [notice, setNotice] = useState<{ text: string; until: number } | null>(null);
  const announce = useCallback(
    (text: string, quiet = false) => {
      setNotice({ text, until: Date.now() + 6000 });
      // ボタンで操作したときは読み上げない（利用者の決まり。声で頼んだときだけ話す）
      if (!quiet && speakOn && leaderRef.current) speak(toSpeech(text));
    },
    [speak, speakOn, leaderRef],
  );

  // 話しかけられた内容の扱い（マイクのボタンでも、呼びかけでも同じ）
  // 画面だけで済ませる命令（あとで中身を入れる。ここでは入れ物だけ）
  const localCommandRef = useRef<(text: string) => Promise<boolean>>(async () => false);
  const openOutsideRef = useRef<(url: string, title: string, account: number | null) => Promise<void>>(async () => {});
  const accountNamesRef = useRef<Record<number, string[]>>({});
  // 画面と PC だけで済ませる（声でも、会話の欄に文字で打っても同じ）。済ませたら true
  const handleLocal = useCallback(
      async (text: string): Promise<boolean> => {
        setError("");
        // 検索・Chrome で開く・Claude のセッション・ウィンドウを移す、は画面と PC で済ませる（下の localCommandRef）
        if (await localCommandRef.current(text)) return true;
        // 「〇〇を開いて」は、ディミに聞かずにこの画面ですぐ開く
        const app = detectOpenCommand(text);
        if (app) {
          const ok = openApp(app.id);
          logActivity(supabase, ok ? "open_app" : "error", ok ? app.name : `${app.name} を開けませんでした（ブラウザに止められた）`);
          announce(ok ? `${app.name}を開きます` : `ブラウザに止められました。左のアイコンから${app.name}を開いてください`);
          return true;
        }
        // アプリの一覧になければ、Chrome のブックマークから探して、別のタブで開く
        const acc = extractAccount(text, accountNamesRef.current);
        const bm = matchBookmark(acc.rest, bookmarksRef.current);
        if (bm) {
          await openOutsideRef.current(bm.url, bm.title, acc.account);
          return true;
        }
        return false;
      },
      [supabase, announce, openApp],
  );
  const handleUtterance = useCallback(
    async (text: string) => {
      logActivity(supabase, "voice", text);
      if (await handleLocal(text)) return;
      logActivity(supabase, "send", `画面で済ませる命令ではないので、PC の DIMY に送った「${text}」`);
      const { error } = await supabase.from("messages").insert({ role: "user", content: text });
      if (error) setError(`送信できませんでした: ${error.message}`);
    },
    [supabase, handleLocal],
  );
  const recognition = useSpeechRecognition(handleUtterance, {
    silenceMs: silenceSec * 1000,
    onLog: (kind, detail) => logActivity(supabase, kind, detail),
  });

  // 「ディミ」と呼ばれたときだけ反応する聞き取り
  // 返事を作っている・届いている間（読み上げの合間も含めて、話している最中として扱う）
  const replyActive = messages.some(
    (m) =>
      (m.role === "user" && (m.status === "pending" || m.status === "processing")) ||
      (m.role === "assistant" && m.status === "processing"),
  );
  const wake = useWakeWord({
    enabled: wakeOn && isLeader,
    speaking: speaker.speaking || replyActive,
    paused: recognition.listening,
    isEcho: (t) => recentSpoken.current.some((x) => Date.now() - x.at < 60_000 && isEcho(t, x.text)),
    onLog: (kind, detail) => logActivity(supabase, kind, detail),
    followMs: followSec * 1000,
    silenceMs: silenceSec * 1000,
    volume: speaker.volume,
    onWake: () => announce("はい"),
    onCommand: handleUtterance,
    onControl: (c) => {
      // 「ストップ」「終わり」「ありがとう」: 聞く・考える・話すをすべて止める
      if (c === "stop" || c === "end") forceStop();
      if (c === "cancel") announce("取り消しました");
      if (c === "mute") {
        forceStop();
        setWakeOn(false);
        save(WAKE_KEY, "off");
      }
    },
  });
  useEffect(() => {
    wakeRef.current = wake;
  });

  // ショートカット: Alt + 数字でアプリを開く（左のアイコンの上から順）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const n = Number.parseInt(e.key, 10);
      if (n >= 1 && n <= APPS.length) {
        e.preventDefault();
        openApp(APPS[n - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openApp]);

  // 返事を 1 文書き終わるごとに読み上げる（この画面を開いてから届いた返事だけ）
  useEffect(() => {
    for (const m of messages) {
      if (m.role !== "assistant" || !liveIds.current.has(m.id)) continue;
      // 強制停止した発言への返事は読まない
      if (m.reply_to && stoppedReplies.current.has(m.reply_to)) {
        liveIds.current.delete(m.id);
        continue;
      }
      const final = m.status !== "processing";
      // 最初の 1 文はすぐ読み、そのあとは 40 文字ほどたまってからまとめて読む（細切れの間を減らす）
      const from = spokenUpTo.current.get(m.id) ?? 0;
      const { chunk, next } = takeSpeakable(m.content, from, final, from === 0 ? 0 : 40);
      spokenUpTo.current.set(m.id, next);
      if (speakOn && chunk && leaderRef.current) speak(toSpeech(chunk));
      if (final) {
        liveIds.current.delete(m.id);
        // 呼びかけを待つ設定なら、言い終えたあと 8 秒は続けて話せるようにする
        if (wakeOn) {
          if (speakOn) followUpAfterSpeech.current = true;
          else wakeRef.current?.followUp();
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 返事が届いた時刻から字幕を出す
        setCaptionUntil(Date.now() + captionSec * 1000);
      }
    }
  }, [messages, speak, speakOn, wakeOn, captionSec, leaderRef]);

  // 画面を消さない（ずっと表示しておくため）。対応していないブラウザでは何もしない。
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        const nav = navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<typeof lock> } };
        if (document.visibilityState === "visible" && nav.wakeLock) lock = await nav.wakeLock.request("screen");
      } catch {}
    };
    request();
    document.addEventListener("visibilitychange", request);
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("visibilitychange", request);
      document.removeEventListener("fullscreenchange", onFs);
      lock?.release().catch(() => {});
    };
  }, []);

  const waiting = messages.some(
    (m) =>
      (m.role === "user" && (m.status === "pending" || m.status === "processing")) ||
      (m.role === "assistant" && m.status === "processing"),
  );
  const wakeListening = wake.state === "command" || wake.state === "followup";
  const mode: RingMode = recognition.listening || wakeListening ? "listening" : speaker.speaking ? "speaking" : waiting ? "thinking" : "idle";
  const tone: RingTone = online === false ? "offline" : "normal";
  const lastReply = [...messages].reverse().find((m) => m.role === "assistant");
  const noticeOn = notice !== null && now !== null && now.getTime() < notice.until;
  const showCaption =
    recognition.listening || wakeListening || speaker.speaking || (lastReply?.status === "processing") || (now !== null && now.getTime() < captionUntil) || noticeOn;
  // 字幕の枠（長い返事は、いちばん下＝読んでいるところへ自動で送る）
  const captionRef = useRef<HTMLDivElement>(null);
  const captionFollow = useRef(true);
  const caption = recognition.listening ? recognition.interim : wakeListening ? wake.interim || "どうぞ" : noticeOn ? notice!.text : lastReply?.content ?? "";

  // 固定ウィンドウ（メイン画面に置いておくページや映像）
  const pins = usePinBoard("hud", session);
  const dragging = usePinDrop((url, at) => pins.addWeb(url, at));

  // PC の情報（Chrome のプロフィール＝アカウント、PC の Claude Code のセッション）
  const [pcState, setPcState] = useState<PcState | null>(null);
  // サイトごとのアカウント（設定の「アカウント」タブで決める。決めていなければマスターアカウント）
  const [siteAccounts, setSiteAccounts] = useState<Record<string, string>>({});
  // 開く場所（端末ごと）。スマホは最初から「この端末」、それ以外は「PC の Chrome」
  // 開く場所: 話しかけた端末で開く（利用者の決まり）。DIMY が動いているデスクトップ PC なら、PC の DIMY が Chrome で
  // アカウントの指定どおりに開く。ノート・スマホなどは、その端末のブラウザで開く。
  // デスクトップ PC かどうかは、拡張機能が知らせる（PC の DIMY が拡張機能のフォルダに置いた印）
  const isPcScreen = useIsDimyPc();
  // サイトごとのアカウントは、どの端末でも共通（表 user_settings）。
  // 以前この端末のブラウザに保存していたものは、データベースにまだ何もなければ引き継ぐ
  useEffect(() => {
    loadUserSetting<Record<string, string>>(supabase, SHARED_SITE_ACCOUNTS_KEY).then(({ value, error }) => {
      if (value) return setSiteAccounts(value);
      let local: Record<string, string> = {};
      try {
        local = JSON.parse(load(SITE_ACCOUNTS_KEY) ?? "{}");
      } catch {}
      setSiteAccounts(local);
      if (!error && Object.keys(local).length) saveUserSetting(supabase, SHARED_SITE_ACCOUNTS_KEY, local);
    });
  }, [supabase]);
  const setSiteAccount = (site: string, dir: string | null) => {
    const next = { ...siteAccounts };
    if (dir) next[site] = dir;
    else delete next[site];
    setSiteAccounts(next);
    save(SITE_ACCOUNTS_KEY, JSON.stringify(next));
    saveUserSetting(supabase, SHARED_SITE_ACCOUNTS_KEY, next).then((err) => err && logActivity(supabase, "error", `サイトごとのアカウントを保存できませんでした: ${err}`));
    logActivity(supabase, "ui", `サイトごとのアカウント: ${site === "*" ? "それ以外" : site} → ${dir ?? "指定なし"}`);
  };
  // Chrome のアカウントの呼び名（表 user_settings。端末をまたいで同じものを使う）
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  const [nicknameError, setNicknameError] = useState("");
  useEffect(() => {
    loadUserSetting<Record<string, string>>(supabase, NICKNAMES_KEY).then(({ value, error }) => {
      if (value) setNicknames(value);
      if (error) setNicknameError(/user_settings|relation|schema cache/.test(error) ? "呼び名を保存する表がまだありません。SQL Editor で 20261115400000_user_settings.sql を実行してください。" : error);
    });
  }, [supabase]);
  const setNickname = async (dir: string, name: string) => {
    const next = { ...nicknames };
    if (name.trim()) next[dir] = name.trim();
    else delete next[dir];
    setNicknames(next);
    const err = await saveUserSetting(supabase, NICKNAMES_KEY, next);
    setNicknameError(err ? `呼び名を保存できませんでした（${err}）` : "");
  };
  const refreshPcState = useCallback(() => {
    loadPcState(supabase).then((st) => st && setPcState(st));
  }, [supabase]);
  useEffect(() => {
    refreshPcState();
    const t = setInterval(refreshPcState, 5 * 60_000);
    return () => clearInterval(t);
  }, [refreshPcState]);

  /**
   * ディミの外（Chrome）で開く。PC が動いていれば PC が Chrome で開く。開くアカウント（Chrome のプロフィール）は:
   * 言葉で指定（「アカウント2で」）→ 設定のサイトごとのアカウント → 設定の「指定がないとき」→ マスターアカウント（PC が決める）
   */
  async function openOutside(url: string, title: string, account: number | null, site?: string, quiet = false) {
    const profile = account ? undefined : (site && siteAccounts[site]) || siteAccounts["*"];
    const who = account
      ? `アカウント${account}`
      : profile
        ? (nicknames[profile] ?? pcState?.chrome_profiles.find((p) => p.dir === profile)?.name ?? profile)
        : "マスターアカウント";
    logActivity(supabase, "open_chrome", `${title} ${url}（${isPcScreen ? who : "この端末のブラウザ"}）`);
    if (online && isPcScreen) {
      announce(`${title}を開きます`, quiet);
      const r = await sendPcCommand(supabase, "open_url", { url, ...(account ? { account } : profile ? { profile } : {}) }, 15_000);
      if (r.ok) return;
      if (r.sent) {
        // PC から返事がない・開けなかった: このブラウザで開くボタンを出す
        logActivity(supabase, "error", `PC で開けませんでした: ${r.result}`);
        setPendingLink({ title, url, folder: "" });
        return announce(`${r.result || "PC で開けませんでした"} 下のボタンを押すと、この端末で開きます`, quiet);
      }
      // 表がまだないなど、PC に送れなかったときは、このブラウザで開く
    }
    if (window.open(url, "_blank") === null) {
      setPendingLink({ title, url, folder: "" });
      announce(`${title}は、下のボタンを押すと開きます`, quiet);
    } else announce(`${title}を開きます`, quiet);
  }

  /** 固定ウィンドウをまとめて移す（声の「モニター4のパレットに移して」など）。移した数を返す */
  function movePins(from: string, to: string) {
    logActivity(supabase, "move_pins", `${boardLabel(from)} → ${boardLabel(to)}`);
    if (from === "hud") {
      const list = pins.pins.filter((p) => p.kind === "web");
      list.forEach((p) => pins.send(p.id, to));
      return list.length;
    }
    const list = loadPins(from);
    const moving = list.filter((p) => p.kind === "web");
    moving.forEach((p) => sendPin(p, to));
    savePins(from, list.filter((p) => p.kind !== "web"));
    if (to === "hud") pins.reload();
    return moving.length;
  }

  /** 画面と PC だけで済ませる命令。済ませたら true */
  async function localCommand(text: string): Promise<boolean> {
    const names = accountNamesRef.current;
    const done = () => {
      // 呼びかけで話しかけていたら、言い終えたあと続けて話せるようにする
      if (wakeOn) {
        if (speakOn) followUpAfterSpeech.current = true;
        else wakeRef.current?.followUp();
      }
      return true;
    };
    // 「Chrome で」「ブラウザで」が付いていたら、ディミの中ではなく Chrome で開く
    const br = stripBrowser(text);
    const acc0 = extractAccount(br.rest, names);
    if (br.chrome || acc0.account !== null) {
      const app = detectOpenCommand(acc0.rest);
      if (app) {
        await openOutside(app.url, app.name, acc0.account, app.name);
        return done();
      }
    }
    const site = parseOpenSite(acc0.rest);
    if (site) {
      await openOutside(site.url, site.name, acc0.account, site.name);
      return done();
    }
    text = br.rest;
    const mv = parseMoveCommand(text);
    if (mv) {
      const n = movePins(mv.from, mv.to);
      announce(n ? `${boardLabel(mv.to)}に${n}個移しました` : `${boardLabel(mv.from)}に移せるウィンドウがありません`);
      return done();
    }
    const sc = parseSearchCommand(text, names);
    if (sc) {
      await openOutside(searchUrl(sc), `${sc.site === "youtube" ? "YouTube" : "Google"}で「${sc.query}」`, sc.account, sc.site === "youtube" ? "YouTube" : "Google");
      return done();
    }
    const ss = parseSessionCommand(extractAccount(text, names).rest);
    if (ss) {
      const acc = extractAccount(text, names).account;
      if (ss.kind !== "chat" && ss.query) {
        const hit = matchSession(pcState?.claude_sessions ?? [], ss.query);
        if (hit) {
          announce(`「${hit.title}」を開きます`);
          logActivity(supabase, "open_session", hit.title);
          const r = await sendPcCommand(supabase, "open_session", { id: hit.id });
          if (!r.ok) announce(r.result || "PC でセッションを開けませんでした");
          return done();
        }
      }
      // claude.ai のチャットと Code のセッションは、名前で探す手段がないので、一覧の画面を開く
      const url = ss.kind === "chat" ? "https://claude.ai/recents" : "https://claude.ai/code";
      if (ss.query) announce(`PC のセッションに「${ss.query}」が見つからないので、claude.ai の一覧を開きます`);
      await openOutside(url, ss.kind === "chat" ? "Claude のチャットの一覧" : "Claude Code のセッションの一覧", acc, "Claude");
      return done();
    }
    return false;
  }
  useEffect(() => {
    localCommandRef.current = localCommand;
    openOutsideRef.current = openOutside;
    // 声で「〇〇のアカウントで」と言われたときに探す名前（呼び名を先に、次にプロフィールの名前）
    const names: Record<number, string[]> = {};
    pcState?.chrome_profiles.forEach((p, i) => (names[i + 1] = [nicknames[p.dir] ?? "", p.name].filter(Boolean)));
    accountNamesRef.current = names;
  });

  // 今日の会話の数（計器に出す）
  const [todayCount, setTodayCount] = useState<number | null>(null);
  const userMsgs = messages.filter((m) => m.role === "user").length;
  useEffect(() => {
    const start = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" }) + "T00:00:00+09:00");
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("role", "user")
      .gte("created_at", start.toISOString())
      .then(({ count }) => setTodayCount(count ?? null));
  }, [supabase, userMsgs]);

  /** 強制停止: 聞き取り・考え中（PC の返事作り）・読み上げ・続けて話せる時間を、すべてやめる */
  function forceStop() {
    logActivity(supabase, "stop", "強制停止（ボタン・Esc・声）");
    followUpAfterSpeech.current = false;
    cancelSpeech();
    recognition.cancel();
    wakeRef.current?.reset();
    for (const m of messages) if (m.role === "user") stoppedReplies.current.add(m.id);
    liveIds.current.clear();
    controlRef.current?.send({ type: "broadcast", event: "stop", payload: { at: Date.now() } }).catch(() => {});
    setPendingLink(null);
    setNotice({ text: "STOPPED", until: Date.now() + 2500 });
  }
  const forceStopRef = useRef(forceStop);
  useEffect(() => {
    forceStopRef.current = forceStop;
    panelRef.current = panel;
  });
  // Esc キーでも強制停止（設定などの画面を開いているときは、その画面を閉じるだけ）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && panelRef.current === "none") forceStopRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 字幕が書き足されたら、いちばん下へ送る（新しい返事のときは、また下を追いかける）
  useEffect(() => {
    const el = captionRef.current;
    if (el && captionFollow.current) el.scrollTop = el.scrollHeight;
  }, [caption]);
  useEffect(() => {
    captionFollow.current = true;
  }, [lastReply?.id]);

  // 記録: 画面に出たエラー・開いた画面（管理の画面の「動作」に残す）
  const shownError = error || recognition.error || wake.error;
  useEffect(() => {
    if (shownError) logActivity(supabase, "error", shownError);
  }, [shownError, supabase]);
  useEffect(() => {
    if (panel !== "none") logActivity(supabase, "ui", `開いた: ${panel}`);
  }, [panel, supabase]);

  // 新しい版の画面が公開されたら、話していない・何も開いていないときに読み込み直す
  useAutoReload(
    mode === "idle" && !wakeListening && panel === "none" && !replyActive,
    (from, to) => logActivity(supabase, "ui", `新しい版の画面を読み込み直した（${from.slice(0, 7)} → ${to.slice(0, 7)}）`),
    mode === "idle" && !wakeListening && !replyActive,
  );

  function onMic() {
    cancelSpeech();
    // 呼びかけを待つ設定なら、「ディミ」と言わずにすぐ話せる状態にする
    if (wakeOn) return wakeListening ? wake.finish() : wake.startCommand();
    if (recognition.listening) return recognition.stop();
    recognition.start();
  }
  // PC で右 Ctrl を 2 回押したとき（常駐プログラムが知らせてくる）: 話し始め / 話し終わって送る
  const onMicRef = useRef(onMic);
  const hotkeyRef = useRef(hotkeyOn);
  useEffect(() => {
    onMicRef.current = onMic;
    hotkeyRef.current = hotkeyOn;
  });
  useEffect(() => {
    const channel = supabase
      .channel("dimy-control")
      .on("broadcast", { event: "hotkey" }, () => {
        // スマホなど、指で操作する端末では反応しない（PC で押したキーでスマホが聞き始めないように）
        if (window.matchMedia("(pointer: coarse)").matches) return;
        if (!hotkeyRef.current) return; // 設定でオフにしている
        if (!leaderRef.current) return; // ほかの画面が担当（最後に操作した画面だけが反応する）
        logActivity(supabase, "hotkey", "右 Ctrl 2 回（話し始め / 話し終わり）");
        onMicRef.current();
      })
      .subscribe();
    controlRef.current = channel;
    return () => {
      controlRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [supabase, leaderRef]);

  // 設定の画面を閉じる（Esc で閉じるときに使うので、毎回同じ関数にする）
  const closePanel = useCallback(() => setPanel("none"), []);

  function changeWake(next: boolean) {
    logActivity(supabase, "wake", next ? "呼びかけをオン" : "呼びかけをオフ");
    setWakeOn(next);
    save(WAKE_KEY, next ? "on" : "off");
    if (next) announce("「ディミ」と呼んでください");
  }

  function changeSpeak(next: boolean) {
    setSpeakOn(next);
    save(SPEAK_KEY, next ? "on" : "off");
    if (!next) cancelSpeech();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  // 天気の地域を保存する。見つからないときは理由を返す
  async function savePlace(name: string): Promise<string | null> {
    try {
      const p = await findPlace(name);
      if (!p) return "その地名が見つかりませんでした。市区町村の名前で入れてください。";
      save(PLACE_KEY, JSON.stringify(p));
      setPlace(p);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  const time = now?.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
  const date = now?.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short" });
  const pcLabel = online ? "PC オンライン" : online === false ? "PC オフライン" : "PC 確認中";

  return (
    <div className="dimy-grid relative h-dvh w-full overflow-hidden text-cyan-100">
      <DataField mode={mode} tone={tone} />
      <HudChrome now={now} mode={mode} online={online} messages={messages} todayCount={todayCount} pinCount={pins.pins.length} onPick={(m) => void recall(m.role === "user" ? m.id : (m.reply_to ?? m.id))} />

      <Showcase
        cards={cards}
        onClose={(id) => setCards((prev) => prev.filter((c) => c.id !== id))}
        onPin={(id) => setCards((prev) => prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)))}
        onCloseAll={() => {
          logActivity(supabase, "card", `カードをすべて閉じた（${cards.length} 枚）`);
          setCards([]);
        }}
        onOpenLink={(url, title) => (extVersion ? openWebCard(url, title) : void openOutside(url, title, null, undefined, true))}
        onOpenChrome={(url, title) => void openOutside(url, title, null, undefined, true)}
        onOpenPage={(url, title) => (extVersion ? openWebCard(url, title) : pins.addWeb(url, undefined, title))}
        onExtract={extractCard}
        onUpdate={(id, patch) => setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))}
        onDropOut={dropCardOut}
        onLog={(t) => logActivity(supabase, "card", t)}
        renderChat={() => (
          <Chat
            supabase={supabase}
            session={session}
            embedded
            onRecall={(id) => void recall(id)}
            onLocalCommand={async (t) => {
              logActivity(supabase, "voice", `（文字）${t}`);
              return handleLocal(t);
            }}
          />
        )}
        weather={weather}
        place={place}
        session={session}
      />

      {/* 中央：球体とリング */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="aspect-square w-[min(62vmin,640px)]">
          <Ring mode={mode} tone={tone} waiting={wakeOn && isLeader && wake.state === "standby"} />
        </div>
      </div>

      {/* 字幕（話している・聞いている間と、返事のあと少しだけ） */}
      {/* 長いときは省かずに、枠の中でスクロールして全文を出す（書き足されるたびに、いちばん下へ送る） */}
      <div
        className={
          "absolute inset-x-0 bottom-32 z-[850] mx-auto max-w-2xl px-6 transition-opacity duration-700 " +
          (showCaption && caption ? "opacity-100" : "pointer-events-none opacity-0")
        }
      >
        <div
          ref={captionRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            // 利用者が上へ戻して読んでいる間は、自動で下へ送らない
            captionFollow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          className="dimy-caption max-h-[7.5rem] overflow-y-auto rounded-md bg-slate-950/45 px-3 py-1 backdrop-blur-sm text-center text-base leading-relaxed text-cyan-100/90 drop-shadow-[0_0_8px_rgba(2,6,23,0.9)] [mask-image:linear-gradient(to_bottom,transparent,black_14px,black)]"
        >
          <p className="whitespace-pre-wrap pt-2">{caption}</p>
        </div>
      </div>

      {/* 左上：PC の状態 */}
      <div className="absolute left-5 top-5 z-[800] flex items-center gap-2" title={pcLabel} aria-label={pcLabel}>
        <PcIcon className={"h-6 w-6 " + (online ? "text-cyan-300" : "text-slate-500")} />
        <span
          className={
            "h-2 w-2 rounded-full " + (online ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : online === false ? "bg-slate-500" : "bg-amber-400")
          }
        />
      </div>

      {/* 右上：アイコン */}
      <nav className="absolute right-5 top-5 z-[800] flex gap-2">
        <button onClick={() => toggleChat()} className={iconBtn} title="会話の履歴と文字入力" aria-label="会話の履歴と文字入力">
          <ChatIcon className="h-5 w-5" />
        </button>
        <button
          onClick={() => {
            if (panel !== "bookmarks") loadBookmarks();
            setPanel(panel === "bookmarks" ? "none" : "bookmarks");
          }}
          className={iconBtn}
          data-panel-toggle
          title="ブックマーク"
          aria-label="ブックマーク"
        >
          <BookmarkIcon className="h-5 w-5" />
        </button>
        <Link href="/memory" className={iconBtn} title="覚えていること" aria-label="覚えていること">
          <MemoryIcon className="h-5 w-5" />
        </Link>
        <button onClick={() => setPanel(panel === "pin" ? "none" : "pin")} data-panel-toggle className={iconBtn} title="固定ウィンドウを置く" aria-label="固定ウィンドウを置く">
          <PinIcon className="h-5 w-5" />
        </button>
        <button onClick={() => setPanel(panel === "palette" ? "none" : "palette")} data-panel-toggle className={iconBtn} title="パレットをほかのモニターに開く" aria-label="パレットを開く">
          <PaletteIcon className="h-5 w-5" />
        </button>
        <button onClick={() => setPanel(panel === "admin" ? "none" : "admin")} className={iconBtn} title="管理（会話・システム・動作の記録）" aria-label="管理">
          <AdminIcon className="h-5 w-5" />
        </button>
        <button onClick={() => setPanel(panel === "settings" ? "none" : "settings")} className={iconBtn} title="設定" aria-label="設定">
          <GearIcon className="h-5 w-5" />
        </button>
        <button onClick={toggleFullscreen} className={iconBtn} title="全画面" aria-label="全画面の切り替え">
          {fullscreen ? <ShrinkIcon className="h-5 w-5" /> : <ExpandIcon className="h-5 w-5" />}
        </button>
      </nav>

      {/* 左下：日時 */}
      <button
        onClick={() => setPanel(panel === "calendar" ? "none" : "calendar")}
        data-panel-toggle
        className="absolute bottom-6 left-6 z-[800] rounded-lg px-2 py-1 text-left font-mono transition hover:bg-cyan-400/10"
        title="カレンダー（Google カレンダーの予定）"
        aria-label="カレンダーを開く"
      >
        <div className="text-2xl tracking-widest text-cyan-200 sm:text-4xl drop-shadow-[0_0_10px_rgba(34,211,238,0.45)]">{time}</div>
        <div className="mt-1 text-xs tracking-[0.25em] text-cyan-400/70">{date}</div>
      </button>
      {panel === "calendar" && <CalendarPanel session={session} onClose={closePanel} />}

      {/* 右下：天気 */}
      {weather && (
        <button
          onClick={() => setPanel(panel === "weather" ? "none" : "weather")}
          data-panel-toggle
          className="absolute bottom-6 right-6 z-[800] flex items-center gap-3 rounded-lg px-2 py-1 text-left transition hover:bg-cyan-400/10"
          title={`${place?.name} ${weather.text ?? weatherLabel(weather.code)}（${weather.source}。押すと詳しく）`}
          aria-label="天気の詳細"
        >
          <WeatherIcon code={weather.code} className="h-10 w-10 text-cyan-300" />
          <div className="font-mono">
            <div className="text-2xl text-cyan-200 sm:text-3xl">{Math.round(weather.temperature)}°</div>
            <div className="text-xs text-cyan-400/70">
              {Math.round(weather.max)}° / {Math.round(weather.min)}°{weather.rain !== null && ` ・${weather.rain}%`}
            </div>
          </div>
        </button>
      )}
      {panel === "weather" && place && <WeatherPanel place={place} source={weatherSource} onClose={closePanel} />}

      {/* 下中央：マイク（小窓より手前に出す。周りの空いた所は、下の小窓をそのまま触れるようにする） */}
      <div className="pointer-events-none absolute inset-x-0 bottom-8 z-[900] flex flex-col items-center [&>*]:pointer-events-auto">
        <div className="relative">
        {/* 強制停止（いつも出しておく。動いているときは明るくなる。Esc キー・「ストップ」でも同じ） */}
        <button
          onClick={forceStop}
          title="強制停止（Esc ／「ストップ」）"
          aria-label="強制停止"
          className={
            "absolute -left-16 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border backdrop-blur transition " +
            (mode !== "idle" || wakeListening
              ? "border-rose-400/80 bg-rose-500/15 text-rose-200 shadow-[0_0_18px_rgba(244,63,94,0.45)] hover:bg-rose-500/30"
              : "border-cyan-400/25 bg-slate-950/50 text-cyan-300/60 hover:border-rose-400/60 hover:text-rose-200")
          }
        >
          <StopIcon className="h-5 w-5" />
        </button>
        {recognition.supported ? (
          <button
            onClick={onMic}
            aria-label={recognition.listening ? "聞き取りをやめる" : "話しかける"}
            className={
              "grid h-16 w-16 place-items-center rounded-full border backdrop-blur transition " +
              (recognition.listening
                ? "animate-pulse border-rose-400 bg-rose-500/20 text-rose-200 shadow-[0_0_28px_rgba(244,63,94,0.5)]"
                : "border-cyan-300/60 bg-cyan-500/10 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.35)] hover:bg-cyan-500/20")
            }
          >
            {recognition.listening ? <SendGlyph /> : <MicIcon className="h-7 w-7" />}
          </button>
        ) : (
          <button onClick={() => toggleChat(true)} className={iconBtn} aria-label="文字で話しかける" title="このブラウザは音声入力に対応していません。文字で話しかけてください">
            <ChatIcon className="h-5 w-5" />
          </button>
        )}
        </div>
        {pendingLink && (
          <button
            onClick={() => {
              window.open(pendingLink.url, "_blank", "noopener");
              setPendingLink(null);
            }}
            className="mt-3 flex items-center gap-2 rounded-full border border-cyan-300/60 bg-cyan-500/10 px-4 py-1.5 text-sm text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,0.35)]"
          >
            <BookmarkIcon className="h-4 w-4" />
            {pendingLink.title}
          </button>
        )}
        {(error || recognition.error || wake.error) && (
          <p className="mt-2 text-xs text-rose-300">{error || recognition.error || wake.error}</p>
        )}
      </div>

      {/* ブックマークの一覧（Chrome のブックマーク。押すと別のタブで開く） */}
      {panel === "bookmarks" && (
        <DismissBox onClose={closePanel} className="absolute right-5 top-20 z-[950] flex max-h-[70vh] w-96 max-w-[calc(100vw-2.5rem)] flex-col rounded-lg border border-cyan-400/30 bg-slate-950/90 p-3 text-sm backdrop-blur">
          <div className="mb-2 flex items-center gap-2">
            <input
              autoFocus
              value={bookmarkQuery}
              onChange={(e) => setBookmarkQuery(e.target.value)}
              placeholder="ブックマークを探す"
              className="min-w-0 flex-1 rounded border border-cyan-700/60 bg-slate-900 px-2 py-1"
            />
            <button onClick={() => setPanel("none")} aria-label="閉じる" className="text-cyan-400 hover:text-cyan-100">
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {bookmarks.length === 0 && (
              <li className="px-2 py-3 text-xs text-slate-400">まだありません。デスクトップ PC のディミが、Chrome のブックマークを写すと表示されます。</li>
            )}
            {bookmarks
              .filter((b) => !bookmarkQuery || (b.title + b.folder + b.url).toLowerCase().includes(bookmarkQuery.toLowerCase()))
              .slice(0, 300)
              .map((b, i) => (
                <li key={i}>
                  <a
                    href={b.url}
                    target="_blank"
                    rel="noopener"
                    className="block rounded px-2 py-1.5 hover:bg-cyan-400/10"
                  >
                    <div className="truncate text-cyan-100">{b.title}</div>
                    <div className="truncate text-[10px] text-slate-500">{b.folder}</div>
                  </a>
                </li>
              ))}
          </ul>
        </DismissBox>
      )}

      {/* 管理（記録を大きな画面で見る・コピーする） */}
      {panel === "admin" && <AdminPanel supabase={supabase} onClose={closePanel} />}

      {/* 設定（カテゴリーごとのタブ） */}
      {panel === "settings" && (
        <Settings
          onClose={closePanel}
          speakOn={speakOn}
          setSpeakOn={changeSpeak}
          voices={speaker.japaneseVoices}
          voiceName={speaker.voiceName}
          setVoiceName={(name) => {
            speaker.setVoiceName(name);
            save(VOICE_KEY, name);
          }}
          rate={speaker.rate}
          setRate={(v) => {
            speaker.setRate(v);
            save(RATE_KEY, String(v));
          }}
          volume={speaker.volume}
          setVolume={(v) => {
            speaker.setVolume(v);
            save(VOLUME_KEY, String(v));
          }}
          pitch={speaker.pitch}
          setPitch={(v) => {
            speaker.setPitch(v);
            save(PITCH_KEY, String(v));
          }}
          onTestVoice={() => {
            cancelSpeech();
            speaker.speak("はい、ディミです。この速さで話します。");
          }}
          wakeSupported={wake.supported}
          wakeStatus={
            !wakeOn
              ? "オフ"
              : !isLeader
                ? "ほかの画面が担当しています（この画面をクリックすると、この画面が聞きます）"
                : wake.error || (wake.running ? "聞いています" : "聞き取りを始めています…")
          }
          wakeLastHeard={wake.lastHeard}
          wakeOn={wakeOn}
          setWakeOn={changeWake}
          profiles={pcState?.chrome_profiles ?? null}
          masterEmail={session.user.email ?? ""}
          isPcScreen={isPcScreen}
          siteAccounts={siteAccounts}
          setSiteAccount={setSiteAccount}
          onRefreshProfiles={refreshPcState}
          nicknames={nicknames}
          setNickname={setNickname}
          nicknameError={nicknameError}
          online={online}
          onRestartPc={async () => {
            logActivity(supabase, "restart", "設定から PC の DIMY を再起動");
            // PC は 30 秒ごとにも頼みを確かめ直すので、40 秒まで待つ
            const r = await sendPcCommand(supabase, "restart", {}, 40_000);
            if (r.sent && !r.ok && r.result === "PC から返事がありません。")
              return {
                ok: false,
                result: "PC の DIMY から返事がありませんでした。PC の DIMY が古い版のままの可能性があります。PC のデスクトップの「ディミを再起動」を押してください。",
              };
            if (!r.sent && /check constraint|pc_commands_kind_check/.test(r.result))
              return { ok: false, result: "データベースの更新（20261115100000_pc_commands_restart.sql）がまだです。SQL Editor で実行してください。" };
            return r;
          }}
          silenceSec={silenceSec}
          setSilenceSec={(v) => {
            setSilenceSec(v);
            save(SILENCE_KEY, String(v));
          }}
          followSec={followSec}
          setFollowSec={(v) => {
            setFollowSec(v);
            save(FOLLOW_KEY, String(v));
          }}
          hotkeyOn={hotkeyOn}
          setHotkeyOn={(v) => {
            setHotkeyOn(v);
            save(HOTKEY_KEY, v ? "on" : "off");
          }}
          place={place}
          onSavePlace={savePlace}
          weatherSource={weatherSource}
          setWeatherSource={(v) => setPref("weatherSource", v)}
          yahooUrl={place ? yahooWeatherUrl(place.name) : null}
          captionSec={captionSec}
          setCaptionSec={(v) => {
            setCaptionSec(v);
            save(CAPTION_KEY, String(v));
          }}
        />
      )}

      {/* 左端：アプリのショートカット。開いたアプリの小窓 */}
      <PinBoard state={pins} className="z-[5]" />
      {panel === "pin" && <PinAdd state={pins} onClose={closePanel} className="absolute right-5 top-20 z-[850]" />}
      {panel === "palette" && <ScreenPicker onClose={closePanel} className="absolute right-5 top-20 z-[850]" />}
      <DropOverlay show={dragging} />
      <AppDock onOpen={openApp} />
      <AppWindows state={appWins} />

      {/* 会話の履歴と文字入力（右から出るパネル） */}
    </div>
  );
}
