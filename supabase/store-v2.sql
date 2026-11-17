-- Billaura Online Store v2 (run once in Supabase -> SQL Editor, AFTER store-orders.sql)
-- Adds: item options (size/colour...), coupons, payment method + payment screenshot, order tracking page,
--       "out for delivery" status with courier info, status timestamps.

alter table public.store_orders add column if not exists discount     numeric not null default 0;
alter table public.store_orders add column if not exists coupon       text    not null default '';
alter table public.store_orders add column if not exists pay_method   text    not null default 'cod';
alter table public.store_orders add column if not exists has_proof    boolean not null default false;
alter table public.store_orders add column if not exists proof        text;
alter table public.store_orders add column if not exists ship_info    text    not null default '';
alter table public.store_orders add column if not exists accepted_at  timestamptz;
alter table public.store_orders add column if not exists shipped_at   timestamptz;
alter table public.store_orders add column if not exists delivered_at timestamptz;

-- allow the new "shipped" status
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.store_orders'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%' loop
    execute format('alter table public.store_orders drop constraint %I', c);
  end loop;
end $$;
alter table public.store_orders add constraint store_orders_status_check check (status in ('new','accepted','shipped','delivered','cancelled'));

create or replace function public.store_orders_stamp() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'accepted'  and new.accepted_at  is null then new.accepted_at  := now(); end if;
    if new.status = 'shipped'   and new.shipped_at   is null then new.shipped_at   := now(); end if;
    if new.status = 'delivered' and new.delivered_at is null then new.delivered_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists store_orders_stamp_t on public.store_orders;
create trigger store_orders_stamp_t before update on public.store_orders for each row execute function public.store_orders_stamp();

-- ---------- coupons ----------
create table if not exists public.store_coupons (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shops(id) on delete cascade,
  code       text not null,
  kind       text not null default 'pct' check (kind in ('pct','amt')),
  value      numeric not null check (value > 0),
  min_order  numeric not null default 0,
  max_uses   integer,
  used       integer not null default 0,
  expires_at timestamptz,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (shop_id, code)
);
alter table public.store_coupons enable row level security;
drop policy if exists "coupons owner all" on public.store_coupons;
create policy "coupons owner all" on public.store_coupons for all to authenticated using (shop_id = public.my_shop_id()) with check (shop_id = public.my_shop_id());

-- returns {ok, discount, msg}. Used by the cart preview and again by place_store_order.
create or replace function public._coupon_calc(p_shop uuid, p_code text, p_sub numeric, p_lock boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.store_coupons; d numeric;
begin
  p_code := upper(trim(coalesce(p_code, '')));
  if p_code = '' then return jsonb_build_object('ok', false, 'msg', 'Enter a coupon code'); end if;
  select * into c from public.store_coupons where shop_id = p_shop and code = p_code and active;
  if not found then return jsonb_build_object('ok', false, 'msg', 'This coupon is not valid'); end if;
  if c.expires_at is not null and c.expires_at < now() then return jsonb_build_object('ok', false, 'msg', 'This coupon has expired'); end if;
  if c.max_uses is not null and c.used >= c.max_uses then return jsonb_build_object('ok', false, 'msg', 'This coupon has been fully used'); end if;
  if p_sub < c.min_order then return jsonb_build_object('ok', false, 'msg', 'Add items worth ' || c.min_order::text || ' or more to use this coupon'); end if;
  d := case when c.kind = 'pct' then round(p_sub * least(c.value, 100) / 100, 2) else least(c.value, p_sub) end;
  if p_lock then update public.store_coupons set used = used + 1 where id = c.id; end if;
  return jsonb_build_object('ok', true, 'discount', d, 'code', c.code, 'msg', 'Coupon applied');
end $$;

create or replace function public.check_store_coupon(p_slug text, p_code text, p_sub numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from public.public_stores where slug = p_slug;
  if v_shop is null then return jsonb_build_object('ok', false, 'msg', 'Store not found'); end if;
  return public._coupon_calc(v_shop, p_code, coalesce(p_sub, 0), false);
end $$;

-- ---------- place order (replaces the v1 function) ----------
drop function if exists public.place_store_order(text, text, text, text, text, text, jsonb);
create or replace function public.place_store_order(
  p_slug text, p_name text, p_phone text, p_address text, p_mode text, p_note text, p_items jsonb,
  p_coupon text default '', p_pay text default 'cod', p_proof text default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid; v_data jsonb; v_opts jsonb; v_ok boolean := true;
  v_it jsonb; v_el jsonb; v_q numeric; v_lines jsonb := '[]'::jsonb; v_opt jsonb; v_price numeric; v_label text;
  v_sub numeric := 0; v_fee numeric := 0; v_min numeric := 0; v_no integer; v_stock numeric;
  v_used jsonb := '{}'::jsonb; v_u numeric; v_disc numeric := 0; v_cp jsonb; v_code text := ''; v_pays jsonb; v_pay_ok boolean := false; y jsonb;
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

  -- payment method must be one the shop offers (cash on delivery is always allowed)
  p_pay := lower(coalesce(nullif(trim(p_pay), ''), 'cod'));
  if p_pay = 'cod' then v_pay_ok := true;
  else
    v_pays := coalesce(v_opts->'y', '[]'::jsonb);
    if jsonb_typeof(v_pays) = 'array' then
      for y in select * from jsonb_array_elements(v_pays) loop if lower(y->>0) = p_pay then v_pay_ok := true; end if; end loop;
    end if;
  end if;
  if not v_pay_ok then raise exception 'PAY_OFF'; end if;
  if p_proof is not null and (length(p_proof) > 600000 or p_proof not like 'data:image/%') then p_proof := null; end if;

  for v_it in select * from jsonb_array_elements(p_items) loop
    v_q := least(greatest(coalesce((v_it->>'q')::numeric, 0), 0), 999);
    if v_q <= 0 then continue; end if;
    v_el := null;
    select e into v_el from jsonb_array_elements(v_data->'i') e where e->>6 = (v_it->>'id') limit 1;
    if v_el is null then raise exception 'ITEM_CHANGED'; end if;
    -- stock is counted per item, across all its options
    v_u := coalesce((v_used->>(v_it->>'id'))::numeric, 0) + v_q;
    v_used := v_used || jsonb_build_object(v_it->>'id', v_u);
    v_stock := nullif(v_el->>4, '')::numeric;
    if v_stock is not null and v_u > v_stock then raise exception 'OUT_OF_STOCK:%', (v_el->>0); end if;
    v_price := (v_el->>1)::numeric; v_label := '';
    if coalesce(v_it->>'o', '') <> '' then
      v_opt := null;
      select o into v_opt from jsonb_array_elements(case when jsonb_typeof(v_el->7) = 'array' then v_el->7 else '[]'::jsonb end) o where o->>0 = (v_it->>'o') limit 1;
      if v_opt is null then raise exception 'ITEM_CHANGED'; end if;
      v_label := v_opt->>0;
      if nullif(v_opt->>1, '') is not null then v_price := (v_opt->>1)::numeric; end if;
    elsif jsonb_typeof(v_el->7) = 'array' and jsonb_array_length(v_el->7) > 0 then
      raise exception 'OPTION_REQUIRED:%', (v_el->>0);
    end if;
    v_sub := v_sub + v_q * v_price;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('id', v_el->>6, 'name', v_el->>0, 'opt', v_label, 'price', v_price, 'unit', coalesce(v_el->>2, ''), 'qty', v_q));
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception 'NO_ITEMS'; end if;
  v_min := coalesce(nullif(v_opts->>'m', '')::numeric, 0);
  if v_sub < v_min then raise exception 'MIN_ORDER:%', v_min; end if;
  if p_mode = 'delivery' then v_fee := coalesce(nullif(v_opts->>'f', '')::numeric, 0); end if;

  if coalesce(trim(p_coupon), '') <> '' then
    v_cp := public._coupon_calc(v_shop, p_coupon, v_sub, true);
    if (v_cp->>'ok')::boolean then v_disc := (v_cp->>'discount')::numeric; v_code := v_cp->>'code';
    else raise exception 'COUPON:%', (v_cp->>'msg'); end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_shop::text));
  select coalesce(max(no), 0) + 1 into v_no from public.store_orders where shop_id = v_shop;
  insert into public.store_orders (shop_id, no, slug, customer_name, phone, address, mode, note, items, subtotal, delivery_fee, total, discount, coupon, pay_method, has_proof, proof)
  values (v_shop, v_no, p_slug, p_name, p_phone, p_address, p_mode, p_note, v_lines, v_sub, v_fee, v_sub - v_disc + v_fee, v_disc, v_code, p_pay, p_proof is not null, p_proof);
  return v_no;
end $$;

-- ---------- order tracking (customer enters order number + phone) ----------
create or replace function public.track_store_order(p_slug text, p_no integer, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.store_orders; v_shop uuid; ph text; r jsonb;
begin
  select shop_id into v_shop from public.public_stores where slug = p_slug;
  if v_shop is null then return null; end if;
  ph := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if length(ph) < 7 then return null; end if;
  select * into o from public.store_orders where shop_id = v_shop and no = p_no;
  if not found then return null; end if;
  if right(regexp_replace(o.phone, '[^0-9]', '', 'g'), 7) <> right(ph, 7) then return null; end if;
  return jsonb_build_object('no', o.no, 'status', o.status, 'mode', o.mode, 'items', o.items, 'subtotal', o.subtotal, 'fee', o.delivery_fee,
    'discount', o.discount, 'total', o.total, 'pay', o.pay_method, 'proof', o.has_proof, 'ship', o.ship_info, 'reason', o.cancel_reason,
    'created', o.created_at, 'accepted', o.accepted_at, 'shipped', o.shipped_at, 'delivered', o.delivered_at, 'name', o.customer_name);
end $$;

grant execute on function public.check_store_coupon(text, text, numeric) to anon, authenticated;
grant execute on function public.track_store_order(text, integer, text) to anon, authenticated;
grant execute on function public.place_store_order(text, text, text, text, text, text, jsonb, text, text, text) to anon, authenticated;
revoke all on function public._coupon_calc(uuid, text, numeric, boolean) from public, anon, authenticated;
