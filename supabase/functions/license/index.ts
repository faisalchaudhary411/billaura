// Billaura licence server  (Supabase Edge Function "license")
// Signs a short-lived licence token {plan, dates, device} with a PRIVATE key that never leaves the server.
// The app only holds the matching PUBLIC key, so editing local storage cannot fake a plan.
//
// Secrets to set (Edge Functions -> license -> Secrets):  LICENSE_PRIVATE_JWK  = the private key from Admin -> Settings -> Licence keys
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const b64u = (buf: ArrayBuffer | Uint8Array) => {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; for (const c of u) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

let keyPromise: Promise<CryptoKey> | null = null;
function signingKey() {
  if (!keyPromise) {
    const jwk = JSON.parse(Deno.env.get("LICENSE_PRIVATE_JWK") || "{}");
    keyPromise = crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  }
  return keyPromise;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u, error: ue } = await admin.auth.getUser(jwt);
    if (ue || !u?.user) return json({ error: "auth" }, 401);

    const body = await req.json().catch(() => ({}));
    const device = String(body.device_id || "").slice(0, 80);
    const label = String(body.label || "").slice(0, 80);
    if (device.length < 16) return json({ error: "device" }, 400);

    const { data: prof } = await admin.from("profiles").select("shop_id").eq("id", u.user.id).maybeSingle();
    if (!prof?.shop_id) return json({ error: "no_shop" }, 404);
    const { data: shop } = await admin.from("shops")
      .select("id,plan_id,status,trial_ends_at,paid_until").eq("id", prof.shop_id).single();
    const { data: plat } = await admin.from("platform_settings")
      .select("freemium_enabled,max_devices,license_grace_days").eq("id", 1).maybeSingle();
    const maxDevices = Number(plat?.max_devices ?? 3);
    const graceDays = Math.min(Math.max(Number(plat?.license_grace_days ?? 10), 1), 60);

    // device registry
    const { data: devs } = await admin.from("license_devices").select("device_id,revoked").eq("shop_id", shop.id);
    const known = (devs || []).find((d: any) => d.device_id === device);
    if (known?.revoked) {
      await admin.from("license_events").insert({ shop_id: shop.id, device_id: device, kind: "revoked_device" });
      return json({ error: "device_revoked", message: "This device was removed from your licence. Contact support." }, 403);
    }
    if (!known) {
      const active = (devs || []).filter((d: any) => !d.revoked).length;
      if (active >= maxDevices) {
        await admin.from("license_events").insert({ shop_id: shop.id, device_id: device, kind: "device_limit", detail: `limit ${maxDevices}` });
        return json({ error: "device_limit", max: maxDevices,
          message: `This licence is already used on ${maxDevices} devices. Ask support to free a slot.` }, 403);
      }
      await admin.from("license_devices").insert({ shop_id: shop.id, device_id: device, label });
    } else {
      await admin.from("license_devices").update({ last_seen: new Date().toISOString(), label }).eq("shop_id", shop.id).eq("device_id", device);
    }

    const iat = Math.floor(Date.now() / 1000);
    const payload = {
      v: 1, sub: u.user.id, shop: shop.id, dev: device, iat, exp: iat + graceDays * 86400,
      planId: shop.plan_id || "free", status: shop.status || "trial",
      trialEndsAt: shop.trial_ends_at || null, paidUntil: shop.paid_until || null,
      freemiumEnabled: plat?.freemium_enabled !== false,
    };
    const head = b64u(new TextEncoder().encode(JSON.stringify(payload)));
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signingKey(), new TextEncoder().encode(head));
    return json({ token: `v1.${head}.${b64u(sig)}`, now: Date.now() });
  } catch (e) {
    return json({ error: "server", message: String((e as Error)?.message || e) }, 500);
  }
});
