/* Billaura templates: invoice/quotation/delivery-note layouts (one renderer for preview, print, PDF and image)
 * and visiting-card designs.
 *   BillauraTemplates.docHTML(inv, ctx, opts)   -> full HTML document string
 *   BillauraTemplates.printDoc(inv, ctx, opts)  -> opens the print dialog
 *   BillauraTemplates.pdf(inv, ctx, opts)       -> downloads a PDF (html2canvas + jsPDF)
 *   BillauraTemplates.image(inv, ctx, opts)     -> Promise<Blob> PNG
 *   BillauraTemplates.cardHTML(settings, id)    -> HTML for a business card
 * ctx = { settings, money, formatDate, amountInWords, products, qrAllowed }
 */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const INVOICE_TEMPLATES = [
    { id: 'modern', name: 'Modern Elite' },
    { id: 'tally', name: 'Tally Theme' },
    { id: 'classic', name: 'Classic' },
    { id: 'banner', name: 'Bold Banner' },
    { id: 'frame', name: 'Elegant Frame' },
    { id: 'french', name: 'French Elite' },
    { id: 'divine', name: 'Double Divine' },
    { id: 'minimal', name: 'Minimal' },
    { id: 'theme1', name: 'Theme 1' },
    { id: 'theme2', name: 'Theme 2' },
    { id: 'theme3', name: 'Theme 3' },
    { id: 'tax1', name: 'Tax Theme 1' },
    { id: 'tax2', name: 'Tax Theme 2' },
    { id: 'tax3', name: 'Tax Theme 3' },
    { id: 'landscape', name: 'Landscape Theme', landscape: true },
    { id: 'landscape2', name: 'Landscape 2', landscape: true }
  ];
  const COLORS = ['#2A5BD7', '#EF1A3C', '#0D9488', '#111827', '#9F1239', '#B45309', '#166534', '#7C3AED', '#0891B2', '#EA580C'];
  const PAGES = { A4: [794, 1123], A5: [559, 794], Letter: [816, 1056] };
  const TEXT = { small: 12, medium: 13.5, large: 15 };

  function optsFrom(s, o) {
    o = o || {};
    return {
      template: o.template || s.invoiceTemplate || 'modern',
      color: o.color || s.invoiceColor || COLORS[0],
      textSize: o.textSize || s.printTextSize || 'medium',
      pageSize: o.pageSize || s.printPageSize || 'A4',
      orientation: o.orientation || s.printOrientation || 'portrait',
      deliveryNote: !!o.deliveryNote
    };
  }
  function hexToRgb(h) { const n = parseInt(String(h).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function soft(h, a) { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; }
  function flag(s, k, dflt) { return s[k] === undefined ? dflt : !!s[k]; }

  function docTitle(inv, o) {
    if (o.deliveryNote) return 'Delivery Note';
    if (inv.docType === 'return') return 'Credit Note';
    if (inv.docType === 'estimate') return 'Quotation';
    return flag(inv._s || {}, 'x', true) && inv.__tax ? 'Tax Invoice' : 'Invoice';
  }

  function build(inv, ctx, oIn) {
    const s = ctx.settings, o = optsFrom(s, oIn), C = o.color;
    const land = o.template === 'landscape' || o.template === 'landscape2' || o.orientation === 'landscape';
    const base = PAGES[o.pageSize] || PAGES.A4;
    const W = land ? Math.max(base[0], base[1]) : base[0], H = land ? Math.min(base[0], base[1]) : base[1];
    const fs = TEXT[o.textSize] || 13.5;
    const dec = flag(s, 'printDecimalAmt', true), grp = flag(s, 'printAmountGrouping', true);
    const num = n => {
      n = Number(n) || 0;
      const t = n.toLocaleString('en-US', { minimumFractionDigits: dec ? 2 : 0, maximumFractionDigits: dec ? 2 : 0, useGrouping: grp });
      return t;
    };
    const cur = esc(s.currency || '');
    const m = inv.meta || {};
    const paid = Number(inv.paidAmount) || 0, total = Number(inv.total) || 0, due = Math.max(0, total - paid);
    const isEst = inv.docType === 'estimate', isRet = inv.docType === 'return';
    const title = o.deliveryNote ? 'Delivery Note' : isRet ? 'Credit Note' : isEst ? 'Quotation' : 'Invoice';
    const status = isEst ? 'QUOTATION' : (due <= 0 ? 'PAID' : (paid > 0 ? 'PARTIAL' : 'UNPAID'));
    const stColor = status === 'PAID' ? '#059669' : status === 'PARTIAL' ? '#d97706' : status === 'QUOTATION' ? '#6B7280' : '#dc2626';
    const prods = ctx.products || [];
    const items = (inv.items || []).map(it => {
      const p = prods.find(x => x.id === it.productId) || {};
      return { name: it.name, qty: Number(it.qty) || 0, unit: p.unit || '', price: Number(it.price) || 0, mrp: p.mrp || p.price || 0, desc: p.desc || '', amt: (Number(it.price) || 0) * (Number(it.qty) || 0), save: Math.max(0, ((p.price || it.price) - it.price)) * (Number(it.qty) || 0) };
    });
    const totalQty = items.reduce((a, i) => a + i.qty, 0);
    const sub = items.reduce((a, i) => a + i.amt, 0);
    const showSNo = flag(s, 'printSNo', true), showUOM = flag(s, 'printUOM', true), showMRP = flag(s, 'printMRP', false) && !o.deliveryNote, showDesc = flag(s, 'printItemDesc', true);
    const showPrices = !o.deliveryNote;
    const cols = [];
    if (showSNo) cols.push(['#', 'n', (i, k) => k + 1]);
    cols.push(['Item name', 'l', i => esc(i.name) + (showDesc && i.desc ? `<div class="d">${esc(i.desc)}</div>` : '')]);
    cols.push(['Qty', 'r', i => esc(i.qty) + (showUOM && i.unit ? ' ' + esc(i.unit) : '')]);
    if (showPrices) {
      if (showMRP) cols.push(['MRP', 'r', i => num(i.mrp)]);
      cols.push(['Price/Unit', 'r', i => num(i.price)]);
      cols.push(['Amount', 'r b', i => num(i.amt)]);
    }
    const thead = '<tr>' + cols.map(c => `<th class="${c[1]}">${c[0]}</th>`).join('') + '</tr>';
    const minRows = land ? 0 : 0;
    const tbody = items.map((it, k) => '<tr>' + cols.map(c => `<td class="${c[1]}">${c[2](it, k)}</td>`).join('') + '</tr>').join('');
    const colspanBefore = cols.length - (showPrices ? 1 : 0);

    // header pieces
    const lines = [];
    if (flag(s, 'printAddress', true)) { const a = [s.address, s.city].filter(Boolean).join(', '); if (a) lines.push(esc(a)); }
    const contact = [flag(s, 'printPhone', true) && s.phone ? 'Ph: ' + esc(s.phone) : '', flag(s, 'printEmail', true) && s.email ? esc(s.email) : ''].filter(Boolean).join('  ·  ');
    if (contact) lines.push(contact);
    if (flag(s, 'printTIN', false) && s.taxId) lines.push('NTN/Tax: ' + esc(s.taxId));
    const logo = flag(s, 'printLogo', true) && s.logo ? `<img class="logo" src="${esc(s.logo)}" alt="">` : '';
    const addrTxt = esc([s.address, s.city].filter(Boolean).join(', ')), phoneTxt = esc([s.phone, s.phone2].filter(Boolean).join(' / ')), emailTxt = esc(s.email || '');
    const bname = flag(s, 'printCompanyName', true) ? `<div class="bn">${esc(s.businessName || 'Business')}</div>` : '';
    const brand = `<div class="brand">${logo}<div>${bname}${lines.map(l => `<div class="sm">${l}</div>`).join('')}</div></div>`;
    const dt = ctx.formatDate(inv.date) + (s.enableTxnTime ? ', ' + new Date(inv.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
    const metaRows = [
      ['No.', esc(inv.number)], ['Date', esc(dt)],
      m.dueDate && !isEst ? ['Due date', esc(ctx.formatDate(m.dueDate))] : null,
      isEst && m.validUntil ? ['Valid until', esc(ctx.formatDate(m.validUntil))] : null,
      m.po ? ['PO no.', esc(m.po)] : null,
      m.refNumber ? ['Against', esc(m.refNumber)] : null
    ].filter(Boolean);
    const extraF = Object.entries(m.extra || {}).filter(([, v]) => v);
    metaRows.push(...extraF.map(([k, v]) => [esc(k), esc(v)]));
    const metaHTML = metaRows.map(r => `<div class="mr"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');
    const billTo = `<div class="lbl">${isRet ? 'Credit to' : (o.deliveryNote ? 'Deliver to' : 'Bill to')}</div><div class="pn">${esc(m.billingName || inv.customerName || 'Walk-in Customer')}</div>${inv.customerPhone ? `<div class="sm">${esc(inv.customerPhone)}</div>` : ''}${inv.customerAddress ? `<div class="sm">${esc(inv.customerAddress)}</div>` : ''}`;

    // totals
    const T = [];
    const disc = m.discount || 0;
    if (showPrices) {
      T.push(['Sub Total', num(sub)]);
      if (disc) T.push(['Discount' + (m.discType === 'pct' && m.discValue ? ` (${m.discValue}%)` : ''), '- ' + num(disc)]);
      if (m.tax && flag(s, 'printTaxDetails', true)) T.push([esc(m.taxType === 'amt' ? (m.taxName || 'Tax') : (m.taxName || 'Tax') + ' (' + m.taxRate + '%)'), num(m.tax)]);
      if (m.charges) T.push([esc(m.chargeLabel || 'Charges'), num(m.charges)]);
      if (m.roundOff) T.push(['Round off', num(m.roundOff)]);
    }
    const grand = showPrices ? `<div class="grand"><span>Total</span><span>${cur} ${num(total)}</span></div>` : '';
    const paidRows = [];
    if (showPrices && !isEst) {
      if (flag(s, 'printReceivedAmount', true)) paidRows.push([isRet ? 'Refunded' : 'Received', num(paid)]);
      if (flag(s, 'printBalanceAmount', true) && due > 0) paidRows.push(['Balance', num(due)]);
      if (flag(s, 'printPaymentMode', false) && m.paymentMode) paidRows.push(['Payment mode', esc(m.paymentMode)]);
    }
    const saved = flag(s, 'printYouSaved', true) ? Math.round((disc + items.reduce((a, i) => a + i.save, 0)) * 100) / 100 : 0;
    const words = showPrices && flag(s, 'printAmountInWords', true) && ctx.amountInWords ? `<div class="words"><div class="lbl">Invoice amount in words</div>${esc(ctx.amountInWords(total, s.amountWordsFormat || 'indian'))}</div>` : '';
    const terms = flag(s, 'printTerms', true) && flag(s, 'enableTerms', true) ? `<div class="terms"><div class="lbl">Terms &amp; Conditions</div>${esc(s.termsText || 'Thank you for doing business with us.').replace(/\n/g, '<br>')}</div>` : '';
    const qr = (ctx.qrAllowed && s.paymentQr && showPrices && !isEst) ? `<div class="qr"><img src="${esc(s.paymentQr)}" alt=""><div><b>Scan to pay</b><div class="sm">${esc(s.paymentNote || '')}</div></div></div>` : '';
    const sig = flag(s, 'printSignature', true) ? `<div class="sig"><div class="sg"><div class="sgi">${s.signature ? `<img src="${esc(s.signature)}" alt="">` : ''}${s.stamp ? `<img class="st" src="${esc(s.stamp)}" alt="">` : ''}</div><div class="sgl">For ${esc(s.businessName || 'Business')}</div><div class="sm">${esc(s.signatureText || 'Authorized Signatory')}</div></div></div>` : '';
    const recv = (m.rb != null ? !!m.rb : flag(s, 'printReceivedBy', true)) ? `<div class="rb"><div>Received by: ${m.rbName ? '<b>' + esc(m.rbName) + '</b>' : '______________'}</div><div>Delivered by: ${m.dbName ? '<b>' + esc(m.dbName) + '</b>' : '______________'}</div></div>` : '';
    const orig = s.printOriginalDup ? `<div class="od">ORIGINAL FOR RECIPIENT</div>` : '';
    const desc = flag(s, 'printFooterDesc', true) && m.note ? `<div class="terms"><div class="lbl">Description</div>${esc(m.note)}</div>` : '';

    const T1 = T.map(r => `<div class="tr"><span>${r[0]}</span><span>${cur} ${r[1]}</span></div>`).join('');
    const P1 = paidRows.map(r => `<div class="tr"><span>${r[0]}</span><span>${/^\d|^-/.test(r[1]) ? cur + ' ' : ''}${r[1]}</span></div>`).join('');
    const totalsHTML = `<div class="tot">${T1}${grand}${P1}${saved > 0 ? `<div class="saved">You saved ${cur} ${num(saved)}</div>` : ''}</div>`;
    const qtyRow = flag(s, 'printTotalQty', true) ? `<tr class="sumrow"><td colspan="${Math.max(1, colspanBefore - 1)}" class="r">Total</td><td class="r">${esc(totalQty)}</td>${showPrices ? `<td colspan="${cols.length - colspanBefore}" class="r"></td>` : ''}</tr>` : '';
    const stamp = (!o.deliveryNote && !isEst) ? `<span class="stat" style="background:${stColor}">${status}</span>` : '';
    const accent = C;

    const css = `
@page{size:${W}px ${H}px;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff}
body{width:${W}px;min-height:${H}px;padding:${land ? 28 : 36}px ${land ? 36 : 40}px;font:${fs}px/1.45 Roboto,Arial,Helvetica,"Segoe UI","Noto Nastaliq Urdu","Noto Naskh Arabic",sans-serif;word-spacing:normal;letter-spacing:normal;color:#1c2233;-webkit-print-color-adjust:exact;print-color-adjust:exact;position:relative}
.sm{font-size:${fs - 1.5}px;color:#556075}
.lbl{font-size:${fs - 3}px;letter-spacing:.07em;text-transform:uppercase;color:#8a93a6;font-weight:700;margin-bottom:3px}
.logo{width:62px;height:62px;object-fit:contain;border-radius:6px}
.brand{display:flex;gap:14px;align-items:center}
.bn{font-size:${fs + 8}px;font-weight:800;line-height:1.15;color:#141a2b}
.pn{font-size:${fs + 3}px;font-weight:700}
.mr{display:flex;justify-content:space-between;gap:18px;padding:2px 0}.mr span{color:#6b7488}
table{width:100%;border-collapse:collapse}
th{font-size:${fs - 1.5}px;text-align:left;padding:9px 10px;letter-spacing:.03em}
td{padding:9px 10px;vertical-align:top}
.r{text-align:right}.n{width:34px;color:#8a93a6}.b{font-weight:700}.d{font-size:${fs - 2}px;color:#6b7488}
tr{break-inside:avoid}thead{display:table-header-group}
.sumrow td{font-weight:700;border-top:1px solid #d9deea}
.bottom{display:flex;gap:26px;margin-top:18px;align-items:flex-start;break-inside:avoid}
.bl{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px}
.words,.terms{font-size:${fs - 1}px;line-height:1.5}
.tot{width:${land ? 300 : 280}px;flex:none}
.tr{display:flex;justify-content:space-between;padding:4px 0}
.grand{display:flex;justify-content:space-between;font-weight:800;font-size:${fs + 3}px;padding:9px 12px;margin:6px 0;border-radius:8px;background:${soft(accent, .12)};color:${accent}}
.saved{margin-top:6px;text-align:right;color:#059669;font-size:${fs - 1}px;font-weight:600}
.qr{display:flex;gap:12px;align-items:center;border:1px solid #e1e6ee;border-radius:10px;padding:10px;max-width:320px}.qr img{width:84px;height:84px;object-fit:contain}
.sig{display:flex;justify-content:flex-end;margin-top:26px;break-inside:avoid}
.sg{width:230px;text-align:center}.sgi{min-height:54px;display:flex;align-items:flex-end;justify-content:center;gap:6px}.sgi img{max-height:54px;max-width:150px}.sgi img.st{max-height:46px;opacity:.9}
.sgl{border-top:1px solid #9aa3b5;padding-top:4px;font-weight:600}
.rb{display:flex;justify-content:space-between;color:#6b7488;font-size:${fs - 1.5}px;margin-top:26px}
.stat{display:inline-block;color:#fff;padding:3px 12px;border-radius:6px;font-weight:700;font-size:${fs - 2}px;letter-spacing:.05em}
.od{text-align:right;font-size:${fs - 3}px;color:#8a93a6;letter-spacing:.1em;margin-bottom:6px}
.gen{position:absolute;left:0;right:0;bottom:26px;text-align:center;color:#8a93a6;font-size:${fs - 3}px;letter-spacing:.04em}.gen b{color:${accent}}
.pg{position:absolute;left:0;right:0;bottom:12px;text-align:center;color:#a0a8b8;font-size:${fs - 3}px}
.brandline{height:0}
`;
    let tcss = '', head = '';
    const metaBlock = `<div class="meta">${metaHTML}</div>`;
    switch (o.template) {
      case 'tally':
        tcss = `body{padding:24px 28px}.wrap{border:1.5px solid #222}.hd{text-align:center;padding:10px;border-bottom:1.5px solid #222}.hd .brand{justify-content:center}.ttl{font-weight:800;font-size:${fs + 4}px;text-align:center;padding:6px;border-bottom:1.5px solid #222;letter-spacing:.12em}
.two{display:flex}.two>div{flex:1;padding:9px 12px}.two>div+div{border-left:1.5px solid #222}
table th{border:1px solid #222;background:#f1f1f1;color:#111}table td{border:1px solid #444}table{border-top:1.5px solid #222}
.bottom{margin:0;padding:10px 12px;border-top:1.5px solid #222;gap:18px}.grand{background:#f1f1f1;color:#111;border-radius:0}.sig{padding:0 12px 12px;margin-top:10px}.rb{padding:0 12px}`;
        head = `<div class="wrap"><div class="hd">${brand}</div><div class="ttl">${(isEst ? 'QUOTATION' : o.deliveryNote ? 'DELIVERY NOTE' : isRet ? 'CREDIT NOTE' : (m.tax > 0 ? 'TAX INVOICE' : 'INVOICE'))}</div>
<div class="two"><div>${billTo}</div><div>${metaBlock}</div></div>`;
        break;
      case 'classic':
        tcss = `.hd{text-align:center;border-bottom:2px solid #1c2233;padding-bottom:12px}.hd .brand{justify-content:center}.ttl2{text-align:center;font-weight:800;letter-spacing:.2em;margin:14px 0 4px;font-size:${fs + 2}px}
.two{display:flex;justify-content:space-between;margin:12px 0}th{border-top:1.5px solid #1c2233;border-bottom:1.5px solid #1c2233}td{border-bottom:1px solid #e1e6ee}`;
        head = `<div class="hd">${brand}</div><div class="ttl2">${title.toUpperCase()}</div><div class="two"><div>${billTo}</div><div style="min-width:220px">${metaBlock}</div></div>`;
        break;
      case 'banner':
        tcss = `body{padding:0}.in{padding:26px 40px}.bar{background:${accent};color:#fff;padding:26px 40px;display:flex;justify-content:space-between;align-items:center}.bar .bn{color:#fff}.bar .sm{color:rgba(255,255,255,.88)}.bar .logo{background:#fff;padding:4px}
.bt{font-size:${fs + 14}px;font-weight:800;letter-spacing:.06em;text-align:right}.two{display:flex;justify-content:space-between;margin:18px 0 12px}th{background:${accent};color:#fff}tr:nth-child(even) td{background:#f7f9fc}td{border-bottom:1px solid #e9edf4}`;
        head = `<div class="bar">${brand}<div><div class="bt">${title.toUpperCase()}</div></div></div><div class="in"><div class="two"><div>${billTo}</div><div style="min-width:220px">${metaBlock}</div></div>`;
        break;
      case 'frame':
        tcss = `body{padding:30px}.fr{border:2px solid ${accent};padding:6px}.fr2{border:1px solid ${accent};padding:22px 26px;min-height:${H - 100}px}.hd{text-align:center;margin-bottom:10px}.hd .brand{justify-content:center}
.ttl2{text-align:center;color:${accent};font-weight:800;letter-spacing:.25em;margin:8px 0 14px;font-size:${fs + 3}px;border-top:1px solid ${accent};border-bottom:1px solid ${accent};padding:6px 0}.two{display:flex;justify-content:space-between;margin-bottom:12px}
th{background:${soft(accent, .1)};color:${accent};border-top:1px solid ${accent};border-bottom:1px solid ${accent}}td{border-bottom:1px dashed #cfd6e3}`;
        head = `<div class="fr"><div class="fr2"><div class="hd">${brand}</div><div class="ttl2">${title.toUpperCase()}</div><div class="two"><div>${billTo}</div><div style="min-width:220px">${metaBlock}</div></div>`;
        break;
      case 'french':
        tcss = `.top{display:flex;justify-content:space-between;align-items:flex-start}.ttl3{background:${accent};color:#fff;font-weight:800;font-size:${fs + 8}px;letter-spacing:.04em;padding:8px 18px;width:55%;margin-bottom:8px}.fn{color:${accent};font-size:${fs + 4}px;font-weight:600;margin:4px 0 10px}.cols{display:flex;gap:30px;border-bottom:2px solid ${accent};padding-bottom:10px;margin-bottom:12px}.cols>div{flex:1}.two{display:flex;justify-content:space-between;margin-bottom:12px}th{background:${accent};color:#fff}td{border-bottom:1px solid #e6eaf2}.sumrow td{background:${accent};color:#fff;border:0}.grand{background:${accent};color:#fff}`;
        head = `<div class="top"><div style="flex:1"><div class="ttl3">${title.toUpperCase()}</div><div class="fn">${esc(s.businessName || '')}</div></div>${logo}</div><div class="cols"><div><div class="lbl">Address</div>${addrTxt}</div><div><div class="lbl">Phone</div>${phoneTxt}</div><div><div class="lbl">Email</div>${emailTxt}</div></div><div class="two"><div>${billTo}</div><div style="min-width:220px">${metaBlock}</div></div>`;
        break;
      case 'divine':
        tcss = `body{padding:0}.hdr{position:relative;height:128px;background:${accent};overflow:hidden}.hdr .dk{position:absolute;left:0;top:0;bottom:0;width:46%;background:#232a36;border-radius:0 0 70px 0;padding:18px 26px;color:#fff}.hdr .dk .bn{color:#fff;font-size:${fs + 5}px;margin-top:6px}.hdr .ct{position:absolute;right:28px;top:26px;color:#fff;text-align:right;font-size:${fs - 1}px;line-height:1.8}.in{padding:24px 40px}.it{font-size:${fs + 8}px;margin:0 0 10px}.two{display:flex;justify-content:space-between;margin-bottom:12px}th{background:${accent};color:#fff}td{border-bottom:1px solid #e9edf4}.sumrow td{background:${accent};color:#fff;border:0}.grand{background:${accent};color:#fff}.ft{height:12px;background:linear-gradient(90deg,${accent} 55%,#232a36 55%);position:absolute;left:0;right:0;bottom:0}`;
        head = `<div class="hdr"><div class="dk">${logo}<div class="bn">${esc(s.businessName || '')}</div></div><div class="ct">${phoneTxt}<br>${emailTxt}<br>${addrTxt}</div></div><div class="in"><div class="it">${title}</div><div class="two"><div>${billTo}</div><div style="min-width:220px">${metaBlock}</div></div>`;
        break;
      case 'minimal':
        tcss = `.top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:26px}.tt{font-size:${fs + 16}px;font-weight:300;letter-spacing:.04em;color:${accent}}.two{display:flex;justify-content:space-between;margin-bottom:18px}
th{font-size:${fs - 3}px;text-transform:uppercase;color:#8a93a6;border-bottom:1px solid #1c2233;padding-left:0}td{border-bottom:1px solid #eef1f6;padding-left:0}.grand{background:none;border-top:2px solid ${accent};border-radius:0;padding-left:0;padding-right:0}`;
        head = `<div class="top">${brand}<div style="text-align:right"><div class="tt">${title}</div></div></div><div class="two"><div>${billTo}</div><div style="min-width:220px">${metaBlock}</div></div>`;
        break;
      case 'theme1':
        tcss = `.top{display:flex;justify-content:space-between;align-items:center;gap:16px;padding-bottom:12px}.tt{font-size:${fs + 10}px;font-weight:800;color:${accent};text-align:right}
.two{display:flex;gap:0;border:1px solid #c9cfdc;margin:10px 0}.two>div{flex:1;padding:10px 14px}.two>div+div{border-left:1px solid #c9cfdc}
table{border:1px solid #c9cfdc}th{background:${accent};color:#fff}td{border-bottom:1px solid #e4e8f0}.grand{border-radius:0}`;
        head = `<div class="top">${brand}<div class="tt">${title}</div></div><div class="two"><div>${billTo}</div><div>${metaBlock}</div></div>`;
        break;
      case 'theme2':
        tcss = `.band{background:${soft(accent, .1)};border-left:6px solid ${accent};padding:16px 20px;display:flex;justify-content:space-between;align-items:center;gap:16px}.tt{font-size:${fs + 9}px;font-weight:800;color:${accent};letter-spacing:.05em}
.two{display:flex;justify-content:space-between;gap:20px;margin:16px 0 10px}th{border-bottom:2px solid ${accent};color:${accent};padding-left:6px}td{border-bottom:1px solid #e9edf4;padding-left:6px}.grand{background:${accent};color:#fff;border-radius:6px}`;
        head = `<div class="band">${brand}<div class="tt">${title.toUpperCase()}</div></div><div class="two"><div>${billTo}</div><div style="min-width:220px">${metaBlock}</div></div>`;
        break;
      case 'theme3':
        tcss = `.hd{text-align:center}.hd .brand{justify-content:center}.ttl2{text-align:center;margin:12px 0;font-weight:800;font-size:${fs + 3}px;color:#fff;background:${accent};padding:6px 0;letter-spacing:.2em}
.two{display:flex;justify-content:space-between;margin:12px 0}tbody tr:nth-child(even) td{background:#f5f7fb}th{background:#1c2233;color:#fff}td{border-bottom:1px solid #e9edf4}`;
        head = `<div class="hd">${brand}</div><div class="ttl2">${title.toUpperCase()}</div><div class="two"><div>${billTo}</div><div style="min-width:220px">${metaBlock}</div></div>`;
        break;
      case 'tax1':
        tcss = `body{padding:22px 26px}.wrap{border:1.5px solid #1c2233}.hd{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px;border-bottom:1.5px solid #1c2233}.tt{font-weight:800;font-size:${fs + 5}px;text-align:right}
.two{display:flex}.two>div{flex:1;padding:9px 14px}.two>div+div{border-left:1.5px solid #1c2233}.two{border-bottom:1.5px solid #1c2233}
table th{border:1px solid #1c2233;background:#eef0f5}table td{border:1px solid #6b7488}.bottom{padding:10px 14px;margin:0;border-top:1.5px solid #1c2233}.grand{border-radius:0;background:#eef0f5;color:#111}.sig{padding:0 14px 12px}.rb{padding:0 14px}`;
        head = `<div class="wrap"><div class="hd">${brand}<div class="tt">${(isEst ? 'QUOTATION' : isRet ? 'CREDIT NOTE' : (m.tax > 0 ? 'TAX INVOICE' : 'INVOICE'))}</div></div><div class="two"><div>${billTo}</div><div>${metaBlock}</div></div>`;
        break;
      case 'tax2':
        tcss = `.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:3px double ${accent};padding-bottom:12px}.tt{font-size:${fs + 8}px;font-weight:800;color:${accent};text-align:right}
.two{display:flex;justify-content:space-between;gap:20px;margin:14px 0}.two>div{flex:1}th{background:${accent};color:#fff;border:1px solid ${accent}}td{border:1px solid #d5dae6}.grand{border-radius:0}`;
        head = `<div class="top">${brand}<div class="tt">${(isEst ? 'QUOTATION' : isRet ? 'CREDIT NOTE' : (m.tax > 0 ? 'TAX INVOICE' : 'INVOICE'))}<div style="margin-top:4px;font-size:${fs}px;font-weight:400;color:#556075">${s.taxId ? "Tax ID: " + esc(s.taxId) : ''}</div></div></div><div class="two"><div>${billTo}</div><div>${metaBlock}</div></div>`;
        break;
      case 'tax3':
        tcss = `.top{display:flex;justify-content:space-between;align-items:center;gap:16px}.tt{background:${accent};color:#fff;padding:8px 22px;font-weight:800;font-size:${fs + 4}px;letter-spacing:.08em;border-radius:0 0 0 18px}
body{padding-top:0}.two{display:flex;gap:14px;margin:16px 0 10px}.two>div{flex:1;border:1px solid #d5dae6;border-radius:8px;padding:10px 14px}th{background:${soft(accent, .14)};color:${accent}}td{border-bottom:1px solid #e9edf4}`;
        head = `<div class="top"><div style="padding-top:34px">${brand}</div><div class="tt">${(isEst ? 'QUOTATION' : isRet ? 'CREDIT NOTE' : (m.tax > 0 ? 'TAX INVOICE' : 'INVOICE'))}</div></div><div class="two"><div>${billTo}</div><div>${metaBlock}</div></div>`;
        break;
      case 'landscape2':
        tcss = `.top{display:flex;justify-content:space-between;align-items:center;background:${accent};color:#fff;padding:14px 20px;border-radius:8px}.top .bn,.top .sm{color:#fff}.tt{font-size:${fs + 8}px;font-weight:800;letter-spacing:.06em}
.two{display:flex;justify-content:space-between;gap:30px;margin:12px 0}th{border-bottom:2px solid ${accent};color:${accent}}td{border-bottom:1px solid #e9edf4}.tot{width:330px}`;
        head = `<div class="top">${brand}<div class="tt">${title.toUpperCase()}</div></div><div class="two"><div>${billTo}</div><div style="min-width:240px">${metaBlock}</div></div>`;
        break;
      case 'landscape':
        tcss = `.top{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid ${accent};padding-bottom:12px;margin-bottom:12px}.right{display:flex;gap:40px;align-items:flex-start}.tt{font-size:${fs + 10}px;font-weight:800;color:${accent};letter-spacing:.05em}
.two{display:flex;justify-content:space-between;margin:10px 0}th{background:${soft(accent, .12)};color:${accent}}td{border-bottom:1px solid #e9edf4}.tot{width:330px}`;
        head = `<div class="top">${brand}<div class="right"><div>${billTo}</div><div style="min-width:200px"><div class="tt">${title.toUpperCase()}</div>${metaBlock}</div></div></div>`;
        break;
      default: // modern
        tcss = `.top{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid ${accent}}.tt{font-size:${fs + 12}px;font-weight:800;color:${accent};text-align:right;letter-spacing:.02em}
.two{display:flex;justify-content:space-between;gap:20px;margin:16px 0 12px}.two .box{background:${soft(accent, .06)};border-radius:10px;padding:10px 14px;flex:1}
th{background:${soft(accent, .12)};color:${accent};border-radius:0}th:first-child{border-radius:8px 0 0 8px}th:last-child{border-radius:0 8px 8px 0}td{border-bottom:1px solid #edf0f6}`;
        head = `<div class="top">${brand}<div><div class="tt">${title}</div><div style="text-align:right;margin-top:4px">${stamp}</div></div></div><div class="two"><div class="box">${billTo}</div><div class="box">${metaBlock}</div></div>`;
    }
    const close = (o.template === 'tally' || o.template === 'tax1') ? '</div>' : o.template === 'divine' ? '</div><div class="ft"></div>' : o.template === 'banner' ? '</div>' : o.template === 'frame' ? '</div></div>' : '';
    const bodyHTML = `${orig}${head}
<table><thead>${thead}</thead><tbody>${tbody}</tbody><tfoot>${qtyRow}</tfoot></table>
<div class="bottom"><div class="bl">${words}${desc}${terms}${qr}</div>${showPrices ? totalsHTML : ''}</div>
${recv}${sig}${close}
${ctx.brand !== false ? '<div class="gen">Generated with <b>Billaura</b></div>' : ''}
${flag(s, 'printPageNumbers', true) ? `<div class="pg">${esc(inv.number)} · Page 1</div>` : ''}`;
    return { html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)} ${esc(inv.number)}</title><style>${css}${tcss}</style></head><body>${bodyHTML}</body></html>`, W, H, land };
  }

  function docHTML(inv, ctx, o) { return build(inv, ctx, o).html; }

  function printHTML(html) {
    return new Promise((resolve, reject) => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0';
      f.onload = () => setTimeout(() => {
        try { f.contentWindow.focus(); f.contentWindow.print(); resolve(); } catch (e) { reject(e); }
        setTimeout(() => { try { f.remove(); } catch (e) {} }, 60000);
      }, 400);
      document.body.appendChild(f); f.srcdoc = html;
    });
  }
  function printDoc(inv, ctx, o) { return printHTML(docHTML(inv, ctx, o)); }

  function renderCanvas(inv, ctx, o, scale) {
    const b = build(inv, ctx, o);
    return new Promise((resolve, reject) => {
      const f = document.createElement('iframe');
      f.style.cssText = `position:fixed;left:-99999px;top:0;width:${b.W}px;height:${b.H}px;border:0`;
      f.onload = () => setTimeout(async () => {
        try {
          const d = f.contentDocument, body = d.body;
          f.style.height = Math.max(b.H, body.scrollHeight) + 'px';
          const cv = await window.html2canvas(body, { scale: scale || 2, backgroundColor: '#ffffff', useCORS: true, width: b.W, windowWidth: b.W });
          resolve({ canvas: cv, W: b.W, H: b.H, land: b.land });
        } catch (e) { reject(e); } finally { setTimeout(() => f.remove(), 100); }
      }, 350);
      document.body.appendChild(f); f.srcdoc = b.html;
    });
  }
  async function image(inv, ctx, o) {
    const r = await renderCanvas(inv, ctx, o, 2);
    return new Promise(res => r.canvas.toBlob(res, 'image/png'));
  }
  async function pdf(inv, ctx, o, filename) {
    const r = await renderCanvas(inv, ctx, o, 2);
    const { jsPDF } = window.jspdf;
    const mmW = r.land ? 297 : (optsFrom(ctx.settings, o).pageSize === 'A5' ? 148 : 210);
    const mmH = mmW * r.H / r.W;
    const doc = new jsPDF({ unit: 'mm', format: [mmW, mmH], orientation: r.land ? 'landscape' : 'portrait' });
    const cw = r.canvas.width, ch = r.canvas.height, pageH = Math.round(cw * mmH / mmW);
    const pages = Math.max(1, Math.ceil(ch / pageH));
    for (let p = 0; p < pages; p++) {
      const sl = document.createElement('canvas'); sl.width = cw; sl.height = Math.min(pageH, ch - p * pageH);
      const g = sl.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, sl.width, sl.height);
      g.drawImage(r.canvas, 0, p * pageH, cw, sl.height, 0, 0, cw, sl.height);
      if (p) doc.addPage([mmW, mmH], r.land ? 'landscape' : 'portrait');
      doc.addImage(sl.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, mmW, sl.height * mmW / cw);
    }
    { const fn = filename || `Invoice-${inv.number}.pdf`; try { const bl = doc.output('blob'); const a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = fn; document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 4000); } catch (e) { doc.save(fn); } }
  }

  // ===================== Business cards =====================
  const CARD_TEMPLATES = [
    { id: 'classic', name: 'Classic Red' }, { id: 'midnight', name: 'Midnight Gold' }, { id: 'wave', name: 'Ocean Wave' },
    { id: 'pattern', name: 'Heritage' }, { id: 'split', name: 'Split Panel' }, { id: 'line', name: 'Fine Line' },
    { id: 'emerald', name: 'Emerald' }, { id: 'sunset', name: 'Sunset' }
  ];
  function cardHTML(s, id) {
    const name = esc(s.businessName || 'Your Business'), owner = esc(s.ownerName || ''), tag = esc((s.businessDesc || '').slice(0, 60));
    const ph = esc(s.phone || ''), ph2 = esc(s.phone2 || ''), em = esc(s.email || ''), ad = esc([s.address, s.city].filter(Boolean).join(', '));
    const logo = s.logo ? `<img src="${esc(s.logo)}" style="width:54px;height:54px;object-fit:contain;border-radius:8px;background:#fff;padding:3px">` : '';
    const rows = (c, ic) => [[ph || ph2 ? 'M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.6 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.3.2 2.5.6 3.6a1 1 0 0 1-.25 1z' : '', [ph, ph2].filter(Boolean).join(' / ')],
      [em ? 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2l8 6 8-6' : '', em],
      [ad ? 'M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z' : '', ad]].filter(r => r[1]).map(r =>
      `<div style="display:flex;gap:7px;align-items:center;margin-top:5px;font-size:11px;color:${c};line-height:1.25"><svg width="12" height="12" viewBox="0 0 24 24" fill="${ic}" style="flex:none"><path d="${r[0]}"/></svg><span>${r[1]}</span></div>`).join('');
    const base = 'position:absolute;inset:0;overflow:hidden;font-family:Inter,Roboto,Arial,sans-serif;';
    const ttl = (c, sz) => `<div style="font-size:${sz || 21}px;font-weight:800;color:${c};line-height:1.1">${name}</div>${owner ? `<div style="font-size:11.5px;color:${c};opacity:.85;margin-top:3px">${owner}</div>` : ''}${tag ? `<div style="font-size:10px;color:${c};opacity:.7;margin-top:2px">${tag}</div>` : ''}`;
    switch (id) {
      case 'midnight': return `<div style="${base}background:linear-gradient(135deg,#0F1A33,#1B2B55)"><div style="position:absolute;right:-40px;top:-40px;width:150px;height:150px;border:2px solid #D4AF37;border-radius:50%;opacity:.5"></div><div style="position:absolute;right:-10px;top:-10px;width:90px;height:90px;border:2px solid #D4AF37;border-radius:50%;opacity:.3"></div>
        <div style="position:absolute;left:20px;top:18px;right:20px">${logo ? `<div style="margin-bottom:8px">${logo}</div>` : ''}${ttl('#F4E4A6', 20)}</div><div style="position:absolute;left:20px;bottom:16px;right:20px;border-top:1px solid #D4AF3788;padding-top:6px">${rows('#E9ECF5', '#D4AF37')}</div></div>`;
      case 'wave': return `<div style="${base}background:linear-gradient(120deg,#0A6FE0,#12B5B0)"><svg viewBox="0 0 300 176" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%"><path d="M0 120 C60 90 120 160 200 120 S280 90 300 110 V176 H0Z" fill="#fff" opacity=".16"/><path d="M0 140 C70 110 130 170 210 140 S280 120 300 135 V176 H0Z" fill="#fff" opacity=".18"/></svg>
        <div style="position:absolute;left:20px;top:16px;right:20px;display:flex;gap:12px;align-items:center">${logo}<div>${ttl('#fff', 20)}</div></div><div style="position:absolute;left:20px;bottom:14px;right:20px">${rows('#fff', '#fff')}</div></div>`;
      case 'pattern': return `<div style="${base}background:#3A0F12"><div style="position:absolute;inset:0;background:repeating-conic-gradient(from 45deg at 50% 50%,#7A1F22 0 25%,#4A1114 0 50%) 0 0/26px 26px;opacity:.55"></div><div style="position:absolute;inset:14px;background:#FFF8EC;border-radius:8px;padding:12px 16px;border:2px solid #C9972B">
        <div style="display:flex;gap:10px;align-items:center">${logo}<div>${ttl('#5A1418', 18)}</div></div><div style="margin-top:6px">${rows('#3C2A2A', '#9B6B10')}</div></div></div>`;
      case 'split': return `<div style="${base}background:#fff;display:flex"><div style="width:38%;background:linear-gradient(160deg,#EF1A3C,#B80F2C);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:#fff">${logo || `<div style="font-size:44px;font-weight:800">${esc((s.businessName || 'B')[0] || 'B')}</div>`}</div>
        <div style="flex:1;padding:18px 16px">${ttl('#22273A', 17)}<div style="margin-top:8px">${rows('#4A5068', '#EF1A3C')}</div></div></div>`;
      case 'line': return `<div style="${base}background:#fff"><div style="position:absolute;inset:10px;border:1.5px solid #22273A;border-radius:6px"></div><div style="position:absolute;left:24px;top:22px;right:24px;display:flex;justify-content:space-between;gap:10px"><div>${ttl('#22273A', 19)}</div>${logo}</div>
        <div style="position:absolute;left:24px;bottom:22px;right:24px">${rows('#22273A', '#22273A')}</div><div style="position:absolute;left:24px;top:84px;width:40px;height:3px;background:#EF1A3C"></div></div>`;
      case 'emerald': return `<div style="${base}background:linear-gradient(135deg,#065F46,#10B981)"><div style="position:absolute;right:-30px;bottom:-50px;width:190px;height:190px;border-radius:50%;background:rgba(255,255,255,.12)"></div>
        <div style="position:absolute;left:20px;top:18px;right:20px;display:flex;gap:12px;align-items:center">${logo}<div>${ttl('#fff', 20)}</div></div><div style="position:absolute;left:20px;bottom:14px;right:20px">${rows('#ECFDF5', '#fff')}</div></div>`;
      case 'sunset': return `<div style="${base}background:linear-gradient(135deg,#FF8A3D,#EF1A6B)"><div style="position:absolute;left:-30px;top:-30px;width:130px;height:130px;border-radius:50%;background:rgba(255,255,255,.16)"></div>
        <div style="position:absolute;left:20px;top:18px;right:20px">${logo ? `<div style="margin-bottom:8px">${logo}</div>` : ''}${ttl('#fff', 21)}</div><div style="position:absolute;left:20px;bottom:14px;right:20px">${rows('#fff', '#fff')}</div></div>`;
      default: return `<div style="${base}background:#fff"><svg viewBox="0 0 300 176" style="position:absolute;right:0;top:0;width:60%;height:100%"><path d="M60 0 L200 0 L300 0 L300 176 L260 176Z" fill="#FBE9EC"/><path d="M120 10 L190 120 L260 10 L225 10 L190 70 L155 10Z" fill="#F4C6CE" opacity=".8"/></svg>
        <div style="position:absolute;left:20px;top:16px;right:20px;display:flex;justify-content:space-between;align-items:flex-start"><div>${ttl('#E0102F', 21)}</div>${logo || ''}</div>
        <div style="position:absolute;left:20px;bottom:16px;border-left:3px solid #E0102F;padding-left:10px">${rows('#3B3F58', '#0A6FE0')}</div></div>`;
    }
  }
  async function cardCanvas(s, id) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:350px;height:200px';
    host.innerHTML = `<div style="position:relative;width:350px;height:200px">${cardHTML(s, id)}</div>`;
    document.body.appendChild(host);
    try { return await window.html2canvas(host.firstChild, { scale: 3, backgroundColor: null, useCORS: true }); } finally { host.remove(); }
  }

  window.BillauraTemplates = { INVOICE_TEMPLATES, COLORS, PAGES, CARD_TEMPLATES, optsFrom, docHTML, printDoc, renderCanvas, image, pdf, cardHTML, cardCanvas };
})();
