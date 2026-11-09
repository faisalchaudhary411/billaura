/**
 * Billaura licence client.
 * The server signs {plan, dates, device} with a private key; the app only has the public key, so a plan
 * edited into local storage is rejected. Tokens last a few days offline, then the app falls back to Free
 * until it can talk to the server again. Inactive (plain Free/legacy behaviour) when no public key is set.
 */
(function () {
  'use strict';
  const TOKEN_KEY = 'billaura_license_v1';
  const DEV_KEY = 'billaura_device_v1';
  const SEEN_KEY = 'billaura_lastseen_v1';
  const PUB = window.BILLAURA_LICENSE_PUBKEY || null;
  let current = null;       // verified payload (memory only)
  let loaded = false;
  let lastErr = null;       // {code, message} from the last refresh
  let lastSeen = 0;
  let lastWrite = 0;

  const enabled = () => !!PUB;
  const b64uToBytes = s => {
    s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    const bin = atob(s); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  };
  function rnd(n) {
    const a = new Uint8Array(n); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); });
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  }
  function deviceId() {
    try { let d = localStorage.getItem(DEV_KEY); if (!d || d.length < 16) { d = rnd(16); localStorage.setItem(DEV_KEY, d); } return d; } catch (e) { return 'volatile-' + rnd(8); }
  }
  function deviceLabel() {
    const ua = navigator.userAgent || '';
    const kind = window.Capacitor ? 'Android app' : (/Electron/i.test(ua) ? 'Windows app' : (/Android/i.test(ua) ? 'Android browser' : (/iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : 'Browser')));
    return kind + ' · ' + (/Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : /Android/i.test(ua) ? 'Android' : /Linux/i.test(ua) ? 'Linux' : '');
  }
  async function verify(token) {
    try {
      const parts = String(token || '').split('.');
      if (parts.length !== 3 || parts[0] !== 'v1') return null;
      const key = await crypto.subtle.importKey('jwk', PUB, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64uToBytes(parts[2]), new TextEncoder().encode(parts[1]));
      if (!ok) return null;
      const p = JSON.parse(new TextDecoder().decode(b64uToBytes(parts[1])));
      return p && p.v === 1 ? p : null;
    } catch (e) { return null; }
  }
  async function init() {
    if (!enabled() || loaded) { loaded = true; return current; }
    try { lastSeen = Number(localStorage.getItem(SEEN_KEY)) || 0; } catch (e) {}
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      if (t) { const p = await verify(t); if (p && p.dev === deviceId()) current = p; else localStorage.removeItem(TOKEN_KEY); }
    } catch (e) {}
    loaded = true;
    return current;
  }
  // Clock the licence trusts: never behind the last time we saw, nor behind the server stamp on the token
  function now() {
    const t = Math.max(Date.now(), lastSeen, current ? current.iat * 1000 : 0);
    if (t > lastSeen) {
      lastSeen = t;
      if (t - lastWrite > 60000) { lastWrite = t; try { localStorage.setItem(SEEN_KEY, String(t)); } catch (e) {} }
    }
    return t;
  }
  function entitlement() {
    const free = { planId: 'free', freemiumEnabled: true, trialEndsAt: null, paidUntil: null };
    if (!current) return Object.assign(free, { status: lastErr && /device/.test(lastErr.code || '') ? 'paused' : 'unverified' });
    if (now() / 1000 > current.exp) return Object.assign(free, { status: 'license_expired' });
    return { planId: current.planId, status: current.status, trialEndsAt: current.trialEndsAt, paidUntil: current.paidUntil, freemiumEnabled: current.freemiumEnabled !== false };
  }
  async function refresh() {
    if (!enabled()) return { ok: true, skipped: true };
    try {
      const sb = window.HisablyCloud && HisablyCloud.client && HisablyCloud.client();
      const sess = window.HisablyCloud && HisablyCloud.getSession && HisablyCloud.getSession();
      if (!sb || !sess) return { ok: false, code: 'no_session' };
      const res = await sb.functions.invoke('license', { body: { device_id: deviceId(), label: deviceLabel() } });
      if (res.error) {
        let info = {};
        try { info = await res.error.context.json(); } catch (e) {}
        lastErr = { code: info.error || 'network', message: info.message || '' };
        if (info.error === 'device_limit' || info.error === 'device_revoked') { current = null; try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} }
        return { ok: false, code: lastErr.code, message: lastErr.message };
      }
      const token = res.data && res.data.token;
      const p = await verify(token);
      if (!p || p.dev !== deviceId() || p.sub !== sess.user.id) { lastErr = { code: 'bad_token', message: 'Licence could not be verified.' }; return { ok: false, code: 'bad_token' }; }
      current = p; lastErr = null; lastSeen = Math.max(lastSeen, p.iat * 1000);
      try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
      return { ok: true };
    } catch (e) { lastErr = { code: 'network', message: '' }; return { ok: false, code: 'network' }; }
  }
  function clear() { current = null; lastErr = null; try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} }
  function state() {
    if (!enabled()) return { enabled: false, ok: true };
    if (current && now() / 1000 <= current.exp) return { enabled: true, ok: true, daysLeft: Math.max(0, Math.ceil((current.exp - now() / 1000) / 86400)) };
    return { enabled: true, ok: false, reason: current ? 'expired' : (lastErr ? lastErr.code : 'unverified'), message: lastErr ? lastErr.message : '' };
  }
  window.BillauraLicense = { enabled, init, refresh, clear, entitlement, now, state, deviceId };
})();
