"use client";

// 新しい版の画面が公開されたら、自分で読み込み直す（古い画面のまま、前の決まりで動き続けないように）。
// 1 分ごとと、画面に戻ってきたときに /api/version を確かめ、開いたときの版と違ったら、手が空いているとき（canReload が true）に読み込み直す。
// 手が空かないまま 10 分たったら、話していないときを待って読み込み直す（古い画面のまま使い続けないように）。

import { useEffect, useRef } from "react";

/**
 * canReload: 今すぐ読み込み直してよいか（何も開いていない・話していない）
 * canForce: 10 分待っても canReload にならないとき、読み込み直してよいか（話していない・聞いていない。設定などは開いていてもよい）
 */
export function useAutoReload(canReload: boolean, onReload?: (from: string, to: string) => void, canForce = canReload) {
  const first = useRef<string | null>(null);
  const pending = useRef<string | null>(null);
  const can = useRef(canReload);
  const force = useRef(canForce);
  const cb = useRef(onReload);
  useEffect(() => {
    can.current = canReload;
    force.current = canForce;
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
    const t1 = setInterval(check, 60_000);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    let pendingSince = 0;
    // 新しい版があれば、手が空いたときに読み込み直す
    const t2 = setInterval(() => {
      if (pending.current && !pendingSince) pendingSince = Date.now();
      const waitedLong = pendingSince > 0 && Date.now() - pendingSince > 10 * 60_000;
      if (pending.current && (can.current || (waitedLong && force.current))) {
        cb.current?.(first.current ?? "", pending.current);
        location.reload();
      }
    }, 5_000);
    return () => {
      alive = false;
      clearInterval(t1);
      clearInterval(t2);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
