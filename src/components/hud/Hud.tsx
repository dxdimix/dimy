"use client";

// ディミのメイン画面（声が中心）。文字は最小限にし、操作はアイコンだけ。
// - 中央: 光る球体とリング。周りをデータが流れ続ける
// - 下中央: マイク。左下: 日時。右下: 天気。左上: PC の状態
// - 右上のアイコン: 会話（履歴と文字入力のパネル）、ブックマーク、覚えていること、設定、全画面
//   読み上げ・声・呼びかけなどの設定は、すべて設定の画面（Settings.tsx）にまとめる

import { captureScreen, shrinkImage, useDimyExtension, useIsDimyPc } from "@/lib/extension";
import { Showcase } from "./Showcase";
import { BUILTIN_TITLE, builtinCardsFor, chatCard, chatgptFloat, sayMatches, splitSentences, webCard, clampFloat, snapshotCards, type Card, type CardData, type CardDrag, type CardKind } from "@/lib/cards";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { TextBox } from "./TextBox";
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
  MenuIcon,
  CalendarIcon,
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

type MenuKey = "chat" | "bookmarks" | "calendar" | "weather" | "memory" | "pin" | "admin" | "settings" | "fullscreen";

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
  // 話に合わせてカードを出す（利用者の希望）: DIMY のカードに say（出したい言葉）があれば、読み上げがその言葉を含む文に来るまで隠す
  const spokenSoFar = useRef(""); // この返事で読み始めた文
  const replyDone = useRef(true); // 返事を書き終えたか（読み終えたら、残りのカードを全部出す）
  const speakOnRef = useRef(true);
  const queuedSentences = useRef(0); // 読み上げを頼んで、まだ読み始めていない文の数
  const revealCardsFor = useCallback((sentence: string) => {
    spokenSoFar.current += sentence;
    setCards((prev) => {
      let next = prev.map((c) => (c.hidden && sayMatches(sentence, c.data.say) ? { ...c, hidden: false } : c));
      // 話とカードの終わりをそろえる（利用者の決まり: 話し終えてから一度に出す・カードが先に出そろって話だけ続く、のどちらも避ける）。
      // 返事を書き終えていれば、残りの文の数より隠れているカードが多いぶんを、古い順に前倒しで出す。最後の文を読み始めるときに全部出る
      if (replyDone.current) {
        let extra = next.filter((c) => c.hidden).length - queuedSentences.current;
        if (extra > 0) next = next.map((c) => (c.hidden && extra-- > 0 ? { ...c, hidden: false } : c));
      }
      return next.some((c, i) => c !== prev[i]) ? next : prev;
    });
  }, []);
  const revealAllCards = useCallback(() => setCards((prev) => (prev.some((c) => c.hidden) ? prev.map((c) => (c.hidden ? { ...c, hidden: false } : c)) : prev)), []);
  const router = useRouter();
  const [panel, setPanel] = useState<"none" | "chat" | "settings" | "bookmarks" | "pin" | "palette" | "weather" | "calendar" | "admin" | "menu">("none");
  const panelRef = useRef(panel);
  // Chrome のブックマーク（PC のディミが写したもの）。表がまだないときは空のまま
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const bookmarksRef = useRef<Bookmark[]>([]);
  const [bookmarkQuery, setBookmarkQuery] = useState("");
  // ブラウザに別タブを止められたときに、押して開くためのリンク
  const [pendingLink, setPendingLink] = useState<Bookmark | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [speakOn, setSpeakOn] = useState(true);
  useEffect(() => {
    speakOnRef.current = speakOn;
  }, [speakOn]);
  const [wakeOn, setWakeOn] = useState(false);
  // スマホ（iPhone・Android など）では、呼びかけ（いつも聞いている状態）を使わない。
  // iPhone の Safari は、ページを開くたびにマイクの許可を求めるので、開いただけでマイクを使うと毎回許可を聞かれる（利用者の指摘）。
  // スマホはマイクのボタンを押したときだけマイクを使う。呼びかけの設定（どの端末でも共通）は、デスクトップ・ノートで効く
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 開いたときに、端末の種類を一度だけ調べる
    setIsPhone(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)));
  }, []);
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
  // 返事の字幕は、次の会話を始めるか「カードをすべて閉じる」まで残す（利用者の決まり: 冒頭で何と言ったか分からなくならないように）
  const [captionKept, setCaptionKept] = useState(false);
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
          spokenSoFar.current = "";
          replyDone.current = false;
          setCaptionKept(false);
          queuedSentences.current = 0;
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
        // ChatGPT に同じ質問を渡したカード（調べもののとき PC の DIMY が出す）: 前のものと入れ替え、ピン留めで残す。最初に並べる（利用者の希望）
        if (row.data?.chatgpt) {
          // 右端に固定（利用者の決まり: 大きさは 350×310 ほど。全部のやり取りで同じ場所）。利用者が動かしたら、その場所を次も使う
          setCards((prev) => {
            // 左端に縦いっぱいで固定（利用者の決まり 2026-11-17）。利用者が左側で動かした・大きさを変えたら、その場所を使う。折りたたみも引き継ぐ
            const old = prev.find((c) => c.data.chatgpt && c.float);
            const vw = window.innerWidth;
            const float = old?.float && old.float.x < vw / 2 ? old.float : chatgptFloat(vw, window.innerHeight);
            return [{ id: row.id, kind: row.kind, title: row.title, data: row.data, pinned: true, at: Date.now() + 3e13, float, collapsed: old?.collapsed }, ...prev.filter((c) => !c.data.chatgpt && c.id !== row.id)];
          });
          logActivity(supabase, "card", `画面のカード（DIMY）: ChatGPT ${row.data.url ?? ""}`);
          return;
        }
        const say = row.data?.say;
        // 読み上げがまだその言葉に来ていなければ隠しておく（声を出さない画面・読み終えたあとは、すぐ出す）
        const hidden = Boolean(say) && speakOnRef.current && leaderRef.current && !replyDone.current && !sayMatches(spokenSoFar.current, say);
        setCards((prev) => (prev.some((c) => c.id === row.id) ? prev : [...prev, { id: row.id, kind: row.kind, title: row.title, data: row.data ?? {}, pinned: false, at: Date.now(), hidden }]));
        // 念のため: 40 秒たっても出ていなければ出す（読み上げの知らせが来なかったときなど）
        if (hidden) setTimeout(() => setCards((prev) => prev.map((c) => (c.id === row.id && c.hidden ? { ...c, hidden: false } : c))), 40_000);
        logActivity(supabase, "card", `画面のカード（DIMY）: ${row.kind} ${row.title}${hidden ? `（「${say}」を話すときに出す）` : ""}`);
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
  }, [supabase, leaderRef]);

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
      if (saved.length) setCards((prev) => [...saved.filter((c) => !prev.some((p) => p.id === c.id)).map((c) => ({ ...c, hidden: false })), ...prev]);
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

  // ディミの中の ChatGPT の自動送信の様子（拡張機能の chatgpt.js が知らせる。答えの中身は含まない）を記録に残す
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== "https://chatgpt.com" || !ev.data || typeof ev.data !== "object" || typeof ev.data.dimyChatgpt !== "string") return;
      logActivity(supabase, "ui", `ChatGPT の自動送信: ${ev.data.dimyChatgpt}${ev.data.detail ? `（${String(ev.data.detail).slice(0, 200)}）` : ""}`);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [supabase]);

  // DIMY の Chrome の拡張機能（入っていれば、ディミの画面の中でどのページも開ける）
  const extVersion = useDimyExtension();
  useEffect(() => {
    logActivity(supabase, "ui", extVersion ? `DIMY の拡張機能: あり（${extVersion}）` : "DIMY の拡張機能: なし");
    // ChatGPT のログインの状態（拡張機能が <html data-dimy-chatgpt> に書く。Cookie の中身は含まない）
    if (!extVersion) return;
    const t = setTimeout(() => {
      const info = document.documentElement.getAttribute("data-dimy-chatgpt");
      if (info) logActivity(supabase, "ui", `ChatGPT の準備（拡張機能）: ${info}`);
    }, 3000);
    return () => clearTimeout(t);
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
      // ページ・地図は中身の高さが決まらないので、幅と同じ高さ（正方形）で出す（利用者の決まり）。ほかは中身に合わせる
      const square = c.kind === "web" || c.kind === "map";
      const float = clampFloat({ x: at.x - w / 2, y: at.y - 24, w, h: square ? w : undefined }, window.innerWidth, window.innerHeight);
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
    // 返事を読み終えたら、まだ隠れているカードを全部出す
    if (replyDone.current) revealAllCards();
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
  const { speak: speakRaw, cancel: cancelSpeech, isSpeaking } = speaker;
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
    (text: string, onStart?: () => void) => {
      // 念のため: 同じ文を 5 秒以内に 2 回読まない
      const norm = (t: string) => t.replace(/[\s、。,.!！?？]/g, "");
      if (recentSpoken.current.some((x) => Date.now() - x.at < 5_000 && norm(x.text) === norm(text))) {
        logActivity(supabase, "speak", `（同じ文を 5 秒以内に読もうとしたので読まなかった）${text}`);
        return;
      }
      logActivity(supabase, "speak", text);
      recentSpoken.current = [...recentSpoken.current.filter((x) => Date.now() - x.at < 60_000), { text, at: Date.now() }];
      speakRaw(text, onStart);
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
    enabled: wakeOn && isLeader && !isPhone,
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
      // 1 文ずつ読み、読み始めた文に合うカード（say）を出す（話に合わせて 1 枚ずつ見せる。利用者の希望）
      if (speakOn && chunk && leaderRef.current)
        for (const sentence of splitSentences(toSpeech(chunk))) {
          queuedSentences.current++;
          speak(sentence, () => {
            queuedSentences.current = Math.max(0, queuedSentences.current - 1);
            revealCardsFor(sentence);
          });
        }
      else if (chunk) revealCardsFor(chunk);
      if (final) {
        liveIds.current.delete(m.id);
        replyDone.current = true;
        if (!speakOn || !leaderRef.current || !isSpeaking()) revealAllCards();
        // 呼びかけを待つ設定なら、言い終えたあと 8 秒は続けて話せるようにする
        if (wakeOn && !isPhone) {
          if (speakOn) followUpAfterSpeech.current = true;
          else wakeRef.current?.followUp();
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 返事が届いた時刻から字幕を出す
        setCaptionUntil(Date.now() + captionSec * 1000);
        setCaptionKept(true);
      }
    }
  }, [messages, speak, speakOn, wakeOn, isPhone, captionSec, leaderRef, isSpeaking, revealAllCards, revealCardsFor]);

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
    recognition.listening || wakeListening || speaker.speaking || (lastReply?.status === "processing") || (now !== null && now.getTime() < captionUntil) || noticeOn || captionKept;
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
      if (wakeOn && !isPhone) {
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
    if (wakeOn && !isPhone) return wakeListening ? wake.finish() : wake.startCommand();
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

  /** スマホのメニューで選んだもの */
  function runMenu(key: MenuKey) {
    setPanel("none");
    logActivity(supabase, "ui", `メニュー: ${key}`);
    if (key === "chat") toggleChat();
    else if (key === "bookmarks") {
      loadBookmarks();
      setPanel("bookmarks");
    } else if (key === "memory") router.push("/memory");
    else if (key === "fullscreen") toggleFullscreen();
    else setPanel(key);
  }

  // 話に合わせて出すため、まだ隠しているカードは出さない
  const visibleCards = cards.filter((c) => !c.hidden);

  const time = now?.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
  const date = now?.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short" });
  const pcLabel = online ? "PC オンライン" : online === false ? "PC オフライン" : "PC 確認中";

  return (
    <div className="dimy-grid relative h-dvh w-full overflow-hidden text-cyan-100">
      <DataField mode={mode} tone={tone} />
      <HudChrome now={now} mode={mode} online={online} messages={messages} todayCount={todayCount} pinCount={pins.pins.length} onPick={(m) => void recall(m.role === "user" ? m.id : (m.reply_to ?? m.id))} />

      <Showcase
        cards={visibleCards}
        onClose={(id) => setCards((prev) => prev.filter((c) => c.id !== id))}
        onPin={(id) => setCards((prev) => prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)))}
        onCloseAll={() => {
          logActivity(supabase, "card", `カードをすべて閉じた（${cards.length} 枚）`);
          setCards([]);
          setCaptionKept(false);
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
          <Ring mode={mode} tone={tone} waiting={wakeOn && isLeader && !isPhone && wake.state === "standby"} />
        </div>
      </div>

      {/* 字幕（話している・聞いている間と、返事のあとは次の会話か「カードをすべて閉じる」まで。右上の × でも閉じる） */}
      {/* 長いときは省かずに、枠の中でスクロールして全文を出す（書き足されるたびに、いちばん下へ送る） */}
      <div
        className={
          "absolute inset-x-0 bottom-32 z-[850] mx-auto max-w-2xl px-6 transition-opacity duration-700 [&:hover_.caption-close]:opacity-100 " +
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
        {captionKept && !speaker.speaking && (
          <button
            onClick={() => {
              setCaptionKept(false);
              setCaptionUntil(0);
              logActivity(supabase, "ui", "字幕を閉じた");
            }}
            aria-label="字幕を閉じる"
            title="字幕を閉じる"
            className="caption-close absolute -top-2 right-5 grid h-6 w-6 place-items-center rounded-full border border-cyan-400/40 bg-slate-950/90 text-cyan-300 opacity-60 transition hover:text-cyan-100"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        )}
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
      {/* スマホ（幅の狭い画面）では「会話」「設定」と「メニュー」だけを出し、ほかはメニューの中に並べる（はみ出して押せなくなるため） */}
      <nav className="absolute right-3 top-3 z-[800] flex gap-2 md:right-5 md:top-5">
        <button onClick={() => toggleChat()} className={iconBtn} title="会話の履歴と文字入力" aria-label="会話の履歴と文字入力">
          <ChatIcon className="h-5 w-5" />
        </button>
        <button
          onClick={() => {
            if (panel !== "bookmarks") loadBookmarks();
            setPanel(panel === "bookmarks" ? "none" : "bookmarks");
          }}
          className={iconBtn + " hidden md:grid"}
          data-panel-toggle
          title="ブックマーク"
          aria-label="ブックマーク"
        >
          <BookmarkIcon className="h-5 w-5" />
        </button>
        <Link href="/memory" className={iconBtn + " hidden md:grid"} title="覚えていること" aria-label="覚えていること">
          <MemoryIcon className="h-5 w-5" />
        </Link>
        <button onClick={() => setPanel(panel === "pin" ? "none" : "pin")} data-panel-toggle className={iconBtn + " hidden md:grid"} title="固定ウィンドウを置く" aria-label="固定ウィンドウを置く">
          <PinIcon className="h-5 w-5" />
        </button>
        <button onClick={() => setPanel(panel === "palette" ? "none" : "palette")} data-panel-toggle className={iconBtn + " hidden md:grid"} title="パレットをほかのモニターに開く" aria-label="パレットを開く">
          <PaletteIcon className="h-5 w-5" />
        </button>
        <button onClick={() => setPanel(panel === "admin" ? "none" : "admin")} className={iconBtn + " hidden md:grid"} title="管理（会話・システム・動作の記録）" aria-label="管理">
          <AdminIcon className="h-5 w-5" />
        </button>
        <button onClick={() => setPanel(panel === "settings" ? "none" : "settings")} className={iconBtn} title="設定" aria-label="設定">
          <GearIcon className="h-5 w-5" />
        </button>
        <button onClick={() => setPanel(panel === "menu" ? "none" : "menu")} data-panel-toggle className={iconBtn + " md:hidden"} title="メニュー" aria-label="メニュー">
          <MenuIcon className="h-5 w-5" />
        </button>
        <button onClick={toggleFullscreen} className={iconBtn + " hidden md:grid"} title="全画面" aria-label="全画面の切り替え">
          {fullscreen ? <ShrinkIcon className="h-5 w-5" /> : <ExpandIcon className="h-5 w-5" />}
        </button>
      </nav>

      {/* スマホのメニュー: 右上に出しきれないボタンを、名前つきで並べる */}
      {panel === "menu" && (
        <DismissBox onClose={closePanel} className="absolute right-3 top-16 z-[950] w-[min(20rem,calc(100vw-1.5rem))] rounded-lg border border-cyan-400/30 bg-slate-950/95 p-2 text-sm backdrop-blur md:hidden">
          {(
            [
              ["chat", "会話の履歴と文字入力", <ChatIcon key="i" className="h-5 w-5" />],
              ["bookmarks", "ブックマーク", <BookmarkIcon key="i" className="h-5 w-5" />],
              ["calendar", "カレンダー", <CalendarIcon key="i" className="h-5 w-5" />],
              ["weather", "天気の詳細", <WeatherIcon key="i" code={weather?.code ?? 0} className="h-5 w-5" />],
              ["memory", "覚えていること", <MemoryIcon key="i" className="h-5 w-5" />],
              ["pin", "固定ウィンドウを置く", <PinIcon key="i" className="h-5 w-5" />],
              ["admin", "管理（記録を見る）", <AdminIcon key="i" className="h-5 w-5" />],
              ["settings", "設定", <GearIcon key="i" className="h-5 w-5" />],
              ["fullscreen", fullscreen ? "全画面をやめる" : "全画面", fullscreen ? <ShrinkIcon key="i" className="h-5 w-5" /> : <ExpandIcon key="i" className="h-5 w-5" />],
            ] as [MenuKey, string, React.ReactNode][]
          ).map(([key, label, icon]) => (
            <button
              key={key}
              onClick={() => runMenu(key)}
              className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-base text-cyan-100 hover:bg-cyan-400/10"
            >
              <span className="text-cyan-300">{icon}</span>
              {label}
            </button>
          ))}
        </DismissBox>
      )}

      {/* 左下：日時（スマホでは左上の PC の状態の下に、小さく出す。下はマイクと停止のボタンの場所のため） */}
      <button
        onClick={() => setPanel(panel === "calendar" ? "none" : "calendar")}
        data-panel-toggle
        className="absolute left-3 top-12 z-[800] rounded-lg px-2 py-1 text-left font-mono transition hover:bg-cyan-400/10 md:bottom-6 md:left-6 md:top-auto"
        title="カレンダー（Google カレンダーの予定）"
        aria-label="カレンダーを開く"
      >
        <div className="text-xl tracking-widest text-cyan-200 md:text-4xl drop-shadow-[0_0_10px_rgba(34,211,238,0.45)]">{time}</div>
        <div className="text-[11px] tracking-[0.2em] text-cyan-400/70 md:mt-1 md:text-xs md:tracking-[0.25em]">{date}</div>
      </button>
      {panel === "calendar" && <CalendarPanel session={session} onClose={closePanel} />}

      {/* 右下：天気 */}
      {weather && (
        <button
          onClick={() => setPanel(panel === "weather" ? "none" : "weather")}
          data-panel-toggle
          className="absolute right-3 top-16 z-[800] flex items-center gap-2 rounded-lg px-2 py-1 text-left transition hover:bg-cyan-400/10 md:bottom-6 md:right-6 md:top-auto md:gap-3"
          title={`${place?.name} ${weather.text ?? weatherLabel(weather.code)}（${weather.source}。押すと詳しく）`}
          aria-label="天気の詳細"
        >
          <WeatherIcon code={weather.code} className="h-7 w-7 text-cyan-300 md:h-10 md:w-10" />
          <div className="font-mono">
            <div className="text-lg text-cyan-200 md:text-3xl">{Math.round(weather.temperature)}°</div>
            <div className="text-xs text-cyan-400/70">
              {Math.round(weather.max)}° / {Math.round(weather.min)}°{weather.rain !== null && ` ・${weather.rain}%`}
            </div>
          </div>
        </button>
      )}
      {panel === "weather" && place && <WeatherPanel place={place} source={weatherSource} onClose={closePanel} />}

      {/* 下中央：マイク（小窓より手前に出す。周りの空いた所は、下の小窓をそのまま触れるようにする） */}
      <div className="pointer-events-none absolute inset-x-0 bottom-8 z-[900] flex flex-col items-center [&>*]:pointer-events-auto">
        {/* 下の操作: 強制停止・文字の入力欄（タイピングで話しかける。利用者の希望）・マイク */}
        <div className="flex w-[min(760px,calc(100vw-1.5rem))] items-end gap-2 md:gap-3">
          {/* 強制停止（いつも出しておく。動いているときは明るくなる。Esc キー・「ストップ」でも同じ） */}
          <button
            onClick={forceStop}
            title="強制停止（Esc ／「ストップ」）"
            aria-label="強制停止"
            className={
              "mb-1.5 grid h-10 w-10 shrink-0 place-items-center rounded-full border backdrop-blur transition md:mb-2.5 md:h-11 md:w-11 " +
              (mode !== "idle" || wakeListening
                ? "border-rose-400/80 bg-rose-500/15 text-rose-200 shadow-[0_0_18px_rgba(244,63,94,0.45)] hover:bg-rose-500/30"
                : "border-cyan-400/25 bg-slate-950/50 text-cyan-300/60 hover:border-rose-400/60 hover:text-rose-200")
            }
          >
            <StopIcon className="h-5 w-5" />
          </button>
          <TextBox
            onSend={(t) => {
              cancelSpeech();
              logActivity(supabase, "typed", "下の入力欄から文字で送った");
              void handleUtterance(t);
            }}
          />
          {recognition.supported && (
            <button
              onClick={onMic}
              aria-label={recognition.listening ? "聞き取りをやめる" : "話しかける"}
              className={
                "grid h-14 w-14 shrink-0 place-items-center rounded-full border backdrop-blur transition md:h-16 md:w-16 " +
                (recognition.listening
                  ? "animate-pulse border-rose-400 bg-rose-500/20 text-rose-200 shadow-[0_0_28px_rgba(244,63,94,0.5)]"
                  : "border-cyan-300/60 bg-cyan-500/10 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.35)] hover:bg-cyan-500/20")
              }
            >
              {recognition.listening ? <SendGlyph /> : <MicIcon className="h-7 w-7" />}
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
            isPhone
              ? "スマホでは使いません（マイクのボタンで話してください。開くたびにマイクの許可を聞かれないようにするため）"
              : !wakeOn
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
      {panel === "pin" && <PinAdd state={pins} onClose={closePanel} className="absolute right-3 top-40 z-[850] md:right-5 md:top-20" />}
      {panel === "palette" && <ScreenPicker onClose={closePanel} className="absolute right-3 top-40 z-[850] md:right-5 md:top-20" />}
      <DropOverlay show={dragging} />
      <AppDock onOpen={openApp} />
      <AppWindows state={appWins} />

      {/* 会話の履歴と文字入力（右から出るパネル） */}
    </div>
  );
}
