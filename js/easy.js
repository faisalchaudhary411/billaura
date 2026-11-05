/* Billaura Simple Mode: a short Home, a short Menu, a 4-button nav and one-tap cash sales.
   Full view stays available (Menu -> Show all features). */
(function () {
  'use strict';
  const E = window.BillauraExt; if (!E) return;
  const C = () => window.BillauraCore, H = () => E.helpers, A = E.actions;
  const h = s => C().escapeHtml(s), m = n => C().money(n), r2 = n => C().round2(n), S = () => C().settings, cur = () => S().currency || 'Ris';
  const money = n => (S().currency || 'Rs') + ' ' + m(n);
  const can = p => C().can(p);

  E.simple = () => { try { return !!C() && S().uiMode === 'simple'; } catch (e) { return false; } };
  const baseInit = E.init;
  E.init = function () {
    baseInit && baseInit();
    const c = C(); if (S().uiMode) return;
    if (c.invoices.length <= 3 && c.products.length <= 15) { S().uiMode = 'simple'; c.persist(); }
  };
  const IC = {
    sale: '<path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6L5 3H2"/><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/>',
    money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
    box: '<path d="M21 16V8l-9-5-9 5v8l9 5z"/><path d="M3.3 7L12 12l8.7-5M12 22V12"/>',
    exp: '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    ret: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
    rep: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>'
  };
  const svg = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${IC[n] || ''}</svg>`;
  const tile = (icon, label, attr) => `<button type="button" class="ez-tile" ${attr}><span class="ez-ti">${svg(icon)}</span><span>${label}</span></button>`;

  // ---------- Home ----------
  function dayCard() {
    if (S().hideDay) return '';
    const sh = S().shiftOpen;
    if (!can('sales')) return '';
    if (!sh) return `<div class="ez-day"><div><b>Start your day</b><small>Count the cash in the drawer. Tonight the app tells you if anything is missing.</small></div><div class="ez-day-b"><button class="btn btn-primary btn-sm" data-action="ez-start">Start day</button><a data-action="ez-hideday">Not needed</a></div></div>`;
    const st = H().shiftStats(sh.openedAt, null, sh);
    return `<div class="ez-day open"><div><b>Day started · ${new Date(sh.openedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</b><small>Cash in drawer should be <b>${money(st.expected)}</b></small></div><div class="ez-day-b"><button class="btn btn-outline btn-sm" data-action="ez-end">End day</button></div></div>`;
  }
  function todayCard() {
    if (!can('reports') && !can('sales')) return '';
    const d = H().dayReport(H().today()), k = d.st, net = r2(k.total - k.returns);
    return `<div class="ez-today"><div><small>Sales today</small><b>${money(net)}</b></div><div><small>Bills</small><b>${k.count}</b></div><div><small>Money received</small><b>${money(d.collected)}</b></div></div>`;
  }
  function recent() {
    const l = C().invoices.filter(i => i.docType !== 'estimate').slice(0, 5);
    if (!l.length) return '';
    return `<div class="ez-h"><span>Recent</span><a data-view="invoices">See all</a></div><div class="ez-list">${l.map(i => `<div class="ez-row" data-action="view-invoice" data-id="${i.id}"><div><b>${h(i.customerName || 'Walk-in')}</b><small>${h(i.number)} · ${new Date(i.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}${i.docType === 'return' ? ' · return' : ''}</small></div><div class="ez-amt${i.docType === 'return' ? ' neg' : ''}">${i.docType === 'return' ? '−' : ''}${m(i.total)}${i.paidAmount + 0.001 < i.total && i.docType !== 'return' ? '<small>unpaid</small>' : ''}</div></div>`).join('')}</div>`;
  }
  function alerts() {
    let a = '';
    try { a += (E.homeAlerts && E.homeAlerts()) || ''; } catch (e) {}
    try { const low = C().lowStockItems(); if (low.length) a += `<div class="home-alert warn"><div class="ha-t"><b>${low.length} item${low.length === 1 ? '' : 's'} running low</b><span>${h(low.slice(0, 2).map(p => p.name).join(', '))}${low.length > 2 ? '…' : ''}</span></div><button data-view="low-stock">View</button></div>`; } catch (e) {}
    return a ? `<div class="ez-alerts">${a}</div>` : '';
  }
  function setupCard() {
    const c = C(); if (c.products.length > 0) return '';
    return `<div class="ez-setup"><b>Let's get you started</b><ol><li><a data-action="add-product">Add your items</a> <small>name and price is enough</small></li><li><a data-view="business-profile">Add your shop name and phone</a> <small>it prints on bills</small></li><li><a data-view="pos">Make your first sale</a></li></ol></div>`;
  }
  E.views.home = {
    when: () => E.simple(),
    title: () => S().businessName || 'Billaura',
    right: () => `<button class="icon-btn ${C().unread() ? 'header-dot' : ''}" data-view="notifications" aria-label="Notifications">${C().ico('bell')}</button><button class="icon-btn" data-view="settings" aria-label="Settings">${C().ico('gear')}</button>`,
    html() {
      const tiles = [];
      if (can('receive_payment')) tiles.push(tile('money', 'Dues &amp; payments', 'data-view="payment-reminders"'));
      if (can('purchases')) tiles.push(tile('box', 'Stock in', 'data-action="new-purchase"'));
      if (can('expenses')) tiles.push(tile('exp', 'Expense', 'data-action="add-expense"'));
      tiles.push(tile('ret', 'Return', 'data-view="returns"'));
      if (can('items_view')) tiles.push(tile('box', 'Items', 'data-view="products"'));
      if (can('reports')) tiles.push(tile('rep', 'Reports', 'data-view="daily-report"'));
      return `<div class="fade-in ez-home">${setupCard()}${dayCard()}
        ${can('sales') ? `<button type="button" class="ez-sale" data-view="pos"><span>${svg('sale')}</span><b>New Sale</b><small>Tap items, tap Cash. Done.</small></button>` : ''}
        <div class="ez-grid">${tiles.join('')}</div>${todayCard()}${alerts()}${recent()}
        <div class="ez-foot"><a data-action="ez-full">Show all features</a></div></div>`;
    }
  };
  // ---------- Menu ----------
  const row = (ic, l, a) => H().row(ic, l, a);
  E.views.more = {
    when: () => E.simple() && !C().isStaff(),
    title: 'Menu',
    html() {
      const sec = (t, items) => `<div class="menu-card"><div class="menu-h">${t}</div>${items.filter(Boolean).join('')}</div>`;
      return `<div class="fade-in" style="padding:8px 0 24px">
        ${sec('Sell', [row('sale', 'Sales &amp; bills', 'data-view="invoices"'), row('sale', 'Full invoice / quotation', 'data-view="create-invoice"'), row('users', 'Customers &amp; dues', 'data-view="customers"'), row('return', 'Return / Exchange', 'data-view="returns"')])}
        ${sec('Stock', [row('box', 'Items', 'data-view="products"'), row('cart', 'Stock in (purchases)', 'data-view="purchases"'), row('box', 'Low stock', 'data-view="low-stock"'), row('box', 'Fix stock (damage, count)', 'data-view="stock-adjust"')])}
        ${sec('Money', [row('wallet', 'Expenses', 'data-view="expenses"'), row('cash', 'Cash &amp; bank', 'data-view="cash-in-hand"'), row('report', 'Day book', 'data-view="daybook-detail"')])}
        ${sec('Reports', [row('report', 'Daily report', 'data-view="daily-report"'), row('report', 'Profit &amp; loss', 'data-view="profit-loss"'), row('report', 'All reports', 'data-view="reports"')])}
        ${sec('My shop', [row('company', 'Shop details &amp; bill', 'data-view="business-profile"'), row('print', 'Printer &amp; receipts', 'data-view="print-settings"'), row('sync', 'Backup &amp; restore', 'data-view="backup"'), row('sync', 'Account &amp; cloud', 'data-view="account"'), row('gear', 'Settings', 'data-view="settings"'), S().hideDay ? row('cash', 'Show Start / End day', 'data-action="ez-showday"') : ''])}
        <div class="ez-foot"><a data-action="ez-full">Show all features</a></div></div>`;
    }
  };
  // ---------- actions ----------
  A['ez-full'] = async () => { if (!(await C().askConfirm('Switch to the full view with every tool (purchase orders, stock count, expiry, branches, audit log and more)? You can come back to Simple view any time.', { title: 'Show all features', okText: 'Show all' }))) return; S().uiMode = 'full'; C().persist(); C().setView('home', { replace: true }); };
  A['ez-simple'] = () => { S().uiMode = 'simple'; C().persist(); C().setView('home', { replace: true }); };
  A['ez-hideday'] = () => { S().hideDay = true; C().persist(); H().redraw(); };
  A['ez-showday'] = () => { S().hideDay = false; C().persist(); toast('Start / End day is back on Home'); H().redraw(); };
  const toast = t => C().toast(t);
  A['ez-start'] = () => {
    const last = (S().shifts || [])[0];
    H().modal('Start your day', `<div class="modal-body"><p class="text-sm text-secondary">How much cash is in the drawer right now?</p><input class="form-input" id="shOpen" type="number" inputmode="decimal" min="0" step="any" value="${last ? last.counted : ''}" placeholder="0" style="font-size:1.4rem;text-align:center"><button class="btn btn-primary btn-block btn-lg" style="margin-top:12px" data-action="sh-open">Start day</button>${last ? `<div class="text-sm text-secondary" style="margin-top:8px">Filled in from last night's count.</div>` : ''}</div>`);
  };
  A['ez-end'] = () => {
    const sh = S().shiftOpen; if (!sh) return; const st = H().shiftStats(sh.openedAt, null, sh);
    H().modal('End your day', `<div class="modal-body"><div class="ez-today" style="margin:0 0 10px"><div><small>Sales so far</small><b>${money(r2(st.total - st.returns))}</b></div><div><small>Cash should be</small><b>${money(st.expected)}</b></div></div><p class="text-sm text-secondary">Count the cash in the drawer and type it here.</p><input class="form-input" id="shCount" type="number" inputmode="decimal" min="0" step="any" placeholder="Cash counted" style="font-size:1.4rem;text-align:center"><input type="hidden" id="shNote" value=""><button class="btn btn-primary btn-block btn-lg" style="margin-top:12px" data-action="sh-close">Close day &amp; show report</button><div class="text-sm text-secondary" style="margin-top:8px">A backup is saved automatically.</div></div>`);
  };
  // ---------- first choice for existing shops ----------
  function askMode() {
    H().modal('Choose your view', `<div class="modal-body"><p class="text-sm text-secondary">Billaura now has a Simple view with a short Home and Menu. Everything is still there under "Show all features".</p><button class="btn btn-primary btn-block btn-lg" data-action="ez-pick" data-v="simple">Simple view (recommended)</button><button class="btn btn-outline btn-block" style="margin-top:8px" data-action="ez-pick" data-v="full">Keep the full view</button></div>`);
  }
  A['ez-pick'] = t => { S().uiMode = t.dataset.v; C().persist(); H().close(); C().setView('home', { replace: true }); };
  // ---------- nav ----------
  const navKeep = {};
  function adjustNav(view) {
    const items = document.querySelectorAll('#bottomNav .nav-item'); if (items.length < 2) return;
    const s = E.simple(), b = items[1], pc = document.getElementById('navDesktop');
    if (!navKeep.html) navKeep.html = b.innerHTML, navKeep.view = b.dataset.view, navKeep.label = b.getAttribute('aria-label');
    if (s) {
      b.dataset.view = 'pos'; b.setAttribute('aria-label', 'Sale'); b.innerHTML = `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC.sale}</svg><span>Sale</span>`;
      b.style.display = can('sales') ? '' : 'none'; if (pc) pc.style.display = 'none';
      items.forEach(n => n.classList.toggle('active', n.dataset.view === (view === 'pos' ? 'pos' : (['invoices', 'create-invoice'].includes(view) ? 'home' : n.dataset.view === 'pos' ? '' : document.querySelector('#bottomNav .nav-item.active') ? (document.querySelector('#bottomNav .nav-item.active').dataset.view) : ''))));
    } else if (navKeep.html && b.dataset.view === 'pos') { b.dataset.view = navKeep.view; b.setAttribute('aria-label', navKeep.label); b.innerHTML = navKeep.html; }
  }
  const prevAfter = E.afterRender;
  E.afterRender = function (view, el) {
    prevAfter && prevAfter(view, el);
    adjustNav(view);
    if (view === 'home' && !S().uiMode && !window._ezAsked) { window._ezAsked = true; setTimeout(askMode, 400); }
  };
  const mc = E.menuCard;
  E.menuCard = () => { const x = mc ? mc() : ''; return x.replace(/<\/div>\s*$/, `<div class="list-row" data-action="ez-simple"><div class="list-row-left"><div class="list-row-icon">${C().ico('home')}</div><div><div class="list-row-label">Switch to Simple view</div></div></div><span class="chev">›</span></div></div>`); };
})();
