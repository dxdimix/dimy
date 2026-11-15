// DIMY の Chrome の拡張機能（extension/）とのやり取り。
// 拡張機能が入っていると、<html data-dimy-ext="版"> が付き、ディミの画面の中でどのページも開ける（中に表示しないでの印を外す）。
// 画面の写真も、拡張機能に頼んで撮る（クラウドの開発用セッションから画面を確かめるため）。

import { useSyncExternalStore } from "react";

function read(): string | null {
  if (typeof document === "undefined") return null;
  return document.documentElement.getAttribute("data-dimy-ext");
}

/** 拡張機能の版（入っていなければ null） */
export function useDimyExtension(): string | null {
  return useSyncExternalStore(
    (cb) => {
      const onMsg = (ev: MessageEvent) => {
        if (ev.source === window && ev.data && typeof ev.data === "object" && "dimyExtReady" in ev.data) cb();
      };
      window.addEventListener("message", onMsg);
      const obs = new MutationObserver(cb);
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-dimy-ext"] });
      return () => {
        window.removeEventListener("message", onMsg);
        obs.disconnect();
      };
    },
    read,
    () => null,
  );
}

export const hasDimyExtension = () => read() !== null;

/** 拡張機能に、この画面の写真を撮ってもらう（JPEG の data URL）。拡張機能がなければエラー */
export function captureScreen(timeoutMs = 10_000): Promise<string> {
  if (!hasDimyExtension()) return Promise.reject(new Error("DIMY の拡張機能が入っていません。"));
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMsg);
      reject(new Error("拡張機能から返事がありませんでした。"));
    }, timeoutMs);
    function onMsg(ev: MessageEvent) {
      const m = ev.data;
      if (ev.source !== window || !m || m.dimyExtReply !== "capture" || m.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      if (m.ok && typeof m.dataUrl === "string") resolve(m.dataUrl);
      else reject(new Error(m.error || "画面の写真を撮れませんでした。"));
    }
    window.addEventListener("message", onMsg);
    window.postMessage({ dimyExt: "capture", id }, location.origin);
  });
}

/** 写真を小さくして、文字（data URL）の大きさを抑える（横 maxW まで・JPEG） */
export async function shrinkImage(dataUrl: string, maxW = 1600, quality = 0.6): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const k = Math.min(1, maxW / img.naturalWidth);
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}

/** 中で開くページの枠に付ける制限（ページが自分をいちばん上の画面にしようとして、ディミの画面から抜け出すのを防ぐ） */
export const WEB_FRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-presentation allow-storage-access-by-user-activation";
