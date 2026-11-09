/* Billaura Branches / Franchise: branches, per-branch stock, transfers, head-office dashboard, audit log.
   One shop, many branches: every sale/purchase/expense is stamped with a branch; product.stock stays the company total,
   and settings.bstock keeps what each non-main branch holds (main = total - branches - in transit). */
(function () {
  'use strict';
  const E = window.BillauraExt; if (!E) return;
  const C = () => window.BillauraCore, H = () => E.helpers;
  const h = s => C().escapeHtml(s), m = n => C().money(n), r2 = n => C().round2(n);
  const S = () => C().settings, cur = () => S().currency || 'Rs', A = E.actions;
  const toast = t => C().toast(t);
  const arr = k => (S()[k] = Array.isArray(S()[k]) ? S()[k] : []);
  const obj = k => (S()[k] = S()[k] && typeof S()[k] === 'object' && !Array.isArray(S()[k]) ? S()[k] : {});
  const LK = 'billaura_branch_v1', STAFF_ID_KEY = 'billaura_staff_id_v1';
  const featureOn = () => { try { return !!(window.HisablyFreemium && HisablyFreemium.hasFeature('branches')); } catch (e) { return false; } };

  // ---------- branch model ----------
  const mainB = () => ({ id: 'main', name: S().mainBranchName || 'Main branch', code: S().mainBranchCode || '', main: true });
  const allBranches = () => [mainB()].concat(arr('branches').filter(b => b.active !== false));
  const active = () => featureOn() && allBranches().length > 1;
  const byId = id => allBranches().find(b => b.id === id) || mainB();
  function lockedTo() { try { const id = sessionStorage.getItem(STAFF_ID_KEY); if (!id || !C().isStaff()) return null; const sf = C().staffList().find(x => x.id === id); return sf && sf.branchId && allBranches().some(b => b.id === sf.branchId) ? sf.branchId : null; } catch (e) { return null; } }
  function curId() { if (!active()) return 'main'; const l = lockedTo(); if (l) return l; let v = 'main'; try { v = localStorage.getItem(LK) || 'main'; } catch (e) {} return allBranches().some(b => b.id === v) ? v : 'main'; }
  const brOf = d => (d && d.meta && d.meta.branchId) || 'main';
  E.brId = curId;
  E.brName = () => active() ? byId(curId()).name : '';
  E.stamp = meta => { if (active()) meta.branchId = curId(); };
  E.stampExpense = e => { if (active()) obj('expBranch')[e.id] = curId(); };
  E.invPrefix = () => { if (!active()) return ''; const b = byId(curId()); return b.code ? `${b.code}-${S().invoicePrefix || 'INV'}` : ''; };

  // ---------- stock per branch ----------
  const bs = () => obj('bstock');
  const transitQty = pid => r2(arr('transfers').filter(t => t.status === 'transit').reduce((a, t) => a + t.lines.filter(l => l.productId === pid).reduce((x, l) => x + l.qty, 0), 0));
  const othersQty = pid => r2(Object.values(bs()[pid] || {}).reduce((a, v) => a + (Number(v) || 0), 0));
  function stockOf(p, bid) {
    const total = Number(p.stock) || 0;
    if (!bid || bid === 'main') return Math.max(0, r2(total - othersQty(p.id) - transitQty(p.id)));
    return Math.max(0, Number((bs()[p.id] || {})[bid]) || 0);
  }
  E.stockAt = p => active() ? stockOf(p, curId()) : (Number(p.stock) || 0);
  const baseOn = E.onStock;
  E.onStock = function (p, delta, ctx) {
    baseOn && baseOn(p, delta, ctx);
    if (!active() || ctx === 'transfer') return;
    const b = curId(); if (b === 'main') return;
    const o = (bs()[p.id] = bs()[p.id] || {}); o[b] = Math.max(0, r2((Number(o[b]) || 0) + delta));
  };
  E.priceOf = p => { if (active()) { const v = ((obj('bprice')[curId()] || {})[p.id]); if (v != null && v !== '') return Number(v) || 0; } return Number(p.price) || 0; };

  // ---------- switcher ----------
  const chip = () => { const b = byId(curId()), lock = lockedTo(); return `<button type="button" class="br-chip" ${lock ? 'disabled' : 'data-action="br-switch"'}>🏬 ${h(b.name)}${lock ? '' : ' ▾'}</button>`; };
  const prevAfter = E.afterRender;
  E.afterRender = function (view, el) {
    prevAfter && prevAfter(view, el);
    if (!active() || !['home', 'pos', 'shift', 'products'].includes(view)) return;
    const root = el.content.firstElementChild || el.content; const d = document.createElement('div'); d.className = 'br-bar'; d.innerHTML = chip(); root.insertBefore(d, root.firstChild);
  };
  E.branchChips = () => active() ? `<div class="chip-row"><button class="cat-chip${E.DR.branch ? '' : ' active'}" data-action="dr-br" data-v="">All branches</button>${allBranches().map(b => `<button class="cat-chip${E.DR.branch === b.id ? ' active' : ''}" data-action="dr-br" data-v="${b.id}">${h(b.name)}</button>`).join('')}</div>` : '';
  A['dr-br'] = t => { E.DR.branch = t.dataset.v || null; H().redraw(); };
  A['br-switch'] = () => {
    H().modal('Switch branch', `<div class="modal-body">${allBranches().map(b => `<div class="list-row" data-action="br-pick" data-id="${b.id}"><div class="list-row-left"><div class="list-row-label">${h(b.name)}${b.code ? ' <small>(' + h(b.code) + ')</small>' : ''}</div></div>${curId() === b.id ? '<b>✓</b>' : ''}</div>`).join('')}</div>`);
  };
  A['br-pick'] = t => { if (lockedTo()) return; try { localStorage.setItem(LK, t.dataset.id); } catch (e) {} H().close(); toast('Now working in ' + byId(t.dataset.id).name); H().redraw(); };

  // ---------- head-office dashboard ----------
  const HQ = { range: 'today' };
  function rangeWin() { const n = new Date(), e = new Date(n); const s = new Date(n); s.setHours(0, 0, 0, 0); if (HQ.range === '7') s.setDate(s.getDate() - 6); if (HQ.range === '30') s.setDate(s.getDate() - 29); return [s.getTime(), e.getTime()]; }
  function bStats(bid, F, T) {
    const c = C(), inB = d => brOf(d) === bid, inW = d => { const v = c.ts(d.date); return v >= F && v <= T; };
    const sales = c.invoices.filter(i => i.docType !== 'estimate' && i.docType !== 'return' && inB(i)), rets = c.invoices.filter(i => i.docType === 'return' && inB(i));
    const sw = sales.filter(inW), rw = rets.filter(inW), sum = (l, f) => r2(l.reduce((a, x) => a + (Number(f(x)) || 0), 0));
    const prof = l => sum(l, i => sum(i.items, it => (it.price - (it.cost || 0)) * it.qty) - ((i.meta && i.meta.discount) || 0));
    const rows = c.cashEntries().filter(r => r.br === bid && r.t >= F && r.t <= T && r.dir === 'in' && r.mode !== 'Exchange');
    let sv = 0, low = 0; c.products.forEach(p => { const q = stockOf(p, bid); sv += q * (Number(p.cost) || 0); if ((Number(p.stock) || 0) > 0 && q <= c.lowLimit(p) && (bid === 'main' || (bs()[p.id] || {})[bid] != null)) low++; });
    return { bills: sw.length, net: r2(sum(sw, i => i.total) - sum(rw, i => i.total)), gp: r2(prof(sw) - prof(rw)), cash: sum(rows, r => r.amount), due: sum(sales, i => Math.max(0, i.total - (i.paidAmount || 0))), sv: r2(sv), low };
  }
  E.views.branches = {
    title: 'Branches & Head Office', perm: 'reports',
    html() {
      const owner = !C().isStaff() || C().can('settings'), on = featureOn(), bl = allBranches();
      const [F, T] = rangeWin(), st = bl.map(b => ({ b, s: bStats(b.id, F, T) })), tot = st.reduce((a, x) => ({ net: a.net + x.s.net, gp: a.gp + x.s.gp, cash: a.cash + x.s.cash, due: a.due + x.s.due, sv: a.sv + x.s.sv, bills: a.bills + x.s.bills }), { net: 0, gp: 0, cash: 0, due: 0, sv: 0, bills: 0 });
      const mx = Math.max(1, ...st.map(x => x.s.net));
      const up = !on ? `<div class="doc-card"><div class="doc-label">Multi-branch is a Pro feature</div><p class="text-sm text-secondary">Run several shops or franchise outlets from one account: separate stock, bills and cash for each branch, stock transfers, and one head-office view.</p><button class="btn btn-primary" data-action="open-plans">See plans</button></div>` : '';
      return `<div class="fade-in" style="padding:12px 16px 60px">${up}
        ${bl.length > 1 ? `<div class="chip-row">${[['today', 'Today'], ['7', '7 days'], ['30', '30 days']].map(x => `<button class="cat-chip${HQ.range === x[0] ? ' active' : ''}" data-action="hq-range" data-v="${x[0]}">${x[1]}</button>`).join('')}</div>
        <div class="stats-grid" style="grid-template-columns:repeat(2,1fr)"><div class="stat-card"><div class="stat-label">All branches · sales</div><div class="stat-value" style="font-size:1.1rem">${cur()} ${m(r2(tot.net))}</div></div><div class="stat-card"><div class="stat-label">Gross profit</div><div class="stat-value success" style="font-size:1.1rem">${cur()} ${m(r2(tot.gp))}</div></div><div class="stat-card"><div class="stat-label">Money collected</div><div class="stat-value" style="font-size:1.1rem">${cur()} ${m(r2(tot.cash))}</div></div><div class="stat-card"><div class="stat-label">Udhaar outstanding</div><div class="stat-value danger" style="font-size:1.1rem">${cur()} ${m(r2(tot.due))}</div></div></div>
        <div class="doc-card"><div class="doc-label">Sales by branch</div>${st.map(x => `<div class="br-bar-row"><span>${h(x.b.name)}</span><div class="br-track"><i style="width:${Math.max(2, Math.round(x.s.net / mx * 100))}%"></i></div><b>${m(x.s.net)}</b></div>`).join('')}</div>` : ''}
        ${st.map(x => `<div class="doc-card"><div style="display:flex;justify-content:space-between;align-items:center"><b>${h(x.b.name)}${x.b.code ? ' <small>(' + h(x.b.code) + ')</small>' : ''}</b>${owner && on ? `<button class="chip-btn" data-action="br-edit" data-id="${x.b.id}">Edit</button>` : ''}</div>
          <div class="tot-row"><span>Bills</span><b>${x.s.bills}</b></div><div class="tot-row"><span>Sales</span><b>${cur()} ${m(x.s.net)}</b></div><div class="tot-row"><span>Gross profit</span><b>${m(x.s.gp)}</b></div><div class="tot-row"><span>Collected</span><b>${m(x.s.cash)}</b></div><div class="tot-row"><span>Udhaar outstanding</span><b>${m(x.s.due)}</b></div><div class="tot-row"><span>Stock value (cost)</span><b>${m(x.s.sv)}</b></div><div class="tot-row"><span>Low-stock items</span><b${x.s.low ? ' style="color:var(--danger)"' : ''}>${x.s.low}</b></div>
          <div class="form-row" style="margin-top:8px"><button class="btn btn-outline btn-sm" data-action="br-stock" data-id="${x.b.id}">Stock</button>${owner && on ? `<button class="btn btn-outline btn-sm" data-action="br-prices" data-id="${x.b.id}">Prices</button>` : ''}</div></div>`).join('')}
        ${owner && on ? `<button class="btn btn-primary btn-block" data-action="br-add">+ Add branch</button>` : ''}
        ${owner && on && bl.length > 1 ? staffSection() : ''}
        <div class="form-row" style="margin-top:12px"><button class="btn btn-outline" data-view="transfers">Stock transfers</button><button class="btn btn-outline" data-view="audit">Audit log</button></div></div>`;
    }
  };
  A['hq-range'] = t => { HQ.range = t.dataset.v; H().redraw(); };
  function staffSection() {
    const l = C().staffList(); if (!l.length) return `<div class="doc-card"><div class="doc-label">Staff by branch</div><p class="text-sm text-secondary">Add staff users in App Lock, then choose which branch each one works in.</p></div>`;
    return `<div class="doc-card"><div class="doc-label">Staff by branch</div><p class="text-sm text-secondary">A staff member tied to a branch can only sell and see stock for that branch.</p>${l.map(sf => `<div class="tot-row" style="align-items:center"><span>${h(sf.name)}</span><select class="form-select" style="width:auto;padding:4px 8px" data-ch="br-staff" data-id="${sf.id}"><option value="">All branches</option>${allBranches().map(b => `<option value="${b.id}"${sf.branchId === b.id ? ' selected' : ''}>${h(b.name)}</option>`).join('')}</select></div>`).join('')}</div>`;
  }
  E.inputs['br-staff'] = el => { const sf = C().staffList().find(x => x.id === el.dataset.id); if (!sf) return; if (el.value) sf.branchId = el.value; else delete sf.branchId; E.audit('branch', `${sf.name} → ${el.value ? byId(el.value).name : 'all branches'}`); C().persist(); toast('Saved'); };
  E.perms['br-add'] = 'settings'; E.perms['br-save'] = 'settings'; E.perms['br-edit'] = 'settings'; E.perms['br-del'] = 'settings'; E.perms['br-prices'] = 'settings';
  A['br-add'] = () => { if (!featureOn()) return toast('Multi-branch is a Pro feature'); if (arr('branches').length >= 9) return toast('Up to 10 branches'); brForm({ id: '' }); };
  A['br-edit'] = t => brForm(t.dataset.id === 'main' ? Object.assign({}, mainB()) : Object.assign({}, arr('branches').find(b => b.id === t.dataset.id) || {}));
  function brForm(b) {
    H().modal(b.id ? 'Edit branch' : 'New branch', `<div class="modal-body"><div class="form-group"><label class="form-label">Branch name</label><input class="form-input" id="brN" maxlength="40" value="${h(b.name || '')}" placeholder="e.g. Gulberg Outlet"></div>
      <div class="form-row"><div class="form-group"><label class="form-label">Short code</label><input class="form-input" id="brC" maxlength="5" value="${h(b.code || '')}" placeholder="GLB" style="text-transform:uppercase"></div><div class="form-group"><label class="form-label">Phone</label><input class="form-input" id="brP" type="tel" value="${h(b.phone || '')}"></div></div>
      <div class="form-group"><label class="form-label">Address</label><input class="form-input" id="brA" value="${h(b.address || '')}"></div><div class="text-sm text-secondary">The code is added to bill numbers from this branch (e.g. GLB-INV-1042).</div>
      <button class="btn btn-primary btn-block" style="margin-top:10px" data-action="br-save" data-id="${b.id || ''}">Save</button>${b.id && b.id !== 'main' ? `<button class="btn btn-secondary btn-block" style="margin-top:8px" data-action="br-del" data-id="${b.id}">Close this branch</button>` : ''}</div>`);
  }
  A['br-save'] = t => {
    const v = id => (document.getElementById(id) || {}).value || '', name = v('brN').trim(), code = v('brC').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!name) return toast('Enter the branch name');
    if (allBranches().some(b => b.id !== (t.dataset.id || '') && ((b.code && b.code === code) || b.name.toLowerCase() === name.toLowerCase()))) return toast('Name or code already used');
    if (t.dataset.id === 'main') { S().mainBranchName = name; S().mainBranchCode = code; }
    else if (t.dataset.id) { const b = arr('branches').find(x => x.id === t.dataset.id); if (b) Object.assign(b, { name, code, phone: v('brP').trim(), address: v('brA').trim() }); }
    else arr('branches').push({ id: C().uid(), name, code, phone: v('brP').trim(), address: v('brA').trim(), active: true });
    E.audit('branch', (t.dataset.id ? 'Edited ' : 'Added ') + name); C().persist(); H().close(); H().redraw();
  };
  A['br-del'] = async t => {
    const b = arr('branches').find(x => x.id === t.dataset.id); if (!b) return;
    const held = C().products.filter(p => stockOf(p, b.id) > 0).length, open = arr('transfers').filter(x => x.status === 'transit' && (x.fromId === b.id || x.toId === b.id)).length;
    if (held || open) return toast(held ? 'Transfer this branch\'s stock out first' : 'Finish its open transfers first');
    if (!(await C().askConfirm(`Close ${b.name}? Its past bills stay in your reports.`, { okText: 'Close branch', danger: true }))) return;
    b.active = false; try { if (localStorage.getItem(LK) === b.id) localStorage.setItem(LK, 'main'); } catch (e) {} E.audit('branch', 'Closed ' + b.name); C().persist(); H().close(); H().redraw();
  };
  A['br-stock'] = t => {
    const b = byId(t.dataset.id), l = C().products.map(p => ({ p, q: stockOf(p, b.id) })).filter(x => x.q > 0).sort((a, c) => a.p.name.localeCompare(c.p.name));
    H().modal(h(b.name) + ' stock', `<div class="modal-body" style="max-height:70vh;overflow:auto">${l.length ? l.map(x => `<div class="tot-row"><span>${h(x.p.name)}</span><b>${x.q}</b></div>`).join('') + `<div class="tot-row"><span><b>Value at cost</b></span><b>${cur()} ${m(r2(l.reduce((a, x) => a + x.q * (Number(x.p.cost) || 0), 0)))}</b></div>` : H().empty('No stock at this branch')}</div>`);
  };
  // branch price list
  const BP = { id: 'main', q: '' };
  A['br-prices'] = t => { BP.id = t.dataset.id; BP.q = ''; bpModal(); };
  function bpModal() {
    const b = byId(BP.id), q = BP.q.toLowerCase(), ov = obj('bprice')[b.id] || {};
    const l = C().products.filter(p => !q || p.name.toLowerCase().includes(q)).slice(0, 40);
    H().modal(h(b.name) + ' prices', `<div class="modal-body" style="max-height:72vh;overflow:auto"><p class="text-sm text-secondary">Set a different selling price for this branch in Quick Sale. Leave empty to use the normal price.</p>${b.id === 'main' ? '<p class="text-sm" style="color:var(--danger)">Main branch uses the normal item price.</p>' : `<input class="search-input" data-in="bp-q" type="search" placeholder="Search item" value="${h(BP.q)}" id="bpQ" autocomplete="off">${l.map(p => `<div class="tot-row" style="align-items:center"><span>${h(p.name)} <small>${m(p.price)}</small></span><input class="form-input" style="width:90px;padding:6px" type="number" inputmode="decimal" min="0" step="any" placeholder="${p.price}" value="${ov[p.id] != null ? ov[p.id] : ''}" data-in="bp-val" data-id="${p.id}"></div>`).join('')}`}</div>`);
    const i = document.getElementById('bpQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
  E.inputs['bp-q'] = el => { BP.q = el.value; bpModal(); };
  E.inputs['bp-val'] = el => { const o = obj('bprice'); o[BP.id] = o[BP.id] || {}; if (el.value === '') delete o[BP.id][el.dataset.id]; else o[BP.id][el.dataset.id] = Math.max(0, parseFloat(el.value) || 0); C().persist(); };

  // ---------- transfers ----------
  const TF = { f: 'transit' }; let T = null;
  const nextTr = () => { let mx = 1000; arr('transfers').forEach(t => { const x = String(t.number).match(/(\d+)\s*$/); if (x) mx = Math.max(mx, +x[1]); }); return 'TR-' + (mx + 1); };
  E.views.transfers = {
    title: 'Stock Transfers', perm: 'items_view',
    right: () => active() && C().can('items_edit') ? `<button class="icon-btn" data-action="tr-new" aria-label="New">${C().ico('plus') || '+'}</button>` : '',
    html() {
      if (!active()) return `<div class="fade-in" style="padding:16px"><div class="doc-card"><p>Transfers need at least two branches. Add one under <a data-view="branches">Branches &amp; Head Office</a>.</p></div></div>`;
      const all = arr('transfers'), l = all.filter(t => TF.f === 'all' ? true : t.status === TF.f);
      return `<div class="fade-in" style="padding:12px 16px 40px"><div class="chip-row">${[['transit', 'On the way'], ['received', 'Received'], ['all', 'All']].map(x => `<button class="cat-chip${TF.f === x[0] ? ' active' : ''}" data-action="tr-f" data-v="${x[0]}">${x[1]}</button>`).join('')}</div>
        ${l.length ? l.map(t => `<div class="list-row" data-action="tr-open" data-id="${t.id}"><div class="list-row-left"><div><div class="list-row-label">${h(t.number)} · ${h(byId(t.fromId).name)} → ${h(byId(t.toId).name)}</div><div class="text-sm text-secondary">${C().formatDate(t.date)} · ${t.lines.length} items${t.short ? ' · <b style="color:var(--danger)">short</b>' : ''}</div></div></div><span class="list-item-badge ${t.status === 'transit' ? 'badge-low' : 'badge-ok'}">${t.status === 'transit' ? 'On the way' : 'Received'}</span></div>`).join('') : H().empty('No transfers here')}</div>`;
    }
  };
  A['tr-f'] = t => { TF.f = t.dataset.v; H().redraw(); };
  A['tr-new'] = () => { T = { fromId: curId(), toId: allBranches().find(b => b.id !== curId()).id, note: '', lines: [] }; H().go('transfer-new'); };
  E.perms['tr-new'] = 'items_edit'; E.perms['tr-send'] = 'items_edit'; E.perms['tr-recv-ok'] = 'items_edit';
  E.views['transfer-new'] = {
    title: 'New Transfer', perm: 'items_edit',
    html() {
      if (!T) A['tr-new']();
      const bl = allBranches(), lock = lockedTo();
      return `<div class="fade-in" style="padding:12px 16px 100px"><div class="doc-card"><div class="form-row"><div class="form-group"><label class="form-label">From</label><select class="form-select" data-ch="tr-from" ${lock ? 'disabled' : ''}>${bl.map(b => `<option value="${b.id}"${T.fromId === b.id ? ' selected' : ''}>${h(b.name)}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">To</label><select class="form-select" data-ch="tr-to">${bl.filter(b => b.id !== T.fromId).map(b => `<option value="${b.id}"${T.toId === b.id ? ' selected' : ''}>${h(b.name)}</option>`).join('')}</select></div></div></div>
        <div class="doc-card"><div class="doc-label">Items</div><input class="search-input" data-in="tr-q" type="search" placeholder="Search item to send…" id="trQ" autocomplete="off"><div id="trRes"></div><div id="trLines">${trLines()}</div></div>
        <div class="doc-card"><input class="form-input" id="trNote" placeholder="Note (optional)" maxlength="80" value="${h(T.note)}"></div>
        <div class="pos-cart"><div class="pos-cart-info"><span id="trN">${T.lines.length} items</span><strong id="trU">${T.lines.reduce((a, l) => a + l.qty, 0)} units</strong></div><button class="btn btn-primary" data-action="tr-send">Send stock</button></div></div>`;
    }
  };
  const trSum = () => { const n = document.getElementById('trN'), u = document.getElementById('trU'); if (n) n.textContent = T.lines.length + ' items'; if (u) u.textContent = T.lines.reduce((a, l) => a + l.qty, 0) + ' units'; };
  const trLines = () => T.lines.length ? T.lines.map((l, i) => { const p = C().products.find(x => x.id === l.productId); const have = p ? stockOf(p, T.fromId) : 0; return `<div class="pz-line" style="grid-template-columns:1fr auto 26px"><div class="pz-ln"><b>${h(l.name)}</b><small>Available here: ${have}</small></div><div class="pz-q"><input type="number" min="0" step="any" value="${l.qty}" data-in="tr-qty" data-i="${i}" ${l.qty > have ? 'style="border-color:var(--danger)"' : ''}></div><button class="pz-x" data-action="tr-rm" data-i="${i}">✕</button></div>`; }).join('') : '<div class="text-sm text-secondary" style="padding:8px 0">No items yet</div>';
  E.inputs['tr-from'] = el => { T.fromId = el.value; if (T.toId === T.fromId) T.toId = allBranches().find(b => b.id !== T.fromId).id; T.lines = []; H().redraw(); };
  E.inputs['tr-to'] = el => { T.toId = el.value; };
  E.inputs['tr-q'] = el => { const q = el.value.trim().toLowerCase(), r = document.getElementById('trRes'); if (!q) { r.innerHTML = ''; return; } r.innerHTML = C().products.filter(p => p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase() === q).slice(0, 6).map(p => `<div class="list-row" data-action="tr-add" data-id="${p.id}"><div class="list-row-left"><div class="list-row-label">${h(p.name)}</div></div><span class="text-sm text-secondary">${stockOf(p, T.fromId)} here</span></div>`).join('') || '<div class="text-sm text-secondary" style="padding:6px">No match</div>'; };
  A['tr-add'] = t => { const p = C().products.find(x => x.id === t.dataset.id); if (!p) return; if (!T.lines.find(l => l.productId === p.id)) T.lines.push({ productId: p.id, name: p.name, qty: 1 }); document.getElementById('trQ').value = ''; document.getElementById('trRes').innerHTML = ''; document.getElementById('trLines').innerHTML = trLines(); trSum(); };
  A['tr-rm'] = t => { T.lines.splice(+t.dataset.i, 1); document.getElementById('trLines').innerHTML = trLines(); trSum(); };
  E.inputs['tr-qty'] = el => { T.lines[+el.dataset.i].qty = Math.max(0, parseFloat(el.value) || 0); trSum(); };
  A['tr-send'] = () => {
    const c = C(); T.note = (document.getElementById('trNote') || {}).value || ''; T.lines = T.lines.filter(l => l.qty > 0);
    if (!T.lines.length) return toast('Add items to send');
    const bad = T.lines.find(l => { const p = c.products.find(x => x.id === l.productId); return !p || l.qty > stockOf(p, T.fromId) + 0.0001; });
    if (bad) return toast(`Not enough ${bad.name} at ${byId(T.fromId).name}`);
    T.lines.forEach(l => { if (T.fromId !== 'main') { const o = (bs()[l.productId] = bs()[l.productId] || {}); o[T.fromId] = r2((Number(o[T.fromId]) || 0) - l.qty); } });
    const tr = { id: c.uid(), number: nextTr(), date: new Date().toISOString(), fromId: T.fromId, toId: T.toId, note: T.note, status: 'transit', by: c.isStaff() ? c.staffName() : 'Owner', lines: T.lines.map(l => Object.assign({}, l)) };
    arr('transfers').unshift(tr); E.audit('transfer', `${tr.number} sent ${byId(tr.fromId).name} → ${byId(tr.toId).name} (${tr.lines.length} items)`); c.persist(); T = null; toast('Sent ' + tr.number); H().go('transfers'); setTimeout(() => A['tr-open']({ dataset: { id: tr.id } }), 250);
  };
  const trText = t => `*Stock transfer ${t.number}*\n${byId(t.fromId).name} → ${byId(t.toId).name}\n${C().formatDate(t.date)}\n\n` + t.lines.map(l => `• ${l.name} × ${l.qty}${l.got != null && l.got !== l.qty ? ' (received ' + l.got + ')' : ''}`).join('\n') + (t.note ? '\n' + t.note : '');
  A['tr-open'] = t => {
    const tr = arr('transfers').find(x => x.id === t.dataset.id); if (!tr) return; const lock = lockedTo(), canRecv = tr.status === 'transit' && (!lock || lock === tr.toId) && C().can('items_edit');
    H().modal(h(tr.number), `<div class="modal-body"><div class="text-sm text-secondary">${h(byId(tr.fromId).name)} → ${h(byId(tr.toId).name)} · ${C().formatDate(tr.date)} · by ${h(tr.by)}${tr.note ? '<br>' + h(tr.note) : ''}</div><div class="doc-card" style="margin:10px 0">${tr.lines.map(l => `<div class="tot-row"><span>${h(l.name)}</span><b>${l.qty}${l.got != null && l.got !== l.qty ? ` <small style="color:var(--danger)">(got ${l.got})</small>` : ''}</b></div>`).join('')}</div>
      <div class="form-row"><button class="btn btn-outline" data-action="tr-share" data-id="${tr.id}">Share</button>${canRecv ? `<button class="btn btn-primary" data-action="tr-recv" data-id="${tr.id}">Receive</button>` : ''}</div>${tr.status === 'transit' && !canRecv ? `<div class="text-sm text-secondary" style="margin-top:8px">Waiting for ${h(byId(tr.toId).name)} to receive it.</div>` : ''}</div>`);
  };
  A['tr-share'] = t => { const tr = arr('transfers').find(x => x.id === t.dataset.id); if (tr) H().shareAny(trText(tr)); };
  A['tr-recv'] = t => {
    const tr = arr('transfers').find(x => x.id === t.dataset.id); if (!tr) return;
    H().modal('Receive ' + h(tr.number), `<div class="modal-body" style="max-height:70vh;overflow:auto"><div class="text-sm text-secondary">Count what actually arrived at ${h(byId(tr.toId).name)}. Any difference is recorded as a loss.</div>${tr.lines.map(l => `<div class="tot-row" style="align-items:center"><span>${h(l.name)} <small>sent ${l.qty}</small></span><input class="form-input rc-q" style="width:84px;padding:6px" type="number" min="0" step="any" value="${l.qty}" data-id="${l.productId}"></div>`).join('')}<button class="btn btn-primary btn-block" style="margin-top:10px" data-action="tr-recv-ok" data-id="${tr.id}">Confirm received</button></div>`);
  };
  A['tr-recv-ok'] = () => {
    const c = C(), btn = document.querySelector('[data-action="tr-recv-ok"]'), tr = arr('transfers').find(x => x.id === (btn && btn.dataset.id)); if (!tr || tr.status !== 'transit') return;
    const now = new Date().toISOString(); let shortN = 0;
    tr.lines.forEach(l => {
      const i = document.querySelector(`.rc-q[data-id="${l.productId}"]`), got = Math.max(0, Math.min(l.qty, parseFloat(i && i.value) || 0)); l.got = got; const lost = r2(l.qty - got);
      if (tr.toId !== 'main') { const o = (bs()[l.productId] = bs()[l.productId] || {}); o[tr.toId] = r2((Number(o[tr.toId]) || 0) + got); }
      if (lost > 0.0001) { shortN++; const p = c.products.find(x => x.id === l.productId); if (p) { p.stock = r2(Math.max(0, (Number(p.stock) || 0) - lost)); c.stockMovements.unshift({ id: c.uid(), productId: p.id, productName: p.name, type: 'out', qty: lost, date: now, note: `Adjust: Lost in transfer ${tr.number}` }); } }
    });
    tr.status = 'received'; tr.receivedAt = now; tr.receivedBy = c.isStaff() ? c.staffName() : 'Owner'; tr.short = shortN > 0;
    E.audit('transfer', `${tr.number} received at ${byId(tr.toId).name}${shortN ? ' (' + shortN + ' short)' : ''}`); c.persist(); H().close(); toast('Received'); H().redraw();
  };

  // ---------- audit log ----------
  const AU = { f: 'all' };
  E.views.audit = {
    title: 'Audit Log', perm: 'reports',
    html() {
      const ap = arr('approvals').map(a => ({ t: a.t, by: a.by, type: 'approval', detail: `${a.for || 'Staff'} needed ${a.perm}${a.action ? ' (' + a.action + ')' : ''}; approved by ${a.by}` }));
      let l = arr('audit').concat(ap).sort((a, b) => (a.t < b.t ? 1 : -1)); if (AU.f !== 'all') l = l.filter(x => x.type === AU.f);
      const types = ['all', 'approval', 'branch', 'transfer', 'shift', 'return', 'purchase', 'count', 'expiry', 'price', 'restore'];
      return `<div class="fade-in" style="padding:12px 16px 40px"><div class="chip-row" style="flex-wrap:nowrap;overflow-x:auto">${types.map(x => `<button class="cat-chip${AU.f === x ? ' active' : ''}" data-action="au-f" data-v="${x}">${x === 'all' ? 'All' : x}</button>`).join('')}</div>
        ${l.length ? l.slice(0, 150).map(x => `<div class="list-row" style="cursor:default"><div class="list-row-left" style="min-width:0"><div style="min-width:0"><div class="list-row-label" style="white-space:normal">${h(x.detail)}</div><div class="text-sm text-secondary">${H().dt(x.t)} · ${h(x.by)} · ${h(x.type)}${x.br && x.br !== 'main' && active() ? ' · ' + h(byId(x.br).name) : ''}</div></div></div></div>`).join('') : H().empty('Nothing recorded yet')}
        <p class="text-sm text-secondary" style="margin-top:12px">Records approvals, returns, shift closes, stock counts, transfers, goods received, write-offs and restores. Keeps the last 300 entries.</p></div>`;
    }
  };
  A['au-f'] = t => { AU.f = t.dataset.v; H().redraw(); };
})();
