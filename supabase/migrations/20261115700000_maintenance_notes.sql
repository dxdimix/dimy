-- 保守の窓口に「覚えていること」（kymis_notes）と評価（feedback）を足す。
-- - 読む: dimy_maint_read('notes') / dimy_maint_read('feedback')
-- - 直す: dimy_maint_note('add' | 'update' | 'off' | 'on', id, kind, content)
--   消すことはしない。「off」で使わないようにし（active = false）、「on」で戻せる
-- 合言葉（dimy-maint-key）がないと、どれも使えない（20261115500000_maintenance.sql と同じ）。

create or replace function public.dimy_maint_read(p_what text, p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  n int := least(greatest(coalesce(p_limit, 100), 1), 1000);
  out jsonb;
begin
  if not public.dimy_maint_ok() then
    raise exception '合言葉が違います' using errcode = '42501';
  end if;
  if p_what = 'messages' then
    select coalesce(jsonb_agg(t order by t.created_at), '[]') into out
    from (select id, role, status, content, error, created_at from public.messages order by created_at desc limit n) t;
  elsif p_what = 'agent_logs' then
    select coalesce(jsonb_agg(t order by t.created_at), '[]') into out
    from (select level, message, created_at from public.agent_logs order by created_at desc limit n) t;
  elsif p_what = 'activity_log' then
    select coalesce(jsonb_agg(t order by t.created_at), '[]') into out
    from (select kind, detail, device, created_at from public.activity_log order by created_at desc limit n) t;
  elsif p_what = 'pc_commands' then
    select coalesce(jsonb_agg(t order by t.created_at), '[]') into out
    from (select id, kind, payload, status, result, created_at from public.pc_commands order by created_at desc limit n) t;
  elsif p_what = 'pc_state' then
    select coalesce(jsonb_agg(t), '[]') into out
    from (select chrome_profiles, claude_sessions, updated_at from public.pc_state) t;
  elsif p_what = 'notes' then
    select coalesce(jsonb_agg(t order by t.active desc, t.created_at), '[]') into out
    from (select id, kind, content, source, active, created_at, updated_at from public.kymis_notes order by created_at desc limit n) t;
  elsif p_what = 'feedback' then
    -- 評価と、評価された返事・その前の発言
    select coalesce(jsonb_agg(t order by t.created_at), '[]') into out
    from (
      select f.rating, f.comment, f.created_at, m.content as reply,
        (select q.content from public.messages q where q.id = m.reply_to) as question
      from public.feedback f join public.messages m on m.id = f.message_id
      order by f.created_at desc limit n
    ) t;
  else
    raise exception '読めるのは messages / agent_logs / activity_log / pc_commands / pc_state / notes / feedback です';
  end if;
  return out;
end;
$$;
grant execute on function public.dimy_maint_read(text, int) to anon, authenticated;

create or replace function public.dimy_maint_note(p_action text, p_id uuid default null, p_kind text default null, p_content text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  rid uuid;
begin
  if not public.dimy_maint_ok() then
    raise exception '合言葉が違います' using errcode = '42501';
  end if;
  if p_action = 'add' then
    if coalesce(btrim(p_content), '') = '' then raise exception '中身が空です'; end if;
    select id into owner from auth.users order by created_at limit 1;
    insert into public.kymis_notes (user_id, kind, content, source)
    values (owner, coalesce(p_kind, 'style'), btrim(p_content), 'user') returning id into rid;
  elsif p_action = 'update' then
    update public.kymis_notes
    set content = coalesce(nullif(btrim(p_content), ''), content), kind = coalesce(p_kind, kind), updated_at = now()
    where id = p_id returning id into rid;
  elsif p_action = 'off' then
    update public.kymis_notes set active = false, updated_at = now() where id = p_id returning id into rid;
  elsif p_action = 'on' then
    update public.kymis_notes set active = true, updated_at = now() where id = p_id returning id into rid;
  else
    raise exception 'できるのは add / update / off / on です';
  end if;
  if rid is null then raise exception 'その id の覚えていることがありません'; end if;
  return rid;
end;
$$;
grant execute on function public.dimy_maint_note(text, uuid, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
