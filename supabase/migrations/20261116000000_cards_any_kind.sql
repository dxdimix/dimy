-- 画面のカードの種類の制限を外す（地図 map などを足すたびに SQL を実行しなくて済むように）。
-- 種類は PC の DIMY（agent/tools/cards.mjs の normalizeCard）が確かめる。表に書けるのは PC の DIMY（service_role）だけ。
alter table public.cards drop constraint if exists cards_kind_check;
notify pgrst, 'reload schema';
