-- Billaura: licence hardening  (run once in Supabase -> SQL Editor; safe to re-run)
-- Needs the main schema.sql from the admin repo to have been run first.

-- 1) Devices that have been licensed for a shop (filled only by the "license" Edge Function)
create table if not exists public.license_devices (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  device_id   text not null,
  label       text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  revoked     boolean not null default false,
  unique (shop_id, device_id)
);
alter table public.license_devices enable row level security;
drop policy if exists "devices admin"      on public.license_devices;
drop policy if exists "devices owner read" on public.license_devices;
create policy "devices admin"      on public.license_devices for all using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "devices owner read" on public.license_devices for select to authenticated using (shop_id = public.my_shop_id());

-- 2) Log of suspicious licence activity (written by the Edge Function, read by the admin)
create table if not exists public.license_events (
  id         bigint generated always as identity primary key,
  shop_id    uuid references public.shops(id) on delete cascade,
  device_id  text,
  kind       text not null,
  detail     text,
  created_at timestamptz not null default now()
);
alter table public.license_events enable row level security;
drop policy if exists "events admin" on public.license_events;
create policy "events admin" on public.license_events for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- 3) Settings the admin can tune
alter table public.platform_settings add column if not exists max_devices int default 3;
alter table public.platform_settings add column if not exists license_grace_days int default 10;

-- 4) The online store is a paid feature: enforced by the database, not just the app
create or replace function public.store_allowed(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select freemium_enabled from public.platform_settings where id = 1), true) = false
      or public.shop_effective_plan(sid) in ('trial', 'pro', 'lifetime');
$$;
drop policy if exists "stores owner insert" on public.public_stores;
drop policy if exists "stores owner update" on public.public_stores;
create policy "stores owner insert" on public.public_stores for insert to authenticated
  with check (shop_id = public.my_shop_id() and public.store_allowed(shop_id));
create policy "stores owner update" on public.public_stores for update to authenticated
  using (shop_id = public.my_shop_id())
  with check (shop_id = public.my_shop_id() and public.store_allowed(shop_id));

-- 5) At most 3 waiting payment requests per shop (stops spamming the admin)
create or replace function public.limit_pending_payreq()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.payment_requests where shop_id = new.shop_id and status = 'pending') >= 3 then
    raise exception 'You already have payment requests waiting for approval. Please wait for them to be checked.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_limit_pending_payreq on public.payment_requests;
create trigger trg_limit_pending_payreq before insert on public.payment_requests
  for each row execute procedure public.limit_pending_payreq();
