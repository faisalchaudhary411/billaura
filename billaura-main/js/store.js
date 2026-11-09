/* Billaura Online Store manager: real orders from the store page, order statuses, bill creation,
   item visibility and store settings. Orders live in Supabase (supabase/store-orders.sql). */
(function () {
  'use strict';
  const E = window.BillauraExt; if (!E) return;
  const C = () => window.BillauraCore, H = () => E.helpers, A = E.actions;
  const h = s => C().escapeHtml(s), m = n => C().money(n), r2 = n => C().round2(n), S = () => C().settings, cur = () => S().currency || 'Rs';
  const toast = t => C().toast(t), redraw = () => C().render();
  const cloud = () => window.HisablyCloud;
  const sbc = () => { try { const c = cloud(); return c && c.ready() && c.getSession() && c.shopId && c.shopId() ? c.client() : null; } catch (e) { return null; } };
  const KEY = () => 'billaura_store_orders_v1_' + (cloud() && cloud().shopId ? (cloud().shopId() || 'x') : 'x');
  const ST = { orders: [], views: 0, at: 0, err: '', loading: false, tab: 'new', f: 'all', q: '', seen: -1 };
  const STATUS = { new: 'New', accepted: 'Accepted', delivered: 'Delivered', cancelled: 'Cancelled' };

  function loadCache() { if (ST.orders.length || ST.at) return; try { const j = JSON.parse(localStorage.getItem(KEY()) || 'null'); if (j) { ST.orders = j.orders || []; ST.views = j.views || 0; } } catch (e) {} }
  function saveCache() { try { localStorage.setItem(KEY(), JSON.stringify({ orders: ST.orders.slice(0, 300), views: ST.views })); } catch (e) {} }
  async function fetchAll(force) {
    const c = sbc(); if (!c || !navigator.onLine) return false;
    if (ST.loading || (!force && Date.now() - ST.at < 45000)) return false;
    ST.loading = true;
    try {
      const o = await c.from('store_orders').select('*').order('created_at', { ascending: false }).limit(300);
      if (o.error) { ST.err = /relation|does not exist|42P01|schema cache|PGRST/i.test((o.error.message || '') + (o.error.code || '')) ? 'SETUP' : 'ERR'; return false; }
      let views = ST.views; try { const s = await c.from('store_stats').select('views').maybeSingle(); if (s && s.data) views = Number(s.data.views) || 0; } catch (e) {}
      ST.err = ''; ST.orders = o.data || []; ST.views = views; ST.at = Date.now(); saveCache(); return true;
    } catch (e) { ST.err = 'ERR'; return false; } finally { ST.loading = false; }
  }
  const newCount = () => ST.orders.filter(o => o.status === 'new').length;
  const ago = iso => { const s = (Date.now() - new Date(iso)) / 1000; if (s < 90) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return C().formatDate(iso); };
  const waNum = v => String(v || '').replace(/\D/g, '').replace(/^0/, '92');
  const summary = o => (o.items || []).map(i => `${h(i.name)} ×${m(i.qty)}`).join(', ');
  const pill = s => `<span class="st-pill ${s}">${STATUS[s] || s}</span>`;
  const sw = (on, attr) => `<button type="button" class="st-sw${on ? ' on' : ''}" ${attr} aria-pressed="${on}"><i></i></button>`;

  // ---------- dashboard block on the Online Store page ----------
  E.storeDash = function () {
    if (!C().storeLive()) return `<div class="doc-card" style="margin:14px 16px 0"><div class="doc-label">Orders</div><div class="text-sm text-secondary">Sign in to the cloud and tap <b>Publish Store Page</b> to get a short link. Customers can then place orders that arrive here.</div></div>`;
    loadCache();
    fetchAll().then(ok => { if (ok && C().view === 'online-store') redraw(); });
    const o = ST.orders, open = o.filter(x => x.status === 'new' || x.status === 'accepted').length, nw = newCount();
    const received = r2(o.filter(x => x.status === 'delivered').reduce((a, x) => a + Number(x.total || 0), 0));
    const oos = C().products.filter(p => (Number(p.stock) || 0) <= 0).length;
    const delivered = o.filter(x => x.status === 'delivered').length;
    const on = S().storeOpen !== false;
    return `<div class="st-dash">
      ${ST.err === 'SETUP' ? `<div class="st-warn"><b>One-time setup needed</b><br>Run <code>supabase/store-orders.sql</code> in Supabase → SQL Editor so orders can reach this screen.</div>` : ''}
      <div class="st-row"><div class="st-open ${on ? 'on' : ''}"><span></span>${on ? 'Accepting orders' : 'Orders paused'}</div><button class="chip-btn" data-action="st-settings">⚙ Store settings</button></div>
      <div class="st-grid">
        <div class="st-card"><small>Total orders</small><b>${o.length}</b></div>
        <div class="st-card${nw ? ' hot' : ''}" data-action="st-go-new"><small>Open orders</small><b>${open}</b>${nw ? `<em>${nw} NEW</em>` : ''}</div>
        <div class="st-card"><small>Store views</small><b>${ST.views}</b></div>
        <div class="st-card"><small>Order value received</small><b>${cur()} ${m(received)}</b></div>
      </div>
      <div class="section-title" style="padding-left:0">Quick actions</div>
      <div class="st-act" data-view="store-items"><div class="st-ai amb">${C().ico('box')}</div><div><b>Manage Items</b><span class="${oos ? 'warn' : ''}">${oos ? 'Out of stock · ' + oos + ' item' + (oos === 1 ? '' : 's') : 'All items in stock'}</span></div><i>›</i></div>
      <div class="st-act" data-view="store-orders"><div class="st-ai pnk">${C().ico('cart')}</div><div><b>Manage Orders</b><span>${delivered} delivered till date</span></div><i>›</i></div>
    </div>`;
  };
  A['st-go-new'] = () => { ST.tab = 'new'; C().setView('store-orders'); };

  // ---------- orders ----------
  E.views['store-orders'] = {
    title: 'Online Orders', perm: 'sales',
    right: () => `<button class="icon-btn" data-action="so-refresh" aria-label="Refresh">${C().ico('sync') || '↻'}</button>`,
    html() {
      loadCache(); fetchAll().then(ok => { if (ok && C().view === 'store-orders') redraw(); });
      const tabs = ['new', 'accepted', 'delivered', 'cancelled'], cnt = t => ST.orders.filter(o => o.status === t).length;
      const l = ST.orders.filter(o => o.status === ST.tab);
      return `<div class="fade-in" style="padding:12px 16px 40px">
        ${ST.err === 'SETUP' ? `<div class="st-warn">Run <code>supabase/store-orders.sql</code> in Supabase to turn on orders.</div>` : ''}
        <div class="chip-row" style="margin-bottom:10px">${tabs.map(t => `<button class="cat-chip${ST.tab === t ? ' active' : ''}" data-action="so-tab" data-v="${t}">${STATUS[t]} (${cnt(t)})</button>`).join('')}</div>
        ${ST.loading && !ST.orders.length ? '<div class="text-sm text-secondary" style="text-align:center;padding:30px">Loading…</div>' : ''}
        ${l.length ? l.map(o => `<div class="st-order" data-action="so-open" data-id="${o.id}"><div class="st-o-top"><b>#${o.no} · ${h(o.customer_name)}</b>${pill(o.status)}</div>
          <div class="text-sm text-secondary">${summary(o)}</div>
          <div class="st-o-bot"><span>${o.mode === 'pickup' ? '🏬 Pickup' : '🚚 Delivery'} · ${ago(o.created_at)}</span><b>${cur()} ${m(o.total)}</b></div></div>`).join('')
          : (!ST.loading ? `<div class="empty-state" style="padding:40px 0"><h3>No ${STATUS[ST.tab].toLowerCase()} orders</h3><p>${ST.tab === 'new' ? 'Share your store link. New orders show up here.' : 'Nothing here yet.'}</p></div>` : '')}
      </div>`;
    }
  };
  A['so-tab'] = t => { ST.tab = t.dataset.v; redraw(); };
  A['so-refresh'] = async () => { toast('Refreshing…'); const ok = await fetchAll(true); if (!ok && ST.err !== 'SETUP') toast(navigator.onLine ? 'Could not load orders' : 'You are offline'); redraw(); };

  const byId = id => ST.orders.find(x => x.id === id);
  function openOrder(o) {
    const lines = (o.items || []).map(i => `<div class="st-line"><span>${h(i.name)} <small>× ${m(i.qty)}${i.unit ? ' ' + h(i.unit) : ''}</small></span><b>${m(r2(i.qty * i.price))}</b></div>`).join('');
    const b = [];
    if (o.status === 'new') b.push(`<button class="btn btn-primary btn-block" data-action="so-set" data-id="${o.id}" data-v="accepted">Accept order</button>`, `<button class="btn btn-outline btn-block" style="margin-top:8px;color:#C0213A" data-action="so-cancel" data-id="${o.id}">Reject order</button>`);
    if (o.status === 'accepted') b.push(`<button class="btn btn-primary btn-block" data-action="so-set" data-id="${o.id}" data-v="delivered">Mark ${o.mode === 'pickup' ? 'picked up' : 'delivered'}</button>`, `<button class="btn btn-outline btn-block" style="margin-top:8px" data-action="so-bill" data-id="${o.id}">Create bill</button>`, `<button class="btn btn-ghost btn-block" style="margin-top:4px;color:#C0213A" data-action="so-cancel" data-id="${o.id}">Cancel order</button>`);
    if (o.status === 'delivered' && !o.invoice_id) b.push(`<button class="btn btn-primary btn-block" data-action="so-bill" data-id="${o.id}">Create bill</button>`);
    const inv = o.invoice_id && C().invoices.find(x => x.id === o.invoice_id);
    const msg = { new: `Hello ${o.customer_name}, we received your order #${o.no} (${cur()} ${m(o.total)}).`, accepted: `Hello ${o.customer_name}, your order #${o.no} is confirmed. ${o.mode === 'pickup' ? 'You can pick it up soon.' : 'We will deliver it soon.'}`, delivered: `Thank you ${o.customer_name}! Order #${o.no} is complete. Total ${cur()} ${m(o.total)}.`, cancelled: `Hello ${o.customer_name}, sorry, we could not complete order #${o.no}.${o.cancel_reason ? ' ' + o.cancel_reason : ''}` }[o.status];
    H().modal(`Order #${o.no}`, `<div class="modal-body">
      <div style="display:flex;justify-content:space-between;align-items:center">${pill(o.status)}<span class="text-sm text-secondary">${ago(o.created_at)}</span></div>
      <div class="st-cust"><b>${h(o.customer_name)}</b><a href="tel:${h(o.phone)}">${h(o.phone)}</a>${o.mode === 'delivery' ? `<span>📍 ${h(o.address)}</span>` : '<span>🏬 Customer will pick up</span>'}${o.note ? `<span>📝 ${h(o.note)}</span>` : ''}</div>
      <div class="st-lines">${lines}${o.delivery_fee > 0 ? `<div class="st-line"><span>Delivery</span><b>${m(o.delivery_fee)}</b></div>` : ''}<div class="st-line tot"><span>Total</span><b>${cur()} ${m(o.total)}</b></div></div>
      ${inv ? `<div class="text-sm" style="margin:8px 0">Bill: <a data-action="so-view-bill" data-id="${inv.id}">${h(inv.number)}</a></div>` : ''}
      ${o.status === 'cancelled' && o.cancel_reason ? `<div class="text-sm text-secondary">Reason: ${h(o.cancel_reason)}</div>` : ''}
      <div class="form-row" style="margin:10px 0"><a class="btn btn-outline" href="tel:${h(o.phone)}">Call</a><a class="btn btn-outline" href="https://wa.me/${waNum(o.phone)}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">WhatsApp</a></div>
      ${b.join('')}</div>`);
  }
  A['so-open'] = t => { const o = byId(t.dataset.id); if (o) openOrder(o); };
  A['so-view-bill'] = t => { H().close(); const inv = C().invoices.find(x => x.id === t.dataset.id); if (inv) C().openInvoiceDetail(inv); };
  async function setStatus(o, status, extra) {
    const c = sbc(); if (!c || !navigator.onLine) { toast('Go online to update orders'); return false; }
    const patch = Object.assign({ status, updated_at: new Date().toISOString() }, extra || {});
    const { error } = await c.from('store_orders').update(patch).eq('id', o.id);
    if (error) { toast('Could not update: ' + (error.message || 'try again')); return false; }
    Object.assign(o, patch); saveCache(); return true;
  }
  A['so-set'] = async t => {
    const o = byId(t.dataset.id); if (!o) return;
    if (await setStatus(o, t.dataset.v)) { C().persist(); H().close(); toast('Order ' + STATUS[t.dataset.v].toLowerCase()); if (t.dataset.v === 'delivered' && !o.invoice_id) { openBillAsk(o); } else redraw(); }
  };
  A['so-cancel'] = t => {
    const o = byId(t.dataset.id); if (!o) return;
    H().modal('Cancel order #' + o.no, `<div class="modal-body"><div class="form-group"><label class="form-label">Reason (the customer can see it on WhatsApp)</label><input class="form-input" id="soWhy" maxlength="120" placeholder="e.g. Item out of stock"></div><button class="btn btn-primary btn-block" style="background:#C0213A" data-action="so-cancel-go" data-id="${o.id}">Cancel order</button></div>`);
  };
  A['so-cancel-go'] = async t => {
    const o = byId(t.dataset.id); if (!o) return; const why = (document.getElementById('soWhy') || {}).value || '';
    if (await setStatus(o, 'cancelled', { cancel_reason: why.trim() })) { H().close(); toast('Order cancelled'); ST.tab = 'cancelled'; redraw(); }
  };
  function openBillAsk(o) {
    H().modal('Create a bill?', `<div class="modal-body"><p class="text-sm text-secondary">Order #${o.no} · ${cur()} ${m(o.total)}. The bill takes the items out of your stock.</p>
      <button class="btn btn-primary btn-block" data-action="so-bill-go" data-id="${o.id}" data-paid="1">Create bill · payment received</button>
      <button class="btn btn-outline btn-block" style="margin-top:8px" data-action="so-bill-go" data-id="${o.id}" data-paid="0">Create bill · not paid yet</button>
      <button class="btn btn-ghost btn-block" style="margin-top:4px" data-action="close-modal">Not now</button></div>`);
  }
  A['so-bill'] = t => { const o = byId(t.dataset.id); if (o) { H().close(); openBillAsk(o); } };
  A['so-bill-go'] = async t => {
    const o = byId(t.dataset.id); if (!o) return; if (o.invoice_id && C().invoices.some(x => x.id === o.invoice_id)) { H().close(); return toast('Bill already created'); }
    const c = C(), s = S(), now = new Date().toISOString(), paid = t.dataset.paid === '1';
    if (!c.enforceLimit('invoices', c.invoices.length)) return;
    const number = c.nextInvoiceNumber();
    const items = (o.items || []).map(i => { const p = c.products.find(x => x.id === i.id); return { productId: p ? p.id : null, name: i.name, price: Number(i.price) || 0, cost: p ? Number(p.cost) || 0 : 0, qty: Number(i.qty) || 0 }; });
    items.forEach(it => { const p = c.products.find(x => x.id === it.productId); if (!p) return; p.stock = r2((Number(p.stock) || 0) - it.qty); try { E.onStock(p, -it.qty); } catch (e) {} c.stockMovements.unshift({ id: c.uid(), productId: it.productId, productName: it.name, type: 'out', qty: it.qty, date: now, note: 'Online order #' + o.no + ' · ' + number }); });
    const cu = c.findOrCreateCustomer(o.customer_name, o.phone);
    const fee = Number(o.delivery_fee) || 0, total = Number(o.total) || 0;
    const meta = { subtotal: Number(o.subtotal) || 0, discount: 0, discType: 'amount', discValue: 0, taxName: 'Tax', taxRate: 0, taxType: 'pct', tax: 0, inclTax: false, chargeLabel: fee ? 'Delivery' : '', charges: fee, roundOff: 0, paymentMode: paid ? 'Cash' : '', onlineOrder: o.no };
    if (paid && s.shiftOpen) meta.shiftId = s.shiftOpen.id;
    E.stamp(meta); if (c.isStaff()) meta.by = c.staffName();
    const inv = { id: c.uid(), number, docType: 'sale', customerId: cu ? cu.id : null, customerName: cu ? cu.name : o.customer_name, customerPhone: o.phone, items, total, paymentStatus: paid ? 'paid' : 'unpaid', paidAmount: paid ? total : 0, meta, date: now };
    c.invoices.unshift(inv); try { E.audit('online-bill', `Bill ${number} for online order #${o.no}`); } catch (e) {} c.persist();
    const c2 = sbc(); if (c2) { const patch = { invoice_id: inv.id, paid, updated_at: now }; const { error } = await c2.from('store_orders').update(patch).eq('id', o.id); if (!error) { Object.assign(o, patch); saveCache(); } }
    else o.invoice_id = inv.id;
    H().close(); toast('Bill ' + number + ' created'); redraw();
  };

  // ---------- items ----------
  const itemsOnline = () => C().products.filter(p => p.online !== false).length;
  E.views['store-items'] = {
    title: 'Manage Items', perm: 'items_view',
    html() {
      const ps = C().products, oos = ps.filter(p => (Number(p.stock) || 0) <= 0), hid = ps.filter(p => p.online === false);
      let l = ps; if (ST.f === 'oos') l = oos; else if (ST.f === 'hidden') l = hid;
      const q = ST.q.trim().toLowerCase(); if (q) l = l.filter(p => String(p.name).toLowerCase().includes(q));
      return `<div class="fade-in" style="padding:12px 16px 40px">
        <div class="st-sum"><b>${itemsOnline()}</b> on your store · <b>${hid.length}</b> hidden · <b>${oos.length}</b> out of stock</div>
        <div class="st-set"><div><b>Hide out-of-stock items</b><span>They disappear from the store until you restock</span></div>${sw(!!S().storeHideOOS, 'data-action="si-oos"')}</div>
        <input class="form-input" data-in="si-q" placeholder="Search items" value="${h(ST.q)}" style="margin:10px 0">
        <div class="chip-row" style="margin-bottom:8px"><button class="cat-chip${ST.f === 'all' ? ' active' : ''}" data-action="si-f" data-v="all">All (${ps.length})</button><button class="cat-chip${ST.f === 'oos' ? ' active' : ''}" data-action="si-f" data-v="oos">Out of stock (${oos.length})</button><button class="cat-chip${ST.f === 'hidden' ? ' active' : ''}" data-action="si-f" data-v="hidden">Hidden (${hid.length})</button></div>
        ${l.slice(0, 200).map(p => `<div class="st-item"><div style="min-width:0"><b>${h(p.name)}</b><span>${cur()} ${m(p.price)} · ${(Number(p.stock) || 0) <= 0 ? '<em class="bad">Out of stock</em>' : 'Stock ' + m(p.stock)}</span></div>${sw(p.online !== false, `data-action="si-toggle" data-id="${p.id}"`)}</div>`).join('') || '<div class="text-sm text-secondary" style="text-align:center;padding:30px">Nothing here.</div>'}
        ${l.length > 200 ? `<div class="text-sm text-secondary" style="text-align:center">Showing 200 of ${l.length}. Use search.</div>` : ''}</div>`;
    }
  };
  let pubT; const schedulePublish = () => { clearTimeout(pubT); pubT = setTimeout(() => { C().republishStore(true).then(() => toast('Store updated')).catch(() => {}); }, 2500); };
  A['si-f'] = t => { ST.f = t.dataset.v; redraw(); };
  E.inputs['si-q'] = el => { ST.q = el.value; const pos = el.selectionStart; redraw(); const n = document.querySelector('[data-in="si-q"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } };
  A['si-toggle'] = t => { const p = C().products.find(x => x.id === t.dataset.id); if (!p) return; p.online = p.online === false ? true : false; C().persist(); schedulePublish(); redraw(); };
  A['si-oos'] = () => { S().storeHideOOS = !S().storeHideOOS; C().persist(); schedulePublish(); redraw(); };

  // ---------- store settings ----------
  A['st-settings'] = () => {
    if (C().isStaff()) return toast('Only the owner can change store settings');
    const s = S();
    H().modal('Store settings', `<div class="modal-body">
      <div class="st-set"><div><b>Accept orders</b><span>Turn off when you are closed</span></div>${sw(s.storeOpen !== false, 'data-action="st-sw" data-k="storeOpen"')}</div>
      <div class="st-set"><div><b>Home delivery</b></div>${sw(s.storeDelivery !== false, 'data-action="st-sw" data-k="storeDelivery"')}</div>
      <div class="st-set"><div><b>Pickup from shop</b></div>${sw(s.storePickup !== false, 'data-action="st-sw" data-k="storePickup"')}</div>
      <div class="form-row" style="margin-top:10px"><div class="form-group"><label class="form-label">Delivery charge</label><input class="form-input" id="stFee" type="number" inputmode="decimal" min="0" step="any" value="${s.storeFee || ''}" placeholder="0"></div>
      <div class="form-group"><label class="form-label">Minimum order</label><input class="form-input" id="stMin" type="number" inputmode="decimal" min="0" step="any" value="${s.storeMin || ''}" placeholder="0"></div></div>
      <div class="form-group"><label class="form-label">Notice on your store (optional)</label><input class="form-input" id="stNote" maxlength="140" value="${h(s.storeNotice || '')}" placeholder="e.g. Delivery within 3 km, 2 to 4 pm"></div>
      <button class="btn btn-primary btn-block" data-action="st-save">Save &amp; update store</button></div>`);
  };
  A['st-sw'] = t => { const k = t.dataset.k, s = S(); s[k] = s[k] === false; t.classList.toggle('on', s[k] !== false); t.setAttribute('aria-pressed', s[k] !== false); C().persist(); };
  A['st-save'] = async () => {
    const s = S(), v = id => (document.getElementById(id) || {}).value || '';
    s.storeFee = Math.max(0, parseFloat(v('stFee')) || 0); s.storeMin = Math.max(0, parseFloat(v('stMin')) || 0); s.storeNotice = v('stNote').trim();
    C().persist(); H().close(); toast('Updating your store…');
    try { await C().republishStore(true); toast('Store updated'); } catch (e) { toast('Saved. Tap Update Store Page to publish.'); }
    redraw();
  };

  // ---------- alerts + background check ----------
  const ha = E.homeAlerts;
  E.homeAlerts = function () {
    let x = ha ? ha() : '';
    try { loadCache(); const n = newCount(); if (n && !C().isStaff()) x += `<div class="home-alert info"><div class="ha-t"><b>${n} new online order${n === 1 ? '' : 's'}</b><span>Tap to accept and deliver</span></div><button data-view="store-orders">Open</button></div>`; } catch (e) {}
    return x;
  };
  const bi = E.init;
  E.init = function () {
    bi && bi();
    const tick = async () => {
      try {
        if (document.hidden || !C().storeLive() || !sbc()) return;
        loadCache(); const before = newCount();
        if (await fetchAll(true)) {
          const now = newCount();
          if (now > before && ST.seen >= 0) { toast(`🛒 ${now - before} new online order${now - before === 1 ? '' : 's'}`); try { navigator.vibrate && navigator.vibrate(200); } catch (e) {} }
          ST.seen = now; if (now !== before && ['home', 'online-store', 'store-orders'].includes(C().view)) redraw();
        } else if (ST.seen < 0) ST.seen = newCount();
      } catch (e) {}
    };
    setTimeout(tick, 6000); setInterval(tick, 90000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(tick, 800); });
  };
})();
