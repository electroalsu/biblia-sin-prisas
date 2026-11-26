-- Replace the placeholder below with the owner's UUID from Authentication → Users.
begin;

create schema if not exists private;
revoke all on schema private from public;

create table if not exists private.video_owners (
  user_id uuid primary key references auth.users(id) on delete cascade
);

insert into private.video_owners (user_id)
values ('00000000-0000-0000-0000-000000000000')
on conflict do nothing;

create or replace function public.is_video_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.video_owners where user_id = (select auth.uid()));
$$;

revoke all on function public.is_video_owner() from public, anon;
grant execute on function public.is_video_owner() to authenticated;

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 300),
  url text not null check (url ~ '^https://www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}$'),
  book text not null check (book in (
    'GEN','EXO','LEV','NUM','DEU','JOS','JDG','RUT','1SA','2SA','1KI','2KI','1CH','2CH','EZR','NEH',
    'EST','JOB','PSA','PRO','ECC','SNG','ISA','JER','LAM','EZK','DAN','HOS','JOL','AMO','OBA','JON',
    'MIC','NAM','HAB','ZEP','HAG','ZEC','MAL','MAT','MRK','LUK','JHN','ACT','ROM','1CO','2CO','GAL',
    'EPH','PHP','COL','1TH','2TH','1TI','2TI','TIT','PHM','HEB','JAS','1PE','2PE','1JN','2JN','3JN','JUD','REV'
  )),
  chapter integer not null check (chapter between 1 and 150),
  start_verse integer not null check (start_verse between 1 and 176),
  end_verse integer not null check (end_verse between start_verse and 176),
  titles jsonb not null default '{}'::jsonb check (jsonb_typeof(titles) = 'object')
);

alter table public.videos enable row level security;
revoke all on public.videos from anon, authenticated;
grant select on public.videos to anon, authenticated;
grant insert, update, delete on public.videos to authenticated;

drop policy if exists public_read_videos on public.videos;
create policy public_read_videos on public.videos
  for select to anon, authenticated using (true);

drop policy if exists owner_writes_videos on public.videos;
create policy owner_writes_videos on public.videos for all to authenticated
  using ((select public.is_video_owner()))
  with check ((select public.is_video_owner()));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = 'videos') then
    alter publication supabase_realtime add table public.videos;
  end if;
end $$;

commit;
