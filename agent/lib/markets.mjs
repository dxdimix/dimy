// 株価・為替などの直近の値動き（カードの小さなグラフ用。利用者の決まり 2026-11-20: 経済指標や株価には、価格と一緒に直近の推移のグラフを出す）。
// Stooq（stooq.com）の日足の CSV を読む（登録もキーも要らない）。終値だけを使い、ほかには使わない。

/** 呼び名 → Stooq の記号 */
export const TICKERS = {
  nikkei: "^nkx",
  topix: "^tpx",
  dow: "^dji",
  sp500: "^spx",
  nasdaq: "^ndq",
  usdjpy: "usdjpy",
  eurjpy: "eurjpy",
  eurusd: "eurusd",
  gold: "xauusd",
  oil: "cl.f",
  btc: "btcusd",
  us10y: "10usy.b",
  jp10y: "10jpy.b",
};

/** 項目の名前から呼び名を推し量る（ディミが ticker を付け忘れたとき用） */
export function guessTicker(label) {
  const t = String(label ?? "").replace(/\s+/g, "").toLowerCase();
  if (/日経|nikkei|n225/.test(t)) return "nikkei";
  if (/topix|東証株価指数/.test(t)) return "topix";
  if (/ダウ|dow|djia/.test(t)) return "dow";
  if (/s&p|sp500|ｓ＆ｐ/.test(t)) return "sp500";
  if (/ナスダック|nasdaq/.test(t)) return "nasdaq";
  if (/ドル円|ドル\/円|usd\/?jpy|米ドル/.test(t)) return "usdjpy";
  if (/ユーロ円|eur\/?jpy/.test(t)) return "eurjpy";
  if (/ユーロドル|eur\/?usd/.test(t)) return "eurusd";
  if (/金価格|^金$|ゴールド|gold/.test(t)) return "gold";
  if (/原油|wti|oil/.test(t)) return "oil";
  if (/ビットコイン|bitcoin|btc/.test(t)) return "btc";
  if (/米10年|米国債10年|us10y/.test(t)) return "us10y";
  if (/日本10年|日本国債10年|長期金利/.test(t)) return "jp10y";
  return undefined;
}

/** Stooq の日足の CSV から、日付と終値を取り出す */
export function parseStooqCsv(csv) {
  const rows = String(csv).trim().split(/\r?\n/);
  if (!/^date/i.test(rows[0] ?? "")) return [];
  const head = rows[0].toLowerCase().split(",");
  const ci = head.indexOf("close");
  if (ci < 0) return [];
  return rows
    .slice(1)
    .map((r) => r.split(","))
    .map((c) => ({ date: c[0], close: Number(c[ci]) }))
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && Number.isFinite(x.close));
}

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

/** 直近 days 日（営業日）の終値。取れなければ空 */
export async function fetchSeries(ticker, days = 30, timeoutMs = 6000) {
  const sym = TICKERS[ticker];
  if (!sym) return [];
  const to = new Date();
  const from = new Date(to.getTime() - (days * 1.6 + 10) * 864e5);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d&d1=${ymd(from)}&d2=${ymd(to)}`;
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 (DIMY personal assistant)" } });
    if (!res.ok) return [];
    return parseStooqCsv(await res.text()).slice(-days);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
