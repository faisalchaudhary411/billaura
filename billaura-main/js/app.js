/* ============================================
   Billaura v2 – Full Inventory + Invoicing
   ============================================ */

(function () {
  'use strict';

  const APP_VERSION = '2.3.0';

  const STORAGE = {
    products: 'sb_products_v2',
    invoices: 'sb_invoices_v2',
    customers: 'sb_customers_v2',
    suppliers: 'sb_suppliers_v2',
    expenses: 'sb_expenses_v2',
    stockMovements: 'sb_stock_v2',
    purchases: 'sb_purchases_v2',
    banks: 'sb_banks_v2',
    bankTxns: 'sb_bank_txns_v2',
    otherIncome: 'sb_other_income_v2',
    loans: 'sb_loans_v2',
    settings: 'sb_settings_v2',
    counter: 'sb_counter_v2',
    tombs: 'sb_tombstones_v3'      // ids deleted locally, waiting to be deleted in the cloud
  };
  const OWNER_KEY = 'billaura_data_owner_v1';        // which account the local data belongs to
  const LEGACY_FLAG = 'sb_legacy_reset_pending';    // v1 -> v2 id migration needs a clean cloud
  const askConfirm = (m, o) => BillauraUI.confirm(m, o);
  const askPrompt = (m, d, o) => BillauraUI.prompt(m, d, o);
  const askChoice = (m, l, o) => BillauraUI.choice(m, l, o);
  const SYNC_COLLECTIONS = ['products', 'customers', 'suppliers', 'invoices', 'expenses', 'stockMovements', 'purchases'];
  const DB_TABLE = { stockMovements: 'stock_movements' };
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }
  let _storageWarned = false;
  function save(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      // Storage full (logo/QR images are big) - tell the user instead of silently losing data
      if (!_storageWarned) {
        _storageWarned = true;
        try { toast('Storage is full! Export a backup and remove old data.', 6000); } catch (_) {}
      }
      console.error('save failed', key, e);
    }
  }

  let products = load(STORAGE.products, []);
  let invoices = load(STORAGE.invoices, []);
  let customers = load(STORAGE.customers, []);
  let suppliers = load(STORAGE.suppliers, []);
  let expenses = load(STORAGE.expenses, []);
  let stockMovements = load(STORAGE.stockMovements, []);
  let purchases = load(STORAGE.purchases, []);
  let banks = load(STORAGE.banks, []);
  let bankTxns = load(STORAGE.bankTxns, []);
  let otherIncome = load(STORAGE.otherIncome, []);
  let loans = load(STORAGE.loans, []);
  function defaultSettings() {
    return {
      businessName: 'My Business',
      ownerName: '',
      phone: '',
      email: '',
      address: '',
      city: '',
      taxId: '',
      currency: 'Rs',
      invoicePrefix: 'INV',
      taxRate: 0,
      invoiceTheme: 'royal',
      pinSalt: '',
      pinHash: '',
      staffHash: '',
      lowStockDefault: 5,
      logo: '',
      favourites: [],
      signature: '',
      stamp: '',
      paymentQr: '',
      paymentNote: 'Pay via JazzCash / EasyPaisa / Bank',
      baseCurrency: 'PKR',
      currencies: [],
      remindersEnabled: false,

      // Feature flags (toggles)
      enableStock: true,
      enableItemUnits: true,
      enableItemCategory: true,
      enableBarcode: false,
      enableItemTax: false,
      enableItemDiscount: false,
      qtyDecimals: 2,
      enablePartyShipping: false,
      enablePartyGrouping: false,
      enablePartyTIN: false,
      enableInvoiceNumber: true,
      enableCashSaleDefault: false,
      enableInclusiveTax: true,
      enableDisplayPurchasePrice: true,
      enableTxnTax: true,
      enableTxnDiscount: true,
      enableRoundOff: false,
      enableTerms: true,
      enableInvoicePreview: true,
      printCompanyName: true,
      printLogo: true,
      printAddress: true,
      printEmail: true,
      printPhone: true,
      printTaxDetails: true,
      printAmountInWords: true,
      printReceivedAmount: true,
      printBalanceAmount: true,
      printTerms: true,
      printSignature: true,
      printPageNumbers: true,
      amountWordsFormat: 'indian',
      thermalPageSize: '80',
      dateFormat: 'dd/MM/yyyy',
      decimalPlaces: 2,
      appLanguage: 'en'
    };
  }
  let settings = Object.assign(defaultSettings(), load(STORAGE.settings, {}));
  let invoiceCounter = load(STORAGE.counter, 1001);
  let docCtx = {};                 // {type:'return', ref:invoice} set before opening the create form
  let tombs = load(STORAGE.tombs, {});

  let currentView = 'home';
  let viewStack = [];
  let previousView = null;
  let editingId = null;
  let scanner = null;

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];

  // Real UUIDs: they are also the primary keys in the cloud database
  function uid() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function lowLimit(p) { return (p.lowStock ?? settings.lowStockDefault); }
  function money(n) {
    const v = Number(n) || 0, whole = Math.abs(v - Math.round(v)) < 0.005;   // 1,200 or 1,200.50 (never 1,200.5)
    return v.toLocaleString('en-PK', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  }
  function formatDate(iso) {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function initials(name) {
    return (name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }
  function escapeHtml(str) {
    if (str === 0) return '0';
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // Custom dropdown helper (searchable, matches app design)

  function invoiceBelongsToCustomer(inv, customerId, customerName, customerPhone) {
    if (customerId && inv.customerId === customerId) return true;
    const invName = (inv.customerName || '').trim().toLowerCase();
    const name = (customerName || '').trim().toLowerCase();
    if (!name || invName !== name) return false;
    // Same name: also match phone if both have phone
    const invPhone = (inv.customerPhone || '').replace(/\D/g, '');
    const phone = (customerPhone || '').replace(/\D/g, '');
    if (phone && invPhone) return invPhone === phone || invPhone.endsWith(phone) || phone.endsWith(invPhone);
    // If invoice has customerId pointing elsewhere, don't steal it
    if (inv.customerId && customerId && inv.customerId !== customerId) return false;
    return true;
  }

  // Document kinds: 'sale' (default), 'return' (credit note, reverses a sale), 'estimate' (no effect on books)
  function docSign(inv) { return inv.docType === 'return' ? -1 : (inv.docType === 'estimate' ? 0 : 1); }
  function docWord(inv) { return inv.docType === 'return' ? 'Credit Note' : (inv.docType === 'estimate' ? 'Quotation' : 'Invoice'); }
  function nextDocNumber(prefix) {
    let mx = 1000;
    invoices.forEach(i => {
      const m = String(i.number).match(/^(.*?)-?(\d+)\s*$/);
      if (m && m[1] === prefix) mx = Math.max(mx, parseInt(m[2], 10));
    });
    return `${prefix}-${mx + 1}`;
  }
  function returnedQty(refId) {
    const r = {};
    invoices.forEach(i => {
      if (i.docType === 'return' && i.meta && i.meta.refId === refId) (i.items || []).forEach(it => { r[it.productId] = (r[it.productId] || 0) + (it.qty || 0); });
    });
    return r;
  }
  // Net sales / cost / receivable across all documents (returns subtract, estimates ignored)
  function netTotals() {
    let revenue = 0, cogs = 0, recv = 0;
    invoices.forEach(i => {
      const g = docSign(i); if (!g) return;
      revenue += g * (i.total || 0);
      cogs += g * (i.items || []).reduce((a, it) => a + ((it.cost || 0) * it.qty), 0);
      recv += g * Math.max(0, (i.total || 0) - (i.paidAmount || 0));
    });
    return { revenue: round2(revenue), cogs: round2(cogs), receivable: Math.max(0, round2(recv)) };
  }

  function customerBalance(customerId, customerName, customerPhone) {
    let net = 0, paid = 0, total = 0, count = 0;
    invoices.forEach(inv => {
      if (!invoiceBelongsToCustomer(inv, customerId, customerName, customerPhone)) return;
      const g = docSign(inv); if (!g) return;
      total += g * (inv.total || 0);
      paid += g * (inv.paidAmount || 0);
      { const rem = (inv.total || 0) - (inv.paidAmount || 0); net += g * (g > 0 ? rem : Math.max(0, rem)); }   // an overpaid sale becomes customer credit
      count++;
    });
    return { due: Math.max(0, round2(net)), credit: Math.max(0, round2(-net)), paid, total, count };
  }

  function findOrCreateCustomer(name, phone) {
    name = (name || '').trim();
    phone = (phone || '').trim();
    if (!name || name === 'Walk-in Customer') return null;
    const phoneDigits = phone.replace(/\D/g, '');
    // Prefer match by name + phone
    let c = customers.find(x => {
      const sameName = x.name.toLowerCase() === name.toLowerCase();
      if (!sameName) return false;
      if (!phoneDigits) return true;
      const xp = (x.phone || '').replace(/\D/g, '');
      return !xp || xp === phoneDigits || xp.endsWith(phoneDigits) || phoneDigits.endsWith(xp);
    });
    if (c) {
      if (phone && !c.phone) { c.phone = phone; persist(); }
      return c;
    }
    // Exact name only if unique
    const sameName = customers.filter(x => x.name.toLowerCase() === name.toLowerCase());
    if (sameName.length === 1 && !phoneDigits) return sameName[0];
    // Create new (respect the Free-plan customer limit instead of silently exceeding it)
    if (window.HisablyFreemium && !HisablyFreemium.canAdd('customers', customers.length).ok) return null;
    c = { id: uid(), name, phone, address: '', notes: '' };
    customers.push(c);
    persist();
    return c;
  }

  // One-time migration: link invoices to customers by name, migrate old storage keys
  function getList(n) {
    return { products, customers, suppliers, invoices, expenses, stockMovements, purchases }[n];
  }
  function setList(n, list) {
    if (n === 'products') products = list;
    else if (n === 'customers') customers = list;
    else if (n === 'suppliers') suppliers = list;
    else if (n === 'invoices') invoices = list;
    else if (n === 'expenses') expenses = list;
    else if (n === 'stockMovements') stockMovements = list;
    else if (n === 'purchases') purchases = list;
  }
  function ts(x) { const t = Date.parse(x); return isNaN(t) ? 0 : t; }

  // Backups / old data may be missing fields - never let that crash a screen
  function normalizeData() {
    const nowIso = new Date().toISOString();
    SYNC_COLLECTIONS.forEach(n => {
      const list = getList(n);
      if (!Array.isArray(list)) { setList(n, []); return; }
      setList(n, list.filter(r => r && typeof r === 'object'));
    });
    products.forEach(p => {
      p.name = String(p.name || 'Unnamed');
      p.price = Number(p.price) || 0; p.cost = Number(p.cost) || 0;
      p.stock = Math.round(Number(p.stock) || 0);
      p.updatedAt = p.updatedAt || p.createdAt || nowIso;
    });
    customers.forEach(c => { c.name = String(c.name || 'Unnamed'); c.updatedAt = c.updatedAt || nowIso; });
    suppliers.forEach(c => { c.name = String(c.name || 'Unnamed'); c.updatedAt = c.updatedAt || nowIso; });
    expenses.forEach(e => {
      e.amount = Number(e.amount) || 0;
      e.date = e.date || nowIso.slice(0, 10);
      e.updatedAt = e.updatedAt || e.date || nowIso;
    });
    invoices.forEach(i => {
      if (!Array.isArray(i.items)) i.items = [];
      i.total = Number(i.total) || 0;
      i.paidAmount = Number(i.paidAmount) || 0;
      i.number = String(i.number == null ? '' : i.number);
      i.docType = i.docType || 'sale';
      if (!i.meta || typeof i.meta !== 'object') i.meta = {};
      i.date = i.date || nowIso;
      i.updatedAt = i.updatedAt || i.date;
    });
    purchases.forEach(p => {
      if (!Array.isArray(p.items)) p.items = [];
      p.total = Number(p.total) || 0; p.paidAmount = Number(p.paidAmount) || 0;
      p.number = String(p.number == null ? '' : p.number); p.date = p.date || nowIso;
      p.updatedAt = p.updatedAt || p.date;
      if (!p.meta || typeof p.meta !== 'object') p.meta = {};
    });
    stockMovements.forEach(m => { m.qty = Number(m.qty) || 0; m.date = m.date || nowIso; m.updatedAt = m.updatedAt || m.date; });
    // Never reuse an invoice number that already exists (other device / restored backup)
    const maxNum = invoices.reduce((mx, i) => {
      const m = String(i.number).match(/(\d+)\s*$/);
      return m ? Math.max(mx, parseInt(m[1], 10)) : mx;
    }, 0);
    if (maxNum >= invoiceCounter) invoiceCounter = maxNum + 1;
  }

  // v1 used non-UUID ids. The cloud needs UUIDs, so convert once and fix references.
  function migrateIds() {
    const map = { products: {}, customers: {} };
    let legacy = false;
    const fix = (list, key) => list.forEach(r => {
      if (!r.id || !UUID_RE.test(r.id)) {
        const n = uid();
        if (r.id && key) map[key][r.id] = n;
        r.id = n;
        legacy = true;
      }
    });
    fix(products, 'products'); fix(customers, 'customers'); fix(suppliers);
    fix(expenses); fix(invoices); fix(stockMovements);
    if (!legacy) return;
    const remap = (val, m) => (val ? (m[val] || (UUID_RE.test(val) ? val : null)) : val);
    invoices.forEach(inv => {
      inv.customerId = remap(inv.customerId, map.customers);
      (inv.items || []).forEach(it => { it.productId = remap(it.productId, map.products); });
    });
    stockMovements.forEach(m => { m.productId = remap(m.productId, map.products); });
    try { localStorage.setItem(LEGACY_FLAG, '1'); } catch (e) {}
    saveAll();
  }

  // ---- change tracking: stamps updatedAt on edited records, tombstones deleted ones ----
  let _snap = {};
  let _settingsSnap = '';
  let _snapReady = false;
  function snapKey(r) { const { updatedAt, ...rest } = r; return JSON.stringify(rest); }
  function settingsKey() { const { updatedAt, ...rest } = settings; return JSON.stringify(rest); }
  function resnap() {
    SYNC_COLLECTIONS.forEach(n => {
      const m = new Map();
      getList(n).forEach(r => { if (r && r.id) m.set(r.id, snapKey(r)); });
      _snap[n] = m;
    });
    _settingsSnap = settingsKey();
    _snapReady = true;
  }
  function stampChanges() {
    if (!_snapReady) resnap();
    const now = new Date().toISOString();
    SYNC_COLLECTIONS.forEach(n => {
      const old = _snap[n] || new Map();
      const cur = new Map();
      getList(n).forEach(r => {
        if (!r.id) r.id = uid();
        const k = snapKey(r);
        if (old.get(r.id) !== k || !r.updatedAt) r.updatedAt = now;
        cur.set(r.id, k);
      });
      old.forEach((_, id) => {
        if (!cur.has(id)) (tombs[n] = tombs[n] || {})[id] = now;
      });
      if (tombs[n]) cur.forEach((_, id) => { delete tombs[n][id]; });
      _snap[n] = cur;
    });
    const sk = settingsKey();
    if (sk !== _settingsSnap) { settings.updatedAt = now; _settingsSnap = sk; }
  }

  function migrateData() {
    try {
      if (!localStorage.getItem('sb_migrated_v3')) {
        ['products','invoices','customers','suppliers'].forEach(k => {
          const old = localStorage.getItem('stockbill_' + k) || localStorage.getItem('sb_' + k);
          if (old && !localStorage.getItem('sb_' + k + '_v2')) {
            localStorage.setItem('sb_' + k + '_v2', old);
          }
        });
        localStorage.setItem('sb_migrated_v3', '1');
      }
    } catch(e) {}
    normalizeData();
    migrateIds();
    if (!_snapReady) resnap();
    // Link orphan invoices to customers by name/phone
    let changed = false;
    invoices.forEach(inv => {
      if (inv.customerId) return;
      const name = (inv.customerName || '').trim();
      if (!name || name === 'Walk-in Customer') return;
      const c = findOrCreateCustomer(name, inv.customerPhone || '');
      if (c) { inv.customerId = c.id; changed = true; }
    });
    if (changed) persist();
  }


  function customSelect(name, options, selectedValue, placeholder, searchable) {
    const selected = options.find(o => o.value === selectedValue) || options[0];
    const label = selected ? selected.label : (placeholder || 'Select...');
    const searchHtml = searchable ? `
      <div class="custom-select-search">
        <input type="search" class="custom-select-search-input" placeholder="Search..." data-action="filter-select" autocomplete="off" />
      </div>` : '';
    return `
      <div class="custom-select${searchable ? ' searchable' : ''}" data-name="${name}">
        <input type="hidden" name="${name}" value="${escapeHtml(selectedValue || '')}" class="custom-select-hidden" />
        <button type="button" class="custom-select-trigger" data-action="toggle-select">${escapeHtml(label)}</button>
        <div class="custom-select-options">
          ${searchHtml}
          <div class="custom-select-options-list">
            ${options.map(o => `
              <div class="custom-select-option ${o.value === selectedValue ? 'selected' : ''}"
                   data-action="select-option" data-value="${escapeHtml(o.value)}" data-label="${escapeHtml(o.label)}" data-search="${escapeHtml((o.label || '').toLowerCase())}">
                ${escapeHtml(o.label)}
              </div>`).join('')}
          </div>
        </div>
      </div>`;
  }
  let _toastTimer = null;
  // Never show developer-style errors to shop owners
  function friendlyMsg(m) {
    const t = String(m == null ? '' : m);
    if (/failed to fetch|networkerror|load failed|network request|fetch failed/i.test(t)) return 'No internet connection. Check your connection and try again.';
    if (/row-level security|permission denied|\brls\b/i.test(t)) return 'You are not allowed to do that. Please sign in again.';
    if (/\bjwt\b/i.test(t)) return 'Your session expired. Please sign in again.';
    if (/pgrst|does not exist|syntax error|violates|duplicate key|supabase|\bsql\b|edge function|deploy|\.md\b|\.js\b|typeerror|referenceerror|is not a function|undefined|cannot read|\bhttp \d{3}\b|\bdb (get|post|patch)/i.test(t)) return 'Something went wrong. Please try again. If it keeps happening, contact support.';
    return t;
  }

  function toast(msg, ms = 2500) {
    msg = friendlyMsg(msg);
    const el = $('#toast');
    if (!el) return;
    clearTimeout(_toastTimer);
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('show'));
    _toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.hidden = true, 250);
    }, ms);
  }
  let _cloudPushTimer = null;
  let _cloudSyncing = false;
  let _cloudAutoEnabled = true; // auto push/pull when signed in

  function saveAll() {
    save(STORAGE.products, products);
    save(STORAGE.invoices, invoices);
    save(STORAGE.customers, customers);
    save(STORAGE.suppliers, suppliers);
    save(STORAGE.expenses, expenses);
    save(STORAGE.stockMovements, stockMovements);
    save(STORAGE.purchases, purchases);
    save(STORAGE.banks, banks);
    save(STORAGE.bankTxns, bankTxns);
    save(STORAGE.otherIncome, otherIncome);
    save(STORAGE.loans, loans);
    save(STORAGE.settings, settings);
    save(STORAGE.counter, invoiceCounter);
    save(STORAGE.tombs, tombs);
  }

  function applyBackupData(data) {
    if (Array.isArray(data.products)) products = data.products;
    if (Array.isArray(data.invoices)) invoices = data.invoices;
    if (Array.isArray(data.customers)) customers = data.customers;
    if (Array.isArray(data.suppliers)) suppliers = data.suppliers;
    if (Array.isArray(data.expenses)) expenses = data.expenses;
    if (Array.isArray(data.stockMovements)) stockMovements = data.stockMovements;
    if (Array.isArray(data.purchases)) purchases = data.purchases;
    if (Array.isArray(data.banks)) banks = data.banks;
    if (Array.isArray(data.bankTxns)) bankTxns = data.bankTxns;
    if (Array.isArray(data.otherIncome)) otherIncome = data.otherIncome;
    if (Array.isArray(data.loans)) loans = data.loans;
    if (data.settings) settings = Object.assign({}, settings, data.settings);
    if (data.invoiceCounter) invoiceCounter = Math.max(invoiceCounter, Number(data.invoiceCounter) || 0);
  }
  function snapshotData() { return { products, invoices, customers, suppliers, expenses, stockMovements, purchases, banks, bankTxns, otherIncome, loans, settings, invoiceCounter, exportedAt: new Date().toISOString() }; }

  // Keep text typed on Business Profile when an upload / signature / template change re-renders the page
  function bpCapture() {
    if (currentView !== 'business-profile' || !document.getElementById('bpName')) return;
    const m = { bpName: 'businessName', bpPhone: 'phone', bpPhone2: 'phone2', bpEmail: 'email', bpAddress: 'address', bpCity: 'city', bpDesc: 'businessDesc', bpTax: 'taxId', bpOwner: 'ownerName', bpPrefix: 'invoicePrefix', bpCurrency: 'currency' };
    Object.keys(m).forEach(id => { const el = document.getElementById(id); if (el) { const v = String(el.value || '').trim(); if (v || m[id] !== 'businessName') settings[m[id]] = v; } });
  }
  // Push the profile to the cloud right away (does not depend on any other table syncing)
  async function pushSettingsNow() {
    try {
      if (!window.HisablyCloud || !HisablyCloud.ready() || !HisablyCloud.getSession() || !navigator.onLine) return null;
      await HisablyCloud.saveShopSettings(settings);
      return true;
    } catch (e) { return String((e && e.message) || e).replace(/^LIMIT:\s*/, ''); }
  }
  function persist() {
    bpCapture();
    stampChanges();
    saveAll();
    // Auto-sync to cloud ~2s after last change (debounced)
    scheduleCloudPush();
  }

  function scheduleCloudPush() {
    if (!_cloudAutoEnabled) return;
    if (!window.HisablyCloud || !HisablyCloud.ready()) return;
    if (!HisablyCloud.getSession()) return;
    clearTimeout(_cloudPushTimer);
    _cloudPushTimer = setTimeout(() => {
      doCloudSync({ silent: true });
    }, 2000);
  }

  // ---------- Navigation ----------
  let _histInit = false;
  function setView(view, options = {}) {
    if (settings.warnUnsaved && currentView === 'create-invoice' && view !== 'create-invoice' && !window._docSaved && window._docLines && window._docLines.length) {
      askConfirm('Discard this unsaved bill?', { title: 'Unsaved bill', okText: 'Discard', danger: true }).then(ok => { if (ok) { window._docSaved = true; setView(view, options); } });
      return;
      window._docLines.length = 0;
    }
    closeModal();
    if (isStaff()) {
      const need = viewPerm(view, docCtx.type);
      if (need && !can(need)) { toast('Your role does not allow that'); if (view === 'create-invoice') docCtx = {}; view = 'home'; }
    }
    if (!options.keepHistory && !options.replace) {
      if (currentView && currentView !== view) {
        viewStack.push(currentView);
        if (viewStack.length > 30) viewStack.shift();
      }
      previousView = currentView;
    }
    if (options.replace) previousView = currentView;
    currentView = view;
    if (!options._pop) {
      try {
        const n0 = (history.state && history.state.n) || 0;
        if (!_histInit && !(history.state && history.state.v)) {
          // first load: a guard entry underneath lets us ask "press back again to exit" at the home screen
          history.replaceState({ guard: 1 }, '', location.pathname + location.search);
          history.pushState({ v: view, n: 0 }, '', '#' + view);
        } else if (options.replace || !_histInit) { history.replaceState({ v: view, n: n0 }, '', '#' + view); }
        else if (!options.keepHistory) { history.pushState({ v: view, n: n0 + 1 }, '', '#' + view); }
        else { history.replaceState({ v: view, n: n0 }, '', '#' + view); }
        _histInit = true;
      } catch (e) {}
    }
    // Highlight matching bottom nav item (home/dashboard/products/more)
    const navMap = { home: 'home', dashboard: 'dashboard', products: 'products', more: 'more',
      invoices: 'home', 'create-invoice': 'home', customers: 'more', suppliers: 'more',
      reports: 'more', expenses: 'more', purchases: 'more', daybook: 'more', 'stock-history': 'more',
      settings: 'more', 'business-profile': 'more',
      'txn-settings': 'more', 'print-settings': 'more', 'invoice-theme': 'more', account: 'more', 'app-lock': 'more', 'item-settings': 'more',
      'party-settings': 'more', 'tax-settings': 'more', 'general-settings': 'more', 'cash-in-hand': 'more', 'daybook-detail': 'more', 'multi-currency': 'more', reminders: 'more', 'payment-reminders': 'more', 'service-reminders': 'more', 'online-store': 'more', 'sale-report': 'more', 'profit-loss': 'more', 'trial-balance': 'more', 'stock-summary': 'more', 'low-stock': 'more', 'party-pl': 'more', 'item-pl': 'more', banks: 'more', 'bank-ledger': 'more', loans: 'more', 'other-income': 'more', 'barcode-gen': 'more', 'balance-sheet': 'more', pos: 'home', 'stock-adjust': 'more', 'payments-in': 'more', 'payments-out': 'more', cheques: 'more', sync: 'more', companies: 'more', verify: 'more', recycle: 'more', 'bill-pnl': 'more' };
    const activeNav = navMap[view] || view;
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === activeNav));
    const showBack = !['home','dashboard','products','more'].includes(view);
    $('#backBtn').hidden = !showBack;
    render();
    window.scrollTo(0, 0);
  }

  // ---------- Render Router ----------
  function render() {
    try { applyNavPerms(); } catch (e) {}
    const content = $('#appContent');
    const title = $('#headerTitle');
    const right = $('#headerRight');
    right.innerHTML = '';

    const map = {
      home: () => {
        title.textContent = settings.businessName || 'Billaura';
        right.innerHTML = `<button class="icon-btn ${unreadNotices().length ? 'header-dot' : ''}" data-view="notifications" aria-label="Notifications">${ico('bell')}</button><button class="icon-btn" data-view="settings" aria-label="Settings">${ico('gear')}</button>`;
        content.innerHTML = viewHome();
      },
      
      dashboard: () => { title.textContent = 'Dashboard'; content.innerHTML = viewDashboard(); },
      products: () => {
        title.textContent = 'Items';
        if (can('items_edit')) right.innerHTML = `<button class="btn btn-outline btn-sm" data-action="bulk-tools" style="margin-right:8px">Bulk</button><button class="icon-btn" data-action="add-product" aria-label="Add"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`;
        content.innerHTML = viewProducts();
      },
      invoices: () => { title.textContent = 'Transactions'; content.innerHTML = viewInvoices(); },
      daybook: () => { title.textContent = 'Cash In-Hand'; content.innerHTML = viewCashInHand(); },
      'cash-in-hand': () => { title.textContent = 'Cash In-Hand'; content.innerHTML = viewCashInHand(); },
      'daybook-detail': () => { title.textContent = 'Day Book'; content.innerHTML = viewDayBook(); },
      purchases: () => {
        title.textContent = 'Purchases';
        right.innerHTML = `<button class="icon-btn" data-action="new-purchase"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`;
        content.innerHTML = viewPurchases();
      },
      'create-invoice': () => { title.textContent = (docCtx.type === 'purchase' ? 'New Purchase' : docCtx.type === 'return' ? 'Sale Return' : docCtx.type === 'estimate' ? 'New Quotation' : 'Sale'); content.innerHTML = viewCreateInvoice(); bindCreateInvoice(); },
      more: () => { title.textContent = 'Menu'; content.innerHTML = viewMore(); },
      settings: () => { title.textContent = 'Settings'; content.innerHTML = viewSettings(); },
      'business-profile': () => { title.textContent = 'Business Profile'; content.innerHTML = viewBusinessProfile(); },
      'txn-settings': () => { title.textContent = 'Bill Settings'; content.innerHTML = viewTxnSettings(); },
      'print-settings': () => { title.textContent = 'Invoice Print'; content.innerHTML = viewPrintSettings(); },
      'app-lock': () => { title.textContent = 'App Lock & Staff PIN'; content.innerHTML = viewAppLock(); },
      account: () => { title.textContent = 'Account & Data'; content.innerHTML = viewAccount(); },
      'invoice-theme': () => { title.textContent = 'Change Theme'; content.innerHTML = viewInvoiceTheme(); },
      'item-settings': () => { title.textContent = 'Item'; content.innerHTML = viewItemSettings(); },
      'party-settings': () => { title.textContent = 'Party'; content.innerHTML = viewPartySettings(); },
      'tax-settings': () => { title.textContent = 'Tax List'; content.innerHTML = viewTaxSettings(); },
      'general-settings': () => { title.textContent = 'General'; content.innerHTML = viewGeneralSettings(); },
      'multi-currency': () => { title.textContent = 'Multi-Currency'; content.innerHTML = viewMultiCurrency(); },
      'payment-reminders': () => { title.textContent = 'Payment Reminders'; content.innerHTML = viewPaymentReminders(); },
      'service-reminders': () => { title.textContent = 'Service Reminders'; content.innerHTML = viewServiceReminders(); },
      reminders: () => { title.textContent = 'Reminders'; content.innerHTML = viewReminders(); },
      notifications: () => { title.textContent = 'Notifications'; content.innerHTML = viewNotifications(); setTimeout(() => { markNoticesRead(noticeList().map(n => n.id)); updateBell(); }, 900); },
      'online-store': () => {
        if (settings._storeHash && !window._storeChecked) { window._storeChecked = true; republishStore(true).then(() => { if (currentView === 'online-store') render(); }).catch(() => {}); } title.textContent = 'Online Store'; content.innerHTML = viewOnlineStore(); },
      pos: () => { title.textContent = 'Quick Sale (POS)'; content.innerHTML = viewPOS(); bindPOS(); },
      'stock-adjust': () => { title.textContent = 'Stock Adjustment'; content.innerHTML = viewStockAdjust(); },
      'payments-in': () => { title.textContent = 'Payment-In'; content.innerHTML = paymentList('in'); },
      'payments-out': () => { title.textContent = 'Payment-Out'; content.innerHTML = paymentList('out'); },
      cheques: () => { title.textContent = 'Cheque'; content.innerHTML = viewCheques(); },
      sync: () => { title.textContent = 'Sync & Share'; content.innerHTML = viewSync(); },
      companies: () => { title.textContent = 'My Businesses'; content.innerHTML = viewCompanies(); },
      verify: () => { title.textContent = 'Verify my data'; content.innerHTML = viewVerify(); },
      recycle: () => { title.textContent = 'Recycle Bin'; content.innerHTML = viewRecycle(); },
      'bill-pnl': () => { title.textContent = 'Bill Wise Profit'; content.innerHTML = viewBillPnl(); },
      banks: () => { title.textContent = 'Bank Accounts'; content.innerHTML = viewBanks(); },
      'bank-ledger': () => { title.textContent = 'Bank Ledger'; content.innerHTML = viewBankLedger(); },
      loans: () => { title.textContent = 'Loan Accounts'; content.innerHTML = viewLoans(); },
      'other-income': () => { title.textContent = 'Other Income'; content.innerHTML = viewOtherIncome(); },
      'barcode-gen': () => { title.textContent = 'Barcode Generator'; content.innerHTML = viewBarcodeGen(); },
      'balance-sheet': () => { title.textContent = 'Balance Sheet'; content.innerHTML = viewBalanceSheet(); },
      customers: () => {
        title.textContent = 'Customers';
        right.innerHTML = `<button class="icon-btn" data-action="add-customer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`;
        content.innerHTML = viewCustomers();
      },
      suppliers: () => {
        title.textContent = 'Suppliers';
        right.innerHTML = `<button class="icon-btn" data-action="add-supplier"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`;
        content.innerHTML = viewSuppliers();
      },
      reports: () => { title.textContent = 'Reports'; content.innerHTML = viewReports(); },
      'sale-report': () => { title.textContent = 'Sales Report'; invFilter = 'sale'; content.innerHTML = viewInvoices(); },
      'profit-loss': () => { title.textContent = 'Profit & Loss'; content.innerHTML = viewProfitLoss(); },
      'trial-balance': () => { title.textContent = 'Trial Balance'; content.innerHTML = viewTrialBalance(); },
      'stock-summary': () => { title.textContent = 'Stock Summary'; content.innerHTML = viewStockSummary(false); },
      'low-stock': () => { title.textContent = 'Low Stock'; content.innerHTML = viewStockSummary(true); },
      'party-pl': () => { title.textContent = 'Party Profit & Loss'; content.innerHTML = viewPartyPL(); },
      'item-pl': () => { title.textContent = 'Item Profit & Loss'; content.innerHTML = viewItemPL(); },
      expenses: () => {
        title.textContent = 'Expenses';
        right.innerHTML = `<button class="icon-btn" data-action="add-expense"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`;
        content.innerHTML = viewExpenses();
      },
      'stock-history': () => {
        title.textContent = 'Stock History';
        content.innerHTML = viewStockHistory();
      }
    };

    let _ev = window.BillauraExt && BillauraExt.views && BillauraExt.views[currentView]; if (_ev && _ev.when && !_ev.when()) _ev = null;
    if (_ev) { title.textContent = typeof _ev.title === 'function' ? _ev.title() : _ev.title; if (_ev.right) right.innerHTML = _ev.right(); content.innerHTML = _ev.html(); if (_ev.bind) { try { _ev.bind(); } catch (e) { console.error(e); } } }
    else (map[currentView] || map.home)();
    try { if (window.BillauraExt && BillauraExt.afterRender) BillauraExt.afterRender(currentView, { title, right, content }); } catch (e) { console.error(e); }
    const hdr = $('#appHeader');
    if (hdr) {
      hdr.classList.toggle('is-home', currentView === 'home');
      let st = hdr.querySelector('.header-store-ic');
      if (currentView === 'home' && !st) { const hl = $('#headerLogo'); const sp = document.createElement('button'); sp.type = 'button'; sp.className = 'header-store-ic'; sp.setAttribute('data-action', 'open-account'); sp.setAttribute('aria-label', 'Profile'); sp.innerHTML = acctAvatar(); hl.parentNode.insertBefore(sp, hl); }
      else if (currentView === 'home' && st) st.innerHTML = acctAvatar();
      else if (currentView !== 'home' && st) st.remove();
      document.body.classList.toggle('plan-pro', (() => { try { return HisablyFreemium.effectivePlan().key === 'pro'; } catch (e) { return false; } })());
      const hl2 = $('#headerLogo'); if (hl2) hl2.style.display = 'none';
    }
  }

  // ---------- Dashboard ----------
  function viewHomeOld() {
    const { revenue, receivable } = netTotals();
    const payable = totalGive();
    const recent = [...invoices].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 8);
    const biz = escapeHtml(settings.businessName || 'My Business');
    const cur = settings.currency || 'Rs';

    return `<div class="fade-in">
      <div class="dash-header">
        <div class="dash-greeting">Welcome back</div>
        <div class="dash-business">${biz}</div>
        <div class="dash-stats">
          <div class="dash-stat positive">
            <div class="dash-stat-label">To Collect</div>
            <div class="dash-stat-value">${cur} ${money(receivable)}</div>
          </div>
          <div class="dash-stat negative">
            <div class="dash-stat-label">To Pay</div>
            <div class="dash-stat-value">${cur} ${money(payable)}</div>
          </div>
        </div>
      </div>

      <div class="quick-actions">
        <button class="quick-action" data-view="pos">
          <div class="quick-action-icon" style="background:#FEE2E2;color:#E11D48"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h8"/></svg></div>
          <span>Quick Sale</span>
        </button>
        <button class="quick-action" data-view="create-invoice">
          <div class="quick-action-icon" style="background:#E11D48"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg></div>
          <span>Sale</span>
        </button>
        <button class="quick-action" data-action="new-purchase">
          <div class="quick-action-icon" style="background:#F59E0B"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/></svg></div>
          <span>Purchase</span>
        </button>
        <button class="quick-action" data-view="expenses">
          <div class="quick-action-icon" style="background:#8B5CF6"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg></div>
          <span>Expense</span>
        </button>
        <button class="quick-action" data-view="reports">
          <div class="quick-action-icon" style="background:#2563EB"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg></div>
          <span>Reports</span>
        </button>
      </div>

      <div class="dash-card">
        <div class="dash-card-title">
          Recent Transactions
          <button class="btn btn-ghost btn-sm" data-view="invoices">See all</button>
        </div>
        ${recent.length === 0
          ? `<div class="empty-state" style="padding:24px 0">
              <h3>No transactions yet</h3>
              <p>Create your first sale invoice</p>
              <button class="btn btn-primary" data-view="create-invoice">+ New Sale</button>
            </div>`
          : recent.map(inv => {
              const bal = Math.max(0, (inv.total||0) - (inv.paidAmount||0));
              const type = (inv.type || 'sale').toLowerCase();
              const badgeClass = type.includes('purchase') ? 'purchase' : type.includes('return') ? 'expense' : 'sale';
              return `<div class="txn-card" data-action="view-invoice" data-id="${inv.id}">
                <div class="txn-top">
                  <div class="txn-party">${escapeHtml(inv.customerName || inv.partyName || 'Walk-in')}</div>
                  <span class="txn-badge ${badgeClass}">${type === 'sale' ? 'SALE' : type.toUpperCase()}</span>
                </div>
                <div class="txn-meta">
                  <span>${formatDate(inv.date)} · #${escapeHtml(inv.number || inv.id.slice(0,6))}</span>
                  <span class="txn-amount">${cur} ${money(inv.total||0)}</span>
                </div>
                ${bal > 0 ? `<div class="txn-meta mt-1"><span></span><span class="txn-balance">Due ${cur} ${money(bal)}</span></div>` : ''}
              </div>`;
            }).join('')}
      </div>

      <div style="padding:8px 16px 24px">
        <button class="btn btn-primary btn-lg btn-block" data-view="create-invoice">+ Add New Sale</button>
      </div>
    </div>`;
  }

  function lowStockProducts() {
    return products.filter(p => {
      const low = p.lowStock != null ? p.lowStock : (settings.lowStockDefault || 5);
      return (p.stock || 0) <= low;
    }).sort((a,b) => (a.stock||0)-(b.stock||0));
  }
  function viewDashboardOld() {
    const totalProducts = products.length;
    const low = products.filter(p => p.stock > 0 && p.stock <= lowLimit(p)).length;
    const out = products.filter(p => p.stock <= 0).length;
    const { revenue, cogs, receivable } = netTotals();
    const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const profit = revenue - cogs - totalExpenses;
    const cur = settings.currency || 'Rs';
    const monthSales = invoices.filter(i => {
      const d = new Date(i.date);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && (i.type||'sale') === 'sale';
    }).reduce((s,i) => s + (i.total||0), 0);

    return `<div class="fade-in">
      <div class="dash-card" style="margin-top:12px">
        <div class="dash-card-title">Sale Overview</div>
        <div style="font-size:1.75rem;font-weight:700;color:var(--success)">${cur} ${money(monthSales)}</div>
        <div class="text-muted" style="font-size:0.8125rem">This month · Total revenue ${cur} ${money(revenue)}</div>
      </div>

      <div class="list-group">
        <div class="list-row" style="cursor:default">
          <div class="list-row-label">To Collect</div>
          <div class="list-row-right text-success font-semibold">${cur} ${money(receivable)}</div>
        </div>
        <div class="list-row" style="cursor:default">
          <div class="list-row-label">To Pay</div>
          <div class="list-row-right text-danger font-semibold">${cur} ${money(totalGive())}</div>
        </div>
        <div class="list-row" style="cursor:default">
          <div class="list-row-label">Net Profit</div>
          <div class="list-row-right font-semibold ${profit>=0?'text-success':'text-danger'}">${cur} ${money(profit)}</div>
        </div>
        <div class="list-row" style="cursor:default">
          <div class="list-row-label">Expenses</div>
          <div class="list-row-right">${cur} ${money(totalExpenses)}</div>
        </div>
      </div>

      <div class="list-group">
        <div class="list-row" style="cursor:default">
          <div class="list-row-label">Items</div>
          <div class="list-row-right">${totalProducts}</div>
        </div>
        <div class="list-row" style="cursor:default">
          <div class="list-row-label">Low Stock</div>
          <div class="list-row-right" style="color:var(--warning)">${low}</div>
        </div>
        <div class="list-row" style="cursor:default">
          <div class="list-row-label">Out of Stock</div>
          <div class="list-row-right text-danger">${out}</div>
        </div>
      </div>

      <div style="padding:8px 16px 24px">
        <button class="btn btn-blue btn-block" data-view="reports">View All Reports</button>
      </div>
    </div>`;
  }

  // ---------- Products ----------
  // ---------- Products ----------
  function viewProducts() {
    if (products.length === 0) {
      return emptyState('box', 'No products yet', 'Add your first product to start tracking stock and creating invoices.', 'Add Product', null, 'add-product');
    }
    if (productCat && productCat !== '__none__' && !categoryList().includes(productCat)) productCat = '';
    return `<div class="fade-in">
      <div class="search-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="search" class="search-input" id="productSearch" placeholder="Search name, barcode or category..." />
      </div>
      ${categoryChipsHTML()}
      <div class="list" id="productList">${productListHTML('')}</div>
    </div>`;
  }

  function listProduct(p) {
    let badge = p.stock <= 0 ? '<span class="list-item-badge badge-out">Out of stock</span>' :
                p.stock <= lowLimit(p) ? `<span class="list-item-badge badge-low">Low · ${p.stock}</span>` :
                `<span class="list-item-badge badge-ok">${p.stock} in stock</span>`;
    return `<div class="list-item" data-action="edit-product" data-id="${p.id}">
      ${photoSrc(p.id) ? `<div class="list-item-icon" style="padding:0;overflow:hidden;background:#eee"><img src="${photoSrc(p.id)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block" /></div>` : `<div class="list-item-icon">${initials(p.name)}</div>`}
      <div class="list-item-body">
        <div class="list-item-title">${escapeHtml(p.name)}</div>
        <div class="list-item-sub">${settings.currency} ${money(p.price)} · ${escapeHtml(p.unit || 'pcs')}${p.barcode ? ' · ' + escapeHtml(p.barcode) : ''}</div>
      </div>
      <div class="list-item-right">${badge}</div>
    </div>`;
  }

  // ---------- Invoices ----------
  let invFilter = 'all';
  function viewInvoices() {
    if (invoices.length === 0) {
      return emptyState('invoice', 'No invoices yet', 'Create invoices for customers and track sales.', 'Create Invoice', 'create-invoice');
    }
    const kinds = [['all', 'All'], ['sale', 'Sales'], ['estimate', 'Quotes'], ['return', 'Returns']];
    const list = invoices.filter(i => invFilter === 'all' || (i.docType || 'sale') === invFilter)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    return `<div class="fade-in">
      <div class="cat-chips">${kinds.map(k => `<button class="cat-chip${invFilter === k[0] ? ' active' : ''}" data-action="inv-filter" data-kind="${k[0]}">${k[1]}</button>`).join('')}
        <button class="cat-chip" data-action="new-estimate">+ Quotation</button><button class="cat-chip" data-action="new-return">+ Sale Return</button></div>
      ${list.length ? `<div class="list">${list.map(inv => listInvoice(inv)).join('')}</div>` : '<div class="doc-empty">Nothing here yet</div>'}
    </div>`;
  }

  function listInvoice(inv) {
    const status = inv.paymentStatus || 'unpaid';
    const paid = inv.paidAmount || 0;
    const isRet = inv.docType === 'return';
    let badge = '';
    if (inv.docType === 'estimate') {
      badge = inv.meta && inv.meta.convertedTo ? `<span class="list-item-badge badge-ok">Invoiced · ${escapeHtml(inv.meta.convertedTo)}</span>` : '<span class="list-item-badge badge-low">Quotation</span>';
    } else if (isRet) {
      badge = paid >= inv.total ? '<span class="list-item-badge badge-ok">Refunded</span>'
        : `<span class="list-item-badge badge-low">Credit · ${settings.currency} ${money(Math.max(0, inv.total - paid))}</span>`;
    } else if (status === 'paid' || paid >= inv.total) {
      badge = '<span class="list-item-badge badge-ok">Paid</span>';
    } else if (status === 'partial' || paid > 0) {
      badge = `<span class="list-item-badge badge-low">Partial · ${settings.currency} ${money(paid)}</span>`;
    } else {
      badge = '<span class="list-item-badge badge-out">Unpaid</span>';
    }
    if (isOverdue(inv)) badge += ' <span class="list-item-badge badge-out">Overdue</span>';
    return `<div class="list-item" data-action="view-invoice" data-id="${inv.id}">
      <div class="list-item-icon">${initials(inv.customerName || 'C')}</div>
      <div class="list-item-body">
        <div class="list-item-title">${escapeHtml(inv.customerName || 'Walk-in Customer')}</div>
        <div class="list-item-sub">${isRet ? 'Return ' : (inv.docType === 'estimate' ? 'Quote ' : '#')}${escapeHtml(inv.number)} · ${formatDate(inv.date)} · ${inv.items.length} item${inv.items.length !== 1 ? 's' : ''}</div>
        ${badge}
      </div>
      <div class="list-item-right"><div class="list-item-price"${isRet ? ' style="color:var(--danger)"' : ''}>${isRet ? '−' : ''}${settings.currency} ${money(inv.total)}</div></div>
    </div>`;
  }

  // ---------- Customer payments, ledger / statement, reminders ----------
  // Money received (or refunded) against one document. Keeps a dated history in meta.payments.
  function addPayment(inv, amt, mode, note, dateIso, allowOver) {
    const left = Math.max(0, round2((inv.total || 0) - (inv.paidAmount || 0)));
    amt = round2(allowOver ? (Number(amt) || 0) : Math.min(Number(amt) || 0, left));
    if (amt <= 0) return 0;
    inv.meta = inv.meta || {};
    (inv.meta.payments = inv.meta.payments || []).push({ date: dateIso || new Date().toISOString(), amount: amt, mode: mode || 'Cash', note: note || '' });
    inv.paidAmount = round2((inv.paidAmount || 0) + amt);
    inv.paymentStatus = inv.paidAmount >= inv.total ? 'paid' : 'partial';
    inv.updatedAt = new Date().toISOString();
    return amt;
  }
  function custDocs(cust) {
    return invoices.filter(i => docSign(i) && invoiceBelongsToCustomer(i, cust.id, cust.name, cust.phone));
  }
  function isOverdue(inv) {
    if (!(inv.meta && inv.meta.dueDate) || (inv.docType !== undefined && docSign(inv) <= 0)) return false;
    return (inv.total || 0) - (inv.paidAmount || 0) > 0.001 && inv.meta.dueDate < new Date().toISOString().slice(0, 10);
  }
  // Chronological ledger: debit = customer owes more, credit = customer owes less
  function customerLedger(cust) {
    const rows = [];
    custDocs(cust).forEach(inv => {
      const ret = inv.docType === 'return';
      rows.push({ t: ts(inv.date), date: inv.date, text: (ret ? 'Credit note ' : 'Invoice ') + inv.number, debit: ret ? 0 : inv.total, credit: ret ? inv.total : 0 });
      const pays = (inv.meta && inv.meta.payments) || [];
      const sumP = pays.reduce((s, p) => s + p.amount, 0);
      const first = round2((inv.paidAmount || 0) - sumP);
      if (first > 0.001) rows.push({ t: ts(inv.date) + 1, date: inv.date, text: (ret ? 'Refund paid' : 'Payment received') + ((inv.meta && inv.meta.paymentMode) ? ' · ' + inv.meta.paymentMode : '') + ' (' + inv.number + ')', debit: ret ? first : 0, credit: ret ? 0 : first });
      pays.forEach(p => rows.push({ t: ts(p.date) + 1, date: p.date, text: (ret ? 'Refund paid' : 'Payment received') + (p.mode ? ' · ' + p.mode : '') + (p.note ? ' · ' + p.note : '') + ' (' + inv.number + ')', debit: ret ? p.amount : 0, credit: ret ? 0 : p.amount }));
    });
    rows.sort((a, b) => a.t - b.t);
    let bal = 0;
    rows.forEach(r => { bal = round2(bal + r.debit - r.credit); r.balance = bal; });
    return rows;
  }

  function openReceiveModal(cust) {
    const bal = customerBalance(cust.id, cust.name, cust.phone);
    const saleDue = custDocs(cust).filter(i => docSign(i) > 0).reduce((s, i) => s + Math.max(0, (i.total || 0) - (i.paidAmount || 0)), 0);
    const today = new Date().toISOString().slice(0, 10);
    $('#modalRoot').innerHTML = `
      <div class="modal-overlay"><div class="modal-sheet">
        <div class="modal-handle"></div>
        <div class="modal-header"><h3 class="modal-title">Receive Payment</h3>
          <button class="modal-close" data-action="close-modal"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
        <div class="text-secondary text-sm mb-8">${escapeHtml(cust.name)} · Due ${settings.currency} ${money(bal.due)}</div>
        ${saleDue <= 0 ? '<div class="doc-empty">This customer has nothing pending.</div>' : `
        <form id="receiveForm" autocomplete="off">
          <div class="form-group"><label class="form-label">Amount (${settings.currency})</label>
            <input type="number" inputmode="decimal" class="form-input" id="rcvAmt" min="0" step="any" value="${saleDue}" /></div>
          <div class="chip-row mb-8" id="rcvMode">
            <button type="button" class="cat-chip active" data-mode="Cash">Cash</button><button type="button" class="cat-chip" data-mode="Bank">Bank</button>
            <button type="button" class="cat-chip" data-mode="Online">Online</button><button type="button" class="cat-chip" data-mode="Cheque">Cheque</button></div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Date</label><input type="date" class="form-input" id="rcvDate" value="${today}" max="${today}" /></div>
            <div class="form-group"><label class="form-label">Note</label><input type="text" class="form-input" id="rcvNote" maxlength="40" placeholder="Optional" /></div>
          </div>
          <div class="text-sm text-secondary">The amount settles the oldest unpaid invoices first.</div>
          <button type="submit" class="btn btn-primary btn-block mt-16">Save Payment</button>
        </form>`}
      </div></div>`;
    const f = document.getElementById('receiveForm'); if (!f) return;
    let mode = 'Cash';
    document.querySelectorAll('#rcvMode .cat-chip').forEach(b => b.addEventListener('click', () => {
      mode = b.dataset.mode; document.querySelectorAll('#rcvMode .cat-chip').forEach(x => x.classList.toggle('active', x === b));
    }));
    f.addEventListener('submit', async e => {
      e.preventDefault();
      let amt = round2(parseFloat(document.getElementById('rcvAmt').value) || 0);
      if (amt <= 0) { toast('Enter an amount'); return; }
      const extraAmt = amt > saleDue + 0.001 ? round2(amt - saleDue) : 0;
      if (extraAmt && !(await askConfirm(settings.currency + ' ' + money(extraAmt) + ' is more than the amount due. Keep the extra as customer credit?', { title: 'Extra payment' }))) return;
      const d = document.getElementById('rcvDate').value;
      const dateIso = (d && d !== today) ? new Date(d + 'T12:00:00').toISOString() : new Date().toISOString();
      const note = document.getElementById('rcvNote').value.trim();
      const open = custDocs(cust).filter(i => docSign(i) > 0 && (i.total || 0) - (i.paidAmount || 0) > 0.001)
        .sort((a, b) => ts(a.date) - ts(b.date));
      let n = 0;
      for (const inv of open) { if (amt <= 0.001) break; const used = addPayment(inv, amt, mode, note, dateIso); if (used > 0) { amt = round2(amt - used); n++; } }
      if (amt > 0.001) {   // whatever is left is customer credit, kept on their latest bill
        const last = open[open.length - 1] || custDocs(cust).filter(i => docSign(i) > 0).sort((a, b) => ts(b.date) - ts(a.date))[0];
        if (last) { addPayment(last, amt, mode, note, dateIso, true); amt = 0; }
      }
      persist();
      toast(`Payment saved · ${n} invoice${n !== 1 ? 's' : ''} updated`);
      render();
      openCustomerDetail(cust);
    });
  }

  function statementText(cust) {
    const rows = customerLedger(cust);
    const bal = customerBalance(cust.id, cust.name, cust.phone);
    let t = `*${settings.businessName}*\nStatement for ${cust.name}\n\n`;
    rows.slice(-12).forEach(r => {
      t += `${formatDate(r.date)} · ${r.text}: ${r.debit ? '+' : '-'}${settings.currency} ${money(r.debit || r.credit)}\n`;
    });
    t += `\n*${bal.credit > 0 ? 'Credit with us' : 'Balance due'}: ${settings.currency} ${money(bal.credit > 0 ? bal.credit : bal.due)}*`;
    if (settings.phone) t += `\n\nContact: ${settings.phone}`;
    return t;
  }
  function reminderText(cust, onlyInv) {
    const docs = onlyInv ? [onlyInv] : custDocs(cust).filter(i => docSign(i) > 0 && (i.total || 0) - (i.paidAmount || 0) > 0.001).sort((a, b) => ts(a.date) - ts(b.date));
    const due = round2(docs.reduce((s, i) => s + (i.total - (i.paidAmount || 0)), 0));
    let t = `Assalam o Alaikum ${cust.name || ''},\n\nA friendly reminder from *${settings.businessName}*: you have *${settings.currency} ${money(due)}* pending.\n\n`;
    docs.slice(0, 6).forEach(i => {
      t += `• ${i.number} (${formatDate(i.date)}): ${settings.currency} ${money(i.total - (i.paidAmount || 0))}${i.meta && i.meta.dueDate ? ' · due ' + formatDate(i.meta.dueDate) : ''}\n`;
    });
    if (docs.length > 6) t += `…and ${docs.length - 6} more\n`;
    t += `\nKindly arrange the payment at your earliest convenience.`;
    if (settings.paymentNote) t += `\n${settings.paymentNote}`;
    if (settings.phone) t += `\nContact: ${settings.phone}`;
    t += `\n\nThank you!`;
    return t;
  }
  // Local numbers like 0300-1234567 need the country code for wa.me
  function waNumber(phone) {
    let d = (phone || '').replace(/\D/g, '');
    const cc = { PKR: '92', INR: '91', BDT: '880' }[settings.currency];
    if (cc && d.startsWith('0')) d = cc + d.slice(1);
    return d;
  }
  // ---- Billaura Desktop promo ----
  const DESKTOP_REL = 'https://github.com/faisalchaudhary411/billaura/releases/latest/download/Billaura-Setup.exe';
  // Public web address of the app. Inside the Android/desktop shells location is localhost, which is useless in a link you share.
  const PUBLIC_SITE = 'https://faisalchaudhary411.github.io/billaura/';
  function siteBase() {
    try { if (/^https?:$/.test(location.protocol) && !/^(localhost|127\.|\[::1\])/.test(location.hostname)) return location.origin + location.pathname.replace(/[^/]*$/, ''); } catch (e) {}
    return PUBLIC_SITE;
  }
  function desktopSite() { return siteBase(); }
  // true only in a normal browser tab on the real website (not the installed app, APK, desktop shell or local testing)
  function onPublicWebsite() {
    try {
      if (window.Capacitor || navigator.standalone || location.protocol === 'file:' || /^billaura:/.test(location.protocol)) return false;
      if (window.matchMedia && matchMedia('(display-mode: standalone)').matches) return false;
      return /^https?:$/.test(location.protocol) && !/^(localhost|127\.|192\.168\.|\[::1\])/.test(location.hostname);
    } catch (e) { return false; }
  }
  function desktopMsg() {
    return `Billaura Desktop\n\n1) On your PC open this link in Chrome or Edge, then choose "Install app":\n${desktopSite()}\n\n2) Or download the Windows app:\n${DESKTOP_REL}\n\nSign in with the same account to see your shop data on both.`;
  }
  function showDesktopSplash(done) {
    let el = document.getElementById('deskSplash');
    if (el) el.remove();
    el = document.createElement('div');
    el.id = 'deskSplash'; el.className = 'desk-splash';
    el.innerHTML = `<div class="ds-glow"></div>
      <img class="ds-logo" src="assets/icon-512.png" alt="" width="88" height="88" />
      <div class="ds-name">Billaura</div>
      <div class="ds-tag">One shop · every screen</div>
      <div class="ds-art"><svg viewBox="0 0 300 120" aria-hidden="true">
        <rect x="22" y="22" width="44" height="82" rx="9" fill="none" stroke="#fff" stroke-width="3"/>
        <rect x="30" y="34" width="28" height="5" rx="2.5" fill="#FF8FA3"/><rect x="30" y="45" width="28" height="5" rx="2.5" fill="#ffffff55"/><rect x="30" y="56" width="18" height="5" rx="2.5" fill="#ffffff55"/>
        <path d="M82 62 C 112 20, 188 20, 218 62" fill="none" stroke="#FF8FA3" stroke-width="2.5" stroke-dasharray="3 7" stroke-linecap="round" class="ds-dash"/>
        <circle r="5" fill="#fff" class="ds-dot"><animateMotion dur="1.6s" repeatCount="indefinite" path="M82 62 C 112 20, 188 20, 218 62"/></circle>
        <rect x="204" y="30" width="78" height="52" rx="6" fill="none" stroke="#fff" stroke-width="3"/>
        <path d="M222 100h42M243 82v18" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
        <path d="M216 70l12-12 10 8 16-20" fill="none" stroke="#FF8FA3" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <div class="ds-lbl"><span>Phone</span><span>Computer</span></div></div>`;
    document.body.appendChild(el);
    let fin = false;
    const finish = () => { if (fin) return; fin = true; el.classList.add('out'); setTimeout(() => el.remove(), 260); done(); };
    el.addEventListener('click', finish);
    setTimeout(finish, 1500);
  }
  function sendWhatsApp(phone, text) {
    window.open(`https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`, '_blank');
  }
  function custOfInvoice(inv) {
    return customers.find(c => c.id === inv.customerId) || { id: inv.customerId, name: inv.customerName, phone: inv.customerPhone };
  }

  function openStatement(cust) {
    const rows = customerLedger(cust);
    const bal = customerBalance(cust.id, cust.name, cust.phone);
    $('#modalRoot').innerHTML = `
      <div class="modal-overlay"><div class="modal-sheet">
        <div class="modal-handle"></div>
        <div class="modal-header"><h3 class="modal-title">Statement · ${escapeHtml(cust.name)}</h3>
          <button class="modal-close" data-action="close-modal"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
        <div class="stats-grid mb-16">
          <div class="stat-card"><div class="stat-label">Net Sales</div><div class="stat-value primary">${settings.currency} ${money(bal.total)}</div></div>
          <div class="stat-card"><div class="stat-label">${bal.credit > 0 ? 'Credit' : 'Balance due'}</div><div class="stat-value ${bal.due > 0 ? 'danger' : 'success'}">${settings.currency} ${money(bal.credit > 0 ? bal.credit : bal.due)}</div></div>
        </div>
        ${rows.length ? `<div class="ledger">${rows.slice().reverse().map(r => `
          <div class="led-row"><div class="led-main"><div class="led-text">${escapeHtml(r.text)}</div><div class="text-sm text-secondary">${formatDate(r.date)}</div></div>
            <div class="led-amts"><div class="${r.debit ? 'led-dr' : 'led-cr'}">${r.debit ? '+' : '−'}${money(r.debit || r.credit)}</div><div class="text-sm text-secondary">Bal ${money(r.balance)}</div></div></div>`).join('')}</div>` : '<div class="doc-empty">No transactions yet</div>'}
        <div class="flex gap-8 mt-16">
          <button class="btn btn-secondary" style="flex:1" data-action="statement-pdf" data-id="${cust.id}">PDF</button>
          <button class="btn btn-primary" style="flex:1" data-action="statement-wa" data-id="${cust.id}">WhatsApp</button>
        </div>
      </div></div>`;
  }

  function statementPDF(cust) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, m = 16;
    const TH = HisablyReceipt.themeOf(settings), D = HisablyReceipt.hexRgb(TH.dark);
    const rows = customerLedger(cust);
    const bal = customerBalance(cust.id, cust.name, cust.phone);
    let y = 20;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(D[0], D[1], D[2]);
    doc.text(settings.businessName || 'Business', m, y);
    doc.setFontSize(11); doc.text('STATEMENT OF ACCOUNT', W - m, y, { align: 'right' });
    y += 8; doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
    if (settings.phone) { doc.text(settings.phone, m, y); }
    doc.text('Date: ' + formatDate(new Date().toISOString()), W - m, y, { align: 'right' });
    y += 8; doc.setTextColor(15, 23, 42); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Customer: ' + cust.name, m, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100);
    if (cust.phone) { doc.text(cust.phone, m, y); y += 5; }
    y += 3;
    const head = () => {
      doc.setFillColor(241, 245, 249); doc.roundedRect(m, y, W - 2 * m, 8, 1.5, 1.5, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(100);
      doc.text('DATE', m + 3, y + 5.5); doc.text('DETAILS', m + 28, y + 5.5);
      doc.text('DEBIT', m + 118, y + 5.5, { align: 'right' }); doc.text('CREDIT', m + 144, y + 5.5, { align: 'right' }); doc.text('BALANCE', W - m - 3, y + 5.5, { align: 'right' });
      y += 12;
    };
    head();
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(15, 23, 42);
    rows.forEach(r => {
      if (y > 275) { doc.addPage(); y = 20; head(); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(15, 23, 42); }
      doc.text(formatDate(r.date), m + 3, y);
      const t = doc.splitTextToSize(r.text, 82);
      doc.text(t[0], m + 28, y);
      if (r.debit) doc.text(money(r.debit), m + 118, y, { align: 'right' });
      if (r.credit) doc.text(money(r.credit), m + 144, y, { align: 'right' });
      doc.text(money(r.balance), W - m - 3, y, { align: 'right' });
      y += 6.5;
    });
    if (y > 262) { doc.addPage(); y = 20; }
    y += 4; doc.setDrawColor(226, 232, 240); doc.line(m, y, W - m, y); y += 8;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(D[0], D[1], D[2]);
    doc.text(bal.credit > 0 ? 'Credit with us' : 'Balance due', W - m - 60, y);
    doc.text(`${settings.currency} ${money(bal.credit > 0 ? bal.credit : bal.due)}`, W - m, y, { align: 'right' });
    doc.save(`Statement-${(cust.name || 'customer').replace(/[^a-z0-9]+/gi, '-')}.pdf`);
  }

  // ---------- Security: PIN lock + staff mode ----------
  // Device-level protection (keeps casual access out). It is not a server-side permission system.
  const ROLE_KEY = 'billaura_role_v1';
  const STAFF_VIEWS = ['home', 'dashboard', 'products', 'create-invoice', 'invoices', 'customers', 'more'];
  const STAFF_BLOCK = /^(add-product|edit-product|delete-|bulk-|stock-in|open-settings|open-plans|open-shopify|shopify-|export-data|import-data|clear-data|add-expense|edit-expense|new-purchase|view-purchase|purchase-|view-supplier|pay-supplier|add-supplier|edit-supplier|cloud-auth|change-password|do-change-password|sign-out-user|submit-payment|db-|pick-|remove-|pin-|staff-|send-daily)/;
  let _lastHidden = 0, _pinFails = 0, _pinWaitUntil = 0;
  function lockEnabled() { return !!settings.pinHash && !!(window.HisablyFreemium && HisablyFreemium.hasFeature('passcode')); }
  function getRole() { try { return sessionStorage.getItem(ROLE_KEY) || ''; } catch (e) { return ''; } }
  function setRole(r) { try { if (r) sessionStorage.setItem(ROLE_KEY, r); else sessionStorage.removeItem(ROLE_KEY); } catch (e) {} }
  function staffList() {
    if (!Array.isArray(settings.staff)) settings.staff = [];
    if (settings.staffHash) { if (!settings.staff.some(x => x.hash === settings.staffHash)) settings.staff.push({ id: uid(), name: 'Staff', hash: settings.staffHash }); settings.staffHash = ''; }
    return settings.staff;
  }
  const STAFF_NAME_KEY = 'billaura_staff_name_v1';
  function staffName() { try { return sessionStorage.getItem(STAFF_NAME_KEY) || 'Staff'; } catch (e) { return 'Staff'; } }
  function isStaff() { return lockEnabled() && getRole() === 'staff'; }
  // Roles: what each kind of staff member may do. The owner (owner PIN) can always do everything.
  const PERMS = [
    ['sales', 'Create sales & quotations'], ['returns', 'Sale returns'], ['receive_payment', 'Receive payments'],
    ['discount', 'Change price, discount & tax on a bill'], ['delete', 'Delete transactions & items'],
    ['items_view', 'View items & stock'], ['items_edit', 'Add / edit items & stock'], ['parties', 'Customers & suppliers'],
    ['purchases', 'Purchases'], ['expenses', 'Expenses'], ['reports', 'Reports & dashboard'],
    ['banks', 'Bank, cash & loans'], ['export', 'Backup & export'], ['settings', 'Business settings']
  ];
  const ROLES = {
    manager: { name: 'Manager', hint: 'Everything except business settings', perms: PERMS.map(x => x[0]).filter(x => x !== 'settings') },
    accountant: { name: 'Accountant', hint: 'Payments, expenses, bank, reports, export', perms: ['receive_payment', 'items_view', 'parties', 'purchases', 'expenses', 'reports', 'banks', 'export'] },
    cashier: { name: 'Cashier', hint: 'Sales, receive payments, customers', perms: ['sales', 'receive_payment', 'items_view', 'parties'] },
    salesperson: { name: 'Salesperson', hint: 'Sales and quotations only', perms: ['sales', 'items_view', 'parties'] },
    storekeeper: { name: 'Storekeeper', hint: 'Items, stock and purchases', perms: ['items_view', 'items_edit', 'purchases'] },
    custom: { name: 'Custom', hint: 'Choose each permission yourself', perms: [] }
  };
  const STAFF_ID_KEY = 'billaura_staff_id_v1';
  function currentStaff() { try { const id = sessionStorage.getItem(STAFF_ID_KEY); return staffList().find(x => x.id === id) || null; } catch (e) { return null; } }
  function staffPerms() { const sf = currentStaff(); if (!sf) return ROLES.cashier.perms; return Array.isArray(sf.perms) ? sf.perms : (ROLES[sf.role] || ROLES.cashier).perms; }
  function can(p) { return !isStaff() || staffPerms().includes(p); }
  // which permission opens a screen ('owner' = owner only, null = always allowed)
  function viewPerm(view, type) {
    const m = { home: null, more: null, dashboard: 'reports', products: 'items_view', invoices: 'sales', customers: 'parties', 'stock-summary': 'items_view', 'low-stock': 'items_view',
      purchases: 'purchases', suppliers: 'purchases', expenses: 'expenses', 'sale-report': 'reports', 'profit-loss': 'reports', 'party-pl': 'reports', 'item-pl': 'reports', 'trial-balance': 'reports', 'balance-sheet': 'reports', 'bill-pnl': 'reports', 'daybook-detail': 'reports',
      banks: 'banks', 'bank-ledger': 'banks', 'cash-in-hand': 'banks', loans: 'banks', 'other-income': 'banks', cheques: 'banks', 'payments-in': 'receive_payment', 'payments-out': 'banks',
      'barcode-gen': 'items_edit', 'stock-adjust': 'items_edit', reminders: 'parties', 'payment-reminders': 'receive_payment', 'service-reminders': 'parties', pos: 'sales', recycle: 'delete' };
    { const ev = window.BillauraExt && BillauraExt.views && BillauraExt.views[view]; if (ev && (!ev.when || ev.when())) return ev.perm || null; }
    if (view === 'create-invoice') return type === 'purchase' ? 'purchases' : type === 'return' ? 'returns' : 'sales';
    if (view === 'app-lock' || view === 'account') return 'owner';
    return view in m ? m[view] : 'settings';
  }
  function actionPerm(action) {
    if (window.BillauraExt && BillauraExt.perms && action in BillauraExt.perms) return BillauraExt.perms[action];
    if (/^(delete-|recycle|restore-|purge-)/.test(action)) return 'delete';
    if (/^(add-product|edit-product|stock-|bulk-|import-items|adjust-stock|gen-barcode|lb-|pm-)/.test(action)) return 'items_edit';
    if (/^(add-expense|edit-expense|save-expense)/.test(action)) return 'expenses';
    if (/^(new-purchase|view-purchase|purchase-|pay-supplier|add-supplier|edit-supplier)/.test(action)) return 'purchases';
    if (/^(add-bank|bank-|add-loan|loan-|add-other-income|cash-adjust|cheque)/.test(action)) return 'banks';
    if (/^(receive-payment|quick-receive|record-payment|refund-credit|mark-paid|submit-payment|remind-|rq-)/.test(action)) return 'receive_payment';
    if (action === 'pay-in') return 'receive_payment';
    if (action === 'pay-out') return 'purchases';
    if (/^(new-return|return-from-invoice)/.test(action)) return 'returns';
    if (/^(duplicate-invoice|convert-estimate|delivery-note|new-estimate)/.test(action)) return 'sales';
    if (/^(export-data|import-data|csv-|open-csv|backup-)/.test(action)) return 'export';
    if (/^(pin-|staff-|cloud-auth|change-password|do-change-password|sign-out-user|clear-data|db-)/.test(action)) return 'owner';
    if (STAFF_BLOCK.test(action)) return 'settings';
    return null;
  }
  async function pinHash(pin) {
    const str = `${settings.pinSalt || ''}:${pin}`;
    try {
      if (window.crypto && crypto.subtle) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) {}
    let h = 5381;                                   // fallback where crypto.subtle is unavailable
    for (let r = 0; r < 2000; r++) for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i) ^ r) >>> 0;
    return 'f' + h.toString(16);
  }

  function showLock(mode) {
    if (!lockEnabled()) return;
    setRole('');
    let el = document.getElementById('lockScreen');
    if (!el) { el = document.createElement('div'); el.id = 'lockScreen'; el.className = 'lock-screen'; document.body.appendChild(el); }
    el.hidden = false;
    if (mode === 'forgot') renderForgot(el); else renderLock(el, '');
  }
  function hideLock() { const el = document.getElementById('lockScreen'); if (el) el.hidden = true; }
  function renderLock(el, entered, msg) {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    el.innerHTML = `<div class="lock-box">
      <img src="assets/icon-192.png" alt="Billaura" class="brand-mark" width="64" height="64" />
      <div class="lock-title">${escapeHtml(settings.businessName || 'Billaura')}</div>
      <div class="lock-sub">${msg ? escapeHtml(msg) : 'Enter your PIN'}</div>
      <div class="lock-dots">${[0, 1, 2, 3].map(i => `<span class="${i < entered.length ? 'on' : ''}"></span>`).join('')}</div>
      <div class="lock-pad">${keys.map(k => k === '' ? '<span></span>' : `<button type="button" data-k="${k}">${k}</button>`).join('')}</div>
      <button type="button" class="lock-link" data-lock="forgot">Forgot PIN?</button></div>`;
    el.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => keyPress(el, entered, b.dataset.k)));
    const f = el.querySelector('[data-lock="forgot"]'); if (f) f.addEventListener('click', () => renderForgot(el));
  }
  async function keyPress(el, entered, k) {
    if (k === '⌫') return renderLock(el, entered.slice(0, -1));
    if (entered.length >= 4) return;
    entered += k;
    renderLock(el, entered);
    if (entered.length < 4) return;
    if (Date.now() < _pinWaitUntil) { renderLock(el, '', `Too many tries. Wait ${Math.ceil((_pinWaitUntil - Date.now()) / 1000)}s`); return; }
    const h = await pinHash(entered);
    if (h === settings.pinHash) { _pinFails = 0; setRole('owner'); hideLock(); render(); return; }
    { const sf = staffList().find(x => x.hash === h); if (sf) { _pinFails = 0; setRole('staff'); try { sessionStorage.setItem(STAFF_NAME_KEY, sf.name); sessionStorage.setItem(STAFF_ID_KEY, sf.id); } catch (e) {} hideLock(); setView(can('reports') ? 'dashboard' : 'home'); applyNavPerms(); return; } }
    _pinFails++;
    if (_pinFails >= 5) { _pinWaitUntil = Date.now() + 30000; _pinFails = 0; }
    const box = el.querySelector('.lock-box'); if (box) box.classList.add('shake');
    setTimeout(() => renderLock(el, '', 'Wrong PIN'), 350);
  }
  function renderForgot(el) {
    const cloud = window.HisablyCloud && HisablyCloud.ready() && HisablyCloud.getSession();
    el.innerHTML = `<div class="lock-box">
      <div class="lock-title">Reset PIN</div>
      ${cloud ? `<div class="lock-sub">Enter your account password to remove the PIN lock.</div>
        <input type="password" class="form-input" id="lockPw" placeholder="Account password" autocomplete="current-password" />
        <button type="button" class="btn btn-primary btn-block mt-12" id="lockReset">Remove PIN lock</button>`
        : `<div class="lock-sub">Sign in to your cloud account on this device to reset the PIN. Without a cloud account the PIN cannot be reset.</div>`}
      <button type="button" class="lock-link" id="lockBack">Back</button></div>`;
    el.querySelector('#lockBack').addEventListener('click', () => renderLock(el, ''));
    const rb = el.querySelector('#lockReset');
    if (rb) rb.addEventListener('click', async () => {
      const pw = el.querySelector('#lockPw').value;
      const email = HisablyCloud.getSession().user.email;
      rb.disabled = true;
      try { await HisablyCloud.signIn(email, pw); settings.pinHash = ''; settings.staffHash = ''; settings.staff = []; persist(); setRole('owner'); hideLock(); toast('PIN lock removed'); render(); }
      catch (e) { toast('Wrong password'); rb.disabled = false; }
    });
  }
  function chooseRole(cur) {
    return new Promise(res => { let done = false;
      pickSheet({ title: 'Staff role', search: false, selected: cur, options: Object.keys(ROLES).map(k => ({ value: k, label: ROLES[k].name + ' – ' + ROLES[k].hint })),
        onPick: v => { done = true; res(v); } });
      const back = document.getElementById('pickSheet');
      if (back) new MutationObserver(() => { if (!document.getElementById('pickSheet') && !done) { done = true; res(null); } }).observe(document.body, { childList: true });
    });
  }
  function openStaffPerms(id) {
    const sf = staffList().find(x => x.id === id); if (!sf) return;
    const cur = new Set(Array.isArray(sf.perms) ? sf.perms : (ROLES[sf.role] || ROLES.cashier).perms);
    const draw = () => { $('#modalRoot').innerHTML = modalShell('Role & permissions – ' + escapeHtml(sf.name), `
      <div class="chip-row" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">${Object.keys(ROLES).filter(k => k !== 'custom').map(k => `<button type="button" class="chip-btn" data-role="${k}" style="${sf.role === k ? 'background:var(--primary);color:#fff' : ''}">${ROLES[k].name}</button>`).join('')}</div>
      <div class="text-sm text-secondary" style="margin-bottom:8px">Pick a role, or tick exactly what this person may do.</div>
      ${PERMS.map(x => `<label style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)"><input type="checkbox" data-perm="${x[0]}" ${cur.has(x[0]) ? 'checked' : ''}> <span>${x[1]}</span></label>`).join('')}
      <div style="display:flex;gap:8px;margin-top:14px"><button type="button" class="btn btn-primary" style="flex:1" id="spSave">Save</button></div>`);
      document.querySelectorAll('#modalRoot [data-role]').forEach(b => b.onclick = () => { sf.role = b.dataset.role; cur.clear(); ROLES[sf.role].perms.forEach(x => cur.add(x)); draw(); });
      document.querySelectorAll('#modalRoot [data-perm]').forEach(c => c.onchange = () => { c.checked ? cur.add(c.dataset.perm) : cur.delete(c.dataset.perm); sf.role = 'custom'; });
      document.getElementById('spSave').onclick = () => { sf.perms = [...cur]; persist(); closeModal(); toast('Permissions saved'); if (currentView === 'app-lock') render(); };
    };
    draw();
  }
  async function openPinModal(kind, staffId) {
    const staff = kind === 'staff';
    if (!window.HisablyFreemium || !HisablyFreemium.hasFeature('passcode')) { toast('PIN lock and staff mode are Pro features.', 4500); openPlansModal && openPlansModal(); return; }
    if (staff && !settings.pinHash) { toast('Set the owner PIN first'); return; }
    let sf = staff && staffId ? staffList().find(x => x.id === staffId) : null;
    let sname = sf ? sf.name : ''; let newRole = '';
    if (staff && !sf) {
      sname = ((await askPrompt('Staff member name (shown on the bills they make)', '', { title: 'Add staff user' })) || '').trim();
      if (!sname) return;
      newRole = await chooseRole('cashier'); if (!newRole) return;
    }
    let stage = 1, first = '', nid = '';
    const draw = (entered, msg) => {
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
      $('#modalRoot').innerHTML = `<div class="lock-screen pin-setup"><div class="lock-box">
        <div class="lock-title">${staff ? escapeHtml(sname) + ' – PIN' : 'Owner PIN'}</div>
        <div class="lock-sub">${escapeHtml(msg || (stage === 1 ? 'Choose a 4-digit PIN' : 'Repeat the PIN to confirm'))}</div>
        <div class="lock-dots">${[0, 1, 2, 3].map(i => `<span class="${i < entered.length ? 'on' : ''}"></span>`).join('')}</div>
        <div class="lock-pad">${keys.map(k => k === '' ? '<span></span>' : `<button type="button" data-k="${k}">${k}</button>`).join('')}</div>
        <div class="lock-sub" style="font-size:.78rem;margin-top:10px">${staff ? 'Staff only get the permissions of their role.' : 'The owner PIN opens everything.'}</div>
        <button type="button" class="lock-link" data-pin-cancel>Cancel</button></div></div>`;
      document.querySelector('[data-pin-cancel]').onclick = () => closeModal();
      document.querySelectorAll('#modalRoot [data-k]').forEach(b => b.onclick = () => press(entered, b.dataset.k));
    };
    const press = async (entered, k) => {
      if (k === '⌫') return draw(entered.slice(0, -1));
      if (entered.length >= 4) return;
      entered += k;
      if (entered.length < 4) return draw(entered);
      draw(entered);
      if (stage === 1) { first = entered; stage = 2; setTimeout(() => draw(''), 180); return; }
      if (entered !== first) { stage = 1; first = ''; setTimeout(() => draw('', 'PINs did not match – try again'), 250); return; }
      if (!settings.pinSalt) settings.pinSalt = uid().replace(/-/g, '');
      const h = await pinHash(entered);
      const clash = (staff && h === settings.pinHash) ? 'owner' : staffList().find(x => x.hash === h && (!sf || x.id !== sf.id));
      if (clash) { stage = 1; first = ''; draw('', clash === 'owner' ? 'That is the owner PIN – pick another' : 'Used by ' + clash.name + ' – pick another'); return; }
      if (staff) { if (sf) sf.hash = h; else { nid = uid(); staffList().push({ id: nid, name: sname, hash: h, role: newRole, perms: newRole === 'custom' ? [] : ROLES[newRole].perms.slice() }); } }
      else { settings.pinHash = h; setRole('owner'); }
      persist(); closeModal();
      if (staff && nid && newRole === 'custom') { openStaffPerms(nid); return; }
      toast(staff ? sname + ' can now sign in with the PIN' : 'Owner PIN saved. The app will lock when you leave it.', 3500);
      if (currentView === 'app-lock') render(); else setView('app-lock');
    };
    draw('');
  }
  function viewAppLock() {
    const on = !!settings.pinHash;
    const row = (label, attr, danger) => `<div class="list-row" ${attr}><div class="list-row-left"><div class="list-row-label" ${danger ? 'style="color:#E11D48"' : ''}>${label}</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>`;
    const pro = HisablyFreemium.hasFeature('passcode');
    return `<div class="fade-in" style="padding:16px 0 28px">
      <div class="doc-card" style="margin:0 16px 12px"><div style="font-weight:800;font-size:1.05rem">${on ? '🔒 App lock is ON' : '🔓 App lock is OFF'}</div>
        <div class="text-sm text-secondary" style="margin-top:4px">${on ? 'The app asks for a PIN when you open it.' + (staffList().length ? ' ' + staffList().length + ' staff user(s).' : ' No staff users yet.') : 'Protect your shop data with a 4-digit PIN, and give your staff a limited login.'}</div>
        ${pro ? '' : '<div class="text-sm" style="color:#B45309;margin-top:8px">PIN lock and staff mode need the Pro or Lifetime plan.</div>'}</div>
      <div class="list-group">
        ${row(on ? 'Change owner PIN' : 'Set owner PIN', 'data-action="pin-set-owner"')}
        ${on ? staffList().map(x => `<div class="list-row" style="cursor:default"><div class="list-row-left"><div><div class="list-row-label">👤 ${escapeHtml(x.name)}</div><div class="list-row-sub">${escapeHtml((ROLES[x.role] || ROLES.cashier).name)}</div></div></div><div class="list-row-right" style="display:flex;gap:6px"><button class="chip-btn" data-action="staff-perms" data-id="${x.id}">Role</button><button class="chip-btn" data-action="staff-edit" data-id="${x.id}">Change PIN</button><button class="chip-btn" style="color:#E11D48" data-action="staff-del" data-id="${x.id}">Remove</button></div></div>`).join('') : ''}
        ${on ? row('+ Add staff user', 'data-action="pin-set-staff"') : ''}
        ${on ? row('Lock app now', 'data-action="lock-now"') : ''}
        ${on ? row('Remove PIN lock', 'data-action="pin-remove"', true) : ''}
      </div>
      <div class="text-sm text-secondary" style="padding:14px 16px;line-height:1.6">Each staff user has a role (Manager, Accountant, Cashier, Salesperson, Storekeeper or Custom) that decides which screens and actions they can use. Tap <b>Role</b> to change it. Only the owner can change settings and PINs.<br>Forgot the PIN? Sign in to your cloud account to reset it.</div>
    </div>`;
  }
  function themePickerHTML() {
    const cur = settings.invoiceTheme || 'teal';
    const ok = window.HisablyFreemium && HisablyFreemium.hasFeature('themes');
    const T = HisablyReceipt.THEMES;
    const th = T[cur] || T.teal, band = th.style === 'band';
    return `<div class="doc-card" id="themePicker" style="margin-top:12px">
      <div class="doc-label">Invoice style (PDF, image &amp; A4 print)</div>
      <div class="chip-row mb-8">${Object.keys(T).map(k => `<button type="button" class="cat-chip${k === cur ? ' active' : ''}" data-action="pick-theme" data-theme="${k}"><span class="theme-dot" style="background:${T[k].accent}"></span>${T[k].name}${T[k].pro && !ok ? ' 🔒' : ''}</button>`).join('')}</div>
      <div class="theme-prev" style="${band ? `background:${th.accent};color:#fff` : `border-bottom:3px solid ${th.accent}`}">
        <b>${escapeHtml(settings.businessName || 'Your business')}</b><span>INVOICE</span></div>
      <div class="theme-prev-tot" style="background:${th.soft};color:${th.dark}"><span>Total</span><b>${escapeHtml(settings.currency || '')} 1,000</b></div>
      ${ok ? '' : '<div class="text-sm text-secondary mt-8">🔒 More styles are available on Pro.</div>'}
    </div>`;
  }
  function securityHTML() {
    const ok = window.HisablyFreemium && HisablyFreemium.hasFeature('passcode');
    return `<div class="doc-card" style="margin-top:12px">
      <div class="doc-label">App lock &amp; staff ${ok ? '' : '<span style="font-size:10px;background:var(--primary);color:#fff;border-radius:6px;padding:1px 6px;margin-left:6px">PRO</span>'}</div>
      <div class="text-sm text-secondary mb-8">${settings.pinHash ? 'Lock is ON.' + (staffList().length ? ' ' + staffList().length + ' staff user(s).' : ' No staff users yet.') : 'Protect the app with a PIN and give your staff a limited login.'}</div>
      <div class="flex gap-8" style="flex-wrap:wrap">
        <button type="button" class="btn btn-secondary btn-sm" data-action="pin-set-owner">${settings.pinHash ? 'Change owner PIN' : 'Set owner PIN'}</button>
        ${settings.pinHash ? `<button type="button" class="btn btn-secondary btn-sm" data-action="pin-set-staff">${staffList().length ? 'Staff users' : 'Add staff user'}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="pin-remove">Remove lock</button>` : ''}
      </div></div>`;
  }
  function staffMoreHTML() {
    const sf = currentStaff();
    const item = (label, attr) => `<button class="menu-item" ${attr}>${label}<svg class="menu-item-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>`;
    const rows = [];
    if (can('parties')) rows.push(item('Customers', 'data-view="customers"'));
    if (can('purchases')) rows.push(item('Purchases & suppliers', 'data-view="purchases"'));
    if (can('expenses')) rows.push(item('Expenses', 'data-view="expenses"'));
    if (can('receive_payment')) rows.push(item('Payment reminders', 'data-view="payment-reminders"'));
    if (can('reports')) { rows.push(item('Sale report', 'data-view="sale-report"')); rows.push(item('Day book', 'data-view="daybook-detail"')); rows.push(item('Profit & loss', 'data-view="profit-loss"')); }
    if (can('banks')) rows.push(item('Bank accounts', 'data-view="banks"'));
    if (can('items_view')) rows.push(item('Low stock', 'data-view="low-stock"'));
    if (can('items_edit')) rows.push(item('Barcode labels', 'data-view="barcode-gen"'));
    if (can('export')) rows.push(item('Backup to phone', 'data-action="export-data"'));
    try { if (window.BillauraExt && BillauraExt.staffRows) BillauraExt.staffRows().forEach(r => rows.push(item(r[0], r[1]))); } catch (e) {}
    rows.push(item('Sync now', 'data-action="cloud-sync"'), item('Lock app / switch user', 'data-action="lock-now"'));
    return `<div class="fade-in">
      <div class="card mb-16"><div class="text-sm text-secondary">Signed in as</div><div class="font-semibold" style="font-size:1.0625rem">${escapeHtml(sf ? sf.name : 'Staff')}</div><div class="text-sm text-secondary">${escapeHtml((ROLES[(sf && sf.role) || 'cashier'] || ROLES.cashier).name)}</div></div>
      <div class="menu-list mb-16">${rows.join('')}</div></div>`;
  }
  // ---- Desktop sidebar (shown only on wide screens, see css "Desktop layout") ----
  const SIDE_ITEMS = [
    ['home', 'Home', 'home'], ['dashboard', 'Dashboard', 'chart'], ['invoices', 'Sale / Transactions', 'sale'],
    ['purchases', 'Purchases', 'cart'], ['products', 'Items', 'box'], ['customers', 'Parties', 'users'],
    ['expenses', 'Expenses', 'wallet'], ['reports', 'Reports', 'report'], ['banks', 'Cash & Bank', 'bank'],
    ['online-store', 'Online Store', 'store'], ['more', 'All Menu', 'docs'], ['settings', 'Settings', 'gear']
  ];
  function sideActiveFor(view) {
    const ids = SIDE_ITEMS.map(x => x[0]);
    if (ids.includes(view)) return view;
    if (view === 'create-invoice') return 'invoices';
    if (['suppliers'].includes(view)) return 'customers';
    if (['cash-in-hand', 'daybook', 'daybook-detail', 'cheques', 'loans'].includes(view)) return 'banks';
    if (['sale-report', 'profit-loss', 'bill-pnl', 'balance-sheet', 'stock-history'].includes(view)) return 'reports';
    if (/settings|profile|lock|account|theme|currency|print/.test(view)) return 'settings';
    return '';
  }
  function buildSideNav() {
    const el = document.getElementById('sideNav');
    if (!el) return;
    if (!el.dataset.built) {
      el.dataset.built = '1';
      el.innerHTML = `<div class="side-brand"><img src="assets/icon-maskable-512.png" alt="" width="40" height="40"><div><b id="sideBiz">Billaura</b><small>Smart Billing &amp; Business</small></div></div>
        <button class="side-cta" data-view="create-invoice">${ico('plus')} Add New Sale</button>
        <nav class="side-list">${SIDE_ITEMS.map(x => `<button class="side-item" data-view="${x[0]}">${ico(x[2])}<span>${x[1]}</span></button>`).join('')}</nav>
        <div class="side-foot">© 2026 Billaura</div>`;
    }
    const biz = document.getElementById('sideBiz'); if (biz) biz.textContent = settings.businessName || 'Billaura';
    const act = sideActiveFor(currentView);
    el.querySelectorAll('.side-item').forEach(b => {
      const v = b.dataset.view; const need = viewPerm(v);
      b.style.display = (isStaff() && need && !can(need)) ? 'none' : '';
      b.classList.toggle('active', v === act);
    });
    const cta = el.querySelector('.side-cta');
    if (cta) { const need = viewPerm('create-invoice', 'sale'); cta.style.display = (isStaff() && need && !can(need)) ? 'none' : ''; }
  }
  function applyNavPerms() {
    try { buildSideNav(); } catch (e) {}
    document.querySelectorAll('.bottom-nav .nav-item').forEach(n => {
      if (n.id === 'navDesktop') { n.style.display = location.protocol === 'billaura:' ? 'none' : ''; return; }
      const v = n.dataset.view; const need = v ? viewPerm(v) : null;
      n.style.display = (isStaff() && need && !can(need)) ? 'none' : '';
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { _lastHidden = Date.now(); return; }
    if (lockEnabled() && _lastHidden && Date.now() - _lastHidden > 60000) showLock();
  });

  // ---------- Day Book / cash flow ----------
  let dbRange = 'today', dbMode = 'all';
  const PAY_MODES = ['Cash', 'Bank', 'Online', 'Cheque'];
  function dayKey(iso) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return iso;
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function modeChips(id) {
    return `<div class="chip-row mt-8" id="${id}">${PAY_MODES.map((m, i) => `<button type="button" class="cat-chip${i ? '' : ' active'}" data-action="rp-mode" data-mode="${m}">${m}</button>`).join('')}</div>`;
  }
  function pickedMode(id) {
    const a = document.querySelector('#' + id + ' .cat-chip.active');
    return a ? a.dataset.mode : 'Cash';
  }
  // Every rupee that actually moved: payments in, refunds / purchase payments / expenses out
  function cashEntries() {
    const out = [];
    const split = (doc, label, dir, party) => {
      const pays = (doc.meta && doc.meta.payments) || [];
      const first = round2((doc.paidAmount || 0) - pays.reduce((s, p) => s + p.amount, 0));
      if (first > 0.001) out.push({ date: doc.date, mode: (doc.meta && doc.meta.paymentMode) || 'Cash', dir, amount: first, text: `${label} ${doc.number}`, party, br: (doc.meta && doc.meta.branchId) || 'main' });
      pays.forEach(p => out.push({ date: p.date, mode: p.mode || 'Cash', dir, amount: p.amount, text: `${label} ${doc.number}${p.note ? ' · ' + p.note : ''}`, party, br: (doc.meta && doc.meta.branchId) || 'main' }));
    };
    invoices.forEach(inv => {
      const g = docSign(inv); if (!g) return;
      if (g > 0) split(inv, 'Payment in', 'in', inv.customerName);
      else split(inv, 'Refund', 'out', inv.customerName);
    });
    purchases.forEach(p => split(p, 'Paid for', 'out', p.supplierName));
    expenses.forEach(e => out.push({ date: e.date, mode: 'Cash', dir: 'out', amount: e.amount || 0, text: 'Expense · ' + (e.title || e.category || ''), party: '', br: (settings.expBranch || {})[e.id] || 'main' }));
    out.forEach(r => { r.day = dayKey(r.date); r.t = /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)) ? ts(r.date + 'T12:00:00') : ts(r.date); });
    return out.filter(r => r.amount > 0).sort((a, b) => b.t - a.t);
  }
  function viewCashInHandOld() {
    const cur = settings.currency || 'Rs';
    const bal = cashInHandBalance();
    // Recent cash transactions
    let rows = [];
    try {
      rows = cashEntries().filter(r => (r.mode || 'Cash') === 'Cash')
        .map(r => ({...r, _sort: new Date(r.date).getTime()}));
      cashAdjustments().forEach(a => rows.push({
        date: a.date, text: a.note || 'Cash Adjustment', amount: Math.abs(a.amount||0),
        dir: (a.amount||0) >= 0 ? 'in' : 'out', party: '', _sort: new Date(a.date).getTime()
      }));
      rows.sort((a,b) => b._sort - a._sort);
      rows = rows.slice(0, 30);
    } catch (_) {}

    return `<div class="fade-in">
      <div style="margin:16px;background:linear-gradient(135deg,#D1FAE5,#A7F3D0);border-radius:16px;padding:20px;text-align:center">
        <div style="font-size:0.8125rem;color:#065F46;font-weight:500">Current Cash Balance</div>
        <div style="font-size:1.75rem;font-weight:700;color:#047857;margin-top:4px">${cur} ${money(bal)}</div>
      </div>
      <div class="section-title">Bill Details</div>
      ${rows.length === 0
        ? `<div class="empty-state" style="padding:32px 16px"><p>No cash transactions yet</p></div>`
        : rows.map(r => {
            const sign = r.dir === 'in' ? '+' : '−';
            const col = r.dir === 'in' ? 'var(--success)' : 'var(--danger)';
            return `<div class="txn-card" style="cursor:default">
              <div class="txn-top">
                <div class="txn-party">${escapeHtml(r.text || (r.dir === 'in' ? 'Cash In' : 'Cash Out'))}</div>
                <span style="font-weight:600;color:${col}">${sign}${cur} ${money(r.amount||0)}</span>
              </div>
              <div class="txn-meta">
                <span>${formatDate(r.date)}${r.party ? ' · ' + escapeHtml(r.party) : ''}</span>
                <span>Cash</span>
              </div>
            </div>`;
          }).join('')}
      <div style="display:flex;gap:10px;padding:16px;position:sticky;bottom:calc(var(--nav-height) + 8px);background:var(--bg)">
        <button class="btn btn-outline btn-block" data-view="daybook" style="display:none">Day Book</button>
        <button class="btn btn-outline btn-block" data-action="adjust-cash">Bank Transfer</button>
        <button class="btn btn-primary btn-block" data-action="adjust-cash">Adjust Cash</button>
      </div>
      <div style="padding:0 16px 8px">
        <button class="btn btn-ghost btn-block" data-action="db-full">View full Day Book / Cash Flow →</button>
      </div>
    </div>`;
  }

  function viewDayBook() {
    const now = new Date();
    const key = off => { const d = new Date(now); d.setDate(d.getDate() - off); return dayKey(d.toISOString()); };
    const ranges = { today: [key(0), key(0)], yesterday: [key(1), key(1)], week: [key(6), key(0)], month: [key(29), key(0)], all: ['0000', '9999'] };
    const [from, to] = ranges[dbRange] || ranges.today;
    const all = cashEntries().filter(r => r.day >= from && r.day <= to);
    const rows = all.filter(r => dbMode === 'all' || r.mode === dbMode);
    const sum = (list, dir) => round2(list.filter(r => r.dir === dir).reduce((s, r) => s + r.amount, 0));
    const inn = sum(rows, 'in'), outt = sum(rows, 'out'), net = round2(inn - outt);
    const cur = settings.currency;
    const rl = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', '7 days'], ['month', '30 days'], ['all', 'All']];
    const modes = ['all'].concat(PAY_MODES);
    const byMode = PAY_MODES.map(m => { const l = all.filter(r => r.mode === m); return { m, i: sum(l, 'in'), o: sum(l, 'out') }; }).filter(x => x.i || x.o);
    const days = [];
    rows.forEach(r => { let d = days[days.length - 1]; if (!d || d.day !== r.day) { d = { day: r.day, list: [] }; days.push(d); } d.list.push(r); });
    return `<div class="fade-in">
      <div class="cat-chips">${rl.map(r => `<button class="cat-chip${dbRange === r[0] ? ' active' : ''}" data-action="db-range" data-v="${r[0]}">${r[1]}</button>`).join('')}</div>
      <div class="cat-chips">${modes.map(m => `<button class="cat-chip${dbMode === m ? ' active' : ''}" data-action="db-mode" data-v="${m}">${m === 'all' ? 'All modes' : m}</button>`).join('')}</div>
      <div class="stats-grid" style="grid-template-columns:repeat(2,1fr)">
        <div class="stat-card"><div class="stat-label">Money In</div><div class="stat-value success" style="font-size:1.125rem">${cur} ${money(inn)}</div></div>
        <div class="stat-card"><div class="stat-label">Money Out</div><div class="stat-value danger" style="font-size:1.125rem">${cur} ${money(outt)}</div></div>
      </div>
      <div class="doc-card tot-row" style="margin-top:-4px"><span>Net cash flow</span><b style="color:var(--${net >= 0 ? 'success' : 'danger'})">${net < 0 ? '−' : ''}${cur} ${money(Math.abs(net))}</b></div>
      ${byMode.length ? `<div class="doc-card"><div class="doc-label">By payment mode</div>${byMode.map(x => `
        <div class="tot-row"><span>${x.m}</span><span class="text-sm"><span style="color:var(--success)">+${money(x.i)}</span> &nbsp; <span style="color:var(--danger)">−${money(x.o)}</span> &nbsp; <b>${money(round2(x.i - x.o))}</b></span></div>`).join('')}</div>` : ''}
      ${days.length === 0 ? '<div class="doc-empty">No money moved in this period</div>' : days.map(d => {
        const dn = round2(sum(d.list, 'in') - sum(d.list, 'out'));
        return `<div class="section-header"><h2 class="section-title">${formatDate(d.day + 'T12:00:00')}</h2><span class="text-sm" style="color:var(--${dn >= 0 ? 'success' : 'danger'});font-weight:700">${dn < 0 ? '−' : ''}${money(Math.abs(dn))}</span></div>
        <div class="list">${d.list.map(r => `
          <div class="list-item"><div class="list-item-body"><div class="list-item-title">${escapeHtml(r.text)}</div>
            <div class="list-item-sub">${escapeHtml(r.party || '')}${r.party ? ' · ' : ''}${escapeHtml(r.mode)}</div></div>
            <div class="list-item-right"><div class="list-item-price" style="color:var(--${r.dir === 'in' ? 'success' : 'danger'})">${r.dir === 'in' ? '+' : '−'}${money(r.amount)}</div></div></div>`).join('')}</div>`;
      }).join('')}
    </div>`;
  }

  // ---------- Purchases & supplier payables ----------
  function nextPurNumber() {
    let mx = 1000;
    purchases.forEach(p => { const m = String(p.number).match(/(\d+)\s*$/); if (m) mx = Math.max(mx, parseInt(m[1], 10)); });
    return `PUR-${mx + 1}`;
  }
  function supplierOf(p) {
    return suppliers.find(s => s.id === p.supplierId) || { id: p.supplierId, name: p.supplierName, phone: p.supplierPhone };
  }
  function supplierPurchases(sup) {
    return purchases.filter(p => (sup.id && p.supplierId === sup.id) || (!p.supplierId && p.supplierName && p.supplierName.toLowerCase() === (sup.name || '').toLowerCase()));
  }
  function supplierBalance(sup) {
    let total = 0, paid = 0;
    supplierPurchases(sup).forEach(p => { total += p.total || 0; paid += p.paidAmount || 0; });
    return { total, paid, due: Math.max(0, round2(total - paid)) };
  }
  // money we hold for customers who paid more than their bill (advance / credit)
  function customerCredit() {
    return round2(invoices.reduce((a, i) => (docSign(i) > 0 && i.docType !== 'estimate') ? a + Math.max(0, (i.paidAmount || 0) - (i.total || 0)) : a, 0));
  }
  function creditOfCustomer(cust) {
    if (!cust) return 0;
    return round2(custDocs(cust).reduce((a, i) => (docSign(i) > 0 && i.docType !== 'estimate') ? a + Math.max(0, (i.paidAmount || 0) - (i.total || 0)) : a, 0));
  }
  // move `amt` of a customer's credit (overpaid bills, oldest first) onto a new bill
  function consumeCredit(cust, amt, usedOn) {
    let left = round2(amt); const now = new Date().toISOString();
    custDocs(cust).filter(i => docSign(i) > 0 && i.docType !== 'estimate' && (i.paidAmount || 0) > (i.total || 0) + 0.001)
      .sort((a, b) => ts(a.date) - ts(b.date)).forEach(i => {
        if (left <= 0.001) return;
        const take = Math.min(left, round2((i.paidAmount || 0) - (i.total || 0)));
        i.paidAmount = round2((i.paidAmount || 0) - take);
        i.meta = i.meta || {}; (i.meta.payments = i.meta.payments || []).push({ date: now, amount: -take, mode: 'Credit used', note: 'Used on ' + usedOn });
        i.updatedAt = now; left = round2(left - take);
      });
  }
  function totalGive() { return round2(totalPayable() + customerCredit()); }
  function totalPayable() {
    return round2(purchases.reduce((s, p) => s + Math.max(0, (p.total || 0) - (p.paidAmount || 0)), 0));
  }

  function listPurchase(p) {
    const paid = p.paidAmount || 0, due = Math.max(0, (p.total || 0) - paid);
    const badge = due <= 0.001 ? '<span class="list-item-badge badge-ok">Paid</span>'
      : (paid > 0 ? `<span class="list-item-badge badge-low">Owe ${settings.currency} ${money(due)}</span>` : '<span class="list-item-badge badge-out">Unpaid</span>');
    return `<div class="list-item" data-action="view-purchase" data-id="${p.id}">
      <div class="list-item-icon">${initials(p.supplierName || 'S')}</div>
      <div class="list-item-body">
        <div class="list-item-title">${escapeHtml(p.supplierName || 'Unknown supplier')}</div>
        <div class="list-item-sub">${escapeHtml(p.number)} · ${formatDate(p.date)} · ${p.items.length} item${p.items.length !== 1 ? 's' : ''}</div>
        ${badge}${isOverdue(p) ? ' <span class="list-item-badge badge-out">Overdue</span>' : ''}
      </div>
      <div class="list-item-right"><div class="list-item-price">${settings.currency} ${money(p.total)}</div></div>
    </div>`;
  }
  function viewPurchases() {
    if (purchases.length === 0) {
      return emptyState('box', 'No purchases yet', 'Record stock you buy from suppliers. Stock goes up and you can track what you owe.', 'Add Purchase', null, 'new-purchase');
    }
    const owe = totalPayable();
    const list = [...purchases].sort((a, b) => ts(b.date) - ts(a.date));
    return `<div class="fade-in">
      <div class="stats-grid" style="grid-template-columns:repeat(2,1fr)">
        <div class="stat-card"><div class="stat-label">Total Bought</div><div class="stat-value primary" style="font-size:1.125rem">${settings.currency} ${money(purchases.reduce((s, p) => s + (p.total || 0), 0))}</div></div>
        <div class="stat-card"><div class="stat-label">To Pay</div><div class="stat-value ${owe > 0 ? 'danger' : 'success'}" style="font-size:1.125rem">${settings.currency} ${money(owe)}</div></div>
      </div>
      <div class="list">${list.map(listPurchase).join('')}</div></div>`;
  }

  function openPurchaseDetail(p) {
    const paid = p.paidAmount || 0, due = Math.max(0, round2((p.total || 0) - paid));
    const x = invExtraRows(p);
    const pays = (p.meta && p.meta.payments) || [];
    const first = round2(paid - pays.reduce((s, q) => s + q.amount, 0));
    $('#modalRoot').innerHTML = `
      <div class="modal-overlay"><div class="modal-sheet">
        <div class="modal-handle"></div>
        <div class="modal-header"><h3 class="modal-title">Purchase ${escapeHtml(p.number)}</h3>
          <button class="modal-close" data-action="close-modal"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
        <div class="mb-16"><div class="text-sm text-secondary">Supplier</div><div class="font-semibold">${escapeHtml(p.supplierName || 'Unknown')}</div>
          <div class="text-sm text-secondary mt-8">${formatDate(p.date)}${p.meta && p.meta.billNo ? ' · Bill ' + escapeHtml(p.meta.billNo) : ''}</div></div>
        <div class="invoice-summary">
          ${p.items.map(it => `<div class="summary-row"><span>${escapeHtml(it.name)} × ${it.qty} @ ${money(it.price)}</span><span>${settings.currency} ${money(it.price * it.qty)}</span></div>`).join('')}
          ${x.rows.length ? `<div class="summary-row"><span>Subtotal</span><span>${settings.currency} ${money(x.sub)}</span></div>` + x.rows.map(r => `<div class="summary-row"><span>${escapeHtml(r.label)}</span><span>${r.amt < 0 ? '−' : ''}${settings.currency} ${money(Math.abs(r.amt))}</span></div>`).join('') : ''}
          <div class="summary-row total"><span>Total</span><span>${settings.currency} ${money(p.total)}</span></div>
          <div class="summary-row"><span>Paid</span><span style="color:var(--success)">${settings.currency} ${money(paid)}</span></div>
          <div class="summary-row"><span>Balance to pay</span><span style="color:${due > 0 ? 'var(--danger)' : 'var(--success)'}">${settings.currency} ${money(due)}</span></div>
          ${p.meta && p.meta.dueDate ? `<div class="summary-row"><span>Due date</span><span${isOverdue(p) ? ' style="color:var(--danger);font-weight:600"' : ''}>${formatDate(p.meta.dueDate)}${isOverdue(p) ? ' · overdue' : ''}</span></div>` : ''}
        </div>
        ${(first > 0.001 || pays.length) ? `<div class="doc-label mt-16">Payments made</div>
          ${first > 0.001 ? `<div class="summary-row"><span>${formatDate(p.date)}${p.meta && p.meta.paymentMode ? ' · ' + escapeHtml(p.meta.paymentMode) : ''}</span><span>${settings.currency} ${money(first)}</span></div>` : ''}
          ${pays.map(q => `<div class="summary-row"><span>${formatDate(q.date)} · ${escapeHtml(q.mode || '')}${q.note ? ' · ' + escapeHtml(q.note) : ''}</span><span>${settings.currency} ${money(q.amount)}</span></div>`).join('')}` : ''}
        ${due > 0.001 ? `
        <div class="form-group mt-16"><label class="form-label">Record payment to supplier</label>
          <div class="input-with-btn"><input type="number" class="form-input" id="recordPayInput" min="0" step="any" placeholder="Amount" />
            <button type="button" class="btn btn-primary btn-sm" style="height:48px" data-action="purchase-pay" data-id="${p.id}">Add</button></div>${modeChips('rpMode')}</div>
        <button class="btn btn-secondary btn-block mt-8" data-action="purchase-pay-full" data-id="${p.id}">Mark as Fully Paid</button>` : ''}
      </div></div>`;
  }

  function openSupplierDetail(sup) {
    const bal = supplierBalance(sup);
    const list = supplierPurchases(sup).sort((a, b) => ts(b.date) - ts(a.date));
    $('#modalRoot').innerHTML = `
      <div class="modal-overlay"><div class="modal-sheet">
        <div class="modal-handle"></div>
        <div class="modal-header"><h3 class="modal-title">${escapeHtml(sup.name)}</h3>
          <button class="modal-close" data-action="close-modal"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
        <div class="text-sm text-secondary mb-8">${escapeHtml(sup.phone || 'No phone')}</div>
        <div class="stats-grid mb-16">
          <div class="stat-card"><div class="stat-label">Total Bought</div><div class="stat-value primary">${settings.currency} ${money(bal.total)}</div></div>
          <div class="stat-card"><div class="stat-label">You Owe</div><div class="stat-value ${bal.due > 0 ? 'danger' : 'success'}">${settings.currency} ${money(bal.due)}</div></div>
        </div>
        <div class="section-header"><h2 class="section-title">Purchase history</h2></div>
        ${list.length ? `<div class="list">${list.map(listPurchase).join('')}</div>` : '<div class="text-secondary text-sm">No purchases yet</div>'}
        <div class="flex gap-8 mt-16">
          ${bal.due > 0 ? `<button class="btn btn-primary" style="flex:1" data-action="pay-supplier" data-id="${sup.id}">Pay Supplier</button>` : ''}
          <button class="btn btn-secondary" style="flex:1" data-action="edit-supplier" data-id="${sup.id}">Edit</button>
        </div>
      </div></div>`;
  }

  function openPaySupplierModal(sup) {
    const bal = supplierBalance(sup);
    const today = new Date().toISOString().slice(0, 10);
    $('#modalRoot').innerHTML = `
      <div class="modal-overlay"><div class="modal-sheet">
        <div class="modal-handle"></div>
        <div class="modal-header"><h3 class="modal-title">Pay Supplier</h3>
          <button class="modal-close" data-action="close-modal"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
        <div class="text-secondary text-sm mb-8">${escapeHtml(sup.name)} · You owe ${settings.currency} ${money(bal.due)}</div>
        <form id="paySupForm" autocomplete="off">
          <div class="form-group"><label class="form-label">Amount (${settings.currency})</label><input type="number" inputmode="decimal" class="form-input" id="psAmt" min="0" step="any" value="${bal.due}" /></div>
          <div class="chip-row mb-8" id="psMode"><button type="button" class="cat-chip active" data-mode="Cash">Cash</button><button type="button" class="cat-chip" data-mode="Bank">Bank</button><button type="button" class="cat-chip" data-mode="Online">Online</button><button type="button" class="cat-chip" data-mode="Cheque">Cheque</button></div>
          <div class="form-row"><div class="form-group"><label class="form-label">Date</label><input type="date" class="form-input" id="psDate" value="${today}" max="${today}" /></div>
            <div class="form-group"><label class="form-label">Note</label><input type="text" class="form-input" id="psNote" maxlength="40" placeholder="Optional" /></div></div>
          <div class="text-sm text-secondary">Settles the oldest unpaid purchases first.</div>
          <button type="submit" class="btn btn-primary btn-block mt-16">Save Payment</button>
        </form></div></div>`;
    let mode = 'Cash';
    document.querySelectorAll('#psMode .cat-chip').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; document.querySelectorAll('#psMode .cat-chip').forEach(x => x.classList.toggle('active', x === b)); }));
    document.getElementById('paySupForm').addEventListener('submit', e => {
      e.preventDefault();
      let amt = round2(parseFloat(document.getElementById('psAmt').value) || 0);
      if (amt <= 0) { toast('Enter an amount'); return; }
      if (amt > bal.due + 0.001) { toast(`You only owe ${settings.currency} ${money(bal.due)}`, 3500); return; }
      const d = document.getElementById('psDate').value;
      const dateIso = (d && d !== today) ? new Date(d + 'T12:00:00').toISOString() : new Date().toISOString();
      const note = document.getElementById('psNote').value.trim();
      let n = 0;
      supplierPurchases(sup).filter(p => (p.total || 0) - (p.paidAmount || 0) > 0.001).sort((a, b) => ts(a.date) - ts(b.date)).forEach(p => {
        if (amt <= 0.001) return;
        const used = addPayment(p, amt, mode, note, dateIso); if (used > 0) { amt = round2(amt - used); n++; }
      });
      persist(); toast(`Payment saved · ${n} purchase${n !== 1 ? 's' : ''} updated`); render(); openSupplierDetail(sup);
    });
  }

  // ---------- Create Invoice (document form) ----------
  // Totals math shared by the form, detail view, PDF, receipt and WhatsApp text.
  function calcDoc(lines, o) {
    o = o || {};
    const sub = round2(lines.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.qty) || 0), 0));
    let discount = o.discType === 'pct' ? sub * (Number(o.discValue) || 0) / 100 : (Number(o.discValue) || 0);
    discount = round2(Math.min(Math.max(discount, 0), sub));
    const taxable = round2(sub - discount);
    const taxRate = Math.max(0, Number(o.taxRate) || 0);
    const inc = !!settings.enableInclusiveTax;
    const flat = o.taxType === 'amt';
    const tax = flat ? round2(Math.min(taxRate, inc ? taxable : 1e12)) : inc ? round2(taxable - taxable / (1 + taxRate / 100)) : round2(taxable * taxRate / 100);
    const charges = round2(Math.max(0, Number(o.charges) || 0));
    const raw = inc ? taxable + charges : taxable + tax + charges;
    const total = o.roundOff ? Math.round(raw) : round2(raw);
    const roundOff = round2(total - raw);
    return { sub, discount, taxable, taxRate, tax, taxType: flat ? 'amt' : 'pct', charges, roundOff, total };
  }
  // Extra rows (discount/tax/charges/round-off) to show under the item list of a saved invoice
  function invExtraRows(inv) {
    const m = inv.meta || {};
    const rows = [];
    const itemsSub = round2((inv.items || []).reduce((s, i) => s + (i.price || 0) * (i.qty || 0), 0));
    if (!(m.discount || m.tax || m.charges || m.roundOff)) return { sub: itemsSub, rows };
    if (m.discount) rows.push({ label: 'Discount' + (m.discType === 'pct' && m.discValue ? ` (${m.discValue}%)` : ''), amt: -m.discount });
    if (m.tax) rows.push({ label: m.taxType === 'amt' ? (m.taxName || 'Tax') : `${m.taxName || 'Tax'} (${m.taxRate}%)`, amt: m.tax });
    if (m.charges) rows.push({ label: m.chargeLabel || 'Additional charges', amt: m.charges });
    if (m.roundOff) rows.push({ label: 'Round off', amt: m.roundOff });
    return { sub: itemsSub, rows };
  }

  function viewCreateInvoice() {
    const customerOptions = [
      { value: '', label: 'Walk-in Customer' },
      ...customers.map(c => {
        const bal = customerBalance(c.id, c.name, c.phone);
        const debt = bal.due > 0 ? ` · Due ${settings.currency} ${money(bal.due)}` : '';
        return { value: c.id, label: c.name + (c.phone ? ' · ' + c.phone : ' · no phone') + debt };
      })
    ];
    const today = new Date().toISOString().slice(0, 10);
    const cur = settings.currency;
    const isRet = docCtx.type === 'return';
    const isEst = docCtx.type === 'estimate';
    const isPur = docCtx.type === 'purchase';
    const ref = docCtx.ref;
    const numLabel = isPur ? 'Purchase No.' : isRet ? 'Credit Note No.' : (isEst ? 'Quotation No.' : 'Invoice No.');
    const numText = isPur ? nextPurNumber() : isRet ? nextDocNumber('CN') : (isEst ? nextDocNumber('QT') : `${settings.invoicePrefix || 'INV'}-${invoiceCounter}`);
    const supplierOptions = [{ value: '', label: 'Select supplier' }, ...suppliers.map(sp => {
      const sb = supplierBalance(sp);
      return { value: sp.id, label: sp.name + (sp.phone ? ' · ' + sp.phone : '') + (sb.due > 0 ? ` · You owe ${settings.currency} ${money(sb.due)}` : '') };
    })];
    const from = docCtx.from;
    const isSaleDoc = !isPur && !isRet && !isEst;
    return `<div class="fade-in doc-form">
      <form id="invoiceForm" autocomplete="off">
        ${isSaleDoc ? `<div class="vs-switch"><span id="vsCredit" class="on">Credit</span><button type="button" class="vs-tg" id="vsTg" aria-label="Cash or credit"><i></i></button><span id="vsCash">Cash</span></div>` : ''}
        <div class="doc-card doc-head">
          <div><div class="doc-label">${numLabel}</div><div class="doc-num">${escapeHtml(numText)}</div>${isRet && ref ? `<div class="text-sm text-secondary">Against ${escapeHtml(ref.number)}</div>` : ''}${from ? `<div class="text-sm text-secondary">From ${escapeHtml(from.number)}</div>` : ''}</div>
          <div class="doc-date"><div class="doc-label">Date</div><input type="date" class="doc-date-input" name="docDate" value="${today}" max="${today}" /></div>
        </div>

        ${isPur ? `<div class="doc-card doc-head"><div class="doc-label" style="margin:0">Supplier bill no. (optional)</div><input type="text" class="doc-date-input" name="billNo" maxlength="20" style="max-width:150px;border-bottom:1px solid var(--border)" /></div>` : ''}
        ${isEst ? `<div class="doc-card doc-head"><div class="doc-label" style="margin:0">Valid until (optional)</div><input type="date" class="doc-date-input" name="validUntil" /></div>` : ''}
        <div class="doc-card">
          <div class="pm-f pm-sel"><span class="pm-fl">${isPur ? 'Supplier' : 'Customer'}</span>${isPur ? customSelect('customerId', supplierOptions, '', 'Select supplier', true) : customSelect('customerId', customerOptions, '', 'Walk-in Customer', true)}</div>
          <div class="pm-f"><span class="pm-fl">${isPur ? 'Or type supplier name' : 'Or type customer name'}</span><input type="text" name="customerName" id="customerNameInput" /></div>
          <div class="pm-f"><span class="pm-fl">Phone Number (optional)</span><input type="tel" inputmode="tel" name="customerPhone" id="customerPhoneInput" /></div>
          ${(!isPur && settings.enableBillingName) ? '<div class="pm-f"><span class="pm-fl">Billing name (printed on invoice)</span><input type="text" name="billingName" /></div>' : ''}
          ${(!isPur && !isRet && settings.enablePODetails) ? '<div class="pm-f"><span class="pm-fl">PO number</span><input type="text" name="poNo" /></div><div class="pm-f"><span class="pm-fl">PO date</span><input type="date" name="poDate" /></div>' : ''}
        </div>

        <div class="doc-card">
          <div class="doc-card-head">
            <span class="doc-label" style="margin:0">Items</span>
            <span class="doc-actions">
              <button type="button" class="chip-btn" data-action="scan-invoice-barcode">Scan</button>
              <button type="button" class="chip-btn chip-btn-primary" id="addItemsBtn">+ Add Items</button>
            </span>
          </div>
          <div id="docLines"></div>
        </div>

        <div class="doc-side">
        <div class="doc-card" id="docTotals" style="display:none">
          <div class="tot-row"><span>Subtotal</span><b id="tSub"></b></div>
          <div class="tot-row tot-input"${settings.enableTxnDiscount === false ? ' style="display:none"' : ''}>
            <span>Discount</span>
            <span class="tot-ctl">
              <span class="seg" id="discSeg"><button type="button" data-dt="amt" class="on">${escapeHtml(cur)}</button><button type="button" data-dt="pct">%</button></span>
              <input type="number" inputmode="decimal" min="0" step="any" id="discIn" placeholder="0" />
            </span>
          </div>
          <div class="tot-row tot-input"${settings.enableTxnTax === false ? ' style="display:none"' : ''}>
            <span>${settings.enableInclusiveTax ? 'Tax (included)' : 'Tax'}</span>
            <span class="tot-ctl"><span class="seg" id="taxSeg"><button type="button" data-tt="amt">${escapeHtml(cur)}</button><button type="button" data-tt="pct" class="on">%</button></span><input type="number" inputmode="decimal" min="0" step="any" id="taxIn" placeholder="0" value="${(isRet && ref && ref.meta && ref.meta.taxRate) ? ref.meta.taxRate : (from && from.meta && from.meta.taxRate != null ? (from.meta.taxRate || '') : (settings.taxRate ? settings.taxRate : ''))}" /></span>
          </div>
          <div class="tot-row tot-input">
            <span><input type="text" id="chLabel" class="tot-label-in" placeholder="Additional charges" maxlength="30" /></span>
            <span class="tot-ctl"><input type="number" inputmode="decimal" min="0" step="any" id="chIn" placeholder="0" /></span>
          </div>
          <label class="tot-row tot-check"><span>Round off</span><input type="checkbox" id="roundIn" /></label>
          <div class="tot-sep"></div>
          <div class="tot-row tot-grand"><span>Total</span><b id="tTotal"></b></div>
        </div>

        <div class="doc-card" id="docPay" style="display:none">
          <div class="doc-card-head">
            <span class="doc-label" style="margin:0">${isPur ? 'Paid to supplier' : isRet ? 'Refund paid to customer' : 'Payment received'}</span>
            <label class="paid-toggle"><input type="checkbox" id="paidFull" /> <span>${isPur ? 'Paid in full' : isRet ? 'Refunded in full' : 'Received in full'}</span></label>
          </div>
          <input type="number" inputmode="decimal" min="0" step="any" class="form-input" id="paidIn" placeholder="0" name="paidAmount" />
          <button type="button" class="ps-field mt-8" id="modeBtn"><span><small style="color:#6B7287;display:block;font-size:.72rem">Payment Type</small><b id="modeTxt">Cash</b></span><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button>
          <div class="tot-row mt-8"><span>${isPur ? 'Balance payable' : isRet ? 'Credit left with customer' : 'Balance due'}</span><b id="tDue"></b></div>
          ${isSaleDoc ? `<div class="tot-row" id="overRow" hidden style="color:#E11D48"><span>Extra paid – kept as customer credit</span><b id="tOver"></b></div>
          <div class="tot-row" id="creditRow" hidden><label class="tot-check" style="display:flex;justify-content:space-between;align-items:center;width:100%;margin:0"><span>Use customer credit <b id="creditAmt" style="color:#0E9F6E"></b></span><input type="checkbox" name="useCredit" id="useCredit" /></label></div>` : ''}
          ${isRet ? '' : `<div class="tot-row tot-input"><span>Due date</span><span class="tot-ctl"><input type="date" id="dueIn" name="dueDate" min="${today}" style="width:150px" /></span></div>
          <div class="chip-row"><button type="button" class="cat-chip" data-due="7">+7 days</button><button type="button" class="cat-chip" data-due="15">+15 days</button><button type="button" class="cat-chip" data-due="30">+30 days</button></div>`}
        </div>
        </div>

        ${isPur ? '' : `<div class="doc-card"><label class="tot-row tot-check" style="margin:0"><span>Print “Received by / Delivered by”</span><input type="checkbox" name="rb" ${settings.printReceivedBy !== false ? 'checked' : ''} onchange="var f=document.getElementById('rbFields');if(f)f.hidden=!this.checked" /></label>
          <div id="rbFields" ${settings.printReceivedBy !== false ? '' : 'hidden'} style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px">
            <div class="pm-f" style="margin:0;height:50px"><span class="pm-fl">Received by</span><input name="rbName" maxlength="40" placeholder="Name (optional)" autocomplete="off" /></div>
            <div class="pm-f" style="margin:0;height:50px"><span class="pm-fl">Delivered by</span><input name="dbName" maxlength="40" placeholder="Name (optional)" value="${escapeHtml(isStaff() ? staffName() : (settings.lastDeliveredBy || ''))}" autocomplete="off" /></div>
          </div></div>`}
        <div class="save-bar" id="saveBar">
          <div><div class="doc-label" style="margin:0">Total</div><div class="save-total" id="saveTotal">${escapeHtml(cur)} 0</div></div>
          ${isSaleDoc ? '<button type="submit" class="btn btn-outline vs-share" id="shareSaveBtn" data-share="1" disabled>Share</button>' : ''}
          <button type="submit" class="btn btn-primary" id="createInvoiceBtn" disabled>${isPur ? 'Save Purchase' : isRet ? 'Save Return' : (isEst ? 'Save Quotation' : 'Save')}</button>
        </div>
      </form>
    </div>`;
  }

  function bindCreateInvoice() {
    const cur = settings.currency;
    const isRet = docCtx.type === 'return';
    const isEst = docCtx.type === 'estimate';
    const isPur = docCtx.type === 'purchase';
    const isSaleDoc = !isPur && !isRet && !isEst;
    const ref = docCtx.ref || null;
    const from = docCtx.from || null;          // quotation being converted to an invoice
    const preLines = docCtx.posLines || null;
    docCtx = {};                              // consumed: next visit starts a normal invoice
    const lines = [];                         // { productId, name, price, cost, qty }
    const st = { discType: 'amt', taxType: 'pct', mode: 'Cash' };
    // most units of a product this document may contain
    const refQty = {};
    if (isRet && ref) {
      const done = returnedQty(ref.id);
      (ref.items || []).forEach(it => { refQty[it.productId] = (refQty[it.productId] || 0) + it.qty; });
      Object.keys(refQty).forEach(k => { refQty[k] = Math.max(0, refQty[k] - (done[k] || 0)); });
    }
    const capOf = p => (isEst || isPur) ? Infinity : (!isRet ? p.stock : (ref ? (refQty[p.id] || 0) : Infinity));
    window._docIsReturn = isRet;
    window._docLines = lines;
    window._docSaved = false;
    if (settings.enableRoundOff) { const _r = document.getElementById('roundIn'); if (_r) _r.checked = true; }

    const val = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    function opts() {
      return { discType: st.discType, discValue: val('discIn'), taxRate: val('taxIn'), taxType: st.taxType,
               charges: val('chIn'), roundOff: !!document.getElementById('roundIn')?.checked };
    }
    function recalc(fromPaid) {
      const c = calcDoc(lines, opts());
      const has = lines.length > 0;
      const q = id => document.getElementById(id);
      if (q('docTotals')) q('docTotals').style.display = has ? '' : 'none';
      if (q('docPay')) q('docPay').style.display = (has && !isEst) ? '' : 'none';
      if (q('tSub')) q('tSub').textContent = `${cur} ${money(c.sub)}`;
      if (q('tTotal')) q('tTotal').textContent = `${cur} ${money(c.total)}`;
      if (q('saveTotal')) q('saveTotal').textContent = `${cur} ${money(c.total)}`;
      if (q('createInvoiceBtn')) q('createInvoiceBtn').disabled = !has;
      if (q('shareSaveBtn')) q('shareSaveBtn').disabled = !has;
      if (q('paidFull') && q('paidFull').checked && q('paidIn')) q('paidIn').value = c.total || '';
      const rawPaid = Math.max(0, parseFloat(val('paidIn')) || 0);
      let creditUse = 0, over = 0;
      if (isSaleDoc) {
        const cid = (document.querySelector('[name="customerId"]') || {}).value;
        const avail = cid ? creditOfCustomer(customers.find(x => x.id === cid)) : 0;
        const cr = q('creditRow'), uc = q('useCredit');
        if (cr) { cr.hidden = !(avail > 0.001 && has); if (cr.hidden && uc) uc.checked = false; if (q('creditAmt')) q('creditAmt').textContent = `(${cur} ${money(avail)} available)`; }
        if (uc && uc.checked) creditUse = Math.min(avail, Math.max(0, round2(c.total - rawPaid)));
        over = Math.max(0, round2(rawPaid - c.total));
      }
      const paid = Math.min(rawPaid + creditUse, c.total);
      if (q('tDue')) { q('tDue').textContent = `${cur} ${money(Math.max(0, round2(c.total - paid)))}`; }
      if (q('overRow')) { const wi = !((document.querySelector('[name="customerId"]') || {}).value) && !((val('customerNameInput') || '').trim()); const sp = q('overRow').querySelector('span'); if (sp) sp.textContent = wi ? 'Change to give back' : 'Extra paid – kept as customer credit'; q('overRow').hidden = !(over > 0.001); if (q('tOver')) q('tOver').textContent = `${cur} ${money(over)}`; }
      return c;
    }
    function renderLines() {
      const box = document.getElementById('docLines');
      if (!box) return;
      if (!lines.length) {
        box.innerHTML = `<div class="doc-empty">No items yet. Tap <b>+ Add Items</b> to pick products.</div>`;
      } else {
        box.innerHTML = lines.map((l, i) => {
          const p = products.find(x => x.id === l.productId);
          const over = !isRet && !isEst && !isPur && p && l.qty > (p.stock || 0);
          const oos = !isRet && !isEst && !isPur && p && (p.stock || 0) <= 0;
          return `
          <div class="line-card" data-i="${i}">
            <div class="line-top"><span class="line-name">${escapeHtml(l.name)}${(oos || over) ? ' <span class="line-warn">' + (oos ? 'Out of stock' : 'Low stock') + '</span>' : ''}</span>
              <button type="button" class="line-x" data-del="${i}" aria-label="Remove">✕</button></div>
            <div class="line-grid">
              <div class="qty-control"><button type="button" class="qty-btn" data-q="-1" data-i="${i}">−</button><span class="qty-value">${l.qty}</span><button type="button" class="qty-btn" data-q="1" data-i="${i}">+</button></div>
              <div class="line-rate"><span>×</span><input type="number" inputmode="decimal" min="0" step="any" data-rate="${i}" value="${l.price}"${!can('discount') ? ' readonly' : ''} /></div>
              <div class="line-amt" id="la-${i}">${cur} ${money(l.price * l.qty)}</div>
            </div>
          </div>`;
        }).join('');
      }
      recalc();
    }
    function addProduct(id, n) {
      const p = products.find(x => x.id === id);
      if (!p) return false;
      let l = lines.find(x => x.productId === id);
      const next = (l ? l.qty : 0) + (n || 1);
      // Returns: hard cap to qty on original invoice
      if (isRet && next > capOf(p)) { toast('More than was sold on that invoice'); return false; }
      // Sales: allow oversell / zero stock with warning (still track negative stock)
      if (!isRet && !isEst && !isPur && next > (p.stock || 0)) {
        // allow, but flag
      }
      if (l) l.qty = next; else {
        let _price = isPur ? (p.cost || 0) : p.price;
        if (settings.enableLastSalePrice && !isPur && !isEst) {
          const cid = (document.querySelector('[name="customerId"]') || {}).value;
          if (cid) { const last = invoices.filter(i => i.customerId === cid && (i.docType || 'sale') === 'sale').sort((a, b) => new Date(b.date) - new Date(a.date)).map(i => (i.items || []).find(x => x.productId === p.id)).find(Boolean); if (last) _price = last.price; }
        }
        lines.push({ productId: p.id, name: p.name, price: _price, cost: p.cost || 0, qty: next });
      }
      if (!isRet && !isEst && !isPur && (p.stock || 0) < next) {
        toast((p.stock || 0) <= 0 ? (p.name + ' is out of stock') : (p.name + ' — only ' + p.stock + ' in stock'), 2500);
      }
      renderLines();
      return true;
    }
    window._docAdd = addProduct;
    window._docRender = renderLines;
    if (preLines && preLines.length) {
      preLines.forEach(l => {
        const existing = l.productId && lines.find(x => x.productId === l.productId);
        if (existing) existing.qty += l.qty;
        else lines.push({ productId: l.productId || null, name: l.name, price: l.price, cost: l.cost || 0, qty: l.qty, custom: l.custom || !l.productId || undefined });
      });
    }

    const linesBox = document.getElementById('docLines');
    linesBox.addEventListener('click', e => {
      const q = e.target.closest('[data-q]'), d = e.target.closest('[data-del]');
      if (q) {
        const l = lines[+q.dataset.i]; if (!l) return;
        const p = products.find(x => x.id === l.productId);
        const n = l.qty + (+q.dataset.q);
        if (n < 1) { lines.splice(+q.dataset.i, 1); }
        else if (isRet && p && n > capOf(p)) { toast('More than was sold on that invoice'); return; }
        else {
          l.qty = n;
          if (!isRet && !isEst && !isPur && p && n > (p.stock || 0)) {
            toast((p.stock || 0) <= 0 ? (p.name + ' is out of stock') : (p.name + ' — only ' + p.stock + ' in stock'), 2500);
          }
        }
        renderLines();
      } else if (d) { lines.splice(+d.dataset.del, 1); renderLines(); }
    });
    linesBox.addEventListener('input', e => {
      const r = e.target.closest('[data-rate]'); if (!r) return;
      const l = lines[+r.dataset.rate]; if (!l) return;
      l.price = Math.max(0, parseFloat(r.value) || 0);
      const a = document.getElementById('la-' + r.dataset.rate);
      if (a) a.textContent = `${cur} ${money(l.price * l.qty)}`;
      recalc();
    });

    { const cs = document.querySelector('[name="customerId"]'); if (cs) cs.addEventListener('change', () => recalc());
      const uc = document.getElementById('useCredit'); if (uc) uc.addEventListener('change', () => recalc()); }
    ['discIn', 'taxIn', 'chIn', 'roundIn', 'paidIn'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener(id === 'roundIn' ? 'change' : 'input', () => {
        if (id === 'paidIn') { const f = document.getElementById('paidFull'); if (f) f.checked = false; }
        recalc();
      });
    });
    if (settings.enableCashSaleDefault && !isRet && !isPur && !isEst) { const _pf = document.getElementById('paidFull'); if (_pf) _pf.checked = true; }
    document.getElementById('paidFull').addEventListener('change', () => {
      const f = document.getElementById('paidFull');
      if (!f.checked) document.getElementById('paidIn').value = '';
      recalc();
    });
    { const tg = document.getElementById('vsTg'); const pf = document.getElementById('paidFull');
      if (tg && pf) {
        const sync = () => { tg.classList.toggle('on', pf.checked); document.getElementById('vsCash').classList.toggle('on', pf.checked); document.getElementById('vsCredit').classList.toggle('on', !pf.checked); };
        tg.addEventListener('click', () => { pf.checked = !pf.checked; if (!pf.checked) document.getElementById('paidIn').value = ''; pf.dispatchEvent(new Event('change')); sync(); });
        pf.addEventListener('change', sync); sync();
      }
      const sb = document.getElementById('shareSaveBtn'); if (sb) sb.addEventListener('click', () => { window._shareAfterSave = true; });
      const cb = document.getElementById('createInvoiceBtn'); if (cb) cb.addEventListener('click', () => { window._shareAfterSave = false; }); }
    document.querySelectorAll('#discSeg button').forEach(b => b.addEventListener('click', () => {
      st.discType = b.dataset.dt;
      document.querySelectorAll('#discSeg button').forEach(x => x.classList.toggle('on', x === b));
      recalc();
    }));
    document.querySelectorAll('#taxSeg button').forEach(b => b.addEventListener('click', () => {
      st.taxType = b.dataset.tt;
      document.querySelectorAll('#taxSeg button').forEach(x => x.classList.toggle('on', x === b));
      recalc();
    }));
    document.querySelectorAll('[data-due]').forEach(b => b.addEventListener('click', () => {
      const d = new Date(); d.setDate(d.getDate() + (+b.dataset.due));
      const el = document.getElementById('dueIn'); if (el) el.value = d.toISOString().slice(0, 10);
    }));
    { const mb = document.getElementById('modeBtn'); if (mb) mb.addEventListener('click', () => pickSheet({ title: 'Payment Type', options: PAY_MODES, selected: st.mode, onPick: v => { st.mode = v; document.getElementById('modeTxt').textContent = v; } })); }

    if (!can('discount')) ['discIn', 'taxIn', 'chIn', 'chLabel', 'roundIn'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = true; });
    document.getElementById('addItemsBtn').addEventListener('click', () => openItemPicker(lines, addProduct, (isEst || isPur) ? (() => true) : isRet ? (ref ? (p => (refQty[p.id] || 0) > 0) : (() => true)) : null));
    // prefill from the invoice being returned
    if (isRet && ref) {
      (ref.items || []).forEach(it => {
        const left = refQty[it.productId] || 0;
        if (left > 0 && products.some(p => p.id === it.productId)) lines.push({ productId: it.productId, name: it.name, price: it.price, cost: it.cost || 0, qty: left });
      });
      const sel = document.querySelector('[name="customerId"]'); if (sel && ref.customerId) { sel.value = ref.customerId; }
      const nm = document.getElementById('customerNameInput'); if (nm && ref.customerName && ref.customerName !== 'Walk-in Customer') nm.value = ref.customerName;
      const ph = document.getElementById('customerPhoneInput'); if (ph) ph.value = ref.customerPhone || '';
      if (!lines.length) toast('Everything on that invoice was already returned');
    }
    // prefill from the quotation being converted
    if (from) {
      const m = from.meta || {};
      (from.items || []).forEach(it => {
        const p = products.find(x => x.id === it.productId);
        if (!p) return;
        const q = Math.min(it.qty, p.stock);
        if (q > 0) lines.push({ productId: it.productId, name: it.name, price: it.price, cost: p.cost || it.cost || 0, qty: q });
        if (q < it.qty) toast(`${it.name}: only ${p.stock} in stock`, 3500);
      });
      const sel = document.querySelector('[name="customerId"]'); if (sel && from.customerId) sel.value = from.customerId;
      const nm = document.getElementById('customerNameInput'); if (nm && from.customerName && from.customerName !== 'Walk-in Customer') nm.value = from.customerName;
      const ph = document.getElementById('customerPhoneInput'); if (ph) ph.value = from.customerPhone || '';
      if (m.discValue) { document.getElementById('discIn').value = m.discValue; st.discType = m.discType || 'amt';
        document.querySelectorAll('#discSeg button').forEach(x => x.classList.toggle('on', x.dataset.dt === st.discType)); }
      if (m.charges) { document.getElementById('chIn').value = m.charges; document.getElementById('chLabel').value = m.chargeLabel || ''; }
      if (m.roundOff) document.getElementById('roundIn').checked = true;
    }
    renderLines();

    let submitting = false;
    $('#invoiceForm').addEventListener('submit', async e => {
      e.preventDefault();
      if (submitting) return;
      if (!isPur && typeof enforceLimit === 'function' && !enforceLimit('invoices', invoices.length)) return;
      const fd = new FormData(e.target);

      // 1) Validate WITHOUT touching stock or counters
      if (!lines.length) { toast('Add at least one item'); return; }
      const short = [];
      if (!isRet && !isEst && !isPur) lines.forEach(l => {
        if (l.custom) return;
        const p = products.find(x => x.id === l.productId);
        if (!p || p.stock < l.qty) short.push(`${l.name} (stock ${p ? p.stock : 0}, selling ${l.qty})`);
      });
      if (short.length) {
        const ok = await askConfirm('Some items are out of stock or short:\n\n' + short.join('\n') + '\n\nSave invoice anyway? Stock will go negative.');
        if (!ok) return;
      }
      const o = opts();
      const c = calcDoc(lines, o);
      if (c.total <= 0 && lines.some(l => l.price > 0)) { toast('Discount cannot be more than the bill'); return; }
      const rawPaid = Math.max(parseFloat(fd.get('paidAmount')) || 0, 0);
      const credCust = isSaleDoc ? customers.find(x => x.id === fd.get('customerId')) : null;
      const creditUsed = (credCust && fd.has('useCredit')) ? Math.min(creditOfCustomer(credCust), Math.max(0, round2(c.total - rawPaid))) : 0;
      let paidAmount = isEst ? 0 : (isSaleDoc ? round2(rawPaid + creditUsed) : round2(Math.min(rawPaid, c.total)));
      const walkInSale = isSaleDoc && !fd.get('customerId') && !(fd.get('customerName') || '').trim();
      if (walkInSale && paidAmount > c.total + 0.001) {
        toast('Change to give back: ' + settings.currency + ' ' + money(round2(paidAmount - c.total)));
        paidAmount = c.total;
      }
      if (isSaleDoc && paidAmount > c.total + 0.001) {
        const ex = round2(paidAmount - c.total);
        if (!(await askConfirm(settings.currency + ' ' + money(ex) + ' is more than the bill total. Keep the extra as customer credit (you owe it back or adjust it on their next bill)?', { title: 'Extra payment' }))) return;
      }
      const paymentStatus = paidAmount >= c.total && c.total > 0 ? 'paid' : (paidAmount > 0 ? 'partial' : 'unpaid');

      if (isPur) {
        submitting = true;
        const nowP = new Date().toISOString();
        const pk = fd.get('docDate');
        const pDate = (pk && pk !== nowP.slice(0, 10)) ? new Date(pk + 'T12:00:00').toISOString() : nowP;
        const pnum = nextPurNumber();
        let sid = fd.get('customerId') || '', sname = (fd.get('customerName') || '').trim(), sphone = (fd.get('customerPhone') || '').trim();
        if (sid) { const sp = suppliers.find(x => x.id === sid); if (sp) { if (!sname) sname = sp.name; if (!sphone) sphone = sp.phone || ''; } }
        if (!sname) { submitting = false; toast('Choose or type the supplier'); return; }
        if (!sid) {
          let sp = suppliers.find(x => x.name.toLowerCase() === sname.toLowerCase());
          if (!sp) {
            if (typeof enforceLimit === 'function' && !enforceLimit('suppliers', suppliers.length)) { submitting = false; return; }
            sp = { id: uid(), name: sname, phone: sphone, notes: '' }; suppliers.push(sp);
          } else if (sphone && !sp.phone) sp.phone = sphone;
          sid = sp.id; sname = sp.name; sphone = sp.phone || sphone;
        }
        const pitems = lines.map(l => ({ productId: l.productId, name: l.name, price: l.price, qty: l.qty }));
        pitems.forEach(it => {
          const pr = products.find(x => x.id === it.productId);
          if (!pr) return;
          pr.stock += it.qty; if (it.price > 0) pr.cost = it.price;
          try { window.BillauraExt && BillauraExt.onStock && BillauraExt.onStock(pr, it.qty, 'purchase'); } catch (e) {}
          stockMovements.unshift({ id: uid(), productId: it.productId, productName: it.name, type: 'in', qty: it.qty, date: nowP, note: `Purchase ${pnum}` });
        });
        const pmeta = { subtotal: c.sub, discount: c.discount, discType: o.discType, discValue: Number(o.discValue) || 0,
          taxName: 'Tax', taxRate: c.taxRate, taxType: c.taxType, tax: c.tax, chargeLabel: (document.getElementById('chLabel')?.value || '').trim(), charges: c.charges,
          roundOff: c.roundOff, paymentMode: paidAmount > 0 ? st.mode : '' };
        const bn = (fd.get('billNo') || '').trim(); if (bn) pmeta.billNo = bn;
        const dd = fd.get('dueDate'); if (dd && paymentStatus !== 'paid') pmeta.dueDate = dd;
try { window.BillauraExt && BillauraExt.stamp && BillauraExt.stamp(pmeta); } catch (e) {}
        const pur = { id: uid(), number: pnum, supplierId: sid, supplierName: sname, supplierPhone: sphone, items: pitems, total: c.total, paymentStatus, paidAmount, meta: pmeta, date: pDate };
        purchases.unshift(pur);
        window._docSaved = true;
        persist();
        toast('Purchase saved. Stock added.');
        setView('purchases');
        openPurchaseDetail(pur);
        return;
      }

      // 2) Commit
      submitting = true;
      const nowIso = new Date().toISOString();
      const pick = fd.get('docDate');
      const dateIso = (pick && pick !== nowIso.slice(0, 10)) ? new Date(pick + 'T12:00:00').toISOString() : nowIso;
      const invNumber = isRet ? nextDocNumber('CN') : isEst ? nextDocNumber('QT') : `${(window.BillauraExt && BillauraExt.invPrefix && BillauraExt.invPrefix()) || settings.invoicePrefix || 'INV'}-${invoiceCounter++}`;
      const items = lines.map(l => ({ productId: l.productId, name: l.name, price: l.price, cost: l.cost, qty: l.qty, custom: l.custom ? true : undefined }));
      if (!isEst) items.forEach(it => {
        const p = products.find(x => x.id === it.productId);
        if (!p) return;
        p.stock += (isRet ? it.qty : -it.qty);
        try { window.BillauraExt && BillauraExt.onStock && BillauraExt.onStock(p, isRet ? it.qty : -it.qty, isRet ? 'return' : 'sale'); } catch (e) {}
        stockMovements.unshift({ id: uid(), productId: it.productId, productName: it.name, type: isRet ? 'in' : 'out', qty: it.qty, date: nowIso, note: `${isRet ? 'Return' : 'Invoice'} ${invNumber}` });
      });

      let customerId = fd.get('customerId') || '';
      let customerName = (fd.get('customerName') || '').trim();
      let customerPhone = (fd.get('customerPhone') || '').trim();
      if (customerId) {
        const cu = customers.find(x => x.id === customerId);
        if (cu) { if (!customerName) customerName = cu.name; if (!customerPhone) customerPhone = cu.phone || ''; }
      }
      if (!customerName) { customerName = 'Walk-in Customer'; customerId = ''; }
      if (customerName !== 'Walk-in Customer') {
        const cu = findOrCreateCustomer(customerName, customerPhone);
        if (cu) { customerId = cu.id; customerName = cu.name; if (!customerPhone) customerPhone = cu.phone || ''; }
      }

      const meta = {
        subtotal: c.sub, discount: c.discount, discType: o.discType, discValue: Number(o.discValue) || 0,
        taxName: 'Tax', taxRate: c.taxRate, taxType: c.taxType, tax: c.tax, inclTax: !!settings.enableInclusiveTax,
        chargeLabel: (document.getElementById('chLabel')?.value || '').trim(), charges: c.charges,
        roundOff: c.roundOff, paymentMode: paidAmount > 0 ? st.mode : ''
      };
      if (isRet && ref) { meta.refId = ref.id; meta.refNumber = ref.number; }
      if (isEst) { const vu = fd.get('validUntil'); if (vu) meta.validUntil = vu; }
      if (isStaff()) meta.by = staffName();
      try { window.BillauraExt && BillauraExt.stamp && BillauraExt.stamp(meta); } catch (e) {}
      if (!isPur) {
        meta.rb = fd.has('rb') ? 1 : 0;
        if (meta.rb) {
          const rn = String(fd.get('rbName') || '').trim(), dn = String(fd.get('dbName') || '').trim();
          if (rn) meta.rbName = rn; if (dn) meta.dbName = dn;
          if (dn && !isStaff() && settings.lastDeliveredBy !== dn) settings.lastDeliveredBy = dn;
        }
      }
      { const bn = (fd.get('billingName') || '').trim(); if (bn) meta.billingName = bn; const po = (fd.get('poNo') || '').trim(); if (po) meta.po = po; const pd = fd.get('poDate'); if (pd) meta.poDate = pd; }
      { const dd = fd.get('dueDate'); if (dd && !isRet && !isEst && paymentStatus !== 'paid') meta.dueDate = dd; }
      if (from) { meta.fromId = from.id; meta.fromNumber = from.number; }
      if (creditUsed > 0.001) meta.payments = [{ date: new Date().toISOString(), amount: creditUsed, mode: 'Credit', note: 'From customer credit' }];
      const inv = {
        id: uid(), number: invNumber, docType: isRet ? 'return' : (isEst ? 'estimate' : 'sale'),
        customerId: customerId || null, customerName, customerPhone,
        items, total: c.total, paymentStatus, paidAmount, meta, date: dateIso
      };
      if (settings.enableUpdateSalePrice && !isRet && !isEst) items.forEach(it => { const pr = products.find(x => x.id === it.productId); if (pr && Number(it.price) > 0 && pr.price !== it.price) { pr.price = it.price; pr.updatedAt = new Date().toISOString(); } });
      invoices.unshift(inv);
      if (creditUsed > 0.001 && credCust) consumeCredit(credCust, creditUsed, inv.number);
      window._docSaved = true;
      persist();
      if (isRet) { toast('Return saved. Stock added back.'); setView('invoices'); openInvoiceDetail(inv); return; }
      if (isEst) { toast('Quotation saved'); invFilter = 'estimate'; setView('invoices'); openInvoiceDetail(inv); return; }
      if (from) { const q = invoices.find(x => x.id === from.id); if (q) { q.meta = Object.assign({}, q.meta, { convertedTo: inv.number, convertedId: inv.id }); q.updatedAt = new Date().toISOString(); persist(); } }
      toast(paidAmount > c.total + 0.001 ? 'Invoice saved · extra kept as customer credit' : paymentStatus === 'paid' ? 'Invoice saved (Paid)' : paymentStatus === 'partial' ? 'Invoice saved (Advance recorded)' : 'Invoice saved (Unpaid)');
      setView('invoices');
      if (window._shareAfterSave) { window._shareAfterSave = false; openShareSheet(inv); }
      else if (settings.enableInvoicePreview !== false) openInvoiceDetail(inv);
    });
  }

  // Product picker sheet: search + tap to add (count badge shows what is already on the bill)
  function openItemPicker(lines, addProduct, allow) {
    const cur = settings.currency;
    function rows(q) {
      q = (q || '').trim().toLowerCase();
      const list = products.filter(p => !q || p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q));
      if (!list.length) return '<div class="doc-empty">No products found</div>';
      return list.map(p => {
        const n = (lines.find(l => l.productId === p.id) || {}).qty || 0;
        const blocked = allow ? !allow(p) : false; // return-only hard block
        const low = !blocked && (p.stock == null ? false : p.stock <= 0);
        const stockLabel = blocked ? 'Not on that invoice' : (low ? 'Out of stock' : ('Stock: ' + p.stock));
        return `<div class="pick-row${blocked ? ' out' : ''}${low ? ' low-stock' : ''}" data-pid="${p.id}" data-low="${low ? '1' : '0'}">
          <div class="pick-info">
            <div class="pick-name">${escapeHtml(p.name)}</div>
            <div class="pick-sub">${stockLabel}${p.barcode ? ' · ' + escapeHtml(p.barcode) : ''}</div>
          </div>
          <div class="pick-right">
            <div class="pick-price">${cur} ${money(p.price)}</div>
            ${low ? '<span class="pick-badge badge-out">Out</span>' : (n ? `<span class="pick-badge badge-ok">×${n}</span>` : '')}
            ${blocked ? '' : '<span class="pick-add">+</span>'}
          </div>
        </div>`;
      }).join('');
    }
    $('#modalRoot').innerHTML = `
      <div class="modal-overlay" id="pickOverlay">
        <div class="modal-sheet">
          <div class="modal-handle"></div>
          <div class="modal-header"><h3 class="modal-title">Add Items</h3>
            <button class="modal-close" data-action="close-modal"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
          <div class="search-wrap mb-8"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="search" class="search-input" id="pickSearch" placeholder="Search name or barcode" /></div>
          <div id="pickList" class="pick-list">${rows('')}</div>
          ${allow === null || allow === undefined ? `<div id="customBox"><button type="button" class="btn btn-outline btn-block mt-8" id="customToggle">+ Add custom item (not in catalogue)</button>
            <form id="customForm" style="display:none" class="mt-8">
              <input class="form-input mb-8" id="ciName" placeholder="Item / service name" maxlength="80" required />
              <div class="form-row"><input class="form-input" id="ciQty" type="number" inputmode="decimal" min="0" step="any" value="1" placeholder="Qty" />
              <input class="form-input" id="ciPrice" type="number" inputmode="decimal" min="0" step="any" placeholder="Price" required /></div>
              <button type="submit" class="btn btn-secondary btn-block mt-8">Add to bill</button></form></div>` : ''}
          <button type="button" class="btn btn-primary btn-block mt-12" data-action="close-modal">Done</button>
        </div>
      </div>`;
    const list = document.getElementById('pickList'), s = document.getElementById('pickSearch');
    s.addEventListener('input', () => { list.innerHTML = rows(s.value); });
    const cT = document.getElementById('customToggle'), cF = document.getElementById('customForm');
    if (cT && cF) {
      cT.addEventListener('click', () => { cF.style.display = cF.style.display === 'none' ? '' : 'none'; });
      cF.addEventListener('submit', e => {
        e.preventDefault();
        const name = document.getElementById('ciName').value.trim();
        const qty = parseFloat(document.getElementById('ciQty').value) || 1;
        const price = parseFloat(document.getElementById('ciPrice').value);
        if (!name || !(price >= 0)) { toast('Enter name and price'); return; }
        lines.push({ productId: null, custom: true, name, price, cost: 0, qty });
        if (window._docRender) window._docRender();
        toast('Added ' + name);
        cF.reset(); document.getElementById('ciQty').value = 1; cF.style.display = 'none';
      });
    }
    list.addEventListener('click', e => {
      const r = e.target.closest('[data-pid]'); if (!r || r.classList.contains('out')) return;
      const ok = addProduct(r.dataset.pid, 1);
      if (ok) {
        if (r.dataset.low === '1') toast('Added with warning: out of stock', 2500);
        list.innerHTML = rows(s.value);
      }
    });
  }

  function addProductByBarcode(code) {
    if (!code) return;
    const p = products.find(x => (x.barcode || '').toLowerCase() === code.toLowerCase());
    if (!p) { toast('Product not found for barcode'); return; }
    if (window._docAdd && document.getElementById('docLines')) {
      if (window._docAdd(p.id, 1)) {
        if ((p.stock || 0) <= 0) toast('+1 ' + p.name + ' (out of stock)');
        else toast('+1 ' + p.name);
      }
    } else toast('Open New Invoice first');
  }

  function viewCustomers() {
    if (customers.length === 0) {
      return emptyState('user', 'No customers yet', 'Save customer details for faster invoicing.', 'Add Customer', null, 'add-customer');
    }
    const sorted = [...customers].sort((a,b) => a.name.localeCompare(b.name));
    return `<div class="fade-in">
      <div class="search-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="search" class="search-input" id="customerSearch" placeholder="Search customers..." />
      </div>
      <div class="list" id="customerList">${sorted.map(c => {
        const bal = customerBalance(c.id, c.name, c.phone);
        const dueHtml = bal.due > 0
          ? `<span class="list-item-badge badge-out">Due ${settings.currency} ${money(bal.due)}</span>`
          : (bal.total > 0 ? `<span class="list-item-badge badge-ok">Clear</span>` : '');
        return `
        <div class="list-item" data-action="view-customer" data-id="${c.id}">
          <div class="list-item-icon">${initials(c.name)}</div>
          <div class="list-item-body">
            <div class="list-item-title">${escapeHtml(c.name)}</div>
            <div class="list-item-sub">${escapeHtml(c.phone || 'No phone')}</div>
            ${dueHtml}
          </div>
          <div class="list-item-right">
            <div class="list-item-price">${bal.total ? settings.currency + ' ' + money(bal.total) : '—'}</div>
          </div>
        </div>`;
      }).join('')}</div>
    </div>`;
  }

  function openCustomerDetail(cust) {
    const bal = customerBalance(cust.id, cust.name, cust.phone);
    const custInvoices = invoices.filter(inv =>
      invoiceBelongsToCustomer(inv, cust.id, cust.name, cust.phone)
    ).sort((a,b) => new Date(b.date) - new Date(a.date));

    $('#modalRoot').innerHTML = `
      <div class="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-handle"></div>
          <div class="modal-header">
            <h3 class="modal-title">${escapeHtml(cust.name)}</h3>
            <button class="modal-close" data-action="close-modal"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
          <div class="text-sm text-secondary mb-8">${escapeHtml(cust.phone || '')}${cust.address ? ' · ' + escapeHtml(cust.address) : ''}</div>
          <div class="stats-grid mb-16">
            <div class="stat-card"><div class="stat-label">Total Sales</div><div class="stat-value primary">${settings.currency} ${money(bal.total)}</div></div>
            <div class="stat-card"><div class="stat-label">${bal.credit > 0 ? 'Credit (we owe)' : 'Due'}</div><div class="stat-value ${bal.due > 0 ? 'danger' : 'success'}">${settings.currency} ${money(bal.credit > 0 ? bal.credit : bal.due)}</div></div>
          </div>
          <div class="section-header"><h2 class="section-title">Invoice history</h2></div>
          ${custInvoices.length === 0 ? '<div class="text-secondary text-sm">No invoices yet</div>' :
            `<div class="list">${custInvoices.map(inv => {
              const due = Math.max(0, (inv.total||0) - (inv.paidAmount||0));
              const st = due <= 0 ? 'Paid' : (inv.paidAmount > 0 ? 'Partial' : 'Unpaid');
              return `<div class="list-item" data-action="view-invoice" data-id="${inv.id}">
                <div class="list-item-body">
                  <div class="list-item-title">${inv.docType === 'return' ? 'Return ' : ''}${escapeHtml(inv.number)}</div>
                  <div class="list-item-sub">${formatDate(inv.date)} · ${st}</div>
                </div>
                <div class="list-item-right">
                  <div class="list-item-price"${inv.docType === 'return' ? ' style="color:var(--danger)"' : ''}>${inv.docType === 'return' ? '−' : ''}${settings.currency} ${money(inv.total)}</div>
                  ${due > 0 ? `<span class="list-item-badge badge-out">Due ${money(due)}</span>` : `<span class="list-item-badge badge-ok">Paid</span>`}
                </div>
              </div>`;
            }).join('')}</div>`}
          <div class="flex gap-8 mt-16" style="flex-wrap:wrap">
            ${bal.due > 0 ? `<button class="btn btn-primary" style="flex:1" data-action="receive-payment" data-id="${cust.id}">Receive</button>` : ''}
            <button class="btn btn-secondary" style="flex:1" data-action="open-statement" data-id="${cust.id}">Statement</button>
            ${bal.due > 0 ? `<button class="btn btn-secondary" style="flex:1" data-action="remind-customer" data-id="${cust.id}">Remind</button>` : ''}
          </div>
          <div class="flex gap-12 mt-12">
            <button class="btn btn-secondary btn-block" data-action="edit-customer" data-id="${cust.id}">Edit</button>
          </div>
        </div>
      </div>`;
  }


  // ---------- Suppliers ----------
  function viewSuppliers() {
    if (suppliers.length === 0) {
      return emptyState('truck', 'No suppliers yet', 'Track who you buy stock from.', 'Add Supplier', null, 'add-supplier');
    }
    const sorted = [...suppliers].sort((a,b) => a.name.localeCompare(b.name));
    return `<div class="fade-in"><div class="list">${sorted.map(s => `
      <div class="list-item" data-action="view-supplier" data-id="${s.id}">
        <div class="list-item-icon">${initials(s.name)}</div>
        <div class="list-item-body">
          <div class="list-item-title">${escapeHtml(s.name)}</div>
          <div class="list-item-sub">${escapeHtml(s.phone || 'No phone')}</div>
          ${(() => { const b = supplierBalance(s); return b.due > 0 ? `<span class="list-item-badge badge-out">You owe ${settings.currency} ${money(b.due)}</span>` : (b.total > 0 ? '<span class="list-item-badge badge-ok">Clear</span>' : ''); })()}
        </div>
      </div>`).join('')}</div></div>`;
  }

  // ---------- Reports ----------
  function viewReports() {
    const totals = netTotals();
    const revenue = totals.revenue || 0;
    const cogs = totals.cogs || 0;
    const receivable = totals.receivable || 0;
    const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const profit = revenue - cogs - totalExpenses;
    const cur = settings.currency || 'Rs';
    const isPro = window.HisablyFreemium && ['pro','trial'].includes(HisablyFreemium.effectivePlan().key);
    const crown = `<span class="premium-badge"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/></svg></span>`;

    const sold = {};
    invoices.forEach(inv => { const g = docSign(inv); if (g) (inv.items||[]).forEach(it => {
      sold[it.name] = (sold[it.name] || 0) + g * it.qty;
    }); });
    const top = Object.entries(sold).filter(e => e[1] > 0).sort((a,b) => b[1] - a[1]).slice(0, 5);

    return `<div class="fade-in">
      <div class="list-group">
        <div class="list-row" style="cursor:default;background:var(--primary-softer)">
          <div class="list-row-left"><div class="list-row-label">Total Sales</div></div>
          <div class="list-row-right font-semibold text-success">${cur} ${money(revenue)}</div>
        </div>
        <div class="list-row" style="cursor:default">
          <div class="list-row-left"><div class="list-row-label">Net Profit</div></div>
          <div class="list-row-right font-semibold ${profit>=0?'text-success':'text-danger'}">${cur} ${money(profit)}</div>
        </div>
        <div class="list-row" style="cursor:default">
          <div class="list-row-left"><div class="list-row-label">To Collect</div></div>
          <div class="list-row-right text-success">${cur} ${money(receivable)}</div>
        </div>
      </div>

      <div class="section-header">Transaction</div>
      <div class="list-group">
        <div class="list-row" data-action="report-sales"><div class="list-row-left"><div class="list-row-label">Sale Report</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
        <div class="list-row" data-view="purchases"><div class="list-row-left"><div class="list-row-label">Purchase Report</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
        <div class="list-row" data-view="daybook-detail"><div class="list-row-left"><div class="list-row-label">Day Book</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
        <div class="list-row" data-action="report-all-txn"><div class="list-row-left"><div class="list-row-label">All Transactions</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
        <div class="list-row" data-action="report-pl"><div class="list-row-left"><div class="list-row-label">Profit & Loss</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
        <div class="list-row" data-view="daybook-detail"><div class="list-row-left"><div class="list-row-label">Cashflow</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
        <div class="list-row" data-action="report-trial"><div class="list-row-left"><div class="list-row-label">Trial Balance</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
        <div class="list-row" data-action="report-balance-sheet"><div class="list-row-left"><div class="list-row-label">Balance Sheet</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
      </div>

      <div class="section-header">Party reports</div>
      <div class="list-group">
        <div class="list-row" data-view="customers"><div class="list-row-left"><div class="list-row-label">Party Statement</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
        <div class="list-row" data-action="report-party-pl"><div class="list-row-left"><div class="list-row-label">Party Wise Profit & Loss ${crown}</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
        <div class="list-row" data-view="customers"><div class="list-row-left"><div class="list-row-label">All Parties Report</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
      </div>

      <div class="section-header">Item / Stock reports</div>
      <div class="list-group">
        <div class="list-row" data-action="report-stock"><div class="list-row-left"><div class="list-row-label">Stock Summary Report</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
        <div class="list-row" data-action="report-low-stock"><div class="list-row-left"><div class="list-row-label">Low Stock Summary Report</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
        <div class="list-row" data-view="stock-history"><div class="list-row-left"><div class="list-row-label">Item Detail Report</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
        <div class="list-row" data-action="report-item-pl"><div class="list-row-left"><div class="list-row-label">Item Wise Profit & Loss</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
      </div>

      <div class="section-header">Expense reports</div>
      <div class="list-group">
        <div class="list-row" data-view="expenses"><div class="list-row-left"><div class="list-row-label">Expense Transaction Report</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
        <div class="list-row" data-view="expenses"><div class="list-row-left"><div class="list-row-label">Expense Category Report</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
      </div>

      <div class="section-header">Taxes</div>
      <div class="list-group">
        <div class="list-row" data-view="tax-settings"><div class="list-row-left"><div class="list-row-label">Tax Report / Rates</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
      </div>

      ${top.length ? `
      <div class="section-header">Top Selling Items</div>
      <div class="list-group">
        ${top.map(([name, qty], i) => `
          <div class="list-row" style="cursor:default">
            <div class="list-row-left"><div class="list-row-label">${i+1}. ${escapeHtml(name)}</div></div>
            <div class="list-row-right">${qty} sold</div>
          </div>`).join('')}
      </div>` : ''}
      <p class="text-sm text-secondary text-center" style="padding:16px">Net Profit = Sales − COGS − Expenses</p>
    </div>`;
  }


  function viewSaleReport() {
    invFilter = 'sale';
    return viewInvoices();
  }
  function viewProfitLoss() {
    const { revenue, cogs } = netTotals();
    const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const gross = revenue - cogs;
    const net = gross - totalExpenses;
    const cur = settings.currency || 'Rs';
    return `<div class="fade-in">
      <div class="list-group">
        <div class="list-row" style="cursor:default"><div class="list-row-left"><div class="list-row-label">Sales (Revenue)</div></div><div class="list-row-right text-success">${cur} ${money(revenue)}</div></div>
        <div class="list-row" style="cursor:default"><div class="list-row-left"><div class="list-row-label">Cost of Goods</div></div><div class="list-row-right text-danger">− ${cur} ${money(cogs)}</div></div>
        <div class="list-row" style="cursor:default"><div class="list-row-left"><div class="list-row-label">Gross Profit</div></div><div class="list-row-right font-semibold">${cur} ${money(gross)}</div></div>
        <div class="list-row" style="cursor:default"><div class="list-row-left"><div class="list-row-label">Expenses</div></div><div class="list-row-right text-danger">− ${cur} ${money(totalExpenses)}</div></div>
        <div class="list-row" style="cursor:default;background:var(--primary-softer)"><div class="list-row-left"><div class="list-row-label">Net Profit / Loss</div></div><div class="list-row-right font-semibold ${net>=0?'text-success':'text-danger'}">${cur} ${money(net)}</div></div>
      </div>
      <p class="text-sm text-secondary text-center" style="padding:16px">Set product cost prices for accurate COGS.</p>
    </div>`;
  }
  function viewTrialBalance() {
    const { revenue, cogs, receivable } = netTotals();
    const payable = totalGive();
    const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const cash = typeof cashInHandBalance === 'function' ? cashInHandBalance() : 0;
    const cur = settings.currency || 'Rs';
    const stockValue = products.reduce((s,p) => s + (Number(p.stock)||0) * (Number(p.cost)||Number(p.price)||0), 0);
    const rows = [
      ['Cash in hand', cash, 'debit'],
      ['Stock value', stockValue, 'debit'],
      ['Receivables (You will Get)', receivable, 'debit'],
      ['Payables (You will Give)', payable, 'credit'],
      ['Sales', revenue, 'credit'],
      ['COGS', cogs, 'debit'],
      ['Expenses', totalExpenses, 'debit'],
    ];
    return `<div class="fade-in">
      <div class="list-group">
        <div class="list-row" style="cursor:default;font-weight:600">
          <div class="list-row-left"><div class="list-row-label">Account</div></div>
          <div class="list-row-right">Debit / Credit</div>
        </div>
        ${rows.map(([name, amt, side]) => `
          <div class="list-row" style="cursor:default">
            <div class="list-row-left"><div class="list-row-label">${name}</div></div>
            <div class="list-row-right ${side==='debit'?'':'text-danger'}">${side==='debit'?'Dr':'Cr'} ${cur} ${money(Math.abs(amt||0))}</div>
          </div>`).join('')}
      </div>
    </div>`;
  }
  function viewStockSummary(lowOnly) {
    let list = [...products];
    if (lowOnly) list = list.filter(p => (Number(p.stock)||0) <= (Number(p.lowStock)||settings.lowStockDefault||5));
    list.sort((a,b) => (a.name||'').localeCompare(b.name||''));
    const cur = settings.currency || 'Rs';
    if (!list.length) return emptyState('box', lowOnly ? 'No low stock items' : 'No products', lowOnly ? 'All items are above the low-stock level.' : 'Add products to see stock summary.', 'Go to Items', 'products');
    return `<div class="fade-in">
      <div class="list-group">
        ${list.map(p => {
          const st = Number(p.stock)||0;
          const low = st <= (Number(p.lowStock)||settings.lowStockDefault||5);
          return `<div class="list-row" data-action="edit-product" data-id="${p.id}">
            <div class="list-row-left">
              <div class="list-row-label">${escapeHtml(p.name)}</div>
              <div class="list-row-sub">${cur} ${money(p.price)} · Cost ${money(p.cost||0)}</div>
            </div>
            <div class="list-row-right ${low?'text-danger font-semibold':''}">${st} ${escapeHtml(p.unit||'')}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }
  function viewPartyPL() {
    if (window.HisablyFreemium && !['pro','trial'].includes(HisablyFreemium.effectivePlan().key)) {
      return `<div class="fade-in"><div class="empty-state"><h3>Pro feature</h3><p>Party-wise Profit & Loss is available on Pro / Lifetime.</p><button class="btn btn-primary" data-action="open-plans">Upgrade</button></div></div>`;
    }
    const map = {};
    invoices.forEach(inv => {
      if (docSign(inv) <= 0) return;
      const name = inv.customerName || 'Walk-in';
      if (!map[name]) map[name] = { sales: 0, cost: 0 };
      map[name].sales += inv.total || 0;
      (inv.items||[]).forEach(it => {
        const prod = products.find(p => (p.id === it.productId || p.name === it.name));
        const cost = prod ? (Number(prod.cost)||0) : 0;
        map[name].cost += cost * (Number(it.qty)||0);
      });
    });
    const rows = Object.entries(map).map(([name, v]) => ({ name, sales: v.sales, profit: v.sales - v.cost })).sort((a,b) => b.profit - a.profit);
    const cur = settings.currency || 'Rs';
    if (!rows.length) return emptyState('user', 'No sales yet', 'Create invoices to see party-wise profit.', 'Create Sale', 'create-invoice');
    return `<div class="fade-in"><div class="list-group">${rows.map(r => `
      <div class="list-row" style="cursor:default">
        <div class="list-row-left">
          <div class="list-row-label">${escapeHtml(r.name)}</div>
          <div class="list-row-sub">Sales ${cur} ${money(r.sales)}</div>
        </div>
        <div class="list-row-right ${r.profit>=0?'text-success':'text-danger'} font-semibold">${cur} ${money(r.profit)}</div>
      </div>`).join('')}</div></div>`;
  }
  function viewItemPL() {
    const map = {};
    invoices.forEach(inv => {
      if (docSign(inv) <= 0) return;
      (inv.items||[]).forEach(it => {
        const name = it.name || 'Item';
        if (!map[name]) map[name] = { qty: 0, sales: 0, cost: 0 };
        map[name].qty += Number(it.qty)||0;
        map[name].sales += (Number(it.price)||0) * (Number(it.qty)||0);
        const prod = products.find(p => (p.id === it.productId || p.name === it.name));
        map[name].cost += (prod ? (Number(prod.cost)||0) : 0) * (Number(it.qty)||0);
      });
    });
    const rows = Object.entries(map).map(([name, v]) => ({ name, ...v, profit: v.sales - v.cost })).sort((a,b) => b.profit - a.profit);
    const cur = settings.currency || 'Rs';
    if (!rows.length) return emptyState('box', 'No sales yet', 'Sell items to see item-wise profit.', 'Go to Items', 'products');
    return `<div class="fade-in"><div class="list-group">${rows.map(r => `
      <div class="list-row" style="cursor:default">
        <div class="list-row-left">
          <div class="list-row-label">${escapeHtml(r.name)}</div>
          <div class="list-row-sub">${r.qty} sold · Sales ${cur} ${money(r.sales)}</div>
        </div>
        <div class="list-row-right ${r.profit>=0?'text-success':'text-danger'} font-semibold">${cur} ${money(r.profit)}</div>
      </div>`).join('')}</div></div>`;
  }

  function viewExpensesOld() {
    if (expenses.length === 0) {
      return emptyState('invoice', 'No expenses yet', 'Track rent, fuel, packaging, salaries and other costs.', 'Add Expense', null, 'add-expense');
    }
    const sorted = [...expenses].sort((a,b) => new Date(b.date) - new Date(a.date));
    return `<div class="fade-in">
      <div class="list">${sorted.map(e => `
        <div class="list-item" data-action="edit-expense" data-id="${e.id}">
          <div class="list-item-icon">${escapeHtml((e.category || 'E')[0])}</div>
          <div class="list-item-body">
            <div class="list-item-title">${escapeHtml(e.title || e.category || 'Expense')}</div>
            <div class="list-item-sub">${escapeHtml(e.category || 'Other')} · ${formatDate(e.date)}</div>
          </div>
          <div class="list-item-right">
            <div class="list-item-price" style="color:var(--danger)">${settings.currency} ${money(e.amount)}</div>
          </div>
        </div>`).join('')}
      </div>
    </div>`;
  }

  // ---------- More ----------
  function viewStockHistory() {
    if (stockMovements.length === 0) {
      return emptyState('box', 'No stock movements yet', 'Stock in and sales will appear here.', 'Go to Products', 'products');
    }
    const sorted = [...stockMovements].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 100);
    return `<div class="fade-in">
      <div class="list">${sorted.map(m => `
        <div class="list-item" style="cursor:default">
          <div class="list-item-icon" style="background:${m.type === 'in' ? '#D1FAE5' : '#FEE2E2'};color:${m.type === 'in' ? '#065F46' : '#991B1B'}">${m.type === 'in' ? '+' : '−'}</div>
          <div class="list-item-body">
            <div class="list-item-title">${escapeHtml(m.productName)}</div>
            <div class="list-item-sub">${formatDate(m.date)}${m.note ? ' · ' + escapeHtml(m.note) : ''}</div>
          </div>
          <div class="list-item-right">
            <div class="list-item-price" style="color:${m.type === 'in' ? 'var(--success)' : 'var(--danger)'}">${m.type === 'in' ? '+' : '−'}${m.qty}</div>
          </div>
        </div>`).join('')}
      </div>
    </div>`;
  }

  function lastSyncLabel() {
    const t = localStorage.getItem('billaura_last_sync');
    return t ? ' · Last sync ' + new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  }

  function viewMoreOld() {
    if (isStaff()) return staffMoreHTML();
    const biz = escapeHtml(settings.businessName || 'My Business');
    const phone = settings.phone ? escapeHtml(settings.phone) : '';
    const email = settings.email ? escapeHtml(settings.email) : '';
    const crown = `<span class="premium-badge"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/></svg></span>`;

    return `<div class="fade-in">
      <div class="profile-card" data-view="business-profile" style="cursor:pointer">
        <h2>${biz}</h2>
        <div class="profile-info">
          ${phone ? `<span>📞 ${phone}</span>` : ''}
          ${email ? `<span>✉️ ${email}</span>` : ''}
          ${settings.address ? `<span>📍 ${escapeHtml(settings.address)}</span>` : '<span style="opacity:0.7">Tap to complete profile</span>'}
        </div>
        <div class="profile-progress"><div class="profile-progress-bar" style="width:${profileCompleteness()}%"></div></div>
        <div style="font-size:0.75rem;margin-top:6px;opacity:0.85">Profile ${profileCompleteness()}% complete</div>
      </div>

      <div class="section-header">My Business</div>
      <div class="list-group">
        <div class="list-row" data-view="pos">
          <div class="list-row-left">
            <div class="list-row-icon" style="background:#FEE2E2;color:#E11D48"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/></svg></div>
            <div><div class="list-row-label">Quick Sale (POS)</div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-view="create-invoice">
          <div class="list-row-left">
            <div class="list-row-icon" style="background:#FEE2E2;color:#E11D48"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
            <div><div class="list-row-label">Sale</div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-action="new-purchase">
          <div class="list-row-left">
            <div class="list-row-icon" style="background:#FEF3C7;color:#D97706"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/></svg></div>
            <div><div class="list-row-label">Purchase</div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-view="expenses">
          <div class="list-row-left">
            <div class="list-row-icon" style="background:#EDE9FE;color:#7C3AED"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg></div>
            <div><div class="list-row-label">Expenses</div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-view="reports">
          <div class="list-row-left">
            <div class="list-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg></div>
            <div><div class="list-row-label">Reports</div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>

      <div class="section-header">Cash & Bank</div>
      <div class="list-group">
        <div class="list-row" data-view="daybook">
          <div class="list-row-left">
            <div class="list-row-icon" style="background:#D1FAE5;color:#059669"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 8v8"/><path d="M8 12h8"/></svg></div>
            <div><div class="list-row-label">Cash In-Hand</div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-view="purchases">
          <div class="list-row-left">
            <div class="list-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div>
            <div><div class="list-row-label">Bank Accounts</div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-view="loans">
          <div class="list-row-left">
            <div class="list-row-icon" style="background:#FEF3C7;color:#D97706"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
            <div><div class="list-row-label">Loan Accounts</div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>

      ${(() => { const low = typeof lowStockProducts==='function'?lowStockProducts():[]; if(!low.length) return '';
        return `<div class="section-header">Stock alerts</div>
        <div class="list-group" id="lowStockHome">
          ${low.slice(0,5).map(p => `<div class="list-row" data-view="products">
            <div class="list-row-left"><div class="list-row-label">${escapeHtml(p.name)}</div>
            <div class="list-row-sub text-danger">Only ${p.stock||0} left</div></div>
            <div class="list-row-right text-danger font-semibold">${p.stock||0}</div>
          </div>`).join('')}
          ${low.length>5?`<div class="list-row" data-action="report-low-stock"><div class="list-row-left"><div class="list-row-label">View all low stock (${low.length})</div></div></div>`:''}
        </div>`; })()}
      <div class="section-header">Parties & Items</div>
      <div class="list-group">
        <div class="list-row" data-view="customers">
          <div class="list-row-left">
            <div class="list-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
            <div><div class="list-row-label">Parties (Customers)</div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-view="suppliers">
          <div class="list-row-left">
            <div class="list-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg></div>
            <div><div class="list-row-label">Suppliers</div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-view="products">
          <div class="list-row-left">
            <div class="list-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg></div>
            <div><div class="list-row-label">Items</div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-view="stock-history">
          <div class="list-row-left">
            <div class="list-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
            <div><div class="list-row-label">Stock History</div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>

      <div class="section-header">Grow</div>
      <div class="list-group">
        <div class="list-row" data-view="multi-currency">
          <div class="list-row-left">
            <div class="list-row-icon" style="background:#FEF3C7;color:#D97706"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M8 10h8M8 14h8"/></svg></div>
            <div><div class="list-row-label">Multi-Currency</div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-view="reminders">
          <div class="list-row-left">
            <div class="list-row-icon" style="background:#DBEAFE;color:#2563EB"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div>
            <div><div class="list-row-label">Reminders</div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-view="online-store">
          <div class="list-row-left">
            <div class="list-row-icon" style="background:#EDE9FE;color:#7C3AED"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div>
            <div><div class="list-row-label">My Online Store</div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-action="open-shopify">
          <div class="list-row-left">
            <div class="list-row-icon" style="background:#D1FAE5;color:#059669"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h10"/></svg></div>
            <div><div class="list-row-label">Shopify Sync <span class="premium-badge"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/></svg></span></div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>

      <div class="section-header">Utilities</div>
      <div class="list-group">

        <div class="list-row" data-view="stock-adjust">
          <div class="list-row-left">
            <div class="list-row-icon" style="background:#FFEDD5;color:#C2410C"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18M5 12h14"/></svg></div>
            <div><div class="list-row-label">Stock Adjustment</div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-view="barcode-gen">
          <div class="list-row-left">
            <div class="list-row-icon" style="background:#F3E8FF;color:#7C3AED"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5v14M7 5v14M10 5v14M14 5v14M17 5v14M21 5v14"/></svg></div>
            <div><div class="list-row-label">Barcode Generator</div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-view="other-income">
          <div class="list-row-left">
            <div class="list-row-icon" style="background:#D1FAE5;color:#059669"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg></div>
            <div><div class="list-row-label">Other Income</div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-view="settings">
          <div class="list-row-left">
            <div class="list-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg></div>
            <div><div class="list-row-label">Settings</div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-action="export-backup">
          <div class="list-row-left">
            <div class="list-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div>
            <div><div class="list-row-label">Backup / Restore</div></div>
          </div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>

      <div style="text-align:center;padding:24px 16px;color:var(--text-muted);font-size:0.75rem">
        Billaura v2 · Smart Billing & Business
      </div>
    </div>`;
  }

  function emptyState(icon, title, sub, btnLabel, view, action) {
    const icons = {
      box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
      invoice: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
      user: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
      truck: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>'
    };
    const path = icons[icon] || icons.box;
    const btnAttr = view ? `data-view="${view}"` : (action ? `data-action="${action}"` : '');
    return `<div class="empty-state">
      <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${path}</svg>
      <h3>${title}</h3>
      <p>${sub}</p>
      ${btnLabel ? `<button class="btn btn-primary" ${btnAttr}>${btnLabel}</button>` : ''}
    </div>`;
  }

  function cashAdjustments() {
    return settings.cashAdjustments || [];
  }
  function cashInHandBalance() {
    let bal = 0;
    try {
      cashEntries().forEach(r => {
        if ((r.mode || 'Cash') === 'Cash') bal += (r.dir === 'in' ? 1 : -1) * (r.amount || 0);
      });
      cashAdjustments().forEach(a => { bal += (a.amount || 0); });
    } catch (_) {}
    return round2(bal);
  }

  const PROFILE_FIELDS = [['businessName', 'Business name'], ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address'], ['city', 'City / Pincode'], ['taxId', 'Tax ID'], ['ownerName', 'Owner name'], ['businessDesc', 'Description'], ['logo', 'Logo'], ['signature', 'Signature']];
  function profileFilled(k) {
    const v = settings[k];
    if (k === 'businessName') return !!v && !/^my (business|shop)$/i.test(String(v).trim());
    return !!(v && String(v).trim());
  }
  function profileCompleteness() {
    return Math.round(PROFILE_FIELDS.filter(f => profileFilled(f[0])).length / PROFILE_FIELDS.length * 100);
  }


  function planLabel() {
    try { const { key, cache } = HisablyFreemium.effectivePlan(); return cache.planId === 'lifetime' ? 'Lifetime' : (HisablyFreemium.LIMITS[key] || {}).label || key; } catch (e) { return 'Free'; }
  }
  function acctAvatar() {
    return settings.logo ? `<img src="${settings.logo}" alt="">` : escapeHtml(((settings.businessName || 'B').trim().charAt(0) || 'B').toUpperCase());
  }
  function viewAccount() {
    const s = HisablyFreemium.getSession() || {};
    const cloud = s.mode === 'cloud';
    const pct = profileCompleteness();
    const rowA = (label, attr, danger) => `<div class="list-row" ${attr}><div class="list-row-left"><div class="list-row-label" ${danger ? 'style="color:#E11D48"' : ''}>${label}</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>`;
    return `<div class="fade-in" style="padding:16px 0 28px">
      <div class="acct-hero"><div class="acct-av big">${acctAvatar()}</div>
        <div style="min-width:0"><div class="acct-name">${escapeHtml(s.fullName || settings.businessName || 'My Account')}</div>
        <div class="acct-sub">${escapeHtml(s.email || 'Not signed in')}</div>
        <span class="plan-pill">${escapeHtml(planLabel())} plan</span></div></div>
      <div class="doc-card" style="margin:12px 16px"><div style="font-weight:700">Profile ${pct}% complete</div><div class="prog" style="margin:8px 0"><div style="width:${pct}%"></div></div>
        ${pct < 100 ? `<div class="text-sm text-secondary">Missing: ${PROFILE_FIELDS.filter(f => !profileFilled(f[0])).map(f => f[1]).join(', ')}</div>` : '<div class="text-sm text-secondary">All set!</div>'}
        <button class="btn btn-outline btn-block" style="margin-top:10px" data-view="business-profile">Edit Business Profile &amp; Card</button></div>
      <div class="section-title">Account</div><div class="list-group">
        ${cloud ? rowA('Change password', 'data-action="change-password"') : ''}
        ${cloud ? rowA('Sign out', 'data-action="sign-out-user"') : `${rowA('Sign in', 'data-action="show-auth" data-tab="login"')}${rowA('Sign up (create free account)', 'data-action="show-auth" data-tab="register"')}`}
        ${rowA('Billaura Plans', 'data-action="open-plans"')}
        ${rowA('Shopify Sync', 'data-action="open-shopify"')}
        ${rowA('My Online Store', 'data-view="online-store"')}
      </div>
      <div class="section-title">Your data</div><div class="list-group">
        ${rowA('Download CSV (sales, items, parties…)', 'data-action="open-csv"')}
        ${rowA('Backup to phone (JSON)', 'data-action="export-data"')}
        ${rowA('Restore backup', 'data-action="import-data"')}
        ${rowA('Clear All Data', 'data-action="clear-data"', true)}
      </div>
    </div>`;
  }
  function csvDatasets() {
    const cur = settings.currency || '';
    const d = x => x ? new Date(x).toISOString().slice(0, 10) : '';
    return {
      sales: ['sales', ['Number', 'Type', 'Date', 'Customer', 'Phone', 'Items', 'Total', 'Paid', 'Balance', 'Payment mode'],
        () => invoices.map(i => [i.number, i.docType || 'sale', d(i.date), i.customerName, i.customerPhone || '', (i.items || []).map(x => x.name + ' x' + x.qty).join('; '), i.total, i.paidAmount || 0, Math.max(0, (i.total || 0) - (i.paidAmount || 0)), (i.meta && i.meta.paymentMode) || ''])],
      purchases: ['purchases', ['Number', 'Date', 'Supplier', 'Items', 'Total', 'Paid', 'Balance'],
        () => purchases.map(i => [i.number, d(i.date), i.supplierName, (i.items || []).map(x => x.name + ' x' + x.qty).join('; '), i.total, i.paidAmount || 0, Math.max(0, (i.total || 0) - (i.paidAmount || 0))])],
      items: ['items', CSV_COLUMNS, () => products.map(p => [p.name, p.category || '', p.price, p.cost || 0, p.stock, p.unit || 'pcs', p.lowStock ?? '', p.barcode || '', p.notes || ''])],
      parties: ['parties', ['Name', 'Phone', 'Address', 'Balance due'], () => customers.map(c => [c.name, c.phone || '', c.address || '', customerBalance(c.id, c.name, c.phone).due])],
      suppliers: ['suppliers', ['Name', 'Phone', 'You owe'], () => suppliers.map(c => [c.name, c.phone || '', (supplierBalance(c) || {}).due || 0])],
      expenses: ['expenses', ['Date', 'Category', 'Amount', 'Note'], () => expenses.map(e => [d(e.date), e.category || '', e.amount, e.note || ''])]
    };
  }
  function exportCSV(key) {
    const sets = csvDatasets();
    const keys = key === 'all' ? Object.keys(sets) : [key];
    keys.forEach((k, n) => {
      const [name, cols, fn] = sets[k];
      const rows = [cols.join(',')].concat(fn().map(r => r.map((v, i) => csvCell(v, typeof v === 'string')).join(',')));
      setTimeout(() => downloadText(`billaura-${name}-${new Date().toISOString().slice(0, 10)}.csv`, rows.join('\r\n')), n * 400);
    });
    toast(key === 'all' ? 'Downloading 6 CSV files…' : 'CSV downloaded');
  }
  function openCsvModal() {
    const b = (k, l, n) => `<button class="btn btn-secondary btn-block mt-8" data-action="csv-export" data-set="${k}">${l} <span class="text-secondary">(${n})</span></button>`;
    $('#modalRoot').innerHTML = modalShell('Download CSV', `<p class="text-sm text-secondary">Opens in Excel / Google Sheets.</p>
      ${b('sales', 'All sales &amp; documents', invoices.length)}${b('purchases', 'Purchases', purchases.length)}${b('items', 'Items', products.length)}${b('parties', 'Parties (customers)', customers.length)}${b('suppliers', 'Suppliers', suppliers.length)}${b('expenses', 'Expenses', expenses.length)}
      <button class="btn btn-primary btn-block mt-16" data-action="csv-export" data-set="all">Download everything</button>`);
  }
  async function clearAllData() {
    if (!(await askConfirm('Delete ALL data (items, parties, invoices, expenses, purchases, banks, loans…)? If you are signed in to cloud it is deleted there too. This cannot be undone.', { title: 'Clear all data', okText: 'Delete', danger: true }))) return;
    if (!(await askConfirm('Last check: a backup file will download first. Continue and delete everything?', { title: 'Are you sure?', okText: 'Delete everything', danger: true }))) return;
    try {
      const data = { products, invoices, customers, suppliers, expenses, stockMovements, purchases, banks, bankTxns, otherIncome, loans, settings, invoiceCounter, exportedAt: new Date().toISOString() };
      downloadText(`billaura-backup-before-clear-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json');
    } catch (e) {}
    products = []; invoices = []; customers = []; suppliers = []; expenses = []; stockMovements = []; purchases = [];
    banks = []; bankTxns = []; otherIncome = []; loans = [];
    invoiceCounter = 1001;
    persist();
    toast('All data cleared. A backup file was downloaded.', 4000);
    setView('home', { replace: true });
  }

  function viewSettings() {
    const crown = `<span class="premium-badge"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/></svg></span>`;
    return `<div class="fade-in">
      <div class="list-group">
        <div class="list-row" data-view="business-profile">
          <div class="list-row-left"><div class="list-row-label">Business Profile</div></div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-action="open-txn-settings">
          <div class="list-row-left"><div class="list-row-label">Transaction</div></div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-action="open-print-settings">
          <div class="list-row-left"><div class="list-row-label">Invoice Print</div></div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-action="open-tax-settings">
          <div class="list-row-left"><div class="list-row-label">Taxes</div></div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-action="open-item-settings">
          <div class="list-row-left"><div class="list-row-label">Item Settings ${crown}</div></div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-action="open-party-settings">
          <div class="list-row-left"><div class="list-row-label">Party Settings</div></div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-action="open-general-settings">
          <div class="list-row-left"><div class="list-row-label">General</div></div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-view="account">
          <div class="list-row-left"><div class="list-row-label">Account, Sign in / Sign out &amp; Data</div></div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-action="open-shopify">
          <div class="list-row-left"><div class="list-row-label">Shopify Sync ${crown}</div></div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>
    </div>`;
  }

  function viewBusinessProfile() {
    const T = window.BillauraTemplates;
    const pct = profileCompleteness();
    const tab = settings._bpTab || 'basic';
    const fld = (id, label, val, type) => `<div class="field ${val ? 'has-value' : ''}"><input type="${type || 'text'}" id="${id}" value="${escapeHtml(val || '')}" placeholder=" " /><label>${label}</label></div>`;
    const brand = (title, id, key, prev, up, empty) => `<div class="brand-card"><h4>${title}</h4><div class="brand-row"><div class="brand-preview" id="${prev}">${settings[key] ? `<img src="${settings[key]}" alt="">` : empty}</div>
      <div class="brand-actions"><input type="file" id="${id}" accept="image/*" hidden /><button type="button" class="btn btn-outline btn-sm" data-action="${up}">${settings[key] ? 'Change' : 'Upload'}</button>${settings[key] ? `<button type="button" class="btn btn-ghost btn-sm" data-action="remove-${key === 'paymentQr' ? 'qr' : key}">Remove</button>` : ''}</div></div></div>`;
    const cur = settings.businessCardTpl || 'classic';
    const cards = T ? `<div class="bc-strip">${T.CARD_TEMPLATES.map(c => `<div class="bc-item ${cur === c.id ? 'active' : ''}" data-action="set-card-tpl" data-value="${c.id}"><div class="bc-scale">${T.cardHTML(settings, c.id)}</div></div>`).join('')}</div>` : '';
    return `<div class="fade-in bp-page">
      <div class="bp-hero">${cards}
        <button class="bp-share" data-action="share-business-card"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z"/></svg> Share Card</button>
        <div class="bp-tip">💡 67% businessmen saw their business increase after sharing their visiting card</div></div>
      <div class="bp-body">
        <div style="font-weight:700">${pct === 100 ? 'Profile 100% complete.' : `Profile ${pct}% complete`}</div><div class="prog bp-prog" style="margin:8px 0 0"><div style="width:${pct}%;background:#0A6FE0"></div></div>
        <div class="bp-dash"></div>
        <div class="bp-tabs"><button class="bp-tab ${tab === 'basic' ? 'on' : ''}" data-action="bp-tab" data-tab="basic">Basic Details</button><button class="bp-tab ${tab === 'biz' ? 'on' : ''}" data-action="bp-tab" data-tab="biz">Business Details</button></div>
        <div class="bp-pane" id="bpBasic" ${tab === 'basic' ? '' : 'hidden'}>
          ${fld('bpName', 'Business Name', settings.businessName)}
          ${fld('bpPhone', 'Phone Number 1', settings.phone, 'tel')}
          ${fld('bpPhone2', 'Phone Number 2', settings.phone2, 'tel')}
          ${fld('bpEmail', 'Email ID', settings.email, 'email')}
          ${fld('bpAddress', 'Business Address', settings.address)}
          ${fld('bpCity', 'Pincode / City', settings.city)}
          ${fld('bpDesc', 'Business Description', settings.businessDesc)}
          <div style="font-weight:600;margin:14px 0 8px">Signature</div>
          <div class="sig-box" id="sigPreview">${settings.signature ? `<img src="${settings.signature}" alt="Signature">` : '<span>No signature</span>'}</div>
          <input type="file" id="sigFile" accept="image/*" hidden />
          <div class="sig-btns"><button type="button" class="pill-btn" data-action="draw-signature">${settings.signature ? 'Change' : 'Draw'}</button><button type="button" class="pill-btn" data-action="pick-signature">Upload</button><button type="button" class="pill-btn ${settings.signature ? '' : 'dis'}" data-action="remove-signature">Remove</button></div>
        </div>
        <div class="bp-pane" id="bpBiz" ${tab === 'biz' ? '' : 'hidden'}>
          ${fld('bpTax', 'Tax ID / NTN / GSTIN', settings.taxId)}
          ${fld('bpOwner', 'Owner Name', settings.ownerName)}
          <div class="form-group"><label class="form-label">Currency</label><select class="form-select" id="bpCurrency">${['PKR', 'INR', 'BDT', 'USD', 'AED', 'SAR', 'GBP', 'EUR'].map(c => `<option value="${c}" ${settings.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">Invoice Prefix</label><input class="form-input" id="bpPrefix" value="${escapeHtml(settings.invoicePrefix || 'INV')}" /></div>
          ${brand('Business Logo', 'logoFile', 'logo', 'logoPreview', 'pick-logo', 'No logo')}
          ${brand('Company Stamp / Seal', 'stampFile', 'stamp', 'stampPreview', 'pick-stamp', 'No stamp')}
          ${brand('Payment QR (optional)', 'qrFile', 'paymentQr', 'qrPreview', 'pick-qr', 'No QR')}
          <button class="btn btn-outline btn-block" style="margin-top:14px" data-action="open-theme">Invoice theme &amp; colours</button>
        </div>
      </div>
      <div class="bp-bar"><button class="bp-cancel" data-view="more">Cancel</button><button class="bp-save" data-action="save-business-profile">Save</button></div>
    </div>`;
  }

  // ---------- Toggle row helper ----------
  function toggleRow(label, key, opts = {}) {
    const on = !!settings[key];
    const info = opts.info ? ` <svg class="info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>` : '';
    const crown = opts.premium ? ` <span class="premium-badge"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/></svg></span>` : '';
    return `<div class="list-row" data-action="toggle-setting" data-key="${key}" style="cursor:pointer">
      <div class="list-row-left">
        <div class="list-row-label">${label}${info}${crown}</div>
      </div>
      <div class="list-row-right">
        <label class="toggle" onclick="event.stopPropagation()">
          <input type="checkbox" ${on ? 'checked' : ''} data-action="toggle-setting" data-key="${key}" />
          <span class="toggle-track"></span>
        </label>
      </div>
    </div>`;
  }

  function stepperRow(label, key, min = 0, max = 4) {
    const val = Number(settings[key]) || 0;
    return `<div class="list-row" style="cursor:default">
      <div class="list-row-left"><div class="list-row-label">${label}</div></div>
      <div class="list-row-right">
        <div class="stepper">
          <button type="button" data-action="step-setting" data-key="${key}" data-delta="-1">−</button>
          <span>${val}</span>
          <button type="button" data-action="step-setting" data-key="${key}" data-delta="1">+</button>
        </div>
      </div>
    </div>`;
  }

  function navRow(label, actionOrView, isView = false) {
    const attr = isView ? `data-view="${actionOrView}"` : `data-action="${actionOrView}"`;
    return `<div class="list-row" ${attr}>
      <div class="list-row-left"><div class="list-row-label">${label}</div></div>
      <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`;
  }

  function viewItemSettings() {
    return `<div class="fade-in">
      <div class="list-group">
        ${toggleRow('Enable Item', 'enableStock', { info: true })}
        <div class="list-row" style="cursor:default">
          <div class="list-row-left"><div class="list-row-label">Item Type</div></div>
          <div class="list-row-right text-secondary" style="font-size:0.875rem">Products and Services</div>
        </div>
        ${toggleRow('Barcode scanning for items', 'enableBarcode', { info: true })}
        ${toggleRow('Stock maintenance', 'enableStock', { info: true })}
        ${toggleRow('Item Units', 'enableItemUnits', { info: true })}
        ${toggleRow('Item Category', 'enableItemCategory', { info: true })}
        ${toggleRow('Wholesale Price', 'enableWholesale', { info: true, premium: true })}
        ${stepperRow('Quantity (Upto Decimal places)', 'qtyDecimals')}
        ${toggleRow('Item wise tax', 'enableItemTax', { info: true })}
        ${toggleRow('Item wise discount', 'enableItemDiscount', { info: true })}
        ${toggleRow('Update Sale Price from TXN', 'enableUpdateSalePrice', { info: true })}
        ${navRow('Additional Item Fields', 'open-item-fields')}
        ${navRow('Item Custom Fields', 'open-item-custom')}
        ${toggleRow('Description', 'enableItemDescription', { info: true })}
      </div>
    </div>`;
  }

  function viewPartySettings() {
    return `<div class="fade-in">
      <div class="list-group">
        ${toggleRow('TIN number', 'enablePartyTIN', { info: true })}
        ${toggleRow('Party Grouping', 'enablePartyGrouping', { info: true })}
        ${navRow('Party Additional Fields', 'open-party-fields')}
        ${toggleRow('Party Shipping Address', 'enablePartyShipping', { info: true })}
      </div>
    </div>`;
  }

  function viewTxnSettings() {
    return `<div class="fade-in">
      <div class="section-title">Transaction Header</div>
      <div class="list-group">
        ${toggleRow('Cash Sale by default', 'enableCashSaleDefault', { info: true })}
        ${toggleRow('Billing name of Parties', 'enableBillingName', { info: true })}
        ${toggleRow('PO Details (of customer)', 'enablePODetails', { info: true })}
        ${toggleRow('Show time on bills', 'enableTxnTime', { info: true })}
      </div>
      <div class="section-title">Items Table</div>
      <div class="list-group">
        ${toggleRow('Allow Inclusive/Exclusive tax on Rate', 'enableInclusiveTax', { info: true })}
        ${toggleRow('Display Purchase Price', 'enableDisplayPurchasePrice', { info: true })}
        ${toggleRow('Show Last 5 Sale Price of Items', 'enableLastSalePrice', { info: true })}
        ${toggleRow('Barcode scanning for items', 'enableBarcode', { info: true })}
      </div>
      <div class="section-title">Taxes, Discount & Total</div>
      <div class="list-group">
        ${toggleRow('Tax on the whole bill', 'enableTxnTax', { info: true })}
        ${toggleRow('Discount on the whole bill', 'enableTxnDiscount', { info: true })}
        ${toggleRow('Round Off Transaction amount', 'enableRoundOff', { info: true })}
      </div>
      <div class="section-title">More Transaction Features</div>
      <div class="list-group">
        ${toggleRow('Enable Invoice Preview', 'enableInvoicePreview', { info: true })}
        ${toggleRow('Terms & Conditions', 'enableTerms', { info: true })}
        ${navRow('Set Terms & Conditions', 'open-terms')}
        ${navRow('Due Dates and Payment terms', 'open-due-dates')}
        ${navRow('Additional Fields', 'open-txn-fields')}
      </div>
    </div>`;
  }


  function sampleInvoice() {
    return { id: 'sample', number: 'INV-0001', docType: 'sale', date: new Date().toISOString(), customerName: 'Sample Customer', customerPhone: '03001234567',
      items: [{ name: 'Sample Item A', qty: 2, price: 500 }, { name: 'Sample Item B', qty: 1, price: 1250 }], total: 2250, paidAmount: 1000, meta: {} };
  }
  function viewInvoiceTheme() {
    const T = window.BillauraTemplates; if (!T) return '<div class="doc-empty">Template module not loaded</div>';
    const cur = settings.invoiceTemplate || 'modern', col = settings.invoiceColor || T.COLORS[0];
    const inv = invoices[0] || sampleInvoice();
    const seg = (key, def, opts) => `<div class="seg">${opts.map(o => `<button class="seg-b ${(settings[key]||def)===o[0]?'active':''}" data-action="${o[2]}" data-value="${o[0]}">${o[1]}</button>`).join('')}</div>`;
    let prev = '';
    try { prev = T.docHTML(inv, tplCtx(), {}); } catch (e) { console.error(e); }
    const orient = T.optsFrom(settings, {}).template === 'landscape';
    return `<div class="fade-in">
      <div class="section-title">Invoice themes</div>
      <div class="tpl-strip">${T.INVOICE_TEMPLATES.map(t => `<button class="tpl-card ${cur===t.id?'active':''}" data-action="set-inv-template" data-value="${t.id}"><span class="tpl-mini tpl-${t.id}" style="--c:${col}"><i></i><i></i><i></i><i></i></span><span class="tpl-name">${t.name}</span>${cur===t.id?'<span class="tpl-tick">✓</span>':''}</button>`).join('')}</div>
      <div class="section-title">Theme colour</div>
      <div class="swatches">${T.COLORS.map(c => `<button class="sw ${col===c?'active':''}" style="background:${c}" data-action="set-inv-color" data-value="${c}" aria-label="${c}"></button>`).join('')}</div>
      <div class="section-title">Text size</div>
      <div style="padding:0 16px">${seg('printTextSize','medium',[['small','Small','set-print-text'],['medium','Medium','set-print-text'],['large','Large','set-print-text']])}</div>
      <div class="section-title">Page size</div>
      <div style="padding:0 16px">${seg('printPageSize','A4',[['A4','A4','set-page-size'],['A5','A5','set-page-size'],['Letter','Letter','set-page-size']])}</div>
      <div class="section-title">Orientation</div>
      <div style="padding:0 16px">${seg('printOrientation','portrait',[['portrait','Portrait','set-orient'],['landscape','Landscape','set-orient']])}</div>
      <div class="section-title">Preview</div>
      <div class="tpl-preview" style="height:${Math.round(1123*Math.min(1,(Math.min(window.innerWidth,520)-32)/794))}px"><iframe sandbox="allow-same-origin" scrolling="no" srcdoc="${escapeHtml(prev)}" style="width:794px;height:1123px;border:0;transform-origin:0 0;transform:scale(${Math.min(1, (Math.min(window.innerWidth,520)-32)/794).toFixed(3)});pointer-events:none"></iframe></div>
      <div style="padding:12px 16px 24px"><button class="btn btn-primary btn-block" data-action="preview-invoice-template">Print / Save as PDF preview</button></div>
    </div>`;
  }

  function viewPrintSettings() {
    const tab = settings._printTab || 'regular';
    const wordsFmt = settings.amountWordsFormat || 'indian';
    const paper = settings.thermalPageSize || '80';
    return `<div class="fade-in">
      <div class="tabs" style="position:static;margin:0 16px">
        <button class="tab ${tab==='regular'?'active':''}" data-action="print-tab" data-tab="regular">Regular</button>
        <button class="tab ${tab==='thermal'?'active':''}" data-action="print-tab" data-tab="thermal">Thermal</button>
      </div>
      ${tab === 'thermal' ? `
      <div class="section-title">Thermal printer</div>
      <div class="list-group">
        <div class="list-row" style="cursor:default">
          <div class="list-row-left"><div class="list-row-label">Page size</div></div>
          <div class="list-row-right text-secondary" style="font-size:0.875rem">${paper === '58' ? '2 inch (58mm)' : paper === '88' ? '3.5 inch (88mm)' : '3 inch (80mm)'}</div>
        </div>
        <div class="list-row" data-action="set-thermal-size" data-value="58"><div class="list-row-left"><div class="list-row-label">58 mm</div></div>${paper==='58'?'<span class="chip">Selected</span>':''}</div>
        <div class="list-row" data-action="set-thermal-size" data-value="80"><div class="list-row-left"><div class="list-row-label">80 mm</div></div>${paper==='80'?'<span class="chip">Selected</span>':''}</div>
        <div class="list-row" data-action="set-thermal-size" data-value="88"><div class="list-row-left"><div class="list-row-label">88 mm</div></div>${paper==='88'?'<span class="chip">Selected</span>':''}</div>
        ${stepperRow('Copies', 'printCopies')}
        ${toggleRow('Print logo on thermal', 'printLogo', { info: true })}
        ${toggleRow('Print phone', 'printPhone', { info: true })}
        ${toggleRow('Amount in words', 'printAmountInWords', { info: true })}
      </div>
      <div class="section-title">Footer</div>
      <div class="list-group">
        ${toggleRow('Terms & Conditions', 'printTerms', { info: true })}
        ${toggleRow('Print Signature Text', 'printSignature', { info: true })}
        ${toggleRow('Received / Delivered by', 'printReceivedBy', { info: true })}
      </div>
      ` : `
      <div class="section-title">Themes</div>
      <div class="list-group">
        <div class="list-row" data-action="open-theme">
          <div class="list-row-left"><div class="list-row-label">Change Theme and Colors</div></div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-action="cycle-print-text">
          <div class="list-row-left"><div class="list-row-label">Print text size</div></div>
          <div class="list-row-right text-secondary" style="font-size:0.875rem;text-transform:capitalize">${settings.printTextSize || 'medium'}</div>
        </div>
        <div class="list-row" data-action="cycle-page-size">
          <div class="list-row-left"><div class="list-row-label">Page size</div></div>
          <div class="list-row-right text-secondary" style="font-size:0.875rem">${settings.printPageSize || 'A4'}</div>
        </div>
      </div>
      <div class="section-title">Print Company Info / Header</div>
      <div class="list-group">
        ${toggleRow('Print Company Name', 'printCompanyName', { info: true })}
        ${toggleRow('Company logo', 'printLogo', { info: true })}
        ${toggleRow('Address', 'printAddress', { info: true })}
        ${toggleRow('Email', 'printEmail', { info: true })}
        ${toggleRow('Phone number', 'printPhone', { info: true })}
        ${toggleRow('TIN on Sale', 'printTIN', { info: true })}
      </div>
      <div class="section-title">Item Table</div>
      <div class="list-group">
        ${toggleRow('S.No', 'printSNo', { info: true })}
        ${toggleRow('Units of Measurement', 'printUOM', { info: true })}
        ${toggleRow('MRP', 'printMRP', { info: true })}
        ${toggleRow('Description', 'printItemDesc', { info: true })}
      </div>
      <div class="section-title">Totals & Taxes</div>
      <div class="list-group">
        ${toggleRow('Total Item Quantity', 'printTotalQty', { info: true })}
        ${toggleRow('Amount with Decimal', 'printDecimalAmt', { info: true })}
        ${toggleRow('Received amount', 'printReceivedAmount', { info: true })}
        ${toggleRow('Balance amount', 'printBalanceAmount', { info: true })}
        ${toggleRow('Tax details', 'printTaxDetails', { info: true })}
        ${toggleRow('Amount Grouping', 'printAmountGrouping', { info: true })}
        <div class="list-row" data-action="toggle-words-format">
          <div class="list-row-left"><div class="list-row-label">Amount in words format</div></div>
          <div class="list-row-right text-secondary" style="font-size:0.8125rem">${wordsFmt === 'indian' ? 'Indian' : 'International'}</div>
        </div>
        ${toggleRow('You Saved', 'printYouSaved', { info: true })}
      </div>
      <div class="section-title">Footer</div>
      <div class="list-group">
        ${toggleRow('Print description', 'printFooterDesc', { info: true })}
        ${toggleRow('Terms & Conditions', 'printTerms', { info: true })}
        ${toggleRow('Print Signature Text', 'printSignature', { info: true })}
        ${toggleRow('Received by / Delivered by', 'printReceivedBy', { info: true })}
        ${toggleRow('Payment mode', 'printPaymentMode', { info: true })}
        ${toggleRow('Print Page Numbers', 'printPageNumbers', { info: true })}
        <div class="list-row" data-action="toggle-brand"><div class="list-row-left"><div class="list-row-label">Show “Generated with Billaura” ${settings.hideBranding && brandingOn() === true ? '' : ''}<span class="premium-badge"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/></svg></span></div></div><div class="list-row-right text-secondary">${brandingOn() ? 'On' : 'Off'}</div></div>
      </div>
      `}
    </div>`;
  }

  function viewTaxSettings() {
    const tab = settings._taxTab || 'rates';
    const rates = settings.taxRates || [];
    const groups = settings.taxGroups || [];
    return `<div class="fade-in">
      <div class="tabs" style="position:static;margin:0 16px">
        <button class="tab ${tab==='rates'?'active':''}" data-action="tax-tab" data-tab="rates">TAX RATES</button>
        <button class="tab ${tab==='groups'?'active':''}" data-action="tax-tab" data-tab="groups">TAX GROUPS</button>
      </div>
      ${tab === 'groups' ? `
        ${groups.length === 0 ? `<div class="empty-state">
          <h3>No tax groups yet</h3>
          <p>Group multiple tax rates (e.g. CGST + SGST)</p>
          <button class="btn btn-primary" data-action="add-tax-group">+ Add Tax Group</button>
        </div>` : `<div class="list-group">${groups.map((g,i) => `
          <div class="list-row" style="cursor:default">
            <div class="list-row-left">
              <div class="list-row-label">${escapeHtml(g.name)}</div>
              <div class="list-row-sub">${(g.rates||[]).join(' + ') || g.rate + '%'}</div>
            </div>
            <button class="btn btn-ghost btn-sm" data-action="remove-tax-group" data-idx="${i}">Remove</button>
          </div>`).join('')}</div>
          <div style="padding:16px"><button class="btn btn-primary btn-block" data-action="add-tax-group">+ Add Tax Group</button></div>`}
      ` : `
        ${rates.length === 0 ? `<div class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          <h3>No tax rates yet</h3>
          <p>Add GST, VAT or custom tax rates for your invoices</p>
          <button class="btn btn-primary" data-action="add-tax-rate">+ Add Tax Rate</button>
        </div>` : `<div class="list-group">${rates.map((r,i) => `
          <div class="list-row" style="cursor:default">
            <div class="list-row-left">
              <div class="list-row-label">${escapeHtml(r.name)}</div>
              <div class="list-row-sub">${r.rate}%</div>
            </div>
            <button class="btn btn-ghost btn-sm" data-action="remove-tax-rate" data-idx="${i}">Remove</button>
          </div>`).join('')}</div>
          <div style="padding:16px"><button class="btn btn-primary btn-block" data-action="add-tax-rate">+ Add Tax Rate</button></div>`}
        <div class="list-group" style="margin-top:8px">
          <div class="list-row" style="cursor:default">
            <div class="list-row-left"><div class="list-row-label">Default Tax Rate</div></div>
            <div class="list-row-right font-semibold">${settings.taxRate || 0}%</div>
          </div>
          ${toggleRow('Tax on the whole bill', 'enableTxnTax', { info: true })}
          ${toggleRow('Item wise tax', 'enableItemTax', { info: true })}
        </div>
      `}
    </div>`;
  }

  function viewGeneralSettings() {
    return `<div class="fade-in">
      <div class="section-title">Application</div>
      <div class="list-group">
        <div class="list-row" style="cursor:default">
          <div class="list-row-left"><div class="list-row-label">App Language</div></div>
          <div class="list-row-right text-secondary">English</div>
        </div>
        <div class="list-row" style="cursor:default">
          <div class="list-row-left"><div class="list-row-label">Business Currency</div></div>
          <div class="list-row-right text-secondary">${settings.currency || 'Rs'}</div>
        </div>
        ${stepperRow('Decimal Places', 'decimalPlaces')}
        <div class="list-row" style="cursor:default">
          <div class="list-row-left"><div class="list-row-label">Date Format</div></div>
          <div class="list-row-right text-secondary">${settings.dateFormat || 'dd/MM/yyyy'}</div>
        </div>
        ${toggleRow('Show warning for unsaved changes', 'warnUnsaved')}
      </div>
      <div class="section-title">Security</div>
      <div class="list-group">
        ${navRow('App Lock &amp; Staff PIN', 'app-lock', true)}
      </div>
      <div class="section-title">More Transactions</div>
      <div class="list-group">
        ${toggleRow('Estimate / Quotation', 'enableEstimate', { info: true })}
        ${toggleRow('Delivery Note', 'enableDeliveryNote', { info: true })}
        ${toggleRow('Goods Return on Delivery Note', 'enableGoodsReturn', { info: true })}
      </div>
      <div class="section-title">Backup</div>
      <div class="list-group">
        ${navRow('Backup Settings', 'export-backup')}
      </div>
    </div>`;
  }


  function viewMultiCurrency() {
    const base = settings.baseCurrency || settings.currency || 'PKR';
    const list = settings.currencies || [];
    const all = ['PKR','INR','BDT','USD','AED','SAR','GBP','EUR','CNY'];
    return `<div class="fade-in">
      <div style="margin:16px;background:#FEF3C7;border-radius:12px;padding:14px;font-size:0.875rem;color:#92400E">
        ✨ Billaura supports Multi-Currency — manage bills & transactions in any currency you need.
      </div>
      <div class="list-group">
        <div class="list-row" style="cursor:default">
          <div class="list-row-left"><div class="list-row-label">Base Currency</div></div>
          <div class="list-row-right font-semibold">${base}</div>
        </div>
      </div>
      ${list.length === 0 ? `
        <div class="empty-state">
          <div style="font-size:3rem;margin-bottom:8px">✈️</div>
          <h3>No Currencies to show</h3>
          <p>Add your Base currency to start adding more currencies.</p>
          <button class="btn btn-primary" data-action="set-base-currency">+ Add Base Currency</button>
        </div>` : `
        <div class="section-title">Other Currencies</div>
        <div class="list-group">
          ${list.map(c => `
            <div class="list-row" style="cursor:default">
              <div class="list-row-left"><div class="list-row-label">${c.code}</div>
                <div class="list-row-sub">1 ${base} = ${c.rate} ${c.code}</div>
              </div>
              <button class="btn btn-ghost btn-sm" data-action="remove-currency" data-code="${c.code}">Remove</button>
            </div>`).join('')}
        </div>
        <div style="padding:16px">
          <button class="btn btn-primary btn-block" data-action="add-currency">+ Add Currency</button>
        </div>`}
      <div class="section-title">Quick set base</div>
      <div class="list-group">
        ${all.map(c => `
          <div class="list-row" data-action="pick-base-currency" data-code="${c}">
            <div class="list-row-left"><div class="list-row-label">${c}</div></div>
            ${base === c ? '<span class="chip">Base</span>' : '<svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>'}
          </div>`).join('')}
      </div>
    </div>`;
  }


  // ---------- Payment reminders + service reminders ----------

  // ---------- Daily summary, low-stock alert, reminder queue ----------
  function lowStockItems() { return products.filter(p => (Number(p.stock) || 0) <= (Number(p.lowStock) || settings.lowStockDefault || 5)); }
  function dailySummary(dayIso) {
    const day = dayIso || new Date().toISOString().slice(0, 10);
    const same = d => { const x = new Date(d); return !isNaN(x) && (x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0')) === day; };
    const docs = invoices.filter(i => same(i.date));
    const sales = docs.filter(i => (i.docType || 'sale') === 'sale');
    const returns = docs.filter(i => i.docType === 'return');
    const sum = (arr, f) => round2(arr.reduce((a, x) => a + (Number(f(x)) || 0), 0));
    const saleTotal = sum(sales, i => i.total), retTotal = sum(returns, i => i.total);
    const received = sum(sales, i => i.paidAmount);
    const exp = sum(expenses.filter(e => same(e.date)), e => e.amount);
    const buys = sum(purchases.filter(p => same(p.date)), p => p.total);
    const byItem = {};
    sales.forEach(i => (i.items || []).forEach(it => { byItem[it.name] = (byItem[it.name] || 0) + (it.price || 0) * (it.qty || 0); }));
    const top = Object.entries(byItem).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return { day, count: sales.length, saleTotal, retTotal, received, credit: round2(saleTotal - received), exp, buys, top, low: lowStockItems().length };
  }
  function dailySummaryText() {
    const d = dailySummary(), c = settings.currency || 'Rs';
    let t = `📊 *${settings.businessName || 'Billaura'}* – Daily summary\n${formatDate(d.day)}\n\n`;
    t += `🧾 Sales: *${c} ${money(d.saleTotal)}* (${d.count} bill${d.count === 1 ? '' : 's'})\n`;
    t += `💵 Received: ${c} ${money(d.received)}\n`;
    t += `⏳ On credit: ${c} ${money(d.credit)}\n`;
    if (d.retTotal) t += `↩️ Returns: ${c} ${money(d.retTotal)}\n`;
    t += `💸 Expenses: ${c} ${money(d.exp)}\n`;
    if (d.buys) t += `🛒 Purchases: ${c} ${money(d.buys)}\n`;
    if (d.top.length) t += `\n🏆 Top items:\n` + d.top.map((x, i) => `${i + 1}. ${x[0]} – ${c} ${money(x[1])}`).join('\n') + '\n';
    const recv = customers.reduce((a, x) => a + customerBalance(x.id, x.name, x.phone).due, 0);
    if (recv > 0) t += `\n📥 Total to collect: ${c} ${money(recv)}\n`;
    if (d.low) t += `⚠️ ${d.low} item(s) low on stock\n`;
    t += `\nGenerated with Billaura`;
    return t;
  }
  function sendDailySummary() {
    const num = settings.ownerWhatsapp || settings.storeWhatsapp || settings.phone || '';
    settings.summarySentOn = new Date().toISOString().slice(0, 10); persist();
    if (num) sendWhatsApp(num, dailySummaryText()); else window.open('https://wa.me/?text=' + encodeURIComponent(dailySummaryText()), '_blank');
  }
  function homeAlerts() {
    let h = '';
    const today = new Date().toISOString().slice(0, 10);
    const low = lowStockItems();
    try { if (window.BillauraExt && BillauraExt.homeAlerts) h += BillauraExt.homeAlerts(); } catch (e) {}
    if (low.length && settings.lowDismissed !== today) {
      const out = low.filter(p => (Number(p.stock) || 0) <= 0).length;
      h += `<div class="home-alert warn"><div class="ha-t"><b>${low.length} item${low.length === 1 ? '' : 's'} low on stock</b><span>${out ? out + ' out of stock · ' : ''}${escapeHtml(low.slice(0, 2).map(p => p.name).join(', '))}${low.length > 2 ? '…' : ''}</span></div><button data-view="low-stock">View</button><button class="x" data-action="dismiss-low" aria-label="Dismiss">✕</button></div>`;
    }
    if (can('reports') && !isStaff() && new Date().getHours() >= 19 && settings.summarySentOn !== today && settings.summaryPrompt !== false && invoices.some(i => new Date(i.date).toISOString().slice(0, 10) === today)) {
      h += `<div class="home-alert info"><div class="ha-t"><b>Today's summary is ready</b><span>Send your sales report on WhatsApp</span></div><button data-action="send-daily-summary">Send</button><button class="x" data-action="dismiss-summary" aria-label="Dismiss">✕</button></div>`;
    }
    return h;
  }
  let _remQueue = [];
  function openRemindQueue() {
    const rows = customers.map(c => ({ c, due: customerBalance(c.id, c.name, c.phone).due })).filter(x => x.due > 0.001 && x.c.phone).sort((a, b) => b.due - a.due);
    const today = new Date().toISOString().slice(0, 10);
    _remQueue = rows.filter(x => (settings.remindedOn || {})[x.c.id] !== today).map(x => x.c.id);
    window._rqTotal = _remQueue.length;
    drawRemindQueue(_remQueue.length);
  }
  function drawRemindQueue(total) {
    const cur = settings.currency || 'Rs';
    const c = customers.find(x => x.id === _remQueue[0]);
    const done = (total || 0) - _remQueue.length;
    $('#modalRoot').innerHTML = modalShell('Send reminders', c ? `<div style="text-align:center;padding:6px 0 14px"><div class="text-sm text-secondary">${done} of ${total} done</div>
      <div class="rq-bar"><i style="width:${total ? Math.round(done / total * 100) : 0}%"></i></div>
      <div style="font-size:1.2rem;font-weight:800;margin-top:14px">${escapeHtml(c.name)}</div>
      <div style="color:#E11D48;font-weight:700;margin:4px 0 14px">Due ${cur} ${money(customerBalance(c.id, c.name, c.phone).due)}</div>
      <button class="btn btn-primary btn-block btn-lg" data-action="rq-send" data-id="${c.id}">Send on WhatsApp</button>
      <button class="btn btn-ghost btn-block mt-8" data-action="rq-skip">Skip</button></div>`
      : `<div style="text-align:center;padding:18px 0"><div style="font-size:2.2rem">✅</div><div style="font-weight:800;margin-top:6px">All reminders sent</div><p class="text-sm text-secondary mt-8">${total ? 'Everyone with a pending balance and a phone number has been reminded today.' : 'No customers with a pending balance and a phone number.'}</p><button class="btn btn-primary btn-block mt-12" data-action="close-modal">Done</button></div>`);
  }

  function viewPaymentReminders() {
    const cur = settings.currency || 'Rs';
    const rows = customers.map(c => ({ c, due: customerBalance(c.id, c.name, c.phone).due })).filter(x => x.due > 0.001).sort((a, b) => b.due - a.due);
    const total = rows.reduce((a, x) => a + x.due, 0);
    const overdueDoc = c => custDocs(c).filter(i => docSign(i) > 0 && (i.total || 0) - (i.paidAmount || 0) > 0.001 && i.meta && i.meta.dueDate && new Date(i.meta.dueDate) < new Date()).length;
    return `<div class="fade-in" style="padding:14px 0 24px">
      <div class="doc-card" style="margin:0 16px 12px"><div class="text-sm text-secondary">Total to collect from ${rows.length} part${rows.length === 1 ? 'y' : 'ies'}</div><div style="font-size:1.5rem;font-weight:800;color:#0E9F6E">${cur} ${money(total)}</div></div>
      ${rows.some(x => x.c.phone) ? `<div style="padding:0 16px 12px"><button class="btn btn-primary btn-block" data-action="remind-all">Send reminders to all (${rows.filter(x => x.c.phone).length})</button></div>` : ''}
      ${rows.length ? `<div class="list-group">${rows.map(({ c, due }) => { const od = overdueDoc(c); const rem = (settings.remindedOn || {})[c.id]; return `<div class="list-row" style="cursor:default"><div class="list-row-left" style="min-width:0"><div><div class="list-row-label">${escapeHtml(c.name)}</div><div class="text-sm" style="color:#0E9F6E">To collect ${cur} ${money(due)}${od ? ` <span style="color:#E11D48">· ${od} overdue</span>` : ''}${rem ? ` <span style="color:#6B7287">· reminded ${formatDate(rem)}</span>` : ''}</div>${c.phone ? '' : '<div class="text-sm text-secondary">No phone number</div>'}</div></div>
          <div class="list-row-right" style="display:flex;gap:6px"><button class="chip-btn" data-action="open-statement" data-id="${c.id}">Statement</button><button class="chip-btn" data-action="remind-sms" data-id="${c.id}">SMS</button><button class="btn btn-primary btn-sm" data-action="remind-customer" data-id="${c.id}">WhatsApp</button></div></div>`; }).join('')}</div>`
        : '<div class="empty-state"><p>No pending balances — great job!</p></div>'}
    </div>`;
  }
  function srList() { return (settings.serviceReminders = settings.serviceReminders || []); }
  function viewServiceReminders() {
    const today = new Date().toISOString().slice(0, 10);
    const list = srList().slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    return `<div class="fade-in" style="padding:14px 0 90px">
      <p class="text-sm text-secondary" style="padding:0 16px 10px">Set a date to remind a customer about a service, refill, renewal or follow-up. Due reminders appear in red.</p>
      ${list.length ? `<div class="list-group">${list.map(r => { const due = r.date && r.date <= today && !r.done; return `<div class="list-row" style="cursor:default"><div class="list-row-left" style="min-width:0"><div><div class="list-row-label" ${r.done ? 'style="text-decoration:line-through;opacity:.6"' : ''}>${escapeHtml(r.name || 'Customer')}</div>
        <div class="text-sm" style="color:${due ? '#E11D48' : '#6B7287'}">${escapeHtml(r.note || 'Service')} · ${r.date ? formatDate(r.date) : 'no date'}${due ? ' · due' : ''}</div></div></div>
        <div class="list-row-right" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${r.phone && !r.done ? `<button class="chip-btn" data-action="sr-remind" data-id="${r.id}">WhatsApp</button>` : ''}<button class="chip-btn" data-action="sr-done" data-id="${r.id}">${r.done ? 'Undo' : 'Done'}</button><button class="chip-btn" data-action="sr-edit" data-id="${r.id}">Edit</button><button class="chip-btn" style="color:#E11D48" data-action="sr-del" data-id="${r.id}">Delete</button></div></div>`; }).join('')}</div>` : '<div class="empty-state"><p>No service reminders yet.</p></div>'}
      <div style="position:fixed;left:0;right:0;bottom:calc(var(--nav-height) + var(--safe-bottom) + 14px);max-width:480px;margin:0 auto;padding:0 16px;z-index:60"><button class="btn btn-primary btn-lg btn-block" data-action="sr-edit">+ Add Service Reminder</button></div>
    </div>`;
  }
  function openSrModal(id) {
    const r = srList().find(x => x.id === id) || { id: '', name: '', phone: '', date: '', note: '' };
    $('#modalRoot').innerHTML = modalShell(r.id ? 'Edit Reminder' : 'New Service Reminder', `
      <div class="form-group"><label class="form-label">Customer</label><input class="form-input" id="srName" list="srCust" value="${escapeHtml(r.name)}" placeholder="Name" /><datalist id="srCust">${customers.map(c => `<option value="${escapeHtml(c.name)}"></option>`).join('')}</datalist></div>
      <div class="form-group"><label class="form-label">Phone (WhatsApp)</label><input class="form-input" id="srPhone" type="tel" value="${escapeHtml(r.phone)}" placeholder="03xx xxxxxxx" /></div>
      <div class="form-group"><label class="form-label">Remind on</label><input class="form-input" id="srDate" type="date" value="${escapeHtml(r.date)}" /></div>
      <div class="form-group"><label class="form-label">What for</label><input class="form-input" id="srNote" value="${escapeHtml(r.note)}" placeholder="e.g. Machine service, refill, renewal" /></div>
      <button class="btn btn-primary btn-block" data-action="sr-save" data-id="${r.id}">Save</button>`);
    const n = document.getElementById('srName'); if (n) n.addEventListener('change', () => { const c = customers.find(x => x.name === n.value); if (c && c.phone && !document.getElementById('srPhone').value) document.getElementById('srPhone').value = c.phone; });
  }

  function viewReminders() {
    return `<div class="fade-in">
      <div class="list-group">
        <div class="list-row" data-action="open-payment-reminders">
          <div class="list-row-left"><div class="list-row-label">Payment Reminders</div></div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="list-row" data-action="open-service-reminders">
          <div class="list-row-left"><div class="list-row-label">Service Reminders</div></div>
          <svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>
      <div class="dash-card">
        <div class="dash-card-title">Benefits of Service Reminders</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;text-align:center;padding:8px 0">
          <div><div style="font-size:1.5rem">🔔</div><div class="text-sm text-secondary">Remind your parties</div></div>
          <div><div style="font-size:1.5rem">👥</div><div class="text-sm text-secondary">Don't lose customers</div></div>
          <div><div style="font-size:1.5rem">📈</div><div class="text-sm text-secondary">Grow your business</div></div>
        </div>
      </div>
      <div class="section-title">Overdue parties</div>
      ${(() => {
        const overdue = customers.map(c => {
          const b = customerBalance(c.id, c.name, c.phone);
          return { c, due: b.due };
        }).filter(x => x.due > 0).sort((a,b) => b.due - a.due).slice(0, 20);
        if (!overdue.length) return `<div class="empty-state"><p>No overdue balances — great job!</p></div>`;
        const cur = settings.currency || 'Rs';
        return `<div class="list-group">${overdue.map(({c, due}) => `
          <div class="list-row" data-action="remind-customer" data-id="${c.id}">
            <div class="list-row-left">
              <div class="list-row-label">${escapeHtml(c.name)}</div>
              <div class="list-row-sub">Due ${cur} ${money(due)}</div>
            </div>
            <button class="btn btn-primary btn-sm" data-action="remind-customer" data-id="${c.id}">Remind</button>
          </div>`).join('')}</div>`;
      })()}
    </div>`;
  }


  function bankBalance(bankId) {
    let bal = 0;
    const b = banks.find(x => x.id === bankId);
    if (b) bal = Number(b.opening) || 0;
    bankTxns.filter(t => t.bankId === bankId).forEach(t => {
      bal += (t.dir === 'in' ? 1 : -1) * (Number(t.amount) || 0);
    });
    return round2(bal);
  }

  function viewBanks() {
    const cur = settings.currency || 'Rs';
    if (!banks.length) {
      return `<div class="fade-in">${emptyState('invoice', 'No bank accounts', 'Add HBL, Meezan, JazzCash bank accounts and track transfers.', 'Add Bank', null, 'add-bank')}
        <div style="padding:0 16px 16px"><button class="btn btn-outline btn-block" data-action="add-bank">+ Add Bank Account</button></div></div>`;
    }
    return `<div class="fade-in">
      <div class="list-group">
        ${banks.map(b => `
          <div class="list-row" data-action="open-bank-ledger" data-id="${b.id}">
            <div class="list-row-left">
              <div class="list-row-label">${escapeHtml(b.name)}</div>
              <div class="list-row-sub">${escapeHtml(b.accountNo || b.type || 'Bank')}</div>
            </div>
            <div class="list-row-right font-semibold">${cur} ${money(bankBalance(b.id))}</div>
          </div>`).join('')}
      </div>
      <div style="padding:16px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" data-action="add-bank">+ Add Bank</button>
        <button class="btn btn-outline" data-action="bank-transfer">Transfer</button>
        <button class="btn btn-outline" data-action="bank-adjust">Deposit / Withdraw</button>
      </div>
    </div>`;
  }

  function viewBankLedger() {
    const id = settings._bankId;
    const b = banks.find(x => x.id === id);
    if (!b) return emptyState('invoice', 'Bank not found', '', 'Back', 'banks');
    const cur = settings.currency || 'Rs';
    const rows = bankTxns.filter(t => t.bankId === id).sort((a,c) => new Date(c.date) - new Date(a.date));
    return `<div class="fade-in">
      <div style="margin:16px;background:linear-gradient(135deg,#DBEAFE,#93C5FD);border-radius:16px;padding:20px;text-align:center">
        <div class="text-sm" style="color:#1E40AF">${escapeHtml(b.name)}</div>
        <div style="font-size:1.5rem;font-weight:700;color:#1D4ED8">${cur} ${money(bankBalance(id))}</div>
        <div class="text-sm text-secondary">${escapeHtml(b.accountNo || '')}</div>
      </div>
      <div class="section-title">Ledger</div>
      ${rows.length === 0 ? '<div class="empty-state"><p>No transactions yet</p></div>' :
        rows.map(t => {
          const col = t.dir === 'in' ? 'var(--success)' : 'var(--danger)';
          const sign = t.dir === 'in' ? '+' : '−';
          return `<div class="txn-card" style="cursor:default">
            <div class="txn-top"><div class="txn-party">${escapeHtml(t.note || (t.dir==='in'?'Deposit':'Withdrawal'))}</div>
            <span style="font-weight:600;color:${col}">${sign}${cur} ${money(t.amount)}</span></div>
            <div class="txn-meta"><span>${formatDate(t.date)}</span><span>${escapeHtml(t.mode||'Bank')}</span></div>
          </div>`;
        }).join('')}
      <div style="padding:16px;display:flex;gap:8px">
        <button class="btn btn-primary btn-block" data-action="bank-adjust" data-id="${id}">Deposit / Withdraw</button>
        <button class="btn btn-outline btn-block" data-action="bank-transfer" data-id="${id}">Transfer</button>
      </div>
    </div>`;
  }

  function viewLoans() {
    const cur = settings.currency || 'Rs';
    if (!loans.length) {
      return emptyState('invoice', 'No loan accounts', 'Track business loans and EMIs.', 'Add Loan', null, 'add-loan');
    }
    return `<div class="fade-in"><div class="list-group">${loans.map(l => `
      <div class="list-row" style="cursor:default">
        <div class="list-row-left">
          <div class="list-row-label">${escapeHtml(l.name)}</div>
          <div class="list-row-sub">${escapeHtml(l.lender || '')} · ${formatDate(l.date)}</div>
        </div>
        <div class="list-row-right text-danger font-semibold">${cur} ${money(l.balance != null ? l.balance : l.amount)}</div>
      </div>`).join('')}</div>
      <div style="padding:16px"><button class="btn btn-primary btn-block" data-action="add-loan">+ Add Loan</button></div></div>`;
  }

  function viewOtherIncome() {
    const cur = settings.currency || 'Rs';
    const total = otherIncome.reduce((s,x) => s + (Number(x.amount)||0), 0);
    return `<div class="fade-in">
      <div class="list-group">
        <div class="list-row" style="cursor:default;background:var(--success-soft)">
          <div class="list-row-left"><div class="list-row-label">Total Other Income</div></div>
          <div class="list-row-right text-success font-semibold">${cur} ${money(total)}</div>
        </div>
      </div>
      ${otherIncome.length === 0 ? emptyState('invoice', 'No other income', 'Record interest, rent received, etc.', 'Add Income', null, 'add-other-income') :
        `<div class="list-group">${otherIncome.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).map(x => `
          <div class="list-row" style="cursor:default">
            <div class="list-row-left">
              <div class="list-row-label">${escapeHtml(x.title || x.category || 'Income')}</div>
              <div class="list-row-sub">${escapeHtml(x.category||'')} · ${formatDate(x.date)}</div>
            </div>
            <div class="list-row-right text-success">${cur} ${money(x.amount)}</div>
          </div>`).join('')}</div>`}
      <div style="padding:16px"><button class="btn btn-primary btn-block" data-action="add-other-income">+ Add Other Income</button></div>
    </div>`;
  }

  // ---------- Barcode label printing ----------
  const LB = { sel: {}, q: '' };
  function lbCode(p) { return p.barcode || ('BIL' + String(p.id).replace(/\W/g, '').slice(-8).toUpperCase()); }
  function lbSettings() { return Object.assign({ size: '50x30', name: true, price: true, shop: false, code: true }, settings.labelPrefs || {}); }
  function lbItems() {
    const pf = lbSettings();
    return Object.keys(LB.sel).filter(id => LB.sel[id] > 0).map(id => products.find(x => x.id === id)).filter(Boolean)
      .map(p => ({ name: p.name, code: lbCode(p), priceText: money(p.price || 0), qty: LB.sel[p.id] }));
  }
  function lbHTML() {
    const pf = lbSettings();
    return BillauraLabels.html(lbItems(), { size: pf.size, name: pf.name, price: pf.price, shop: pf.shop, code: pf.code, shopName: settings.businessName, currency: settings.currency });
  }
  function viewBarcodeGen() {
    const pf = lbSettings();
    const q = (LB.q || '').toLowerCase();
    const list = products.filter(p => p.name && (!q || p.name.toLowerCase().includes(q) || String(p.barcode || '').includes(q)));
    const total = Object.values(LB.sel).reduce((a, n) => a + (n > 0 ? n : 0), 0);
    const tg = (k, label) => `<button type="button" class="cat-chip ${pf[k] ? 'active' : ''}" data-action="lb-flag" data-k="${k}">${label}</button>`;
    return `<div class="fade-in" style="padding-bottom:86px">
      <div class="doc-card" style="margin:12px 16px">
        <button type="button" class="ps-field" data-action="lb-size"><span><small style="color:#6B7287;display:block;font-size:.72rem">Label size</small><b>${escapeHtml(BillauraLabels.SIZES[pf.size].name)}</b></span><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button>
        <div class="chip-row mt-8">${tg('name', 'Item name')}${tg('price', 'Price')}${tg('code', 'Code text')}${tg('shop', 'Shop name')}</div>
      </div>
      <div style="display:flex;gap:8px;padding:0 16px 8px"><input type="search" class="search-input" style="flex:1" id="lbSearch" placeholder="Search items…" value="${escapeHtml(LB.q || '')}" /></div>
      <div style="display:flex;gap:8px;padding:0 16px 8px;flex-wrap:wrap"><button class="chip-btn" data-action="lb-all">Select all</button><button class="chip-btn" data-action="lb-stock">1 per stock unit</button><button class="chip-btn" data-action="lb-clear">Clear</button></div>
      ${list.length ? `<div class="list-group">${list.map(p => { const n = LB.sel[p.id] || 0; return `<div class="list-row" data-s="${escapeHtml((p.name + ' ' + lbCode(p)).toLowerCase())}" style="cursor:default"><div class="list-row-left" style="min-width:0"><div><div class="list-row-label">${escapeHtml(p.name)}</div><div class="list-row-sub">${escapeHtml(lbCode(p))} · ${settings.currency} ${money(p.price || 0)}</div></div></div>
        <div class="stepper-lb"><button type="button" data-action="lb-step" data-id="${p.id}" data-d="-1" aria-label="Less">−</button><b>${n}</b><button type="button" data-action="lb-step" data-id="${p.id}" data-d="1" aria-label="More">+</button></div></div>`; }).join('')}</div>` : '<div class="empty-state"><p>No items found. Add items first.</p></div>'}
      <div class="lb-bar"><div><div class="text-sm text-secondary">Labels</div><b style="font-size:1.1rem">${total}</b></div>
        <button class="btn btn-outline" data-action="lb-preview" ${total ? '' : 'disabled'}>Preview</button><button class="btn btn-primary" data-action="lb-print" ${total ? '' : 'disabled'}>Print</button></div>
    </div>`;
  }
  function lbPreview() {
    const html = lbHTML();
    const pf = lbSettings(), S = BillauraLabels.SIZES[pf.size];
    $('#modalRoot').innerHTML = modalShell('Label preview', `<div style="background:#EEF0F6;border-radius:12px;padding:8px;overflow:hidden"><iframe sandbox="allow-same-origin" style="width:100%;height:${S.sheet ? 380 : 220}px;border:0;background:#fff;border-radius:8px" srcdoc="${html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe></div>
      <button class="btn btn-primary btn-block mt-12" data-action="lb-print">Print labels</button>`);
  }

  function viewBalanceSheet() {
    const { revenue, cogs, receivable } = netTotals();
    const payable = totalGive();
    const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const incomeExtra = otherIncome.reduce((s,x) => s + (Number(x.amount)||0), 0);
    const cash = typeof cashInHandBalance === 'function' ? cashInHandBalance() : 0;
    const bankTotal = banks.reduce((s,b) => s + bankBalance(b.id), 0);
    const stockValue = products.reduce((s,p) => s + (Number(p.stock)||0) * (Number(p.cost)||Number(p.price)||0), 0);
    const loanBal = loans.reduce((s,l) => s + (Number(l.balance != null ? l.balance : l.amount)||0), 0);
    const assets = cash + bankTotal + stockValue + receivable;
    const liabilities = payable + loanBal;
    const equity = assets - liabilities;
    const cur = settings.currency || 'Rs';
    const row = (l, v, cls='') => `<div class="list-row" style="cursor:default"><div class="list-row-left"><div class="list-row-label">${l}</div></div><div class="list-row-right ${cls}">${cur} ${money(v)}</div></div>`;
    return `<div class="fade-in">
      <div class="section-title">Assets</div>
      <div class="list-group">
        ${row('Cash in hand', cash)}
        ${row('Bank accounts', bankTotal)}
        ${row('Stock value', stockValue)}
        ${row('Receivables', receivable, 'text-success')}
        ${row('Total Assets', assets, 'font-semibold')}
      </div>
      <div class="section-title">Liabilities</div>
      <div class="list-group">
        ${row('Payables', payable, 'text-danger')}
        ${row('Loans', loanBal, 'text-danger')}
        ${row('Total Liabilities', liabilities, 'font-semibold')}
      </div>
      <div class="section-title">Equity</div>
      <div class="list-group">
        ${row('Owner equity (Assets − Liabilities)', equity, equity>=0?'text-success font-semibold':'text-danger font-semibold')}
        ${row('YTD Sales', revenue)}
        ${row('YTD Other Income', incomeExtra)}
        ${row('YTD Expenses + COGS', totalExpenses + cogs, 'text-danger')}
      </div>
    </div>`;
  }


  function viewPOS() {
    const cur = settings.currency || 'Rs';
    const favIds = settings.favourites || [];
    const favs = favIds.map(id => products.find(p => p.id === id)).filter(Boolean);
    const top = [...products].sort((a,b) => (b.stock||0)-(a.stock||0)).slice(0, 24);
    const list = favs.length ? favs : top;
    return `<div class="fade-in pos-screen">
      <div class="pos-bar">
        <input type="search" class="search-input" id="posSearch" placeholder="Search or scan barcode..." />
        <button type="button" class="btn btn-outline btn-sm" data-action="scan-pos-barcode">Scan</button>
      </div>
      <div class="pos-chips">
        <button type="button" class="cat-chip active" data-pos-filter="fav">Favourites</button>
        <button type="button" class="cat-chip" data-pos-filter="all">All items</button>
      </div>
      <div class="pos-grid" id="posGrid">
        ${list.length ? list.map(p => {
          const isFav = favIds.includes(p.id);
          const oos = (p.stock||0) <= 0;
          return `<button type="button" class="pos-tile${oos?' oos':''}" data-action="pos-add" data-id="${p.id}">
            <span class="pos-fav" data-action="toggle-fav" data-id="${p.id}">${isFav?'★':'☆'}</span>
            <span class="pos-name">${escapeHtml(p.name)}</span>
            <span class="pos-price">${cur} ${money(p.price)}</span>
            <span class="pos-stock">${oos?'Out':('Stock '+p.stock)}</span>
          </button>`;
        }).join('') : '<div class="doc-empty" style="padding:24px">Add products to use POS</div>'}
      </div>
      <div class="pos-cart" id="posCart">
        <div class="pos-cart-info"><span id="posCount">0 items</span><strong id="posTotal">${cur} 0</strong></div>
        <button type="button" class="btn btn-primary" data-action="pos-checkout" disabled id="posCheckout">Charge</button>
      </div>
    </div>`;
  }

  function bindPOS() {
    window._posLines = window._posLines || [];
    const cur = settings.currency || 'Rs';
    const favIds = () => settings.favourites || [];
    function renderCart() {
      const lines = window._posLines;
      const n = lines.reduce((s,l)=>s+l.qty,0);
      const tot = lines.reduce((s,l)=>s+l.qty*l.price,0);
      const c = document.getElementById('posCount');
      const t = document.getElementById('posTotal');
      const b = document.getElementById('posCheckout');
      if (c) c.textContent = n + (n===1?' item':' items');
      if (t) t.textContent = cur + ' ' + money(tot);
      if (b) b.disabled = n === 0;
    }
    function renderGrid(filter, q) {
      q = (q||'').toLowerCase();
      let list = products.slice();
      if (filter === 'fav') {
        const f = favIds();
        list = f.map(id => products.find(p=>p.id===id)).filter(Boolean);
        if (!list.length) list = products.slice(0, 24);
      }
      if (q) list = products.filter(p => p.name.toLowerCase().includes(q) || (p.barcode||'').toLowerCase().includes(q));
      const grid = document.getElementById('posGrid');
      if (!grid) return;
      grid.innerHTML = list.map(p => {
        const isFav = favIds().includes(p.id);
        const oos = (p.stock||0) <= 0;
        return `<button type="button" class="pos-tile${oos?' oos':''}" data-action="pos-add" data-id="${p.id}">
          <span class="pos-fav" data-action="toggle-fav" data-id="${p.id}">${isFav?'★':'☆'}</span>
          <span class="pos-name">${escapeHtml(p.name)}</span>
          <span class="pos-price">${cur} ${money(p.price)}</span>
          <span class="pos-stock">${oos?'Out':('Stock '+p.stock)}</span>
        </button>`;
      }).join('') || '<div class="doc-empty">No items</div>';
    }
    window._posFilter = 'fav';
    window._posRenderGrid = renderGrid;
    window._posRenderCart = renderCart;
    const s = document.getElementById('posSearch');
    if (s) s.addEventListener('input', () => renderGrid(window._posFilter, s.value));
    // barcode enter
    if (s) s.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const code = s.value.trim();
        if (!code) return;
        const p = products.find(x => (x.barcode||'').toLowerCase() === code.toLowerCase());
        if (p) { document.querySelector(`[data-action="pos-add"][data-id="${p.id}"]`)?.dispatchEvent(new Event('click',{bubbles:true})); posAdd(p.id); s.value=''; renderGrid(window._posFilter,''); }
        else toast('Not found');
      }
    });
    renderCart();
  }

  function posAdd(id) {
    const p = products.find(x => x.id === id);
    if (!p) return;
    window._posLines = window._posLines || [];
    let l = window._posLines.find(x => x.productId === id);
    if (l) l.qty += 1;
    else window._posLines.push({ productId: p.id, name: p.name, price: p.price, cost: p.cost||0, qty: 1 });
    if ((p.stock||0) <= 0) toast(p.name + ' is out of stock');
    if (window._posRenderCart) window._posRenderCart();
  }

  function viewStockAdjust() {
    const cur = settings.currency || 'Rs';
    return `<div class="fade-in" style="padding:16px">
      <p class="text-sm text-secondary mb-16">Record damage, loss, found stock, or corrections. This updates quantity only.</p>
      <div class="form-group"><label class="form-label">Product</label>
        <select class="form-select" id="saProduct">
          <option value="">Select item</option>
          ${products.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (stock ${p.stock||0})</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label class="form-label">Adjustment</label>
        <div class="chip-row" id="saDir">
          <button type="button" class="cat-chip active" data-dir="out">Stock out (−)</button>
          <button type="button" class="cat-chip" data-dir="in">Stock in (+)</button>
          <button type="button" class="cat-chip" data-dir="set">Set exact qty</button>
        </div>
      </div>
      <div class="form-group"><label class="form-label">Quantity</label>
        <input type="number" class="form-input" id="saQty" min="0" step="any" placeholder="0" />
      </div>
      <div class="form-group"><label class="form-label">Reason</label>
        <select class="form-select" id="saReason">
          <option>Damage</option><option>Lost / theft</option><option>Found / excess</option>
          <option>Opening stock</option><option>Correction</option><option>Other</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Note (optional)</label>
        <input type="text" class="form-input" id="saNote" placeholder="Details" />
      </div>
      <button class="btn btn-primary btn-lg btn-block" data-action="save-stock-adjust">Save Adjustment</button>
    </div>`;
  }

  // ---------- Item photos ----------
  // Cloud copy lives in the Supabase 'product-photos' bucket (settings.photos = { itemId: { f: fileName } }, synced with settings).
  // Until a photo is uploaded it is kept as a small local copy so it still shows in the app.
  const PH_LOCAL = 'billaura_photos_v1';
  const phLocal = () => { try { return JSON.parse(localStorage.getItem(PH_LOCAL) || '{}') || {}; } catch (e) { return {}; } };
  const phLocalSave = m => { try { localStorage.setItem(PH_LOCAL, JSON.stringify(m)); return true; } catch (e) { return false; } };
  function photoSrc(pid) {
    const l = phLocal()[pid]; if (l) return l;
    const r = settings.photos && settings.photos[pid];
    return r && r.f && settings.photoBase ? settings.photoBase + r.f : '';
  }
  function compressImage(file, max) {
    max = max || 560;
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('Could not read the image'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('That file is not a picture'));
        img.onload = () => {
          const k = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(b => b ? resolve({ blob: b, dataUrl: c.toDataURL('image/jpeg', 0.78) }) : reject(new Error('Could not process the image')), 'image/jpeg', 0.78);
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  async function uploadPhotoBlob(pid, blob) {
    const C = window.HisablyCloud;
    if (!C || !C.ready() || !C.shopId || !C.shopId()) return false;
    const sb = C.client && C.client(); if (!sb) return false;
    const sid = C.shopId();
    const file = pid.replace(/-/g, '').slice(0, 10) + '-' + Date.now().toString(36) + '.jpg';
    const { error } = await sb.storage.from('product-photos').upload(sid + '/' + file, blob, { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' });
    if (error) throw error;
    const base = sb.storage.from('product-photos').getPublicUrl(sid + '/x').data.publicUrl.replace(/x$/, '');
    const old = settings.photos && settings.photos[pid] && settings.photos[pid].f;
    settings.photos = settings.photos || {}; settings.photos[pid] = { f: file }; settings.photoBase = base; persist();
    if (old) { try { await sb.storage.from('product-photos').remove([sid + '/' + old]); } catch (e) {} }
    return true;
  }
  async function savePhotoFor(pid, pick, remove) {
    try {
      if (remove) {
        const m = phLocal(); delete m[pid]; phLocalSave(m);
        const old = settings.photos && settings.photos[pid];
        if (old) { delete settings.photos[pid]; persist(); try { const C = window.HisablyCloud, sb = C && C.client && C.client(); if (sb && C.shopId()) await sb.storage.from('product-photos').remove([C.shopId() + '/' + old.f]); } catch (e) {} }
        return;
      }
      if (!pick) return;
      const m = phLocal(); m[pid] = pick.dataUrl;
      if (!phLocalSave(m)) toast('Phone storage is full – photo not kept offline');
      let up = false;
      try { up = await uploadPhotoBlob(pid, pick.blob); } catch (e) { toast('Photo saved on this phone; cloud upload failed: ' + (e.message || '')); }
      if (up) { const m2 = phLocal(); delete m2[pid]; phLocalSave(m2); toast('Photo uploaded'); }
      if (currentView === 'products') render();
    } catch (e) { toast('Could not save the photo'); }
  }
  async function uploadPendingPhotos() {
    const m = phLocal(); const ids = Object.keys(m).filter(id => products.some(p => p.id === id));
    let ok = 0;
    for (const id of ids) {
      try { const blob = await (await fetch(m[id])).blob(); if (await uploadPhotoBlob(id, blob)) { const m2 = phLocal(); delete m2[id]; phLocalSave(m2); ok++; } } catch (e) {}
    }
    return { ok, left: Object.keys(phLocal()).filter(id => products.some(p => p.id === id)).length };
  }
  // Rebuilds the public store snapshot from the current business details + items.
  // Silent mode only touches storage when something actually changed (keeps the link in sync with the app).
  async function republishStore(silent) {
    const catalog = {
      shop: settings.businessName || 'My Shop', phone: settings.phone || '', email: settings.email || '',
      address: [settings.address, settings.city].filter(Boolean).join(', '),
      tagline: settings.storeTagline || settings.businessDesc || '', wa: settings.storeWhatsapp || settings.phone || '',
      color: settings.invoiceColor || '#EF1A3C',
      links: (settings.storeLinks || []).map(l => ({ label: l.label, url: l.url })),
      currency: settings.currency || 'PKR',
      opts: { open: settings.storeOpen !== false, delivery: settings.storeDelivery !== false, pickup: settings.storePickup !== false, fee: Number(settings.storeFee) || 0, min: Number(settings.storeMin) || 0, notice: settings.storeNotice || '' },
      items: products.filter(p => p.online !== false && !(settings.storeHideOOS && (Number(p.stock) || 0) <= 0)).map(p => ({ id: p.id, name: p.name, price: p.price, unit: p.unit || '', category: p.category || '', stock: p.stock, photo: (settings.photos && settings.photos[p.id] && settings.photoBase) ? settings.photoBase + settings.photos[p.id].f : '' })).slice(0, 400)
    };
    const h = await packCatalog(catalog);
    if (silent && h === settings._storeHash && (settings._slugLive || !settings.storeSlug)) return catalog.items.length;
    catalog.updatedAt = new Date().toISOString();
    try { localStorage.setItem('billaura_public_store', JSON.stringify(catalog)); } catch (e) {}
    if (h !== settings._storeHash) { settings._storeHash = h; persist(); }
    await pushStoreCloud(catalog);
    return catalog.items.length;
  }
  function compactOf(c) {
    return { n: c.shop, p: c.phone, e: c.email, a: c.address, c: c.currency, t: c.tagline, w: c.wa, k: c.color, b: settings.photoBase || '', l: (c.links || []).map(l => [l.label, l.url]), o: c.opts ? { a: c.opts.open ? 1 : 0, d: c.opts.delivery ? 1 : 0, k: c.opts.pickup ? 1 : 0, f: c.opts.fee, m: c.opts.min, n: c.opts.notice } : undefined, i: c.items.map(x => [x.name, x.price, x.unit, x.category, x.stock, x.photo ? (settings.photoBase && x.photo.startsWith(settings.photoBase) ? x.photo.slice(settings.photoBase.length) : x.photo) : '', x.id || '']) };
  }
  async function packCatalog(c) {
    const compact = compactOf(c);
    const json = JSON.stringify(compact);
    const b64 = u8 => btoa(String.fromCharCode.apply(null, u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    try {
      if (window.CompressionStream) {
        const cs = new CompressionStream('deflate-raw');
        const w = cs.writable.getWriter(); w.write(new TextEncoder().encode(json)); w.close();
        const buf = new Uint8Array(await new Response(cs.readable).arrayBuffer());
        return 'z=' + b64(buf);
      }
    } catch (e) {}
    return 'j=' + b64(new TextEncoder().encode(json));
  }
  const slugify = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 38).replace(/-+$/, '');
  const slugOk = v => /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(v);
  let _slugMsg = '';
  // Publishes the store to the cloud under a short address; returns true when the short link is live.
  async function pushStoreCloud(catalog) {
    _slugMsg = '';
    const C = window.HisablyCloud;
    if (!C || !C.ready() || !C.getSession() || !C.shopId || !C.shopId() || !navigator.onLine) return false;
    try {
      let slug = settings.storeSlug;
      if (!slug || !slugOk(slug)) {
        const base = slugify(settings.businessName) || ('store-' + C.shopId().slice(0, 6));
        slug = '';
        for (let i = 0; i < 6 && !slug; i++) { const cand = i ? base.slice(0, 34) + '-' + (i + 1) : base; if (slugOk(cand) && !(await C.slugTaken(cand))) slug = cand; }
        if (!slug) { _slugMsg = 'Could not find a free store name'; return false; }
        settings.storeSlug = slug;
      }
      await C.publishStore(slug, compactOf(catalog));
      if (!settings._slugLive) { settings._slugLive = true; }
      persist();
      return true;
    } catch (e) {
      settings._slugLive = false;
      _slugMsg = e.message === 'SETUP_NEEDED' ? 'Short link needs a one-time setup (run supabase/stores.sql)' : (e.message === 'SLUG_TAKEN' ? 'That store name is already taken' : 'Could not publish the short link');
      return false;
    }
  }
  function storeUrl() {
    if (settings.storeSlug && settings._slugLive) return siteBase() + 'store/' + settings.storeSlug;
    let u = siteBase() + 'store.html';
    if (settings._storeHash) u += '#' + (/^[zj]=/.test(settings._storeHash) ? settings._storeHash : 'c=' + settings._storeHash);
    return u;
  }
  function viewOnlineStore() {
    const planKey = (window.HisablyFreemium && HisablyFreemium.effectivePlan) ? HisablyFreemium.effectivePlan().key : 'free';
    const isPro = planKey === 'pro' || planKey === 'trial';
    if (!products.length) {
      return `<div class="fade-in"><div class="empty-state" style="padding-top:48px"><h3>Start Selling Online instantly</h3><p>Please add an Item before proceeding.</p><button class="btn btn-primary" data-view="products">Add Item</button></div></div>`;
    }
    const links = settings.storeLinks || [];
    const published = !!localStorage.getItem('billaura_public_store');
    const url = storeUrl();
    return `<div class="fade-in" style="padding-bottom:24px">
      <div class="store-hero"><div class="acct-av big">${acctAvatar()}</div>
        <div class="sh-name">${escapeHtml(settings.businessName || 'My Store')}</div>
        <div class="sh-tag">${escapeHtml(settings.storeTagline || settings.businessDesc || 'Add a short tagline for your store')}</div>
        <div class="sh-stats"><div><b>${products.length}</b><span>Items</span></div><div><b>${published ? 'Live' : 'Draft'}</b><span>Status</span></div><div><b>${links.length}</b><span>Links</span></div></div>
        <button class="sh-edit" data-action="store-edit-info">Edit store info</button></div>
      ${isPro ? `
      ${(window.BillauraExt && BillauraExt.storeDash) ? BillauraExt.storeDash() : ''}
      <div class="doc-card" style="margin:14px 16px 0"><div class="doc-label">Your store link</div>
        <div class="store-url">${escapeHtml(settings.storeSlug && settings._slugLive ? new URL(url).host + new URL(url).pathname : new URL(url).host + new URL(url).pathname + (settings._storeHash ? ' · ' + (url.length / 1000).toFixed(1) + 'k link' : ''))}</div>
        <div class="text-sm text-secondary" style="margin-top:6px">${settings.storeSlug && settings._slugLive ? 'Short link is live.' : 'This is the long link. Sign in to the cloud and tap Update Store Page to get a short name link.'} <button type="button" class="chip-btn" data-action="store-edit-slug">${settings.storeSlug ? 'Change name' : 'Choose name'}</button></div>
        <div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-outline" style="flex:1" data-action="copy-store-link">Copy link</button><button class="btn btn-primary" style="flex:1" data-action="share-store-link">Share on WhatsApp</button></div></div>
      <div style="padding:12px 16px;display:flex;flex-direction:column;gap:10px">
        <button class="btn btn-primary btn-lg btn-block" data-action="publish-store-page">${published ? 'Update' : 'Publish'} Store Page</button>
        <button class="btn btn-outline btn-block" data-action="open-store-page">Preview Store Page</button>
        <button class="btn btn-ghost btn-block" data-action="publish-store">Share catalog list only</button>
      </div>
      <div class="section-title">Custom links</div>
      <div class="list-group">
        ${links.map(l => `<div class="list-row" style="cursor:default"><div class="list-row-left" style="min-width:0"><div><div class="list-row-label">${escapeHtml(l.label)}</div><div class="text-sm text-secondary" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60vw">${escapeHtml(l.url)}</div></div></div>
          <div class="list-row-right" style="gap:6px;display:flex"><button class="chip-btn" data-action="store-edit-link" data-id="${l.id}">Edit</button><button class="chip-btn" style="color:#E11D48" data-action="store-del-link" data-id="${l.id}">Delete</button></div></div>`).join('') || '<div class="doc-empty">No links yet – add Instagram, Facebook, website, maps…</div>'}
        <div class="list-row" data-action="store-edit-link"><div class="list-row-left"><div class="list-row-label" style="color:#0A6FE0">+ Add custom link</div></div></div>
      </div>
      <p class="text-sm text-secondary" style="padding:8px 16px">Links show as buttons on your store page. Tap <b>Update Store Page</b> after changing them.</p>` : `
      <div class="dash-card" style="text-align:center"><h3 style="margin-bottom:8px">Upgrade your Plan</h3><p class="text-secondary text-sm mb-3">Online Store is a Premium Feature.</p><button class="btn btn-primary" data-action="open-plans">Get Billaura Premium</button></div>`}
    </div>`;
  }
  function openStoreLinkModal(id) {
    const l = (settings.storeLinks || []).find(x => x.id === id) || {};
    $('#modalRoot').innerHTML = modalShell(l.id ? 'Edit link' : 'Add custom link', `
      <div class="form-group"><label class="form-label">Button name</label><input class="form-input" id="slLabel" maxlength="30" placeholder="e.g. Instagram" value="${escapeHtml(l.label || '')}" /></div>
      <div class="form-group"><label class="form-label">Link (https://…)</label><input class="form-input" id="slUrl" inputmode="url" placeholder="https://instagram.com/yourshop" value="${escapeHtml(l.url || '')}" /></div>
      <button class="btn btn-primary btn-block" data-action="store-save-link" data-id="${l.id || ''}">Save link</button>`);
  }
  function openStoreInfoModal() {
    $('#modalRoot').innerHTML = modalShell('Store info', `
      <div class="form-group"><label class="form-label">Tagline</label><input class="form-input" id="siTag" maxlength="80" value="${escapeHtml(settings.storeTagline || '')}" placeholder="e.g. Quality hardware at fair prices" /></div>
      <div class="form-group"><label class="form-label">WhatsApp number for orders</label><input class="form-input" id="siWa" type="tel" value="${escapeHtml(settings.storeWhatsapp || settings.phone || '')}" /></div>
      <button class="btn btn-primary btn-block" data-action="store-save-info">Save</button>`);
  }

  function openSettingsModal() {
    $('#modalRoot').innerHTML = `
      <div class="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-handle"></div>
          <div class="modal-header">
            <h3 class="modal-title">Business Settings</h3>
            <button class="modal-close" data-action="close-modal"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
          <form id="settingsForm">
            <div class="form-group"><label class="form-label">Business Name *</label><input class="form-input" name="businessName" required value="${escapeHtml(settings.businessName)}" /></div>
            <div class="form-group">
              <label class="form-label">Logo</label>
              <div class="logo-upload-row">
                <div class="logo-preview" id="logoPreview">${settings.logo ? `<img src="${settings.logo}" alt="Logo" />` : '<span>No logo</span>'}</div>
                <div style="flex:1">
                  <input type="file" id="logoFile" accept="image/*" style="display:none" />
                  <button type="button" class="btn btn-secondary btn-sm" data-action="pick-logo">Upload Logo</button>
                  ${settings.logo ? `<button type="button" class="btn btn-ghost btn-sm" data-action="remove-logo" style="margin-left:8px">Remove</button>` : ''}
                </div>
              </div>
              <input type="hidden" name="logo" id="logoValue" value="" />
            </div>
            <div class="form-group">
              <label class="form-label">Payment QR Code (JazzCash / EasyPaisa / Bank)</label>
              <div class="logo-upload-row">
                <div class="logo-preview" id="qrPreview">${(settings.paymentQr && (!window.HisablyFreemium || HisablyFreemium.effectivePlan().limits.paymentQrOnInvoice)) ? `<img src="${settings.paymentQr}" alt="QR" />` : '<span>No QR</span>'}</div>
                <div style="flex:1">
                  <input type="file" id="qrFile" accept="image/*" style="display:none" />
                  <button type="button" class="btn btn-secondary btn-sm" data-action="pick-qr">Upload QR</button>
                  ${(settings.paymentQr && (!window.HisablyFreemium || HisablyFreemium.effectivePlan().limits.paymentQrOnInvoice)) ? `<button type="button" class="btn btn-ghost btn-sm" data-action="remove-qr" style="margin-left:8px">Remove</button>` : ''}
                </div>
              </div>
              <input type="text" class="form-input mt-8" name="paymentNote" value="${escapeHtml(settings.paymentNote || 'Pay via JazzCash / EasyPaisa / Bank')}" placeholder="Payment note on invoice" />
            </div>
            <div class="form-group"><label class="form-label">Owner Name</label><input class="form-input" name="ownerName" value="${escapeHtml(settings.ownerName || '')}" /></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Phone</label><input class="form-input" name="phone" type="tel" value="${escapeHtml(settings.phone || '')}" /></div>
              <div class="form-group"><label class="form-label">Email</label><input class="form-input" name="email" type="email" value="${escapeHtml(settings.email || '')}" /></div>
            </div>
            <div class="form-group"><label class="form-label">Address</label><input class="form-input" name="address" value="${escapeHtml(settings.address || '')}" /></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">City</label><input class="form-input" name="city" value="${escapeHtml(settings.city || '')}" /></div>
              <div class="form-group"><label class="form-label">Tax / NTN / GST</label><input class="form-input" name="taxId" value="${escapeHtml(settings.taxId || '')}" /></div>
            </div>
            <div class="form-group">
              <label class="form-label">Currency</label>
              ${customSelect('currency', [
                { value: 'PKR', label: 'PKR – Pakistani Rupee' },
                { value: 'INR', label: 'INR – Indian Rupee' },
                { value: 'BDT', label: 'BDT – Bangladeshi Taka' },
                { value: 'USD', label: 'USD – US Dollar' },
                { value: 'EUR', label: 'EUR – Euro' }
              ], settings.currency || 'PKR')}
            </div>
            <div class="form-group">
              <label class="form-label">Default Tax % (added to new invoices, 0 = none)</label>
              <input class="form-input" name="taxRate" type="number" inputmode="decimal" min="0" step="any" value="${settings.taxRate || ''}" placeholder="0" />
            </div>
            <div class="form-group">
              <label class="form-label">Invoice Prefix</label>
              <input class="form-input" name="invoicePrefix" value="${escapeHtml(settings.invoicePrefix || 'INV')}" />
            </div>
            ${themePickerHTML()}
            ${securityHTML()}
            <button type="submit" class="btn btn-primary btn-block mt-16">Save Settings</button>
          </form>
        </div>
      </div>`;
    $('#settingsForm').addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      settings.businessName = fd.get('businessName').trim() || 'My Business';
      settings.ownerName = fd.get('ownerName').trim();
      settings.phone = fd.get('phone').trim();
      settings.email = fd.get('email').trim();
      settings.address = fd.get('address').trim();
      settings.city = fd.get('city').trim();
      settings.taxId = fd.get('taxId').trim();
      settings.currency = fd.get('currency');
      settings.invoicePrefix = fd.get('invoicePrefix').trim() || 'INV';
      settings.taxRate = Math.max(0, parseFloat(fd.get('taxRate')) || 0);
      settings.paymentNote = (fd.get('paymentNote') || '').trim() || 'Pay via JazzCash / EasyPaisa / Bank';
      // logo / paymentQr updated live via pick/remove actions
      persist();
      toast('Settings saved');
      closeModal();
      render();
    });
  }

  // ---------- Invoice Detail + PDF + Image Share + Print ----------
  function openInvoiceDetail(inv) {
    const itemsHtml = inv.items.map(it => `
      <div class="summary-row"><span>${escapeHtml(it.name)} × ${it.qty}</span><span>${settings.currency} ${money(it.price * it.qty)}</span></div>`).join('');
    const paid = inv.paidAmount || 0;
    const due = Math.max(0, (inv.total || 0) - paid);
    const extraPaid = (inv.docType === 'sale' || !inv.docType) ? Math.max(0, round2(paid - (inv.total || 0))) : 0;
    let statusLabel = 'Unpaid';
    if (extraPaid > 0.001) statusLabel = 'Paid + customer credit';
    else if (paid >= inv.total) statusLabel = 'Fully Paid';
    else if (paid > 0) statusLabel = 'Partial / Advance';
    const isEst = inv.docType === 'estimate';
    if (isEst) statusLabel = inv.meta && inv.meta.convertedTo ? 'Converted to ' + inv.meta.convertedTo : 'Open';
    if (inv.docType === 'return') statusLabel = paid >= inv.total ? 'Fully Refunded' : (paid > 0 ? 'Partly Refunded' : 'Credit pending');

    $('#modalRoot').innerHTML = `
      <div class="modal-overlay" id="invDetail">
        <div class="modal-sheet">
          <div class="modal-handle"></div>
          <div class="modal-header">
            <h3 class="modal-title">${docWord(inv)} ${escapeHtml(inv.number)}</h3>
            <button class="modal-close" data-action="close-modal"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
          <div class="mb-16">
            <div class="text-sm text-secondary">Customer</div>
            <div class="font-semibold">${escapeHtml(inv.customerName || 'Walk-in')}</div>
            ${inv.customerPhone ? `<div class="text-sm text-secondary mt-8">${escapeHtml(inv.customerPhone)}</div>` : ''}
            <div class="text-sm text-secondary mt-8">${formatDate(inv.date)}${inv.meta && inv.meta.refNumber ? ' · against ' + escapeHtml(inv.meta.refNumber) : ''}${inv.meta && inv.meta.by ? ' · by ' + escapeHtml(inv.meta.by) : ''}</div>
          </div>
          <div class="invoice-summary">${itemsHtml}
            ${(() => { const x = invExtraRows(inv); return x.rows.length ? `<div class="summary-row"><span>Subtotal</span><span>${settings.currency} ${money(x.sub)}</span></div>` + x.rows.map(r => `<div class="summary-row"><span>${escapeHtml(r.label)}</span><span>${r.amt < 0 ? '−' : ''}${settings.currency} ${money(Math.abs(r.amt))}</span></div>`).join('') : ''; })()}
            <div class="summary-row total"><span>Total</span><span>${settings.currency} ${money(inv.total)}</span></div>
            ${inv.meta && inv.meta.paymentMode ? `<div class="summary-row"><span>Payment mode</span><span>${escapeHtml(inv.meta.paymentMode)}</span></div>` : ''}
            ${inv.meta && inv.meta.dueDate ? `<div class="summary-row"><span>Due date</span><span${isOverdue(inv) ? ' style="color:var(--danger);font-weight:600"' : ''}>${formatDate(inv.meta.dueDate)}${isOverdue(inv) ? ' · overdue' : ''}</span></div>` : ''}
            ${inv.meta && inv.meta.validUntil ? `<div class="summary-row"><span>Valid until</span><span>${formatDate(inv.meta.validUntil)}</span></div>` : ''}
            ${isEst ? '' : `<div class="summary-row"><span>${inv.docType === 'return' ? 'Refunded' : 'Paid'}</span><span style="color:var(--success)">${settings.currency} ${money(paid)}</span></div>
            <div class="summary-row"><span>${inv.docType === 'return' ? 'Credit left' : 'Due'}</span><span style="color:${due > 0 ? 'var(--danger)' : 'var(--success)'}">${settings.currency} ${money(due)}</span></div>
            ${extraPaid > 0.001 ? `<div class="summary-row"><span>Customer credit (you owe)</span><span style="color:var(--danger);font-weight:700">${settings.currency} ${money(extraPaid)}</span></div>` : ''}
`}
            <div class="summary-row"><span>Status</span><span class="font-semibold">${statusLabel}</span></div>
          </div>
          ${extraPaid > 0.001 ? `<button class="btn btn-outline btn-block mt-16" data-action="refund-credit" data-id="${inv.id}">Refund credit to customer</button><div class="text-sm text-secondary mt-8">Or pick this customer on a new sale and tick <b>Use customer credit</b>.</div>` : ''}
          ${isEst && !(inv.meta && inv.meta.convertedTo) ? `<button class="btn btn-primary btn-block mt-16" data-action="convert-estimate" data-id="${inv.id}">Convert to Invoice</button>` : ''}
          ${(!isEst && due > 0) ? `
          <div class="form-group mt-16">
            <label class="form-label">${inv.docType === 'return' ? 'Record refund paid' : 'Record payment'}</label>
            <div class="input-with-btn">
              <input type="number" class="form-input" id="recordPayInput" min="0" step="0.01" placeholder="Amount" />
              <button type="button" class="btn btn-primary btn-sm" style="height:48px" data-action="record-payment" data-id="${inv.id}">Add</button>
            </div>
            ${modeChips('rpMode')}
          </div>
          <button class="btn btn-secondary btn-block mt-8" data-action="mark-paid" data-id="${inv.id}">${inv.docType === 'return' ? 'Mark as Fully Refunded' : 'Mark as Fully Paid'}</button>
          ` : ''}
          <div class="dl-grid mt-20">
            <button class="btn btn-primary" data-action="pdf-invoice" data-id="${inv.id}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 20h16"/></svg> Download PDF</button>
            <button class="btn btn-secondary" data-action="download-image" data-id="${inv.id}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 20h16"/></svg> Download Image</button>
            <button class="btn btn-secondary" data-action="share-image" data-id="${inv.id}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg> Share</button>
            <button class="btn btn-secondary" data-action="print-invoice" data-id="${inv.id}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> Print</button>
          </div>
          <button class="btn btn-ghost btn-block mt-12" data-action="share-whatsapp-text" data-id="${inv.id}">Share as WhatsApp text</button>
          ${((inv.docType || 'sale') === 'sale' && due > 0) ? `<button class="btn btn-ghost btn-block mt-8" data-action="remind-invoice" data-id="${inv.id}">Send payment reminder (WhatsApp)</button>` : ''}
          ${(inv.docType || 'sale') === 'sale' ? `<button class="btn btn-ghost btn-block mt-8" data-action="return-from-invoice" data-id="${inv.id}">Return items from this invoice</button>` : ''}
          <button class="btn btn-ghost btn-block mt-8" data-action="duplicate-invoice" data-id="${inv.id}">Duplicate invoice</button>
        </div>
      </div>`;
  }

  function generatePDF(inv) {
    if (!tplOK()) return;
    toast('Preparing PDF…');
    BillauraTemplates.pdf(inv, tplCtx(), {}, `${(inv.docType==='estimate'?'Quotation':'Invoice')}-${inv.number}.pdf`).then(() => toast('PDF downloaded')).catch(e => { console.error(e); toast('PDF failed – try Print'); });
  }
  function generatePDFOld(inv) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, m = 16;
    const paid = inv.paidAmount || 0;
    const due = Math.max(0, (inv.total || 0) - paid);
    const statusText = inv.docType === 'estimate' ? 'QUOTE' : (due <= 0 ? 'PAID' : (paid > 0 ? 'PARTIAL' : 'UNPAID'));
    let y = 0;

    // Header (theme: filled band or clean line)
    const TH = HisablyReceipt.themeOf(settings), A = HisablyReceipt.hexRgb(TH.accent), D = HisablyReceipt.hexRgb(TH.dark), S = HisablyReceipt.hexRgb(TH.soft);
    const band = TH.style === 'band';
    if (band) { doc.setFillColor(A[0], A[1], A[2]); doc.rect(0, 0, W, 36, 'F'); }
    else { doc.setFillColor(A[0], A[1], A[2]); doc.rect(0, 34, W, 1.4, 'F'); }

    let textX = m;
    const pLogo = settings.printLogo !== false;
    const pName = settings.printCompanyName !== false;
    const pAddr = settings.printAddress !== false;
    const pPhone = settings.printPhone !== false;
    const pEmail = settings.printEmail !== false;
    if (pLogo && settings.logo) {
      try {
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(m, 7, 22, 22, 3, 3, 'F');
        doc.addImage(settings.logo, 'PNG', m + 2, 9, 18, 18);
        textX = m + 26;
      } catch (e) {}
    }
    if (band) doc.setTextColor(255, 255, 255); else doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    if (pName) doc.text(settings.businessName || 'Business', textX, 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const subParts = [];
    if (pPhone && settings.phone) subParts.push(settings.phone);
    if (pAddr) { if (settings.city) subParts.push(settings.city); if (settings.address) subParts.push(settings.address); }
    const sub = subParts.join('  ·  ');
    if (sub) doc.text(sub.substring(0, 70), textX, 23);
    if (pEmail && settings.email) doc.text(settings.email, textX, 28);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(docWord(inv).toUpperCase(), W - m, 14, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(String(inv.number), W - m, 20, { align: 'right' });
    doc.text(formatDate(inv.date), W - m, 26, { align: 'right' });

    y = 46;
    // Bill to + status
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text('BILL TO', m, y);
    y += 5;
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(inv.customerName || 'Walk-in Customer', m, y);
    // status badge
    if (statusText === 'PAID') doc.setFillColor(16, 185, 129);
    else if (statusText === 'PARTIAL') doc.setFillColor(245, 158, 11);
    else doc.setFillColor(239, 68, 68);
    const bw = statusText === 'PARTIAL' ? 22 : 18;
    doc.roundedRect(W - m - bw, y - 5, bw, 7, 1.5, 1.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(statusText, W - m - bw / 2, y - 0.5, { align: 'center' });
    y += 6;
    doc.setTextColor(100);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    if (inv.customerPhone) { doc.text(inv.customerPhone, m, y); y += 5; }
    y += 4;

    // Table header (repeated on every page)
    const tableHeader = () => {
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(m, y, W - 2 * m, 8, 1.5, 1.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text('#', m + 3, y + 5.5);
      doc.text('ITEM', m + 12, y + 5.5);
      doc.text('QTY', m + 108, y + 5.5, { align: 'right' });
      doc.text('PRICE', m + 138, y + 5.5, { align: 'right' });
      doc.text('AMOUNT', W - m - 3, y + 5.5, { align: 'right' });
      y += 12;
    };
    tableHeader();

    doc.setTextColor(15, 23, 42);
    inv.items.forEach((it, idx) => {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      const nameLines = doc.splitTextToSize(String(it.name), 88);
      const rowH = Math.max(8, nameLines.length * 4.4 + 3.6);
      if (y + rowH > 272) { doc.addPage(); y = 20; tableHeader(); }
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(m, y - 4.5, W - 2 * m, rowH, 'F');
      }
      doc.setTextColor(148, 163, 184);
      doc.text(String(idx + 1), m + 3, y);
      doc.setTextColor(15, 23, 42);
      doc.text(nameLines, m + 12, y);
      doc.text(String(it.qty), m + 108, y, { align: 'right' });
      doc.text(money(it.price), m + 138, y, { align: 'right' });
      doc.setFont('helvetica', 'bold');
      doc.text(money(it.price * it.qty), W - m - 3, y, { align: 'right' });
      y += rowH;
    });
    if (y > 215) { doc.addPage(); y = 20; }

    y += 4;
    doc.setDrawColor(226, 232, 240);
    doc.line(m, y, W - m, y);
    y += 8;

    // Totals
    const tx = W - m - 55;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100);
    const ex = invExtraRows(inv);
    doc.text('Subtotal', tx, y);
    doc.setTextColor(15, 23, 42);
    doc.text(`${settings.currency} ${money(ex.rows.length ? ex.sub : inv.total)}`, W - m, y, { align: 'right' });
    y += 6;
    ex.rows.forEach(r => {
      doc.setTextColor(100);
      doc.text(r.label, tx, y);
      doc.setTextColor(15, 23, 42);
      doc.text(`${r.amt < 0 ? '-' : ''}${settings.currency} ${money(Math.abs(r.amt))}`, W - m, y, { align: 'right' });
      y += 6;
    });
    if (inv.docType !== 'estimate') {
    doc.setTextColor(100);
    doc.text('Paid', tx, y);
    doc.setTextColor(16, 185, 129);
    doc.setFont('helvetica', 'bold');
    doc.text(`${settings.currency} ${money(paid)}`, W - m, y, { align: 'right' });
    y += 6;
    if (due > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100);
      doc.text('Due', tx, y);
      doc.setTextColor(239, 68, 68);
      doc.setFont('helvetica', 'bold');
      doc.text(`${settings.currency} ${money(due)}`, W - m, y, { align: 'right' });
      y += 6;
    }
    }
    y += 2;
    doc.setFillColor(S[0], S[1], S[2]);
    doc.roundedRect(tx - 4, y - 4, W - m - (tx - 4), 10, 2, 2, 'F');
    doc.setTextColor(D[0], D[1], D[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Total', tx, y + 3);
    doc.text(`${settings.currency} ${money(inv.total)}`, W - m, y + 3, { align: 'right' });
    y += 16;

    // Payment QR section (paid plans only, same rule as the image invoice)
    if (settings.paymentQr && (!window.HisablyFreemium || HisablyFreemium.effectivePlan().limits.paymentQrOnInvoice)) {
      try {
        const qrSize = 32;
        doc.setDrawColor(226, 232, 240);
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(m, y, W - 2 * m, qrSize + 14, 3, 3, 'FD');
        doc.addImage(settings.paymentQr, 'PNG', m + 6, y + 6, qrSize, qrSize);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(15, 23, 42);
        doc.text('Scan to pay', m + qrSize + 12, y + 14);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(100);
        doc.text(settings.paymentNote || 'Pay via JazzCash / EasyPaisa / Bank', m + qrSize + 12, y + 20);
        if (settings.phone) doc.text('Contact: ' + settings.phone, m + qrSize + 12, y + 26);
        y += qrSize + 18;
      } catch (e) { y += 4; }
    }

    if (settings.taxId) {
      doc.setFontSize(7);
      doc.setTextColor(120);
      doc.text('Tax / NTN / GST: ' + settings.taxId, m, y);
      y += 5;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(A[0], A[1], A[2]);
    doc.text('Thank you for your business!', m, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(160);
    doc.text('Generated by Billaura', m, y);

    // page numbers + signature lines
    const pages = doc.getNumberOfPages();
    for (let pg = 1; pg <= pages; pg++) {
      doc.setPage(pg);
      doc.setFontSize(7);
      doc.setTextColor(160);
      doc.setFont('helvetica', 'normal');
      doc.text(`${inv.number}  ·  Page ${pg} of ${pages}`, W - m, 290, { align: 'right' });
    }

    doc.save(`Invoice-${inv.number}.pdf`);
    toast('PDF downloaded');
  }

  async function shareInvoiceImage(inv, forceDownload) {
    if (!tplOK()) return;
    try {
      toast('Preparing image…');
      const blob = await BillauraTemplates.image(inv, tplCtx(), {});
      const file = new File([blob], `Invoice-${inv.number}.png`, { type: 'image/png' });
      if (!forceDownload && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Invoice ' + inv.number }); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
      toast('Image downloaded');
    } catch (e) { if (e && e.name !== 'AbortError') { console.error(e); toast('Could not create image'); } }
  }
  async function shareInvoiceImageOld(inv) {
    const paid = inv.paidAmount || 0;
    const due = Math.max(0, (inv.total || 0) - paid);
    const statusText = inv.docType === 'estimate' ? 'QUOTE' : (due <= 0 ? 'PAID' : (paid > 0 ? 'PARTIAL' : 'UNPAID'));
    const statusColor = due <= 0 ? '#10B981' : (paid > 0 ? '#F59E0B' : '#EF4444');

    const TH = HisablyReceipt.themeOf(settings), bandT = TH.style === 'band';
    const card = document.createElement('div');
    card.style.cssText = 'position:fixed;left:-9999px;top:0;width:400px;background:#fff;font-family:Inter,system-ui,sans-serif;color:#0F172A;border-radius:16px;overflow:hidden;';
    card.innerHTML = `
      <div style="${bandT ? `background:linear-gradient(135deg,${TH.accent},${TH.dark});color:#fff;` : `background:#fff;color:#0F172A;border-bottom:3px solid ${TH.accent};`}padding:18px 20px;display:flex;align-items:center;gap:12px;">
        ${settings.logo ? `<div style="width:46px;height:46px;border-radius:12px;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0"><img src="${settings.logo}" style="width:42px;height:42px;object-fit:contain"/></div>` : `<div style="width:46px;height:46px;border-radius:12px;background:${bandT ? '#fff' : TH.soft};color:${TH.accent};font-weight:800;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0">H</div>`}
        <div style="flex:1;min-width:0">
          <div style="font-size:17px;font-weight:700">${escapeHtml(settings.businessName)}</div>
          <div style="font-size:11px;opacity:0.9;margin-top:2px">${escapeHtml([settings.phone, settings.city].filter(Boolean).join(' · '))}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:10px;font-weight:700;opacity:0.85;letter-spacing:0.05em">${docWord(inv).toUpperCase()}</div>
          <div style="font-size:13px;font-weight:600">${escapeHtml(inv.number)}</div>
          <div style="font-size:10px;opacity:0.85">${formatDate(inv.date)}</div>
        </div>
      </div>
      <div style="padding:16px 20px 6px;display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:10px;color:#94A3B8;font-weight:600;letter-spacing:0.04em">BILL TO</div>
          <div style="font-size:15px;font-weight:700;margin-top:2px">${escapeHtml(inv.customerName || 'Walk-in')}</div>
          ${inv.customerPhone ? `<div style="font-size:12px;color:#64748B;margin-top:2px">${escapeHtml(inv.customerPhone)}</div>` : ''}
        </div>
        <div style="background:${statusColor};color:#fff;font-size:11px;font-weight:700;padding:5px 10px;border-radius:8px">${statusText}</div>
      </div>
      <div style="padding:8px 20px">
        <div style="background:#F8FAFC;border-radius:10px;padding:10px 12px">
          <div style="display:flex;font-size:10px;color:#94A3B8;font-weight:600;margin-bottom:6px">
            <span style="flex:1">ITEM</span><span style="width:40px;text-align:center">QTY</span><span style="width:78px;text-align:right">AMOUNT</span>
          </div>
          ${inv.items.map(it => `
            <div style="display:flex;align-items:center;font-size:13px;padding:7px 0;border-top:1px solid #F1F5F9">
              <span style="flex:1;font-weight:500">${escapeHtml(it.name)}</span>
              <span style="width:40px;text-align:center;color:#64748B">${it.qty}</span>
              <span style="width:78px;text-align:right;font-weight:600">${settings.currency} ${money(it.price * it.qty)}</span>
            </div>`).join('')}
        </div>
      </div>
      <div style="padding:4px 20px 8px">
        ${(() => { const x = invExtraRows(inv); return x.rows.length ? [{ label: 'Subtotal', amt: x.sub }].concat(x.rows).map(r => `<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span style="color:#64748B">${escapeHtml(r.label)}</span><span style="font-weight:600">${r.amt < 0 ? '−' : ''}${settings.currency} ${money(Math.abs(r.amt))}</span></div>`).join('') : ''; })()}
        ${inv.docType === 'estimate' ? '' : `        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
          <span style="color:#64748B">Paid</span><span style="color:#10B981;font-weight:600">${settings.currency} ${money(paid)}</span>
        </div>
        ${due > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
          <span style="color:#64748B">Due</span><span style="color:#EF4444;font-weight:600">${settings.currency} ${money(due)}</span>
        </div>` : ''}`}
        <div style="display:flex;justify-content:space-between;align-items:center;background:linear-gradient(135deg,${TH.soft},${TH.softer});border-radius:12px;padding:12px 14px;margin-top:4px">
          <span style="font-weight:700;font-size:14px">Total</span>
          <span style="font-weight:800;font-size:18px;color:${TH.dark}">${settings.currency} ${money(inv.total)}</span>
        </div>
      </div>
      ${(settings.paymentQr && (!window.HisablyFreemium || HisablyFreemium.effectivePlan().limits.paymentQrOnInvoice)) ? `
      <div style="margin:8px 20px 16px;padding:12px;background:#F8FAFC;border-radius:12px;display:flex;align-items:center;gap:14px;border:1px solid #E2E8F0">
        <img src="${settings.paymentQr}" style="width:72px;height:72px;border-radius:8px;object-fit:contain;background:#fff" />
        <div>
          <div style="font-size:13px;font-weight:700;color:#0F172A">Scan to pay</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px">${escapeHtml(settings.paymentNote || 'Pay via JazzCash / EasyPaisa / Bank')}</div>
          ${settings.phone ? `<div style="font-size:11px;color:#64748B;margin-top:2px">${escapeHtml(settings.phone)}</div>` : ''}
        </div>
      </div>` : `<div style="text-align:center;font-size:11px;color:#94A3B8;padding:0 20px 16px">Thank you for your business!</div>`}
    `;
    document.body.appendChild(card);

    try {
      const canvas = await html2canvas(card, { scale: 2, backgroundColor: '#ffffff', logging: false });
      document.body.removeChild(card);
      canvas.toBlob(async (blob) => {
        if (!blob) { toast('Could not create image'); return; }
        const file = new File([blob], `Invoice-${inv.number}.png`, { type: 'image/png' });
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: `${docWord(inv)} ${inv.number}`, text: `${docWord(inv)} from ${settings.businessName}` });
            toast('Shared');
            return;
          } catch (err) {
            if (err.name === 'AbortError') return;
          }
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Invoice-${inv.number}.png`;
        a.click();
        URL.revokeObjectURL(url);
        toast('Image saved – share on WhatsApp');
      }, 'image/png');
    } catch (err) {
      if (card.parentNode) document.body.removeChild(card);
      console.error(err);
      toast('Image generation failed');
    }
  }

  function shareWhatsAppText(inv) {
    let text = `*${settings.businessName}*\n${docWord(inv)} ${inv.number}\nDate: ${formatDate(inv.date)}\nCustomer: ${inv.customerName || 'Walk-in'}\n\n`;
    inv.items.forEach(it => {
      text += `• ${it.name} × ${it.qty} = ${settings.currency} ${money(it.price * it.qty)}\n`;
    });
    const wx = invExtraRows(inv);
    if (wx.rows.length) {
      text += `\nSubtotal: ${settings.currency} ${money(wx.sub)}`;
      wx.rows.forEach(r => { text += `\n${r.label}: ${r.amt < 0 ? '-' : ''}${settings.currency} ${money(Math.abs(r.amt))}`; });
    }
    text += `\n*Total: ${settings.currency} ${money(inv.total)}*`;
    if (settings.phone) text += `\n\nContact: ${settings.phone}`;
    sendWhatsApp(inv.customerPhone, text);
  }

  // ---------- Receipt printing: 58 / 80 / 88 mm thermal, A4, Bluetooth ----------
  let printTarget = null;

  function brandingOn() { try { return !(settings.hideBranding && HisablyFreemium.hasFeature('themes')); } catch (e) { return true; } }
  function tplCtx() {
    return { brand: brandingOn(), settings, money, formatDate, amountInWords, products, qrAllowed: !window.HisablyFreemium || HisablyFreemium.effectivePlan().limits.paymentQrOnInvoice };
  }
  function tplOK() { if (!window.BillauraTemplates) { toast('Template module not loaded. Refresh the page.'); return false; } return true; }

  function receiptCtx() {
    return {
      brand: brandingOn(),
      settings,
      money,
      formatDate,
      qrAllowed: !window.HisablyFreemium || HisablyFreemium.effectivePlan().limits.paymentQrOnInvoice,
      amountInWords,
      print: {
        companyName: settings.printCompanyName !== false,
        logo: settings.printLogo !== false,
        address: settings.printAddress !== false,
        email: settings.printEmail !== false,
        phone: settings.printPhone !== false,
        taxId: !!settings.printTIN,
        received: settings.printReceivedAmount !== false,
        balance: settings.printBalanceAmount !== false,
        taxDetails: settings.printTaxDetails !== false,
        amountInWords: settings.printAmountInWords !== false,
        terms: settings.printTerms !== false,
        signature: settings.printSignature !== false,
        pageNumbers: settings.printPageNumbers !== false,
        paymentMode: !!settings.printPaymentMode,
        totalQty: settings.printTotalQty !== false,
        amountWordsFormat: settings.amountWordsFormat || 'indian'
      }
    };
  }

  function amountInWords(n, format) {
    n = Math.round(Math.abs(Number(n) || 0));
    if (!n) return 'Zero only';
    const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
    const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
    function under1000(x) {
      let s = '';
      if (x >= 100) { s += ones[Math.floor(x/100)] + ' Hundred '; x %= 100; }
      if (x >= 20) { s += tens[Math.floor(x/10)] + ' '; x %= 10; }
      if (x > 0) s += ones[x] + ' ';
      return s;
    }
    let s = '';
    if ((format || 'indian') === 'indian') {
      const cr = Math.floor(n / 10000000); n %= 10000000;
      const l = Math.floor(n / 100000); n %= 100000;
      const th = Math.floor(n / 1000); n %= 1000;
      if (cr) s += under1000(cr) + 'Crore ';
      if (l) s += under1000(l) + 'Lakh ';
      if (th) s += under1000(th) + 'Thousand ';
      s += under1000(n);
    } else {
      const m = Math.floor(n / 1000000); n %= 1000000;
      const th = Math.floor(n / 1000); n %= 1000;
      if (m) s += under1000(m) + 'Million ';
      if (th) s += under1000(th) + 'Thousand ';
      s += under1000(n);
    }
    return (s.trim() || 'Zero') + ' only';
  }

  function printInvoice(inv) {
    if (!window.HisablyReceipt) { toast('Print module not loaded. Refresh the page.'); return; }
    printTarget = inv;
    openPrintModal();
  }

  function openPrintModal() {
    const inv = printTarget;
    if (!inv) return;
    const R = HisablyReceipt, pr = R.getPrefs();
    const chip = (k) => `<button type="button" class="cat-chip ${pr.paper === k ? 'active' : ''}" data-action="rc-paper" data-paper="${k}">${R.PAPER[k].label}</button>`;
    const btOk = R.btSupported();
    $('#modalRoot').innerHTML = `
      <div class="modal-overlay" id="rcModal">
        <div class="modal-sheet">
          <div class="modal-handle"></div>
          <div class="modal-header">
            <h3 class="modal-title">Print ${escapeHtml(inv.number)}</h3>
            <button class="modal-close" data-action="close-modal"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
          <div class="form-label">Paper size</div>
          <div class="cat-chips" style="margin-bottom:12px">${['58', '80', '88', 'a4'].map(chip).join('')}</div>
          <div class="form-group">
            <label class="form-label">Receipt footer message</label>
            <input class="form-input" id="rcFooter" maxlength="80" placeholder="Thank you for your business!" value="${escapeHtml(pr.footer || '')}" />
          </div>
          ${pr.paper === 'a4' ? `<button class="btn btn-primary btn-block" data-action="print-a4" data-id="${inv.id}">Print / PDF with invoice theme</button>
          <button class="btn btn-secondary btn-block mt-8" data-action="open-theme-from-print">Change invoice theme</button>` : `<button class="btn btn-primary btn-block" data-action="rc-print">Print (browser / printer app)</button>`}
          <button class="btn btn-secondary btn-block mt-8" data-action="rc-save-image">Save receipt as image</button>

          <div class="section-header" style="margin-top:20px"><h2 class="section-title">Bluetooth printer (direct)</h2></div>
          ${btOk ? '' : `<p class="text-sm" style="color:var(--danger)">This browser has no Bluetooth printing. Use the Billaura Android app or open Billaura in <strong>Chrome on Android</strong>.</p>`}
          <div class="form-row">
            <div class="form-group"><label class="form-label">Printer</label>
              <select class="form-input" id="rcPrinter">
                <option value="mxw01" ${pr.printer === 'mxw01' ? 'selected' : ''}>MXW01 / mini fun printer</option>
                <option value="escpos" ${pr.printer === 'escpos' ? 'selected' : ''}>ESC/POS thermal (58/80/88)</option>
              </select></div>
            <div class="form-group"><label class="form-label">Darkness</label>
              <select class="form-input" id="rcDensity">
                ${['light', 'medium', 'dark'].map(d => `<option value="${d}" ${pr.density === d ? 'selected' : ''}>${d[0].toUpperCase() + d.slice(1)}</option>`).join('')}
              </select></div>
          </div>
          <div class="form-group" id="rcBitWrap" style="${pr.printer === 'mxw01' ? '' : 'display:none'}"><label class="form-label">If the print is garbled / mirrored, switch this</label>
            <select class="form-input" id="rcBit">
              <option value="lsb" ${pr.bitOrder === 'lsb' ? 'selected' : ''}>Standard (recommended)</option>
              <option value="msb" ${pr.bitOrder === 'msb' ? 'selected' : ''}>Alternate</option>
            </select>
            <label class="text-sm" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="rcFlip" ${pr.flip === false ? '' : 'checked'}> Rotate 180° (untick if the print comes out upside down)</label></div>
          <div class="flex gap-8">
            <button class="btn btn-primary" style="flex:1" data-action="rc-bt-print" ${btOk ? '' : 'disabled'}>Print via Bluetooth</button>
            <button class="btn btn-secondary" style="flex:1" data-action="rc-bt-test" ${btOk ? '' : 'disabled'}>Test print</button>
          </div>
          <div id="rcStatus" class="text-sm text-secondary mt-8"></div>
          <p class="text-sm text-secondary mt-8">Turn the printer on, keep it close, and choose it in the Bluetooth list that appears. Bluetooth printing is new: if it doesn’t work for your model, use <em>Save receipt as image</em> and print with the printer’s own app.</p>
        </div>
      </div>`;
    const R2 = HisablyReceipt;
    const bind = (id, key) => { const el = document.getElementById(id); if (el) el.addEventListener('change', () => { R2.setPrefs({ [key]: el.value }); if (id === 'rcPrinter') { const w = document.getElementById('rcBitWrap'); if (w) w.style.display = el.value === 'mxw01' ? '' : 'none'; R2.forgetDevice(); } }); };
    { const fl = document.getElementById('rcFlip'); if (fl) fl.addEventListener('change', () => HisablyReceipt.setPrefs({ flip: fl.checked })); }
    bind('rcPrinter', 'printer'); bind('rcDensity', 'density'); bind('rcBit', 'bitOrder');
    const f = document.getElementById('rcFooter');
    if (f) f.addEventListener('input', () => R2.setPrefs({ footer: f.value.trim() }));
  }

  function rcStatus(msg) { const el = document.getElementById('rcStatus'); if (el) el.textContent = msg; }

  function receiptDots() {
    const pr = HisablyReceipt.getPrefs();
    if (pr.printer === 'mxw01') return 384;           // MXW01 prints exactly 384 dots
    const P = HisablyReceipt.PAPER[pr.paper === 'a4' ? '80' : pr.paper] || HisablyReceipt.PAPER['80'];
    return P.dots;
  }

  async function rcBluetooth(test) {
    const inv = printTarget;
    if (!inv && !test) return;
    try {
      rcStatus('Rendering…');
      const dots = receiptDots();
      const cv = test ? HisablyReceipt.testCanvas(dots) : await HisablyReceipt.renderCanvas(inv, receiptCtx(), dots);
      await HisablyReceipt.bluetoothPrint(cv, {}, rcStatus);
      toast(test ? 'Test sent to printer' : 'Sent to printer');
    } catch (e) {
      if (e && e.name === 'NotFoundError') { rcStatus('No printer selected.'); return; }   // user closed the picker
      console.error(e);
      const raw = String((e && e.message) || e);
      rcStatus(/bluetooth|chrome|android/i.test(raw) && /needs|support/i.test(raw) ? raw : 'Could not talk to the printer. Make sure it is switched on, close to your phone and not connected to another app, then try again.');
    }
  }

  async function rcSaveImage() {
    const inv = printTarget;
    if (!inv) return;
    try {
      const pr = HisablyReceipt.getPrefs();
      if (pr.paper === 'a4' && window.BillauraTemplates) { await shareInvoiceImage(inv); return; }
      const dots = pr.paper === 'a4' ? 576 : (HisablyReceipt.PAPER[pr.paper] || HisablyReceipt.PAPER['80']).dots;
      const cv = await HisablyReceipt.renderCanvas(inv, receiptCtx(), dots);
      cv.toBlob(async (blob) => {
        if (!blob) { toast('Could not create image'); return; }
        const file = new File([blob], `Receipt-${inv.number}.png`, { type: 'image/png' });
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: `Receipt ${inv.number}` }); return; } catch (err) { if (err.name === 'AbortError') return; }
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = file.name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast('Receipt image saved');
      }, 'image/png');
    } catch (e) { console.error(e); toast('Could not create image'); }
  }

  async function rcBrowserPrint() {
    const inv = printTarget;
    if (!inv) return;
    try {
      const pr = HisablyReceipt.getPrefs();
      if (pr.paper === 'a4' && window.BillauraTemplates) { BillauraTemplates.printDoc(inv, tplCtx(), {}); return; }
      await HisablyReceipt.printHTML(HisablyReceipt.receiptHTML(inv, receiptCtx(), pr.paper));
    } catch (e) { console.error(e); toast('Could not open the print dialog'); }
  }

  // ---------- Categories ----------
  let productCat = '';            // '' = all, '__none__' = uncategorized, else category name

  function categoryList() {
    return [...new Set(products.map(p => (p.category || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
  }
  // "soap" and "Soap" must be one category
  function normalizeCategory(name) {
    const c = String(name || '').replace(/\s+/g, ' ').trim();
    if (!c) return '';
    const hit = categoryList().find(x => x.toLowerCase() === c.toLowerCase());
    return hit || c;
  }
  function categoryChipsHTML() {
    const cats = categoryList();
    if (!cats.length) return '';
    const hasNone = products.some(p => !(p.category || '').trim());
    const chip = (val, label, n) =>
      `<button type="button" class="cat-chip ${productCat === val ? 'active' : ''}" data-action="filter-cat" data-cat="${escapeHtml(val)}">${escapeHtml(label)} <span>${n}</span></button>`;
    return `<div class="cat-chips">
      ${chip('', 'All', products.length)}
      ${cats.map(c => chip(c, c, products.filter(p => (p.category || '').trim() === c).length)).join('')}
      ${hasNone ? chip('__none__', 'Uncategorized', products.filter(p => !(p.category || '').trim()).length) : ''}
    </div>`;
  }
  function productListHTML(query) {
    const q = (query || '').trim().toLowerCase();
    let list = products.filter(p => {
      const cat = (p.category || '').trim();
      if (productCat === '__none__' && cat) return false;
      if (productCat && productCat !== '__none__' && cat !== productCat) return false;
      return !q || p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q) || cat.toLowerCase().includes(q);
    });
    if (!list.length) return '<div class="text-center text-secondary" style="padding:32px 0">No products found</div>';
    list.sort((a, b) => (a.category || '~').localeCompare(b.category || '~') || a.name.localeCompare(b.name));
    if (productCat) return list.map(listProduct).join('');
    // "All": group under category headings
    let html = '', last = null;
    list.forEach(p => {
      const cat = (p.category || '').trim() || 'Uncategorized';
      if (cat !== last) {
        const n = list.filter(x => ((x.category || '').trim() || 'Uncategorized') === cat).length;
        html += `<div class="cat-heading">${escapeHtml(cat)} <span>${n}</span></div>`;
        last = cat;
      }
      html += listProduct(p);
    });
    return html;
  }

  // ---------- Bulk tools: CSV export / import, bulk price change ----------
  const CSV_COLUMNS = ['Name', 'Category', 'Selling Price', 'Cost Price', 'Stock', 'Unit', 'Low Stock Alert', 'Barcode', 'Notes'];

  function csvCell(v, isText) {
    let t = v == null ? '' : String(v);
    // stop spreadsheet formula injection in text cells
    if (isText && /^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  function downloadText(filename, text, mime) {
    const blob = new Blob(['﻿' + text], { type: (mime || 'text/csv') + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function exportProductsCSV(templateOnly) {
    const rows = [CSV_COLUMNS.join(',')];
    if (templateOnly) {
      rows.push(['Sample Soap', 'Grocery', 120, 90, 50, 'pcs', 5, '8964000123456', ''].map((v, i) => csvCell(v, [0, 1, 5, 7, 8].includes(i))).join(','));
    } else {
      [...products].sort((a, b) => (a.category || '~').localeCompare(b.category || '~') || a.name.localeCompare(b.name)).forEach(p => {
        rows.push([
          csvCell(p.name, true), csvCell(p.category || '', true), p.price, p.cost || 0, p.stock,
          csvCell(p.unit || 'pcs', true), p.lowStock ?? settings.lowStockDefault, csvCell(p.barcode || '', true), csvCell(p.notes || '', true)
        ].join(','));
      });
    }
    downloadText(templateOnly ? 'billaura-products-template.csv' : `billaura-products-${new Date().toISOString().slice(0, 10)}.csv`, rows.join('\r\n'));
    toast(templateOnly ? 'Template downloaded' : `${products.length} products exported`);
  }

  // RFC-4180 style parser (quotes, embedded commas/newlines, ; or tab delimiters)
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/)[0] || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let inQ = false;
    for (const ch of firstLine) { if (ch === '"') inQ = !inQ; else if (!inQ && counts[ch] != null) counts[ch]++; }
    const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(c => c.trim() !== '')) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some(c => c.trim() !== '')) rows.push(row);
    return rows;
  }

  const HEADER_ALIASES = {
    name: ['name', 'product', 'product name', 'item', 'item name', 'title'],
    category: ['category', 'group', 'type', 'department'],
    price: ['selling price', 'price', 'sale price', 'sell price', 'rate', 'mrp', 'retail price'],
    cost: ['cost price', 'cost', 'purchase price', 'buying price', 'buy price'],
    stock: ['stock', 'qty', 'quantity', 'opening stock', 'in stock'],
    unit: ['unit', 'uom'],
    lowStock: ['low stock alert', 'low stock', 'reorder level', 'min stock', 'alert'],
    barcode: ['barcode', 'sku', 'code', 'barcode / qr'],
    notes: ['notes', 'note', 'description', 'details']
  };
  function parseNum(v) {
    const t = String(v == null ? '' : v).replace(/[,\s]/g, '').replace(/^(rs\.?|pkr|inr|usd|\$|€|₹)/i, '');
    if (t === '') return null;
    const n = Number(t);
    return isFinite(n) ? n : NaN;
  }

  // Turn CSV text into a plan: what will be added / updated / skipped (nothing is changed yet)
  function planImport(text, opts) {
    const rows = parseCSV(text);
    if (rows.length < 2) return { error: 'The file is empty or has no product rows.' };
    const header = rows[0].map(h => h.trim().toLowerCase().replace(/[_*]+/g, ' ').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim());
    const col = {};
    Object.entries(HEADER_ALIASES).forEach(([key, names]) => {
      const i = header.findIndex(h => names.includes(h));
      if (i >= 0) col[key] = i;
    });
    if (col.name == null) return { error: 'Could not find a "Name" column. Download the template to see the expected columns.' };

    const get = (r, k) => (col[k] == null ? undefined : String(r[col[k]] == null ? '' : r[col[k]]).trim());
    const text0 = v => (v || '').replace(/^'(?=[=+\-@])/, '');
    const byBarcode = new Map(), byName = new Map();
    products.forEach(p => {
      if (p.barcode) byBarcode.set(p.barcode.toLowerCase(), p);
      byName.set(p.name.toLowerCase(), p);
    });

    const plan = { adds: [], updates: [], skipped: [], newCategories: new Set(), colsFound: Object.keys(col) };
    const seen = new Map();   // key in file -> index in adds/updates (last row wins)
    rows.slice(1).forEach((r, idx) => {
      const line = idx + 2;
      const name = text0(get(r, 'name'));
      if (!name) { plan.skipped.push(`Row ${line}: no name`); return; }
      const rec = { name };
      let bad = null;
      const numField = (k, label, int) => {
        const raw = get(r, k);
        if (raw === undefined || raw === '') return;
        const n = parseNum(raw);
        if (Number.isNaN(n) || n < 0) { bad = `${label} "${raw}" is not a valid number`; return; }
        rec[k] = int ? Math.round(n) : round2(n);
      };
      numField('price', 'Selling price'); numField('cost', 'Cost price'); numField('stock', 'Stock', true); numField('lowStock', 'Low stock', true);
      if (bad) { plan.skipped.push(`Row ${line} (${name}): ${bad}`); return; }
      const cat = get(r, 'category'); if (cat !== undefined && cat !== '') rec.category = normalizeCategoryWith(text0(cat), plan);
      const unit = get(r, 'unit'); if (unit) rec.unit = text0(unit);
      const bc = get(r, 'barcode'); if (bc) rec.barcode = text0(bc);
      const nt = get(r, 'notes'); if (nt) rec.notes = text0(nt);

      const existing = (rec.barcode && byBarcode.get(rec.barcode.toLowerCase())) || byName.get(name.toLowerCase());
      const key = existing ? 'id:' + existing.id : 'new:' + (rec.barcode || name).toLowerCase();
      if (seen.has(key)) {          // same product twice in the file: last row wins
        const target = seen.get(key);
        Object.assign(target.rec, rec);
        plan.skipped.push(`Row ${line} (${name}): duplicate in file – merged into the earlier row`);
        return;
      }
      const entry = existing ? { existing, rec } : { rec };
      seen.set(key, entry);
      (existing ? plan.updates : plan.adds).push(entry);
    });

    // Free-plan product limit applies to NEW products only
    if (window.HisablyFreemium) {
      const { limits, key } = HisablyFreemium.effectivePlan();
      const room = key === 'blocked' ? 0 : Math.max(0, limits.products - products.length);
      if (plan.adds.length > room) {
        const cut = plan.adds.length - room;
        plan.adds.slice(room).forEach(e => plan.skipped.push(`${e.rec.name}: not added – plan limit of ${limits.products} products`));
        plan.adds = plan.adds.slice(0, room);
        plan.limited = cut;
      }
    }
    plan.updateStock = !!(opts && opts.updateStock);
    return plan;
  }
  function normalizeCategoryWith(name, plan) {
    const c = normalizeCategory(name);
    if (c && !categoryList().some(x => x.toLowerCase() === c.toLowerCase())) {
      // keep one spelling for categories new in this file
      const hit = [...plan.newCategories].find(x => x.toLowerCase() === c.toLowerCase());
      if (hit) return hit;
      plan.newCategories.add(c);
    }
    return c;
  }

  function applyImport(plan) {
    const now = new Date().toISOString();
    let added = 0, updated = 0;
    plan.adds.forEach(({ rec }) => {
      const p = {
        id: uid(), name: rec.name, category: rec.category || '', price: rec.price || 0, cost: rec.cost || 0,
        stock: rec.stock || 0, unit: rec.unit || 'pcs', lowStock: rec.lowStock ?? settings.lowStockDefault,
        barcode: rec.barcode || '', notes: rec.notes || '', createdAt: now
      };
      products.push(p); added++;
      if (p.stock > 0) stockMovements.unshift({ id: uid(), productId: p.id, productName: p.name, type: 'in', qty: p.stock, date: now, note: 'Opening stock (import)' });
    });
    plan.updates.forEach(({ existing, rec }) => {
      ['category', 'price', 'cost', 'unit', 'lowStock', 'barcode', 'notes'].forEach(k => { if (rec[k] !== undefined) existing[k] = rec[k]; });
      if (plan.updateStock && rec.stock !== undefined && rec.stock !== existing.stock) {
        const diff = rec.stock - existing.stock;
        existing.stock = rec.stock;
        stockMovements.unshift({ id: uid(), productId: existing.id, productName: existing.name, type: diff > 0 ? 'in' : 'out', qty: Math.abs(diff), date: now, note: 'Import adjustment' });
      }
      updated++;
    });
    persist();
    return { added, updated };
  }

  let pendingImportText = null;

  function openBulkModal() {
    const undo = load('sb_price_undo_v1', null);
    $('#modalRoot').innerHTML = `
      <div class="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-handle"></div>
          <div class="modal-header">
            <h3 class="modal-title">Bulk tools</h3>
            <button class="modal-close" data-action="close-modal"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
          <div class="menu-list">
            <button class="menu-item" data-action="bulk-price"><div>Change prices in bulk<span class="menu-sub">+/− by % or by ${escapeHtml(settings.currency)} amount</span></div></button>
            <button class="menu-item" data-action="bulk-export"><div>Export products (CSV)<span class="menu-sub">Opens in Excel / Google Sheets</span></div></button>
            <button class="menu-item" data-action="bulk-import-pick"><div>Import products (CSV)<span class="menu-sub">Add new or update existing</span></div></button>
            <button class="menu-item" data-action="bulk-template"><div>Download blank CSV template</div></button>
            ${undo ? `<button class="menu-item" data-action="bulk-undo"><div>Undo last price change<span class="menu-sub">${escapeHtml(undo.label)} · ${formatDate(undo.at)}</span></div></button>` : ''}
          </div>
          <input type="file" id="bulkImportFile" accept=".csv,text/csv,text/plain" style="display:none" />
        </div>
      </div>`;
  }

  function openImportPreview(text) {
    pendingImportText = text;
    renderImportPreview(true);
  }
  function renderImportPreview(updateStock) {
    const plan = planImport(pendingImportText, { updateStock });
    if (plan.error) {
      $('#modalRoot').innerHTML = modalShell('Import products', `<p class="text-sm" style="color:var(--danger)">${escapeHtml(plan.error)}</p>
        <button class="btn btn-secondary btn-block mt-16" data-action="bulk-template">Download template</button>`);
      return;
    }
    const cats = [...plan.newCategories];
    const sample = [...plan.adds.slice(0, 3), ...plan.updates.slice(0, 3)].map(e => `<div class="text-sm">${e.existing ? 'Update' : 'Add'}: <strong>${escapeHtml(e.rec.name)}</strong>${e.rec.price != null ? ' · ' + settings.currency + ' ' + money(e.rec.price) : ''}</div>`).join('');
    $('#modalRoot').innerHTML = modalShell('Import preview', `
      <div class="stats-grid mb-16" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat-card"><div class="stat-label">New</div><div class="stat-value success">${plan.adds.length}</div></div>
        <div class="stat-card"><div class="stat-label">Updated</div><div class="stat-value primary">${plan.updates.length}</div></div>
        <div class="stat-card"><div class="stat-label">Skipped</div><div class="stat-value ${plan.skipped.length ? 'danger' : ''}">${plan.skipped.length}</div></div>
      </div>
      ${cats.length ? `<p class="text-sm text-secondary mb-8">New categories: ${cats.map(escapeHtml).join(', ')}</p>` : ''}
      ${sample}
      <label class="text-sm" style="display:flex;gap:8px;align-items:center;margin:14px 0">
        <input type="checkbox" id="importUpdateStock" ${updateStock ? 'checked' : ''} /> Also set stock quantity of existing products from the file
      </label>
      ${plan.skipped.length ? `<details class="mb-12"><summary class="text-sm" style="cursor:pointer">Why were ${plan.skipped.length} rows skipped?</summary>
        <div class="text-sm text-secondary" style="max-height:140px;overflow:auto;margin-top:6px">${plan.skipped.slice(0, 50).map(s => `<div>${escapeHtml(s)}</div>`).join('')}</div></details>` : ''}
      ${plan.limited ? `<div class="plan-banner">Free plan limit reached – ${plan.limited} new product(s) not added. <button type="button" class="linkish" data-action="open-plans">Upgrade</button></div>` : ''}
      <button class="btn btn-primary btn-block" data-action="bulk-import-confirm" ${plan.adds.length + plan.updates.length === 0 ? 'disabled' : ''}>Import ${plan.adds.length + plan.updates.length} product(s)</button>`);
  }
  function pickSheet(o) { BillauraUI.pick(o); }
  function modalShell(title, inner) {
    return `<div class="modal-overlay"><div class="modal-sheet"><div class="modal-handle"></div>
      <div class="modal-header"><h3 class="modal-title">${title}</h3>
      <button class="modal-close" data-action="close-modal"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
      ${inner}</div></div>`;
  }

  // ---- bulk price change ----
  function computeNewPrice(v, o) {
    let n = o.type === 'percent' ? v * (1 + o.sign * o.value / 100) : v + o.sign * o.value;
    n = Math.max(0, n);
    if (o.round > 0) n = Math.round(n / o.round) * o.round;
    return round2(n);
  }
  function bulkPriceOptions() {
    const f = $('#bulkPriceForm');
    if (!f) return null;
    const fd = new FormData(f);
    return {
      scope: fd.get('scope') || '', field: fd.get('field') || 'price',
      sign: fd.get('dir') === 'dec' ? -1 : 1, type: fd.get('type') || 'percent',
      value: Math.max(0, parseFloat(fd.get('value')) || 0), round: parseFloat(fd.get('round')) || 0
    };
  }
  function bulkTargets(scope) {
    if (scope === '') return products;
    if (scope === '__none__') return products.filter(p => !(p.category || '').trim());
    return products.filter(p => (p.category || '').trim() === scope);
  }
  function openBulkPriceModal() {
    const cats = categoryList();
    const opt = (v, l) => `<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`;
    $('#modalRoot').innerHTML = modalShell('Change prices in bulk', `
      <form id="bulkPriceForm">
        <div class="form-group"><label class="form-label">Apply to</label>
          <select class="form-input" name="scope">
            ${opt('', `All products (${products.length})`)}
            ${cats.map(c => opt(c, `${c} (${bulkTargets(c).length})`)).join('')}
            ${products.some(p => !(p.category || '').trim()) ? opt('__none__', `Uncategorized (${bulkTargets('__none__').length})`) : ''}
          </select></div>
        <div class="form-group"><label class="form-label">Which price</label>
          <select class="form-input" name="field">${opt('price', 'Selling price')}${opt('cost', 'Cost price')}${opt('both', 'Both selling and cost')}</select></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Action</label>
            <select class="form-input" name="dir">${opt('inc', 'Increase')}${opt('dec', 'Decrease')}</select></div>
          <div class="form-group"><label class="form-label">By</label>
            <select class="form-input" name="type">${opt('percent', 'Percentage (%)')}${opt('amount', `Amount (${settings.currency})`)}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label" id="bulkValueLabel">Percentage</label>
            <input class="form-input" type="number" name="value" min="0" step="0.01" placeholder="e.g. 10" /></div>
          <div class="form-group"><label class="form-label">Round to</label>
            <select class="form-input" name="round"><option value="0">No rounding</option><option value="1" selected>Nearest 1</option><option value="5">Nearest 5</option><option value="10">Nearest 10</option></select></div>
        </div>
        <div id="bulkPreview" class="card text-sm" style="padding:12px"></div>
        <button type="submit" class="btn btn-primary btn-block mt-16" id="bulkApplyBtn" disabled>Apply</button>
      </form>`);
    const f = $('#bulkPriceForm');
    f.addEventListener('input', updateBulkPreview);
    f.addEventListener('change', updateBulkPreview);
    f.addEventListener('submit', e => { e.preventDefault(); applyBulkPrice(); });
    updateBulkPreview();
  }
  function updateBulkPreview() {
    const o = bulkPriceOptions();
    if (!o) return;
    const lbl = $('#bulkValueLabel');
    if (lbl) lbl.textContent = o.type === 'percent' ? 'Percentage (%)' : `Amount (${settings.currency})`;
    const list = bulkTargets(o.scope);
    const fields = o.field === 'both' ? ['price', 'cost'] : [o.field];
    const prev = $('#bulkPreview'), btn = $('#bulkApplyBtn');
    if (!prev) return;
    if (!list.length) { prev.textContent = 'No products in this selection.'; btn.disabled = true; return; }
    if (!o.value) { prev.textContent = `${list.length} product(s) selected. Enter a value to see the preview.`; btn.disabled = true; return; }
    let changed = 0, zeroed = 0;
    list.forEach(p => fields.forEach(k => {
      const nv = computeNewPrice(p[k] || 0, o);
      if (nv !== (p[k] || 0)) changed++;
      if (nv === 0 && (p[k] || 0) > 0) zeroed++;
    }));
    const rows = list.slice(0, 4).map(p => fields.map(k => `<div>${escapeHtml(p.name)} <span class="text-secondary">(${k === 'price' ? 'sell' : 'cost'})</span>: ${money(p[k] || 0)} → <strong>${money(computeNewPrice(p[k] || 0, o))}</strong></div>`).join('')).join('');
    prev.innerHTML = `<div class="mb-8"><strong>${list.length}</strong> product(s) will change.</div>${rows}${list.length > 4 ? `<div class="text-secondary">…and ${list.length - 4} more</div>` : ''}${zeroed ? `<div style="color:var(--danger);margin-top:6px">${zeroed} price(s) would drop to 0.</div>` : ''}`;
    btn.disabled = false;
    btn.textContent = `${o.sign > 0 ? 'Increase' : 'Decrease'} ${o.value}${o.type === 'percent' ? '%' : ' ' + settings.currency} on ${list.length} product(s)`;
  }
  async function applyBulkPrice() {
    const o = bulkPriceOptions();
    if (!o || !o.value) return;
    const list = bulkTargets(o.scope);
    if (!list.length) return;
    if (!await askConfirm(`${o.sign > 0 ? 'Increase' : 'Decrease'} prices of ${list.length} product(s)? You can undo this from Bulk tools.`)) return;
    const fields = o.field === 'both' ? ['price', 'cost'] : [o.field];
    const snapshot = list.map(p => ({ id: p.id, price: p.price, cost: p.cost || 0 }));
    list.forEach(p => fields.forEach(k => { p[k] = computeNewPrice(p[k] || 0, o); }));
    save('sb_price_undo_v1', { at: new Date().toISOString(), label: `${o.sign > 0 ? '+' : '−'}${o.value}${o.type === 'percent' ? '%' : ' ' + settings.currency} · ${list.length} items`, items: snapshot });
    persist();
    closeModal();
    toast(`Prices updated for ${list.length} product(s)`);
    render();
  }
  async function undoBulkPrice() {
    const u = load('sb_price_undo_v1', null);
    if (!u) return;
    if (!await askConfirm(`Restore the previous prices of ${u.items.length} product(s)?`)) return;
    let n = 0;
    u.items.forEach(s => { const p = products.find(x => x.id === s.id); if (p) { p.price = s.price; p.cost = s.cost; n++; } });
    localStorage.removeItem('sb_price_undo_v1');
    persist();
    closeModal();
    toast(`Restored ${n} product(s)`);
    render();
  }

  // ---------- Barcode Scanner ----------

  function resizeImageFile(file, max, cb) {
    const reader = new FileReader();
    reader.onload = async () => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > max || h > max) {
          if (w > h) { h = Math.round(h * max / w); w = max; }
          else { w = Math.round(w * max / h); h = max; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function bindBrandFile(inputId, key, previewId, label) {
    const fileInput = document.getElementById(inputId);
    if (!fileInput) { toast('Open Business Profile first'); return; }
    fileInput.onchange = () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      resizeImageFile(file, key === 'signature' ? 400 : 512, (dataUrl) => {
        settings[key] = dataUrl;
        const prev = document.getElementById(previewId);
        if (prev) prev.innerHTML = `<img src="${dataUrl}" alt="${label}" />`;
        persist();
        toast(label + ' uploaded');
        // refresh profile view previews without full navigation loss
        if (currentView === 'business-profile') render();
      });
    };
    fileInput.click();
  }

  function startScanner(onResult) {
    const root = $('#scannerRoot');
    root.innerHTML = `
      <div class="scanner-header">
        <span style="font-weight:600">Scan Barcode / QR</span>
        <button class="scanner-close" data-action="stop-scanner">✕</button>
      </div>
      <div id="qr-reader" style="width:100%;height:100%;"></div>`;
    root.classList.add('active');

    scanner = new Html5Qrcode('qr-reader');
    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decoded) => {
        stopScanner();
        onResult(decoded);
      },
      () => {}
    ).catch(err => {
      toast('Camera not available or permission denied');
      stopScanner();
    });
  }

  function stopScanner() {
    if (scanner) {
      try { const r = scanner.stop(); if (r && r.catch) r.catch(() => {}); } catch (e) {}
      scanner = null;
    }
    const root = $('#scannerRoot');
    root.classList.remove('active');
    root.innerHTML = '';
  }

  // ============================================================
  //  Core modals (add / edit forms) + field editors
  // ============================================================
  const X_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  function closeModal() {
    const r = $('#modalRoot');
    if (r) r.innerHTML = '';
    editingId = null;
  }
  function numOrBlank(v) {
    const n = parseFloat(v);
    return isFinite(n) ? n : null;
  }
  // custom additional fields: settings.itemFields / partyFields / txnFields = [{label,on}]
  function activeFields(key) {
    return (settings[key] || []).filter(f => f && f.on && String(f.label || '').trim());
  }
  function extraFieldsHTML(key, values) {
    const list = activeFields(key);
    if (!list.length) return '';
    return `<div class="form-row" style="flex-wrap:wrap">${list.map((f, i) => `
      <div class="form-group" style="min-width:140px"><label class="form-label">${escapeHtml(f.label)}</label>
      <input class="form-input" data-extra="${escapeHtml(f.label)}" value="${escapeHtml((values || {})[f.label] || '')}" maxlength="60" /></div>`).join('')}</div>`;
  }
  function readExtra(form) {
    const out = {};
    form.querySelectorAll('[data-extra]').forEach(el => { const v = el.value.trim(); if (v) out[el.dataset.extra] = v; });
    return out;
  }

  const UNIT_LIST = [['BAGS', 'bag'], ['BOTTLES', 'btl'], ['BOX', 'box'], ['BUNDLES', 'bdl'], ['CANS', 'can'], ['CARTONS', 'ctn'], ['DOZENS', 'dz'], ['GRAMS', 'g'], ['KILOGRAMS', 'kg'], ['LITRE', 'ltr'], ['MILILITRE', 'ml'], ['METERS', 'm'], ['FEET', 'ft'], ['SQUARE FEET', 'sq ft'], ['NUMBERS', 'nos'], ['PACKS', 'pack'], ['PAIRS', 'pair'], ['PIECES', 'pcs'], ['ROLLS', 'roll'], ['SETS', 'set'], ['TABLETS', 'tab']];
  function unitName(code) { const u = UNIT_LIST.find(x => x[1] === code); return u ? u[0] : String(code || '').toUpperCase(); }
  let _pmDraft = null, _pmItem = null, _pmPick = null, _pmRemove = false;
  function pmCollect() {
    const f = $('#productForm'); if (!f) return _pmDraft || {};
    const fd = new FormData(f); const d = {};
    fd.forEach((v, k) => { d[k] = v; });
    d._tab = (document.querySelector('.pm-tab.on') || {}).dataset ? document.querySelector('.pm-tab.on').dataset.tab : 'price';
    d.unit = (_pmDraft && _pmDraft.unit) || d.unit; d.unit2 = _pmDraft && _pmDraft.unit2; d.unitRate = _pmDraft && _pmDraft.unitRate;
    return d;
  }
  function genItemCode() {
    for (let i = 0; i < 20; i++) { const c = String(Math.floor(1e10 + Math.random() * 9e10)); if (!products.some(x => x.barcode === c)) return c; }
    return String(Date.now()).slice(-11);
  }
  function openUnitSheet() {
    const d = _pmDraft || {};
    const opts = (sel, ph) => `<option value="">${ph}</option>` + UNIT_LIST.map(u => `<option value="${u[1]}" ${sel === u[1] ? 'selected' : ''}>${u[0]} ( ${u[1]} )</option>`).join('');
    $('#modalRoot').innerHTML = `<div class="modal-overlay"><div class="pm-page">
      <div class="pm-unit-head"><button class="pm-back" data-action="pm-unit-cancel">←</button><span>Add Item Unit</span></div>
      <div style="padding:18px 16px"><select class="form-select" id="unPri">${opts(d.unit || 'pcs', 'Primary Unit')}</select>
      <select class="form-select" id="unSec" style="margin-top:16px">${opts(d.unit2 || '', 'Secondary Unit')}</select>
      <div id="unConv"></div></div>
      <div class="pm-foot two"><button class="pm-cancel" data-action="pm-unit-cancel">Cancel</button><button class="pm-save blue" data-action="pm-unit-save">Save</button></div></div></div>`;
    const draw = () => {
      const pr = $('#unPri').value, sc = $('#unSec').value, box = $('#unConv');
      if (!pr || !sc || pr === sc) { box.innerHTML = ''; return; }
      box.innerHTML = `<div style="font-weight:700;margin:22px 0 10px">Select Conversion Rate</div>
        <div class="un-row">1 ${unitName(pr)} = <input id="unRate" type="number" inputmode="decimal" min="0" step="any" value="${d.unitRate || ''}" placeholder="0" /> ${unitName(sc)}</div>`;
    };
    $('#unPri').onchange = draw; $('#unSec').onchange = draw; draw();
  }
  function openProductModal(p, draft) {
    editingId = p ? p.id : null; _pmItem = p || null;
    const D = draft || {};
    _pmDraft = { unit: D.unit || (p ? p.unit : (settings.defaultUnit || 'pcs')) || 'pcs', unit2: D.unit2 !== undefined ? D.unit2 : (p ? p.unit2 : ''), unitRate: D.unitRate !== undefined ? D.unitRate : (p ? p.unitRate : '') };
    const v = (k, pv) => escapeHtml(D[k] !== undefined ? D[k] : (pv == null ? '' : pv));
    const cats = categoryList();
    const curCat = D.category !== undefined ? D.category : (p ? (p.category || '') : '');
    const tab = D._tab || 'price';
    const showBarcode = true;
    const conv = (_pmDraft.unit2 && _pmDraft.unitRate) ? `<div class="pm-conv">1 ${escapeHtml(_pmDraft.unit.toUpperCase())} = ${escapeHtml(_pmDraft.unitRate)} ${escapeHtml(_pmDraft.unit2.toUpperCase())}</div>` : '';
    const fl = (label, inner) => `<div class="pm-f"><span class="pm-fl">${label}</span>${inner}</div>`;
    const today = new Date().toISOString().slice(0, 10);
    $('#modalRoot').innerHTML = `<div class="modal-overlay"><div class="pm-page">
      <div class="pm-head"><button class="pm-back" data-action="close-modal" aria-label="Back">←</button><h2>${p ? 'Edit Item' : 'Add Item'}</h2></div>
      <form id="productForm" autocomplete="off" class="pm-scroll">
        <div class="pm-photo" id="pmPhotoRow"></div>
        ${fl('Item Name <i>*</i>', `<input name="name" required maxlength="80" value="${v('name', p && p.name)}" /><button type="button" class="pm-chip" data-action="pm-edit-unit">${p || D.unit || D.name ? 'Edit Unit' : 'Select Unit'}</button>`)}
        ${conv}
        ${showBarcode ? fl('Item Code / Barcode', `<input name="barcode" id="pmBarcode" maxlength="40" value="${v('barcode', p && p.barcode)}" /><button type="button" class="pm-chip" data-action="pm-assign-code">Assign Code</button><button type="button" class="pm-chip pm-scan" id="pmScan">Scan</button>`) : ''}
        ${settings.enableItemCategory !== false ? fl('Item Category', `<button type="button" class="ps-field" id="pmCatBtn"><span id="pmCatTxt">${escapeHtml(curCat || 'Select category')}</span><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button><select name="category" id="pmCat" style="display:none"><option value=""></option>${cats.map(c => `<option value="${escapeHtml(c)}" ${c === curCat ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}${curCat && !cats.includes(curCat) ? `<option selected>${escapeHtml(curCat)}</option>` : ''}<option value="__new">+ Add New Category</option></select>`) : ''}
        <div class="pm-tabs"><button type="button" class="pm-tab ${tab === 'price' ? 'on' : ''}" data-action="pm-tab" data-tab="price">Pricing</button><button type="button" class="pm-tab ${tab === 'stock' ? 'on' : ''}" data-action="pm-tab" data-tab="stock">Stock</button></div>
        <div class="pm-pane" id="pmPrice" ${tab === 'price' ? '' : 'hidden'}>
          <div class="pm-h">Sale Price</div>
          ${fl('Sale Price', `<input name="price" type="number" inputmode="decimal" min="0" step="any" value="${v('price', p && p.price)}" />`)}
          ${settings.enableWholesale ? fl('Wholesale Price', `<input name="wholesale" type="number" inputmode="decimal" min="0" step="any" value="${v('wholesale', p && p.wholesale)}" />`) : `<div class="pm-link" data-action="pm-wholesale">+ Add Wholesale Price</div>`}
          ${settings.enableDisplayPurchasePrice !== false ? `<div class="pm-h">Purchase Price</div>${fl('Purchase Price', `<input name="cost" type="number" inputmode="decimal" min="0" step="any" value="${v('cost', p && p.cost)}" />`)}` : ''}
          ${settings.enableItemTax ? fl('Item tax %', `<input name="taxRate" type="number" inputmode="decimal" min="0" step="any" value="${v('taxRate', p && p.taxRate)}" />`) : ''}
          ${settings.enableItemDiscount ? fl('Item discount %', `<input name="discount" type="number" inputmode="decimal" min="0" max="100" step="any" value="${v('discount', p && p.discount)}" />`) : ''}
          ${settings.enableItemDescription ? fl('Description', `<input name="desc" maxlength="120" value="${v('desc', p && p.desc)}" />`) : ''}
          ${extraFieldsHTML('itemFields', p && p.extra)}
        </div>
        <div class="pm-pane" id="pmStock" ${tab === 'stock' ? '' : 'hidden'}>
          ${settings.enableStock !== false ? `
          ${fl(p ? 'Current Stock' : 'Opening Stock', `<input name="stock" type="number" inputmode="decimal" step="any" value="${v('stock', p && p.stock)}" placeholder="Ex: 300" />`)}
          <div class="pm-two">${fl('As of Date', `<input name="stockDate" type="date" value="${v('stockDate', (p && p.stockDate) || today)}" max="${today}" />`)}${fl('At Price/Unit', `<input name="stockPrice" type="number" inputmode="decimal" min="0" step="any" value="${v('stockPrice', p && p.stockPrice)}" placeholder="Ex: 2,000" />`)}</div>
          <div class="pm-two">${fl('Min Stock Qty', `<input name="lowStock" type="number" inputmode="decimal" min="0" step="any" value="${v('lowStock', p && p.lowStock)}" placeholder="Ex: ${settings.lowStockDefault || 5}" />`)}${fl('Item Location', `<input name="location" maxlength="40" value="${v('location', p && p.location)}" />`)}</div>
          ${p ? `<div class="pm-f"><span class="pm-fl">Add stock now</span><input id="stockInQty" type="number" inputmode="decimal" min="0" placeholder="Quantity" /><button type="button" class="pm-chip" data-action="stock-in" data-id="${p.id}">Add</button></div>` : ''}` : '<div class="doc-empty">Stock tracking is switched off in Item Settings.</div>'}
          ${fl('Notes', `<input name="notes" maxlength="120" value="${v('notes', p && p.notes)}" />`)}
          ${p ? `<button type="button" class="btn btn-ghost btn-block mt-12" style="color:var(--danger)" data-action="delete-product">Delete item</button>` : ''}
        </div>
      </form>
      <button class="pm-save" id="pmSaveBtn">Save</button></div></div>`;
    const f = $('#productForm');
    _pmPick = null; _pmRemove = false;
    const drawPhoto = () => {
      const src = _pmPick ? _pmPick.dataUrl : (_pmRemove ? '' : (p ? photoSrc(p.id) : ''));
      $('#pmPhotoRow').innerHTML = `<button type="button" class="pm-ph-box" id="pmPhotoBtn" aria-label="Item photo">${src ? `<img src="${src}" alt="" />` : '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>'}</button>
        <div class="pm-ph-txt"><b>${src ? 'Item photo' : 'Add item photo'}</b><span>Shown in your store and item list</span>${src ? '<button type="button" class="pm-chip" id="pmPhotoDel" style="margin-top:6px;background:#FDE7EB;color:#C8102E">Remove</button>' : ''}</div>
        <input type="file" id="pmPhotoIn" accept="image/*" hidden />`;
      $('#pmPhotoBtn').onclick = () => $('#pmPhotoIn').click();
      const del = $('#pmPhotoDel'); if (del) del.onclick = () => { _pmPick = null; _pmRemove = true; drawPhoto(); };
      $('#pmPhotoIn').onchange = async e => {
        const file = e.target.files && e.target.files[0]; if (!file) return;
        try { _pmPick = await compressImage(file); _pmRemove = false; drawPhoto(); } catch (err) { toast(err.message || 'Could not use that photo'); }
      };
    };
    drawPhoto();
    const scan = $('#pmScan');
    if (scan) scan.onclick = () => startScanner(code => { const b = $('#pmBarcode'); if (b) b.value = code; });
    const cat = $('#pmCat');
    const catBtn = $('#pmCatBtn');
    if (cat && catBtn) catBtn.onclick = () => {
      const opts = Array.from(cat.options).map(o => o.value).filter(v => v && v !== '__new');
      pickSheet({ title: 'Select Category', options: opts, selected: cat.value, search: true, addNew: 'Add New Category', normalize: normalizeCategory, onPick: v => {
        if (!Array.from(cat.options).some(o => o.value === v)) { const o = document.createElement('option'); o.value = o.textContent = v; cat.insertBefore(o, cat.lastElementChild); }
        cat.value = v; $('#pmCatTxt').textContent = v; } });
    };
    if (cat) cat.setAttribute('data-noenh', '1');
    $('#pmSaveBtn').onclick = () => f.requestSubmit();
    f.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(f);
      const name = String(fd.get('name') || '').trim();
      if (!name) { toast('Enter the item name'); return; }
      const dup = products.find(x => x.name.trim().toLowerCase() === name.toLowerCase() && (!p || x.id !== p.id));
      if (dup) { toast('An item with this name already exists'); return; }
      const price = Math.max(0, numOrBlank(fd.get('price')) || 0);
      const catV = String(fd.get('category') || ''); 
      const rec = { name, price, unit: _pmDraft.unit || 'pcs', unit2: _pmDraft.unit2 || '', unitRate: Number(_pmDraft.unitRate) || 0, category: catV === '__new' ? '' : normalizeCategory(catV),
        notes: String(fd.get('notes') || '').trim(), extra: readExtra(f), location: String(fd.get('location') || '').trim(), stockDate: String(fd.get('stockDate') || '') };
      const sp = numOrBlank(fd.get('stockPrice')); if (sp != null) rec.stockPrice = sp;
      if (fd.has('cost')) rec.cost = Math.max(0, numOrBlank(fd.get('cost')) || 0); else if (!p) rec.cost = 0;
      if (fd.has('barcode')) rec.barcode = String(fd.get('barcode') || '').trim();
      if (fd.has('desc')) rec.desc = String(fd.get('desc') || '').trim();
      ['taxRate', 'discount', 'wholesale'].forEach(k => { if (fd.has(k)) { const n = numOrBlank(fd.get(k)); if (n == null) rec[k] = undefined; else rec[k] = n; } });
      if (rec.barcode) {
        const bd = products.find(x => (x.barcode || '').toLowerCase() === rec.barcode.toLowerCase() && (!p || x.id !== p.id));
        if (bd) { toast('Barcode already used by ' + bd.name); return; }
      }
      const stockVal = fd.has('stock') ? (numOrBlank(fd.get('stock')) || 0) : (p ? p.stock : 0);
      const low = fd.has('lowStock') ? numOrBlank(fd.get('lowStock')) : (p ? p.lowStock : null);
      const now = new Date().toISOString(); let savedId = p ? p.id : null;
      if (!p) {
        if (!enforceLimit('products', products.length)) return;
        const np = Object.assign({ id: uid(), stock: stockVal }, rec);
        if (low != null) np.lowStock = low;
        products.push(np); savedId = np.id;
        if (stockVal > 0) stockMovements.unshift({ id: uid(), productId: np.id, productName: np.name, type: 'in', qty: stockVal, date: now, note: 'Opening stock' });
        toast('Item added');
      } else {
        const diff = round2(stockVal - (p.stock || 0));
        if (diff !== 0) stockMovements.unshift({ id: uid(), productId: p.id, productName: name, type: diff > 0 ? 'in' : 'out', qty: Math.abs(diff), date: now, note: 'Stock edited' });
        Object.assign(p, rec, { stock: stockVal });
        if (low == null) delete p.lowStock; else p.lowStock = low;
        toast('Item updated');
      }
      persist();
      if (savedId && (_pmPick || _pmRemove)) savePhotoFor(savedId, _pmPick, _pmRemove);
      closeModal();
      render();
    });
  }

  function openCustomerModal(c) {
    editingId = c ? c.id : null;
    $('#modalRoot').innerHTML = modalShell(c ? 'Edit Party' : 'Add Party', `
      <form id="customerForm" autocomplete="off">
        <div class="form-group"><label class="form-label">Party name *</label>
          <input class="form-input" name="name" required maxlength="80" value="${escapeHtml(c ? c.name : '')}" /></div>
        ${settings.enableBillingName ? `<div class="form-group"><label class="form-label">Billing name</label>
          <input class="form-input" name="billingName" maxlength="80" value="${escapeHtml(c ? (c.billingName || '') : '')}" /></div>` : ''}
        <div class="form-group"><label class="form-label">Phone</label>
          <input class="form-input" name="phone" type="tel" inputmode="tel" maxlength="20" value="${escapeHtml(c ? (c.phone || '') : '')}" placeholder="03XX-XXXXXXX" /></div>
        <div class="form-group"><label class="form-label">Address</label>
          <input class="form-input" name="address" maxlength="160" value="${escapeHtml(c ? (c.address || '') : '')}" /></div>
        ${settings.enablePartyShipping ? `<div class="form-group"><label class="form-label">Shipping address</label>
          <input class="form-input" name="shipping" maxlength="160" value="${escapeHtml(c ? (c.shipping || '') : '')}" /></div>` : ''}
        ${settings.enablePartyTIN ? `<div class="form-group"><label class="form-label">TIN / NTN</label>
          <input class="form-input" name="tin" maxlength="30" value="${escapeHtml(c ? (c.tin || '') : '')}" /></div>` : ''}
        ${settings.enablePartyGrouping ? `<div class="form-group"><label class="form-label">Party group</label>
          <input class="form-input" name="group" maxlength="40" value="${escapeHtml(c ? (c.group || '') : '')}" placeholder="e.g. Retail, Wholesale" /></div>` : ''}
        ${extraFieldsHTML('partyFields', c && c.extra)}
        <div class="form-group"><label class="form-label">Notes</label>
          <input class="form-input" name="notes" maxlength="160" value="${escapeHtml(c ? (c.notes || '') : '')}" /></div>
        <button type="submit" class="btn btn-primary btn-block">${c ? 'Save changes' : 'Save party'}</button>
      </form>
      ${c ? `<button type="button" class="btn btn-ghost btn-block mt-12" style="color:var(--danger)" data-action="delete-customer">Delete party</button>` : ''}`);
    const f = $('#customerForm');
    f.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(f);
      const name = String(fd.get('name') || '').trim();
      if (!name) { toast('Enter the party name'); return; }
      const dup = customers.find(x => x.name.trim().toLowerCase() === name.toLowerCase() && (!c || x.id !== c.id));
      if (dup) { toast('A party with this name already exists'); return; }
      const rec = { name, phone: String(fd.get('phone') || '').trim(), address: String(fd.get('address') || '').trim(), notes: String(fd.get('notes') || '').trim(), extra: readExtra(f) };
      ['billingName', 'shipping', 'tin', 'group'].forEach(k => { if (fd.has(k)) rec[k] = String(fd.get(k) || '').trim(); });
      if (c) {
        // keep old invoices attached when the name changes
        const oldName = c.name;
        Object.assign(c, rec);
        if (oldName !== name) invoices.forEach(i => { if (i.customerId === c.id) i.customerName = name; });
        toast('Party updated');
      } else {
        if (!enforceLimit('customers', customers.length)) return;
        customers.push(Object.assign({ id: uid() }, rec));
        toast('Party added');
      }
      persist(); closeModal(); render();
    });
  }

  function openSupplierModal(s) {
    editingId = s ? s.id : null;
    $('#modalRoot').innerHTML = modalShell(s ? 'Edit Supplier' : 'Add Supplier', `
      <form id="supplierForm" autocomplete="off">
        <div class="form-group"><label class="form-label">Supplier name *</label>
          <input class="form-input" name="name" required maxlength="80" value="${escapeHtml(s ? s.name : '')}" /></div>
        <div class="form-group"><label class="form-label">Phone</label>
          <input class="form-input" name="phone" type="tel" inputmode="tel" maxlength="20" value="${escapeHtml(s ? (s.phone || '') : '')}" /></div>
        <div class="form-group"><label class="form-label">Address</label>
          <input class="form-input" name="address" maxlength="160" value="${escapeHtml(s ? (s.address || '') : '')}" /></div>
        <div class="form-group"><label class="form-label">Notes</label>
          <input class="form-input" name="notes" maxlength="160" value="${escapeHtml(s ? (s.notes || '') : '')}" /></div>
        <button type="submit" class="btn btn-primary btn-block">${s ? 'Save changes' : 'Save supplier'}</button>
      </form>
      ${s ? `<button type="button" class="btn btn-ghost btn-block mt-12" style="color:var(--danger)" data-action="delete-supplier">Delete supplier</button>` : ''}`);
    $('#supplierForm').addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const name = String(fd.get('name') || '').trim();
      if (!name) { toast('Enter the supplier name'); return; }
      const dup = suppliers.find(x => x.name.trim().toLowerCase() === name.toLowerCase() && (!s || x.id !== s.id));
      if (dup) { toast('A supplier with this name already exists'); return; }
      const rec = { name, phone: String(fd.get('phone') || '').trim(), address: String(fd.get('address') || '').trim(), notes: String(fd.get('notes') || '').trim() };
      if (s) {
        const oldName = s.name;
        Object.assign(s, rec);
        if (oldName !== name) purchases.forEach(p => { if (p.supplierId === s.id) p.supplierName = name; });
        toast('Supplier updated');
      } else {
        if (!enforceLimit('suppliers', suppliers.length)) return;
        suppliers.push(Object.assign({ id: uid() }, rec));
        toast('Supplier added');
      }
      persist(); closeModal(); render();
    });
  }

  const DEFAULT_EXPENSE_CATS = ['Manufacturing Expense', 'Petrol', 'Rent', 'Salary', 'Tea', 'Transport'];
  function expenseCategories() {
    const extra = (settings.expenseCats || []);
    const used = expenses.map(e => e.category).filter(Boolean);
    return [...new Set([...DEFAULT_EXPENSE_CATS, ...extra, ...used])];
  }
  function openExpenseModal(ex, presetCat) {
    editingId = ex ? ex.id : null;
    const today = new Date().toISOString().slice(0, 10);
    const dval = ex ? dayKey(ex.date) : today;
    const cats = expenseCategories();
    $('#modalRoot').innerHTML = modalShell(ex ? 'Edit Expense' : 'Add Expense', `
      <form id="expenseForm" autocomplete="off">
        <div class="form-group"><label class="form-label">Expense category *</label>
          <input class="form-input" name="category" list="expCatList" required maxlength="40" value="${escapeHtml(ex ? (ex.category || '') : (presetCat || ''))}" placeholder="e.g. Rent, Petrol" />
          <datalist id="expCatList">${cats.map(c => `<option value="${escapeHtml(c)}">`).join('')}</datalist></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Amount (${escapeHtml(settings.currency)}) *</label>
            <input class="form-input" name="amount" type="number" inputmode="decimal" min="0" step="any" required value="${ex ? ex.amount : ''}" /></div>
          <div class="form-group"><label class="form-label">Date</label>
            <input class="form-input" name="date" type="date" max="${today}" value="${dval}" /></div>
        </div>
        <div class="form-group"><label class="form-label">Item / title</label>
          <input class="form-input" name="title" maxlength="60" value="${escapeHtml(ex ? (ex.title || '') : '')}" placeholder="Optional, e.g. Office tea" /></div>
        <div class="form-group"><label class="form-label">Paid from</label>
          <div class="chip-row" id="exMode">${['Cash', 'Bank', 'Online', 'Cheque'].map(m => `<button type="button" class="cat-chip${((ex && ex.mode) || 'Cash') === m ? ' active' : ''}" data-mode="${m}">${m}</button>`).join('')}</div></div>
        <div class="form-group"><label class="form-label">Note</label>
          <input class="form-input" name="note" maxlength="120" value="${escapeHtml(ex ? (ex.note || '') : '')}" /></div>
        <button type="submit" class="btn btn-primary btn-block">${ex ? 'Save changes' : 'Save expense'}</button>
      </form>
      ${ex ? `<button type="button" class="btn btn-ghost btn-block mt-12" style="color:var(--danger)" data-action="delete-expense">Delete expense</button>` : ''}`);
    let mode = (ex && ex.mode) || 'Cash';
    document.querySelectorAll('#exMode .cat-chip').forEach(b => b.addEventListener('click', () => {
      mode = b.dataset.mode; document.querySelectorAll('#exMode .cat-chip').forEach(x => x.classList.toggle('active', x === b));
    }));
    $('#expenseForm').addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const category = String(fd.get('category') || '').trim();
      const amount = round2(numOrBlank(fd.get('amount')) || 0);
      if (!category) { toast('Choose a category'); return; }
      if (amount <= 0) { toast('Enter the amount'); return; }
      const d = fd.get('date');
      const dateIso = (d && d !== today) ? new Date(d + 'T12:00:00').toISOString() : (ex && dayKey(ex.date) === d ? ex.date : new Date().toISOString());
      const rec = { category, amount, title: String(fd.get('title') || '').trim(), note: String(fd.get('note') || '').trim(), mode, date: dateIso };
      if (ex) { Object.assign(ex, rec); toast('Expense updated'); }
      else { const ne = Object.assign({ id: uid() }, rec); expenses.unshift(ne); try { if (window.BillauraExt && BillauraExt.stampExpense) BillauraExt.stampExpense(ne); } catch (e) {} toast('Expense added'); }
      if (!DEFAULT_EXPENSE_CATS.includes(category)) {
        settings.expenseCats = settings.expenseCats || [];
        if (!settings.expenseCats.includes(category)) settings.expenseCats.push(category);
      }
      persist(); closeModal(); render();
    });
  }

  // ---- "Additional fields" editors (transaction / party / item) ----
  function openFieldsModal(title, key, max) {
    const cur = settings[key] || [];
    const rows = Array.from({ length: max }, (_, i) => cur[i] || { label: '', on: false });
    $('#modalRoot').innerHTML = modalShell(title, `
      <p class="text-sm text-secondary mb-12">Add your own fields. Turn a field on to show it on the form${key === 'txnFields' ? ' and print it on the invoice' : ''}.</p>
      <form id="fieldsForm">
        ${rows.map((r, i) => `<div class="field-edit-row">
          <input class="form-input" data-fl="${i}" maxlength="24" placeholder="Field ${i + 1} name" value="${escapeHtml(r.label || '')}" />
          <label class="toggle"><input type="checkbox" data-fo="${i}" ${r.on ? 'checked' : ''} /><span class="toggle-track"></span></label>
        </div>`).join('')}
        <button type="submit" class="btn btn-primary btn-block mt-16">Save</button>
      </form>`);
    $('#fieldsForm').addEventListener('submit', e => {
      e.preventDefault();
      settings[key] = rows.map((_, i) => ({ label: ($(`[data-fl="${i}"]`).value || '').trim(), on: $(`[data-fo="${i}"]`).checked }));
      persist(); closeModal(); toast('Saved'); render();
    });
  }
  function openTermsModal() {
    $('#modalRoot').innerHTML = modalShell('Terms & Conditions', `
      <p class="text-sm text-secondary mb-12">Printed at the bottom of invoices.</p>
      <form id="termsForm">
        <textarea class="form-input" id="termsText" rows="6" maxlength="600" style="height:auto">${escapeHtml(settings.termsText || 'Thank you for doing business with us.')}</textarea>
        <button type="submit" class="btn btn-primary btn-block mt-16">Save</button>
      </form>`);
    $('#termsForm').addEventListener('submit', e => {
      e.preventDefault();
      settings.termsText = $('#termsText').value.trim();
      persist(); closeModal(); toast('Terms saved');
    });
  }
  function openDueDatesModal() {
    $('#modalRoot').innerHTML = modalShell('Due Dates & Payment Terms', `
      <form id="dueForm">
        <div class="list-row" style="padding:8px 0"><div class="list-row-left"><div class="list-row-label">Auto-fill due date on credit sales</div></div>
          <label class="toggle"><input type="checkbox" id="dueOn" ${settings.enableDueDates ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
        <div class="form-group mt-12"><label class="form-label">Default payment term (days)</label>
          <input class="form-input" id="dueDays" type="number" inputmode="numeric" min="0" max="365" value="${settings.dueDays != null ? settings.dueDays : 15}" /></div>
        <div class="chip-row mb-8">${[7, 15, 30, 45, 60].map(d => `<button type="button" class="cat-chip" data-days="${d}">Net ${d}</button>`).join('')}</div>
        <button type="submit" class="btn btn-primary btn-block mt-16">Save</button>
      </form>`);
    document.querySelectorAll('[data-days]').forEach(b => b.addEventListener('click', () => { $('#dueDays').value = b.dataset.days; $('#dueOn').checked = true; }));
    $('#dueForm').addEventListener('submit', e => {
      e.preventDefault();
      settings.enableDueDates = $('#dueOn').checked;
      settings.dueDays = Math.max(0, parseInt($('#dueDays').value, 10) || 0);
      persist(); closeModal(); toast('Saved');
    });
  }

  // ============================================================
  //  screens: Home, Dashboard, Menu, Expenses, Cash, utilities
  // ============================================================
  const IC = {
    return: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    home: '<path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    store: '<path d="M3 9l1.5-5h15L21 9"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 12v8h14v-8"/><path d="M10 20v-5h4v5"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M12 8v6M9 11h6"/>',
    report: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v2h6V3M9 12h6M9 16h4"/>',
    chevR: '<path d="M9 6l6 6-6 6"/>', chevD: '<path d="M6 9l6 6 6-6"/>',
    print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/>',
    share: '<path d="M14 4l7 6-7 6v-4c-6 0-9 2-11 6 1-7 4-11 11-12z"/>',
    dots: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
    bank: '<path d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18"/>',
    book: '<path d="M12 6c-2-1.5-5-2-9-2v14c4 0 7 .5 9 2 2-1.5 5-2 9-2V4c-4 0-7 .5-9 2zM12 6v14"/>',
    docs: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    pl: '<circle cx="12" cy="12" r="9"/><path d="M9 8v8M9 8l-2 2M15 16V8M15 16l2-2"/>',
    cash: '<rect x="2" y="7" width="17" height="11" rx="2"/><circle cx="10.5" cy="12.5" r="2.5"/><path d="M6 4h14a2 2 0 0 1 2 2v9"/>',
    cheque: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h5"/>',
    loan: '<circle cx="12" cy="12" r="9"/><path d="M9 9h.01M15 15h.01M15 9l-6 6"/>',
    sync: '<path d="M21 12a9 9 0 0 0-15-6.7L3 8M3 3v5h5M3 12a9 9 0 0 0 15 6.7L21 16M21 21v-5h-5"/>',
    company: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
    backup: '<ellipse cx="11" cy="6" rx="7" ry="3"/><path d="M4 6v6c0 1.7 3 3 7 3M4 12v6c0 1.7 3 3 7 3M18 13v6M15 16l3-3 3 3"/>',
    inbox: '<path d="M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
    sale: '<ellipse cx="9" cy="6" rx="6" ry="3"/><path d="M3 6v5c0 1.7 2.7 3 6 3M3 11v5c0 1.7 2.7 3 6 3M21 13c0 1.7-2.7 3-6 3s-6-1.3-6-3 2.7-3 6-3 6 1.3 6 3zM9 16v4c0 1.7 2.7 3 6 3"/>',
    cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h8a2 2 0 0 0 2-1.6L21 7H6"/>',
    wallet: '<path d="M4 7a2 2 0 0 1 2-2h12v4M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="14.5" r="1"/>',
    crown: '<path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" fill="currentColor"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2.5.6 4 2.4 4 6"/>',
    calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h2M14 11h2M8 15h2M14 15h2M8 19h2M14 19h2"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 11v6M14 11v6"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    barcode: '<path d="M3 5v14M7 5v14M10 5v14M14 5v14M17 5v14M21 5v14"/>',
    box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3.3 7.5L12 12l8.7-4.5M12 22V12"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    verify: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5L15.5 10"/>',
    desktop: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    whatsapp: '<path d="M3 21l1.6-5A9 9 0 1 1 8 19.4z"/><path d="M9 9c0 3 3 6 6 6l1.5-1.5-2-1-1 .7c-1-.4-2-1.4-2.4-2.4l.7-1-1-2z"/>'
  };
  function ico(n, cls) { return `<svg class="${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${IC[n] || ''}</svg>`; }
  const cur$ = () => settings.currency || 'Rs';
  const fmtAmt = n => cur$() + ' ' + (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let homeTab = 'txn', homeQuery = '';
  // ---- Trash (Recycle Bin) ----
  function trashPush(kind, obj) {
    const t = load('sb_recycle_v1', []);
    t.unshift({ id: uid(), kind, obj, at: new Date().toISOString() });
    save('sb_recycle_v1', t.slice(0, 200));
  }
  // ---- HOME ----
  function allTxns() {
    const list = invoices.map(i => ({ kind: i.docType === 'return' ? 'return' : (i.docType === 'estimate' ? 'estimate' : 'sale'), doc: i, date: i.date, name: i.customerName || 'Walk-in Customer', no: i.number, total: i.total || 0, paid: i.paidAmount || 0 }));
    purchases.forEach(p => list.push({ kind: 'purchase', doc: p, date: p.date, name: p.supplierName, no: p.number, total: p.total || 0, paid: p.paidAmount || 0 }));
    return list.sort((a, b) => new Date(b.date) - new Date(a.date));
  }
  function viewHome() {
    const q = homeQuery.trim().toLowerCase();
    const tabs = `<div class="vy-tabs"><button class="vy-tab ${homeTab === 'txn' ? 'active' : ''}" data-action="home-tab" data-tab="txn">Activity</button><button class="vy-tab ${homeTab === 'party' ? 'active' : ''}" data-action="home-tab" data-tab="party">Parties</button></div>`;
    const ql = (ic, label, attr, red) => `<button class="ql" ${attr}><div class="ql-ic ${red ? 'red' : ''}">${ico(ic)}</div><span>${label}</span></button>`;
    const quick = `<div class="sc-wrap"><div class="quick-links">
      ${ql('receipt', 'New Entry', 'data-action="sheet-add-txn"', true)}${can('reports') ? ql('report', 'Sales Report', 'data-view="sale-report"') : ''}${can('settings') ? ql('gear', 'Bill Settings', 'data-view="txn-settings"') : ''}${ql('chevR', 'More', 'data-action="sheet-more"')}</div></div>`;
    let body = '';
    if (homeTab === 'txn') {
      const list = allTxns().filter(t => !q || t.name.toLowerCase().includes(q) || String(t.no).toLowerCase().includes(q)).slice(0, 60);
      body = list.length ? list.map(t => {
        const bal = Math.max(0, t.total - t.paid);
        const tag = { sale: 'SALE', return: 'SALE RETURN', estimate: 'ESTIMATE', purchase: 'PURCHASE' }[t.kind];
        const act = t.kind === 'purchase' ? 'view-purchase' : 'view-invoice';
        const isInv = t.kind !== 'purchase';
        return `<div class="vy-txn" data-action="${act}" data-id="${t.doc.id}">
          <div class="vy-txn-top"><div><div class="vy-txn-name">${escapeHtml(t.name)}</div><span class="vy-tag ${t.kind}">${tag}</span></div>
            <div class="vy-txn-no">#${escapeHtml(String(t.no).replace(/^[A-Za-z]+-/, ''))}<br>${new Date(t.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}, ${String(new Date(t.date).getFullYear()).slice(2)}</div></div>
          <div class="vy-txn-bottom"><div><div class="lbl">Total</div><div class="val">${fmtAmt(t.total)}</div></div>
            ${(() => { const isPur = t.kind === 'purchase', isRet = t.kind === 'return'; const adv = (t.kind === 'sale') ? Math.max(0, t.paid - t.total) : 0; if (adv > 0.001) return `<div><div class="lbl" style="color:#E11D48">To pay (credit)</div><div class="val" style="color:#E11D48">${fmtAmt(adv)}</div></div>`; if (t.kind === 'estimate' || bal <= 0.001) return `<div><div class="lbl">Balance</div><div class="val">${fmtAmt(0)}</div></div>`; const pay = isPur || isRet; return `<div><div class="lbl" style="color:${pay ? '#E11D48' : '#0E9F6E'}">${pay ? 'To pay' : 'To collect'}</div><div class="val" style="color:${pay ? '#E11D48' : '#0E9F6E'}">${fmtAmt(bal)}</div></div>`; })()}
            ${isInv ? `<div class="vy-txn-actions"><button data-action="print-invoice" data-id="${t.doc.id}" aria-label="Print">${ico('print')}</button><button data-action="share-txn" data-id="${t.doc.id}" aria-label="Share">${ico('share')}</button><button data-action="txn-more" data-id="${t.doc.id}" aria-label="More">${ico('dots')}</button></div>` : ''}</div></div>`;
      }).join('') : `<div class="art-empty">${ico('receipt')}<div>No transactions yet.<br>Tap <b>Add New Sale</b> to create your first invoice.</div></div>`;
    } else {
      const parties = [...customers.map(c => ({ c, type: 'c' })), ...suppliers.map(s => ({ c: s, type: 's' }))].filter(p => !q || p.c.name.toLowerCase().includes(q));
      body = parties.length ? `<div class="vy-card" style="padding:0 14px">${parties.sort((a, b) => a.c.name.localeCompare(b.c.name)).map(p => {
        let amt = 0, get = true;
        if (p.type === 'c') { const b = customerBalance(p.c.id, p.c.name, p.c.phone); amt = b.due || b.credit; get = b.due > 0 || !b.credit; }
        else { const b = supplierBalance(p.c); amt = b.due; get = false; }
        return `<div class="m-row" data-action="${p.type === 'c' ? 'view-customer' : 'view-supplier'}" data-id="${p.c.id}"><div class="grow">${escapeHtml(p.c.name)}<small>${p.type === 'c' ? 'Customer' : 'Supplier'}${p.c.phone ? ' · ' + escapeHtml(p.c.phone) : ''}</small></div><b style="color:${amt ? (get ? '#13B97A' : '#EF1A3C') : '#8F95A8'}">${amt ? fmtAmt(amt) : '—'}</b></div>`;
      }).join('')}</div>` : `<div class="art-empty">${ico('users')}<div>No parties yet.</div><button class="btn btn-outline" data-action="add-customer">+ Add Party</button></div>`;
    }
    return `<div class="fade-in" style="padding-bottom:90px">${tabs}
      <div style="height:12px"></div>${homeAlerts()}${quick}
      <div class="vy-search"><div class="search-wrap" style="margin:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="search" class="search-input" id="homeSearch" placeholder="Search ${homeTab === 'txn' ? 'transactions' : 'parties'}…" value="${escapeHtml(homeQuery)}"/></div></div>
      ${body}</div>
      <button class="fab-pill" data-view="create-invoice">${ico('plus')} Add New Sale</button>`;
  }

  // ---- bottom sheets ----
  function sheet(inner, title) {
    $('#modalRoot').innerHTML = `<div class="modal-overlay"><div class="modal-sheet"><div class="modal-handle"></div>
      <div class="modal-header" style="margin:0"><h3 class="sheet-title" style="border:0;padding:0">${title}</h3><button class="modal-close" data-action="close-modal">${X_ICON}</button></div>${inner}</div></div>`;
  }
  function attrAllowed(attr) {
    if (!isStaff()) return true;
    let m = /data-view="([^"]+)"/.exec(attr || ''), need;
    if (m) need = viewPerm(m[1], m[1] === 'create-invoice' ? 'sale' : undefined);
    else if ((m = /data-action="([^"]+)"/.exec(attr || ''))) need = m[1] === 'sheet-more' ? null : actionPerm(m[1]);
    return !need || can(need);
  }
  function sheetItem(ic, label, attr, crown) { if (!attrAllowed(attr)) return ''; return `<button class="ql" ${attr}><div class="ql-ic">${ico(ic)}${crown ? `<span class="crown">${ico('crown')}</span>` : ''}</div><span>${label}</span></button>`; }
  function openAddTxnSheet() {
    sheet(`<div class="sheet-grid">${sheetItem('sale', 'Sale', 'data-view="create-invoice"')}${sheetItem('cart', 'Purchase', 'data-action="new-purchase"')}
      ${sheetItem('cash', 'Payment-In', 'data-action="pay-in"')}${sheetItem('wallet', 'Payment-Out', 'data-action="pay-out"')}
      ${sheetItem('docs', 'Sale Return', 'data-action="new-return"')}${sheetItem('report', 'Estimate', 'data-action="new-estimate"')}
      ${sheetItem('wallet', 'Expense', 'data-action="add-expense"')}${sheetItem('chart', 'Other Income', 'data-view="other-income"')}${sheetItem('box', 'Stock Adjust', 'data-view="stock-adjust"')}</div>`, 'Add Transaction');
  }
  function openMoreSheet() {
    sheet(`<div class="sheet-grid">${sheetItem('bank', 'Bank Accounts', 'data-view="banks"')}${sheetItem('book', 'Day Book', 'data-view="daybook-detail"')}${sheetItem('docs', 'All Entries Report', 'data-view="invoices"')}
      ${sheetItem('pl', 'Profit & Loss', 'data-view="profit-loss"')}${sheetItem('report', 'Balance Sheet', 'data-view="balance-sheet"')}${sheetItem('pl', 'Billwise PnL', 'data-view="bill-pnl"')}
      ${sheetItem('print', 'Print Settings', 'data-view="print-settings"')}
      ${sheetItem('whatsapp', 'Daily Summary', 'data-action="send-daily-summary"')}${sheetItem('docs', 'Barcode Labels', 'data-view="barcode-gen"')}${sheetItem('bell', 'Reminders', 'data-view="payment-reminders"')}</div>`, 'More Options');
  }
  function openTxnMore(inv) {
    const isSale = (inv.docType || 'sale') === 'sale';
    const due = Math.max(0, (inv.total || 0) - (inv.paidAmount || 0));
    const b = (a, l) => `<button data-action="${a}" data-id="${inv.id}">${l}</button>`;
    sheet(`<div class="sheet-list">${b('duplicate-invoice', 'Duplicate')}${isSale && due > 0 ? b('quick-receive', 'Receive Payment') : ''}${isSale ? b('return-from-invoice', 'Return') : ''}${b('delivery-note', 'Delivery Note')}${b('pdf-invoice', 'Download PDF')}${b('download-image', 'Download Image')}${b('view-invoice', 'Open / Edit payments')}${b('delete-invoice', '<span style="color:#EF1A3C">Delete</span>')}</div>`, 'More Options');
  }
  function openShareSheet(inv) {
    const b = (a, ic, l) => `<button class="ql" data-action="${a}" data-id="${inv.id}"><div class="ql-ic" style="background:#EEF3FA">${ico(ic)}</div><span>${l}</span></button>`;
    sheet(`<div class="sheet-grid">${b('share-whatsapp-text', 'whatsapp', 'WhatsApp')}${b('share-sms', 'docs', 'SMS')}${b('share-image', 'share', 'Share image')}${b('pdf-invoice', 'docs', 'Download PDF')}${b('download-image', 'docs', 'Download image')}</div>`, 'Share Transaction');
  }
  // payment-in / payment-out picker
  function openPartyPay(dir) {
    const list = dir === 'in'
      ? customers.map(c => ({ id: c.id, name: c.name, due: customerBalance(c.id, c.name, c.phone).due, act: 'receive-payment' }))
      : suppliers.map(s => ({ id: s.id, name: s.name, due: supplierBalance(s).due, act: 'pay-supplier' }));
    const rows = list.filter(x => x.due > 0);
    sheet(rows.length ? `<div class="sheet-list">${rows.map(r => `<button data-action="${r.act}" data-id="${r.id}">${escapeHtml(r.name)}<small style="float:right;color:#EF1A3C">${dir === 'in' ? 'Due' : 'You owe'} ${fmtAmt(r.due)}</small></button>`).join('')}</div>`
      : `<div class="art-empty" style="padding:30px 10px">Nobody has a pending ${dir === 'in' ? 'balance to receive' : 'balance to pay'}.</div>`, dir === 'in' ? 'Payment-In: choose party' : 'Payment-Out: choose supplier');
  }

  // ---- DASHBOARD ----
  function monthTotals(n) {
    const out = [], now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const s = invoices.reduce((a, inv) => {
        const g = docSign(inv); if (!g) return a;
        const x = new Date(inv.date);
        return (x.getMonth() === d.getMonth() && x.getFullYear() === d.getFullYear()) ? a + g * (inv.total || 0) : a;
      }, 0);
      out.push({ label: d.toLocaleString('en-US', { month: 'short' }), v: round2(s) });
    }
    return out;
  }
  function lineChartSVG(pts) {
    const W = 340, H = 190, pad = 22, max = Math.max(1, ...pts.map(p => p.v));
    const xs = i => pad + i * (W - 2 * pad) / Math.max(1, pts.length - 1);
    const ys = v => H - 34 - (v / max) * (H - 70);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + xs(i) + ' ' + ys(p.v)).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4DA3FF" stop-opacity=".28"/><stop offset="1" stop-color="#4DA3FF" stop-opacity="0"/></linearGradient></defs>
      <path d="${d} L${xs(pts.length - 1)} ${H - 34} L${xs(0)} ${H - 34}Z" fill="url(#lg)"/><line x1="${pad}" x2="${W - pad}" y1="${H - 34}" y2="${H - 34}" stroke="#E1E6EE" stroke-dasharray="4 4"/>
      <path d="${d}" fill="none" stroke="#4DA3FF" stroke-width="3" stroke-linejoin="round"/>
      ${pts.map((p, i) => `<circle cx="${xs(i)}" cy="${ys(p.v)}" r="4" fill="#0A6FE0"/><text x="${xs(i)}" y="${H - 10}" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}" font-size="13" fill="#8F95A8">${p.label}</text>`).join('')}</svg>`;
  }
  function viewDashboard() {
    const { revenue, cogs, receivable } = netTotals();
    const payable = totalGive();
    const m = monthTotals(3);
    const thisM = m[2].v, last = m[1].v;
    const growth = last > 0 ? Math.round((thisM - last) / last * 100) : (thisM > 0 ? 100 : 0);
    const now = new Date();
    const monthExp = expenses.filter(e => { const d = new Date(e.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).reduce((s, e) => s + (e.amount || 0), 0);
    const totalExp = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const profit = revenue - cogs - totalExp;
    const low = products.filter(p => p.stock > 0 && p.stock <= lowLimit(p)).length, out = products.filter(p => p.stock <= 0).length;
    const stockVal = products.reduce((s, p) => s + Math.max(0, p.stock || 0) * (p.cost || 0), 0);
    return `<div class="fade-in" style="padding-bottom:16px">
      <div class="vy-banner"><div><h3>Billaura Reports</h3><p>View more than <b>40 reports</b> and gain full control of your business!</p><button class="pill-soft" data-view="reports">See Reports</button></div>
        <div class="art"><svg viewBox="0 0 70 86" fill="none"><rect x="6" y="4" width="58" height="78" rx="6" fill="#fff"/><rect x="14" y="14" width="30" height="5" rx="2" fill="#0A6FE0"/><rect x="14" y="26" width="42" height="3" rx="1.5" fill="#BFDBFE"/><rect x="14" y="34" width="42" height="3" rx="1.5" fill="#BFDBFE"/><rect x="14" y="42" width="42" height="3" rx="1.5" fill="#BFDBFE"/><circle cx="46" cy="64" r="8" fill="#F5B301"/></svg></div></div>
      <div class="gg-row"><div class="gg"><div class="t"><span class="ar g"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M17 7L7 17M7 17h8M7 17V9"/></svg></span>To Collect</div><div class="v">${fmtAmt(receivable)}</div></div>
        <div class="gg"><div class="t"><span class="ar r"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M7 17L17 7M17 7H9M17 7v8"/></svg></span>To Pay</div><div class="v">${fmtAmt(payable)}</div></div></div>
      <div class="vy-card sale-ov"><h3>Sales This Month (${m[2].label})</h3><div class="sub" style="margin-top:12px">Total Sale</div><div class="big">${fmtAmt(thisM)}</div>
        <div style="text-align:center;margin:6px 0"><span class="growth"><i style="${growth < 0 ? 'background:#FDE3E8;color:#EF1A3C' : ''}">${growth < 0 ? '↓' : '↑'}</i>${Math.abs(growth)}% ${growth < 0 ? 'Less' : 'More'} Growth This Month</span></div>${lineChartSVG(m)}</div>
      <div class="exp-card"><div class="t">Expenses (${m[2].label})</div><div class="v">${fmtAmt(monthExp)}</div></div>
      <div class="gg-row"><div class="gg"><div class="t" style="font-size:.95rem">Net profit</div><div class="v" style="margin:6px 0 0;color:${profit >= 0 ? '#13B97A' : '#EF1A3C'}">${fmtAmt(profit)}</div></div>
        <div class="gg"><div class="t" style="font-size:.95rem">Stock value</div><div class="v" style="margin:6px 0 0">${fmtAmt(stockVal)}</div></div></div>
      <div class="gg-row"><div class="gg" data-view="low-stock" style="cursor:pointer"><div class="t" style="font-size:.95rem">Low stock items</div><div class="v" style="margin:6px 0 0;color:#E69500">${low}</div></div>
        <div class="gg" data-view="low-stock" style="cursor:pointer"><div class="t" style="font-size:.95rem">Out of stock</div><div class="v" style="margin:6px 0 0;color:#EF1A3C">${out}</div></div></div></div>`;
  }

  // ---- MENU ----
  let menuOpen = { sale: true };
  function mrow(ic, label, attr, opts) {
    opts = opts || {};
    return `<button class="m-row ${opts.open ? 'open' : ''}" ${attr}>${ic ? ico(ic, 'mi') : ''}<span class="grow">${label}${opts.badge ? `<span class="badge-new">${opts.badge}</span>` : ''}</span>${ico(opts.toggle ? 'chevD' : 'chevR', 'arr' + (opts.dim ? ' dim' : ''))}</button>`;
  }
  function msub(key, rows) { return `<div class="m-sub ${menuOpen[key] ? 'open' : ''}">${rows.map(r => mrow('', r[0], r[1], { dim: true })).join('')}</div>`; }
  function viewMore() {
    if (isStaff()) return staffMoreHTML();
    const tg = (key, ic, label) => mrow(ic, label, `data-action="menu-toggle" data-key="${key}"`, { toggle: true, open: menuOpen[key] });
    const _s = HisablyFreemium.getSession() || {};
    const _pro = HisablyFreemium.hasFeature('shopify');
    return `<div class="fade-in" style="padding-bottom:20px">
      <div class="menu-card acct-card" style="margin-top:14px" data-action="open-account"><div class="acct-row"><div class="acct-av">${acctAvatar()}</div><div class="acct-txt"><div class="acct-name">${escapeHtml(_s.fullName || settings.businessName || 'My Account')}</div><div class="acct-sub">${escapeHtml(_s.email || 'Not signed in')} · ${escapeHtml(planLabel())}</div></div><svg class="list-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div></div>
      <div class="menu-card"><div class="menu-h">My Business</div>
        ${tg('sale', 'sale', 'Sale')}${msub('sale', [['Sale Invoice', 'data-action="list-sales"'], ['Payment-In', 'data-view="payments-in"'], settings.enableGoodsReturn !== false && ['Sale Return (Credit Note)', 'data-action="list-returns"'], settings.enableEstimate !== false && ['Estimate/Quotation', 'data-action="list-estimates"'], settings.enableDeliveryNote !== false && ['Delivery Note', 'data-action="list-sales-dn"'], ['Mobile POS', 'data-view="pos"']].filter(Boolean))}
        ${tg('purchase', 'cart', 'Purchase')}${msub('purchase', [['Purchase Bills', 'data-view="purchases"'], ['Payment - Out', 'data-view="payments-out"'], ['Suppliers', 'data-view="suppliers"']])}
        ${mrow('wallet', 'Expenses', 'data-view="expenses"')}${mrow('users', 'Parties (Customers)', 'data-view="customers"')}${mrow('store', 'My Online Store', 'data-view="online-store"')}${mrow('report', 'Reports', 'data-view="reports"')}
        ${mrow('box', 'Stock Adjustment', 'data-view="stock-adjust"')}${mrow('chart', 'Other Income', 'data-view="other-income"')}</div>
      ${window.BillauraExt && BillauraExt.menuCard ? BillauraExt.menuCard() : ''}
      <div class="menu-card"><div class="menu-h">Cash &amp; Bank</div>${mrow('bank', 'Bank Accounts', 'data-view="banks"')}${mrow('cash', 'Cash In-Hand', 'data-view="cash-in-hand"')}${mrow('cheque', 'Cheques', 'data-view="cheques"')}${mrow('loan', 'Loan Accounts', 'data-view="loans"')}</div>
      <div class="menu-card"><div class="menu-h">Tools</div>
        ${mrow('sync', 'Cloud &amp; Share', 'data-view="sync"')}${mrow('company', 'My Businesses', 'data-view="companies"')}${location.protocol === 'billaura:' ? '' : mrow('desktop', 'Get Desktop Version', 'data-action="desktop-info"')}
        ${tg('backup', 'backup', 'Backup/Restore')}${msub('backup', [['Auto Backup', 'data-action="auto-backup"'], ['Backup to phone', 'data-action="export-backup"'], ['Backup to e-mail', 'data-action="backup-email"'], ['Restore backup', 'data-action="import-data"']])}
        ${tg('util', 'inbox', 'Utilities')}${msub('util', [['Verify my data', 'data-view="verify"'], ['Open Calculator', 'data-action="open-calc"'], ['Import Items', 'data-action="bulk-tools"'], ['Bulk Update Tax Slab', 'data-action="bulk-tax"'], ['Export Items', 'data-action="bulk-export"'], ['Import Parties', 'data-action="import-parties"'], ['Recycle Bin', 'data-view="recycle"'], ['Close Financial Year', 'data-action="close-fy"'], ['Barcode Generator', 'data-view="barcode-gen"']])}</div>
      <div class="menu-card"><div class="menu-h">More</div>
        ${mrow('crown', 'Billaura Plans', 'data-action="open-plans"')}
        ${tg('grow', 'whatsapp', 'Grow Your Business')}${msub('grow', [['Payment Reminders', 'data-view="reminders"'], ['Business Card &amp; Profile', 'data-view="business-profile"'], ['Share Catalog', 'data-view="online-store"'], ['Shopify Sync' + (_pro ? '' : ' (Pro)'), 'data-action="open-shopify"']])}
        ${mrow('gear', 'Settings', 'data-view="settings"')}${mrow('users', 'Account &amp; Data', 'data-view="account"')}${mrow('lock', 'App Lock &amp; Staff PIN', 'data-view="app-lock"')}</div>
      <div style="text-align:center;padding:14px;color:#8F95A8;font-size:.8rem">© ${new Date().getFullYear()} Billaura. All rights reserved.<br>Billaura v${APP_VERSION}${profileCompleteness() < 100 ? ` · <a href="#" data-view="business-profile" style="color:#0A6FE0">Complete profile (${profileCompleteness()}%)</a>` : ''}</div></div>`;
  }
  IC.lock = '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>';

  // ---- EXPENSES (Categories | Items) ----
  let expTab = 'cat';
  function viewExpenses() {
    const total = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    let rows;
    if (expTab === 'cat') {
      const sums = {}; expenseCategories().forEach(c => { sums[c] = 0; });
      expenses.forEach(e => { const c = e.category || 'Other'; sums[c] = (sums[c] || 0) + (e.amount || 0); });
      rows = Object.entries(sums).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c, v]) => `<div class="u-row" data-action="exp-cat" data-cat="${escapeHtml(c)}"><span>${escapeHtml(c)}</span><span>${fmtAmt(v)}</span></div>`).join('');
    } else {
      const sorted = [...expenses].sort((a, b) => new Date(b.date) - new Date(a.date));
      rows = sorted.length ? sorted.map(e => `<div class="u-row" data-action="edit-expense" data-id="${e.id}"><span>${escapeHtml(e.title || e.category || 'Expense')}<small>${escapeHtml(e.category || '')} · ${formatDate(e.date)}${e.mode && e.mode !== 'Cash' ? ' · ' + escapeHtml(e.mode) : ''}</small></span><span style="color:#EF1A3C">${fmtAmt(e.amount)}</span></div>`).join('')
        : `<div class="art-empty">No expenses recorded yet.</div>`;
    }
    return `<div class="u-page fade-in" style="padding-bottom:110px"><div class="u-tabs"><button class="u-tab ${expTab === 'cat' ? 'active' : ''}" data-action="exp-tab" data-tab="cat">Categories</button><button class="u-tab ${expTab === 'items' ? 'active' : ''}" data-action="exp-tab" data-tab="items">Items</button></div>
      <div class="u-total">Total: <b>${fmtAmt(total)}</b></div>${rows}</div>
      <button class="fab-pill" data-action="add-expense">${ico('plus')} Add Expenses</button>`;
  }

  // ---- CASH IN-HAND ----
  function viewCashInHand() {
    const bal = cashInHandBalance();
    let rows = [];
    try {
      rows = cashEntries().filter(r => (r.mode || 'Cash') === 'Cash').map(r => ({ ...r, _s: new Date(r.date).getTime() }));
      cashAdjustments().forEach(a => rows.push({ date: a.date, text: a.note || 'Cash Adjustment', amount: Math.abs(a.amount || 0), dir: (a.amount || 0) >= 0 ? 'in' : 'out', _s: new Date(a.date).getTime() }));
      rows.sort((a, b) => b._s - a._s);
    } catch (e) {}
    return `<div class="u-page fade-in" style="padding-bottom:120px"><div class="cash-hero"><div class="l">Current Cash Balance</div><div class="v">${fmtAmt(bal)}</div>${ico('cash')}</div>
      <div class="td-head"><span>Entry</span><span>Amount</span></div>
      ${rows.length ? rows.slice(0, 80).map(r => `<div class="td-row"><div><div class="n">${escapeHtml((r.text || '').replace(/^Payment in /, 'Sale - ').replace(/^Paid for /, 'Purchase - '))}${r.party ? ' - ' + escapeHtml(r.party) : ''}</div><div class="d">${formatDate(r.date)}</div></div><div class="a ${r.dir}">${fmtAmt(r.amount)}</div></div>`).join('') : '<div class="art-empty">No cash transactions yet</div>'}</div>
      <div class="bottom-btns"><button class="btn btn-outline" data-action="bank-transfer">Bank Transfer</button><button class="btn btn-primary" data-action="adjust-cash">Adjust Cash</button></div>`;
  }

  // ---- Payment lists, cheques ----
  function paymentList(dir) {
    const rows = cashEntries().filter(r => r.dir === dir && !/^Expense/.test(r.text) && (dir === 'in' ? /^Payment in/.test(r.text) : true));
    return `<div class="u-page fade-in"><div class="u-total">Total: <b>${fmtAmt(rows.reduce((s, r) => s + r.amount, 0))}</b></div>
      ${rows.length ? rows.map(r => `<div class="td-row"><div><div class="n">${escapeHtml(r.party || '—')}</div><div class="d">${formatDate(r.date)} · ${escapeHtml(r.mode || 'Cash')}</div></div><div class="a ${dir}">${fmtAmt(r.amount)}</div></div>`).join('') : `<div class="art-empty">No payments ${dir === 'in' ? 'received' : 'made'} yet</div>`}</div>
      <button class="fab-pill" data-action="${dir === 'in' ? 'pay-in' : 'pay-out'}">${ico('plus')} ${dir === 'in' ? 'Add Payment-In' : 'Add Payment-Out'}</button>`;
  }
  function viewCheques() {
    const rows = cashEntries().filter(r => r.mode === 'Cheque');
    if (!rows.length) return `<div class="u-page"><div class="art-empty"><svg viewBox="0 0 160 110"><rect x="10" y="20" width="110" height="70" rx="4" fill="#FFF3D6"/><circle cx="32" cy="42" r="8" fill="#FFE0A0" stroke="#44485A" stroke-width="2"/><path d="M48 40h42M48 50h30" stroke="#44485A" stroke-width="2"/><rect x="26" y="64" width="46" height="12" fill="none" stroke="#44485A" stroke-width="2"/><rect x="132" y="16" width="8" height="46" rx="3" fill="#fff" stroke="#44485A" stroke-width="2"/></svg><div>Hey! You have not added any cheques yet.<br>Any payment involving cheque appears here</div></div></div>`;
    return `<div class="u-page">${rows.map(r => `<div class="td-row"><div><div class="n">${escapeHtml(r.party || r.text)}</div><div class="d">${formatDate(r.date)} · Cheque</div></div><div class="a ${r.dir}">${fmtAmt(r.amount)}</div></div>`).join('')}</div>`;
  }

  // ---- Sync, Companies ----
  function viewSync() {
    const sess = window.HisablyCloud && HisablyCloud.ready() && HisablyCloud.getSession && HisablyCloud.getSession();
    const email = (window.HisablyFreemium && HisablyFreemium.getSession && (HisablyFreemium.getSession() || {}).email) || '';
    return `<div class="fade-in"><div class="hero-page"><svg viewBox="0 0 220 150" width="220"><circle cx="110" cy="75" r="68" fill="#F1EFEF"/><rect x="88" y="8" width="44" height="76" rx="5" fill="#fff" stroke="#2B3347" stroke-width="3"/><rect x="20" y="62" width="76" height="52" rx="4" fill="#fff" stroke="#2B3347" stroke-width="3"/><rect x="128" y="50" width="76" height="62" rx="4" fill="#fff" stroke="#2B3347" stroke-width="3"/><circle cx="110" cy="60" r="18" fill="#E3F2FD"/><path d="M102 60a8 8 0 0 1 14-5M118 60a8 8 0 0 1-14 5" stroke="#0A6FE0" stroke-width="2.4" fill="none"/></svg>
      <h2>Connect Multiple Devices</h2><p>Use your company in multiple devices and on the go by syncing it.</p>
      <button class="btn btn-primary btn-lg" data-action="${sess ? 'cloud-sync-now' : 'cloud-auth'}">${ico('sync')} ${sess ? 'Sync now' : 'Enable Sync'}</button>
      <p class="text-sm" style="margin-top:14px;color:#8F95A8">${email ? '*You\'re logged in with ' + escapeHtml(email) : 'Sign in with your account to back up and sync.'}</p></div></div>`;
  }
  function viewCompanies() {
    const email = (window.HisablyFreemium && HisablyFreemium.getSession && (HisablyFreemium.getSession() || {}).email) || '';
    const lastWk = invoices.filter(i => Date.now() - new Date(i.date) < 7 * 864e5 && docSign(i) > 0).length;
    return `<div class="fade-in" style="min-height:70vh"><div style="padding:12px 16px;color:#6F7589">${email ? 'Logged in with <b>' + escapeHtml(email) + '</b>' : 'Offline company on this device'}</div>
      <div class="co-card"><div class="top"><div class="co-av">${escapeHtml(initials(settings.businessName || 'B'))}</div><div><div style="font-size:1.125rem;font-weight:600">${escapeHtml(settings.businessName || 'My Business')}</div><div class="text-sm text-secondary" style="margin-top:6px">Sales in last week: ${lastWk}</div></div></div>
        <div class="tags"><span class="co-tag">My Company</span><span class="co-tag on">Active</span></div></div></div>
      <div class="bottom-btns"><button class="btn btn-outline" data-action="import-data">Restore backup</button><button class="btn btn-primary" data-action="add-company">${ico('plus')} Add Company</button></div>`;
  }

  // ---- Verify my data ----
  function runVerify() {
    const issues = [];
    invoices.forEach(i => {
      const sub = round2((i.items || []).reduce((s, it) => s + (it.price || 0) * (it.qty || 0), 0));
      const m = i.meta || {};
      const expect = round2(sub - (m.discount || 0) + (m.inclTax ? 0 : (m.tax || 0)) + (m.charges || 0) + (m.roundOff || 0));
      if (Math.abs(expect - (i.total || 0)) > 0.51) issues.push({ t: `${i.number}: total ${money(i.total)} does not match items (${money(expect)})` });
      if ((i.paidAmount || 0) > (i.total || 0) + 0.01) issues.push({ t: `${i.number}: received more than the invoice total` });
      const ps = (i.paidAmount || 0) >= (i.total || 0) && i.total > 0 ? 'paid' : ((i.paidAmount || 0) > 0 ? 'partial' : 'unpaid');
      if (i.docType !== 'estimate' && i.paymentStatus !== ps) issues.push({ t: `${i.number}: payment status should be ${ps}`, fix: () => { i.paymentStatus = ps; } });
    });
    products.forEach(p => { if ((p.stock || 0) < 0) issues.push({ t: `${p.name}: negative stock (${p.stock})` }); });
    const nums = {}; invoices.forEach(i => { nums[i.number] = (nums[i.number] || 0) + 1; });
    Object.entries(nums).forEach(([n, c]) => { if (c > 1) issues.push({ t: `Invoice number ${n} used ${c} times` }); });
    return issues;
  }
  let _verifyIssues = null;
  function viewVerify() {
    _verifyIssues = runVerify();
    const fixable = _verifyIssues.filter(i => i.fix).length;
    return `<div class="fade-in">${_verifyIssues.length ? `<div class="vy-card"><h3 style="color:#EF1A3C">${_verifyIssues.length} issue(s) found</h3>${_verifyIssues.map(i => `<div class="m-row" style="cursor:default;font-size:.95rem">${escapeHtml(i.t)}</div>`).join('')}${fixable ? `<button class="btn btn-primary btn-block mt-12" data-action="verify-fix">Fix ${fixable} automatically</button>` : ''}</div>`
      : `<div class="hero-page"><div style="color:#13B97A">${ico('verify').replace('<svg ', '<svg width="72" height="72" ')}</div><h2>All good</h2><p>${invoices.length} invoices, ${products.length} items and ${customers.length} parties were checked. No problems found.</p></div>`}</div>`;
  }

  // ---- Recycle bin ----
  function viewRecycle() {
    const t = load('sb_recycle_v1', []);
    if (!t.length) return `<div class="u-page"><div class="art-empty">${ico('trash')}<div>Recycle bin is empty.<br>Deleted items appear here and can be restored.</div></div></div>`;
    const nm = r => r.obj.name || r.obj.number || r.obj.title || r.obj.category || 'Item';
    return `<div class="u-page">${t.map(r => `<div class="td-row"><div><div class="n">${escapeHtml(nm(r))}</div><div class="d">${escapeHtml(r.kind)} · deleted ${formatDate(r.at)}</div></div><div><button class="btn btn-outline btn-sm" data-action="restore-trash" data-id="${r.id}">Restore</button> <button class="btn btn-ghost btn-sm" style="color:#EF1A3C" data-action="purge-trash" data-id="${r.id}">✕</button></div></div>`).join('')}</div>`;
  }
  function restoreTrash(id) {
    const t = load('sb_recycle_v1', []); const r = t.find(x => x.id === id); if (!r) return;
    const lists = { product: products, customer: customers, supplier: suppliers, expense: expenses, invoice: invoices };
    const L = lists[r.kind]; if (!L) return;
    if (r.kind === 'invoice') {
      (r.obj.items || []).forEach(it => { const p = products.find(x => x.id === it.productId); if (p) p.stock += (r.obj.docType === 'return' ? it.qty : -it.qty); });
    }
    L.unshift(r.obj);
    save('sb_recycle_v1', t.filter(x => x.id !== id));
    persist(); toast('Restored');
  }

  // ---- Bill-wise profit ----
  function viewBillPnl() {
    const rows = invoices.filter(i => docSign(i) > 0).map(i => {
      const cost = (i.items || []).reduce((s, it) => s + (it.cost || 0) * it.qty, 0);
      return { i, profit: round2((i.total || 0) - cost - ((i.meta && i.meta.tax) || 0)) };
    }).sort((a, b) => new Date(b.i.date) - new Date(a.i.date));
    const tot = rows.reduce((s, r) => s + r.profit, 0);
    return `<div class="u-page"><div class="u-total">Total profit: <b style="color:${tot >= 0 ? '#13B97A' : '#EF1A3C'}">${fmtAmt(tot)}</b></div>${rows.length ? rows.map(r => `<div class="td-row" data-action="view-invoice" data-id="${r.i.id}" style="cursor:pointer"><div><div class="n">${escapeHtml(r.i.customerName || 'Walk-in')}</div><div class="d">${escapeHtml(r.i.number)} · ${formatDate(r.i.date)} · Sale ${fmtAmt(r.i.total)}</div></div><div class="a ${r.profit >= 0 ? 'in' : 'out'}">${fmtAmt(r.profit)}</div></div>`).join('') : '<div class="art-empty">No sales yet</div>'}</div>`;
  }

  // ---- Calculator ----
  function openCalculator() {
    sheet(`<div class="calc-disp"><small id="calcExp"></small><div id="calcOut">0</div></div><div class="calc-grid" id="calcGrid">
      ${['C', '⌫', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '00', '.', '='].map(k => `<button class="${'÷×−+%'.includes(k) ? 'op' : (k === '=' ? 'eq' : '')}" data-k="${k}">${k}</button>`).join('')}</div>`, 'Calculator');
    let exp = '';
    const out = $('#calcOut'), ex = $('#calcExp');
    const evalExp = s => { try { const clean = s.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-'); if (!/^[0-9+\-*/.% ()]+$/.test(clean)) return NaN; return Function('"use strict";return (' + clean.replace(/(\d+(\.\d+)?)%/g, '($1/100)') + ')')(); } catch (e) { return NaN; } };
    $('#calcGrid').addEventListener('click', e => {
      const b = e.target.closest('[data-k]'); if (!b) return; const k = b.dataset.k;
      if (k === 'C') exp = ''; else if (k === '⌫') exp = exp.slice(0, -1);
      else if (k === '=') { const r = evalExp(exp); ex.textContent = exp + ' ='; exp = isFinite(r) ? String(round2(r)) : ''; out.textContent = isFinite(r) ? money(round2(r)) : 'Error'; return; }
      else exp += k;
      out.textContent = exp || '0';
    });
  }

  // ---- Import parties (CSV: name,phone,address) ----
  function importPartiesPick() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.csv,text/csv,text/plain';
    input.onchange = () => {
      const f = input.files && input.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        const rows = parseCSV(String(r.result));
        let added = 0;
        rows.forEach((row, i) => {
          if (i === 0 && /name/i.test(row[0] || '')) return;
          const name = (row[0] || '').trim(); if (!name) return;
          if (customers.some(c => c.name.toLowerCase() === name.toLowerCase())) return;
          if (!HisablyFreemium.canAdd('customers', customers.length).ok) return;
          customers.push({ id: uid(), name, phone: (row[1] || '').trim(), address: (row[2] || '').trim(), notes: '' }); added++;
        });
        persist(); toast(`${added} part${added === 1 ? 'y' : 'ies'} imported`); render();
      };
      r.readAsText(f);
    };
    input.click();
  }
  function emailBackup() {
    const n = invoices.length;
    location.href = 'mailto:?subject=' + encodeURIComponent('Billaura backup ' + new Date().toISOString().slice(0, 10)) + '&body=' + encodeURIComponent(`Download the backup file first (Menu → Backup to phone), then attach it to this email.\n\n${settings.businessName}: ${n} invoices, ${products.length} items.`);
  }

  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'homeSearch') {
      homeQuery = e.target.value; const pos = homeQuery.length; render();
      const el = document.getElementById('homeSearch'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (x) {} }
    }
  });
  function maybeAutoBackup() {
    if (!settings.autoBackup) return;
    const last = Number(localStorage.getItem('billaura_last_autobackup') || 0);
    if (Date.now() - last < 864e5) return;
    try {
      const data = { products, invoices, customers, suppliers, expenses, stockMovements, purchases, banks, bankTxns, otherIncome, loans, settings, invoiceCounter, exportedAt: new Date().toISOString() };
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      a.download = `billaura-auto-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      localStorage.setItem('billaura_last_autobackup', String(Date.now()));
    } catch (e) {}
  }
  // ---------- Global Event Delegation ----------
  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'lbSearch') {
      LB.q = e.target.value; const q = LB.q.trim().toLowerCase();
      document.querySelectorAll('.list-row[data-s]').forEach(r => { r.style.display = (!q || r.dataset.s.includes(q)) ? '' : 'none'; });
    }
  });
  document.addEventListener('click', async e => {
    // Close open custom dropdowns when clicking outside
    if (!e.target.closest('.custom-select')) {
      $$('.custom-select.open').forEach(el => el.classList.remove('open'));
    }
    // POS filter chips
    const posChip = e.target.closest('[data-pos-filter]');
    if (posChip) {
      window._posFilter = posChip.dataset.posFilter;
      $$('.pos-chips .cat-chip').forEach(c => c.classList.toggle('active', c === posChip));
      if (window._posRenderGrid) window._posRenderGrid(window._posFilter, (document.getElementById('posSearch')||{}).value);
    }
    // Stock adjust dir chips
    const sa = e.target.closest('#saDir .cat-chip');
    if (sa) {
      $$('#saDir .cat-chip').forEach(c => c.classList.remove('active'));
      sa.classList.add('active');
    }

    const t = e.target.closest('[data-action], [data-view], .nav-item, .list-item, .modal-overlay');
    if (!t) return;

    // Close modal on overlay click
    if (t.classList.contains('modal-overlay') && t.id !== 'qr-reader') {
      if (e.target === t) closeModal();
      return;
    }

    const action = t.dataset.action;
    const view = t.dataset.view || (t.classList.contains('nav-item') ? t.dataset.view : null);
    const id = t.dataset.id;
    if (isStaff() && action) { const need = actionPerm(action); if (need && !can(need)) { if (!(window.BillauraExt && BillauraExt.approve && await BillauraExt.approve(need, action))) { toast('Your role does not allow that'); return; } } }

    if (view) {
      setView(view);
      return;
    }

    if (action && window.BillauraExt && BillauraExt.actions && BillauraExt.actions[action]) { try { await BillauraExt.actions[action](t, e); } catch (err) { console.error(err); toast('Something went wrong'); } return; }

    switch (action) {
      case 'pick-theme': {
        const k = t.dataset.theme;
        if (HisablyReceipt.THEMES[k] && HisablyReceipt.THEMES[k].pro && !HisablyFreemium.hasFeature('themes')) { toast('This style is a Pro feature.', 4000); openPlansModal && openPlansModal(); break; }
        settings.invoiceTheme = k; persist();
        const box = document.getElementById('themePicker'); if (box) box.outerHTML = themePickerHTML();
        break;
      }
      case 'lock-now': showLock(); break;
      case 'save-business-profile': {
        settings.businessName = ($('#bpName')||{}).value?.trim() || 'My Business';
        settings.phone = ($('#bpPhone')||{}).value?.trim() || '';
        settings.email = ($('#bpEmail')||{}).value?.trim() || '';
        settings.address = ($('#bpAddress')||{}).value?.trim() || '';
        settings.city = ($('#bpCity')||{}).value?.trim() || '';
        settings.taxId = ($('#bpTax')||{}).value?.trim() || '';
        settings.ownerName = ($('#bpOwner')||{}).value?.trim() || '';
        settings.phone2 = ($('#bpPhone2')||{}).value?.trim() || '';
        settings.businessDesc = ($('#bpDesc')||{}).value?.trim() || '';
        settings.currency = ($('#bpCurrency')||{}).value || 'PKR';
        settings.invoicePrefix = ($('#bpPrefix')||{}).value?.trim() || 'INV';
        // logo/signature/stamp/qr already on settings from pick actions
        persist();
        toast('Business profile saved');
        pushSettingsNow().then(r => { if (r === true) toast('Profile synced to your cloud account'); else if (r) toast('Saved on this phone, but cloud sync failed: ' + r, 7000); });
        setView('more');
        break;
      }
      case 'set-invoice-theme': {
        const th = t.dataset.theme;
        if (!th) break;
        settings.invoiceTheme = th;
        persist();
        document.querySelectorAll('#themeGrid .template-card').forEach(el => {
          el.classList.toggle('active', el.dataset.theme === th);
        });
        toast('Invoice template: ' + th);
        break;
      }
      case 'set-card-style': {
        const st = t.dataset.style;
        if (!st) break;
        settings.businessCardStyle = st;
        persist();
        document.querySelectorAll('[data-action="set-card-style"]').forEach(el => {
          el.classList.toggle('active', el.dataset.style === st);
        });
        toast('Card style: ' + st);
        break;
      }
      case 'pm-edit-unit': { _pmDraft = Object.assign(_pmDraft || {}, {}); const d = pmCollect(); _pmDraft._form = d; openUnitSheet(); break; }
      case 'pm-unit-cancel': openProductModal(_pmItem, Object.assign({}, _pmDraft._form, { unit: _pmDraft.unit, unit2: _pmDraft.unit2, unitRate: _pmDraft.unitRate })); break;
      case 'pm-unit-save': {
        const pr = ($('#unPri') || {}).value, sc = ($('#unSec') || {}).value, rate = ($('#unRate') || {}).value;
        if (!pr) { toast('Choose a primary unit'); break; }
        if (sc && sc !== pr && !(Number(rate) > 0)) { toast('Enter the conversion rate'); break; }
        openProductModal(_pmItem, Object.assign({}, _pmDraft._form, { unit: pr, unit2: (sc && sc !== pr) ? sc : '', unitRate: (sc && sc !== pr) ? rate : '' }));
        break;
      }
      case 'pm-assign-code': { const b = $('#pmBarcode'); if (b) b.value = genItemCode(); break; }
      case 'pm-tab': { document.querySelectorAll('.pm-tab').forEach(x => x.classList.toggle('on', x.dataset.tab === t.dataset.tab)); const a1 = $('#pmPrice'), b1 = $('#pmStock'); if (a1) a1.hidden = t.dataset.tab !== 'price'; if (b1) b1.hidden = t.dataset.tab !== 'stock'; break; }
      case 'pm-wholesale': settings.enableWholesale = true; persist(); { const d = pmCollect(); d._form = d; openProductModal(_pmItem, Object.assign({}, d, { unit: _pmDraft.unit, unit2: _pmDraft.unit2, unitRate: _pmDraft.unitRate })); } break;
      case 'bp-tab': { settings._bpTab = t.dataset.tab; document.querySelectorAll('.bp-tab').forEach(x => x.classList.toggle('on', x.dataset.tab === t.dataset.tab)); const a1 = $('#bpBasic'), b1 = $('#bpBiz'); if (a1) a1.hidden = t.dataset.tab !== 'basic'; if (b1) b1.hidden = t.dataset.tab !== 'biz'; break; }
      case 'set-card-tpl': {
        settings.businessCardTpl = t.dataset.value; persist();
        document.querySelectorAll('[data-action="set-card-tpl"]').forEach(el => el.classList.toggle('active', el.dataset.value === t.dataset.value));
        break;
      }
      case 'preview-business-card': {
        if (!tplOK()) break;
        const id = settings.businessCardTpl || 'classic';
        $('#modalRoot').innerHTML = modalShell('Business Card', `<div style="padding:8px 0 16px"><div class="bc-big">${BillauraTemplates.cardHTML(settings, id)}</div>
          <div style="display:flex;gap:10px;margin-top:18px"><button class="btn btn-outline" style="flex:1" data-action="close-modal">Close</button><button class="btn btn-primary" style="flex:1" data-action="share-business-card">Share Card</button></div></div>`);
        break;
      }
      case 'share-business-card': {
        if (!tplOK()) break;
        (async () => {
          try {
            toast('Preparing card…');
            const cv = await BillauraTemplates.cardCanvas(settings, settings.businessCardTpl || 'classic');
            const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
            const file = new File([blob], 'business-card.png', { type: 'image/png' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: settings.businessName || 'Business card' }); return; }
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); toast('Card saved');
          } catch (e) { if (e && e.name !== 'AbortError') { console.error(e); toast('Could not create card'); } }
        })();
        break;
      }
      case 'draw-signature': {
        $('#modalRoot').innerHTML = modalShell('Draw Signature', `<div style="padding:8px 0 16px"><canvas id="sigPad" width="600" height="240" style="width:100%;height:auto;border:1.5px dashed #9aa3b5;border-radius:10px;background:#fff;touch-action:none"></canvas>
          <div style="display:flex;gap:10px;margin-top:14px"><button class="btn btn-outline" style="flex:1" data-action="sig-clear">Clear</button><button class="btn btn-primary" style="flex:1" data-action="sig-save">Save</button></div></div>`);
        const cv = document.getElementById('sigPad'), g = cv.getContext('2d'); g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#111827';
        let down = false; const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
        cv.addEventListener('pointerdown', e => { down = true; cv.setPointerCapture(e.pointerId); const [x, y] = pt(e); g.beginPath(); g.moveTo(x, y); g.lineTo(x + .1, y + .1); g.stroke(); });
        cv.addEventListener('pointermove', e => { if (!down) return; const [x, y] = pt(e); g.lineTo(x, y); g.stroke(); });
        ['pointerup', 'pointercancel'].forEach(ev => cv.addEventListener(ev, () => { down = false; }));
        break;
      }
      case 'sig-clear': { const cv = document.getElementById('sigPad'); if (cv) cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); break; }
      case 'sig-save': {
        const cv = document.getElementById('sigPad'); if (!cv) break;
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let any = false; for (let k = 3; k < d.length; k += 4) if (d[k]) { any = true; break; }
        if (!any) { toast('Draw your signature first'); break; }
        settings.signature = cv.toDataURL('image/png'); persist(); closeModal(); render(); toast('Signature saved'); break;
      }
      case 'pick-qr': bindBrandFile('qrFile', 'paymentQr', 'qrPreview', 'Payment QR'); break;
      case 'pick-qr-legacy': {
        // handled below with unified uploader when id matches
        break;
      }
      case 'open-txn-settings': setView('txn-settings'); break;
      case 'open-print-settings': setView('print-settings'); break;
      case 'open-tax-settings': setView('tax-settings'); break;
      case 'open-item-settings': setView('item-settings'); break;
      case 'open-party-settings': setView('party-settings'); break;
      case 'open-general-settings': setView('general-settings'); break;
      case 'print-tab':
        settings._printTab = t.dataset.tab || 'regular';
        persist();
        render();
        break;
      case 'tax-tab':
        settings._taxTab = t.dataset.tab || 'rates';
        persist();
        render();
        break;
      case 'set-thermal-size':
        settings.thermalPageSize = t.dataset.value || '80';
        try {
          if (window.HisablyReceipt && HisablyReceipt.setPrefs) HisablyReceipt.setPrefs({ paper: settings.thermalPageSize });
        } catch (e) {}
        persist();
        render();
        break;
      case 'toggle-words-format':
        settings.amountWordsFormat = settings.amountWordsFormat === 'indian' ? 'international' : 'indian';
        persist();
        render();
        break;
      case 'open-theme': setView('invoice-theme'); break;
      case 'add-tax-rate': {
        const name = await askPrompt('Tax name (e.g. GST 18%)');
        if (!name) break;
        const rate = parseFloat(await askPrompt('Tax rate %', '18') || '0');
        if (!settings.taxRates) settings.taxRates = [];
        settings.taxRates.push({ name: name.trim(), rate: isNaN(rate) ? 0 : rate });
        if (!settings.taxRate) settings.taxRate = isNaN(rate) ? 0 : rate;
        persist();
        toast('Tax rate added');
        render();
        break;
      }
      case 'remove-tax-rate': {
        const i = Number(t.dataset.idx);
        if (settings.taxRates) { settings.taxRates.splice(i, 1); persist(); render(); }
        break;
      }
      case 'add-tax-group': {
        const name = await askPrompt('Group name (e.g. GST 18%)');
        if (!name) break;
        const rate = parseFloat(await askPrompt('Combined rate %', '18') || '0');
        if (!settings.taxGroups) settings.taxGroups = [];
        settings.taxGroups.push({ name: name.trim(), rate: isNaN(rate) ? 0 : rate, rates: [] });
        persist();
        toast('Tax group added');
        render();
        break;
      }
      case 'remove-tax-group': {
        const i = Number(t.dataset.idx);
        if (settings.taxGroups) { settings.taxGroups.splice(i, 1); persist(); render(); }
        break;
      }
      case 'report-sales': setView('sale-report'); break;
      case 'report-all-txn': invFilter = ''; setView('invoices'); break;
      case 'report-pl': setView('profit-loss'); break;
      case 'report-trial': setView('trial-balance'); break;
      case 'report-stock': setView('stock-summary'); break;
      case 'report-low-stock': setView('low-stock'); break;
      case 'report-party-pl': setView('party-pl'); break;
      case 'report-item-pl': setView('item-pl'); break;
      case 'report-balance-sheet': setView('balance-sheet'); break;
      case 'add-bank': {
        const name = await askPrompt('Bank / wallet name (e.g. HBL, JazzCash)');
        if (!name) break;
        const accountNo = await askPrompt('Account / IBAN (optional)') || '';
        const opening = parseFloat(await askPrompt('Opening balance', '0') || '0') || 0;
        banks.push({ id: uid(), name: name.trim(), accountNo, type: 'Bank', opening, createdAt: new Date().toISOString() });
        persist(); toast('Bank added'); setView('banks');
        break;
      }
      case 'open-bank-ledger':
        settings._bankId = t.dataset.id;
        persist();
        setView('bank-ledger');
        break;
      case 'bank-adjust': {
        const bankId = t.dataset.id || settings._bankId || (banks[0] && banks[0].id);
        if (!bankId) { toast('Add a bank first'); break; }
        const _ch = await askChoice('What kind of bank entry is this?', ['Deposit (money in)', 'Withdraw (money out)'], { title: 'Bank entry' });
        if (_ch < 0) break;
        const dir = _ch === 0 ? 'in' : 'out';
        const amt = parseFloat(await askPrompt('Amount') || '');
        if (!amt || amt <= 0) { toast('Invalid amount'); break; }
        const note = await askPrompt('Note', dir === 'in' ? 'Deposit' : 'Withdrawal') || '';
        bankTxns.push({ id: uid(), bankId, dir, amount: amt, note, mode: 'Bank', date: new Date().toISOString() });
        persist(); toast('Bank entry saved');
        settings._bankId = bankId; setView('bank-ledger');
        break;
      }
      case 'bank-transfer': {
        if (banks.length < 1) { toast('Add a bank first'); break; }
        const _tc = await askChoice('Which way do you want to move the money?', ['Cash → Bank', 'Bank → Cash'], { title: 'Transfer' });
        if (_tc < 0) break;
        const fromCash = _tc === 0;
        const bankId = t.dataset.id || settings._bankId || banks[0].id;
        const amt = parseFloat(await askPrompt('Transfer amount') || '');
        if (!amt || amt <= 0) break;
        if (fromCash) {
          if (!settings.cashAdjustments) settings.cashAdjustments = [];
          settings.cashAdjustments.push({ id: uid(), amount: -amt, note: 'Transfer to bank', date: new Date().toISOString() });
          bankTxns.push({ id: uid(), bankId, dir: 'in', amount: amt, note: 'Transfer from cash', mode: 'Transfer', date: new Date().toISOString() });
        } else {
          bankTxns.push({ id: uid(), bankId, dir: 'out', amount: amt, note: 'Transfer to cash', mode: 'Transfer', date: new Date().toISOString() });
          if (!settings.cashAdjustments) settings.cashAdjustments = [];
          settings.cashAdjustments.push({ id: uid(), amount: amt, note: 'Transfer from bank', date: new Date().toISOString() });
        }
        persist(); toast('Transfer recorded'); setView('banks');
        break;
      }
      case 'add-loan': {
        const name = await askPrompt('Loan name');
        if (!name) break;
        const lender = await askPrompt('Lender (bank / person)') || '';
        const amount = parseFloat(await askPrompt('Loan amount') || '0') || 0;
        loans.push({ id: uid(), name: name.trim(), lender, amount, balance: amount, date: new Date().toISOString() });
        persist(); toast('Loan added'); setView('loans');
        break;
      }
      case 'add-other-income': {
        const title = await askPrompt('Income title (e.g. Interest, Rent received)');
        if (!title) break;
        const amount = parseFloat(await askPrompt('Amount') || '0') || 0;
        const category = await askPrompt('Category', 'Other') || 'Other';
        otherIncome.push({ id: uid(), title: title.trim(), category, amount, date: new Date().toISOString() });
        persist(); toast('Income recorded'); setView('other-income');
        break;
      }
      case 'lb-flag': { const pf = lbSettings(); pf[t.dataset.k] = !pf[t.dataset.k]; settings.labelPrefs = pf; persist(); render(); break; }
      case 'lb-size': { const pf = lbSettings(); pickSheet({ title: 'Label size', selected: pf.size, search: false, options: Object.keys(BillauraLabels.SIZES).map(k => ({ value: k, label: BillauraLabels.SIZES[k].name })), onPick: v => { pf.size = v; settings.labelPrefs = pf; persist(); render(); } }); break; }
      case 'lb-step': { const p = products.find(x => x.id === id); if (!p) break; LB.sel[id] = Math.max(0, Math.min(500, (LB.sel[id] || 0) + Number(t.dataset.d))); if (LB.sel[id] && !p.barcode) { p.barcode = lbCode(p); persist(); } render(); break; }
      case 'lb-all': products.forEach(p => { if (p.name) { LB.sel[p.id] = LB.sel[p.id] || 1; if (!p.barcode) p.barcode = lbCode(p); } }); persist(); render(); break;
      case 'lb-stock': products.forEach(p => { if (p.name) { LB.sel[p.id] = Math.max(1, Math.min(500, Math.round(Number(p.stock) || 1))); if (!p.barcode) p.barcode = lbCode(p); } }); persist(); render(); break;
      case 'lb-clear': LB.sel = {}; render(); break;
      case 'lb-preview': lbPreview(); break;
      case 'lb-print': { if (!lbItems().length) { toast('Pick items first'); break; } BillauraLabels.print(lbHTML()).catch(() => toast('Could not open print')); break; }
      case 'gen-barcode': {
        const code = t.dataset.code || '';
        const id = t.dataset.id;
        const p = products.find(x => x.id === id);
        if (p && !p.barcode) { p.barcode = code; persist(); }
        const box = document.getElementById('barcodePreview');
        if (!box) break;
        box.innerHTML = `<div class="card" style="padding:16px;display:inline-block">
          <svg id="barcodeSvg"></svg>
          <div style="margin-top:8px;font-weight:600">${escapeHtml(p ? p.name : '')}</div>
          <div class="text-sm text-secondary">${escapeHtml(code)}</div>
          <button class="btn btn-primary btn-sm mt-8" onclick="window.print()">Print label</button>
        </div>`;
        const draw = () => {
          if (window.JsBarcode) {
            try { window.JsBarcode('#barcodeSvg', code, { format: 'CODE128', width: 2, height: 60, displayValue: true }); }
            catch (e) { box.innerHTML += '<p class="text-danger">Could not draw barcode</p>'; }
          } else {
            box.innerHTML += `<p class="text-sm">Barcode value: <strong>${escapeHtml(code)}</strong></p>`;
          }
        };
        if (!window.JsBarcode) {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';
          s.onload = draw;
          document.head.appendChild(s);
        } else draw();
        break;
      }
      case 'publish-store-page': {
        uploadPendingPhotos().then(r => republishStore(false).then(n => { toast('Store published (' + n + ' items)' + (_slugMsg ? ' · ' + _slugMsg : '') + (r.left ? ' · ' + r.left + ' photo(s) still on this phone – sign in to the cloud to upload them' : '') + '. Share the link on WhatsApp.', 4200); render(); })).catch(() => toast('Could not publish'));
        break;
      }
      case 'store-edit-info': openStoreInfoModal(); break;
      case 'store-edit-slug': {
        const C = window.HisablyCloud;
        if (!C || !C.ready() || !C.getSession()) { toast('Sign in to the cloud to get a short store link'); break; }
        const base = siteBase().replace(/^https?:\/\//, '') + 'store/';
        const v = await askPrompt('Your store link will be ' + base + 'name', settings.storeSlug || slugify(settings.businessName), { title: 'Store link name' });
        if (v == null) break;
        const sl = slugify(v);
        if (!slugOk(sl)) { toast('Use 3–40 letters, numbers or dashes'); break; }
        try { if (await C.slugTaken(sl)) { toast('“' + sl + '” is taken – try another'); break; } }
        catch (e) { toast(e.message === 'SETUP_NEEDED' ? 'Run supabase/stores.sql once in Supabase first' : 'Could not check the name'); break; }
        settings.storeSlug = sl; settings._slugLive = false; persist();
        await republishStore(false).catch(() => {}); toast(settings._slugLive ? 'Store link: ' + sl : (_slugMsg || 'Saved')); render(); break;
      }
      case 'store-save-info': settings.storeTagline = ($('#siTag') || {}).value.trim(); settings.storeWhatsapp = ($('#siWa') || {}).value.trim(); persist(); closeModal(); render(); toast('Saved. Update the store page to publish it.'); break;
      case 'store-edit-link': openStoreLinkModal(id || t.dataset.id); break;
      case 'store-save-link': {
        const label = ($('#slLabel') || {}).value.trim(); let url = ($('#slUrl') || {}).value.trim();
        if (!label || !url) { toast('Enter a name and a link'); break; }
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        const arr = settings.storeLinks = settings.storeLinks || [];
        const eid = t.dataset.id; const ex = eid && arr.find(x => x.id === eid);
        if (ex) { ex.label = label; ex.url = url; } else arr.push({ id: uid(), label, url });
        persist(); closeModal(); render(); toast('Link saved. Tap Update Store Page to publish.'); break;
      }
      case 'store-del-link': if (await askConfirm('Delete this link?')) { settings.storeLinks = (settings.storeLinks || []).filter(x => x.id !== (id || t.dataset.id)); persist(); render(); } break;
      case 'copy-store-link': { await republishStore(true).catch(() => {}); const u = storeUrl(); (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => toast('Link copied'), () => { askPrompt('Copy this link', u); }); break; }
      case 'open-store-page': {
        await republishStore(true).catch(() => {});
        window.open(storeUrl(), '_blank');
        break;
      }
      case 'share-store-link': {
        await republishStore(true).catch(() => {});
        let u = storeUrl();
        if (settings._storeHash || /\/store\/[^/]+$/.test(u)) { /* link ready */ }
        else {
          try {
            const raw = localStorage.getItem('billaura_public_store');
            if (raw) {
              const b64 = btoa(unescape(encodeURIComponent(raw))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
              u += '#c=' + b64;
            }
          } catch (e) {}
        }
        const msg = '*' + (settings.businessName || 'Our Store') + '*\n\nBrowse products: ' + u + (settings.phone ? '\nOrder: ' + settings.phone : '');
        sendWhatsApp('', msg);
        break;
      }
      case 'toggle-setting': {
        e.preventDefault();
        e.stopPropagation();
        const key = t.dataset.key;
        if (key) {
          settings[key] = !settings[key];
          persist();
          render();
        }
        break;
      }
      case 'set-setting': {
        const key = t.dataset.key;
        const val = t.dataset.value;
        if (key) { settings[key] = isNaN(val) ? val : Number(val); persist(); render(); }
        break;
      }
      case 'step-setting': {
        const key = t.dataset.key;
        const delta = Number(t.dataset.delta || 0);
        if (key) {
          settings[key] = Math.max(0, Math.min(4, (Number(settings[key]) || 0) + delta));
          persist();
          render();
        }
        break;
      }
      case 'adjust-cash': {
        const amt = await askPrompt('Enter adjustment amount (positive = cash in, negative = cash out):');
        if (amt === null || amt === '') break;
        const n = parseFloat(amt);
        if (isNaN(n) || n === 0) { toast('Invalid amount'); break; }
        if (!settings.cashAdjustments) settings.cashAdjustments = [];
        settings.cashAdjustments.push({
          id: uid(),
          amount: n,
          note: n >= 0 ? 'Cash In Adjustment' : 'Cash Out Adjustment',
          date: new Date().toISOString()
        });
        persist();
        toast('Cash adjusted by ' + (settings.currency||'') + ' ' + n);
        render();
        break;
      }
      case 'db-full':
        setView('daybook-detail');
        break;
      case 'add-tax-rate': {
        const name = await askPrompt('Tax name (e.g. GST 18%)');
        if (!name) break;
        const rate = parseFloat(await askPrompt('Tax rate %') || '0');
        settings.taxRate = isNaN(rate) ? settings.taxRate : rate;
        persist();
        toast('Default tax set to ' + settings.taxRate + '%');
        render();
        break;
      }
      case 'set-base-currency':
      case 'pick-base-currency': {
        const code = t.dataset.code || await askPrompt('Base currency code (e.g. PKR, INR, USD)');
        if (!code) break;
        settings.baseCurrency = String(code).toUpperCase();
        settings.currency = settings.baseCurrency;
        persist();
        toast('Base currency: ' + settings.baseCurrency);
        render();
        break;
      }
      case 'add-currency': {
        const code = await askPrompt('Currency code (e.g. USD)');
        if (!code) break;
        const rate = parseFloat(await askPrompt('Exchange rate: 1 ' + (settings.baseCurrency||settings.currency) + ' = ? ' + code) || '1');
        if (!settings.currencies) settings.currencies = [];
        settings.currencies = settings.currencies.filter(c => c.code !== code.toUpperCase());
        settings.currencies.push({ code: code.toUpperCase(), rate: rate || 1 });
        persist();
        toast('Currency added');
        render();
        break;
      }
      case 'remove-currency': {
        const code = t.dataset.code;
        settings.currencies = (settings.currencies || []).filter(c => c.code !== code);
        persist();
        render();
        break;
      }
      case 'open-payment-reminders': setView('payment-reminders'); break;
      case 'open-service-reminders': setView('service-reminders'); break;
      case 'remind-all': openRemindQueue(); break;
      case 'rq-send': { const c = customers.find(x => x.id === id); if (c) { sendWhatsApp(c.phone, reminderText(c)); (settings.remindedOn = settings.remindedOn || {})[c.id] = new Date().toISOString().slice(0, 10); persist(); } const tot = _remQueue.length; _remQueue.shift(); drawRemindQueue(window._rqTotal || tot); break; }
      case 'rq-skip': _remQueue.shift(); drawRemindQueue(window._rqTotal || 0); break;
      case 'send-daily-summary': sendDailySummary(); render(); break;
      case 'dismiss-summary': settings.summarySentOn = new Date().toISOString().slice(0, 10); persist(); render(); break;
      case 'dismiss-low': settings.lowDismissed = new Date().toISOString().slice(0, 10); persist(); render(); break;
      case 'remind-sms': { const c = customers.find(x => x.id === id); if (!c) break; if (!c.phone) { toast('No phone number saved for ' + c.name); break; } window.location.href = 'sms:' + String(c.phone).replace(/[^\d+]/g, '') + '?body=' + encodeURIComponent(reminderText(c)); break; }
      case 'sr-edit': openSrModal(id); break;
      case 'sr-save': {
        const g = x => (document.getElementById(x).value || '').trim();
        if (!g('srName')) { toast('Enter customer name'); break; }
        const rec = { id: id || uid(), name: g('srName'), phone: g('srPhone'), date: g('srDate'), note: g('srNote'), done: false };
        const l = srList(); const i = l.findIndex(x => x.id === rec.id);
        if (i >= 0) { rec.done = l[i].done; l[i] = rec; } else l.push(rec);
        persist(); closeModal(); render(); toast('Reminder saved'); break;
      }
      case 'sr-del': { if (await askConfirm('Delete this reminder?')) { settings.serviceReminders = srList().filter(x => x.id !== id); persist(); render(); } break; }
      case 'sr-done': { const r = srList().find(x => x.id === id); if (r) { r.done = !r.done; persist(); render(); } break; }
      case 'sr-remind': { const r = srList().find(x => x.id === id); if (r) sendWhatsApp(r.phone, `Assalam o Alaikum ${r.name},\n\nA reminder from *${settings.businessName}*: ${r.note || 'your service'} ${r.date ? 'is due on ' + formatDate(r.date) : 'is due'}.\n${settings.phone ? 'Contact: ' + settings.phone + '\n' : ''}\nThank you!`); break; }
      case 'open-plans':
        if (typeof openPlansModal === 'function') openPlansModal();
        else toast('Plans screen unavailable');
        break;
      case 'publish-store': {
        const names = products.slice(0, 15).map(p => '• ' + p.name + ' — ' + settings.currency + ' ' + money(p.price)).join('\n');
        let msg = '*' + (settings.businessName || 'Our Store') + '*\n\n' + names;
        if (products.length > 15) msg += '\n\n...and more';
        msg += '\n\nOrder now' + (settings.phone ? ': ' + settings.phone : '') + '!';
        sendWhatsApp('', msg);
        break;
      }
      case 'export-backup': {
        settings.lastFileBackup = new Date().toISOString(); persist();
        const data = snapshotData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `billaura-backup-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        toast('Backup downloaded');
        break;
      }
      case 'toggle-brand': {
        if (!settings.hideBranding) { if (!HisablyFreemium.hasFeature('themes')) { toast('Hiding Billaura branding is a Pro feature.', 4000); openPlansModal(); break; } settings.hideBranding = true; } else settings.hideBranding = false;
        persist(); render(); break;
      }
      case 'pin-set-owner': openPinModal('owner'); break;
      case 'pin-set-staff': openPinModal('staff'); break;
      case 'staff-perms': openStaffPerms(id); break;
      case 'staff-edit': openPinModal('staff', id); break;
      case 'staff-del': { const x = staffList().find(y => y.id === id); if (x && await askConfirm('Remove ' + x.name + '? They will no longer be able to sign in.', { okText: 'Remove', danger: true })) { settings.staff = staffList().filter(y => y.id !== id); persist(); render(); } break; }
      case 'pin-remove':
        if (await askConfirm('Remove the PIN lock and all staff users?')) { settings.pinHash = ''; settings.staffHash = ''; settings.staff = []; persist(); setRole(''); toast('Lock removed'); if (currentView === 'app-lock') render(); else openSettingsModal(); }
        break;
      case 'home-tab': homeTab = t.dataset.tab; homeQuery = ''; render(); break;
      case 'sheet-add-txn': openAddTxnSheet(); break;
      case 'sheet-more': openMoreSheet(); break;
      case 'txn-more': { const inv = invoices.find(x => x.id === id); if (inv) openTxnMore(inv); break; }
      case 'share-txn': { const inv = invoices.find(x => x.id === id); if (inv) openShareSheet(inv); break; }
      case 'pay-in': openPartyPay('in'); break;
      case 'pay-out': openPartyPay('out'); break;
      case 'quick-receive': { const inv = invoices.find(x => x.id === id); if (inv) { const c = custOfInvoice(inv); closeModal(); if (c && c.id) openReceiveModal(c); else openInvoiceDetail(inv); } break; }
      case 'delete-invoice': {
        const inv = invoices.find(x => x.id === id); if (!inv) break;
        if (!await askConfirm('Delete ' + docWord(inv).toLowerCase() + ' ' + inv.number + '? Stock will be adjusted and it goes to the Recycle Bin.')) break;
        if (inv.docType !== 'estimate') (inv.items || []).forEach(it => { const p = products.find(x => x.id === it.productId); if (p) p.stock += (inv.docType === 'return' ? -it.qty : it.qty); });
        trashPush('invoice', inv);
        invoices = invoices.filter(x => x.id !== inv.id);
        persist(); closeModal(); toast('Deleted — find it in Recycle Bin'); render();
        break;
      }
      case 'delivery-note': { const inv = invoices.find(x => x.id === id); if (inv && window.BillauraTemplates) { closeModal(); BillauraTemplates.printDoc(inv, tplCtx(), { deliveryNote: true }); } break; }
      case 'share-sms': { const inv = invoices.find(x => x.id === id); if (inv) { const c = custOfInvoice(inv); location.href = 'sms:' + (inv.customerPhone || (c && c.phone) || '') + '?body=' + encodeURIComponent(`${settings.businessName}\n${docWord(inv)} ${inv.number}\nTotal ${settings.currency} ${money(inv.total)}\nBalance ${settings.currency} ${money(Math.max(0, inv.total - (inv.paidAmount || 0)))}`); } break; }
      case 'menu-toggle': menuOpen[t.dataset.key] = !menuOpen[t.dataset.key]; render(); break;
      case 'list-sales': invFilter = 'sale'; setView('invoices'); break;
      case 'list-returns': invFilter = 'return'; setView('invoices'); break;
      case 'list-estimates': invFilter = 'estimate'; setView('invoices'); break;
      case 'list-sales-dn': invFilter = 'sale'; setView('invoices'); toast('Tap ⋮ on an invoice → Delivery Note', 3500); break;
      case 'auto-backup': settings.autoBackup = !settings.autoBackup; persist(); toast(settings.autoBackup ? 'Auto backup ON — a backup file downloads once a day when you open the app' : 'Auto backup OFF', 4000); break;
      case 'backup-email': emailBackup(); break;
      case 'open-calc': openCalculator(); break;
      case 'bulk-tax': setView('tax-settings'); toast('Set the default tax in Tax List; new invoices use it'); break;
      case 'import-parties': importPartiesPick(); break;
      case 'close-fy': sheet(`<p class="text-sm text-secondary mb-12">Closing the year downloads a full backup and keeps all your data. Invoice numbers continue; reports can be filtered by date.</p><button class="btn btn-primary btn-block" data-action="export-backup">Download year-end backup</button>`, 'Close Financial Year'); break;
      case 'verify-fix': { (_verifyIssues || []).forEach(i => i.fix && i.fix()); persist(); toast('Fixed'); render(); break; }
      case 'restore-trash': restoreTrash(id); render(); break;
      case 'purge-trash': { save('sb_recycle_v1', load('sb_recycle_v1', []).filter(x => x.id !== id)); render(); break; }
      case 'exp-tab': expTab = t.dataset.tab; render(); break;
      case 'exp-cat': openExpenseModal(null, t.dataset.cat); break;
      case 'add-company': toast('Multiple companies is a Premium feature'); openPlansModal(); break;
      case 'cloud-sync-now': doCloudSync({ silent: false }); break;
      case 'open-terms': openTermsModal(); break;
      case 'open-due-dates': openDueDatesModal(); break;
      case 'open-txn-fields': openFieldsModal('Additional Fields (Transaction)', 'txnFields', 3); break;
      case 'open-party-fields': openFieldsModal('Party Additional Fields', 'partyFields', 4); break;
      case 'open-item-fields': openFieldsModal('Additional Item Fields', 'itemFields', 4); break;
      case 'open-item-custom': openFieldsModal('Item Custom Fields', 'itemFields', 4); break;
      case 'add-product': openProductModal(); break;
      case 'filter-cat': productCat = t.dataset.cat || ''; render(); break;
      case 'bulk-tools': openBulkModal(); break;
      case 'bulk-export': exportProductsCSV(false); break;
      case 'bulk-template': exportProductsCSV(true); break;
      case 'bulk-price': if (!needPro('Bulk price change')) break; openBulkPriceModal(); break;
      case 'bulk-undo': undoBulkPrice(); break;
      case 'bulk-import-pick': { if (!needPro('Bulk product import')) break; const fi = $('#bulkImportFile'); if (fi) fi.click(); break; }
      case 'bulk-import-confirm': {
        if (!pendingImportText) break;
        const plan = planImport(pendingImportText, { updateStock: !!($('#importUpdateStock') || {}).checked });
        if (plan.error) break;
        const r = applyImport(plan);
        pendingImportText = null;
        closeModal();
        toast(`Imported: ${r.added} new, ${r.updated} updated`, 3500);
        setView('products');
        break;
      }
      case 'edit-product': {
        const p = products.find(x => x.id === id);
        if (p) openProductModal(p);
        break;
      }
      case 'delete-product':
        if (await askConfirm('Delete this product?')) {
          { const _o = products.find(p => p.id === editingId); if (_o) trashPush('product', _o); }
          products = products.filter(p => p.id !== editingId);
          persist();
          toast('Deleted');
          closeModal();
          render();
        }
        break;
      case 'view-customer': {
        const c = customers.find(x => x.id === id);
        if (c) openCustomerDetail(c);
        break;
      }
      case 'add-customer': openCustomerModal(); break;
      case 'edit-customer': {
        const c = customers.find(x => x.id === id);
        if (c) { closeModal(); openCustomerModal(c); }
        break;
      }
      case 'scan-invoice-barcode':
        startScanner(code => {
          addProductByBarcode(code);
          const inp = $('#invoiceBarcodeInput');
          if (inp) inp.value = code;
        });
        break;
      case 'delete-customer':
        if (await askConfirm('Delete this customer?')) {
          { const _o = customers.find(c => c.id === editingId); if (_o) trashPush('customer', _o); }
          customers = customers.filter(c => c.id !== editingId);
          persist();
          toast('Deleted');
          closeModal();
          setView('customers');
        }
        break;
      case 'add-supplier': openSupplierModal(); break;
      case 'edit-supplier': {
        const s = suppliers.find(x => x.id === id);
        if (s) openSupplierModal(s);
        break;
      }
      case 'delete-supplier':
        if (await askConfirm('Delete this supplier?')) {
          { const _o = suppliers.find(c => c.id === editingId); if (_o) trashPush('supplier', _o); }
          suppliers = suppliers.filter(s => s.id !== editingId);
          persist();
          toast('Deleted');
          closeModal();
          setView('suppliers');
        }
        break;
      case 'inv-filter': invFilter = t.dataset.kind || 'all'; render(); break;
      case 'receive-payment': { const c = customers.find(x => x.id === id); if (c) openReceiveModal(c); break; }
      case 'open-statement': { const c = customers.find(x => x.id === id); if (c) openStatement(c); break; }
      case 'statement-pdf': { const c = customers.find(x => x.id === id); if (c) statementPDF(c); break; }
      case 'statement-wa': { const c = customers.find(x => x.id === id); if (c) sendWhatsApp(c.phone, statementText(c)); break; }
      case 'remind-customer': { const c = customers.find(x => x.id === id); if (c) { sendWhatsApp(c.phone, reminderText(c)); (settings.remindedOn = settings.remindedOn || {})[c.id] = new Date().toISOString().slice(0, 10); persist(); if (currentView === 'payment-reminders') setTimeout(render, 300); } break; }
      case 'remind-invoice': { const inv = invoices.find(x => x.id === id); if (inv) { const c = custOfInvoice(inv); sendWhatsApp(c.phone, reminderText(c, inv)); } break; }
      case 'db-range': dbRange = t.dataset.v; render(); break;
      case 'db-mode': dbMode = t.dataset.v; render(); break;
      case 'rp-mode': { const row = t.parentElement; row.querySelectorAll('.cat-chip').forEach(x => x.classList.toggle('active', x === t)); break; }
      case 'new-purchase': docCtx = { type: 'purchase' }; closeModal(); setView('create-invoice'); break;
      case 'view-purchase': { const p = purchases.find(x => x.id === id); if (p) openPurchaseDetail(p); break; }
      case 'purchase-pay': {
        const p = purchases.find(x => x.id === id); if (!p) break;
        const amt = parseFloat($('#recordPayInput') && $('#recordPayInput').value) || 0;
        if (amt <= 0) { toast('Enter a valid amount'); break; }
        addPayment(p, amt, pickedMode('rpMode'), ''); persist(); toast('Payment recorded'); openPurchaseDetail(p); if (currentView === 'purchases') render(); break;
      }
      case 'purchase-pay-full': {
        const p = purchases.find(x => x.id === id); if (!p) break;
        addPayment(p, (p.total || 0) - (p.paidAmount || 0), pickedMode('rpMode'), ''); persist(); toast('Marked as paid'); openPurchaseDetail(p); if (currentView === 'purchases') render(); break;
      }
      case 'view-supplier': { const sp = suppliers.find(x => x.id === id); if (sp) openSupplierDetail(sp); break; }
      case 'pay-supplier': { const sp = suppliers.find(x => x.id === id); if (sp) openPaySupplierModal(sp); break; }
      case 'new-estimate': docCtx = { type: 'estimate' }; closeModal(); setView('create-invoice'); break;
      case 'convert-estimate': {
        const q = invoices.find(x => x.id === id);
        if (q) { docCtx = { type: 'sale', from: q }; closeModal(); setView('create-invoice'); }
        break;
      }
      case 'new-return': docCtx = { type: 'return' }; closeModal(); setView('create-invoice'); break;
      case 'return-from-invoice': {
        const inv = invoices.find(x => x.id === id);
        if (inv) { docCtx = { type: 'return', ref: inv }; closeModal(); setView('create-invoice'); }
        break;
      }
      case 'view-invoice': {
        const inv = invoices.find(x => x.id === id);
        if (inv) openInvoiceDetail(inv);
        break;
      }
      case 'pdf-invoice': {
        const inv = invoices.find(x => x.id === id);
        if (inv) generatePDF(inv);
        break;
      }
      case 'download-image': { const inv = invoices.find(x => x.id === id); if (inv) shareInvoiceImage(inv, true); break; }
      case 'share-image': {
        const inv = invoices.find(x => x.id === id);
        if (inv) shareInvoiceImage(inv);
        break;
      }
      case 'share-whatsapp-text': {
        const inv = invoices.find(x => x.id === id);
        if (inv) shareWhatsAppText(inv);
        break;
      }
      case 'rc-paper': { HisablyReceipt.setPrefs({ paper: t.dataset.paper }); openPrintModal(); break; }
      case 'rc-print': rcBrowserPrint(); break;
      case 'rc-save-image': rcSaveImage(); break;
      case 'rc-bt-print': rcBluetooth(false); break;
      case 'rc-bt-test': rcBluetooth(true); break;
      case 'print-invoice': {
        const inv = invoices.find(x => x.id === id);
        if (inv) printInvoice(inv);
        break;
      }
      case 'open-theme-from-print': closeModal(); setView('invoice-theme'); break;
      case 'print-a4': {
        const inv = invoices.find(x => x.id === (id || (printTarget && printTarget.id)));
        if (inv && tplOK()) BillauraTemplates.printDoc(inv, tplCtx(), {});
        break;
      }
      case 'cycle-print-text': { const o=['small','medium','large']; settings.printTextSize = o[(o.indexOf(settings.printTextSize||'medium')+1)%3]; persist(); render(); break; }
      case 'cycle-page-size': { const o=['A4','A5','Letter']; settings.printPageSize = o[(o.indexOf(settings.printPageSize||'A4')+1)%3]; persist(); render(); break; }
      case 'set-inv-template': settings.invoiceTemplate = t.dataset.value; persist(); render(); break;
      case 'set-inv-color': settings.invoiceColor = t.dataset.value; persist(); render(); break;
      case 'set-print-text': settings.printTextSize = t.dataset.value; persist(); render(); break;
      case 'set-page-size': settings.printPageSize = t.dataset.value; persist(); render(); break;
      case 'set-orient': settings.printOrientation = t.dataset.value; persist(); render(); break;
      case 'preview-invoice-template': {
        const inv = invoices[0] || sampleInvoice();
        if (tplOK()) BillauraTemplates.printDoc(inv, tplCtx(), {});
        break;
      }
      case 'open-settings': openSettingsModal(); break;
      case 'close-modal': closeModal(); break;
      case 'toggle-select': {
        const wrap = t.closest('.custom-select');
        if (!wrap) break;
        $$('.custom-select.open').forEach(el => {
          if (el !== wrap) el.classList.remove('open');
        });
        wrap.classList.toggle('open');
        if (wrap.classList.contains('open') && wrap.classList.contains('searchable')) {
          const searchInput = wrap.querySelector('.custom-select-search-input');
          if (searchInput) {
            searchInput.value = '';
            wrap.querySelectorAll('.custom-select-option').forEach(o => o.style.display = '');
            setTimeout(() => searchInput.focus(), 50);
          }
        }
        break;
      }
      case 'select-option': {
        const wrap = t.closest('.custom-select');
        if (!wrap) break;
        const value = t.dataset.value || '';
        const label = t.dataset.label || '';
        const hidden = wrap.querySelector('input[type="hidden"]');
        const trigger = wrap.querySelector('.custom-select-trigger');
        if (hidden) hidden.value = value;
        if (trigger) trigger.textContent = label;
        wrap.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
        t.classList.add('selected');
        wrap.classList.remove('open');

        // Choosing "Walk-in Customer" clears the typed customer
        if (wrap.dataset.name === 'customerId' && !value) {
          const ni = $('#customerNameInput'), pi = $('#customerPhoneInput');
          if (ni) ni.value = '';
          if (pi) pi.value = '';
        }
        // Auto-fill customer name/phone when selecting a customer
        if (wrap.dataset.name === 'customerId' && value) {
          const c = customers.find(x => x.id === value);
          if (c) {
            const nameInput = $('#customerNameInput');
            const phoneInput = $('#customerPhoneInput');
            if (nameInput) nameInput.value = c.name;
            if (phoneInput) phoneInput.value = c.phone || '';
          }
        }
        if (hidden) hidden.dispatchEvent(new Event('change', { bubbles: true }));
        // Show amount paid field for partial payments
        if (wrap.dataset.name === 'paymentStatus') {
          const grp = $('#paidAmountGroup');
          if (grp) grp.style.display = value === 'partial' ? 'block' : 'none';
        }
        break;
      }
      case 'record-payment': {
        const inv = invoices.find(x => x.id === id);
        if (!inv) break;
        const input = $('#recordPayInput');
        const amt = parseFloat(input && input.value) || 0;
        if (amt <= 0) { toast('Enter a valid amount'); break; }
        const dueNow = Math.max(0, round2((inv.total || 0) - (inv.paidAmount || 0)));
        let over = false;
        if (amt > dueNow + 0.001) {
          const walkIn = !inv.customerId && (!inv.customerName || inv.customerName === 'Walk-in Customer');
          if ((inv.docType !== 'sale' && inv.docType) || walkIn) { toast('Only ' + settings.currency + ' ' + money(dueNow) + ' is pending'); break; }
          if (!(await askConfirm(settings.currency + ' ' + money(round2(amt - dueNow)) + ' is more than the amount due. Keep the extra as customer credit (you owe it back or adjust it on the next bill)?', { title: 'Extra payment' }))) break;
          over = true;
        }
        addPayment(inv, amt, pickedMode('rpMode'), '', undefined, over);
        persist();
        toast(over ? 'Payment recorded · extra kept as customer credit' : 'Payment recorded');
        render();
        openInvoiceDetail(inv);
        break;
      }
      case 'refund-credit': {
        const inv = invoices.find(x => x.id === id); if (!inv) break;
        const extra = Math.max(0, round2((inv.paidAmount || 0) - (inv.total || 0)));
        if (extra <= 0.001) { toast('No credit to refund'); break; }
        const v = await askPrompt('Amount to refund (up to ' + settings.currency + ' ' + money(extra) + ')', String(extra), { title: 'Refund credit' });
        if (v == null) break;
        const amt = round2(parseFloat(v) || 0);
        if (!(amt > 0)) { toast('Enter an amount'); break; }
        if (amt > extra + 0.001) { toast('Only ' + settings.currency + ' ' + money(extra) + ' can be refunded'); break; }
        inv.paidAmount = round2((inv.paidAmount || 0) - amt);
        inv.meta = inv.meta || {}; (inv.meta.payments = inv.meta.payments || []).push({ date: new Date().toISOString(), amount: -amt, mode: 'Refund', note: 'Credit refunded' });
        inv.updatedAt = new Date().toISOString();
        persist(); toast('Credit refunded'); render(); openInvoiceDetail(inv); break;
      }
      case 'mark-paid': {
        const inv = invoices.find(x => x.id === id);
        if (!inv) break;
        addPayment(inv, inv.total - (inv.paidAmount || 0), pickedMode('rpMode'), '');
        inv.paidAmount = inv.total;
        inv.paymentStatus = 'paid';
        persist();
        toast('Marked as paid');
        openInvoiceDetail(inv);
        if (currentView === 'invoices' || currentView === 'dashboard') render();
        break;
      }
      case 'stock-in': {
        const p = products.find(x => x.id === id);
        if (!p) break;
        const qtyInput = $('#stockInQty');
        const qty = parseInt(qtyInput && qtyInput.value, 10) || 0;
        if (qty <= 0) { toast('Enter quantity to add'); break; }
        p.stock = (p.stock || 0) + qty;
        stockMovements.unshift({
          id: uid(),
          productId: p.id,
          productName: p.name,
          type: 'in',
          qty,
          date: new Date().toISOString(),
          note: 'Stock in'
        });
        persist();
        toast(`+${qty} added to stock`);
        if (qtyInput) qtyInput.value = '';
        // refresh modal product stock field if present
        const stockField = document.querySelector('#productForm input[name="stock"]');
        if (stockField) stockField.value = p.stock;
        break;
      }
      case 'add-expense': openExpenseModal(); break;
      case 'edit-expense': {
        const exp = expenses.find(x => x.id === id);
        if (exp) openExpenseModal(exp);
        break;
      }
      case 'delete-expense':
        if (await askConfirm('Delete this expense?')) {
          { const _o = expenses.find(c => c.id === editingId); if (_o) trashPush('expense', _o); }
          expenses = expenses.filter(x => x.id !== editingId);
          persist();
          toast('Deleted');
          closeModal();
          setView('expenses');
        }
        break;
      case 'pick-logo': bindBrandFile('logoFile', 'logo', 'logoPreview', 'Logo'); break;
      case 'pick-logo-legacy': {
        const fileInput = $('#logoFile');
        if (!fileInput) break;
        fileInput.onchange = () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return;
          if (file.size > 500 * 1024) { toast('Logo must be under 500KB'); return; }
          const reader = new FileReader();
          reader.onload = async () => {
            const dataUrl = reader.result;
            // Resize roughly via canvas if large
            const img = new Image();
            img.onload = () => {
              const max = 200;
              let w = img.width, h = img.height;
              if (w > max || h > max) {
                if (w > h) { h = Math.round(h * max / w); w = max; }
                else { w = Math.round(w * max / h); h = max; }
              }
              const canvas = document.createElement('canvas');
              canvas.width = w; canvas.height = h;
              canvas.getContext('2d').drawImage(img, 0, 0, w, h);
              const resized = canvas.toDataURL('image/png');
              settings.logo = resized;
              const prev = $('#logoPreview');
              if (prev) prev.innerHTML = `<img src="${resized}" alt="Logo" />`;
              toast('Logo ready – tap Save Settings');
            };
            img.src = dataUrl;
          };
          reader.readAsDataURL(file);
        };
        fileInput.click();
        break;
      }
      case 'remove-logo':
        settings.logo = '';
        const prev = $('#logoPreview');
        if (prev) prev.innerHTML = '<span>No logo</span>';
        toast('Logo removed – tap Save Settings');
        break;
      case 'pick-qr': bindBrandFile('qrFile', 'paymentQr', 'qrPreview', 'Payment QR'); break;
      case 'pick-qr-legacy': {
        const fileInput = $('#qrFile');
        if (!fileInput) break;
        fileInput.onchange = () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return;
          if (file.size > 800 * 1024) { toast('QR image must be under 800KB'); return; }
          const reader = new FileReader();
          reader.onload = async () => {
            const img = new Image();
            img.onload = () => {
              const max = 400;
              let w = img.width, h = img.height;
              if (w > max || h > max) {
                if (w > h) { h = Math.round(h * max / w); w = max; }
                else { w = Math.round(w * max / h); h = max; }
              }
              const canvas = document.createElement('canvas');
              canvas.width = w; canvas.height = h;
              canvas.getContext('2d').drawImage(img, 0, 0, w, h);
              settings.paymentQr = canvas.toDataURL('image/png');
              const prev = $('#qrPreview');
              if (prev) prev.innerHTML = `<img src="${settings.paymentQr}" alt="QR" />`;
              toast('Payment QR ready – tap Save Settings');
            };
            img.src = reader.result;
          };
          reader.readAsDataURL(file);
        };
        fileInput.click();
        break;
      }
      case 'remove-qr':
        settings.paymentQr = '';
        const qprev = $('#qrPreview');
        if (qprev) qprev.innerHTML = '<span>No QR</span>';
        toast('QR removed – tap Save Settings');
        break;
      case 'filter-select':
        // handled by input listener
        break;
      case 'scan-barcode':
        startScanner(code => {
          const input = $('#barcodeInput');
          if (input) input.value = code;
          toast('Barcode scanned');
        });
        break;
      case 'pick-signature': bindBrandFile('sigFile', 'signature', 'sigPreview', 'Signature'); break;
      case 'remove-signature': settings.signature = ''; persist(); toast('Signature removed'); if (currentView==='business-profile') render(); break;
      case 'pick-stamp': bindBrandFile('stampFile', 'stamp', 'stampPreview', 'Stamp'); break;
      case 'remove-stamp': settings.stamp = ''; persist(); toast('Stamp removed'); if (currentView==='business-profile') render(); break;
      case 'remove-qr': settings.paymentQr = ''; persist(); toast('QR removed'); if (currentView==='business-profile') render(); break;
      
      case 'pos-add': {
        if (e.target.closest('[data-action="toggle-fav"]')) break;
        posAdd(t.dataset.id);
        break;
      }
      case 'toggle-fav': {
        e.preventDefault();
        e.stopPropagation();
        const id = t.dataset.id;
        if (!settings.favourites) settings.favourites = [];
        const i = settings.favourites.indexOf(id);
        if (i >= 0) settings.favourites.splice(i, 1);
        else settings.favourites.push(id);
        persist();
        if (window._posRenderGrid) window._posRenderGrid(window._posFilter || 'fav', (document.getElementById('posSearch')||{}).value);
        else if (currentView === 'pos') { $('#appContent').innerHTML = viewPOS(); bindPOS(); }
        break;
      }
      case 'pos-checkout': {
        const lines = window._posLines || [];
        if (!lines.length) { toast('Add items first'); break; }
        // Convert POS cart into create-invoice flow
        docCtx = { type: 'sale', posLines: lines.map(l => Object.assign({}, l)) };
        window._posLines = [];
        setView('create-invoice');
        toast('Review & save invoice');
        break;
      }
      case 'scan-pos-barcode':
        startScanner(code => {
          const p = products.find(x => (x.barcode || '').toLowerCase() === code.toLowerCase());
          if (!p) { toast('Product not found'); return; }
          posAdd(p.id);
          toast('+1 ' + p.name);
        });
        break;
      case 'save-stock-adjust': {
        const pid = (document.getElementById('saProduct')||{}).value;
        const qty = parseFloat((document.getElementById('saQty')||{}).value || '');
        const reason = (document.getElementById('saReason')||{}).value || 'Adjustment';
        const note = (document.getElementById('saNote')||{}).value || '';
        const dirBtn = document.querySelector('#saDir .cat-chip.active');
        const dir = dirBtn ? dirBtn.dataset.dir : 'out';
        if (!pid) { toast('Select a product'); break; }
        if (!(qty >= 0)) { toast('Enter quantity'); break; }
        const pr = products.find(x => x.id === pid);
        if (!pr) break;
        const before = pr.stock || 0;
        let after = before;
        if (dir === 'in') after = before + qty;
        else if (dir === 'out') after = before - qty;
        else after = qty;
        pr.stock = after;
        try { window.BillauraExt && BillauraExt.onStock && BillauraExt.onStock(pr, after - before, 'adjust'); } catch (e) {}
        stockMovements.unshift({
          id: uid(), productId: pr.id, productName: pr.name,
          type: after >= before ? 'in' : 'out',
          qty: Math.abs(after - before),
          date: new Date().toISOString(),
          note: 'Adjust: ' + reason + (note ? ' – ' + note : '')
        });
        persist();
        toast('Stock updated: ' + pr.name + ' ' + before + ' → ' + after);
        setView('stock-adjust');
        break;
      }
      case 'duplicate-invoice': {
        const inv = invoices.find(x => x.id === id);
        if (!inv || !inv.items || !inv.items.length) { toast('Nothing to duplicate'); break; }
        docCtx = { type: inv.docType === 'estimate' ? 'estimate' : 'sale', posLines: inv.items.map(it => ({ productId: it.productId, name: it.name, price: it.price, cost: it.cost||0, qty: it.qty, custom: it.custom })) };
        closeModal();
        setView('create-invoice');
        toast('Duplicated – review and save');
        break;
      }

      case 'stop-scanner': stopScanner(); break;
      case 'open-plans': openPlansModal(); break;
      case 'plan-pick': {
        const k = t.dataset.plan; if (!k) break; _planPick = k;
        document.querySelectorAll('.pl-card').forEach(c => { const on = c === t; c.classList.toggle('sel', on); const sl = c.querySelector('.pl-sel'); if (sl) sl.textContent = on ? '● Selected' : 'Choose ' + c.querySelector('.pl-name').textContent; });
        const pi = $('#paidPlanSelect'); if (pi) pi.value = k;
        const nm = $('#plSelName'), am = $('#plSelAmt'); if (nm) nm.textContent = k.charAt(0).toUpperCase() + k.slice(1); if (am) am.textContent = t.dataset.amt;
        _promo = null; { const pm = $('#promoMsg'); if (pm) pm.textContent = ''; const pc = $('#promoCode'); if (pc && pc.value.trim()) applyPromo(); }
        break;
      }
      case 'apply-promo': applyPromo(); break;
      case 'copy-pay': { const v = t.dataset.v || ''; try { navigator.clipboard.writeText(v); toast('Copied ' + v); } catch (e) { toast(v); } break; }
      case 'open-shopify': openShopifyModal(); break;
      case 'shopify-sync': shopifyManualSync(false); break;
      case 'shopify-full': shopifyManualSync(true); break;
      case 'shopify-disconnect':
        if (await askConfirm('Disconnect Shopify? Your products and invoices in Billaura stay; syncing stops.')) {
          shopifyBusy('Disconnecting…');
          HisablyCloud.shopifyCall('disconnect', {}).then(() => { setShopifyOn(false); toast('Shopify disconnected'); }).catch(e => toast(e.message, 5000)).finally(openShopifyModal);
        }
        break;
      case 'submit-payment': submitPayment(); break;
      case 'sign-out-user': signOutUser(); break;
      case 'cloud-auth': openCloudAuthModal(); break;
      case 'desktop-info': {
        const open = () => {
          $('#modalRoot').innerHTML = modalShell('Use Billaura on your computer', `<div style="padding:6px 22px 22px">
            <button class="dk-wa" data-action="desktop-wa">${ico('whatsapp')}<span>Share link on WhatsApp</span></button>
            <div class="dk-or"><i></i><b>OR</b><i></i></div>
            <button class="dk-mail" data-action="desktop-mail">Email me the link</button>
            <div class="dk-more">
              ${deferredInstall ? '<button class="dk-lnk" data-action="install-desktop">Install on this computer</button>' : ''}
              <a class="dk-lnk" href="${DESKTOP_REL}" target="_blank" rel="noopener">Download Windows app (.exe)</a>
              <button class="dk-lnk" data-action="copy-pay" data-v="${escapeHtml(desktopSite())}">Copy website link</button>
            </div></div>`);
        };
        showDesktopSplash(open);
        break;
      }
      case 'desktop-wa': {
        const ph = settings.phone ? waNumber(settings.phone) : '';
        window.open(`https://wa.me/${ph}?text=${encodeURIComponent(desktopMsg())}`, '_blank');
        break;
      }
      case 'desktop-mail': {
        let em = settings.email || '';
        try { const ss = window.HisablyCloud && HisablyCloud.getSession(); if (!em && ss && ss.user) em = ss.user.email || ''; } catch (e) {}
        window.open(`mailto:${encodeURIComponent(em).replace(/%40/g, '@')}?subject=${encodeURIComponent('Billaura Desktop link')}&body=${encodeURIComponent(desktopMsg())}`, '_self');
        break;
      }
      case 'install-desktop': {
        if (deferredInstall) { deferredInstall.prompt(); try { await deferredInstall.userChoice; } catch (e) {} deferredInstall = null; }
        closeModal();
        break;
      }
      case 'note-cta': {
        const n = noticeList().find(x => x.id === id);
        if (!n) break;
        markNoticesRead([n.id]); closeModal();
        if (n.cta_action === 'open-plans') openPlansModal();
        else if (n.cta_url) window.open(n.cta_url, '_blank');
        break;
      }
      case 'cloud-sync': doCloudSync(); break;
      case 'change-password': openChangePassword(); break;
      case 'do-change-password': doChangePassword(); break;
      case 'cloud-forgot-acct': {
        const email = ((HisablyFreemium.getSession() || {}).email || '').toLowerCase();
        HisablyCloud.sendPasswordReset(email, siteBase())
          .then(() => toast('Reset link sent to ' + email, 5000))
          .catch(err => toast(resetErrMsg(err), 4000));
        break;
      }
      case 'cloud-forgot': {
        const email = (($('#cloudEmail') || {}).value || '').trim().toLowerCase();
        if (!email) { toast('Enter your email first'); break; }
        HisablyCloud.sendPasswordReset(email, siteBase())
          .then(() => toast('Reset link sent. Open it from your email in a browser.', 5000))
          .catch(err => toast(resetErrMsg(err), 4000));
        break;
      }
      case 'cloud-signin': {
        const email = (($('#cloudEmail') || {}).value || '').trim();
        const password = ($('#cloudPassword') || {}).value;
        if (!email || !password) { toast('Enter email & password'); break; }
        HisablyCloud.signIn(email, password).then(async () => {
          claimDataFor(email);
          closeModal();
          toast('Signed in – syncing…');
          await refreshPlanFromCloud();
          await doCloudSync({ silent: false });
        }).catch(err => toast(err.message || 'Sign in failed'));
        break;
      }
      case 'export-data': {
        const data = { products, invoices, customers, suppliers, expenses, stockMovements, purchases, banks, bankTxns, otherIncome, loans, settings, invoiceCounter, exportedAt: new Date().toISOString() };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `billaura-backup-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        toast('Backup downloaded');
        break;
      }
      case 'import-data': {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.onchange = () => {
          const file = input.files && input.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = async () => {
            try {
              const data = JSON.parse(reader.result);
              if (!data || typeof data !== 'object') throw new Error('Invalid');
              if (await askConfirm('Replace current data with this backup?')) {
                applyBackupData(data);
                normalizeData();
                migrateIds();
                persist();
                migrateData();
                toast('Backup restored');
                setView('dashboard');
              }
            } catch (err) {
              toast('Invalid backup file');
            }
          };
          reader.readAsText(file);
        };
        input.click();
        break;
      }
      case 'clear-data': clearAllData(); break;
      case 'open-account': setView('account'); break;
      case 'open-csv': openCsvModal(); break;
      case 'csv-export': exportCSV(t.dataset.set); break;
      case 'show-auth': {
        if (!await askConfirm('Go to sign in / sign up? Your data on this phone stays.')) break;
        HisablyFreemium.clearSession(); showAuth();
        const au = document.getElementById('authScreen');
        if (au && t.dataset.tab === 'register') { au.innerHTML = renderAuthHTML('register'); bindAuthForm(); }
        break;
      }
    }
  });

  // Search handlers (delegated via input event)
  document.addEventListener('input', e => {
    if (e.target.classList.contains('custom-select-search-input')) {
      const q = e.target.value.trim().toLowerCase();
      const list = e.target.closest('.custom-select-options');
      if (!list) return;
      list.querySelectorAll('.custom-select-option').forEach(opt => {
        const text = opt.dataset.search || opt.textContent.toLowerCase();
        opt.style.display = text.includes(q) ? '' : 'none';
      });
      return;
    }
    if (e.target.id === 'productSearch') {
      const list = $('#productList');
      if (list) list.innerHTML = productListHTML(e.target.value);
    }
    if (e.target.id === 'customerSearch') {
      const q = e.target.value.trim().toLowerCase();
      const filtered = customers.filter(c =>
        c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)
      ).sort((a,b) => a.name.localeCompare(b.name));
      const list = $('#customerList');
      if (list) list.innerHTML = filtered.map(c => {
        const bal = customerBalance(c.id, c.name, c.phone);
        const dueHtml = bal.due > 0
          ? `<span class="list-item-badge badge-out">Due ${settings.currency} ${money(bal.due)}</span>`
          : (bal.total > 0 ? `<span class="list-item-badge badge-ok">Clear</span>` : '');
        return `<div class="list-item" data-action="view-customer" data-id="${c.id}">
          <div class="list-item-icon">${initials(c.name)}</div>
          <div class="list-item-body">
            <div class="list-item-title">${escapeHtml(c.name)}</div>
            <div class="list-item-sub">${escapeHtml(c.phone || 'No phone')}</div>
            ${dueHtml}
          </div>
          <div class="list-item-right"><div class="list-item-price">${bal.total ? settings.currency + ' ' + money(bal.total) : '—'}</div></div>
        </div>`;
      }).join('') || '<div class="text-center text-secondary" style="padding:32px 0">No customers found</div>';
    }
  });

  document.addEventListener('change', e => {
    if (e.target.id === 'bulkImportFile') {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { toast('File too large (max 5 MB)'); return; }
      const reader = new FileReader();
      reader.onload = () => openImportPreview(String(reader.result || ''));
      reader.onerror = () => toast('Could not read the file');
      reader.readAsText(file, 'utf-8');
    } else if (e.target.id === 'importUpdateStock' && pendingImportText) {
      renderImportPreview(e.target.checked);
    }
  });

  let _lastGuardHit = 0;
  window.addEventListener('popstate', (e) => {
    if (!document.getElementById('app') || document.getElementById('app').hidden) return;
    const st = e.state;
    if (st && st.guard) {
      if (Date.now() - _lastGuardHit < 2200) { _lastGuardHit = 0; history.back(); return; }
      _lastGuardHit = Date.now();
      try { history.pushState({ v: 'home', n: 0 }, '', '#home'); } catch (x) {}
      if (currentView !== 'home') { viewStack = []; setView('home', { _pop: true, keepHistory: true }); }
      toast('Press back again to exit', 2000);
      return;
    }
    const mr = document.getElementById('modalRoot');
    if (mr && mr.innerHTML.trim()) { closeModal(); try { history.pushState({ v: currentView, n: (st && st.n || 0) + 1 }, '', '#' + currentView); } catch (x) {} return; }
    const v = (st && st.v) || 'home';
    if (viewStack.length) viewStack.pop();
    setView(v, { _pop: true, keepHistory: true });
  });
  $('#backBtn').addEventListener('click', () => {
    if (history.state && history.state.n > 0) { history.back(); return; }
    if (viewStack && viewStack.length) {
      const prev = viewStack.pop();
      setView(prev, { keepHistory: true });
    } else if (previousView && previousView !== currentView) {
      setView(previousView, { keepHistory: true });
    } else {
      setView('more', { keepHistory: true });
    }
  });


  // ---------- Cloud sync (record-level, last-write-wins) ----------
  let _syncAgain = false;

  function emptyRemote(shop) {
    const r = { shop: shop || null };
    SYNC_COLLECTIONS.forEach(n => { r[DB_TABLE[n] || n] = { live: [], tombs: {} }; });
    return r;
  }

  // Merge one collection with what the cloud has. Pure + synchronous, so nothing the
  // user does can slip in between "read local" and "write local".
  function mergeCollection(name, remote) {
    const local = getList(name);
    const myTombs = tombs[name] || {};
    const rMap = new Map(remote.live.map(r => [r.id, r]));
    const seen = new Set();
    const out = [];
    const push = [];
    local.forEach(l => {
      seen.add(l.id);
      const rt = remote.tombs[l.id];
      if (rt) {
        if (ts(rt) >= ts(l.updatedAt)) return;       // deleted on another device -> drop here too
        out.push(l); push.push(l);                    // edited after that delete -> keep + restore
        return;
      }
      const r = rMap.get(l.id);
      if (!r) { out.push(l); push.push(l); return; }  // not in cloud yet
      if (ts(l.updatedAt) > ts(r.updatedAt)) { out.push(l); push.push(l); }
      else out.push(Object.assign({}, l, r));         // cloud copy is newer (or same)
    });
    remote.live.forEach(r => {
      if (!seen.has(r.id) && !myTombs[r.id]) out.push(r);   // new from another device
    });
    return { list: out, push };
  }

  function mergeSettings(remoteSettings) {
    const r = (remoteSettings && typeof remoteSettings === 'object') ? remoteSettings : {};
    const rt = ts(r.updatedAt), lt = ts(settings.updatedAt);
    // Fresh install / cleared data: the cloud profile always wins over empty defaults
    const localEmpty = !PROFILE_FIELDS.some(f => profileFilled(f[0]));
    if (localEmpty && Object.keys(r).length) { settings = Object.assign({}, settings, r); return null; }
    if (rt > lt) { settings = Object.assign({}, settings, r); return null; }
    if (lt > rt) return settings;
    return null;
  }

  function canRenderNow() {
    const modal = $('#modalRoot');
    const ae = document.activeElement;
    const typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.closest && ae.closest('#appContent');
    return currentView !== 'create-invoice' && currentView !== 'business-profile' && !typing && !(modal && modal.innerHTML.trim());
  }

  async function doCloudSync(opts = {}) {
    const silent = !!opts.silent;
    if (!window.HisablyCloud || !HisablyCloud.ready()) {
      if (!silent) toast('Online features are not available right now. Please try again later.');
      return false;
    }
    if (!HisablyCloud.getSession()) {
      if (!silent) toast('Sign in first (More → Cloud account)');
      return false;
    }
    if (!navigator.onLine) {
      if (!silent) toast('You are offline – changes are saved on this phone and will sync later');
      return false;
    }
    if (_cloudSyncing) { _syncAgain = true; return false; }
    _cloudSyncing = true;
    let ok = false;
    try {
      if (!silent) toast('Syncing…');
      let remote = await HisablyCloud.fetchRemote();      // throws if ANY read fails -> local data untouched
      if (localStorage.getItem(LEGACY_FLAG)) {
        await HisablyCloud.wipeRemoteData();               // one-time: v1 left random-id copies in the cloud
        remote = emptyRemote(remote.shop);
      }

      const _sigBefore = SYNC_COLLECTIONS.map(n => JSON.stringify(getList(n))).join('|') + JSON.stringify(settings);
      // ---- merge (synchronous) ----
      const changes = { tombs: JSON.parse(JSON.stringify(tombs)) };
      SYNC_COLLECTIONS.forEach(n => {
        const m = mergeCollection(n, remote[DB_TABLE[n] || n] || { live: [], tombs: {} });
        setList(n, m.list);
        changes[n] = m.push;
      });
      const sPush = mergeSettings(remote.shop && remote.shop.settings);
      if (sPush) changes.settings = sPush;
      normalizeData();
      invoices.sort((a, b) => ts(b.date) - ts(a.date));
      stockMovements.sort((a, b) => ts(b.date) - ts(a.date));
      resnap();                         // merged state is the new baseline (no re-stamping)
      saveAll();
      if (remote.shop) applyShopToPlan(remote.shop);
      const _sigAfter = SYNC_COLLECTIONS.map(n => JSON.stringify(getList(n))).join('|') + JSON.stringify(settings);
      if (_sigAfter !== _sigBefore && canRenderNow()) render();

      // ---- push only what changed ----
      await HisablyCloud.push(changes);
      SYNC_COLLECTIONS.forEach(n => {
        Object.keys(changes.tombs[n] || {}).forEach(id => { if (tombs[n]) delete tombs[n][id]; });
      });
      save(STORAGE.tombs, tombs);
      localStorage.removeItem(LEGACY_FLAG);
      localStorage.setItem('billaura_last_sync', new Date().toISOString());
      ok = true;
      if (!silent) toast('Synced');
      if (typeof maybeShopifySync === 'function' && !opts.noShopify) setTimeout(() => { maybeShopifySync().catch(() => {}); }, 50);
    } catch (err) {
      console.error('sync', err);
      const msg = String((err && err.message) || 'Sync failed').replace(/^LIMIT:\s*/, '');
      if (!silent || /free plan|inactive/i.test(msg)) toast(msg, 4000);
    } finally {
      _cloudSyncing = false;
      if (_syncAgain) { _syncAgain = false; scheduleCloudPush(); }
    }
    return ok;
  }

  async function initCloudAutoSync() {
    if (!window.HisablyCloud || !HisablyCloud.ready()) return;
    try {
      await HisablyCloud.init();
      const sess = HisablyFreemium.getSession();
      if (!HisablyCloud.getSession()) {
        if (sess && sess.mode === 'cloud' && navigator.onLine) {
          toast('Cloud session expired – sign in again (More → Cloud account)', 5000);
        }
        return;
      }
      await refreshPlanFromCloud();
      await doCloudSync({ silent: true });
      // Quiet sync every 5 minutes, when the app returns to the foreground, and when back online
      let tick = 0;
      setInterval(() => { tick++; if (!document.hidden && (shopifyOn() || tick % 5 === 0)) doCloudSync({ silent: true }); }, 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) doCloudSync({ silent: true });
      });
      window.addEventListener('online', () => doCloudSync({ silent: true }));
    } catch (err) {
      console.error('Cloud init', err);
    }
  }

  // Local data belongs to ONE account. If someone else signs in on this phone,
  // start clean so one shop's data can never be uploaded into another shop.
  function wipeLocalData() {
    products = []; invoices = []; customers = []; suppliers = []; expenses = []; stockMovements = []; purchases = [];
    settings = defaultSettings();
    invoiceCounter = 1001;
    tombs = {};
    localStorage.removeItem(LEGACY_FLAG);
    localStorage.removeItem('billaura_last_sync');
    HisablyFreemium.clearPlanCache();
    resnap();
    saveAll();
  }
  function claimDataFor(email) {
    const id = (email || '').trim().toLowerCase();
    const owner = localStorage.getItem(OWNER_KEY);
    if (owner && owner !== id) wipeLocalData();
    localStorage.setItem(OWNER_KEY, id);
  }

  function openChangePassword() {
    if (!window.HisablyCloud || !HisablyCloud.ready()) { toast('Needs an internet connection and a cloud account'); return; }
    $('#modalRoot').innerHTML = modalShell('Change password', `
      <div class="form-group"><label class="form-label">Current password</label><input type="password" class="form-input" id="cpOld" autocomplete="current-password" /></div>
      <div class="form-group"><label class="form-label">New password</label><input type="password" class="form-input" id="cpNew" autocomplete="new-password" placeholder="Min 6 characters" /></div>
      <div class="form-group"><label class="form-label">Confirm new password</label><input type="password" class="form-input" id="cpNew2" autocomplete="new-password" /></div>
      <div id="cpMsg" class="text-sm" style="color:#B91C1C;min-height:18px;margin-bottom:8px"></div>
      <button class="btn btn-primary btn-block" data-action="do-change-password">Save new password</button>
      <p class="auth-hint"><button type="button" class="auth-link" data-action="cloud-forgot-acct">Forgot your current password?</button></p>`);
  }
  async function doChangePassword() {
    const v = id => (document.getElementById(id) || {}).value || '';
    const say = m => { const el = document.getElementById('cpMsg'); if (el) el.textContent = m; };
    const old = v('cpOld'), nw = v('cpNew'), nw2 = v('cpNew2');
    const email = ((HisablyFreemium.getSession() || {}).email || '').toLowerCase();
    if (!old) return say('Enter your current password');
    if (nw.length < 6) return say('New password must be at least 6 characters');
    if (nw !== nw2) return say('The two new passwords do not match');
    if (nw === old) return say('Choose a different password from the current one');
    try {
      say('Saving…');
      await HisablyCloud.changePassword(email, old, nw);
      closeModal();
      toast('Password changed');
    } catch (err) {
      console.error(err);
      say(/WRONG_CURRENT|invalid login/i.test(String(err && err.message)) ? 'Current password is wrong' : resetErrMsg(err));
    }
  }

  async function signOutUser() {
    toast('Signing out…');
    try {
      if (window.HisablyCloud && HisablyCloud.ready() && HisablyCloud.getSession()) {
        // last chance to upload unsynced work (max 4s so sign-out never hangs offline)
        await Promise.race([doCloudSync({ silent: true }), new Promise(r => setTimeout(r, 4000))]);
        await HisablyCloud.signOut();
      }
    } catch (e) { console.error(e); }
    HisablyFreemium.clearSession();
    if (onPublicWebsite()) { location.replace(siteBase() + 'landing'); return; }   // browser users go back to the website
    location.reload();
  }

  async function applyPromo() {
    const code = (($('#promoCode') || {}).value || '').trim().toUpperCase();
    const plan = ($('#paidPlanSelect') || {}).value || 'basic';
    const msg = $('#promoMsg'), am = $('#plSelAmt');
    const say = (t, ok) => { if (msg) { msg.textContent = t; msg.style.color = ok ? '#168a4a' : '#d6283a'; } };
    if (!code) { _promo = null; say('', true); return; }
    if (!(window.HisablyCloud && HisablyCloud.ready() && HisablyCloud.getSession())) { say('Sign in to your cloud account to use a promo code.', false); return; }
    say('Checking…', true);
    try {
      const r = await HisablyCloud.checkPromo(code, plan);
      if (!r.ok) { _promo = null; say(r.message || 'This code is not valid', false); return; }
      _promo = { code: r.code, plan, final: r.final, list: r.list };
      if (am) am.textContent = Number(r.final).toLocaleString('en-US');
      say('✓ Code applied: you save ' + Number(r.off).toLocaleString('en-US') + ' – pay ' + Number(r.final).toLocaleString('en-US'), true);
    } catch (e) { _promo = null; say(String((e && e.message) || 'Could not check the code'), false); }
  }

  async function submitPayment() {
    const plan = ($('#paidPlanSelect') || {}).value || 'basic';
    const note = (($('#paidNote') || {}).value || '').trim();
    const sess = HisablyFreemium.getSession() || {};
    const shopName = sess.shopName || settings.businessName;
    if (!note) { toast('Enter your transaction ID or the phone number you paid from'); return; }
    if (window.HisablyCloud && HisablyCloud.ready() && HisablyCloud.getSession()) {
      try {
        await HisablyCloud.submitPaymentRequest({ planId: plan, note, shopName, promoCode: (_promo && _promo.plan === plan) ? _promo.code : null });
      } catch (err) {
        toast(err.message || 'Could not send. Check your internet and try again.', 4000);
        return;
      }
    } else {
      // Not connected to the cloud: keep it on this device only (testing)
      const key = 'billaura_payment_requests_v1';
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      list.unshift({ id: uid(), email: sess.email, shopName, plan, note, status: 'pending', createdAt: new Date().toISOString() });
      localStorage.setItem(key, JSON.stringify(list));
    }
    _promo = null;
    toast('Payment reported. Admin will activate your plan.', 3500);
    closeModal();
  }

  function openCloudAuthModal() {
    if (!window.HisablyCloud || !HisablyCloud.ready()) {
      toast('Cloud is not set up for this app');
      return;
    }
    const signed = HisablyCloud.getSession();
    $('#modalRoot').innerHTML = `
      <div class="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-handle"></div>
          <div class="modal-header">
            <h3 class="modal-title">Cloud account</h3>
            <button class="modal-close" data-action="close-modal"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
          ${signed ? `
            <p class="text-sm text-secondary mb-8">Signed in as <strong>${escapeHtml((signed.user && signed.user.email) || '')}</strong>. Auto-sync is <strong>on</strong>.</p>
            <p class="text-sm text-secondary mb-16">Changes upload a few seconds after you edit, and other devices' changes are merged in. It also works offline – everything syncs when you are back online.${lastSyncLabel()}</p>
            <button class="btn btn-primary btn-block" data-action="cloud-sync">Sync now</button>
          ` : `
            <p class="text-sm text-secondary mb-12">Your cloud session expired. Sign in again to keep syncing. Your data on this phone is safe.</p>
            <div class="form-group"><label class="form-label">Email</label><input type="email" class="form-input" id="cloudEmail" value="${escapeHtml((HisablyFreemium.getSession() || {}).email || '')}" /></div>
            <div class="form-group"><label class="form-label">Password</label><input type="password" class="form-input" id="cloudPassword" /></div>
            <button class="btn btn-primary btn-block" data-action="cloud-signin">Sign in</button>
            <p class="auth-hint"><button type="button" class="auth-link" data-action="cloud-forgot">Forgot password?</button></p>
          `}
        </div>
      </div>`;
  }

  // ---------- Auth gate + freemium ----------
  function hideBoot() {
    const boot = document.getElementById('bootScreen');
    if (!boot || boot.dataset.hiding) return;
    boot.dataset.hiding = '1';
    // keep the splash visible for a moment so the Billaura name registers, then fade it out
    const inApp = (window.matchMedia && window.matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches) || navigator.standalone === true || !!window.Capacitor;
    const wait = document.documentElement.classList.contains('cap-app') ? 0 : Math.max(0, (inApp ? 1300 : 1500) - (performance.now() || 0));   // browser tab: let the animated splash play once; installed app: phone already showed its own
    setTimeout(() => { boot.classList.add('out'); setTimeout(() => { boot.hidden = true; }, 220); }, wait);
  }
  function showAuth(mode, msg, kind) {
    hideBoot();
    const appEl = document.getElementById('app');
    const auth = document.getElementById('authScreen');
    if (appEl) appEl.hidden = true;
    if (auth) {
      auth.hidden = false;
      auth.innerHTML = renderAuthHTML(mode || 'login');
      bindAuthScreen();
      if (msg) authSay(msg, kind || 'info');
      try { if (!mode && localStorage.getItem('billaura_demo_removed')) { localStorage.removeItem('billaura_demo_removed'); authSay('Demo mode was removed. Create a free account or sign in – your data on this phone is kept.', 'info'); } } catch (e) {}
    }
  }

  function showAppShell() {
    hideBoot();
    const appEl = document.getElementById('app');
    const auth = document.getElementById('authScreen');
    if (auth) auth.hidden = true;
    if (appEl) appEl.hidden = false;
  }

  function renderAuthHTML(mode, prefillEmail) {
    const brand = `<div class="auth-brand">
        <img src="assets/icon-192.png" alt="Billaura" class="brand-mark" width="64" height="64" />
        <h1>Billaura</h1>
        <p>Inventory & invoices for micro sellers</p>
      </div>`;
    const foot = `<p class="auth-hint" style="font-size:.72rem;margin-top:14px">© ${new Date().getFullYear()} Billaura. All rights reserved. Unauthorised copying or resale of this software is prohibited. <a href="terms" target="_blank" rel="noopener">Terms &amp; Licence</a></p>`;
    const em = escapeHtml(prefillEmail || '');
    if (mode === 'forgot') {
      return `<div class="auth-card">${brand}
      <h2 class="auth-title">Forgot your password?</h2>
      <p class="auth-sub">Enter the email you signed up with and we will send you a link to choose a new password.</p>
      <div id="authMsg" class="auth-msg" role="alert"></div>
      <form id="forgotForm">
        <div class="form-group"><label class="form-label">Email</label><input class="form-input" name="email" type="email" required autocomplete="email" placeholder="you@email.com" value="${em}" /></div>
        <button type="submit" class="btn btn-primary btn-block">Send reset link</button>
      </form>
      <p class="auth-hint"><button type="button" class="auth-link" data-auth-tab="login">← Back to sign in</button></p>
      ${foot}</div>`;
    }
    if (mode === 'recovery') {
      return `<div class="auth-card">${brand}
      <h2 class="auth-title">Choose a new password</h2>
      <p class="auth-sub">Type a new password for your Billaura account.</p>
      <div id="authMsg" class="auth-msg" role="alert"></div>
      <form id="resetForm">
        <div class="form-group"><label class="form-label">New password</label><input class="form-input" name="password" type="password" required minlength="6" autocomplete="new-password" placeholder="Min 6 characters" /></div>
        <div class="form-group"><label class="form-label">Confirm new password</label><input class="form-input" name="password2" type="password" required minlength="6" autocomplete="new-password" placeholder="Type it again" /></div>
        <button type="submit" class="btn btn-primary btn-block">Save new password</button>
      </form>
      <p class="auth-hint"><button type="button" class="auth-link" data-auth-tab="login">Cancel</button></p>
      ${foot}</div>`;
    }
    const isLogin = mode !== 'register';
    return `<div class="auth-card">
      ${brand}
      <div class="auth-tabs">
        <button type="button" class="auth-tab ${isLogin ? 'active' : ''}" data-auth-tab="login">Sign in</button>
        <button type="button" class="auth-tab ${!isLogin ? 'active' : ''}" data-auth-tab="register">Sign up</button>
      </div>
      <div id="authMsg" class="auth-msg" role="alert"></div>
      <form id="authForm">
        ${!isLogin ? `<div class="form-group"><label class="form-label">Full name</label><input class="form-input" name="fullName" placeholder="Your name" /></div>
        <div class="form-group"><label class="form-label">Shop name</label><input class="form-input" name="shopName" placeholder="Business name" /></div>
        <div class="form-group"><label class="form-label">Phone</label><input class="form-input" name="phone" type="tel" placeholder="03XX..." /></div>` : ''}
        <div class="form-group"><label class="form-label">Email</label><input class="form-input" name="email" type="email" required placeholder="you@email.com" value="${em}" /></div>
        <div class="form-group"><label class="form-label">Password</label><input class="form-input" name="password" type="password" required minlength="6" placeholder="Min 6 characters" /></div>
        ${isLogin ? '<div class="auth-forgot"><button type="button" class="auth-link" data-auth-tab="forgot">Forgot password?</button></div>' : ''}
        <button type="submit" class="btn btn-primary btn-block">${isLogin ? 'Sign in' : 'Create free account'}</button>
      </form>
      <p class="auth-hint">Sign in to sync your shop across devices. Your data on this phone is kept.</p>
      ${onPublicWebsite() ? '<p class="auth-hint" style="margin-top:8px"><a href="landing">← Back to billaura website</a></p>' : ''}
      ${foot}
    </div>`;
  }

  function bindAuthScreen() {
    const auth = document.getElementById('authScreen');
    if (!auth) return;
    auth.onclick = (e) => {
      const tab = e.target.closest('[data-auth-tab]');
      if (tab) {
        const typed = ((auth.querySelector('input[name="email"]') || {}).value || '').trim();
        auth.innerHTML = renderAuthHTML(tab.dataset.authTab, typed);
        bindAuthForm();
        bindGuestBtn();
      }
    };
    bindAuthForm();
    bindGuestBtn();
  }

  function bindGuestBtn() {
    return; // demo account removed
    const g = document.getElementById('guestBtn');
    if (!g) return;
    g.onclick = () => {
      try {
        // Ensure local signup is allowed for demo
        try { localStorage.setItem('billaura_allow_local_signup', '1'); } catch (e) {}
        const email = 'demo@billaura.local';
        const password = 'demo1234';
        try {
          HisablyFreemium.localSignIn(email, password);
        } catch (_) {
          try {
            HisablyFreemium.localRegister({
              email, password,
              fullName: 'Demo Owner',
              shopName: settings.businessName || 'My Shop',
              phone: ''
            });
          } catch (e2) {
            // Force session even if register rules block
            HisablyFreemium.setSession({
              email, fullName: 'Demo Owner', shopName: settings.businessName || 'My Shop',
              phone: '', userId: 'guest_demo', mode: 'local'
            });
            if (HisablyFreemium.setPlanCache) {
              HisablyFreemium.setPlanCache({
                planId: 'trial', status: 'trial',
                trialEndsAt: new Date(Date.now() + 14*864e5).toISOString(),
                freemiumEnabled: true
              });
            }
          }
        }
        if (settings.businessName === 'My Business') {
          settings.businessName = 'My Shop';
          persist();
        }
        enterApp();
        toast('Offline demo mode — data stays on this device');
      } catch (err) {
        console.error(err);
        authSay(String(err.message || err), 'error');
      }
    };
  }

  // Show messages on the sign-in card itself (always visible) AND as a toast
  function authSay(msg, kind) {
    toast(msg, 5000);
    const el = document.getElementById('authMsg');
    if (el) { el.textContent = msg; el.className = 'auth-msg show ' + (kind || 'info'); }
  }

  function resetErrMsg(err) {
    const m = String((err && err.message) || err || '');
    if (/RESET_LINK_EXPIRED/.test(m)) return 'This reset link has expired or was already used. Please request a new one.';
    if (/rate limit|too many|after \d+ seconds|security purposes/i.test(m)) return 'Too many attempts. Please wait a minute and try again.';
    if (/same password|different from the old/i.test(m)) return 'Choose a password you have not used before.';
    if (/weak|at least \d+ char/i.test(m)) return 'That password is too short or too weak. Use at least 6 characters.';
    if (/failed to fetch|network/i.test(m)) return 'No internet connection. Check your connection and try again.';
    return friendlyMsg(m);
  }

  function bindForgotForms() {
    const ff = document.getElementById('forgotForm');
    if (ff) ff.onsubmit = async (e) => {
      e.preventDefault();
      const email = String(new FormData(ff).get('email') || '').trim().toLowerCase();
      const btn = ff.querySelector('button[type="submit"]');
      if (!email) { authSay('Enter your email address', 'error'); return; }
      if (!window.HisablyCloud || !HisablyCloud.ready()) { authSay('Password reset needs an internet connection and a cloud account. Please connect and try again.', 'error'); return; }
      if (btn) btn.disabled = true;
      try {
        authSay('Sending…', 'info');
        await HisablyCloud.sendPasswordReset(email, siteBase());
        authSay('If an account exists for ' + email + ', a reset link is on its way. Check your inbox (and spam), then open the link in your browser.', 'ok');
      } catch (err) {
        console.error(err);
        authSay(resetErrMsg(err), 'error');
      } finally { if (btn) btn.disabled = false; }
    };
    const rf = document.getElementById('resetForm');
    if (rf) rf.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(rf);
      const pw = String(fd.get('password') || ''), pw2 = String(fd.get('password2') || '');
      const btn = rf.querySelector('button[type="submit"]');
      if (pw.length < 6) { authSay('Password must be at least 6 characters', 'error'); return; }
      if (pw !== pw2) { authSay('The two passwords do not match', 'error'); return; }
      if (btn) btn.disabled = true;
      try {
        authSay('Saving…', 'info');
        await HisablyCloud.prepareRecovery();
        await HisablyCloud.updatePassword(pw);
        try { HisablyFreemium.clearSession(); } catch (e2) {}
        showAuth('login', 'Password changed. Sign in with your new password.', 'ok');
      } catch (err) {
        console.error(err);
        if (/RESET_LINK_EXPIRED/.test(String((err && err.message) || ''))) showAuth('forgot', resetErrMsg(err), 'error');
        else authSay(resetErrMsg(err), 'error');
      } finally { if (btn) btn.disabled = false; }
    };
  }

  function bindAuthForm() {
    bindForgotForms();
    const form = document.getElementById('authForm');
    if (!form) return;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const email = (fd.get('email') || '').trim().toLowerCase();
      const password = fd.get('password') || '';
      const fullName = (fd.get('fullName') || '').trim();
      const shopName = (fd.get('shopName') || '').trim();
      const phone = (fd.get('phone') || '').trim();
      const isRegister = !!form.querySelector('[name="fullName"]');
      const btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      try {
        const cloudReady = window.HisablyCloud && HisablyCloud.ready();
        // Local signup is disabled — accounts must be created via cloud (Supabase)
        if (isRegister && !cloudReady) {
          // Fall back to local account when cloud is offline
          try { localStorage.setItem('billaura_allow_local_signup', '1'); } catch (e) {}
        }
        if (isRegister && (!fullName || !shopName)) {
          authSay('Please enter your name and shop name', 'error');
          return;
        }
        authSay(isRegister ? 'Creating account…' : 'Signing in…', 'info');
        let profShopName = shopName;
        if (cloudReady) {
          if (isRegister) {
            const res = await HisablyCloud.signUp({ email, password, fullName, shopName, phone });
            if (res.needsConfirm) {
              const auth = document.getElementById('authScreen');
              auth.innerHTML = renderAuthHTML('login');
              bindAuthForm();
              authSay('Account created! Open the confirmation email we sent, then sign in.', 'ok');
              return;
            }
          } else {
            await HisablyCloud.signIn(email, password);
          }
          claimDataFor(email);
          const prof = HisablyCloud.getProfile() || {};
          profShopName = (prof.shops && prof.shops.name) || shopName || 'My Shop';
          HisablyFreemium.setSession({
            email,
            fullName: prof.full_name || fullName || email,
            shopName: profShopName,
            phone: prof.phone || phone,
            mode: 'cloud'
          });
          await refreshPlanFromCloud();
        } else {
          // Offline / local accounts
          try { localStorage.setItem('billaura_allow_local_signup', '1'); } catch (e) {}
          if (isRegister) {
            HisablyFreemium.localRegister({ email, password, fullName, shopName, phone });
            profShopName = shopName || 'My Shop';
          } else {
            HisablyFreemium.localSignIn(email, password);
          }
          claimDataFor(email);
        }
        // Signing in on a fresh install: the profile saved in the cloud always wins over the sign-up name
        let cloudProfile = null;
        if (!isRegister && window.HisablyCloud && HisablyCloud.ready() && HisablyCloud.getSession()) {
          try { const sh = await HisablyCloud.fetchShop(); const rs = sh && sh.settings; if (rs && typeof rs === 'object' && rs.businessName && rs.businessName !== 'My Business') cloudProfile = rs; } catch (e) { /* fall back to seeding */ }
        }
        if (cloudProfile) {
          settings = Object.assign({}, settings, cloudProfile);
          persist();
        }
        // A new account starts with a blank, white-label profile (0% complete); nothing is copied from sign-up
        enterApp();
        toast(isRegister ? 'Welcome! 14-day trial started' : 'Welcome back');
      } catch (err) {
        console.error(err);
        const m = String((err && err.message) || 'Auth failed');
        authSay(/invalid login/i.test(m) ? 'Wrong email or password' : /confirm/i.test(m) ? 'Please confirm your email first, then sign in' : /failed to fetch|network/i.test(m) ? 'No internet connection or server unreachable. Check your connection and try again.' : friendlyMsg(m), 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    };
  }

  // Pull plan + payment details + server clock from the cloud into the offline cache
  function applyShopToPlan(shop, plat, offsetMs) {
    const patch = {};
    if (shop) {
      Object.assign(patch, {
        planId: shop.plan_id || 'free',
        status: shop.status || 'trial',
        trialEndsAt: shop.trial_ends_at || null,
        paidUntil: shop.paid_until || null,
        shopId: shop.id
      });
    }
    if (typeof offsetMs === 'number' && isFinite(offsetMs)) patch.serverOffsetMs = offsetMs;
    if (plat) {
      patch.freemiumEnabled = plat.freemium_enabled !== false;
      patch.payment = Object.assign({}, HisablyFreemium.DEFAULT_PAY, {
        jazzcash: plat.jazzcash || '',
        easypaisa: plat.easypaisa || '',
        bankName: plat.bank_name || '',
        bankAccount: plat.bank_account || '',
        bankTitle: plat.bank_title || '',
        note: plat.payment_note || HisablyFreemium.DEFAULT_PAY.note,
        basicPrice: Number(plat.basic_price) || HisablyFreemium.DEFAULT_PAY.basicPrice,
        proPrice: Number(plat.pro_price) || HisablyFreemium.DEFAULT_PAY.proPrice,
        lifetimePrice: Number(plat.lifetime_price) || HisablyFreemium.DEFAULT_PAY.lifetimePrice,
        currency: plat.currency || 'PKR'
      });
    }
    HisablyFreemium.setPlanCache(patch);
  }

  async function refreshPlanFromCloud() {
    try {
      if (window.HisablyCloud && HisablyCloud.ready() && HisablyCloud.getSession()) {
        const [shop, plat, offset] = await Promise.all([
          HisablyCloud.fetchShop(),
          HisablyCloud.fetchPlatformSettings().catch(() => null),
          HisablyCloud.serverOffsetMs().catch(() => undefined)
        ]);
        applyShopToPlan(shop, plat, offset);
        if (window.BillauraLicense && BillauraLicense.enabled()) {
          const lr = await BillauraLicense.refresh();
          if (!lr.ok && (lr.code === 'device_limit' || lr.code === 'device_revoked') && lr.message) toast(lr.message, 8000);
          window._lastPlanKey = undefined;
        }
        if (currentView === 'dashboard' && canRenderNow() && JSON.stringify(HisablyFreemium.effectivePlan().key) !== window._lastPlanKey) { window._lastPlanKey = JSON.stringify(HisablyFreemium.effectivePlan().key); render(); }
      }
    } catch (e) {
      console.error('plan refresh', e);
      // Don't silently show "Free": tell the user their plan could not be loaded
      if (navigator.onLine) toast('Could not load your plan. Check your internet connection, then reopen the app.', 6000);
    }
  }

  // ---------- Notifications (announcements from the admin + app-update notice) ----------
  const ANN_KEY = 'billaura_ann_v1', ANN_READ = 'billaura_ann_read_v1', ANN_POP = 'billaura_ann_popped_v1';
  const APK_URL = 'https://github.com/faisalchaudhary411/billaura/releases/latest/download/Billaura.apk';
  const jget = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? fb : v; } catch (e) { return fb; } };
  const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  let announcements = jget(ANN_KEY, []);
  let annRead = new Set(jget(ANN_READ, []));
  let annPopped = new Set(jget(ANN_POP, []));
  let updateNotice = null;
  function noticeList() { const l = announcements.slice(); if (updateNotice) l.unshift(updateNotice); return l; }
  function unreadNotices() { return noticeList().filter(n => !annRead.has(n.id)); }
  function markNoticesRead(ids) {
    let ch = false; ids.forEach(i => { if (!annRead.has(i)) { annRead.add(i); ch = true; } });
    if (ch) jset(ANN_READ, Array.from(annRead).slice(-300));
  }
  function updateBell() {
    const b = document.querySelector('[data-view="notifications"]');
    if (b) b.classList.toggle('header-dot', unreadNotices().length > 0);
  }
  function semverGt(a, b) {
    const p = v => String(v).replace(/^v/, '').split('.').map(x => parseInt(x, 10) || 0);
    const x = p(a), y = p(b);
    for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; }
    return false;
  }
  async function checkAppUpdate() {
    // Android app (APK) cannot update itself silently: tell the user when a newer release exists
    if (window.BILLAURA_CHANNEL !== 'apk' || !navigator.onLine) return;
    try {
      const r = await fetch('https://api.github.com/repos/faisalchaudhary411/billaura/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) return;
      const rel = await r.json();
      const tag = String(rel.tag_name || '');
      if (tag && semverGt(tag, window.BILLAURA_VERSION || '0')) {
        updateNotice = { id: 'upd-' + tag, kind: 'update', title: 'Billaura ' + tag.replace(/^v/, '') + ' is available', body: 'A new version of the Android app is ready. Download it and install over the current one - your data stays safe.', cta_label: 'Download update', cta_url: APK_URL, created_at: rel.published_at || new Date().toISOString(), priority: 1 };
        updateBell(); maybeShowNoticePopup();
      }
    } catch (e) {}
  }
  async function refreshAnnouncements() {
    try {
      if (window.HisablyCloud && HisablyCloud.ready() && HisablyCloud.getSession()) {
        announcements = await HisablyCloud.fetchAnnouncements();
        jset(ANN_KEY, announcements);
      }
    } catch (e) { /* table not created yet or offline: keep what we have */ }
    updateBell(); maybeShowNoticePopup();
  }
  function noticeBodyHTML(n) { return escapeHtml(n.body || '').replace(/\n/g, '<br>'); }
  function noticeActionsHTML(n) {
    const cta = (n.cta_label && (n.cta_action || n.cta_url)) ? `<button class="btn btn-primary btn-sm" data-action="note-cta" data-id="${escapeHtml(n.id)}">${escapeHtml(n.cta_label)}</button>` : '';
    const cp = n.coupon ? `<div class="note-cp">Code <b>${escapeHtml(n.coupon)}</b><button type="button" class="linkish" data-action="copy-pay" data-v="${escapeHtml(n.coupon)}">Copy</button></div>` : '';
    return cp + cta;
  }
  function maybeShowNoticePopup() {
    try {
      if (!document.getElementById('app') || document.getElementById('app').hidden) return;
      if (document.querySelector('.modal-overlay, .pm-page, .desk-splash')) return;
      const n = unreadNotices().find(x => Number(x.priority) >= 1 && !annPopped.has(x.id));
      if (!n) return;
      annPopped.add(n.id); jset(ANN_POP, Array.from(annPopped).slice(-300));
      $('#modalRoot').innerHTML = modalShell(escapeHtml(n.title), `<div style="padding:4px 20px 22px"><div class="note-b" style="margin-bottom:12px">${noticeBodyHTML(n)}</div>${noticeActionsHTML(n)}<button class="btn btn-outline btn-sm" data-action="close-modal" style="margin-left:8px">Close</button></div>`);
      markNoticesRead([n.id]); updateBell();
    } catch (e) {}
  }
  function viewNotifications() {
    const list = noticeList();
    const KIND = { info: 'News', update: 'Update', offer: 'Offer', warning: 'Important' };
    return `<div class="fade-in" style="padding:14px">
      <div class="menu-card" style="margin:0 0 12px"><div class="m-row" data-view="reminders"><div class="grow">Payment reminders<small>Customers who owe you money</small></div><span class="chev">›</span></div></div>
      ${list.length ? list.map(n => `<div class="note ${escapeHtml(n.kind || 'info')} ${annRead.has(n.id) ? '' : 'unread'}">
        <div class="note-h"><span class="note-k">${KIND[n.kind] || 'News'}</span><span class="note-d">${escapeHtml(formatDate(n.created_at))}</span></div>
        <div class="note-t">${escapeHtml(n.title)}</div>
        ${n.body ? `<div class="note-b">${noticeBodyHTML(n)}</div>` : ''}
        <div class="note-a">${noticeActionsHTML(n)}</div></div>`).join('')
        : `<div class="art-empty">${ico('bell')}<div>No notifications yet.<br>Updates and offers from Billaura will show here.</div></div>`}
    </div>`;
  }

  function licenseBannerHTML() {
    try {
      const L = window.BillauraLicense;
      if (!L || !L.enabled()) return '';
      const st = L.state();
      if (st.ok) return '';
      const msg = st.reason === 'device_limit' || st.reason === 'device_revoked' ? (st.message || 'This device is not allowed on your licence. Contact support.')
        : st.reason === 'expired' ? 'Your licence needs to be re-checked. Connect to the internet and open Billaura.'
        : 'Checking your licence… connect to the internet once so your plan can be verified.';
      return `<div class="plan-banner" style="background:#FFF3CD;border-color:#F5B301;color:#7A5200"><strong>Licence:</strong> ${escapeHtml(msg)}</div>`;
    } catch (e) { return ''; }
  }
  function planBannerHTML() {
    const lic = licenseBannerHTML(); if (lic) return lic;
    const { key, limits, cache } = HisablyFreemium.effectivePlan();
    if (key === 'pro' || key === 'basic' || key === 'trial') {
      if (key === 'trial' && cache.trialEndsAt) {
        const days = Math.max(0, Math.ceil((new Date(cache.trialEndsAt) - new Date()) / 86400000));
        return `<div class="plan-banner"><strong>Trial:</strong> ${days} day(s) left · full access. <button type="button" class="linkish" data-action="open-plans">View plans</button></div>`;
      }
      return '';
    }
    if (key === 'blocked') {
      return `<div class="plan-banner" style="background:#FEE2E2;border-color:#EF4444;color:#991B1B"><strong>Account inactive.</strong> <button type="button" class="linkish" data-action="open-plans">Upgrade / pay</button></div>`;
    }
    return `<div class="plan-banner"><strong>Free plan:</strong> ${limits.products} products · ${limits.invoices} invoices · ${limits.customers} customers. <button type="button" class="linkish" data-action="open-plans">Upgrade</button></div>`;
  }


  // ---------- Shopify store connection (Pro) ----------
  const SHOPIFY_FLAG = 'billaura_shopify_on';
  let _shopifySyncing = false, _shopifyLast = 0;

  function shopifyOn() { try { return localStorage.getItem(SHOPIFY_FLAG) === '1'; } catch (e) { return false; } }
  function setShopifyOn(v) { try { v ? localStorage.setItem(SHOPIFY_FLAG, '1') : localStorage.removeItem(SHOPIFY_FLAG); } catch (e) {} }

  // After the normal cloud sync: let the server exchange price / stock / orders with Shopify,
  // then pull whatever it changed.
  async function maybeShopifySync(force) {
    if (!shopifyOn() || _shopifySyncing) return null;
    if (!window.HisablyCloud || !HisablyCloud.getSession() || !navigator.onLine) return null;
    if (!HisablyFreemium.hasFeature('shopify')) return null;
    if (!force && Date.now() - _shopifyLast < 60000) return null;
    _shopifySyncing = true;
    try {
      const r = await HisablyCloud.shopifyCall('sync', {});
      _shopifyLast = Date.now();
      if (r && r.changed) await doCloudSync({ silent: true });
      return r;
    } catch (e) {
      console.error('shopify sync', e);
      if (e && (e.status === 402 || e.status === 400)) toast(e.message, 5000);
      throw e;
    } finally { _shopifySyncing = false; }
  }

  function shopifyBusy(msg) {
    $('#modalRoot').innerHTML = `<div class="modal-overlay"><div class="modal-sheet"><div class="modal-handle"></div>
      <p class="text-secondary" style="text-align:center;padding:30px 0">${escapeHtml(msg)}</p></div></div>`;
  }

  async function openShopifyModal() {
    if (!window.HisablyCloud || !HisablyCloud.ready() || !HisablyCloud.getSession()) { toast('Sign in to your cloud account first'); return; }
    if (!HisablyFreemium.hasFeature('shopify')) {
      toast('Shopify connection is a Pro feature. Upgrade to Pro or Lifetime.', 4500);
      openPlansModal();
      return;
    }
    shopifyBusy('Loading…');
    let st;
    try { st = await HisablyCloud.shopifyCall('status', {}); }
    catch (e) { closeModal(); toast(e.message, 5500); return; }
    setShopifyOn(!!st.connected);
    renderShopifyModal(st);
  }

  function renderShopifyModal(st) {
    const head = `<div class="modal-header"><h3 class="modal-title">Shopify store</h3>
      <button class="modal-close" data-action="close-modal"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>`;
    if (st.connected) {
      const when = (d) => d ? formatDate(d) + ' ' + new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
      $('#modalRoot').innerHTML = `<div class="modal-overlay"><div class="modal-sheet"><div class="modal-handle"></div>${head}
        <div class="card mb-12" style="padding:14px">
          <div class="font-semibold">${escapeHtml(st.domain)}</div>
          <div class="text-sm" style="color:var(--success);margin-top:4px">● Connected</div>
          <div class="text-sm text-secondary mt-8">Last sync: ${escapeHtml(when(st.last_push_at || st.last_pull_at))}</div>
          ${st.last_error ? `<div class="text-sm mt-8" style="color:var(--danger)">The last sync had a problem. Tap “Sync now” to retry. If it keeps happening, check that your Shopify app still has the permissions listed below, or contact support.</div>` : ''}
        </div>
        ${(st.locations || []).length > 1 ? `<div class="form-group"><label class="form-label">Stock location (stock is synced for this one)</label>
          <select class="form-input" id="shopifyLoc">${st.locations.map(l => `<option value="${escapeHtml(l.id)}" ${l.id === st.location_id ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}</select></div>`
          : `<div class="text-sm text-secondary mb-12">Stock location: <strong>${escapeHtml(st.location_name || '—')}</strong></div>`}
        <ul class="text-sm text-secondary mb-12" style="padding-left:18px;line-height:1.6">
          <li>Shopify products, prices and stock appear in Billaura automatically.</li>
          <li>Price / stock changes you make in Billaura are sent to Shopify.</li>
          <li>Online orders become invoices (<strong>SHP-…</strong>); customers are added.</li>
        </ul>
        <button class="btn btn-primary btn-block" data-action="shopify-sync">Sync now</button>
        <button class="btn btn-secondary btn-block mt-8" data-action="shopify-full">Re-import everything from Shopify</button>
        <button class="btn btn-ghost btn-block mt-8" style="color:var(--danger)" data-action="shopify-disconnect">Disconnect store</button>
      </div></div>`;
      const loc = document.getElementById('shopifyLoc');
      if (loc) loc.addEventListener('change', async () => {
        shopifyBusy('Changing location and re-syncing stock…');
        try { await HisablyCloud.shopifyCall('set_location', { locationId: loc.value }); await doCloudSync({ silent: true }); toast('Location updated'); }
        catch (e) { toast(e.message, 5000); }
        openShopifyModal();
      });
      return;
    }
    $('#modalRoot').innerHTML = `<div class="modal-overlay"><div class="modal-sheet"><div class="modal-handle"></div>${head}
      <p class="text-sm text-secondary mb-12">Connect your Shopify store: products, prices, stock, customers and online orders flow into Billaura, and your price / stock changes flow back.</p>
      <details class="help-box"><summary>How do I get these details?</summary>
        <div class="text-sm">
          <p><strong>Your store address</strong> is the one that ends with <em>.myshopify.com</em> (Shopify admin → Settings → Domains).</p>
          <p><strong>Option 1 – new Shopify apps (Dev Dashboard)</strong></p>
          <ol>
            <li>Go to <strong>dev.shopify.com</strong> and sign in with the store owner account.</li>
            <li>Create an app named <em>Billaura</em>.</li>
            <li>Give it these permissions: read &amp; write <em>products</em> and <em>inventory</em>; read <em>orders</em>, <em>customers</em> and <em>locations</em>.</li>
            <li>Release it and <strong>install it on your store</strong>.</li>
            <li>Open the app’s Settings, copy the <strong>Client ID</strong> and <strong>Client secret</strong> and paste them below.</li>
          </ol>
          <p><strong>Option 2 – older custom app</strong></p>
          <ol>
            <li>Shopify admin → Settings → Apps and sales channels → <strong>Develop apps</strong> → create an app.</li>
            <li>Give it the same permissions as above and install it.</li>
            <li>Copy the <strong>Admin API access token</strong> (starts with <em>shpat_</em>, shown only once) and the <strong>API secret key</strong>, and paste them below.</li>
          </ol>
          <p>Tip: try it first with one test product. Your existing Billaura products are matched by barcode/SKU or name, so nothing is duplicated.</p>
        </div>
      </details>
      <form id="shopifyForm" autocomplete="off">
        <div class="form-group"><label class="form-label">Store address</label>
          <input class="form-input" name="domain" placeholder="mystore.myshopify.com" autocapitalize="none" required /></div>
        <div class="form-group"><label class="form-label">Admin API access token <span class="text-secondary">(starts with shpat_)</span></label>
          <input class="form-input" name="accessToken" placeholder="shpat_…" autocapitalize="none" /></div>
        <p class="text-sm text-secondary mb-8" style="text-align:center">— or, for apps made in the Dev Dashboard —</p>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Client ID</label><input class="form-input" name="clientId" autocapitalize="none" /></div>
          <div class="form-group"><label class="form-label">Client secret</label><input class="form-input" name="clientSecret" type="password" autocapitalize="none" /></div>
        </div>
        <div class="form-group"><label class="form-label">API secret key <span class="text-secondary">(verifies Shopify messages; leave empty if you used Client secret)</span></label>
          <input class="form-input" name="apiSecret" type="password" autocapitalize="none" /></div>
        <button type="submit" class="btn btn-primary btn-block" id="shopifyConnectBtn">Connect &amp; import</button>
        <p class="text-sm text-secondary mt-8">The first import can take a minute for big stores. Existing Billaura products are matched by barcode/SKU or name instead of duplicated.</p>
      </form></div></div>`;
    document.getElementById('shopifyForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = document.getElementById('shopifyConnectBtn');
      btn.disabled = true; btn.textContent = 'Connecting… please wait';
      try {
        const payload = {};
        ['domain', 'accessToken', 'clientId', 'clientSecret', 'apiSecret'].forEach(k => { payload[k] = (fd.get(k) || '').trim(); });
        const r = await HisablyCloud.shopifyCall('connect', payload);
        setShopifyOn(true);
        const p = r.products || {};
        toast(`Connected to ${r.shopName || 'Shopify'} · ${p.added || 0} products added`, 5000);
        await doCloudSync({ silent: true });
        openShopifyModal();
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Connect & import';
        toast(err.message, 6500);
      }
    });
  }

  async function shopifyManualSync(full) {
    shopifyBusy(full ? 'Re-importing from Shopify…' : 'Syncing with Shopify…');
    try {
      await doCloudSync({ silent: true });
      const r = await HisablyCloud.shopifyCall('sync', { full: !!full });
      _shopifyLast = Date.now();
      await doCloudSync({ silent: true });
      const p = r.products || {}, o = r.orders || {};
      toast(`Synced · ${p.added || 0} new, ${p.updated || 0} updated products · ${o.added || 0} new orders`, 4500);
    } catch (e) { toast(e.message, 6000); }
    openShopifyModal();
  }

  function needPro(what) {
    if (HisablyFreemium.hasFeature('bulkTools')) return true;
    toast(what + ' is a Pro feature. Upgrade to Pro to use it.', 4500);
    openPlansModal && openPlansModal();
    return false;
  }

  function enforceLimit(type, count) {
    const r = HisablyFreemium.canAdd(type, count);
    if (!r.ok) {
      toast(r.reason);
      openPlansModal();
      return false;
    }
    return true;
  }

  let _planPick = 'pro';
  let _promo = null;   // { code, plan, final, list } once a code has been applied
  let _plansRefreshing = false;
  function openPlansModal(pre) {
    if (!_plansRefreshing && navigator.onLine && window.HisablyCloud && HisablyCloud.ready() && HisablyCloud.getSession()) {
      _plansRefreshing = true;
      const before = JSON.stringify(HisablyFreemium.effectivePlan().key);
      refreshPlanFromCloud().then(() => { _plansRefreshing = false; if (document.querySelector('.pm-page .pl-hero') && JSON.stringify(HisablyFreemium.effectivePlan().key) !== before) openPlansModal(pre); }).catch(() => { _plansRefreshing = false; });
    }
    const F = HisablyFreemium;
    const pay = F.getPlanCache().payment || F.DEFAULT_PAY;
    const { key, cache, limits } = F.effectivePlan();
    const cur = escapeHtml(pay.currency || 'PKR');
    const isLife = cache.planId === 'lifetime' && cache.status === 'active';
    const L = F.LIMITS;
    const pf = v => Number(v).toLocaleString('en-US');
    const n = v => v >= 9999 ? 'Unlimited' : Number(v).toLocaleString('en-US');
    const price = { basic: Number(pay.basicPrice) || 499, pro: Number(pay.proPrice) || 999, lifetime: Number(pay.lifetimePrice) || 14999 };
    if (pre && price[pre]) _planPick = pre; else if (!price[_planPick] || key === _planPick) _planPick = key === 'pro' ? 'lifetime' : (key === 'basic' ? 'pro' : 'pro');
    if (isLife) _planPick = 'lifetime';
    // status / days
    let statusTxt = '', pill = key.toUpperCase();
    const nowMs = F.nowMs(cache);
    if (key === 'trial' && cache.trialEndsAt) { const d = Math.max(0, Math.ceil((new Date(cache.trialEndsAt).getTime() - nowMs) / 864e5)); statusTxt = d + ' day' + (d === 1 ? '' : 's') + ' of free trial left – everything is unlocked'; pill = 'TRIAL'; }
    else if (isLife) { statusTxt = 'Lifetime – never expires'; pill = 'LIFETIME'; }
    else if (key === 'pro' || key === 'basic') { statusTxt = cache.paidUntil ? 'Renews / ends ' + new Date(cache.paidUntil).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Active'; }
    else if (key === 'blocked') { statusTxt = 'Account inactive – choose a plan to continue'; pill = 'INACTIVE'; }
    else { statusTxt = cache.status === 'expired_paid' ? 'Your paid plan ended – renew to get everything back' : (cache.status === 'expired_trial' ? 'Your free trial ended' : 'Upgrade any time to remove limits'); pill = 'FREE'; }
    const meter = (label, used, max) => max >= 9999 ? '' : `<div class="pl-m"><div class="pl-ml"><span>${label}</span><b>${used} / ${n(max)}</b></div><div class="pl-bar"><i style="width:${Math.min(100, Math.round(used / max * 100))}%;${used / max >= 0.9 ? 'background:#FFD166' : ''}"></i></div></div>`;
    const meters = meter('Items', products.length, limits.products) + meter('Invoices', invoices.length, limits.invoices) + meter('Customers', customers.length, limits.customers);
    const ft = (ok, t) => `<li class="${ok ? 'on' : 'off'}"><span>${ok ? '✓' : '—'}</span>${t}</li>`;
    const feats = k => { const x = L[k === 'lifetime' ? 'pro' : k]; return [
      ft(true, `<b>${n(x.products)}</b> items`), ft(true, `<b>${n(x.invoices)}</b> invoices`), ft(true, `<b>${n(x.customers)}</b> customers`),
      ft(x.cloudSync, 'Cloud sync &amp; backup'), ft(x.paymentQrOnInvoice, 'Payment QR on invoices'), ft(x.passcode, 'PIN lock &amp; staff roles'),
      ft(x.themes, 'All invoice themes'), ft(x.bulkTools, 'Bulk import &amp; price tools'), ft(x.shopify, 'Online store &amp; Shopify sync')].join(''); };
    const card = (k, name, badge, priceHtml, sub) => {
      const mine = (k === 'free' && key === 'free') || (k === 'basic' && key === 'basic') || (k === 'pro' && key === 'pro' && !isLife) || (k === 'lifetime' && isLife);
      const sel = _planPick === k;
      return `<div class="pl-card ${sel ? 'sel' : ''} ${mine ? 'mine' : ''} ${k}" ${k !== 'free' && !mine ? `data-action="plan-pick" data-plan="${k}" data-amt="${pf(price[k])}"` : ''}>
        ${badge ? `<span class="pl-badge">${badge}</span>` : ''}
        <div class="pl-top"><div><div class="pl-name">${name}</div><div class="pl-sub">${sub}</div></div><div class="pl-price">${priceHtml}</div></div>
        <ul class="pl-f">${feats(k)}</ul>
        ${mine ? '<div class="pl-cur">✓ Your current plan</div>' : (k === 'free' ? '' : `<div class="pl-sel">${sel ? '● Selected' : 'Choose ' + name}</div>`)}</div>`;
    };
    const months = Math.max(1, Math.round(price.lifetime / price.pro));
    const copyRow = (label, val) => val ? `<div class="pl-pay"><div><small>${label}</small><b>${escapeHtml(val)}</b></div><button type="button" class="pm-chip" data-action="copy-pay" data-v="${escapeHtml(val)}">Copy</button></div>` : '';
    $('#modalRoot').innerHTML = `<div class="modal-overlay"><div class="pm-page">
      <div class="pm-head"><button class="pm-back" data-action="close-modal" aria-label="Back">←</button><h2>Plans &amp; Packages</h2></div>
      <div class="pm-scroll" style="padding:0 0 90px">
        <div class="pl-hero"><div class="pl-hero-top"><div><small>Your plan</small><div class="pl-hero-name">${escapeHtml(planLabel())}</div></div><span class="pl-pill">${pill}</span></div>
          <div class="pl-hero-sub">${escapeHtml(statusTxt)}</div>${meters ? `<div class="pl-meters">${meters}</div>` : ''}</div>
        <div class="pl-wrap">
          <div class="pl-h">Choose your package</div>
          ${isLife ? card('lifetime', 'Lifetime', '', `<b>${cur} ${pf(price.lifetime)}</b><small>one-time</small>`, 'Paid in full') : ''}
          ${isLife ? '' : card('basic', 'Basic', '', `<b>${cur} ${pf(price.basic)}</b><small>/ month</small>`, 'For small shops')}
          ${isLife ? '' : card('pro', 'Pro', 'MOST POPULAR', `<b>${cur} ${pf(price.pro)}</b><small>/ month</small>`, 'Everything unlocked')}
          ${isLife ? '' : card('lifetime', 'Lifetime', 'BEST VALUE', `<b>${cur} ${pf(price.lifetime)}</b><small>one-time</small>`, `Pays for itself in about ${months} months of Pro`)}
          ${isLife ? '' : card('free', 'Free', '', `<b>${cur} 0</b>`, 'Try Billaura')}
          ${isLife ? '<div class="pl-note" style="text-align:center;margin-top:18px">You have Lifetime access – thank you for supporting Billaura.</div>' : `
          <div class="pl-h" style="margin-top:22px">How to upgrade</div>
          <div class="pl-step"><span class="pl-n">1</span><div><b>Selected: <span id="plSelName">${_planPick.charAt(0).toUpperCase() + _planPick.slice(1)}</span> – ${cur} <span id="plSelAmt">${pf(price[_planPick])}</span></b></div></div>
          <div class="pl-promo"><input class="form-input" id="promoCode" placeholder="Promo code (optional)" autocapitalize="characters" autocomplete="off" /><button type="button" class="btn btn-outline" data-action="apply-promo">Apply</button></div>
          <div id="promoMsg" class="text-sm" style="margin:-4px 0 10px 40px"></div>
          <div class="pl-step"><span class="pl-n">2</span><div><b>Send the amount to</b>
            ${copyRow('JazzCash', pay.jazzcash)}${copyRow('EasyPaisa', pay.easypaisa)}${pay.bankAccount ? copyRow('Bank – ' + (pay.bankName || '') + (pay.bankTitle ? ' · ' + pay.bankTitle : ''), pay.bankAccount) : ''}
            ${pay.note ? `<div class="pl-note">${escapeHtml(pay.note)}</div>` : ''}</div></div>
          <div class="pl-step"><span class="pl-n">3</span><div style="flex:1"><b>Tell us you paid</b>
            <input type="hidden" id="paidPlanSelect" value="${_planPick}" />
            <input class="form-input" id="paidNote" placeholder="Transaction ID or the phone you paid from" style="margin-top:8px" />
            <div id="payReqStatus" class="text-sm text-secondary" style="margin-top:8px"></div>
            <button class="btn btn-primary btn-block" data-action="submit-payment" style="margin-top:10px">I paid – notify admin</button>
            <div class="pl-note">Your plan switches on as soon as the payment is confirmed, usually within a few hours.</div></div></div>`}
        </div></div></div></div>`;
    if (window.HisablyCloud && HisablyCloud.ready() && HisablyCloud.getSession()) {
      HisablyCloud.latestPaymentRequest().then(r => {
        const el = document.getElementById('payReqStatus');
        if (!el || !r) return;
        const label = { pending: 'Pending – admin will review it soon', approved: 'Approved', rejected: 'Rejected – contact support' }[r.status] || r.status;
        el.innerHTML = `Last request (${escapeHtml(r.plan_id || '')}): <strong>${escapeHtml(label)}</strong>`;
      }).catch(() => {});
    }
  }

  function enterApp() {
    showAppShell();
    if (lockEnabled() && !getRole()) showLock();
    migrateData();
    // Cloud mode gets payment details from the database; this same-browser shortcut is for local testing only
    try {
      const pay = (window.HisablyCloud && HisablyCloud.ready()) ? null : JSON.parse(localStorage.getItem('billaura_platform_pay_v1') || 'null');
      if (pay) {
        HisablyFreemium.setPlanCache({
          payment: Object.assign({}, HisablyFreemium.DEFAULT_PAY, pay),
          freemiumEnabled: pay.freemiumEnabled !== false
        });
      }
    } catch (e) {}
    { const h = (location.hash || '').replace(/^#\/?/, '');
      const ok = h && !['create-invoice', 'daybook-detail', 'bank-ledger', 'pos', 'auth'].includes(h);
      setView(ok ? h : 'home', { replace: true }); }
    viewStack = [];
    if (settings._storeHash) republishStore(true).catch(() => {});
    initCloudAutoSync();
    maybeAutoBackup();
    startPlanHeartbeat();
    setTimeout(() => { if (navigator.onLine) refreshPlanFromCloud(); }, 800);
    setTimeout(() => { refreshAnnouncements(); checkAppUpdate(); }, 2500);
  }

  let _planHeartbeat = null;
  function startPlanHeartbeat() {
    if (_planHeartbeat) clearInterval(_planHeartbeat);
    // When online, refresh plan every 10 minutes
    _planHeartbeat = setInterval(() => {
      if (navigator.onLine) { refreshPlanFromCloud(); refreshAnnouncements(); checkAppUpdate(); }
    }, 10 * 60 * 1000);
    if (!startPlanHeartbeat._bound) {
      startPlanHeartbeat._bound = true;
      window.addEventListener('online', () => refreshPlanFromCloud());
    }
  }

  // Init
  // ---------- Bridge for js/counter.js (counter pack: POS v2, shifts, returns, PO, counts, expiry, backups) ----------
  window.BillauraCore = {
    get products() { return products; }, get customers() { return customers; }, get suppliers() { return suppliers; },
    get invoices() { return invoices; }, get purchases() { return purchases; }, get expenses() { return expenses; },
    get stockMovements() { return stockMovements; }, get settings() { return settings; }, get view() { return currentView; },
    uid, round2, money, escapeHtml, formatDate, initials, ico, toast, askConfirm, closeModal, modalShell, persist, setView, render,
    can, isStaff, staffName, staffList, ROLES, pinHash, cashEntries, nextDocNumber, nextPurNumber, findOrCreateCustomer, startScanner,
    openInvoiceDetail, openShareSheet, openPurchaseDetail, sendWhatsApp, waNumber, docSign, lowLimit, returnedQty, customerBalance,
    custDocs, calcDoc, enforceLimit, snapshotData, applyBackupData, downloadText, dayKey, ts,
    nextInvoiceNumber() { return `${(window.BillauraExt && BillauraExt.invPrefix && BillauraExt.invPrefix()) || settings.invoicePrefix || 'INV'}-${invoiceCounter++}`; },
    setDocCtx(c) { docCtx = c; },
    afterRestore() { normalizeData(); migrateIds(); persist(); migrateData(); },
    savePurchase(p) { purchases.unshift(p); },
    unread() { try { return unreadNotices().length; } catch (e) { return 0; } },
    lowStockItems() { return lowStockItems(); },
    trashInvoice(inv) { trashPush('invoice', inv); invoices = invoices.filter(x => x.id !== inv.id); },
    republishStore(silent) { return republishStore(silent); },
    storeUrl() { return storeUrl(); },
    storeLive() { return !!(settings.storeSlug && settings._slugLive); }
  };
  try { if (window.BillauraExt && BillauraExt.init) BillauraExt.init(); } catch (e) { console.error(e); }
  try { if (window.BillauraLicense) BillauraLicense.init().then(() => { try { if (typeof canRenderNow === 'function' && canRenderNow()) render(); } catch (e) {} }); } catch (e) {}
  try {
    migrateData();
    // The old offline demo account is gone: end any demo session (data on the phone is kept)
    try {
      const _ds = window.HisablyFreemium && HisablyFreemium.getSession();
      if (_ds && (_ds.userId === 'guest_demo' || _ds.email === 'demo@billaura.local')) {
        HisablyFreemium.clearSession(); HisablyFreemium.clearPlanCache();
        localStorage.setItem('billaura_demo_removed', '1');
      }
      const _lu = JSON.parse(localStorage.getItem('billaura_local_users_v1') || '[]').filter(u => u.email !== 'demo@billaura.local');
      localStorage.setItem('billaura_local_users_v1', JSON.stringify(_lu));
    } catch (e) {}
    if (window.HisablyCloud && HisablyCloud.ready() && HisablyCloud.inRecovery()) {
      // Opened from the "reset password" e-mail link
      showAuth('recovery');
      HisablyCloud.prepareRecovery().catch(() => {});
    } else if (window.HisablyCloud && HisablyCloud.ready() && HisablyCloud.resetLinkExpired()) {
      try { history.replaceState(null, '', location.pathname); } catch (e) {}
      showAuth('forgot', 'That reset link has expired or was already used. Enter your email to get a new one.', 'error');
    } else if (!window.HisablyFreemium || !HisablyFreemium.isLoggedIn()) {
      showAuth();
    } else {
      enterApp();
    }
  } catch (err) {
    console.error('Billaura init error', err);
    const boot = document.getElementById('bootMsg');
    if (boot) boot.textContent = 'Startup error: ' + (err && err.message ? err.message : err);
    // Last resort: show app shell empty so user is not stuck on pure white
    try { showAuth(); } catch (e2) {
      hideBoot();
      const appEl = document.getElementById('app');
      if (appEl) { appEl.hidden = false; }
    }
  }

  // PWA install prompt (hidden once installed; "✕" is remembered for 7 days)
  let deferredInstall = null;
  const INSTALL_DISMISS_KEY = 'billaura_install_dismissed';
  function hideInstallBanner(remember) {
    const ban = document.getElementById('installBanner');
    if (ban) { ban.hidden = true; ban.style.display = 'none'; }
    if (remember) { try { localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now())); } catch (e) {} }
  }
  function installDismissedRecently() {
    try { return Date.now() - Number(localStorage.getItem(INSTALL_DISMISS_KEY) || 0) < 7 * 864e5; } catch (e) { return false; }
  }
  const isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  if (isStandalone) hideInstallBanner(false);
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    if (isStandalone || installDismissedRecently()) return;
    const ban = document.getElementById('installBanner');
    if (ban) { ban.style.display = ''; ban.hidden = false; }
  });
  window.addEventListener('appinstalled', () => { deferredInstall = null; hideInstallBanner(false); });
  document.getElementById('installBtn')?.addEventListener('click', async () => {
    if (!deferredInstall) { hideInstallBanner(false); return; }
    deferredInstall.prompt();
    try { await deferredInstall.userChoice; } catch (e) {}
    deferredInstall = null;
    hideInstallBanner(false);
  });
  document.getElementById('installDismiss')?.addEventListener('click', () => hideInstallBanner(true));


  // App update banner (new service worker)
  function setupUpdateBanner() {
    const banner = document.getElementById('updateBanner');
    const btn = document.getElementById('updateBtn');
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistration().then(reg => {
      if (!reg) return;
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller && banner) {
            banner.hidden = false;
          }
        });
      });
      // periodic check
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch(() => {});
    if (btn) btn.addEventListener('click', () => {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        window.location.reload();
      });
    });
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }
  try { setupUpdateBanner(); } catch (e) {}

  // Boot logo from settings
  try {
    const bootLogo = document.querySelector('.logo-circle, .auth-brand img, #bootLogo');
    if (settings.logo) {
      const img = document.createElement('img');
      img.src = settings.logo;
      img.alt = 'Logo';
      img.style.cssText = 'width:64px;height:64px;border-radius:16px;object-fit:contain;margin:0 auto 12px;display:block';
      const circle = document.querySelector('.logo-circle');
      if (circle && circle.parentNode) circle.replaceWith(img);
    }
    const hl = document.getElementById('headerLogo');
    if (hl && settings.logo) { hl.src = settings.logo; hl.style.display = ''; }
  } catch (e) {}

})();