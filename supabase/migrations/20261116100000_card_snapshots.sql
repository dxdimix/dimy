-- 会話ごとの画面のカードの控え。次の会話に移るとカードは片付くが、そのときのカードをここに残し、
-- 会話の履歴（右下の LOG・会話のパネル）を押すと、そのときの会話とカードを出し直す。
-- 画面（本人）が書いて読む。発言（messages）を消すと一緒に消える。
create table if not exists public.card_snapshots (
  message_id uuid primary key references public.messages (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cards jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.card_snapshots enable row level security;
drop policy if exists "read own card snapshots" on public.card_snapshots;
create policy "read own card snapshots" on public.card_snapshots
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "insert own card snapshots" on public.card_snapshots;
create policy "insert own card snapshots" on public.card_snapshots
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "update own card snapshots" on public.card_snapshots;
create policy "update own card snapshots" on public.card_snapshots
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
notify pgrst, 'reload schema';
