begin;
create table if not exists public.takechao_rulebook (
  id integer primary key check (id = 1),
  body jsonb check (
    body is null or (
      jsonb_typeof(body) = 'object'
      and body ?& array['game','chips','penalties','manners']
      and jsonb_typeof(body->'game') = 'string'
      and jsonb_typeof(body->'chips') = 'string'
      and jsonb_typeof(body->'penalties') = 'string'
      and jsonb_typeof(body->'manners') = 'string'
      and length(body::text) <= 24000
    )
  ),
  revision uuid not null default gen_random_uuid()
);
alter table public.takechao_rulebook enable row level security;
insert into public.takechao_rulebook (id) values (1) on conflict (id) do nothing;
revoke all on public.takechao_rulebook from public, anon, authenticated;
grant select on public.takechao_rulebook to anon, authenticated;
grant update (body, revision) on public.takechao_rulebook to authenticated;
drop policy if exists rulebook_read on public.takechao_rulebook;
create policy rulebook_read on public.takechao_rulebook for select to anon, authenticated using (true);
drop policy if exists rulebook_edit on public.takechao_rulebook;
create policy rulebook_edit on public.takechao_rulebook for update to authenticated
  using ((select auth.uid()) = '805a1a29-f048-4dc4-9671-93155fb13d2c'::uuid)
  with check ((select auth.uid()) = '805a1a29-f048-4dc4-9671-93155fb13d2c'::uuid);
commit;
