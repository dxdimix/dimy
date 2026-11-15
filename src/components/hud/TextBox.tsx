"use client";

// いつも下に出しておく文字の入力欄（声のかわりにタイピングで話しかける。利用者の希望）。
// Enter で送る・Shift + Enter で改行。日本語の変換中の Enter では送らない。文字が増えたら 5 行まで上に伸びる。

import { useLayoutEffect, useRef, useState } from "react";
import { SendIcon } from "./Icons";

export function TextBox({ onSend, disabled = false }: { onSend: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  // 中身に合わせて高さを変える（1〜5 行）
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 5 * 24 + 16)}px`;
  }, [text]);
  const send = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
  };
  return (
    <div className="flex min-w-0 flex-1 items-end gap-1 rounded-2xl border border-cyan-400/35 bg-slate-950/80 py-1 pl-4 pr-1 shadow-[0_0_18px_rgba(34,211,238,0.15)] backdrop-blur focus-within:border-cyan-300/70">
      <textarea
        ref={ref}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
          // Esc（強制停止）は入力欄の中では効かせない（打っている文を消さないため）
          if (e.key === "Escape") e.stopPropagation();
        }}
        placeholder="DIMY に話しかける（Enter で送信、Shift + Enter で改行）"
        aria-label="文字で話しかける"
        className="max-h-[136px] min-h-[40px] min-w-0 flex-1 resize-none bg-transparent py-2 text-base leading-6 text-cyan-50 placeholder:text-sm placeholder:text-slate-500 focus:outline-none"
      />
      <button
        onClick={send}
        disabled={!text.trim() || disabled}
        aria-label="送信"
        title="送信（Enter）"
        className="mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cyan-500/80 text-slate-950 transition hover:bg-cyan-400 disabled:bg-slate-700/60 disabled:text-slate-400"
      >
        <SendIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
