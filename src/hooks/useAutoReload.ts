"use client";

// 新しい版の画面が公開されたら、自分で読み込み直す（古い画面のまま、前の決まりで動き続けないように）。
// 5 分ごとに /api/version を確かめ、開いたときの版と違ったら、手が空いているとき（canReload が true）に読み込み直す。

import { useEffect, useRef } from "react";

export function useAutoReload(canReload: boolean, onReload?: (from: string, to: string) => void) {
  const first = useRef<string | null>(null);
  const pending = useRef<string | null>(null);
  const can = useRef(canReload);
  const cb = useRef(onReload);
  useEffect(() => {
    can.current = canReload;
    cb.current = onReload;
  });

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        const { version } = (await res.json()) as { version: string };
        if (!alive || !version || version === "dev") return;
        if (first.current === null) first.current = version;
        else if (version !== first.current) pending.current = version;
      } catch {}
    };
    check();
    const t1 = setInterval(check, 5 * 60_000);
    // 新しい版があれば、手が空いたときに読み込み直す
    const t2 = setInterval(() => {
      if (pending.current && can.current && document.visibilityState !== "hidden") {
        cb.current?.(first.current ?? "", pending.current);
        location.reload();
      }
    }, 5_000);
    return () => {
      alive = false;
      clearInterval(t1);
      clearInterval(t2);
    };
  }, []);
}
