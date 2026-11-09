-- Billaura: short store links  (run once in Supabase → SQL Editor)
-- Gives every shop a public address like  yoursite/billaura/store/my-shop-name
create table if not exists public.public_stores (
  slug       text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  shop_id    uuid not null unique references public.shops(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.public_stores enable row level security;

drop policy if exists "stores public read"  on public.public_stores;
drop policy if exists "stores owner insert" on public.public_stores;
drop policy if exists "stores owner update" on public.public_stores;
drop policy if exists "stores owner delete" on public.public_stores;

create policy "stores public read"  on public.public_stores for select to anon, authenticated using (true);
create policy "stores owner insert" on public.public_stores for insert to authenticated with check (shop_id = public.my_shop_id());
create policy "stores owner update" on public.public_stores for update to authenticated using (shop_id = public.my_shop_id()) with check (shop_id = public.my_shop_id());
create policy "stores owner delete" on public.public_stores for delete to authenticated using (shop_id = public.my_shop_id());
