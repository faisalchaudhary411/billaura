-- ============================================================
-- Billaura: real promo codes + phone alerts for payment requests
-- Run once in Supabase -> SQL Editor (safe to run again).
-- ============================================================
alter table public.platform_settings add column if not exists lifetime_price numeric default 14999;
alter table public.platform_settings add column if not exists ntfy_topic text;       -- phone alerts (ntfy.sh topic)

-- ---------- Promo codes ----------
create table if not exists public.promo_codes (
  code        text primary key,                              -- always stored UPPER-CASE
  kind        text not null check (kind in ('percent','fixed')),
  value       numeric not null check (value > 0),
  plan_ids    text[],                                        -- null = every paid plan
  max_uses    int,                                           -- null = unlimited (counts pending + approved requests)
  starts_at   timestamptz not null default now(),
  expires_at  timestamptz,
  active      boolean not null default true,
  note        text,
  created_at  timestamptz not null default now()
);
alter table public.promo_codes enable row level security;
drop policy if exists "promo_admin" on public.promo_codes;
create policy "promo_admin" on public.promo_codes for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

alter table public.payment_requests add column if not exists promo_code text;
alter table public.payment_requests add column if not exists list_price numeric;
alter table public.payment_requests add column if not exists amount_due numeric;

-- Plan prices come from the admin's own price settings (never from the phone)
create or replace function public.plan_list_price(p text)
returns numeric language sql stable security definer set search_path = public as $$
  select case p when 'basic' then coalesce(basic_price, 499)
                when 'pro' then coalesce(pro_price, 999)
                when 'lifetime' then coalesce(lifetime_price, 14999) end
  from public.platform_settings where id = 1;
$$;

create or replace function public.promo_quote(p_code text, p_plan text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pr public.promo_codes; lp numeric; fin numeric; taken int; c text := upper(trim(coalesce(p_code, '')));
begin
  lp := public.plan_list_price(p_plan);
  if lp is null then return jsonb_build_object('ok', false, 'message', 'Pick a paid plan first'); end if;
  select * into pr from public.promo_codes where code = c;
  if not found or not pr.active then return jsonb_build_object('ok', false, 'message', 'This code is not valid'); end if;
  if pr.starts_at > now() then return jsonb_build_object('ok', false, 'message', 'This code is not active yet'); end if;
  if pr.expires_at is not null and pr.expires_at < now() then return jsonb_build_object('ok', false, 'message', 'This code has expired'); end if;
  if pr.plan_ids is not null and not (p_plan = any(pr.plan_ids)) then
    return jsonb_build_object('ok', false, 'message', 'This code does not apply to the selected plan'); end if;
  if pr.max_uses is not null then
    select count(*) into taken from public.payment_requests where promo_code = pr.code and status in ('pending', 'approved');
    if taken >= pr.max_uses then return jsonb_build_object('ok', false, 'message', 'This code has been fully used'); end if;
  end if;
  fin := case when pr.kind = 'percent' then round(lp * (1 - least(pr.value, 100) / 100)) else greatest(lp - pr.value, 0) end;
  return jsonb_build_object('ok', true, 'code', pr.code, 'list', lp, 'final', fin, 'off', lp - fin);
end $$;

-- The app calls this to show the discounted price
create or replace function public.check_promo(p_code text, p_plan text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then jsonb_build_object('ok', false, 'message', 'Sign in first')
              else public.promo_quote(p_code, p_plan) end;
$$;
revoke all on function public.promo_quote(text, text) from public, anon, authenticated;
revoke all on function public.check_promo(text, text) from public, anon;
grant execute on function public.check_promo(text, text) to authenticated;

-- Every payment request gets its price and discount decided HERE, so a phone cannot fake them
create or replace function public.payreq_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare q jsonb;
begin
  new.list_price := public.plan_list_price(new.plan_id);
  if coalesce(trim(new.promo_code), '') <> '' then
    q := public.promo_quote(new.promo_code, new.plan_id);
    if not coalesce((q ->> 'ok')::boolean, false) then raise exception '%', coalesce(q ->> 'message', 'Invalid promo code'); end if;
    new.promo_code := upper(trim(new.promo_code));
    new.amount_due := (q ->> 'final')::numeric;
  else
    new.promo_code := null;
    new.amount_due := new.list_price;
  end if;
  return new;
end $$;
drop trigger if exists trg_payreq_before_insert on public.payment_requests;
create trigger trg_payreq_before_insert before insert on public.payment_requests
  for each row execute function public.payreq_before_insert();

-- ---------- Phone alert when a seller taps "I paid" (via ntfy.sh, free) ----------
create extension if not exists pg_net with schema extensions;
create or replace function public.payreq_notify()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare t text;
begin
  select ntfy_topic into t from public.platform_settings where id = 1;
  if t is not null and length(trim(t)) > 0 then
    begin
      perform net.http_post(
        url := 'https://ntfy.sh/',
        body := jsonb_build_object(
          'topic', trim(t),
          'title', 'Billaura: payment request',
          'message', coalesce(new.shop_name, new.email, 'A shop') || ' wants ' || upper(coalesce(new.plan_id, '?'))
                     || ' - PKR ' || coalesce(new.amount_due::text, '?')
                     || coalesce(' (code ' || new.promo_code || ')', '')
                     || E'\nTxn: ' || coalesce(new.note, '-'),
          'priority', 4,
          'tags', jsonb_build_array('moneybag')
        )
      );
    exception when others then null;   -- an alert problem must never block the request itself
    end;
  end if;
  return new;
end $$;
drop trigger if exists trg_payreq_notify on public.payment_requests;
create trigger trg_payreq_notify after insert on public.payment_requests
  for each row execute function public.payreq_notify();
