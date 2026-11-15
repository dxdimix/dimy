// モニターの一覧と位置（Chrome / Edge の「ウィンドウの配置」の機能 getScreenDetails）。
// 許可（「ウィンドウの管理」）がまだのときに、ドラッグの途中で許可を求める画面を出さないよう、許可済みのときだけ読む。

export type ScreenInfo = { label: string; availLeft: number; availTop: number; availWidth: number; availHeight: number; isPrimary: boolean };
type ScreenDetails = { screens: ScreenInfo[]; currentScreen: ScreenInfo };

let cache: ScreenDetails | null = null;

/** モニターの一覧（許可がない・使えないときは null）。ask = true なら、許可を求めてもよい */
export async function getScreens(ask = false): Promise<ScreenInfo[] | null> {
  if (typeof window === "undefined" || !("getScreenDetails" in window)) return null;
  if (cache) return cache.screens;
  if (!ask) {
    try {
      const st = await navigator.permissions.query({ name: "window-management" as PermissionName });
      if (st.state !== "granted") return null;
    } catch {
      return null;
    }
  }
  try {
    cache = await (window as unknown as { getScreenDetails: () => Promise<ScreenDetails> }).getScreenDetails();
    return cache.screens;
  } catch {
    return null;
  }
}

/** モニター上の点（screenX, screenY）があるモニターの番号（0 から）。なければ -1 */
export function screenIndexAt(screens: ScreenInfo[], x: number, y: number) {
  return screens.findIndex((s) => x >= s.availLeft && x < s.availLeft + s.availWidth && y >= s.availTop && y < s.availTop + s.availHeight);
}

/** パレットを開く。screen を省くと、普通の新しいウィンドウで開く */
export function openPalette(n: number, screen?: ScreenInfo) {
  const f = screen
    ? `popup=yes,left=${screen.availLeft},top=${screen.availTop},width=${screen.availWidth},height=${screen.availHeight}`
    : "popup=yes,width=1280,height=800";
  return window.open(`/palette?n=${n}`, `dimy-palette-${n}`, f) !== null;
}

/**
 * モニターに、並び方から分かる名前を付ける（例: 左・中央・右・中央の上）。番号では分かりにくいため。
 * 横: 全体の幅を 3 つに分けて、モニターの中心がどこにあるか。縦: メインのモニターと同じ段か、その上・下か。
 * 同じ名前になったときは、番号を添えて見分ける。
 */
export function describeScreens(screens: Pick<ScreenInfo, "availLeft" | "availTop" | "availWidth" | "availHeight" | "isPrimary">[]): string[] {
  if (!screens.length) return [];
  const minX = Math.min(...screens.map((s) => s.availLeft));
  const maxX = Math.max(...screens.map((s) => s.availLeft + s.availWidth));
  const main = screens.find((s) => s.isPrimary) ?? screens[0];
  const names = screens.map((s) => {
    const cx = s.availLeft + s.availWidth / 2;
    const cy = s.availTop + s.availHeight / 2;
    const r = (cx - minX) / Math.max(1, maxX - minX);
    const h = screens.length === 1 ? "" : r < 1 / 3 ? "左" : r > 2 / 3 ? "右" : "中央";
    const v = cy < main.availTop ? "上" : cy > main.availTop + main.availHeight ? "下" : "";
    if (!h && !v) return "このモニター";
    if (!v) return h;
    return h ? `${h}の${v}` : v;
  });
  return names.map((n, i) => (names.filter((x) => x === n).length > 1 ? `${n}（${i + 1}）` : n));
}
