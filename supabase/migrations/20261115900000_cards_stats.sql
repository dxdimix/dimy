-- 画面のカードに「大事な数字」（stats）を足す。20261115800000_cards.sql を先に実行していても、あとから実行しても同じ結果になる。
alter table public.cards drop constraint if exists cards_kind_check;
alter table public.cards add constraint cards_kind_check
  check (kind in ('list', 'video', 'points', 'page', 'image', 'text', 'stats'));
notify pgrst, 'reload schema';
