// 返事の文章を画面に出すときの形。**〇〇** は記号を出さずに太字にし、残った ** と行頭の # は消す（利用者の決まり 2026-11-18: アスタリスクは要らない）
export function RichText({ text, strongClass = "font-bold text-white" }: { text: string; strongClass?: string }) {
  return (
    <>
      {text.split(/(\*\*[^*\n]+\*\*)/).map((part, i) =>
        /^\*\*[^*\n]+\*\*$/.test(part) ? (
          <b key={i} className={strongClass}>
            {part.slice(2, -2)}
          </b>
        ) : (
          part.replace(/\*\*/g, "").replace(/^#{1,6}\s+/gm, "")
        ),
      )}
    </>
  );
}
