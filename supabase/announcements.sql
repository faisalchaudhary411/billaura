-- Billaura: notifications / announcements  (run once in Supabase -> SQL Editor; safe to re-run)
-- Needs the main schema.sql from the admin repo to have been run first.
create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null default '',
  kind        text not null default 'info' check (kind in ('info', 'update', 'offer', 'warning')),
  audience    text not null default 'all' check (audience in ('all', 'free', 'trial', 'basic', 'pro', 'paid')),
  cta_label   text,
  cta_url     text,           -- opens in the browser
  cta_action  text,           -- or an in-app action: open-plans
  coupon      text,           -- discount code shown to the shop
  priority    int  not null default 0,    -- 1 = also pops up once when the app opens
  active      boolean not null default true,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.announcements enable row level security;
drop policy if exists "ann admin"  on public.announcements;
drop policy if exists "ann read"   on public.announcements;
create policy "ann admin" on public.announcements for all using (public.is_platform_admin()) with check (public.is_platform_admin());
-- every signed-in shop sees the live notices meant for its plan (decided by the database, not the app)
create policy "ann read" on public.announcements for select to authenticated using (
  active and starts_at <= now() and (ends_at is null or ends_at > now())
  and (
    audience = 'all'
    or audience = public.shop_effective_plan(public.my_shop_id())
    or (audience = 'paid' and public.shop_effective_plan(public.my_shop_id()) in ('basic', 'pro', 'lifetime'))
  )
);
create index if not exists announcements_created_idx on public.announcements (created_at desc);
