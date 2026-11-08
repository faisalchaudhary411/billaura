-- Billaura: real online-store orders (run once in Supabase -> SQL Editor, AFTER stores.sql and license.sql)
-- Customers place an order on the store page; it lands in the shop's Online Orders screen inside the app.
create table if not exists public.store_orders (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops(id) on delete cascade,
  no            integer not null,
  slug          text not null,
  customer_name text not null,
  phone         text not null,
  address       text not null default '',
  mode          text not null default 'delivery' check (mode in ('delivery','pickup')),
  note          text not null default '',
  items         jsonb not null,
  subtotal      numeric not null,
  delivery_fee  numeric not null default 0,
  total         numeric not null,
  status        text not null default 'new' check (status in ('new','accepted','delivered','cancelled')),
  paid          boolean not null default false,
  invoice_id    text,
  cancel_reason text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (shop_id, no)
);
create index if not exists store_orders_shop_idx on public.store_orders (shop_id, created_at desc);
alter table public.store_orders enable row level security;
drop policy if exists "orders owner read"   on public.store_orders;
drop policy if exists "orders owner update" on public.store_orders;
create policy "orders owner read"   on public.store_orders for select to authenticated using (shop_id = public.my_shop_id());
create policy "orders owner update" on public.store_orders for update to authenticated using (shop_id = public.my_shop_id()) with check (shop_id = public.my_shop_id());
-- no insert/delete policy: customers can only go through place_store_order() below

create table if not exists public.store_stats (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  views   bigint not null default 0
);
alter table public.store_stats enable row level security;
drop policy if exists "stats owner read" on public.store_stats;
create policy "stats owner read" on public.store_stats for select to authenticated using (shop_id = public.my_shop_id());

-- counts one visit to the store page
create or replace function public.store_hit(p_slug text) returns void
language plpgsql security definer set search_path = public as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from public.public_stores where slug = p_slug;
  if v_shop is null then return; end if;
  insert into public.store_stats (shop_id, views) values (v_shop, 1)
  on conflict (shop_id) do update set views = public.store_stats.views + 1;
end $$;

-- places an order. Prices are read from the published catalogue on the server, never trusted from the browser.
create or replace function public.place_store_order(
  p_slug text, p_name text, p_phone text, p_address text, p_mode text, p_note text, p_items jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid; v_data jsonb; v_opts jsonb; v_ok boolean := true;
  v_it jsonb; v_el jsonb; v_q numeric; v_lines jsonb := '[]'::jsonb;
  v_sub numeric := 0; v_fee numeric := 0; v_min numeric := 0; v_no integer; v_stock numeric;
begin
  select shop_id, data into v_shop, v_data from public.public_stores where slug = p_slug;
  if v_shop is null then raise exception 'STORE_NOT_FOUND'; end if;
  begin v_ok := public.store_allowed(v_shop); exception when undefined_function then v_ok := true; end;
  if not coalesce(v_ok, true) then raise exception 'STORE_UNAVAILABLE'; end if;
  v_opts := coalesce(v_data->'o', '{}'::jsonb);
  if coalesce(v_opts->>'a', '1') = '0' then raise exception 'STORE_CLOSED'; end if;

  p_name := left(trim(coalesce(p_name, '')), 80);  p_phone := left(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), 20);
  p_address := left(trim(coalesce(p_address, '')), 240); p_note := left(trim(coalesce(p_note, '')), 240);
  if length(p_name) < 2 then raise exception 'NAME_REQUIRED'; end if;
  if length(p_phone) < 7 then raise exception 'PHONE_REQUIRED'; end if;
  if p_mode not in ('delivery', 'pickup') then p_mode := 'delivery'; end if;
  if p_mode = 'delivery' and coalesce(v_opts->>'d', '1') = '0' then raise exception 'DELIVERY_OFF'; end if;
  if p_mode = 'pickup'   and coalesce(v_opts->>'k', '1') = '0' then raise exception 'PICKUP_OFF'; end if;
  if p_mode = 'delivery' and length(p_address) < 5 then raise exception 'ADDRESS_REQUIRED'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60 then raise exception 'NO_ITEMS'; end if;
  if (select count(*) from public.store_orders where shop_id = v_shop and phone = p_phone and created_at > now() - interval '1 hour') >= 5 then raise exception 'TOO_MANY'; end if;

  for v_it in select * from jsonb_array_elements(p_items) loop
    v_q := least(greatest(coalesce((v_it->>'q')::numeric, 0), 0), 999);
    if v_q <= 0 then continue; end if;
    v_el := null;
    select e into v_el from jsonb_array_elements(v_data->'i') e where e->>6 = (v_it->>'id') limit 1;
    if v_el is null then raise exception 'ITEM_CHANGED'; end if;
    v_stock := nullif(v_el->>4, '')::numeric;
    if v_stock is not null and v_q > v_stock then raise exception 'OUT_OF_STOCK:%', (v_el->>0); end if;
    v_sub := v_sub + v_q * (v_el->>1)::numeric;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('id', v_el->>6, 'name', v_el->>0, 'price', (v_el->>1)::numeric, 'unit', coalesce(v_el->>2, ''), 'qty', v_q));
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception 'NO_ITEMS'; end if;
  v_min := coalesce(nullif(v_opts->>'m', '')::numeric, 0);
  if v_sub < v_min then raise exception 'MIN_ORDER:%', v_min; end if;
  if p_mode = 'delivery' then v_fee := coalesce(nullif(v_opts->>'f', '')::numeric, 0); end if;

  perform pg_advisory_xact_lock(hashtext(v_shop::text));
  select coalesce(max(no), 0) + 1 into v_no from public.store_orders where shop_id = v_shop;
  insert into public.store_orders (shop_id, no, slug, customer_name, phone, address, mode, note, items, subtotal, delivery_fee, total)
  values (v_shop, v_no, p_slug, p_name, p_phone, p_address, p_mode, p_note, v_lines, v_sub, v_fee, v_sub + v_fee);
  return v_no;
end $$;

grant execute on function public.store_hit(text) to anon, authenticated;
grant execute on function public.place_store_order(text, text, text, text, text, text, jsonb) to anon, authenticated;
