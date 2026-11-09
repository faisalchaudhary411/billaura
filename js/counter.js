/* Billaura Counter Pack: POS v2, shifts, approvals, returns/exchange, buy-today, purchase orders,
   stock count, expiry/batches, auto backups, daily report. Plugs into app.js through window.BillauraCore. */
(function () {
  'use strict';
  const C = () => window.BillauraCore;
  const E = window.BillauraExt = { views: {}, actions: {}, perms: {}, inputs: {} };
  const h = s => C().escapeHtml(s);
  const m = n => C().money(n);
  const r2 = n => C().round2(n);
  const cur = () => C().settings.currency || 'Rs';
  const S = () => C().settings;
  const arr = k => (S()[k] = Array.isArray(S()[k]) ? S()[k] : []);
  const $ = s => document.querySelector(s);
  const val = id => { const e = document.getElementById(id); return e ? e.value : ''; };
  const num = id => { const v = parseFloat(val(id)); return isFinite(v) ? v : 0; };
  const toast = (t, ms) => C().toast(t, ms);
  const today = () => new Date().toISOString().slice(0, 10);
  const dt = iso => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  function modal(title, inner) { const r = document.getElementById('modalRoot'); if (r) r.innerHTML = C().modalShell(title, inner); }
  const close = () => C().closeModal();
  const redraw = () => C().render();
  const go = (v) => C().setView(v);
  const row = (icon, label, attr) => `<div class="list-row" ${attr}><div class="list-row-left"><div class="list-row-icon">${C().ico(icon)}</div><div><div class="list-row-label">${label}</div></div></div><span class="chev">›</span></div>`;
  const empty = t => `<div class="doc-empty" style="padding:24px">${t}</div>`;
  const sumBy = (l, f) => r2(l.reduce((a, x) => a + (Number(f(x)) || 0), 0));
  const saleDocs = () => C().invoices.filter(i => i.docType !== 'estimate' && i.docType !== 'return');
  function shareText(text) { const num = S().ownerWhatsapp || S().storeWhatsapp || S().phone || ''; if (num) C().sendWhatsApp(num, text); else window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank'); }
  function shareAny(text) { if (navigator.share) navigator.share({ text }).catch(() => {}); else shareText(text); }

  E.audit = function (type, detail) { try { const c = C(); if (!c) return; const l = arr('audit'); l.unshift({ t: new Date().toISOString(), by: c.isStaff() ? c.staffName() : 'Owner', type, detail: String(detail || '').slice(0, 160), br: E.brId() }); if (l.length > 300) l.length = 300; } catch (e) {} };
  // ---------------- Manager approval ----------------
  let apRes = null, apFails = 0, apLock = 0, apNeed = '', apAct = '';
  const NOAPPROVE = ['owner', 'settings', 'export'];
  E.approve = function (perm, action) {
    if (!perm || NOAPPROVE.includes(perm)) return Promise.resolve(false);
    if (!C().settings.pinHash) return Promise.resolve(false);
    if (apRes) apRes(false);
    apNeed = perm; apAct = action || '';
    const names = { delete: 'delete', returns: 'process a return', discount: 'change price or discount', receive_payment: 'receive a payment', items_edit: 'edit items or stock', purchases: 'handle purchases', expenses: 'add expenses', banks: 'handle bank entries', reports: 'view reports', sales: 'sell', parties: 'edit parties' };
    modal('Manager approval', `<div class="modal-body"><p class="text-sm text-secondary">Your role can't ${names[perm] || 'do this'}. Ask a manager or the owner to enter their PIN.</p>
      <input id="apPin" class="form-input" type="password" inputmode="numeric" autocomplete="off" placeholder="Manager / owner PIN" style="text-align:center;letter-spacing:6px;font-size:1.25rem" />
      <div id="apErr" class="text-sm" style="color:var(--danger);min-height:20px;margin-top:6px"></div>
      <div class="form-row" style="margin-top:8px"><button class="btn btn-secondary" data-action="ap-cancel">Cancel</button><button class="btn btn-primary" data-action="ap-ok">Approve</button></div></div>`);
    setTimeout(() => { const i = document.getElementById('apPin'); i && i.focus(); }, 80);
    return new Promise(res => { apRes = res; });
  };
  E.actions['ap-cancel'] = () => { close(); if (apRes) { apRes(false); apRes = null; } };
  E.actions['ap-ok'] = async () => {
    const err = document.getElementById('apErr'); const pin = val('apPin');
    if (Date.now() < apLock) { err.textContent = 'Too many tries. Wait a moment.'; return; }
    if (!pin) return;
    const c = C(), hsh = await c.pinHash(pin); let by = '';
    if (hsh === c.settings.pinHash) by = 'Owner';
    else { const sf = c.staffList().find(x => x.hash === hsh); if (sf) { const perms = Array.isArray(sf.perms) ? sf.perms : ((c.ROLES[sf.role] || {}).perms || []); if (perms.includes(apNeed)) by = sf.name || 'Manager'; } }
    if (!by) { if (++apFails >= 5) { apFails = 0; apLock = Date.now() + 30000; } err.textContent = 'That PIN cannot approve this.'; return; }
    apFails = 0; arr('approvals').unshift({ t: new Date().toISOString(), by, perm: apNeed, action: apAct, for: c.staffName() }); S().approvals = S().approvals.slice(0, 200); c.persist();
    close(); if (apRes) { apRes(true); apRes = null; }
  };
  E.perms['ap-cancel'] = null; E.perms['ap-ok'] = null;

  // ---------------- Batches / expiry (FEFO) ----------------
  const bat = pid => { const o = (S().batches = S().batches || {}); return (o[pid] = Array.isArray(o[pid]) ? o[pid] : []); };
  E.onStock = function (p, delta) {
    if (!p || !(delta < 0)) return;
    const l = (S().batches || {})[p.id]; if (!Array.isArray(l) || !l.length) return;
    let left = -delta;
    l.sort((a, b) => (a.exp || '9999') < (b.exp || '9999') ? -1 : 1);
    l.forEach(b => { if (left <= 0) return; const t = Math.min(Number(b.qty) || 0, left); b.qty = r2((Number(b.qty) || 0) - t); left = r2(left - t); });
    S().batches[p.id] = l.filter(b => (Number(b.qty) || 0) > 0.0001);
  };
  function expiryList() {
    const out = [], now = new Date(today() + 'T00:00:00').getTime(), B = S().batches || {};
    C().products.forEach(p => (B[p.id] || []).forEach((b, i) => { if (!b.exp) return; const d = Math.round((new Date(b.exp + 'T00:00:00').getTime() - now) / 864e5); out.push({ p, b, i, d }); }));
    return out.sort((a, b) => a.d - b.d);
  }
  const expDays = () => S().expiryDays || 30;

  // ---------------- Menu / alerts / init ----------------
  E.menuCard = function () {
    const items = [['sale', 'Quick Sale (POS)', 'data-view="pos"'], ['cash', 'Shift & Cash Drawer', 'data-view="shift"'], ['return', 'Return / Exchange', 'data-view="returns"'], ['report', 'Daily Closing Report', 'data-view="daily-report"'], ['cart', 'Buy Today List', 'data-view="buy-today"'], ['cart', 'Purchase Orders & GRN', 'data-view="po-list"'], ['box', 'Stock Count', 'data-view="stock-count"'], ['box', 'Expiry & Batches', 'data-view="expiry"'], ['sync', 'Backup & Restore', 'data-view="backup"'], ['store', 'Branches & Head Office', 'data-view="branches"'], ['box', 'Stock Transfers', 'data-view="transfers"'], ['report', 'Audit Log', 'data-view="audit"']];
    return `<div class="menu-card"><div class="menu-h">Counter Pack</div>${items.map(i => row(i[0], i[1], i[2])).join('')}</div>`;
  };
  E.staffRows = function () {
    const r = [], c = C();
    if (c.can('sales')) { r.push(['Quick Sale (POS)', 'data-view="pos"']); r.push(['Shift & cash drawer', 'data-view="shift"']); }
    if (c.can('returns')) r.push(['Return / Exchange', 'data-view="returns"']);
    if (c.can('reports')) r.push(['Daily closing report', 'data-view="daily-report"']);
    if (c.can('purchases')) { r.push(['Buy today list', 'data-view="buy-today"']); r.push(['Purchase orders', 'data-view="po-list"']); }
    if (c.can('items_edit')) { r.push(['Stock transfers', 'data-view="transfers"']); r.push(['Stock count', 'data-view="stock-count"']); r.push(['Expiry & batches', 'data-view="expiry"']); }
    return r;
  };
  E.homeAlerts = function () {
    let h2 = '';
    if (!C().isStaff()) {
      const ex = expiryList().filter(x => x.d <= expDays());
      if (ex.length) { const gone = ex.filter(x => x.d < 0).length; h2 += `<div class="home-alert warn"><div class="ha-t"><b>${gone ? gone + ' expired, ' : ''}${ex.length - gone} expiring soon</b><span>${h(ex.slice(0, 2).map(x => x.p.name).join(', '))}</span></div><button data-view="expiry">View</button></div>`; }
      const lf = S().lastFileBackup, age = lf ? (Date.now() - new Date(lf)) / 864e5 : (C().invoices.length > 3 ? 99 : 0);
      if (age > 14 && S().backupNagOff !== today()) h2 += `<div class="home-alert info"><div class="ha-t"><b>Save a backup file</b><span>${lf ? 'Last saved ' + Math.floor(age) + ' days ago' : 'You have not saved one yet'}</span></div><button data-view="backup">Backup</button><button class="x" data-action="bk-nag-off" aria-label="Dismiss">✕</button></div>`;
    }
    const sh = S().shiftOpen;
    if (sh && Date.now() - new Date(sh.openedAt) > 20 * 36e5) h2 += `<div class="home-alert warn"><div class="ha-t"><b>Shift still open</b><span>Opened ${dt(sh.openedAt)}. Close it to count the drawer.</span></div><button data-view="shift">Close</button></div>`;
    return h2;
  };
  E.actions['bk-nag-off'] = () => { S().backupNagOff = today(); C().persist(); redraw(); };
  E.init = function () {
    setTimeout(() => { try { autoBackup(); } catch (e) {} }, 6000);
    document.addEventListener('input', ev => { const n = ev.target && ev.target.dataset && ev.target.dataset.in; if (n && E.inputs[n]) E.inputs[n](ev.target, ev); });
    document.addEventListener('change', ev => { const n = ev.target && ev.target.dataset && ev.target.dataset.ch; if (n && E.inputs[n]) E.inputs[n](ev.target, ev); });
  };

  // ---------------- Share a report screen / aging ----------------
  const SHARE_VIEWS = ['profit-loss', 'daybook-detail', 'cash-in-hand', 'sale-report', 'stock-summary', 'low-stock', 'trial-balance', 'balance-sheet', 'item-pl', 'party-pl', 'bill-pnl'];
  E.afterRender = function (view, el) {
    if (SHARE_VIEWS.includes(view)) {
      const b = document.createElement('button'); b.className = 'icon-btn'; b.dataset.action = 'share-screen'; b.setAttribute('aria-label', 'Share'); b.innerHTML = C().ico('share') || '⤴'; el.right.appendChild(b);
    }
    if (view === 'payment-reminders') {
      const c = C(), now = Date.now(), bk = [0, 0, 0, 0], names = ['0–7 days', '8–30 days', '31–60 days', '60+ days'];
      c.invoices.forEach(i => { if (c.docSign(i) <= 0) return; const due = (i.total || 0) - (i.paidAmount || 0); if (due <= 0.001) return; const d = Math.floor((now - c.ts(i.meta && i.meta.dueDate ? i.meta.dueDate + 'T12:00:00' : i.date)) / 864e5); bk[d <= 7 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : 3] += due; });
      if (bk.some(x => x > 0)) { const d = document.createElement('div'); d.className = 'doc-card'; d.style.margin = '0 16px 12px'; d.innerHTML = '<div class="doc-label">Money outstanding by age</div>' + bk.map((x, k) => `<div class="tot-row"><span>${names[k]}</span><b${k > 1 && x ? ' style="color:var(--danger)"' : ''}>${cur()} ${m(x)}</b></div>`).join(''); const first = el.content.firstElementChild; if (first) first.insertBefore(d, first.firstChild); }
    }
  };
  E.actions['share-screen'] = () => {
    const el = document.getElementById('appContent'); if (!el) return;
    const lines = el.innerText.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 120);
    shareAny(`*${S().businessName || 'Billaura'}* · ${document.getElementById('headerTitle').textContent}\n${new Date().toLocaleDateString('en-GB')}\n\n` + lines.join('\n'));
  };

  // ======================= POS v2 =======================
  const DRAFT = 'billaura_pos_draft_v2', HELD = 'billaura_pos_held_v2';
  const P = Object.assign({ lines: [], name: '', phone: '', discType: 'amt', discValue: 0, exchange: null, filter: 'fav', q: '' }, lsGet(DRAFT, {}));
  const saveDraft = () => lsSet(DRAFT, { lines: P.lines, name: P.name, phone: P.phone, discType: P.discType, discValue: P.discValue, exchange: P.exchange });
  const posCalc = () => {
    const c = C().calcDoc(P.lines, { discType: P.discType, discValue: P.discValue, taxRate: S().taxRate || 0, taxType: 'pct' });
    const credit = P.exchange ? Math.min(P.exchange.amount, c.total) : 0;
    c.credit = r2(credit); c.payable = r2(c.total - credit); return c;
  };
  function resetPos() { P.lines = []; P.name = ''; P.phone = ''; P.discType = 'amt'; P.discValue = 0; P.exchange = null; saveDraft(); }
  function tile(p, favs) {
    const oos = E.stockAt(p) <= 0, fav = favs.includes(p.id);
    return `<button type="button" class="pos-tile${oos ? ' oos' : ''}" data-action="pz-add" data-id="${p.id}"><span class="pos-fav" data-action="pz-fav" data-id="${p.id}">${fav ? '★' : '☆'}</span><span class="pos-name">${h(p.name)}</span><span class="pos-price">${cur()} ${m(E.priceOf(p))}</span><span class="pos-stock">${oos ? 'Out of stock' : 'Stock ' + E.stockAt(p)}</span></button>`;
  }
  function posList() {
    const c = C(), q = P.q.trim().toLowerCase(), favs = S().favourites || [];
    let l = c.products.slice();
    if (q) l = l.filter(p => p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q));
    else if (P.filter === 'fav') { const f = favs.map(id => l.find(p => p.id === id)).filter(Boolean); l = f.length ? f : l.slice(0, 30); }
    else if (P.filter !== 'all') l = l.filter(p => (p.category || '') === P.filter);
    return l.slice(0, 90).map(p => tile(p, favs)).join('') || empty('No items found');
  }
  function drawGrid() { const g = document.getElementById('pzGrid'); if (g) g.innerHTML = posList(); }
  function drawCart() {
    const el = document.getElementById('pzCart'); if (!el) return;
    const c = posCalc(), n = P.lines.reduce((a, l) => a + l.qty, 0), can = C().can('discount');
    el.innerHTML = (P.exchange ? `<div class="pz-ex"><b>Exchange</b> · credit ${cur()} ${m(P.exchange.amount)} from ${h(P.exchange.ref)} <button data-action="pz-ex-off">remove</button></div>` : '') +
      (P.lines.length ? `<div class="pz-lines">${P.lines.map((l, i) => `<div class="pz-line"><div class="pz-ln"><b>${h(l.name)}</b><small>${cur()} ${can || l.unlocked ? `<input class="pz-pr" type="number" inputmode="decimal" min="0" step="any" value="${l.price}" data-in="pz-price" data-i="${i}" aria-label="Price">` : m(l.price) + ' <a data-action="pz-unlock" data-i="' + i + '">🔒 change</a>'}</small></div>
        <div class="pz-q"><button data-action="pz-dec" data-i="${i}">−</button><input type="number" inputmode="decimal" min="0" step="any" value="${l.qty}" data-in="pz-qty" data-i="${i}"><button data-action="pz-inc" data-i="${i}">+</button></div>
        <div class="pz-amt">${m(l.price * l.qty)}</div><button class="pz-x" data-action="pz-del" data-i="${i}" aria-label="Remove">✕</button></div>`).join('')}</div>
      ${E.simple() ? easyQuick(c) : ''}<div class="pz-tot"><div><span>Subtotal</span><b>${cur()} ${m(c.sub)}</b></div>${c.discount ? `<div><span>Discount</span><b>− ${m(c.discount)}</b></div>` : ''}${c.tax ? `<div><span>Tax</span><b>${m(c.tax)}</b></div>` : ''}${c.credit ? `<div><span>Exchange credit</span><b>− ${m(c.credit)}</b></div>` : ''}</div>` : '');
    const bar = document.getElementById('pzBar'), easy = E.simple();
    if (bar && easy) bar.innerHTML = `<div class="pos-cart-info"><span>${n} item${n === 1 ? '' : 's'}</span><strong>${cur()} ${m(c.payable)}</strong></div><button class="btn btn-outline" data-action="pz-charge" ${P.lines.length ? '' : 'disabled'}>Other</button><button class="btn btn-primary" data-action="pz-cash" data-v="${c.payable}" ${P.lines.length ? '' : 'disabled'}>Cash ${m(c.payable)}</button>`;
    else if (bar) bar.innerHTML = `<div class="pos-cart-info"><span>${n} item${n === 1 ? '' : 's'}</span><strong>${cur()} ${m(c.payable)}</strong></div><button class="btn btn-outline btn-sm" data-action="pz-disc" ${P.lines.length ? '' : 'disabled'}>${c.discount ? 'Disc ' + m(c.discount) : 'Discount'}</button><button class="btn btn-outline btn-sm" data-action="pz-hold" ${P.lines.length ? '' : 'disabled'}>Hold</button><button class="btn btn-primary" data-action="pz-charge" ${P.lines.length ? '' : 'disabled'}>Charge</button>`;
  }
  function easyQuick(c) {
    const due = c.payable, q = [due, Math.ceil(due / 50) * 50, Math.ceil(due / 100) * 100, Math.ceil(due / 500) * 500, Math.ceil(due / 1000) * 1000, Math.ceil(due / 5000) * 5000].filter((v, i, a) => v >= due && a.indexOf(v) === i).slice(0, 4);
    return `<div class="pz-quick"><span class="text-sm text-secondary">Customer gives:</span>${q.map((v, i) => `<button class="cat-chip" data-action="pz-cash" data-v="${v}">${i === 0 ? 'Exact ' : ''}${m(v)}</button>`).join('')}</div><div class="pz-more"><a data-action="pz-disc">Discount</a> · <a data-action="pz-hold">Hold bill</a> · <a data-action="pz-charge">Card / Udhaar…</a></div>`;
  }
  const shiftBanner = () => { const sh = S().shiftOpen; if (sh) return `<div class="pz-sh ok">Shift open since ${dt(sh.openedAt)} · <a data-view="shift">drawer</a></div>`; return S().requireShift ? `<div class="pz-sh bad">Open a shift before selling · <a data-view="shift">Open shift</a></div>` : ''; };
  E.views.pos = {
    title: 'Quick Sale', perm: 'sales',
    right: () => { const n = lsGet(HELD, []).length; return `<button class="btn btn-outline btn-sm" data-action="pz-held">Held${n ? ' (' + n + ')' : ''}</button>`; },
    html() {
      const cats = [...new Set(C().products.map(p => p.category).filter(Boolean))].slice(0, 8);
      return `<div class="fade-in pos-screen pz-screen">${shiftBanner()}
        <div class="pos-bar"><input type="search" class="search-input" id="pzSearch" placeholder="Search or scan barcode..." value="${h(P.q)}" autocomplete="off"><button class="btn btn-outline btn-sm" data-action="pz-scan">Scan</button></div>
        <div class="pos-chips" id="pzChips"><button class="cat-chip${P.filter === 'fav' ? ' active' : ''}" data-action="pz-filter" data-v="fav">Favourites</button><button class="cat-chip${P.filter === 'all' ? ' active' : ''}" data-action="pz-filter" data-v="all">All</button>${cats.map(k => `<button class="cat-chip${P.filter === k ? ' active' : ''}" data-action="pz-filter" data-v="${h(k)}">${h(k)}</button>`).join('')}</div>
        <div id="pzCart"></div><div class="pos-grid" id="pzGrid"></div><div class="pos-cart" id="pzBar"></div></div>`;
    },
    bind() {
      drawGrid(); drawCart();
      const s = document.getElementById('pzSearch');
      s.addEventListener('input', () => { P.q = s.value; drawGrid(); });
      s.addEventListener('keydown', e => { if (e.key !== 'Enter') return; const code = s.value.trim().toLowerCase(); if (!code) return; const p = C().products.find(x => (x.barcode || '').toLowerCase() === code); if (p) { add(p.id); s.value = ''; P.q = ''; drawGrid(); } else { const l = C().products.filter(x => x.name.toLowerCase().includes(code)); if (l.length === 1) { add(l[0].id); s.value = ''; P.q = ''; drawGrid(); } else toast('No exact match'); } });
    }
  };
  function add(id, qty) {
    const p = C().products.find(x => x.id === id); if (!p) return;
    const l = P.lines.find(x => x.productId === id);
    if (l) l.qty = r2(l.qty + (qty || 1)); else P.lines.push({ productId: p.id, name: p.name, price: E.priceOf(p), cost: Number(p.cost) || 0, qty: qty || 1 });
    if (S().enableStock !== false && E.stockAt(p) < (l ? l.qty : 1)) toast(p.name + ': only ' + Math.max(0, E.stockAt(p)) + ' in stock' + (E.brName() ? ' at ' + E.brName() : ''));
    saveDraft(); drawCart();
    try { navigator.vibrate && navigator.vibrate(15); } catch (e) {}
  }
  E.add = add;
  E.inputs['pz-qty'] = el => { const l = P.lines[+el.dataset.i]; if (!l) return; l.qty = Math.max(0, parseFloat(el.value) || 0); saveDraft(); updTotalsOnly(); };
  E.inputs['pz-price'] = el => { const l = P.lines[+el.dataset.i]; if (!l) return; l.price = Math.max(0, parseFloat(el.value) || 0); saveDraft(); updTotalsOnly(); };
  function updTotalsOnly() { const bar = document.getElementById('pzBar'); if (!bar) return; const c = posCalc(), n = P.lines.reduce((a, l) => a + l.qty, 0); const st = bar.querySelector('strong'); if (st) st.textContent = cur() + ' ' + m(c.payable); const sp = bar.querySelector('span'); if (sp) sp.textContent = n + ' item' + (n === 1 ? '' : 's'); }
  const A = E.actions;
  E.simple = () => false;
  E.brId = () => 'main'; E.stamp = () => {}; E.stockAt = p => Number(p.stock) || 0; E.priceOf = p => Number(p.price) || 0; E.brName = () => '';
  A['pz-add'] = (t, e) => { if (e.target.closest('[data-action="pz-fav"]')) return; add(t.dataset.id); };
  A['pz-fav'] = t => { const f = (S().favourites = S().favourites || []), i = f.indexOf(t.dataset.id); if (i >= 0) f.splice(i, 1); else f.push(t.dataset.id); C().persist(); drawGrid(); };
  A['pz-filter'] = t => { P.filter = t.dataset.v; P.q = ''; const s = document.getElementById('pzSearch'); if (s) s.value = ''; document.querySelectorAll('#pzChips .cat-chip').forEach(b => b.classList.toggle('active', b === t)); drawGrid(); };
  A['pz-inc'] = t => { const l = P.lines[+t.dataset.i]; if (l) { l.qty = r2(l.qty + 1); saveDraft(); drawCart(); } };
  A['pz-dec'] = t => { const l = P.lines[+t.dataset.i]; if (l) { l.qty = r2(l.qty - 1); if (l.qty <= 0) P.lines.splice(+t.dataset.i, 1); saveDraft(); drawCart(); } };
  A['pz-del'] = t => { P.lines.splice(+t.dataset.i, 1); saveDraft(); drawCart(); };
  A['pz-unlock'] = async t => { if (await E.approve('discount', 'pos-price')) { const l = P.lines[+t.dataset.i]; if (l) { l.unlocked = true; E.audit('price', 'Price unlocked for ' + l.name); drawCart(); } } };
  A['pz-scan'] = () => C().startScanner(code => { const p = C().products.find(x => (x.barcode || '').toLowerCase() === String(code).toLowerCase()); if (!p) return toast('Product not found'); add(p.id); toast('+1 ' + p.name); });
  A['pz-ex-off'] = () => { if (P.exchange) { const cn = C().invoices.find(x => x.number === P.exchange.ref); if (cn && cn.meta && cn.meta.exchangePending) { delete cn.meta.exchangePending; cn.meta.paymentMode = 'Cash'; cn.meta.refundMode = 'cash'; cn.updatedAt = new Date().toISOString(); C().persist(); toast('Exchange cancelled. Refund recorded as cash'); } } P.exchange = null; saveDraft(); drawCart(); };
  A['pz-disc'] = async () => {
    if (!C().can('discount') && !(await E.approve('discount', 'pos-discount'))) return;
    modal('Discount', `<div class="modal-body"><div class="chip-row" id="pzDt"><button class="cat-chip${P.discType === 'amt' ? ' active' : ''}" data-action="pz-dt" data-v="amt">${cur()}</button><button class="cat-chip${P.discType === 'pct' ? ' active' : ''}" data-action="pz-dt" data-v="pct">%</button></div>
      <input id="pzDv" class="form-input" type="number" inputmode="decimal" min="0" step="any" value="${P.discValue || ''}" placeholder="0" style="margin-top:10px"><div class="form-row" style="margin-top:10px"><button class="btn btn-secondary" data-action="pz-disc-clear">Remove</button><button class="btn btn-primary" data-action="pz-disc-ok">Apply</button></div></div>`);
  };
  A['pz-dt'] = t => { P.discType = t.dataset.v; document.querySelectorAll('#pzDt .cat-chip').forEach(b => b.classList.toggle('active', b === t)); };
  A['pz-disc-ok'] = () => { P.discValue = Math.max(0, num('pzDv')); close(); saveDraft(); drawCart(); };
  A['pz-disc-clear'] = () => { P.discValue = 0; close(); saveDraft(); drawCart(); };
  // ---- hold / resume ----
  A['pz-hold'] = () => { if (!P.lines.length) return; const held = lsGet(HELD, []); held.unshift({ id: C().uid(), t: new Date().toISOString(), lines: P.lines, name: P.name, phone: P.phone, discType: P.discType, discValue: P.discValue, exchange: P.exchange }); lsSet(HELD, held.slice(0, 20)); resetPos(); toast('Bill put on hold'); redraw(); };
  A['pz-held'] = () => {
    const held = lsGet(HELD, []);
    modal('Held bills', `<div class="modal-body">${held.length ? held.map(b => `<div class="list-row" style="cursor:default"><div class="list-row-left"><div><div class="list-row-label">${b.lines.length} item${b.lines.length === 1 ? '' : 's'} · ${cur()} ${m(b.lines.reduce((a, l) => a + l.price * l.qty, 0))}</div><div class="text-sm text-secondary">${dt(b.t)}${b.name ? ' · ' + h(b.name) : ''}</div></div></div><div style="display:flex;gap:6px"><button class="chip-btn" data-action="pz-resume" data-id="${b.id}">Resume</button><button class="chip-btn" data-action="pz-held-del" data-id="${b.id}">✕</button></div></div>`).join('') : empty('No held bills')}</div>`);
  };
  A['pz-resume'] = t => {
    const held = lsGet(HELD, []), b = held.find(x => x.id === t.dataset.id); if (!b) return;
    if (P.lines.length) { held.unshift({ id: C().uid(), t: new Date().toISOString(), lines: P.lines, name: P.name, phone: P.phone, discType: P.discType, discValue: P.discValue, exchange: P.exchange }); }
    lsSet(HELD, held.filter(x => x.id !== b.id)); Object.assign(P, { lines: b.lines, name: b.name, phone: b.phone, discType: b.discType, discValue: b.discValue, exchange: b.exchange || null }); saveDraft(); close(); redraw();
  };
  A['pz-held-del'] = t => { lsSet(HELD, lsGet(HELD, []).filter(x => x.id !== t.dataset.id)); close(); A['pz-held'](); };

  // ---- checkout ----
  let PAY = { mode: 'Cash', cash: 0, bank: 0, online: 0 };
  A['pz-charge'] = () => {
    if (!P.lines.length) return;
    if (S().requireShift && !S().shiftOpen) { toast('Open a shift first'); return go('shift'); }
    const c = posCalc();
    PAY = { mode: 'Cash', cash: 0, bank: 0, online: 0 };
    const dl = C().customers.map(x => `<option value="${h(x.name)}">`).join('');
    modal('Payment', `<div class="modal-body">
      <div class="pz-due"><span>${c.credit ? 'To pay after exchange' : 'Amount due'}</span><b>${cur()} ${m(c.payable)}</b></div>${P.exchange && P.exchange.amount > c.total + 0.001 ? `<div class="pz-change">Exchange credit is more than this bill. You will give back <b>${cur()} ${m(r2(P.exchange.amount - c.total))}</b>.</div>` : ''}
      <div class="chip-row" id="pzModes">${['Cash', 'Bank', 'Online', 'Split', 'Credit'].map((k, i) => `<button class="cat-chip${i ? '' : ' active'}" data-action="pz-mode" data-v="${k}">${k === 'Bank' ? 'Card/Bank' : k === 'Online' ? 'Wallet' : k === 'Credit' ? 'Udhaar' : k}</button>`).join('')}</div>
      <div id="pzPayBody"></div>
      <div class="form-row" style="margin-top:10px"><div class="form-group"><label class="form-label">Customer ${'(optional)'}</label><input class="form-input" id="pzName" list="pzCust" value="${h(P.name)}" data-in="pz-cname" placeholder="Walk-in" autocomplete="off"><datalist id="pzCust">${dl}</datalist></div>
      <div class="form-group"><label class="form-label">Phone</label><input class="form-input" id="pzPhone" type="tel" value="${h(P.phone)}" placeholder="03XX…"></div></div>
      <button class="btn btn-primary btn-block btn-lg" data-action="pz-pay">Complete sale</button></div>`);
    drawPay();
  };
  E.inputs['pz-cname'] = el => { const x = C().customers.find(k => k.name.toLowerCase() === el.value.trim().toLowerCase()); if (x && x.phone) { const ph = document.getElementById('pzPhone'); if (ph && !ph.value) ph.value = x.phone; } };
  function drawPay() {
    const c = posCalc(), b = document.getElementById('pzPayBody'); if (!b) return;
    const k = PAY.mode, due = c.payable;
    if (k === 'Cash') {
      const q = [due, Math.ceil(due / 50) * 50, Math.ceil(due / 100) * 100, Math.ceil(due / 500) * 500, Math.ceil(due / 1000) * 1000].filter((v, i, a) => v > 0 && a.indexOf(v) === i).slice(0, 4);
      b.innerHTML = `<label class="form-label" style="margin-top:8px">Cash received</label><input class="form-input" id="pzRecv" type="number" inputmode="decimal" min="0" step="any" value="${due}" data-in="pz-recv"><div class="chip-row" style="margin:8px 0">${q.map(v => `<button class="cat-chip" data-action="pz-quick" data-v="${v}">${m(v)}</button>`).join('')}</div><div class="pz-change" id="pzChange"></div>`; E.inputs['pz-recv'](document.getElementById('pzRecv'));
    } else if (k === 'Split') {
      b.innerHTML = `<div class="form-row" style="margin-top:8px"><div class="form-group"><label class="form-label">Cash</label><input class="form-input" id="pzSc" type="number" inputmode="decimal" min="0" step="any" data-in="pz-split"></div><div class="form-group"><label class="form-label">Card/Bank</label><input class="form-input" id="pzSb" type="number" inputmode="decimal" min="0" step="any" data-in="pz-split"></div><div class="form-group"><label class="form-label">Wallet</label><input class="form-input" id="pzSo" type="number" inputmode="decimal" min="0" step="any" data-in="pz-split"></div></div><div class="pz-change" id="pzChange"></div>`; E.inputs['pz-split']();
    } else if (k === 'Credit') b.innerHTML = `<div class="text-sm text-secondary" style="margin:10px 0">Full amount goes on the customer's account. Enter a customer below. Optional advance:</div><input class="form-input" id="pzAdv" type="number" inputmode="decimal" min="0" step="any" placeholder="Advance received (0)">`;
    else b.innerHTML = `<div class="text-sm text-secondary" style="margin:10px 0">Full amount received by ${k === 'Bank' ? 'card / bank transfer' : 'wallet (JazzCash / EasyPaisa)'}.</div>`;
  }
  E.inputs['pz-recv'] = el => { const due = posCalc().payable, v = parseFloat((el || {}).value) || 0, ch = document.getElementById('pzChange'); if (!ch) return; ch.innerHTML = v >= due ? `Change to return: <b>${cur()} ${m(r2(v - due))}</b>` : `<span style="color:var(--danger)">Short by ${cur()} ${m(r2(due - v))} → goes on account</span>`; };
  E.inputs['pz-split'] = () => { const due = posCalc().payable, t = num('pzSc') + num('pzSb') + num('pzSo'), ch = document.getElementById('pzChange'); if (ch) ch.innerHTML = t >= due ? `Paid in full${t > due ? ' · change ' + m(r2(t - due)) : ''}` : `Remaining on account: <b>${cur()} ${m(r2(due - t))}</b>`; };
  A['pz-mode'] = t => { PAY.mode = t.dataset.v; document.querySelectorAll('#pzModes .cat-chip').forEach(b => b.classList.toggle('active', b === t)); drawPay(); };
  A['pz-quick'] = t => { const i = document.getElementById('pzRecv'); i.value = t.dataset.v; E.inputs['pz-recv'](i); };
  A['pz-pay'] = () => {
    const c = posCalc(), due = c.payable, k = PAY.mode; let pay = { Cash: 0, Bank: 0, Online: 0 }, change = 0;
    if (k === 'Cash') { const rv = num('pzRecv'); pay.Cash = Math.min(rv, due); change = Math.max(0, r2(rv - due)); }
    else if (k === 'Bank') pay.Bank = due; else if (k === 'Online') pay.Online = due;
    else if (k === 'Split') { pay.Cash = num('pzSc'); pay.Bank = num('pzSb'); pay.Online = num('pzSo'); const t = pay.Cash + pay.Bank + pay.Online; if (t > due) { const ex = r2(t - due); change = Math.min(ex, pay.Cash); pay.Cash = r2(pay.Cash - change); } }
    else if (k === 'Credit') pay.Cash = Math.min(num('pzAdv'), due);
    const paid = r2(pay.Cash + pay.Bank + pay.Online), name = val('pzName').trim(), phone = val('pzPhone').trim();
    if (due - paid > 0.001 && !name) { toast('Enter the customer name for the unpaid part'); return; }
    P.name = name; P.phone = phone;
    const inv = createSale({ pay, change });
    if (!inv) return;
    showDone(inv, change, lastRefund);
  };
  let lastRefund = 0;
  function createSale(o) {
    lastRefund = 0;
    const c = C(), s = S(), now = new Date().toISOString(), calc = posCalc();
    if (!c.enforceLimit('invoices', c.invoices.length)) return null;
    const items = P.lines.filter(l => l.qty > 0).map(l => ({ productId: l.productId, name: l.name, price: l.price, cost: l.cost, qty: l.qty }));
    if (!items.length) { toast('Cart is empty'); return null; }
    const number = c.nextInvoiceNumber();
    items.forEach(it => { const p = c.products.find(x => x.id === it.productId); if (!p) return; p.stock = r2((Number(p.stock) || 0) - it.qty); try { E.onStock(p, -it.qty); } catch (e) {} c.stockMovements.unshift({ id: c.uid(), productId: it.productId, productName: it.name, type: 'out', qty: it.qty, date: now, note: 'Invoice ' + number }); });
    let cid = '', cname = P.name || 'Walk-in Customer', cphone = P.phone || '';
    if (P.name) { const cu = c.findOrCreateCustomer(P.name, P.phone); if (cu) { cid = cu.id; cname = cu.name; if (!cphone) cphone = cu.phone || ''; } }
    const paid = r2(o.pay.Cash + o.pay.Bank + o.pay.Online), total = calc.total;
    const credit = calc.credit, effPaid = r2(paid + credit);
    const modes = Object.keys(o.pay).filter(k => o.pay[k] > 0).sort((a, b) => o.pay[b] - o.pay[a]), main = modes[0] || 'Cash';
    const meta = { subtotal: calc.sub, discount: calc.discount, discType: P.discType, discValue: Number(P.discValue) || 0, taxName: 'Tax', taxRate: calc.taxRate, taxType: 'pct', tax: calc.tax, inclTax: !!s.enableInclusiveTax, chargeLabel: '', charges: 0, roundOff: 0, paymentMode: paid > 0 ? main : '', pos: 1 };
    if (s.shiftOpen) meta.shiftId = s.shiftOpen.id;
    E.stamp(meta);
    if (c.isStaff()) meta.by = c.staffName();
    if (P.exchange) { meta.exchangeFrom = P.exchange.ref; }
    const pays = [];
    modes.slice(1).forEach(k => pays.push({ date: now, amount: o.pay[k], mode: k, note: 'Split' }));
    if (credit > 0) pays.push({ date: now, amount: credit, mode: 'Exchange', note: 'Credit from ' + P.exchange.ref });
    if (pays.length) meta.payments = pays;
    // cash received for part of the money that moved goes under main mode; credit entry is a book adjustment (not cash)
    const inv = { id: c.uid(), number, docType: 'sale', customerId: cid || null, customerName: cname, customerPhone: cphone, items, total, paymentStatus: effPaid >= total - 0.001 ? 'paid' : (effPaid > 0 ? 'partial' : 'unpaid'), paidAmount: effPaid, meta, date: now };
    if (P.exchange) {
      const cn = c.invoices.find(x => x.number === P.exchange.ref), left = r2(P.exchange.amount - calc.credit);
      if (cn) { delete cn.meta.exchangePending; cn.updatedAt = now; if (left > 0.001) { (cn.meta.payments = cn.meta.payments || []).push({ date: now, amount: left, mode: 'Cash', note: 'Exchange balance refunded' }); } }
      lastRefund = left;
    }
    c.invoices.unshift(inv); c.persist(); resetPos();
    return inv;
  }
  function showDone(inv, change, refundLeft) {
    const due = r2(inv.total - inv.paidAmount);
    modal('Sale saved', `<div class="modal-body" style="text-align:center"><div style="font-size:2.2rem">✅</div><div style="font-weight:800;font-size:1.25rem">${h(inv.number)}</div><div class="text-sm text-secondary">${cur()} ${m(inv.total)} · ${due > 0.001 ? 'on account ' + m(due) : 'paid'}</div>
      ${change > 0 ? `<div class="pz-change" style="margin:12px 0;font-size:1.1rem">Return change: <b>${cur()} ${m(change)}</b></div>` : ''}${refundLeft > 0.001 ? `<div class="pz-change" style="margin:12px 0;font-size:1.1rem">Give the customer back: <b>${cur()} ${m(refundLeft)}</b> (exchange balance)</div>` : ''}
      <div class="form-row" style="margin-top:12px"><button class="btn btn-outline" data-action="print-invoice" data-id="${inv.id}">Print</button><button class="btn btn-outline" data-action="pz-share" data-id="${inv.id}">Share</button></div>
      <button class="btn btn-primary btn-block" style="margin-top:8px" data-action="pz-new">New sale</button></div>`);
  }
  setInterval(() => { const z = document.getElementById('pzSnack'); if (z && z.classList.contains('show') && C().view !== 'pos') z.classList.remove('show'); }, 300);
  function showSnack(inv, change, refund, canUndo) {
    let el = document.getElementById('pzSnack'); if (!el) { el = document.createElement('div'); el.id = 'pzSnack'; document.body.appendChild(el); }
    clearTimeout(E._sn);
    el.innerHTML = `<div class="pzs-top"><b>✅ ${h(inv.number)} · ${cur()} ${m(inv.total)}</b><button data-action="pz-snack-x" aria-label="Close">✕</button></div>${change > 0 ? `<div class="pzs-change">Return change <b>${cur()} ${m(change)}</b></div>` : ''}${refund > 0.001 ? `<div class="pzs-change">Give back <b>${cur()} ${m(refund)}</b> (exchange)</div>` : ''}<div class="pzs-btns"><button data-action="print-invoice" data-id="${inv.id}">Print</button><button data-action="pz-share" data-id="${inv.id}">WhatsApp</button>${canUndo ? `<button data-action="pz-undo" data-id="${inv.id}">Undo</button>` : ''}</div>`;
    el.className = 'show'; E._sn = setTimeout(() => el.classList.remove('show'), change > 0 ? 25000 : 12000);
  }
  A['pz-snack-x'] = () => { const el = document.getElementById('pzSnack'); if (el) el.classList.remove('show'); };
  A['pz-cash'] = t => {
    if (!P.lines.length) return;
    if (S().requireShift && !S().shiftOpen) { toast('Start your day first'); return go('shift'); }
    const c = posCalc(), due = c.payable, rv = Math.max(due, parseFloat(t.dataset.v) || 0), change = r2(rv - due), usedEx = !!P.exchange;
    const inv = createSale({ pay: { Cash: due, Bank: 0, Online: 0 }, change }); if (!inv) return;
    drawCart(); drawGrid(); showSnack(inv, change, lastRefund, !usedEx);
  };
  A['pz-undo'] = async t => {
    const c = C(), inv = c.invoices.find(x => x.id === t.dataset.id); if (!inv) return toast('Already removed');
    if (!(await c.askConfirm(`Cancel ${inv.number}? Stock is put back and the bill goes to the Recycle Bin.`, { okText: 'Cancel sale', danger: true }))) return;
    inv.items.forEach(it => { const p = c.products.find(x => x.id === it.productId); if (p) { p.stock = r2((Number(p.stock) || 0) + it.qty); try { E.onStock(p, it.qty, 'return'); } catch (e) {} } });
    c.trashInvoice(inv); E.audit('void', `Cancelled ${inv.number} ${cur()} ${m(inv.total)}`); c.persist(); A['pz-snack-x'](); toast('Sale cancelled'); if (c.view === 'pos') { drawGrid(); } else redraw();
  };
  A['pz-share'] = t => { const inv = C().invoices.find(x => x.id === t.dataset.id); if (inv) { close(); C().openShareSheet(inv); } };
  A['pz-new'] = () => { close(); redraw(); };
  // allow other screens (exchange / buy again) to preload the POS
  E.loadPos = (o) => { resetPos(); Object.assign(P, o); saveDraft(); go('pos'); };

  // ======================= Shift & cash drawer =======================
  function shiftStats(from, to, sh, bidArg) {
    const c = C(), f = new Date(from).getTime(), t = to ? new Date(to).getTime() : Date.now();
    const bid = sh ? sh.branchId : (bidArg || null), okB = x => !bid || ((x.meta && x.meta.branchId) || 'main') === bid;
    const inW = x => { const v = c.ts(x.date); return v >= f && v <= t && okB(x); };
    const sales = saleDocs().filter(inW), rets = c.invoices.filter(i => i.docType === 'return').filter(inW);
    const rows = c.cashEntries().filter(r => r.t >= f && r.t <= t && (!bid || r.br === bid));
    const byMode = {}; rows.forEach(r => { if (r.mode === 'Exchange') return; const o = byMode[r.mode] || (byMode[r.mode] = { i: 0, o: 0 }); o[r.dir === 'in' ? 'i' : 'o'] += r.amount; });
    const cash = byMode.Cash || { i: 0, o: 0 };
    const moves = (sh && sh.moves) || [], mv = sumBy(moves, x => x.amount);
    const exp = sumBy(rows.filter(r => r.mode === 'Cash' && r.dir === 'out' && /^Expense/.test(r.text)), r => r.amount);
    return { count: sales.length, gross: sumBy(sales, i => (i.meta && i.meta.subtotal) || i.total), discount: sumBy(sales, i => i.meta && i.meta.discount), total: sumBy(sales, i => i.total), returns: sumBy(rets, i => i.total), retCount: rets.length,
      onAccount: sumBy(sales, i => Math.max(0, i.total - (i.paidAmount || 0))), byMode, cashIn: r2(cash.i), cashOut: r2(cash.o), expenses: exp, moves: r2(mv), opening: sh ? Number(sh.openCash) || 0 : 0,
      expected: r2((sh ? Number(sh.openCash) || 0 : 0) + mv + cash.i - cash.o) };
  }
  function zText(r) {
    const k = r.stats, b = r.stats.byMode, ln = x => x.join('\n');
    return ln([`*${S().businessName || 'Billaura'}* · Shift report`, `Cashier: ${r.by || '-'}`, `Opened: ${dt(r.openedAt)}`, r.closedAt ? `Closed: ${dt(r.closedAt)}` : '', '',
      `Sales: ${k.count} bills · ${cur()} ${m(k.total)}`, k.discount ? `Discounts given: ${cur()} ${m(k.discount)}` : '', `Returns: ${k.retCount} · ${cur()} ${m(k.returns)}`, `Net sales: ${cur()} ${m(r2(k.total - k.returns))}`, k.onAccount ? `On account (udhaar): ${cur()} ${m(k.onAccount)}` : '', '',
      ...Object.keys(b).map(x => `${x} in ${m(b[x].i)}${b[x].o ? ' · out ' + m(b[x].o) : ''}`), '',
      `Opening cash: ${m(k.opening)}`, k.moves ? `Drawer in/out: ${m(k.moves)}` : '', `Cash in: ${m(k.cashIn)}`, `Cash out (refunds/expenses): ${m(k.cashOut)}`, `Expected in drawer: *${cur()} ${m(k.expected)}*`,
      r.counted != null ? `Counted: *${cur()} ${m(r.counted)}*` : '', r.counted != null ? `Difference: *${r.diff > 0 ? '+' : ''}${m(r.diff)}* ${Math.abs(r.diff) < 0.5 ? '✅' : (r.diff < 0 ? '(short)' : '(over)')}` : '', r.note ? 'Note: ' + r.note : ''].filter(x => x !== '' || true).filter((x, i, a) => !(x === '' && a[i - 1] === '')));
  }
  function zHtml(r) {
    const k = r.stats, b = k.byMode, tr = (l, v, st) => `<div class="tot-row"><span>${l}</span><b${st ? ` style="${st}"` : ''}>${v}</b></div>`;
    return `<div class="doc-card">${tr('Bills', k.count)}${tr('Sales', cur() + ' ' + m(k.total))}${k.discount ? tr('Discounts', '− ' + m(k.discount)) : ''}${tr('Returns (' + k.retCount + ')', '− ' + m(k.returns))}${tr('Net sales', cur() + ' ' + m(r2(k.total - k.returns)))}${k.onAccount ? tr('On account (udhaar)', m(k.onAccount)) : ''}</div>
      <div class="doc-card"><div class="doc-label">Money moved</div>${Object.keys(b).map(x => tr(x, `<span style="color:var(--success)">+${m(b[x].i)}</span>${b[x].o ? ` <span style="color:var(--danger)">−${m(b[x].o)}</span>` : ''}`)).join('') || '<div class="text-sm text-secondary">Nothing yet</div>'}</div>
      <div class="doc-card"><div class="doc-label">Cash drawer</div>${tr('Opening', m(k.opening))}${k.moves ? tr('Drawer in/out', m(k.moves)) : ''}${tr('Cash in', '+' + m(k.cashIn))}${tr('Cash out', '−' + m(k.cashOut))}${tr('Expected', cur() + ' ' + m(k.expected), 'font-size:1.05rem')}${r.counted != null ? tr('Counted', cur() + ' ' + m(r.counted)) + tr('Difference', (r.diff > 0 ? '+' : '') + m(r.diff), 'color:var(--' + (Math.abs(r.diff) < 0.5 ? 'success' : 'danger') + ')') : ''}</div>`;
  }
  const canShift = () => C().can('sales');
  E.views.shift = {
    title: 'Shift & Cash Drawer', perm: 'sales',
    html() {
      const sh = S().shiftOpen, hist = arr('shifts');
      let top;
      if (!sh) top = `<div class="doc-card"><div class="doc-label">Start a shift</div><p class="text-sm text-secondary">Count the cash in the drawer and enter it. At the end of the day you count again and see any difference.</p><input class="form-input" id="shOpen" type="number" inputmode="decimal" min="0" step="any" placeholder="Opening cash in drawer"><button class="btn btn-primary btn-block" style="margin-top:10px" data-action="sh-open">Open shift</button></div>`;
      else {
        const st = shiftStats(sh.openedAt, null, sh);
        top = `<div class="doc-card"><div class="text-sm text-secondary">Open since ${dt(sh.openedAt)} · ${h(sh.by || '')}</div><div style="font-size:1.4rem;font-weight:800;margin:4px 0">Expected in drawer: ${cur()} ${m(st.expected)}</div></div>
          ${zHtml({ stats: st })}
          <div class="doc-card"><div class="doc-label">Cash in / out of drawer</div><p class="text-sm text-secondary">Petty cash, owner withdrawal, change float. Not a sale or expense.</p><div class="form-row"><input class="form-input" id="shMv" type="number" inputmode="decimal" step="any" placeholder="Amount"><input class="form-input" id="shMn" placeholder="Reason" maxlength="40"></div><div class="form-row" style="margin-top:8px"><button class="btn btn-outline" data-action="sh-mv" data-d="1">Cash in +</button><button class="btn btn-outline" data-action="sh-mv" data-d="-1">Cash out −</button></div>${(sh.moves || []).map(x => `<div class="tot-row"><span>${dt(x.t)} ${h(x.note || '')}</span><b>${x.amount > 0 ? '+' : ''}${m(x.amount)}</b></div>`).join('')}</div>
          <div class="doc-card"><div class="doc-label">Close shift</div><input class="form-input" id="shCount" type="number" inputmode="decimal" min="0" step="any" placeholder="Cash counted in drawer" data-in="sh-count"><div class="pz-change" id="shDiff"></div><input class="form-input" id="shNote" placeholder="Note (optional)" maxlength="80" style="margin-top:8px"><button class="btn btn-primary btn-block" style="margin-top:10px" data-action="sh-close">Close shift &amp; print report</button></div>`;
      }
      return `<div class="fade-in" style="padding:12px 16px 90px">${top}
        <label class="check-row"><input type="checkbox" data-ch="sh-req" ${S().requireShift ? 'checked' : ''}> Require an open shift to sell in POS</label>
        <div class="section-header"><h2 class="section-title">Past shifts</h2></div>${hist.length ? hist.map(r => `<div class="list-row" data-action="sh-view" data-id="${r.id}"><div class="list-row-left"><div><div class="list-row-label">${dt(r.openedAt)} → ${dt(r.closedAt)}</div><div class="text-sm text-secondary">${h(r.by || '')} · sales ${m(r.stats.total)}</div></div></div><b style="color:var(--${Math.abs(r.diff) < 0.5 ? 'success' : 'danger'})">${r.diff > 0 ? '+' : ''}${m(r.diff)}</b></div>`).join('') : empty('No closed shifts yet')}</div>`;
    }
  };
  E.inputs['sh-req'] = el => { S().requireShift = el.checked; C().persist(); };
  E.inputs['sh-count'] = () => { const sh = S().shiftOpen, d = document.getElementById('shDiff'); if (!sh || !d) return; const v = parseFloat(val('shCount')); if (!isFinite(v)) { d.textContent = ''; return; } const diff = r2(v - shiftStats(sh.openedAt, null, sh).expected); d.innerHTML = Math.abs(diff) < 0.5 ? '<span style="color:var(--success)">Drawer matches ✅</span>' : `<span style="color:var(--danger)">${diff < 0 ? 'Short' : 'Over'} by ${cur()} ${m(Math.abs(diff))}</span>`; };
  A['sh-open'] = () => { const v = val('shOpen'); if (v === '' || !(parseFloat(v) >= 0)) return toast('Enter opening cash (0 if empty)'); S().shiftOpen = { id: C().uid(), openedAt: new Date().toISOString(), openCash: parseFloat(v), by: C().isStaff() ? C().staffName() : 'Owner', moves: [], branchId: E.brId() }; C().persist(); close(); toast('Shift opened'); redraw(); };
  A['sh-mv'] = t => { const sh = S().shiftOpen, v = num('shMv'); if (!sh || !(v > 0)) return toast('Enter an amount'); (sh.moves = sh.moves || []).push({ t: new Date().toISOString(), amount: r2(v * Number(t.dataset.d)), note: val('shMn').trim() }); C().persist(); redraw(); };
  A['sh-close'] = async () => {
    const sh = S().shiftOpen; if (!sh) return; const v = val('shCount'); if (v === '' || !(parseFloat(v) >= 0)) return toast('Count the drawer first');
    const closedAt = new Date().toISOString(), stats = shiftStats(sh.openedAt, closedAt, sh), counted = parseFloat(v), diff = r2(counted - stats.expected);
    const rec = { id: sh.id, by: sh.by, openedAt: sh.openedAt, closedAt, counted, diff, note: val('shNote').trim(), stats };
    arr('shifts').unshift(rec); S().shifts = S().shifts.slice(0, 60); E.audit('shift', `Closed shift: counted ${m(counted)}, difference ${m(diff)}`); S().shiftOpen = null; C().persist(); showZ(rec); if (E.simple()) takeSnap('auto').then(() => C().persist()).catch(() => {});
  };
  function showZ(r) {
    modal('Shift report', `<div class="modal-body" id="zBody"><div class="text-sm text-secondary" style="margin-bottom:8px">${dt(r.openedAt)} → ${r.closedAt ? dt(r.closedAt) : 'now'} · ${h(r.by || '')}</div>${zHtml(r)}<div class="form-row"><button class="btn btn-outline" data-action="z-print" data-id="${r.id}">Print</button><button class="btn btn-primary" data-action="z-share" data-id="${r.id}">Share</button></div></div>`);
  }
  A['sh-view'] = t => { const r = arr('shifts').find(x => x.id === t.dataset.id); if (r) showZ(r); };
  A['z-share'] = t => { const r = arr('shifts').find(x => x.id === t.dataset.id); if (r) shareAny(zText(r)); };
  A['z-print'] = t => { const r = arr('shifts').find(x => x.id === t.dataset.id); if (r) printText(zText(r).replace(/\*/g, '')); };
  function printText(txt) {
    const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print');
    w.document.write(`<pre style="font:13px/1.5 monospace;max-width:300px;margin:8px auto;white-space:pre-wrap">${h(txt)}</pre><script>setTimeout(function(){window.print()},300)<\/script>`); w.document.close();
  }
  E.printText = printText; E.helpers = { modal, close, redraw, go, empty, row, shareAny, sumBy, dt, today, val, num, arr, dayReport, shiftStats };

  // ======================= Return / Exchange =======================
  const R = { q: '', inv: null, qty: {}, reason: 'Customer changed mind', mode: 'cash', pm: 'Cash', restock: true, exchange: false };
  const REASONS = ['Customer changed mind', 'Wrong item', 'Damaged / defective', 'Expired', 'Other'];
  E.views.returns = {
    title: 'Return / Exchange', perm: null,
    html() {
      if (!R.inv) {
        const q = R.q.trim().toLowerCase();
        const l = saleDocs().filter(i => !q || String(i.number).toLowerCase().includes(q) || (i.customerName || '').toLowerCase().includes(q) || (i.customerPhone || '').includes(q)).slice(0, 40);
        return `<div class="fade-in" style="padding:12px 16px 40px"><input class="search-input" id="rtSearch" data-in="rt-q" type="search" placeholder="Find bill: number, customer or phone" value="${h(R.q)}" autocomplete="off">
          <div id="rtList">${rtList(l)}</div></div>`;
      }
      const i = R.inv, done = C().returnedQty(i.id), ln = i.items.filter(it => (it.qty - (done[it.productId] || 0)) > 0.0001);
      const t = rtTotals();
      return `<div class="fade-in" style="padding:12px 16px 100px"><div class="doc-card"><b>${h(i.number)}</b> · ${h(i.customerName)} · ${C().formatDate(i.date)}<div class="text-sm text-secondary">Paid ${cur()} ${m(i.paidAmount)} of ${m(i.total)} <a data-action="rt-back" style="margin-left:8px">change bill</a></div></div>
        ${ln.length ? `<div class="doc-card"><div class="doc-label">Items coming back</div>${ln.map(it => { const left = r2(it.qty - (done[it.productId] || 0)); return `<div class="pz-line"><div class="pz-ln"><b>${h(it.name)}</b><small>${cur()} ${m(it.price)} · can return up to ${left}</small></div><div class="pz-q"><button data-action="rt-dec" data-id="${it.productId}">−</button><input type="number" min="0" max="${left}" step="any" value="${R.qty[it.productId] || 0}" data-in="rt-qty" data-id="${it.productId}" data-max="${left}"><button data-action="rt-inc" data-id="${it.productId}" data-max="${left}">+</button></div></div>`; }).join('')}</div>` : empty('Everything on this bill was already returned')}
        <div class="doc-card"><div class="doc-label">Reason</div><div class="chip-row">${REASONS.map(x => `<button class="cat-chip${R.reason === x ? ' active' : ''}" data-action="rt-reason" data-v="${h(x)}">${x}</button>`).join('')}</div>
          <label class="check-row"><input type="checkbox" data-ch="rt-restock" ${R.restock ? 'checked' : ''}> Put items back in stock</label></div>
        <div class="doc-card"><div class="doc-label">What happens to the money</div><div class="chip-row"><button class="cat-chip${R.mode === 'cash' ? ' active' : ''}" data-action="rt-mode" data-v="cash">Refund money</button><button class="cat-chip${R.mode === 'account' ? ' active' : ''}" data-action="rt-mode" data-v="account">Adjust customer account</button><button class="cat-chip${R.mode === 'exchange' ? ' active' : ''}" data-action="rt-mode" data-v="exchange">Exchange for other items</button></div>
          ${R.mode === 'cash' ? `<div class="chip-row" style="margin-top:8px">${['Cash', 'Bank', 'Online'].map(x => `<button class="cat-chip${R.pm === x ? ' active' : ''}" data-action="rt-pm" data-v="${x}">${x}</button>`).join('')}</div>` : ''}
          <div class="text-sm text-secondary" style="margin-top:8px" id="rtNote">${rtNote(t)}</div></div>
        <div class="pos-cart"><div class="pos-cart-info"><span>Return value</span><strong id="rtTot">${cur()} ${m(t.total)}</strong></div><button class="btn btn-primary" data-action="rt-confirm">${R.mode === 'exchange' ? 'Return & choose new items' : 'Confirm return'}</button></div></div>`;
    },
    bind() { }
  };
  function rtList(l) { return l.length ? l.map(i => `<div class="list-row" data-action="rt-pick" data-id="${i.id}"><div class="list-row-left"><div><div class="list-row-label">${h(i.number)} · ${h(i.customerName)}</div><div class="text-sm text-secondary">${C().formatDate(i.date)} · ${i.items.length} items</div></div></div><b>${cur()} ${m(i.total)}</b></div>`).join('') : empty('No bills found'); }
  E.inputs['rt-q'] = el => { R.q = el.value; const q = R.q.trim().toLowerCase(); document.getElementById('rtList').innerHTML = rtList(saleDocs().filter(i => !q || String(i.number).toLowerCase().includes(q) || (i.customerName || '').toLowerCase().includes(q) || (i.customerPhone || '').includes(q)).slice(0, 40)); };
  function rtTotals() {
    const i = R.inv; if (!i) return { total: 0, sub: 0, disc: 0, refundable: 0 };
    const sub0 = (i.meta && i.meta.subtotal) || i.items.reduce((a, x) => a + x.price * x.qty, 0), ratio = sub0 > 0 ? Math.min(1, ((i.meta && i.meta.discount) || 0) / sub0) : 0;
    const sub = sumBy(i.items, it => (R.qty[it.productId] || 0) * it.price), disc = r2(sub * ratio);
    const tax = (i.meta && i.meta.tax && sub0 > 0) ? r2((sub - disc) * ((i.meta.tax) / Math.max(1, sub0 - ((i.meta && i.meta.discount) || 0)))) : 0;
    const total = r2(sub - disc + (i.meta && i.meta.inclTax ? 0 : tax));
    const prior = sumBy(C().invoices.filter(x => x.docType === 'return' && x.meta && x.meta.refId === i.id), x => x.paidAmount);
    return { total, sub, disc, tax, refundable: Math.max(0, r2((i.paidAmount || 0) - prior)) };
  }
  function rtNote(t) {
    if (R.mode === 'cash') { const pay = Math.min(t.total, t.refundable); return pay >= t.total - 0.001 ? `Hand back ${cur()} ${m(t.total)}.` : `Customer paid ${cur()} ${m(t.refundable)} so far: refund ${cur()} ${m(pay)}, and ${cur()} ${m(r2(t.total - pay))} is taken off what they still owe.`; }
    if (R.mode === 'account') return 'Nothing is paid out. The amount reduces what the customer owes (or stays as credit).';
    return 'Nothing is paid out. The value becomes credit on the next bill you make now.';
  }
  A['rt-pick'] = t => { R.inv = C().invoices.find(x => x.id === t.dataset.id) || null; R.qty = {}; R.mode = (R.inv && R.inv.customerId) ? 'cash' : 'cash'; R.exchange = false; redraw(); };
  A['rt-back'] = () => { R.inv = null; redraw(); };
  const rtUpd = () => { const t = rtTotals(); const a = document.getElementById('rtTot'), n = document.getElementById('rtNote'); if (a) a.textContent = cur() + ' ' + m(t.total); if (n) n.textContent = rtNote(t); };
  A['rt-inc'] = t => { const k = t.dataset.id; R.qty[k] = Math.min(+t.dataset.max, r2((R.qty[k] || 0) + 1)); const i = document.querySelector(`input[data-in="rt-qty"][data-id="${k}"]`); if (i) i.value = R.qty[k]; rtUpd(); };
  A['rt-dec'] = t => { const k = t.dataset.id; R.qty[k] = Math.max(0, r2((R.qty[k] || 0) - 1)); const i = document.querySelector(`input[data-in="rt-qty"][data-id="${k}"]`); if (i) i.value = R.qty[k]; rtUpd(); };
  E.inputs['rt-qty'] = el => { const mx = parseFloat(el.dataset.max) || 0; R.qty[el.dataset.id] = Math.max(0, Math.min(mx, parseFloat(el.value) || 0)); rtUpd(); };
  E.inputs['rt-restock'] = el => { R.restock = el.checked; };
  A['rt-reason'] = t => { R.reason = t.dataset.v; R.restock = !/Damaged|Expired/.test(R.reason); redraw(); };
  A['rt-mode'] = t => { R.mode = t.dataset.v; redraw(); };
  A['rt-pm'] = t => { R.pm = t.dataset.v; redraw(); };
  A['rt-confirm'] = async () => {
    const c = C(), i = R.inv, t = rtTotals(); if (!i) return;
    const lines = i.items.filter(it => (R.qty[it.productId] || 0) > 0).map(it => ({ productId: it.productId, name: it.name, price: it.price, cost: it.cost, qty: R.qty[it.productId] }));
    if (!lines.length) return toast('Choose what is coming back');
    if (!c.can('returns') && !(await E.approve('returns', 'return'))) return;
    if (R.mode !== 'cash' && !i.customerId && R.mode === 'account') return toast('Walk-in bills can only be refunded or exchanged');
    const now = new Date().toISOString(), number = c.nextDocNumber('CN');
    let paid = 0;
    if (R.mode === 'cash') paid = Math.min(t.total, t.refundable); else if (R.mode === 'exchange') paid = t.total;
    const pm = R.mode === 'exchange' ? 'Exchange' : (paid > 0 ? R.pm : '');
    lines.forEach(l => { if (!R.restock) return; const p = c.products.find(x => x.id === l.productId); if (!p) return; p.stock = r2((Number(p.stock) || 0) + l.qty); try { E.onStock(p, l.qty, 'return'); } catch (e) {} c.stockMovements.unshift({ id: c.uid(), productId: l.productId, productName: l.name, type: 'in', qty: l.qty, date: now, note: 'Return ' + number }); });
    if (!R.restock) lines.forEach(l => c.stockMovements.unshift({ id: c.uid(), productId: l.productId, productName: l.name, type: 'out', qty: 0, date: now, note: 'Adjust: Return ' + number + ' not restocked (' + R.reason + ')' }));
    const meta = { subtotal: t.sub, discount: t.disc, discType: 'amt', discValue: t.disc, taxName: 'Tax', taxRate: (i.meta && i.meta.taxRate) || 0, taxType: (i.meta && i.meta.taxType) || 'pct', tax: t.tax || 0, inclTax: !!(i.meta && i.meta.inclTax), chargeLabel: '', charges: 0, roundOff: 0, paymentMode: pm, refId: i.id, refNumber: i.number, reason: R.reason, restock: !!R.restock, refundMode: R.mode };
    if (R.mode === 'exchange') meta.exchangePending = true;
    if (c.isStaff()) meta.by = c.staffName();
    E.stamp(meta);
    const cn = { id: c.uid(), number, docType: 'return', customerId: i.customerId || null, customerName: i.customerName, customerPhone: i.customerPhone || '', items: lines, total: t.total, paymentStatus: paid >= t.total - 0.001 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid'), paidAmount: paid, meta, date: now };
    E.audit('return', `${number} ${cur()} ${m(t.total)} (${R.mode}, ${R.reason}) for ${i.number}`);
    c.invoices.unshift(cn); c.persist();
    const keep = { name: i.customerId ? i.customerName : '', phone: i.customerPhone || '' };
    R.inv = null; R.qty = {};
    if (cn.meta.refundMode === 'exchange') { toast('Return saved. Add the new items'); E.loadPos({ name: keep.name, phone: keep.phone, exchange: { amount: t.total, ref: number } }); return; }
    toast('Return saved ' + number); go('returns'); c.openInvoiceDetail(cn);
  };
  E.perms['rt-confirm'] = null;

  // ======================= Daily closing report =======================
  const DR = { day: today(), branch: null };
  E.DR = DR;
  function dayWin(d) { return [new Date(d + 'T00:00:00').toISOString(), new Date(d + 'T23:59:59.999').toISOString()]; }
  function dayReport(d) {
    const c = C(), [f, t] = dayWin(d), bid = DR.branch || null, st = shiftStats(f, t, null, bid), F = new Date(f).getTime(), T = new Date(t).getTime();
    const inW = x => { const v = c.ts(x.date); return v >= F && v <= T && (!bid || ((x.meta && x.meta.branchId) || 'main') === bid); };
    const sales = saleDocs().filter(inW), rets = c.invoices.filter(i => i.docType === 'return').filter(inW);
    const prof = l => sumBy(l, i => sumBy(i.items, it => (it.price - (it.cost || 0)) * it.qty) - ((i.meta && i.meta.discount) || 0));
    const gp = r2(prof(sales) - prof(rets)), top = {};
    sales.forEach(i => i.items.forEach(it => { const o = top[it.name] || (top[it.name] = { q: 0, v: 0 }); o.q += it.qty; o.v += it.qty * it.price; }));
    const topL = Object.keys(top).map(k => ({ n: k, q: r2(top[k].q), v: r2(top[k].v) })).sort((a, b) => b.v - a.v).slice(0, 5);
    const collected = sumBy(c.cashEntries().filter(r => r.t >= F && r.t <= T && r.dir === 'in' && r.mode !== 'Exchange' && (!bid || r.br === bid)), r => r.amount);
    const exp = sumBy(c.cashEntries().filter(r => r.t >= F && r.t <= T && /^Expense/.test(r.text) && (!bid || r.br === bid)), r => r.amount);
    return { st, gp, exp, net: r2(gp - exp), topL, collected };
  }
  function drText(d, r) {
    const k = r.st, b = k.byMode;
    return [`*${S().businessName || 'Billaura'}* · Daily report`, new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' }), '',
      `Sales: ${k.count} bills · ${cur()} ${m(k.total)}`, k.discount ? `Discounts: ${m(k.discount)}` : '', `Returns: ${m(k.returns)}`, `Net sales: *${cur()} ${m(r2(k.total - k.returns))}*`, `Gross profit: ${m(r.gp)}`, `Expenses: ${m(r.exp)}`, `Net profit: *${cur()} ${m(r.net)}*`, '',
      `Money received: *${cur()} ${m(r.collected)}*`, ...Object.keys(b).filter(x => x !== 'Exchange').map(x => `  ${x}: +${m(b[x].i)}${b[x].o ? ' −' + m(b[x].o) : ''}`), k.onAccount ? `On account (udhaar): ${m(k.onAccount)}` : '', '',
      r.topL.length ? 'Top items:' : '', ...r.topL.map(x => `  ${x.n} ×${x.q} = ${m(x.v)}`)].filter((x, i, a) => !(x === '' && (i === 0 || a[i - 1] === '')));
  }
  E.views['daily-report'] = {
    title: 'Daily Closing Report', perm: 'reports',
    right: () => `<button class="icon-btn" data-action="dr-share" aria-label="Share">${C().ico('share')}</button>`,
    html() {
      const r = dayReport(DR.day), k = r.st, tr = (l, v, st) => `<div class="tot-row"><span>${l}</span><b${st ? ` style="${st}"` : ''}>${v}</b></div>`;
      return `<div class="fade-in" style="padding:12px 16px 40px">${E.branchChips ? E.branchChips() : ''}<div class="chip-row"><button class="cat-chip${DR.day === today() ? ' active' : ''}" data-action="dr-day" data-v="0">Today</button><button class="cat-chip" data-action="dr-day" data-v="1">Yesterday</button><input type="date" class="form-input" style="width:auto;padding:6px 10px" value="${DR.day}" max="${today()}" data-ch="dr-date"></div>
        <div class="stats-grid" style="grid-template-columns:repeat(2,1fr)"><div class="stat-card"><div class="stat-label">Net sales</div><div class="stat-value" style="font-size:1.1rem">${cur()} ${m(r2(k.total - k.returns))}</div></div><div class="stat-card"><div class="stat-label">Net profit</div><div class="stat-value ${r.net >= 0 ? 'success' : 'danger'}" style="font-size:1.1rem">${cur()} ${m(r.net)}</div></div></div>
        <div class="doc-card">${tr('Bills', k.count)}${tr('Gross sales', cur() + ' ' + m(k.total))}${k.discount ? tr('Discounts given', m(k.discount)) : ''}${tr('Returns', '− ' + m(k.returns))}${tr('Gross profit', m(r.gp))}${tr('Expenses', '− ' + m(r.exp))}${k.onAccount ? tr('Went on account (udhaar)', m(k.onAccount)) : ''}</div>
        <div class="doc-card"><div class="doc-label">Money received today</div>${tr('Total', cur() + ' ' + m(r.collected), 'font-size:1.05rem')}${Object.keys(k.byMode).filter(x => x !== 'Exchange').map(x => tr(x, `<span style="color:var(--success)">+${m(k.byMode[x].i)}</span>${k.byMode[x].o ? ` <span style="color:var(--danger)">−${m(k.byMode[x].o)}</span>` : ''}`)).join('')}</div>
        ${r.topL.length ? `<div class="doc-card"><div class="doc-label">Top items</div>${r.topL.map(x => tr(h(x.n) + ' ×' + x.q, m(x.v))).join('')}</div>` : ''}
        <div class="text-sm text-secondary" style="margin-top:8px">Profit uses each item's saved purchase cost. Money received includes old bills paid today.</div></div>`;
    }
  };
  A['dr-day'] = t => { const d = new Date(); d.setDate(d.getDate() - +t.dataset.v); DR.day = d.toISOString().slice(0, 10); redraw(); };
  E.inputs['dr-date'] = el => { if (el.value) { DR.day = el.value; redraw(); } };
  A['dr-share'] = () => shareAny(drText(DR.day, dayReport(DR.day)).join('\n'));

  // ======================= Buy-today list =======================
  const BY = { sel: null };
  function lastSupplier(pid) { const c = C(); const p = c.purchases.slice().sort((a, b) => c.ts(b.date) - c.ts(a.date)).find(x => (x.items || []).some(i => i.productId === pid)); return p ? { id: p.supplierId, name: p.supplierName, phone: p.supplierPhone || '' } : null; }
  function buyList() {
    const c = C(), cover = S().coverDays || 7, since = Date.now() - 30 * 864e5, sold = {};
    c.invoices.forEach(i => { if (i.docType === 'estimate') return; const sg = i.docType === 'return' ? -1 : 1; if (c.ts(i.date) < since) return; (i.items || []).forEach(it => { sold[it.productId] = (sold[it.productId] || 0) + sg * it.qty; }); });
    return c.products.map(p => {
      const stock = Number(p.stock) || 0, v = Math.max(0, (sold[p.id] || 0)) / 30, low = c.lowLimit(p), left = v > 0 ? stock / v : Infinity;
      if (!(stock <= low || left < cover)) return null;
      const need = Math.max(1, Math.ceil(v * cover + low - stock));
      return { p, stock, v: r2(v), left: isFinite(left) ? Math.floor(left) : null, qty: need, sup: lastSupplier(p.id) };
    }).filter(Boolean).sort((a, b) => (a.left == null ? -1 : a.left) - (b.left == null ? -1 : b.left) || a.stock - b.stock);
  }
  E.views['buy-today'] = {
    title: 'Buy Today List', perm: 'purchases',
    html() {
      const l = buyList(); if (!BY.sel) BY.sel = {}; l.forEach(x => { if (!(x.p.id in BY.sel)) BY.sel[x.p.id] = x.qty; });
      const groups = {}; l.forEach(x => { const k = (x.sup && x.sup.name) || 'No supplier yet'; (groups[k] = groups[k] || []).push(x); });
      const cv = S().coverDays || 7;
      return `<div class="fade-in" style="padding:12px 16px 100px"><div class="doc-card"><div class="text-sm text-secondary">Items that are low or will run out within <b>${cv} days</b> at the speed you sold them in the last 30 days.</div><div class="chip-row" style="margin-top:8px">${[3, 7, 14, 30].map(d => `<button class="cat-chip${cv === d ? ' active' : ''}" data-action="by-cover" data-v="${d}">${d} days</button>`).join('')}</div></div>
        ${l.length ? Object.keys(groups).map(g => `<div class="section-header"><h2 class="section-title">${h(g)}</h2></div><div class="list-group">${groups[g].map(x => `<div class="list-row" style="cursor:default;gap:8px"><div class="list-row-left" style="min-width:0"><div style="min-width:0"><div class="list-row-label">${h(x.p.name)}</div><div class="text-sm text-secondary">Stock ${x.stock} · sells ${x.v}/day${x.left != null ? ' · ~' + x.left + ' days left' : ''}</div></div></div><input type="number" min="0" step="any" class="form-input" style="width:78px;padding:8px" value="${BY.sel[x.p.id]}" data-in="by-qty" data-id="${x.p.id}"></div>`).join('')}</div>`).join('') : empty('Nothing to buy. Stock looks fine. ✅')}
        ${l.length ? `<div class="pos-cart"><button class="btn btn-outline" style="flex:1" data-action="by-share">Share list</button><button class="btn btn-primary" style="flex:1" data-action="by-po">Make purchase orders</button></div>` : ''}</div>`;
    }
  };
  E.inputs['by-qty'] = el => { BY.sel[el.dataset.id] = Math.max(0, parseFloat(el.value) || 0); };
  A['by-cover'] = t => { S().coverDays = +t.dataset.v; BY.sel = null; C().persist(); redraw(); };
  A['by-share'] = () => { const l = buyList().filter(x => (BY.sel[x.p.id] || 0) > 0); shareAny(`*Buy list* · ${new Date().toLocaleDateString('en-GB')}\n\n` + l.map(x => `• ${x.p.name} × ${BY.sel[x.p.id]}${x.sup && x.sup.name ? ' (' + x.sup.name + ')' : ''}`).join('\n')); };
  A['by-po'] = () => {
    const l = buyList().filter(x => (BY.sel[x.p.id] || 0) > 0); if (!l.length) return toast('Nothing selected');
    const g = {}; l.forEach(x => { const k = (x.sup && x.sup.name) || ''; (g[k] = g[k] || { sup: x.sup, lines: [] }).lines.push({ productId: x.p.id, name: x.p.name, qty: BY.sel[x.p.id], cost: Number(x.p.cost) || 0, received: 0 }); });
    Object.keys(g).forEach(k => arr('purchaseOrders').unshift({ id: C().uid(), number: nextPoNumber(), supplierId: (g[k].sup && g[k].sup.id) || null, supplierName: k, supplierPhone: (g[k].sup && g[k].sup.phone) || '', date: new Date().toISOString(), expected: '', status: 'open', note: 'From buy-today list', lines: g[k].lines }));
    C().persist(); BY.sel = null; toast(Object.keys(g).length + ' purchase order(s) created'); go('po-list');
  };

  // ======================= Purchase orders & GRN =======================
  function nextPoNumber() { let mx = 1000; arr('purchaseOrders').forEach(p => { const x = String(p.number).match(/(\d+)\s*$/); if (x) mx = Math.max(mx, +x[1]); }); return 'PO-' + (mx + 1); }
  const poTotal = p => sumBy(p.lines, l => l.qty * l.cost);
  const poBadge = p => ({ open: ['Open', 'badge-low'], partial: ['Partly received', 'badge-low'], received: ['Received', 'badge-ok'], cancelled: ['Cancelled', 'badge-out'] }[p.status] || ['Open', 'badge-low']);
  const POF = { f: 'open' };
  E.views['po-list'] = {
    title: 'Purchase Orders', perm: 'purchases',
    right: () => `<button class="icon-btn" data-action="po-new" aria-label="New">${C().ico('plus') || '+'}</button>`,
    html() {
      const all = arr('purchaseOrders'), l = all.filter(p => POF.f === 'all' ? true : POF.f === 'open' ? (p.status === 'open' || p.status === 'partial') : p.status === POF.f);
      return `<div class="fade-in" style="padding:12px 16px 40px"><div class="chip-row">${[['open', 'To receive'], ['received', 'Received'], ['all', 'All']].map(x => `<button class="cat-chip${POF.f === x[0] ? ' active' : ''}" data-action="po-f" data-v="${x[0]}">${x[1]}</button>`).join('')}</div>
        ${l.length ? l.map(p => { const b = poBadge(p); return `<div class="list-row" data-action="po-open" data-id="${p.id}"><div class="list-row-left"><div><div class="list-row-label">${h(p.number)} · ${h(p.supplierName || 'No supplier')}</div><div class="text-sm text-secondary">${C().formatDate(p.date)} · ${p.lines.length} items${p.expected ? ' · due ' + p.expected : ''}</div></div></div><div style="text-align:right"><b>${cur()} ${m(poTotal(p))}</b><br><span class="list-item-badge ${b[1]}">${b[0]}</span></div></div>`; }).join('') : empty('No purchase orders here.<br>Tap + to make one, or use the Buy Today list.')}</div>`;
    }
  };
  A['po-f'] = t => { POF.f = t.dataset.v; redraw(); };
  let PO = null;
  A['po-new'] = () => { PO = { supplierName: '', supplierPhone: '', expected: '', note: '', lines: [] }; go('po-edit'); };
  E.views['po-edit'] = {
    title: () => PO && PO.id ? 'Edit ' + PO.number : 'New Purchase Order', perm: 'purchases',
    html() {
      if (!PO) PO = { supplierName: '', supplierPhone: '', expected: '', note: '', lines: [] };
      return `<div class="fade-in" style="padding:12px 16px 100px"><div class="doc-card"><label class="form-label">Supplier</label><input class="form-input" id="poSup" list="poSupL" value="${h(PO.supplierName)}" placeholder="Supplier name" data-in="po-sup" autocomplete="off"><datalist id="poSupL">${C().suppliers.map(x => `<option value="${h(x.name)}">`).join('')}</datalist>
        <div class="form-row" style="margin-top:8px"><div class="form-group"><label class="form-label">Phone (WhatsApp)</label><input class="form-input" id="poPh" type="tel" value="${h(PO.supplierPhone)}"></div><div class="form-group"><label class="form-label">Expected on</label><input class="form-input" id="poExp" type="date" value="${h(PO.expected)}"></div></div></div>
        <div class="doc-card"><div class="doc-label">Items</div><input class="search-input" id="poQ" data-in="po-q" type="search" placeholder="Search item to add…" autocomplete="off"><div id="poRes"></div><div id="poLines">${poLines()}</div></div>
        <div class="doc-card"><input class="form-input" id="poNote" placeholder="Note to supplier (optional)" value="${h(PO.note)}" maxlength="120"></div>
        <div class="pos-cart"><div class="pos-cart-info"><span>Total</span><strong id="poTot">${cur()} ${m(poTotal(PO))}</strong></div><button class="btn btn-primary" data-action="po-save">Save order</button></div></div>`;
    }
  };
  function poLines() { return PO.lines.length ? PO.lines.map((l, i) => `<div class="pz-line"><div class="pz-ln"><b>${h(l.name)}</b><small>Cost <input type="number" min="0" step="any" class="pz-pr" style="position:static;width:80px" value="${l.cost}" data-in="po-cost" data-i="${i}"></small></div><div class="pz-q"><button data-action="po-dec" data-i="${i}">−</button><input type="number" min="0" step="any" value="${l.qty}" data-in="po-qty" data-i="${i}"><button data-action="po-inc" data-i="${i}">+</button></div><div class="pz-amt">${m(l.qty * l.cost)}</div><button class="pz-x" data-action="po-rm" data-i="${i}">✕</button></div>`).join('') : '<div class="text-sm text-secondary" style="padding:8px 0">No items yet</div>'; }
  const poRedraw = () => { const a = document.getElementById('poLines'), b = document.getElementById('poTot'); if (a) a.innerHTML = poLines(); if (b) b.textContent = cur() + ' ' + m(poTotal(PO)); };
  const poKeep = () => { if (!PO) return; PO.supplierName = val('poSup') || PO.supplierName; PO.supplierPhone = val('poPh') || ''; PO.expected = val('poExp') || ''; PO.note = val('poNote') || ''; };
  E.inputs['po-sup'] = el => { const s = C().suppliers.find(x => x.name.toLowerCase() === el.value.trim().toLowerCase()); if (s) { PO.supplierId = s.id; const ph = document.getElementById('poPh'); if (ph && !ph.value) ph.value = s.phone || ''; } };
  E.inputs['po-q'] = el => { const q = el.value.trim().toLowerCase(), r = document.getElementById('poRes'); if (!q) { r.innerHTML = ''; return; } r.innerHTML = C().products.filter(p => p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase() === q).slice(0, 6).map(p => `<div class="list-row" data-action="po-add" data-id="${p.id}"><div class="list-row-left"><div class="list-row-label">${h(p.name)}</div></div><span class="text-sm text-secondary">stock ${p.stock}</span></div>`).join('') || '<div class="text-sm text-secondary" style="padding:6px">No match</div>'; };
  A['po-add'] = t => { const p = C().products.find(x => x.id === t.dataset.id); if (!p) return; poKeep(); const l = PO.lines.find(x => x.productId === p.id); if (l) l.qty++; else PO.lines.push({ productId: p.id, name: p.name, qty: 1, cost: Number(p.cost) || 0, received: 0 }); const q = document.getElementById('poQ'); if (q) q.value = ''; document.getElementById('poRes').innerHTML = ''; poRedraw(); };
  E.inputs['po-qty'] = el => { PO.lines[+el.dataset.i].qty = Math.max(0, parseFloat(el.value) || 0); const b = document.getElementById('poTot'); if (b) b.textContent = cur() + ' ' + m(poTotal(PO)); };
  E.inputs['po-cost'] = el => { PO.lines[+el.dataset.i].cost = Math.max(0, parseFloat(el.value) || 0); const b = document.getElementById('poTot'); if (b) b.textContent = cur() + ' ' + m(poTotal(PO)); };
  A['po-inc'] = t => { PO.lines[+t.dataset.i].qty++; poRedraw(); }; A['po-dec'] = t => { const l = PO.lines[+t.dataset.i]; l.qty = Math.max(0, l.qty - 1); poRedraw(); }; A['po-rm'] = t => { PO.lines.splice(+t.dataset.i, 1); poRedraw(); };
  A['po-save'] = () => {
    poKeep(); PO.lines = PO.lines.filter(l => l.qty > 0); if (!PO.lines.length) return toast('Add at least one item'); if (!PO.supplierName.trim()) return toast('Enter the supplier');
    const s = C().suppliers.find(x => x.name.toLowerCase() === PO.supplierName.trim().toLowerCase()); PO.supplierId = s ? s.id : null; PO.supplierName = s ? s.name : PO.supplierName.trim();
    if (PO.id) { const i = arr('purchaseOrders').findIndex(x => x.id === PO.id); if (i >= 0) S().purchaseOrders[i] = PO; }
    else { PO.id = C().uid(); PO.number = nextPoNumber(); PO.date = new Date().toISOString(); PO.status = 'open'; arr('purchaseOrders').unshift(PO); }
    const saved = PO; PO = null; C().persist(); toast('Saved ' + saved.number); go('po-list'); setTimeout(() => A['po-open']({ dataset: { id: saved.id } }), 250);
  };
  const poText = p => `*Purchase Order ${p.number}*\n${S().businessName || ''}\n${C().formatDate(p.date)}${p.expected ? '\nNeeded by: ' + p.expected : ''}\n\n` + p.lines.map(l => `• ${l.name} × ${l.qty}${l.cost ? ' @ ' + m(l.cost) : ''}`).join('\n') + `\n\nTotal: ${cur()} ${m(poTotal(p))}${p.note ? '\n' + p.note : ''}`;
  A['po-open'] = t => {
    const p = arr('purchaseOrders').find(x => x.id === t.dataset.id); if (!p) return; const b = poBadge(p), open = p.status === 'open' || p.status === 'partial';
    modal(h(p.number), `<div class="modal-body"><div class="text-sm text-secondary">${h(p.supplierName)} · ${C().formatDate(p.date)} · <span class="list-item-badge ${b[1]}">${b[0]}</span></div>
      <div class="doc-card" style="margin:10px 0">${p.lines.map(l => `<div class="tot-row"><span>${h(l.name)} × ${l.qty}${l.received ? ' <small>(got ' + l.received + ')</small>' : ''}</span><b>${m(l.qty * l.cost)}</b></div>`).join('')}<div class="tot-row"><span><b>Total</b></span><b>${cur()} ${m(poTotal(p))}</b></div></div>
      <div class="form-row"><button class="btn btn-outline" data-action="po-wa" data-id="${p.id}">Send to supplier</button>${open ? `<button class="btn btn-primary" data-action="po-recv" data-id="${p.id}">Receive goods</button>` : ''}</div>
      ${open ? `<div class="form-row" style="margin-top:8px"><button class="btn btn-secondary" data-action="po-edit" data-id="${p.id}">Edit</button><button class="btn btn-secondary" data-action="po-cancel" data-id="${p.id}">Cancel order</button></div>` : ''}</div>`);
  };
  A['po-wa'] = t => { const p = arr('purchaseOrders').find(x => x.id === t.dataset.id); if (!p) return; const ph = p.supplierPhone || (C().suppliers.find(x => x.id === p.supplierId) || {}).phone; if (ph) C().sendWhatsApp(ph, poText(p)); else shareAny(poText(p)); };
  A['po-edit'] = t => { const p = arr('purchaseOrders').find(x => x.id === t.dataset.id); if (!p) return; PO = JSON.parse(JSON.stringify(p)); close(); go('po-edit'); };
  A['po-cancel'] = async t => { const p = arr('purchaseOrders').find(x => x.id === t.dataset.id); if (!p) return; if (!(await C().askConfirm('Cancel ' + p.number + '?'))) return; p.status = 'cancelled'; C().persist(); close(); redraw(); };
  A['po-recv'] = t => {
    const p = arr('purchaseOrders').find(x => x.id === t.dataset.id); if (!p) return; const todo = p.lines.filter(l => l.qty - (l.received || 0) > 0.0001);
    modal('Receive goods', `<div class="modal-body" style="max-height:70vh;overflow:auto"><div class="text-sm text-secondary">Enter what actually arrived. Leave batch and expiry empty if the item does not have them.</div>
      ${todo.map(l => { const left = r2(l.qty - (l.received || 0)); return `<div class="doc-card" style="margin:8px 0"><b>${h(l.name)}</b> <small>(ordered ${l.qty}, waiting ${left})</small><div class="form-row" style="margin-top:6px"><div class="form-group"><label class="form-label">Received</label><input class="form-input rv-q" type="number" min="0" step="any" value="${left}" data-id="${l.productId}"></div><div class="form-group"><label class="form-label">Cost each</label><input class="form-input rv-c" type="number" min="0" step="any" value="${l.cost}" data-id="${l.productId}"></div></div><div class="form-row"><input class="form-input rv-b" placeholder="Batch no" data-id="${l.productId}"><input class="form-input rv-e" type="date" data-id="${l.productId}" title="Expiry"></div></div>`; }).join('')}
      <div class="form-row"><div class="form-group"><label class="form-label">Supplier bill no</label><input class="form-input" id="rvBill"></div><div class="form-group"><label class="form-label">Paid now</label><input class="form-input" id="rvPaid" type="number" min="0" step="any" placeholder="0"></div></div>
      <div class="chip-row" id="rvMode">${['Cash', 'Bank', 'Online', 'Cheque'].map((x, i) => `<button class="cat-chip${i ? '' : ' active'}" data-action="rv-mode" data-v="${x}">${x}</button>`).join('')}</div>
      <button class="btn btn-primary btn-block" style="margin-top:10px" data-action="rv-ok" data-id="${p.id}">Save received goods</button></div>`);
  };
  A['rv-mode'] = t => document.querySelectorAll('#rvMode .cat-chip').forEach(b => b.classList.toggle('active', b === t));
  A['rv-ok'] = () => {
    const c = C(), po = arr('purchaseOrders').find(x => x.id === (document.querySelector('[data-action="rv-ok"]') || {}).dataset.id); if (!po) return;
    const got = []; document.querySelectorAll('.rv-q').forEach(i => { const id = i.dataset.id, q = parseFloat(i.value) || 0; if (q <= 0) return; const q2 = s => (document.querySelector(`.${s}[data-id="${id}"]`) || {}).value || ''; got.push({ id, qty: q, cost: parseFloat(q2('rv-c')) || 0, batch: q2('rv-b').trim(), exp: q2('rv-e') }); });
    if (!got.length) return toast('Nothing received');
    const now = new Date().toISOString(), number = c.nextPurNumber();
    let sup = c.suppliers.find(x => x.id === po.supplierId) || c.suppliers.find(x => x.name.toLowerCase() === (po.supplierName || '').toLowerCase());
    if (!sup && po.supplierName) { if (!c.enforceLimit('suppliers', c.suppliers.length)) return; sup = { id: c.uid(), name: po.supplierName, phone: po.supplierPhone || '', notes: '' }; c.suppliers.push(sup); }
    const items = got.map(g => { const l = po.lines.find(x => x.productId === g.id), p = c.products.find(x => x.id === g.id); l.received = r2((l.received || 0) + g.qty); if (p) { p.stock = r2((Number(p.stock) || 0) + g.qty); if (g.cost > 0) p.cost = g.cost; if (g.batch || g.exp) bat(p.id).push({ no: g.batch, exp: g.exp, qty: g.qty }); c.stockMovements.unshift({ id: c.uid(), productId: g.id, productName: p.name, type: 'in', qty: g.qty, date: now, note: `GRN ${number} (${po.number})` }); } return { productId: g.id, name: l.name, price: g.cost, qty: g.qty }; });
    const total = sumBy(items, i => i.price * i.qty), paid = Math.min(total, Math.max(0, num('rvPaid'))), mode = (document.querySelector('#rvMode .active') || {}).dataset ? document.querySelector('#rvMode .active').dataset.v : 'Cash';
    const meta = { subtotal: total, discount: 0, discType: 'amt', discValue: 0, taxName: 'Tax', taxRate: 0, taxType: 'pct', tax: 0, chargeLabel: '', charges: 0, roundOff: 0, paymentMode: paid > 0 ? mode : '', poId: po.id, poNumber: po.number, grn: 1 };
    const bn = val('rvBill').trim(); if (bn) meta.billNo = bn;
    E.stamp(meta);
    const pur = { id: c.uid(), number, supplierId: sup ? sup.id : null, supplierName: po.supplierName || '', supplierPhone: po.supplierPhone || '', items, total, paymentStatus: paid >= total - 0.001 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid'), paidAmount: paid, meta, date: now };
    c.savePurchase(pur);
    po.status = po.lines.every(l => (l.received || 0) >= l.qty - 0.0001) ? 'received' : 'partial';
    E.audit('purchase', `Received goods ${number} (${po.number}) ${cur()} ${m(total)}`); c.persist(); close(); toast('Stock added · ' + number); redraw();
  };

  // ======================= Stock count =======================
  const SC = { q: '', cat: 'all' };
  const draft = () => (S().countDraft = S().countDraft || { id: C().uid(), startedAt: new Date().toISOString(), counts: {} });
  E.views['stock-count'] = {
    title: 'Stock Count', perm: 'items_edit',
    right: () => `<button class="btn btn-outline btn-sm" data-view="stock-losses">Losses</button>`,
    html() {
      const c = C(), d = draft(), cats = [...new Set(c.products.map(p => p.category).filter(Boolean))];
      const l = c.products.filter(p => (SC.cat === 'all' || (p.category || '') === SC.cat) && (!SC.q || p.name.toLowerCase().includes(SC.q.toLowerCase()) || (p.barcode || '').includes(SC.q)));
      const done = Object.keys(d.counts).length;
      return `<div class="fade-in" style="padding:12px 16px 100px"><div class="doc-card"><div class="text-sm text-secondary">Count what is on the shelf and type it in. Items you leave empty are not changed. Counted ${done} of ${c.products.length}.</div></div>
        <div class="pos-bar" style="padding:8px 0"><input class="search-input" id="scQ" data-in="sc-q" type="search" placeholder="Search or scan…" value="${h(SC.q)}" autocomplete="off"><button class="btn btn-outline btn-sm" data-action="sc-scan">Scan</button></div>
        <div class="chip-row"><button class="cat-chip${SC.cat === 'all' ? ' active' : ''}" data-action="sc-cat" data-v="all">All</button>${cats.map(k => `<button class="cat-chip${SC.cat === k ? ' active' : ''}" data-action="sc-cat" data-v="${h(k)}">${h(k)}</button>`).join('')}</div>
        <div id="scList">${scRows(l)}</div>
        <div class="pos-cart"><button class="btn btn-outline" data-action="sc-clear">Start over</button><button class="btn btn-primary" style="flex:1" data-action="sc-review" ${done ? '' : 'disabled'}>Review ${done} counted</button></div></div>`;
    }
  };
  function scRows(l) { const d = draft(); return l.slice(0, 150).map(p => { const v = d.counts[p.id], diff = v == null ? null : r2(v - (Number(p.stock) || 0)); return `<div class="list-row" style="cursor:default;gap:8px"><div class="list-row-left" style="min-width:0"><div style="min-width:0"><div class="list-row-label">${h(p.name)}</div><div class="text-sm text-secondary">System ${p.stock}${diff != null && diff !== 0 ? ` · <b style="color:var(--${diff < 0 ? 'danger' : 'success'})">${diff > 0 ? '+' : ''}${diff}</b>` : diff === 0 ? ' · ✓ matches' : ''}</div></div></div><input class="form-input" style="width:84px;padding:8px" type="number" inputmode="decimal" min="0" step="any" data-in="sc-val" data-id="${p.id}" value="${v == null ? '' : v}" placeholder="–"></div>`; }).join('') || empty('No items'); }
  E.inputs['sc-val'] = el => { const d = draft(); if (el.value === '') delete d.counts[el.dataset.id]; else d.counts[el.dataset.id] = Math.max(0, parseFloat(el.value) || 0); C().persist(); const n = Object.keys(d.counts).length, b = document.querySelector('[data-action="sc-review"]'); if (b) { b.disabled = !n; b.textContent = 'Review ' + n + ' counted'; } };
  E.inputs['sc-q'] = el => { SC.q = el.value; const c = C(); document.getElementById('scList').innerHTML = scRows(c.products.filter(p => (SC.cat === 'all' || (p.category || '') === SC.cat) && (!SC.q || p.name.toLowerCase().includes(SC.q.toLowerCase()) || (p.barcode || '').includes(SC.q)))); };
  A['sc-cat'] = t => { SC.cat = t.dataset.v; redraw(); };
  A['sc-scan'] = () => C().startScanner(code => { const p = C().products.find(x => (x.barcode || '').toLowerCase() === String(code).toLowerCase()); if (!p) return toast('Product not found'); SC.q = p.name; redraw(); toast(p.name); });
  A['sc-clear'] = async () => { if (!(await C().askConfirm('Clear all counted quantities?'))) return; S().countDraft = null; C().persist(); redraw(); };
  A['sc-review'] = () => {
    const c = C(), d = draft(), rows = Object.keys(d.counts).map(id => { const p = c.products.find(x => x.id === id); if (!p) return null; const diff = r2(d.counts[id] - (Number(p.stock) || 0)); return { p, diff, cost: Number(p.cost) || 0 }; }).filter(Boolean), ch = rows.filter(x => x.diff !== 0);
    const loss = sumBy(ch.filter(x => x.diff < 0), x => -x.diff * x.cost), gain = sumBy(ch.filter(x => x.diff > 0), x => x.diff * x.cost);
    modal('Review count', `<div class="modal-body" style="max-height:70vh;overflow:auto"><div class="text-sm text-secondary">${rows.length} counted · ${rows.length - ch.length} match · ${ch.length} differ</div>
      ${ch.length ? `<div class="doc-card" style="margin:8px 0">${ch.map(x => `<div class="tot-row"><span>${h(x.p.name)} <small>${x.p.stock} → ${d.counts[x.p.id]}</small></span><b style="color:var(--${x.diff < 0 ? 'danger' : 'success'})">${x.diff > 0 ? '+' : ''}${x.diff}</b></div>`).join('')}</div><div class="text-sm">Value short: <b style="color:var(--danger)">${cur()} ${m(loss)}</b> · extra: <b>${cur()} ${m(gain)}</b> (at cost)</div>` : '<p>Everything matches. 🎉</p>'}
      <button class="btn btn-primary btn-block" style="margin-top:12px" data-action="sc-apply">Apply to stock</button></div>`);
  };
  A['sc-apply'] = async () => {
    const c = C(), d = draft(), now = new Date().toISOString(); let n = 0, loss = 0, gain = 0;
    Object.keys(d.counts).forEach(id => { const p = c.products.find(x => x.id === id); if (!p) return; const before = Number(p.stock) || 0, after = d.counts[id], diff = r2(after - before); if (!diff) return; p.stock = after; try { E.onStock(p, diff, 'adjust'); } catch (e) {} n++; if (diff < 0) loss += -diff * (Number(p.cost) || 0); else gain += diff * (Number(p.cost) || 0); c.stockMovements.unshift({ id: c.uid(), productId: id, productName: p.name, type: diff > 0 ? 'in' : 'out', qty: Math.abs(diff), date: now, note: 'Adjust: Stock count ' + (diff > 0 ? 'found ' : 'missing ') + Math.abs(diff) }); });
    E.audit('count', `Stock count applied: ${n} items corrected, ${cur()} ${m(r2(loss))} short`); arr('counts').unshift({ id: d.id, at: now, by: c.isStaff() ? c.staffName() : 'Owner', counted: Object.keys(d.counts).length, changed: n, loss: r2(loss), gain: r2(gain) }); S().counts = S().counts.slice(0, 20); S().countDraft = null; c.persist(); close(); toast(n + ' items corrected'); redraw();
  };
  E.perms['sc-apply'] = 'items_edit';
  E.views['stock-losses'] = {
    title: 'Losses & Wastage', perm: 'items_edit',
    html() {
      const c = C(), since = Date.now() - 90 * 864e5, cost = {}; c.products.forEach(p => cost[p.id] = Number(p.cost) || 0);
      const l = c.stockMovements.filter(x => x.type === 'out' && x.qty > 0 && /^Adjust: (Damage|Lost|Expired|Stock count missing|Correction|Other)/i.test(x.note || '') && c.ts(x.date) >= since);
      const g = {}; l.forEach(x => { const k = ((x.note || '').match(/^Adjust: (Damage|Lost|Expired|Stock count|Correction|Other)/i) || [, 'Other'])[1]; const o = g[k] || (g[k] = { q: 0, v: 0 }); o.q += x.qty; o.v += x.qty * (cost[x.productId] || 0); });
      const hist = arr('counts');
      return `<div class="fade-in" style="padding:12px 16px 40px"><div class="doc-card"><div class="doc-label">Last 90 days (at cost)</div>${Object.keys(g).map(k => `<div class="tot-row"><span>${h(k)}</span><b>${cur()} ${m(r2(g[k].v))} <small>(${r2(g[k].q)} units)</small></b></div>`).join('') || '<div class="text-sm text-secondary">Nothing recorded</div>'}${Object.keys(g).length ? `<div class="tot-row"><span><b>Total lost</b></span><b style="color:var(--danger)">${cur()} ${m(sumBy(Object.values(g), x => x.v))}</b></div>` : ''}</div>
        <div class="section-header"><h2 class="section-title">Entries</h2></div>${l.slice(0, 60).map(x => `<div class="list-row" style="cursor:default"><div class="list-row-left"><div><div class="list-row-label">${h(x.productName)} × ${x.qty}</div><div class="text-sm text-secondary">${C().formatDate(x.date)} · ${h((x.note || '').replace('Adjust: ', ''))}</div></div></div><b style="color:var(--danger)">${m(x.qty * (cost[x.productId] || 0))}</b></div>`).join('') || empty('No entries')}
        ${hist.length ? `<div class="section-header"><h2 class="section-title">Past counts</h2></div>${hist.map(x => `<div class="list-row" style="cursor:default"><div class="list-row-left"><div><div class="list-row-label">${C().formatDate(x.at)} · ${x.counted} counted</div><div class="text-sm text-secondary">${x.changed} corrected · ${h(x.by)}</div></div></div><b style="color:var(--danger)">${m(x.loss)}</b></div>`).join('')}` : ''}</div>`;
    }
  };

  // ======================= Expiry & batches =======================
  const EX = { f: 'soon' };
  E.views.expiry = {
    title: 'Expiry & Batches', perm: 'items_view',
    right: () => `<button class="icon-btn" data-action="ex-add" aria-label="Add batch">${C().ico('plus') || '+'}</button>`,
    html() {
      const all = expiryList(), l = all.filter(x => EX.f === 'all' ? true : EX.f === 'expired' ? x.d < 0 : x.d >= 0 && x.d <= expDays());
      const nExp = all.filter(x => x.d < 0).length, nSoon = all.filter(x => x.d >= 0 && x.d <= expDays()).length;
      return `<div class="fade-in" style="padding:12px 16px 40px"><div class="chip-row"><button class="cat-chip${EX.f === 'expired' ? ' active' : ''}" data-action="ex-f" data-v="expired">Expired (${nExp})</button><button class="cat-chip${EX.f === 'soon' ? ' active' : ''}" data-action="ex-f" data-v="soon">Within ${expDays()} days (${nSoon})</button><button class="cat-chip${EX.f === 'all' ? ' active' : ''}" data-action="ex-f" data-v="all">All batches</button></div>
        <div class="text-sm text-secondary" style="margin:8px 0">Warn me <select class="form-select" style="width:auto;display:inline-block;padding:4px 8px" data-ch="ex-days">${[7, 15, 30, 60, 90].map(d => `<option value="${d}"${expDays() === d ? ' selected' : ''}>${d}</option>`).join('')}</select> days before expiry. Oldest batches are sold first automatically.</div>
        ${l.length ? l.map(x => `<div class="list-row" style="cursor:default"><div class="list-row-left"><div><div class="list-row-label">${h(x.p.name)}</div><div class="text-sm text-secondary">${x.b.no ? 'Batch ' + h(x.b.no) + ' · ' : ''}${h(x.b.exp)} · qty ${x.b.qty}</div></div></div><div style="text-align:right"><b style="color:var(--${x.d < 0 ? 'danger' : x.d <= 7 ? 'warning,#d97706' : 'text'})">${x.d < 0 ? 'Expired ' + (-x.d) + 'd ago' : x.d === 0 ? 'Today' : x.d + ' days'}</b>${x.d < 0 ? `<br><button class="chip-btn" data-action="ex-wo" data-p="${x.p.id}" data-i="${x.i}">Write off</button>` : ''}</div></div>`).join('') : empty('Nothing here. ✅<br>Use + to add a batch with an expiry date.')}</div>`;
    }
  };
  A['ex-f'] = t => { EX.f = t.dataset.v; redraw(); };
  E.inputs['ex-days'] = el => { S().expiryDays = +el.value; C().persist(); redraw(); };
  A['ex-add'] = () => modal('Add batch', `<div class="modal-body"><label class="form-label">Item</label><input class="form-input" id="exP" list="exPL" placeholder="Type item name" autocomplete="off"><datalist id="exPL">${C().products.map(p => `<option value="${h(p.name)}">`).join('')}</datalist>
    <div class="form-row" style="margin-top:8px"><div class="form-group"><label class="form-label">Batch no</label><input class="form-input" id="exN" placeholder="optional"></div><div class="form-group"><label class="form-label">Expiry date</label><input class="form-input" id="exD" type="date"></div></div>
    <label class="form-label">Quantity in this batch</label><input class="form-input" id="exQ" type="number" inputmode="decimal" min="0" step="any">
    <label class="check-row"><input type="checkbox" id="exIn" checked> This quantity is already counted in my stock</label><div class="text-sm text-secondary">Untick if it is new stock that should be added now.</div>
    <button class="btn btn-primary btn-block" style="margin-top:10px" data-action="ex-save">Save batch</button></div>`);
  A['ex-save'] = () => {
    const c = C(), p = c.products.find(x => x.name.toLowerCase() === val('exP').trim().toLowerCase()), q = num('exQ'), d = val('exD');
    if (!p) return toast('Choose an item from the list'); if (!d) return toast('Enter the expiry date'); if (!(q > 0)) return toast('Enter the quantity');
    bat(p.id).push({ no: val('exN').trim(), exp: d, qty: q });
    if (!document.getElementById('exIn').checked) { p.stock = r2((Number(p.stock) || 0) + q); c.stockMovements.unshift({ id: c.uid(), productId: p.id, productName: p.name, type: 'in', qty: q, date: new Date().toISOString(), note: 'Stock in: batch ' + (val('exN') || d) }); }
    c.persist(); close(); toast('Batch saved'); redraw();
  };
  A['ex-wo'] = async t => {
    const c = C(), p = c.products.find(x => x.id === t.dataset.p), l = p && bat(p.id), b = l && l[+t.dataset.i]; if (!b) return;
    if (!(await c.askConfirm(`Write off ${b.qty} × ${p.name} (expired)? Stock goes down by ${b.qty}.`))) return;
    p.stock = r2(Math.max(0, (Number(p.stock) || 0) - b.qty)); c.stockMovements.unshift({ id: c.uid(), productId: p.id, productName: p.name, type: 'out', qty: b.qty, date: new Date().toISOString(), note: 'Adjust: Expired write-off' + (b.no ? ' batch ' + b.no : '') });
    E.audit('expiry', `Wrote off ${b.qty} × ${p.name} (expired)`);
    l.splice(+t.dataset.i, 1); c.persist(); redraw();
  };
  E.perms['ex-add'] = 'items_edit'; E.perms['ex-save'] = 'items_edit'; E.perms['ex-wo'] = 'items_edit';

  // ======================= Backups =======================
  const IDB = 'billaura_backups_v1';
  function idb() { return new Promise((res, rej) => { const q = indexedDB.open(IDB, 1); q.onupgradeneeded = () => q.result.createObjectStore('snaps', { keyPath: 'id' }); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
  const idbDo = (mode, fn) => idb().then(d => new Promise((res, rej) => { const tx = d.transaction('snaps', mode), st = tx.objectStore('snaps'), r = fn(st); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); }));
  const snapList = () => idbDo('readonly', st => st.getAll()).then(l => (l || []).sort((a, b) => b.id - a.id));
  async function takeSnap(kind) {
    const c = C(), data = c.snapshotData(); if (!data.products.length && !data.invoices.length) return null;
    const str = JSON.stringify(data), rec = { id: Date.now(), at: new Date().toISOString(), kind, size: str.length, inv: data.invoices.length, prod: data.products.length, data: str };
    await idbDo('readwrite', st => st.put(rec));
    const all = await snapList(), keep = all.filter(x => x.kind === 'manual').slice(0, 5).concat(all.filter(x => x.kind !== 'manual').slice(0, 7)), ids = new Set(keep.map(x => x.id));
    await Promise.all(all.filter(x => !ids.has(x.id)).map(x => idbDo('readwrite', st => st.delete(x.id))));
    S().lastAutoBackup = rec.at; return rec;
  }
  async function autoBackup() {
    if (!window.indexedDB || S().autoBackup === false) return;
    const last = S().lastAutoBackup; if (last && Date.now() - new Date(last) < 20 * 36e5) return;
    const r = await takeSnap('auto'); if (r) C().persist();
  }
  const BK = { list: null };
  E.views.backup = {
    title: 'Backup & Restore', perm: 'export',
    html() {
      const lf = S().lastFileBackup;
      return `<div class="fade-in" style="padding:12px 16px 40px"><div class="doc-card"><div class="doc-label">Backup file</div><p class="text-sm text-secondary">Last saved to phone: <b>${lf ? C().formatDate(lf) : 'never'}</b>. Keep a copy on WhatsApp, Drive or email, so a lost phone does not lose your shop.</p><div class="form-row"><button class="btn btn-primary" data-action="export-data">Save file</button><button class="btn btn-outline" data-action="bk-share">Share file</button></div></div>
        <div class="doc-card"><div class="doc-label">Automatic restore points</div><label class="check-row"><input type="checkbox" data-ch="bk-auto" ${S().autoBackup === false ? '' : 'checked'}> Save a restore point on this device every day</label><div class="text-sm text-secondary">Keeps the last 7 days inside the app. Handy if something is deleted by mistake. It does not replace a backup file.</div>
        <button class="btn btn-outline btn-block" style="margin-top:8px" data-action="bk-now">Create restore point now</button><div id="bkList" style="margin-top:8px">Loading…</div></div>
        <div class="doc-card"><div class="doc-label">Restore from a file</div><button class="btn btn-secondary btn-block" data-action="import-data">Choose backup file</button></div></div>`;
    },
    bind() { snapList().then(l => { const el = document.getElementById('bkList'); if (!el) return; el.innerHTML = l.length ? l.map(x => `<div class="list-row" style="cursor:default"><div class="list-row-left"><div><div class="list-row-label">${dt(x.at)}${x.kind === 'manual' ? ' · manual' : ''}</div><div class="text-sm text-secondary">${x.inv} bills · ${x.prod} items · ${(x.size / 1024).toFixed(0)} KB</div></div></div><div style="display:flex;gap:6px"><button class="chip-btn" data-action="bk-restore" data-id="${x.id}">Restore</button><button class="chip-btn" data-action="bk-dl" data-id="${x.id}">Save</button></div></div>`).join('') : '<div class="text-sm text-secondary">No restore points yet.</div>'; }).catch(() => { const el = document.getElementById('bkList'); if (el) el.textContent = 'Restore points are not available in this browser.'; }); }
  };
  E.inputs['bk-auto'] = el => { S().autoBackup = el.checked; C().persist(); };
  A['bk-now'] = async () => { const r = await takeSnap('manual'); toast(r ? 'Restore point saved' : 'Nothing to back up yet'); C().persist(); redraw(); };
  A['bk-restore'] = async t => {
    const c = C(), l = await snapList(), x = l.find(k => String(k.id) === t.dataset.id); if (!x) return;
    if (!(await c.askConfirm(`Go back to ${dt(x.at)}? Everything after that is replaced. A restore point of today's data is saved first.`, { title: 'Restore', okText: 'Restore', danger: true }))) return;
    E.audit('restore', 'Restored data to ' + dt(x.at)); await takeSnap('manual'); c.applyBackupData(JSON.parse(x.data)); c.afterRestore(); toast('Restored'); go('dashboard');
  };
  A['bk-dl'] = async t => { const l = await snapList(), x = l.find(k => String(k.id) === t.dataset.id); if (x) C().downloadText(`billaura-restorepoint-${x.at.slice(0, 10)}.json`, x.data, 'application/json'); };
  A['bk-share'] = async () => {
    const c = C(), str = JSON.stringify(c.snapshotData()), f = new File([str], `billaura-backup-${today()}.json`, { type: 'application/json' });
    try { if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: 'Billaura backup' }); S().lastFileBackup = new Date().toISOString(); c.persist(); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    S().lastFileBackup = new Date().toISOString(); c.persist(); c.downloadText(f.name, str, 'application/json'); toast('Sharing is not supported here, so the file was saved');
  };
  E.perms['bk-restore'] = 'export'; E.perms['bk-share'] = 'export';
})();
