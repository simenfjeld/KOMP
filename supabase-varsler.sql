-- KOMP: push-varsler når noen deler et bilde eller en video
-- Kjøres i Supabase: SQL Editor -> New query -> lim inn -> Run. Trygt å kjøre flere ganger.
-- Nøklene som signerer varslene ligger IKKE her; de legges inn med en egen blokk som ikke ligger på GitHub.

-------------------------------------------------------------------------------
-- Hvilke telefoner/nettbrett som vil ha varsler
-------------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
-- ingen direkte tilgang; appen bruker funksjonene under

create or replace function public.save_push(e text, k text, a text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'Ikke medlem'; end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (e, auth.uid(), k, a)
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

create or replace function public.remove_push(e text) returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = e and user_id = auth.uid()
$$;

-------------------------------------------------------------------------------
-- Nøkler for signering av varsler (bare lesbare for serveren)
-------------------------------------------------------------------------------
create table if not exists public.app_secrets (
  id            int primary key default 1 check (id = 1),
  vapid_public  text not null,
  vapid_private text not null,
  vapid_subject text not null
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

-------------------------------------------------------------------------------
-- Send varsel når et nytt innlegg lagres
-------------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

alter table public.posts add column if not exists notified boolean not null default false;

create or replace function public.notify_new_post() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url     := 'https://hyzbhiehcjddnwbqhohr.supabase.co/functions/v1/notify',
    body    := jsonb_build_object('post_id', new.id),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
end $$;

drop trigger if exists on_post_created on public.posts;
create trigger on_post_created after insert on public.posts
  for each row execute function public.notify_new_post();
