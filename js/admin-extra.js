/* Billaura Admin – Announcements + Licence pages */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, c = document) => c.querySelector(s);
  const db = () => (window.HisablyAdminCloud && HisablyAdminCloud.client && HisablyAdminCloud.client()) || null;
  const S = { ann: [], devices: [], events: [], settings: {}, editing: null, loaded: {}, msg: '', keys: null };
  const toast = m => { const t = $('#toast'); if (!t) return alert(m); t.textContent = m; t.hidden = false; requestAnimationFrame(() => t.classList.add('show')); setTimeout(() => { t.classList.remove('show'); setTimeout(() => (t.hidden = true), 200); }, 2400); };
  const localDT = v => { if (!v) return ''; const d = new Date(v); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
  const noCloud = '<div class="card"><p>This page needs the cloud connection (Supabase) and a platform-admin login.</p></div>';

  async function loadAnn() {
    const c = db(); if (!c) return;
    const { data, error } = await c.from('announcements').select('*').order('created_at', { ascending: false });
    if (error) { S.msg = 'Could not load: ' + error.message + ' (did you run announcements.sql?)'; } else { S.ann = data || []; S.msg = ''; }
    S.loaded.ann = true;
  }
  async function loadLic() {
    const c = db(); if (!c) return;
    const [d, e, s] = await Promise.all([
      c.from('license_devices').select('*, shops(name)').order('last_seen', { ascending: false }).limit(200),
      c.from('license_events').select('*, shops(name)').order('created_at', { ascending: false }).limit(100),
      c.from('platform_settings').select('*').eq('id', 1).maybeSingle()
    ]);
    S.msg = (d.error || e.error) ? 'Could not load: ' + (d.error || e.error).message + ' (did you run license.sql?)' : '';
    S.devices = d.data || []; S.events = e.data || []; S.settings = (s.data) || {}; S.loaded.lic = true;
  }

  function annForm() {
    const a = S.editing || {};
    const opt = (v, cur, l) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l || v}</option>`;
    return `<div class="card"><h3 class="card-title" style="margin-bottom:12px">${a.id ? 'Edit' : 'New'} announcement</h3>
    <form id="annForm">
      <div class="form-group"><label>Title</label><input class="input" name="title" required maxlength="80" value="${esc(a.title)}"></div>
      <div class="form-group"><label>Message</label><textarea class="textarea" name="body" maxlength="600">${esc(a.body)}</textarea></div>
      <div class="form-row">
        <div class="form-group"><label>Type</label><select class="select" name="kind">${opt('info', a.kind)}${opt('update', a.kind, 'update (new version)')}${opt('offer', a.kind, 'offer / discount')}${opt('warning', a.kind)}</select></div>
        <div class="form-group"><label>Who sees it</label><select class="select" name="audience">${opt('all', a.audience, 'Everyone')}${opt('free', a.audience, 'Free plan')}${opt('trial', a.audience, 'Trial')}${opt('basic', a.audience, 'Basic')}${opt('pro', a.audience, 'Pro')}${opt('paid', a.audience, 'Any paid plan')}</select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Button text (optional)</label><input class="input" name="cta_label" value="${esc(a.cta_label)}" placeholder="Get offer"></div>
        <div class="form-group"><label>Button opens (link)</label><input class="input" name="cta_url" value="${esc(a.cta_url)}" placeholder="https://…"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>…or in-app action</label><select class="select" name="cta_action">${opt('', a.cta_action || '', 'None')}${opt('open-plans', a.cta_action, 'Open Plans page')}</select></div>
        <div class="form-group"><label>Coupon code (optional)</label><input class="input" name="coupon" value="${esc(a.coupon)}" placeholder="EID20"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Show from</label><input class="input" type="datetime-local" name="starts_at" value="${localDT(a.starts_at || new Date())}"></div>
        <div class="form-group"><label>Hide after (optional)</label><input class="input" type="datetime-local" name="ends_at" value="${localDT(a.ends_at)}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Pop up when app opens?</label><select class="select" name="priority">${opt('0', String(a.priority || 0), 'No – bell only')}${opt('1', String(a.priority || 0), 'Yes – show once')}</select></div>
        <div class="form-group"><label>Status</label><select class="select" name="active">${opt('1', a.active === false ? '0' : '1', 'Active')}${opt('0', a.active === false ? '0' : '1', 'Paused')}</select></div>
      </div>
      <button class="btn btn-primary" type="submit">${a.id ? 'Save changes' : 'Publish'}</button>
      ${S.editing ? '<button class="btn btn-secondary" type="button" data-x="cancel">Cancel</button>' : ''}
    </form></div>`;
  }
  function viewAnn() {
    if (!db()) return noCloud;
    const now = Date.now();
    const st = a => !a.active ? ['Paused', 'badge-expired'] : (a.ends_at && new Date(a.ends_at) < now) ? ['Ended', 'badge-expired'] : (new Date(a.starts_at) > now) ? ['Scheduled', 'badge-trial'] : ['Live', 'badge-active'];
    return `${S.msg ? `<div class="card" style="color:#c0262d">${esc(S.msg)}</div>` : ''}${annForm()}
    <div class="card"><h3 class="card-title" style="margin-bottom:12px">All announcements</h3>
    ${S.ann.length ? `<div class="table-wrap"><table><thead><tr><th>Title</th><th>Type</th><th>Audience</th><th>Status</th><th></th></tr></thead><tbody>${S.ann.map(a => { const s = st(a); return `<tr><td><strong>${esc(a.title)}</strong><br><small>${esc((a.body || '').slice(0, 70))}</small></td><td>${esc(a.kind)}</td><td>${esc(a.audience)}</td><td><span class="badge ${s[1]}">${s[0]}</span></td><td style="white-space:nowrap"><button class="btn btn-secondary btn-sm" data-x="edit" data-id="${a.id}">Edit</button> <button class="btn btn-secondary btn-sm" data-x="toggle" data-id="${a.id}">${a.active ? 'Pause' : 'Resume'}</button> <button class="btn btn-secondary btn-sm" data-x="del" data-id="${a.id}">Delete</button></td></tr>`; }).join('')}</tbody></table></div>` : '<p>Nothing yet. Publish your first message above.</p>'}
    <p class="small" style="margin-top:10px">Tip: for a new app version use type “update”. Sellers see it under the bell icon, newest first.</p></div>`;
  }
  async function bindAnn() {
    const c = db(); if (!c) return;
    const f = $('#annForm');
    if (f) f.onsubmit = async e => {
      e.preventDefault(); const fd = new FormData(f);
      const row = { title: fd.get('title').trim(), body: (fd.get('body') || '').trim(), kind: fd.get('kind'), audience: fd.get('audience'),
        cta_label: (fd.get('cta_label') || '').trim() || null, cta_url: (fd.get('cta_url') || '').trim() || null, cta_action: fd.get('cta_action') || null,
        coupon: (fd.get('coupon') || '').trim() || null, priority: +fd.get('priority'), active: fd.get('active') === '1',
        starts_at: fd.get('starts_at') ? new Date(fd.get('starts_at')).toISOString() : new Date().toISOString(),
        ends_at: fd.get('ends_at') ? new Date(fd.get('ends_at')).toISOString() : null };
      if (row.cta_url && !/^https?:\/\//i.test(row.cta_url)) return toast('Link must start with https://');
      const q = S.editing && S.editing.id ? c.from('announcements').update(row).eq('id', S.editing.id) : c.from('announcements').insert(row);
      const { error } = await q; if (error) return toast('Failed: ' + error.message);
      S.editing = null; toast('Saved'); await loadAnn(); paint();
    };
    $('#content').onclick = async e => {
      const b = e.target.closest('[data-x]'); if (!b) return; const id = b.dataset.id, a = S.ann.find(x => x.id === id);
      if (b.dataset.x === 'cancel') { S.editing = null; paint(); }
      else if (b.dataset.x === 'edit') { S.editing = a; paint(); window.scrollTo(0, 0); }
      else if (b.dataset.x === 'toggle') { await c.from('announcements').update({ active: !a.active }).eq('id', id); await loadAnn(); paint(); }
      else if (b.dataset.x === 'del') { if (!confirm('Delete this announcement?')) return; await c.from('announcements').delete().eq('id', id); await loadAnn(); paint(); }
    };
  }

  // ---------- Licence ----------
  const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  async function genKeys() {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pub = await crypto.subtle.exportKey('jwk', kp.publicKey), prv = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const clean = j => JSON.stringify({ kty: j.kty, crv: j.crv, x: j.x, y: j.y, ...(j.d ? { d: j.d } : {}) });
    return { pub: clean(pub), prv: clean(prv) };
  }
  function viewLic() {
    if (!db()) return noCloud;
    const s = S.settings || {};
    const ago = t => { const m = Math.round((Date.now() - new Date(t)) / 6e4); return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
    return `${S.msg ? `<div class="card" style="color:#c0262d">${esc(S.msg)}</div>` : ''}
    <div class="card"><h3 class="card-title" style="margin-bottom:8px">Licence limits</h3>
      <form id="licForm"><div class="form-row">
        <div class="form-group"><label>Devices per shop</label><input class="input" type="number" min="1" max="20" name="max_devices" value="${s.max_devices || 3}"></div>
        <div class="form-group"><label>Offline grace (days)</label><input class="input" type="number" min="1" max="60" name="license_grace_days" value="${s.license_grace_days || 10}"></div></div>
      <button class="btn btn-primary" type="submit">Save</button></form></div>
    <div class="card"><h3 class="card-title" style="margin-bottom:8px">Signing keys</h3>
      <p class="small">Creates a new key pair in this browser. Nothing is sent anywhere. Follow <b>LICENSE-SETUP.md</b>: first put the PRIVATE key in Supabase (secret <code>LICENSE_PRIVATE_JWK</code>), then paste the PUBLIC key into <code>js/license-config.js</code>. Generating again invalidates old tokens, so do it once and keep the private key safe.</p>
      <button class="btn btn-secondary" data-x="gen">Generate key pair</button>
      ${S.keys ? `<div class="form-group" style="margin-top:12px"><label>PUBLIC key (goes in the app)</label><textarea class="textarea" readonly rows="3" onclick="this.select()">${esc(S.keys.pub)}</textarea><button class="btn btn-secondary btn-sm" data-x="cp" data-v="pub">Copy</button></div>
      <div class="form-group"><label>PRIVATE key (secret, Supabase only, never share)</label><textarea class="textarea" readonly rows="4" onclick="this.select()">${esc(S.keys.prv)}</textarea><button class="btn btn-secondary btn-sm" data-x="cp" data-v="prv">Copy</button></div>` : ''}</div>
    <div class="card"><h3 class="card-title" style="margin-bottom:8px">Devices (${S.devices.length})</h3>
      ${S.devices.length ? `<div class="table-wrap"><table><thead><tr><th>Shop</th><th>Device</th><th>Last seen</th><th>Status</th><th></th></tr></thead><tbody>${S.devices.map(d => `<tr><td>${esc(d.shops && d.shops.name || d.shop_id.slice(0, 8))}</td><td>${esc(d.label || d.device_id.slice(0, 10))}</td><td>${ago(d.last_seen)}</td><td><span class="badge ${d.revoked ? 'badge-expired' : 'badge-active'}">${d.revoked ? 'Revoked' : 'OK'}</span></td><td style="white-space:nowrap"><button class="btn btn-secondary btn-sm" data-x="rev" data-id="${d.id}">${d.revoked ? 'Restore' : 'Revoke'}</button> <button class="btn btn-secondary btn-sm" data-x="rm" data-id="${d.id}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<p>No devices yet. They appear once licence checking is switched on.</p>'}
      <p class="small">Remove = frees a slot (the device registers again next time it checks in). Revoke = blocks that device.</p></div>
    <div class="card"><h3 class="card-title" style="margin-bottom:8px">Suspicious activity</h3>
      ${S.events.length ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Shop</th><th>Event</th><th>Detail</th></tr></thead><tbody>${S.events.map(v => `<tr><td>${ago(v.created_at)}</td><td>${esc(v.shops && v.shops.name || '')}</td><td>${esc(v.kind)}</td><td>${esc(v.detail || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p>Nothing suspicious logged.</p>'}</div>`;
  }
  function bindLic() {
    const c = db(); if (!c) return;
    const f = $('#licForm');
    if (f) f.onsubmit = async e => { e.preventDefault(); const fd = new FormData(f);
      const { error } = await c.from('platform_settings').update({ max_devices: +fd.get('max_devices'), license_grace_days: +fd.get('license_grace_days') }).eq('id', 1);
      toast(error ? 'Failed: ' + error.message : 'Saved'); };
    $('#content').onclick = async e => {
      const b = e.target.closest('[data-x]'); if (!b) return;
      if (b.dataset.x === 'gen') { if (S.keys || !confirm('Create a new key pair? Only do this once.')) return; S.keys = await genKeys(); paint(); }
      else if (b.dataset.x === 'cp') { try { await navigator.clipboard.writeText(S.keys[b.dataset.v]); toast('Copied'); } catch (_) { toast('Select the text and copy'); } }
      else if (b.dataset.x === 'rev') { const d = S.devices.find(x => x.id === b.dataset.id); await c.from('license_devices').update({ revoked: !d.revoked }).eq('id', d.id); await loadLic(); paint(); }
      else if (b.dataset.x === 'rm') { if (!confirm('Remove this device?')) return; await c.from('license_devices').delete().eq('id', b.dataset.id); await loadLic(); paint(); }
    };
  }

  let page = null;
  function paint() { const el = $('#content'); if (!el || !page) return; el.innerHTML = page === 'announcements' ? viewAnn() : viewLic(); (page === 'announcements' ? bindAnn : bindLic)(); }
  window.AdminExtra = {
    pages: ['announcements', 'licence'],
    titles: { announcements: 'Announcements', licence: 'Licence & devices' },
    async open(p) { page = p; $('#content').innerHTML = '<div class="card"><p>Loading…</p></div>'; if (p === 'announcements') await loadAnn(); else await loadLic(); if (page === p) paint(); },
    leave() { page = null; }
  };
})();
