-- ディミの画面の写真（クラウドの開発用セッションから画面を確かめるため）。
-- 開発用セッションが保守の窓口で頼む（status = requested）→ 開いているディミの画面（拡張機能あり）が撮って image に入れる → 窓口で受け取る。
-- 撮るのはディミのタブの見えている部分だけ（拡張機能の captureVisibleTab）。頼まれたときだけ撮る。7 日より古いものは頼むときに消す。

create table if not exists public.screen_shots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'done', 'error')),
  image text,
  note text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
alter table public.screen_shots enable row level security;
-- 画面（本人）は、頼まれた行を読んで、写真を書き込むだけ（作る・消すことはできない）
drop policy if exists "read own screen shots" on public.screen_shots;
create policy "read own screen shots" on public.screen_shots
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "answer own screen shots" on public.screen_shots;
create policy "answer own screen shots" on public.screen_shots
  for update to authenticated using (user_id = (select auth.uid()) and status = 'requested') with check (user_id = (select auth.uid()));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'screen_shots') then
    alter publication supabase_realtime add table public.screen_shots;
  end if;
end $$;

-- 保守の窓口: 写真を頼む（頼んだ id を返す）
create or replace function public.dimy_maint_screenshot() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  new_id uuid;
begin
  if not public.dimy_maint_ok() then
    raise exception '合言葉が違います' using errcode = '42501';
  end if;
  delete from public.screen_shots where created_at < now() - interval '7 days';
  select id into owner from auth.users order by created_at limit 1;
  insert into public.screen_shots (user_id) values (owner) returning id into new_id;
  return new_id;
end;
$$;
grant execute on function public.dimy_maint_screenshot() to anon, authenticated;

-- 保守の窓口: 頼んだ写真を受け取る
create or replace function public.dimy_maint_screenshot_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  out jsonb;
begin
  if not public.dimy_maint_ok() then
    raise exception '合言葉が違います' using errcode = '42501';
  end if;
  select jsonb_build_object('status', status, 'note', note, 'image', image, 'created_at', created_at, 'done_at', done_at) into out
  from public.screen_shots where id = p_id;
  return out;
end;
$$;
grant execute on function public.dimy_maint_screenshot_get(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
