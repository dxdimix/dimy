-- 画面のカード（DIMY が返事の中身を目で見せるために出すもの: ニュースの一覧・動画・要点の図など）。
-- PC の DIMY（MCP の道具 show_card。service_role）が書き、画面は本人の行を読むだけ。届いたらすぐ出すため Realtime に入れる。
-- 古いカードは 7 日で消す（PC の DIMY が消す）。

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- list（一覧）/ video（動画）/ points（要点・手順の図）/ page（ページ）/ image（画像）/ text（文）
  kind text not null check (kind in ('list', 'video', 'points', 'page', 'image', 'text')),
  title text not null default '',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index cards_user_time_idx on public.cards (user_id, created_at desc);
alter table public.cards enable row level security;
create policy "read own cards" on public.cards
  for select to authenticated using (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.cards;
notify pgrst, 'reload schema';
