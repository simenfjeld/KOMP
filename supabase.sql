-- KOMP: databaseoppsett for Supabase
-- Kjør hele denne filen én gang i Supabase: SQL Editor -> New query -> lim inn -> Run.
-- Admin-e-posten står nederst i funksjonen admin_email(). Bytt den hvis du vil bruke en annen.

-------------------------------------------------------------------------------
-- Tabeller
-------------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  color        int  not null default floor(random() * 10)::int,  -- tilfeldig avatarfarge (0-9), settes når brukeren lages
  avatar_path  text,
  is_admin     boolean not null default false,
  blocked      boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.invites (
  code       text primary key,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  author      uuid not null references public.profiles(id) on delete cascade,
  caption     text,
  media_path  text not null,
  media_type  text not null check (media_type in ('image','video')),
  width       int,
  height      int,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz            -- null = for alltid
);
create index if not exists posts_created_idx on public.posts (created_at desc);

-------------------------------------------------------------------------------
-- Hjelpefunksjoner
-------------------------------------------------------------------------------
create or replace function public.admin_email() returns text
language sql immutable as $$ select 'fjeldsimen@gmail.com'::text $$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and not blocked)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_admin and not blocked)
$$;

-------------------------------------------------------------------------------
-- Ny bruker: krever gyldig invitasjonskode (unntatt admin)
-------------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  inv  text := new.raw_user_meta_data->>'invite_code';
  name text := coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1));
  admin boolean := lower(new.email) = lower(public.admin_email());
begin
  if not admin and not exists (select 1 from invites where invites.code = inv and active) then
    raise exception 'Ugyldig eller utløpt invitasjon';
  end if;
  insert into profiles (id, display_name, is_admin) values (new.id, name, admin);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-------------------------------------------------------------------------------
-- RPC-er appen bruker
-------------------------------------------------------------------------------
-- Sjekk invitasjonskode før registrering (kan kalles uten innlogging)
create or replace function public.check_invite(c text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from invites where code = c and active)
$$;
grant execute on function public.check_invite(text) to anon, authenticated;

-- Admin: hent aktiv invitasjonskode (lager en hvis det ikke finnes)
create or replace function public.admin_invite(make_new boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not is_admin() then raise exception 'Kun admin'; end if;
  if make_new then update invites set active = false where active; end if;
  select code into c from invites where active order by created_at desc limit 1;
  if c is null then
    c := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    insert into invites (code) values (c);
  end if;
  return c;
end $$;

-- Admin: sperr eller slipp inn et medlem igjen
create or replace function public.admin_set_blocked(uid uuid, b boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Kun admin'; end if;
  if uid = auth.uid() then raise exception 'Du kan ikke sperre deg selv'; end if;
  update profiles set blocked = b where id = uid;
end $$;

-- Admin: slett utløpte innlegg og returner filstiene, så appen kan slette filene
create or replace function public.purge_expired() returns setof text
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Kun admin'; end if;
  return query
    delete from posts where expires_at is not null and expires_at <= now() returning media_path;
end $$;

-------------------------------------------------------------------------------
-- Tilgangsregler (Row Level Security)
-------------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.invites  enable row level security;
alter table public.posts    enable row level security;

drop policy if exists "members read profiles" on public.profiles;
create policy "members read profiles" on public.profiles for select using (is_member());
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant update (display_name, avatar_path) on public.profiles to authenticated;

-- invites: ingen direkte tilgang, kun via funksjonene over

drop policy if exists "members read live posts" on public.posts;
create policy "members read live posts" on public.posts for select
  using (is_member() and (expires_at is null or expires_at > now()));
drop policy if exists "members create own posts" on public.posts;
create policy "members create own posts" on public.posts for insert
  with check (is_member() and author = auth.uid());
drop policy if exists "author or admin deletes" on public.posts;
create policy "author or admin deletes" on public.posts for delete
  using (author = auth.uid() or is_admin());

-------------------------------------------------------------------------------
-- Lagring av bilder og video (privat bøtte, 50 MB per fil)
-------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists "komp members read media" on storage.objects;
create policy "komp members read media" on storage.objects for select
  using (bucket_id = 'media' and public.is_member());
drop policy if exists "komp members upload own" on storage.objects;
create policy "komp members upload own" on storage.objects for insert
  with check (bucket_id = 'media' and public.is_member() and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "komp members update own" on storage.objects;
create policy "komp members update own" on storage.objects for update
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "komp owner or admin deletes" on storage.objects;
create policy "komp owner or admin deletes" on storage.objects for delete
  using (bucket_id = 'media' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-------------------------------------------------------------------------------
-- Sanntid: nye innlegg dukker opp uten at man må laste på nytt
-------------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.posts;
exception when duplicate_object then null; end $$;
