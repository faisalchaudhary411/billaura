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
  const STATUS = { new: 'New', accepted: 'Accepted', shipped: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled' };
  const COLS = 'id,shop_id,no,slug,customer_name,phone,address,mode,note,items,subtotal,delivery_fee,total,status,paid,invoice_id,cancel_reason,created_at,updated_at,discount,coupon,pay_method,has_proof,ship_info,accepted_at,shipped_at,delivered_at';
  const PAYN = { cod: 'Cash on delivery', jazzcash: 'JazzCash', easypaisa: 'Easypaisa', bank: 'Bank transfer' };

  function loadCache() { if (ST.orders.length || ST.at) return; try { const j = JSON.parse(localStorage.getItem(KEY()) || 'null'); if (j) { ST.orders = j.orders || []; ST.views = j.views || 0; } } catch (e) {} }
  function saveCache() { try { localStorage.setItem(KEY(), JSON.stringify({ orders: ST.orders.slice(0, 300), views: ST.views })); } catch (e) {} }
  async function fetchAll(force) {
    const c = sbc(); if (!c || !navigator.onLine) return false;
    if (ST.loading || (!force && Date.now() - ST.at < 45000)) return false;
    ST.loading = true;
    try {
      let o = await c.from('store_orders').select(COLS).order('created_at', { ascending: false }).limit(300);
      if (o.error && /discount|pay_method|ship_info|has_proof|accepted_at/i.test(o.error.message || '')) { const o1 = await c.from('store_orders').select('*').order('created_at', { ascending: false }).limit(300); if (!o1.error) { o = o1; ST.v2 = false; } }
      if (o.error) { ST.err = /relation|does not exist|42P01|schema cache|PGRST/i.test((o.error.message || '') + (o.error.code || '')) ? 'SETUP' : 'ERR'; return false; }
      let views = ST.views; try { const s = await c.from('store_stats').select('views').maybeSingle(); if (s && s.data) views = Number(s.data.views) || 0; } catch (e) {}
      ST.err = ''; ST.orders = o.data || []; ST.views = views; ST.at = Date.now(); saveCache(); return true;
    } catch (e) { ST.err = 'ERR'; return false; } finally { ST.loading = false; }
  }
  const newCount = () => ST.orders.filter(o => o.status === 'new').length;
  const ago = iso => { const s = (Date.now() - new Date(iso)) / 1000; if (s < 90) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return C().formatDate(iso); };
  const waNum = v => String(v || '').replace(/\D/g, '').replace(/^0/, '92');
  const lname = i => i.name + (i.opt ? ' (' + i.opt + ')' : '');
  const summary = o => (o.items || []).map(i => `${h(lname(i))} ×${m(i.qty)}`).join(', ');
  const pill = s => `<span class="st-pill ${s}">${STATUS[s] || s}</span>`;
  const sw = (on, attr) => `<button type="button" class="st-sw${on ? ' on' : ''}" ${attr} aria-pressed="${on}"><i></i></button>`;

  // ---------- dashboard block on the Online Store page ----------
  E.storeDash = function () {
    if (!C().storeLive()) return `<div class="doc-card" style="margin:14px 16px 0"><div class="doc-label">Orders</div><div class="text-sm text-secondary">Sign in to the cloud and tap <b>Publish Store Page</b> to get a short link. Customers can then place orders that arrive here.</div></div>`;
    loadCache();
    fetchAll().then(ok => { if (ok && C().view === 'online-store') redraw(); });
    const o = ST.orders, open = o.filter(x => x.status === 'new' || x.status === 'accepted' || x.status === 'shipped').length, nw = newCount();
    const received = r2(o.filter(x => x.status === 'delivered').reduce((a, x) => a + Number(x.total || 0), 0));
    const oos = C().products.filter(p => (Number(p.stock) || 0) <= 0).length;
    const delivered = o.filter(x => x.status === 'delivered').length;
    const on = S().storeOpen !== false;
    return `<div class="st-dash">
      ${ST.v2 === false ? `<div class="st-warn"><b>Store upgrade needed</b><br>Run <code>supabase/store-v2.sql</code> in Supabase → SQL Editor to turn on options, coupons, payment proof and tracking.</div>` : ''}
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
      <div class="st-act" data-action="st-design"><div class="st-ai pnk">🎨</div><div><b>Store design</b><span>Theme · logo · banner · colours · layout</span></div><i>›</i></div>
      <div class="st-act" data-action="st-pay"><div class="st-ai amb">💳</div><div><b>Payment methods</b><span>JazzCash · Easypaisa · Bank · COD</span></div><i>›</i></div>
      <div class="st-act" data-action="st-coupons"><div class="st-ai pnk">🏷</div><div><b>Coupons</b><span>Discount codes for customers</span></div><i>›</i></div>
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
      const tabs = ['new', 'accepted', 'shipped', 'delivered', 'cancelled'], cnt = t => ST.orders.filter(o => o.status === t).length;
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
    const lines = (o.items || []).map(i => `<div class="st-line"><span>${h(lname(i))} <small>× ${m(i.qty)}${i.unit ? ' ' + h(i.unit) : ''}</small></span><b>${m(r2(i.qty * i.price))}</b></div>`).join('');
    const b = [];
    if (o.status === 'new') b.push(`<button class="btn btn-primary btn-block" data-action="so-set" data-id="${o.id}" data-v="accepted">Accept order</button>`, `<button class="btn btn-outline btn-block" style="margin-top:8px;color:#C0213A" data-action="so-cancel" data-id="${o.id}">Reject order</button>`);
    if (o.status === 'accepted') b.push(`<button class="btn btn-primary btn-block" data-action="so-ship" data-id="${o.id}">${o.mode === 'pickup' ? 'Ready for pickup' : 'Out for delivery'}</button>`, `<button class="btn btn-outline btn-block" style="margin-top:8px" data-action="so-set" data-id="${o.id}" data-v="delivered">Mark ${o.mode === 'pickup' ? 'picked up' : 'delivered'}</button>`, `<button class="btn btn-ghost btn-block" style="margin-top:4px;color:#C0213A" data-action="so-cancel" data-id="${o.id}">Cancel order</button>`);
    if (o.status === 'shipped') b.push(`<button class="btn btn-primary btn-block" data-action="so-set" data-id="${o.id}" data-v="delivered">Mark ${o.mode === 'pickup' ? 'picked up' : 'delivered'}</button>`, `<button class="btn btn-ghost btn-block" style="margin-top:4px;color:#C0213A" data-action="so-cancel" data-id="${o.id}">Cancel order</button>`);
    if (o.status === 'delivered' && !o.invoice_id) b.push(`<button class="btn btn-primary btn-block" data-action="so-bill" data-id="${o.id}">Create bill</button>`);
    const inv = o.invoice_id && C().invoices.find(x => x.id === o.invoice_id);
    const link = (() => { try { return C().storeUrl(); } catch (e) { return ''; } })();
    const trk = link ? ` You can track it here: ${link} (tap the box icon, order #${o.no}).` : '';
    const msg = { new: `Hello ${o.customer_name}, we received your order #${o.no} (${cur()} ${m(o.total)}).${trk}`, accepted: `Hello ${o.customer_name}, your order #${o.no} is confirmed. ${o.mode === 'pickup' ? 'We will tell you when it is ready.' : 'We will dispatch it soon.'}${trk}`, shipped: `Hello ${o.customer_name}, your order #${o.no} is ${o.mode === 'pickup' ? 'ready for pickup.' : 'out for delivery.'}${o.ship_info ? ' ' + o.ship_info + '.' : ''}`, delivered: `Thank you ${o.customer_name}! Order #${o.no} is complete. Total ${cur()} ${m(o.total)}.`, cancelled: `Hello ${o.customer_name}, sorry, we could not complete order #${o.no}.${o.cancel_reason ? ' ' + o.cancel_reason : ''}` }[o.status];
    const payLine = `<div class="st-cust" style="margin-top:8px"><span>💳 ${h(PAYN[o.pay_method] || o.pay_method || 'Cash on delivery')}${o.paid ? ' · <b style="color:#12924F">Paid</b>' : ''}${o.coupon ? ` · Coupon ${h(o.coupon)}` : ''}</span>${o.ship_info ? `<span>📦 ${h(o.ship_info)}</span>` : ''}${o.has_proof ? `<button class="chip-btn" style="margin-top:6px" data-action="so-proof" data-id="${o.id}">View payment screenshot</button>` : ''}${(o.pay_method && o.pay_method !== 'cod' && !o.paid && o.status !== 'cancelled') ? `<button class="chip-btn" style="margin-top:6px" data-action="so-paid" data-id="${o.id}">Mark payment received</button>` : ''}</div>`;
    H().modal(`Order #${o.no}`, `<div class="modal-body">
      <div style="display:flex;justify-content:space-between;align-items:center">${pill(o.status)}<span class="text-sm text-secondary">${ago(o.created_at)}</span></div>
      <div class="st-cust"><b>${h(o.customer_name)}</b><a href="tel:${h(o.phone)}">${h(o.phone)}</a>${o.mode === 'delivery' ? `<span>📍 ${h(o.address)}</span>` : '<span>🏬 Customer will pick up</span>'}${o.note ? `<span>📝 ${h(o.note)}</span>` : ''}</div>
      <div class="st-lines">${lines}${o.delivery_fee > 0 ? `<div class="st-line"><span>Delivery</span><b>${m(o.delivery_fee)}</b></div>` : ''}${o.discount > 0 ? `<div class="st-line"><span>Discount${o.coupon ? ' (' + h(o.coupon) + ')' : ''}</span><b>− ${m(o.discount)}</b></div>` : ''}<div class="st-line tot"><span>Total</span><b>${cur()} ${m(o.total)}</b></div></div>
      ${payLine}
      ${inv ? `<div class="text-sm" style="margin:8px 0">Bill: <a data-action="so-view-bill" data-id="${inv.id}">${h(inv.number)}</a></div>` : ''}
      ${o.status === 'cancelled' && o.cancel_reason ? `<div class="text-sm text-secondary">Reason: ${h(o.cancel_reason)}</div>` : ''}
      <div class="form-row" style="margin:10px 0"><a class="btn btn-outline" href="tel:${h(o.phone)}">Call</a><a class="btn btn-outline" href="https://wa.me/${waNum(o.phone)}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">WhatsApp</a></div>
      ${b.join('')}</div>`);
  }
  A['so-open'] = t => { const o = byId(t.dataset.id); if (o) openOrder(o); };
  A['so-proof'] = async t => {
    const c = sbc(); if (!c) return toast('Go online first'); toast('Loading…');
    const { data, error } = await c.from('store_orders').select('proof').eq('id', t.dataset.id).maybeSingle();
    if (error || !data || !data.proof) return toast('No screenshot found');
    H().modal('Payment screenshot', `<div class="modal-body"><img src="${h(data.proof)}" alt="" style="width:100%;border-radius:12px"></div>`);
  };
  A['so-paid'] = async t => {
    const o = byId(t.dataset.id); if (!o) return; const c = sbc(); if (!c) return toast('Go online first');
    const { error } = await c.from('store_orders').update({ paid: true, updated_at: new Date().toISOString() }).eq('id', o.id);
    if (error) return toast('Could not update'); o.paid = true; saveCache(); toast('Marked as paid'); openOrder(o);
  };
  A['so-ship'] = t => {
    const o = byId(t.dataset.id); if (!o) return;
    H().modal(o.mode === 'pickup' ? 'Ready for pickup' : 'Out for delivery', `<div class="modal-body">
      ${o.mode === 'pickup' ? '' : `<div class="form-group"><label class="form-label">Courier / tracking details (optional)</label><input class="form-input" id="soShip" maxlength="120" placeholder="e.g. TCS CN 1234567890, or Rider: Ali 0300…"></div>`}
      <button class="btn btn-primary btn-block" data-action="so-ship-go" data-id="${o.id}">Update &amp; notify</button>
      <p class="text-sm text-secondary" style="margin-top:8px">The customer sees this on their tracking page. You can also send it on WhatsApp from the order.</p></div>`);
  };
  A['so-ship-go'] = async t => {
    const o = byId(t.dataset.id); if (!o) return; const info = ((document.getElementById('soShip') || {}).value || '').trim();
    if (await setStatus(o, 'shipped', { ship_info: info })) { C().persist(); H().close(); toast('Order updated'); ST.tab = 'shipped'; openOrder(o); redraw(); }
  };
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
    const items = (o.items || []).map(i => { const p = c.products.find(x => x.id === i.id); return { productId: p ? p.id : null, name: lname(i), price: Number(i.price) || 0, cost: p ? Number(p.cost) || 0 : 0, qty: Number(i.qty) || 0 }; });
    items.forEach(it => { const p = c.products.find(x => x.id === it.productId); if (!p) return; p.stock = r2((Number(p.stock) || 0) - it.qty); try { E.onStock(p, -it.qty); } catch (e) {} c.stockMovements.unshift({ id: c.uid(), productId: it.productId, productName: it.name, type: 'out', qty: it.qty, date: now, note: 'Online order #' + o.no + ' · ' + number }); });
    const cu = c.findOrCreateCustomer(o.customer_name, o.phone);
    const fee = Number(o.delivery_fee) || 0, total = Number(o.total) || 0;
    const dsc = Number(o.discount) || 0;
    const meta = { subtotal: Number(o.subtotal) || 0, discount: dsc, discType: 'amount', discValue: dsc, taxName: 'Tax', taxRate: 0, taxType: 'pct', tax: 0, inclTax: false, chargeLabel: fee ? 'Delivery' : '', charges: fee, roundOff: 0, paymentMode: paid ? 'Cash' : '', onlineOrder: o.no };
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
        ${l.slice(0, 200).map(p => `<div class="st-item"><div style="min-width:0" data-action="si-edit" data-id="${p.id}"><b>${h(p.name)}</b><span>${cur()} ${m(p.price)} · ${(Number(p.stock) || 0) <= 0 ? '<em class="bad">Out of stock</em>' : 'Stock ' + m(p.stock)}${infoBadge(p.id)} · <u>Edit details</u></span></div>${sw(p.online !== false, `data-action="si-toggle" data-id="${p.id}"`)}</div>`).join('') || '<div class="text-sm text-secondary" style="text-align:center;padding:30px">Nothing here.</div>'}
        ${l.length > 200 ? `<div class="text-sm text-secondary" style="text-align:center">Showing 200 of ${l.length}. Use search.</div>` : ''}</div>`;
    }
  };
  const infoOf = id => (S().storeInfo && S().storeInfo[id]) || {};
  const infoBadge = id => { const i = infoOf(id), b = []; if ((i.o || []).length) b.push((i.o || []).length + ' options'); if ((i.x || []).length) b.push((i.x.length + 1) + ' photos'); if (i.d) b.push('description'); return b.length ? ' · ' + b.join(', ') : ''; };
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

  // ---------- item details: description, options (size / colour…), extra photos ----------
  let ED = null;
  const optsToText = o => (o || []).map(x => x.l + (x.p === '' || x.p == null ? '' : ' = ' + x.p)).join('\n');
  function parseOpts(t) {
    const out = [];
    String(t || '').split('\n').forEach(line => {
      line = line.trim(); if (!line) return;
      const mm = line.match(/^(.*?)\s*[=:]\s*([0-9][0-9.,]*)\s*$/);
      const l = (mm ? mm[1] : line).trim().slice(0, 30); if (!l || out.some(x => x.l.toLowerCase() === l.toLowerCase())) return;
      out.push({ l, p: mm ? Number(mm[2].replace(/,/g, '')) : null });
    });
    return out.slice(0, 12);
  }
  const phUrl = f => (S().photoBase || '') + f;
  function drawEdPhotos() {
    const box = document.getElementById('siPhBox'); if (!box || !ED) return;
    const main = C().photoSrc ? C().photoSrc(ED.id) : '';
    box.innerHTML = (main ? `<div class="st-ph"><img src="${h(main)}" alt=""><em>Main</em></div>` : '') +
      ED.x.map((f, k) => `<div class="st-ph"><img src="${h(phUrl(f))}" alt=""><button type="button" data-action="si-ph-del" data-k="${k}" aria-label="Remove">✕</button></div>`).join('') +
      (ED.x.length < 4 ? `<label class="st-ph add" for="siPhIn">＋<small>Add photo</small></label>` : '');
  }
  A['si-edit'] = t => {
    const p = C().products.find(x => x.id === t.dataset.id); if (!p) return; const i = infoOf(p.id);
    ED = { id: p.id, x: (i.x || []).slice(), gone: [] };
    H().modal('Store details · ' + p.name, `<div class="modal-body">
      <div class="form-group"><label class="form-label">Description</label><textarea class="form-input" id="siDesc" rows="3" maxlength="600" placeholder="What customers should know: material, warranty, size guide…">${h(i.d || '')}</textarea></div>
      <div class="form-group"><label class="form-label">Options (one per line)</label><textarea class="form-input" id="siOpts" rows="4" placeholder="Small\\nMedium\\nLarge = 1200">${h(optsToText(i.o))}</textarea>
        <div class="text-sm text-secondary" style="margin-top:4px">For size, colour, flavour… Add <b>= price</b> to a line if that option costs different. Customers must pick one. Stock is counted for the whole item.</div></div>
      <div class="form-label">More photos (up to 4)</div><div class="st-phs" id="siPhBox"></div><input type="file" id="siPhIn" accept="image/*" hidden>
      <button class="btn btn-primary btn-block" style="margin-top:12px" data-action="si-save">Save &amp; update store</button></div>`);
    drawEdPhotos();
    const inp = document.getElementById('siPhIn');
    if (inp) inp.onchange = async e => {
      const f = e.target.files && e.target.files[0]; if (!f || !ED) return;
      try { toast('Uploading photo…'); const pk = await C().compressImage(f, 900); const file = await C().uploadExtraPhoto(ED.id, pk.blob); ED.x.push(file); drawEdPhotos(); toast('Photo added'); }
      catch (er) { toast(er.message || 'Could not upload the photo'); }
    };
  };
  A['si-ph-del'] = t => { if (!ED) return; const f = ED.x.splice(Number(t.dataset.k), 1)[0]; if (f) ED.gone.push(f); drawEdPhotos(); };
  A['si-save'] = () => {
    if (!ED) return; const s = S(); s.storeInfo = s.storeInfo || {};
    const d = ((document.getElementById('siDesc') || {}).value || '').trim(), o = parseOpts((document.getElementById('siOpts') || {}).value);
    if (!d && !o.length && !ED.x.length) delete s.storeInfo[ED.id]; else s.storeInfo[ED.id] = { d, o, x: ED.x.slice() };
    ED.gone.forEach(f => { try { C().removeExtraPhoto(f); } catch (e) {} });
    ED = null; C().persist(); H().close(); toast('Updating your store…'); C().republishStore(true).then(() => toast('Store updated')).catch(() => toast('Saved. Tap Update Store Page to publish.')); redraw();
  };

  // ---------- store design (theme, logo, banner, colours, fonts, layout) ----------
  const THEME_META = [
    { id: 'classic', name: 'Classic', bg: '#F6F7F9', card: '#fff', hero: null, ink: '#14161B' },
    { id: 'minimal', name: 'Minimal', bg: '#FFFFFF', card: '#fff', hero: '#111111', ink: '#111', plain: true },
    { id: 'bold', name: 'Bold', bg: '#F4F4F5', card: '#fff', hero: '#F43F5E', ink: '#14161B' },
    { id: 'elegant', name: 'Elegant', bg: '#FBF8F3', card: '#fff', hero: '#8B6B3E', ink: '#2B2118', plain: true },
    { id: 'fresh', name: 'Fresh', bg: '#F1F9F4', card: '#fff', hero: '#12924F', ink: '#14161B' },
    { id: 'night', name: 'Night', bg: '#0F1115', card: '#181B21', hero: '#FF4D6A', ink: '#F2F3F5' }
  ];
  const SW = ['#EF1A3C', '#F97316', '#F59E0B', '#12924F', '#0E7C8A', '#2563EB', '#7C3AED', '#DB2777', '#111111'];
  let SD = null;
  const opt = (k, items) => `<div class="chip-row" style="margin-bottom:10px">${items.map(([v, l]) => `<button type="button" class="cat-chip${(SD[k] || '') === v ? ' active' : ''}" data-action="sd-opt" data-k="${k}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const imgBox = (k, label, hint) => { const f = SD[k]; return `<div class="form-group"><label class="form-label">${label}</label><div style="display:flex;gap:10px;align-items:center">
      <div class="sd-img ${k}">${f ? `<img src="${h(phUrl(f))}" alt="">` : '<span>None</span>'}</div>
      <div style="display:grid;gap:6px;flex:1"><label class="btn btn-outline btn-sm" for="sdIn_${k}" style="text-align:center">${f ? 'Change' : 'Upload'}</label>
      ${k === 'logo' && S().logo ? '<button type="button" class="btn btn-ghost btn-sm" data-action="sd-biz-logo">Use my business logo</button>' : ''}
      ${f ? `<button type="button" class="btn btn-ghost btn-sm" style="color:#C0213A" data-action="sd-img-clear" data-k="${k}">Remove</button>` : ''}</div>
      <input type="file" id="sdIn_${k}" accept="image/*" hidden></div><div class="text-sm text-secondary" style="margin-top:4px">${hint}</div></div>`; };
  function sdBody() {
    const col = /^#[0-9a-f]{6}$/i.test(SD.color || '') ? SD.color : '';
    return `<div class="form-label">Theme</div>
      <div class="sd-themes">${THEME_META.map(t => `<button type="button" class="sd-th${(SD.theme || 'classic') === t.id ? ' on' : ''}" data-action="sd-theme" data-v="${t.id}"><div class="sd-mock" style="background:${t.bg}"><div class="sd-hero" style="background:${t.plain ? t.card : (t.hero || '#EF1A3C')};${t.plain ? 'border-bottom:1px solid #0001' : ''}"><i style="background:${t.plain ? t.ink : '#fff8'}"></i></div><div class="sd-cards"><b style="background:${t.card}"></b><b style="background:${t.card}"></b><b style="background:${t.card}"></b></div></div><span>${t.name}</span></button>`).join('')}</div>
      ${imgBox('logo', 'Store logo', 'Square picture works best. Shown in the header and top banner.')}
      ${imgBox('banner', 'Banner photo (optional)', 'Wide photo of your shop or products. Turn on "Photo banner" below to show it.')}
      <div class="form-group"><label class="form-label">Brand colour</label><div class="sd-sw">${SW.map(c => `<button type="button" class="${col.toLowerCase() === c.toLowerCase() ? 'on' : ''}" style="background:${c}" data-action="sd-swatch" data-v="${c}" aria-label="${c}"></button>`).join('')}<label class="sd-custom" title="Pick any colour"><input type="color" id="sdColor" value="${col || '#EF1A3C'}">＋</label>${col ? '<button type="button" class="btn btn-ghost btn-sm" data-action="sd-swatch" data-v="">Theme colour</button>' : ''}</div></div>
      <div class="form-label">Header style</div>${opt('hero', [['', 'Theme'], ['grad', 'Colour'], ['img', 'Photo banner'], ['plain', 'Plain']])}
      <div class="form-label">Product cards</div>${opt('card', [['', 'Theme'], ['square', 'Square'], ['tall', 'Tall'], ['list', 'List'], ['bare', 'Minimal']])}
      <div class="form-label">Font</div>${opt('font', [['', 'Theme'], ['sans', 'Modern'], ['serif', 'Classic serif'], ['rounded', 'Rounded'], ['mono', 'Mono']])}
      <div class="form-label">Corners</div>${opt('radius', [['', 'Theme'], ['sm', 'Sharp'], ['md', 'Soft'], ['lg', 'Round'], ['pill', 'Pill']])}
      <div class="form-group"><label class="form-label">Top announcement bar (optional)</label><input class="form-input" id="sdAnn" maxlength="90" value="${h(SD.ann || '')}" placeholder="e.g. Free delivery above Rs 3000"></div>
      <div class="form-group"><label class="form-label">About your shop (optional)</label><textarea class="form-input" id="sdAbout" rows="3" maxlength="400" placeholder="Tell customers who you are, how long you have been open, return policy…">${h(SD.about || '')}</textarea></div>
      <button class="btn btn-primary btn-block" data-action="sd-save">Save &amp; update store</button>
      <button class="btn btn-ghost btn-block" style="margin-top:6px" data-action="sd-reset">Reset to default look</button>`;
  }
  function sdKeep() { const g = id => document.getElementById(id); if (g('sdAnn')) SD.ann = g('sdAnn').value.trim(); if (g('sdAbout')) SD.about = g('sdAbout').value.trim(); }
  function sdDraw() {
    sdKeep(); const box = document.getElementById('sdBody'); if (!box) return; box.innerHTML = sdBody();
    ['logo', 'banner'].forEach(k => { const el = document.getElementById('sdIn_' + k); if (el) el.onchange = async e => { const f = e.target.files && e.target.files[0]; if (f) sdUpload(k, f); }; });
    const c = document.getElementById('sdColor'); if (c) c.onchange = () => { sdKeep(); SD.color = c.value; sdDraw(); };
  }
  async function sdUpload(k, fileOrBlob) {
    try {
      toast('Uploading…');
      const pk = fileOrBlob.blob ? fileOrBlob : await C().compressImage(fileOrBlob, k === 'logo' ? 360 : 1400);
      const file = await C().uploadExtraPhoto(k, pk.blob); const old = SD[k]; SD[k] = file; if (old && old !== file) SD._gone = (SD._gone || []).concat(old);
      if (k === 'banner' && !SD.hero) SD.hero = 'img';
      sdDraw(); toast('Uploaded');
    } catch (er) { toast(er.message || 'Could not upload. Check your internet and cloud sign-in.'); }
  }
  A['st-design'] = () => {
    if (C().isStaff()) return toast('Only the owner can change the store design');
    SD = Object.assign({}, S().storeStyle || {});
    H().modal('Store design', `<div class="modal-body" id="sdBody"></div>`); sdDraw();
  };
  A['sd-theme'] = t => { sdKeep(); const keep = { logo: SD.logo, banner: SD.banner, ann: SD.ann, about: SD.about, _gone: SD._gone }; SD = Object.assign({ theme: t.dataset.v }, keep); sdDraw(); };
  A['sd-opt'] = t => { sdKeep(); const k = t.dataset.k, v = t.dataset.v; if (v) SD[k] = v; else delete SD[k]; if (k === 'hero' && v === 'img' && !SD.banner) toast('Upload a banner photo to see this style'); sdDraw(); };
  A['sd-swatch'] = t => { sdKeep(); if (t.dataset.v) SD.color = t.dataset.v; else delete SD.color; sdDraw(); };
  A['sd-img-clear'] = t => { sdKeep(); const k = t.dataset.k; if (SD[k]) SD._gone = (SD._gone || []).concat(SD[k]); delete SD[k]; sdDraw(); };
  A['sd-biz-logo'] = async () => {
    try { const b = await (await fetch(S().logo)).blob(); const f = new File([b], 'logo.png', { type: b.type || 'image/png' }); sdUpload('logo', f); } catch (e) { toast('Could not read your business logo'); }
  };
  A['sd-reset'] = () => { if (SD) { (SD._gone = (SD._gone || [])); if (SD.logo) SD._gone.push(SD.logo); if (SD.banner) SD._gone.push(SD.banner); } const g = SD && SD._gone; SD = { _gone: g }; sdDraw(); };
  A['sd-save'] = async () => {
    if (!SD) return; sdKeep(); const s = S(), gone = SD._gone || []; const o = Object.assign({}, SD); delete o._gone;
    Object.keys(o).forEach(k => { if (o[k] === '' || o[k] == null) delete o[k]; });
    if (o.theme === 'classic') delete o.theme;
    if (Object.keys(o).length) s.storeStyle = o; else delete s.storeStyle;
    gone.filter(f => f && f !== o.logo && f !== o.banner).forEach(f => { try { C().removeExtraPhoto(f); } catch (e) {} });
    SD = null; C().persist(); H().close(); toast('Updating your store…');
    try { await C().republishStore(true); toast('Store design saved'); } catch (e) { toast('Saved. Tap Update Store Page to publish.'); }
    redraw();
  };

  // ---------- payment methods ----------
  A['st-pay'] = () => {
    if (C().isStaff()) return toast('Only the owner can change payment methods');
    const p = S().storePay || {}, row = (k, label, extra) => { const v = p[k] || {}; return `<div class="st-set" style="margin-top:10px"><div><b>${label}</b></div>${sw(!!v.on, `data-action="sp-sw" data-k="${k}"`)}</div>
      <div class="form-row"><div class="form-group"><label class="form-label">${k === 'bank' ? 'Account / IBAN' : 'Number'}</label><input class="form-input" id="sp_${k}_n" value="${h(v.num || '')}" inputmode="${k === 'bank' ? 'text' : 'tel'}"></div><div class="form-group"><label class="form-label">Account title</label><input class="form-input" id="sp_${k}_t" value="${h(v.title || '')}"></div></div>${extra || ''}`; };
    H().modal('Payment methods', `<div class="modal-body"><p class="text-sm text-secondary">Cash on delivery is always on. Customers see these numbers at checkout and can attach a payment screenshot.</p>
      ${row('jazzcash', 'JazzCash')}${row('easypaisa', 'Easypaisa')}${row('bank', 'Bank transfer', `<div class="form-group"><label class="form-label">Bank name</label><input class="form-input" id="sp_bank_b" value="${h((p.bank || {}).name || '')}" placeholder="e.g. Meezan Bank"></div>`)}
      <button class="btn btn-primary btn-block" data-action="sp-save">Save &amp; update store</button></div>`);
  };
  A['sp-sw'] = t => { const s = S(); s.storePay = s.storePay || {}; const k = t.dataset.k; s.storePay[k] = s.storePay[k] || {}; s.storePay[k].on = !s.storePay[k].on; t.classList.toggle('on', s.storePay[k].on); t.setAttribute('aria-pressed', !!s.storePay[k].on); };
  A['sp-save'] = async () => {
    const s = S(), v = id => ((document.getElementById(id) || {}).value || '').trim(); s.storePay = s.storePay || {};
    ['jazzcash', 'easypaisa', 'bank'].forEach(k => { const o = s.storePay[k] = s.storePay[k] || {}; o.num = v('sp_' + k + '_n'); o.title = v('sp_' + k + '_t'); if (k === 'bank') o.name = v('sp_bank_b'); if (o.on && !o.num) o.on = false; });
    C().persist(); H().close(); toast('Updating your store…');
    try { await C().republishStore(true); toast('Store updated'); } catch (e) { toast('Saved. Tap Update Store Page to publish.'); } redraw();
  };

  // ---------- coupons ----------
  const CP = { list: [], err: '' };
  async function loadCoupons() {
    const c = sbc(); if (!c) { CP.err = 'Sign in and go online to manage coupons.'; return; }
    const { data, error } = await c.from('store_coupons').select('*').order('created_at', { ascending: false });
    if (error) { CP.err = /relation|does not exist|42P01|schema cache|PGRST/i.test(error.message || '') ? 'Run supabase/store-v2.sql in Supabase to turn on coupons.' : 'Could not load coupons.'; CP.list = []; return; }
    CP.err = ''; CP.list = data || [];
  }
  function couponHtml() {
    const row = x => `<div class="st-item"><div style="min-width:0"><b>${h(x.code)}</b><span>${x.kind === 'pct' ? m(x.value) + '% off' : cur() + ' ' + m(x.value) + ' off'}${x.min_order > 0 ? ' · min ' + m(x.min_order) : ''} · used ${x.used}${x.max_uses ? '/' + x.max_uses : ''}${x.expires_at ? ' · till ' + C().formatDate(x.expires_at) : ''}</span></div>
      <div style="display:flex;gap:8px;align-items:center">${sw(x.active, `data-action="sc-toggle" data-id="${x.id}"`)}<button class="chip-btn" data-action="sc-del" data-id="${x.id}" style="color:#C0213A">✕</button></div></div>`;
    return `<div class="modal-body">${CP.err ? `<div class="st-warn">${h(CP.err)}</div>` : ''}
      ${CP.list.map(row).join('') || (CP.err ? '' : '<div class="text-sm text-secondary" style="margin-bottom:10px">No coupons yet.</div>')}
      <div class="doc-label" style="margin-top:12px">New coupon</div>
      <div class="form-row"><div class="form-group"><label class="form-label">Code</label><input class="form-input" id="scCode" maxlength="20" placeholder="EID10" style="text-transform:uppercase"></div>
        <div class="form-group"><label class="form-label">Type</label><select class="form-input" id="scKind"><option value="pct">Percent %</option><option value="amt">Fixed amount</option></select></div></div>
      <div class="form-row"><div class="form-group"><label class="form-label">Value</label><input class="form-input" id="scVal" type="number" inputmode="decimal" min="0" step="any"></div>
        <div class="form-group"><label class="form-label">Min. order</label><input class="form-input" id="scMin" type="number" inputmode="decimal" min="0" step="any" placeholder="0"></div></div>
      <div class="form-row"><div class="form-group"><label class="form-label">Max uses</label><input class="form-input" id="scMax" type="number" inputmode="numeric" min="1" placeholder="No limit"></div>
        <div class="form-group"><label class="form-label">Expires</label><input class="form-input" id="scExp" type="date"></div></div>
      <button class="btn btn-primary btn-block" data-action="sc-add">Add coupon</button></div>`;
  }
  async function showCoupons() { await loadCoupons(); H().modal('Coupons', couponHtml()); }
  A['st-coupons'] = () => { if (C().isStaff()) return toast('Only the owner can manage coupons'); toast('Loading…'); showCoupons(); };
  A['sc-add'] = async () => {
    const c = sbc(); if (!c) return toast('Go online first'); const v = id => ((document.getElementById(id) || {}).value || '').trim();
    const code = v('scCode').toUpperCase().replace(/[^A-Z0-9_-]/g, ''), kind = v('scKind'), val = parseFloat(v('scVal'));
    if (code.length < 3) return toast('Code needs at least 3 letters or digits'); if (!(val > 0)) return toast('Enter the discount value'); if (kind === 'pct' && val > 100) return toast('Percent cannot be above 100');
    const row = { shop_id: cloud().shopId(), code, kind, value: val, min_order: parseFloat(v('scMin')) || 0, max_uses: parseInt(v('scMax'), 10) || null, expires_at: v('scExp') ? new Date(v('scExp') + 'T23:59:59').toISOString() : null };
    const { error } = await c.from('store_coupons').insert(row);
    if (error) return toast(/duplicate|unique/i.test(error.message || '') ? 'That code already exists' : 'Could not save: ' + (error.message || ''));
    toast('Coupon added'); showCoupons();
  };
  A['sc-toggle'] = async t => { const c = sbc(); if (!c) return; const x = CP.list.find(y => y.id === t.dataset.id); if (!x) return; const { error } = await c.from('store_coupons').update({ active: !x.active }).eq('id', x.id); if (!error) { x.active = !x.active; t.classList.toggle('on', x.active); t.setAttribute('aria-pressed', x.active); } else toast('Could not update'); };
  A['sc-del'] = async t => { const c = sbc(); if (!c) return; if (!(await C().askConfirm('Delete this coupon?'))) return; await c.from('store_coupons').delete().eq('id', t.dataset.id); showCoupons(); };

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
