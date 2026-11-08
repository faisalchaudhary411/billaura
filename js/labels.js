/* Billaura – © 2026 Billaura. All rights reserved.
 * labels.js: offline Code 128 barcode generator + printable label sheets (no external library needed).
 *   BillauraLabels.svg(text, {height, module})  -> SVG markup of a Code 128-B barcode
 *   BillauraLabels.html(items, opts)            -> full printable HTML document
 *   BillauraLabels.print(html)                  -> opens the system print dialog for the labels
 */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Code 128 bar/space widths for symbol values 0..106 (bar,space,bar,space,bar,space)
  const PAT = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];

  function encode(text) {
    const s = String(text == null ? '' : text).replace(/[^\x20-\x7E]/g, '?') || ' ';
    const codes = [104]; // Start B
    for (const ch of s) codes.push(ch.charCodeAt(0) - 32);
    let sum = codes[0];
    for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
    codes.push(sum % 103, 106); // checksum, stop
    return codes.map(c => PAT[c]).join('');
  }
  // returns { w, bars: [[x,width],...] } in module units
  function bars(text) {
    const pat = encode(text); let x = 0; const out = [];
    for (let i = 0; i < pat.length; i++) {
      const w = +pat[i];
      if (i % 2 === 0) out.push([x, w]);
      x += w;
    }
    return { w: x, bars: out };
  }
  function svg(text, o) {
    o = o || {};
    const h = o.height || 50, quiet = 10;
    const b = bars(text), W = b.w + quiet * 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" preserveAspectRatio="none" class="bcsvg" shape-rendering="crispEdges"><rect width="${W}" height="${h}" fill="#fff"/>${b.bars.map(r => `<rect x="${r[0] + quiet}" y="0" width="${r[1]}" height="${h}" fill="#000"/>`).join('')}</svg>`;
  }

  const SIZES = {
    '50x30': { name: '50 × 30 mm (roll)', w: 50, h: 30, cols: 1, roll: true },
    '40x25': { name: '40 × 25 mm (roll)', w: 40, h: 25, cols: 1, roll: true },
    '58x40': { name: '58 × 40 mm (roll)', w: 58, h: 40, cols: 1, roll: true },
    'a4-24': { name: 'A4 sheet – 24 labels (3 × 8)', w: 70, h: 37, cols: 3, sheet: true },
    'a4-40': { name: 'A4 sheet – 40 labels (4 × 10)', w: 48.5, h: 25.4, cols: 4, sheet: true },
    'a4-12': { name: 'A4 sheet – 12 labels (2 × 6)', w: 99, h: 42, cols: 2, sheet: true }
  };

  // items: [{ name, code, price, qty }]
  function html(items, o) {
    o = o || {};
    const S = SIZES[o.size] || SIZES['50x30'];
    const flat = [];
    (items || []).forEach(it => { for (let i = 0; i < Math.max(1, Math.min(500, it.qty | 0 || 1)); i++) flat.push(it); });
    const small = S.h <= 26;
    const label = it => `<div class="lb">
      ${o.shop ? `<div class="shop">${esc(o.shopName || '')}</div>` : ''}
      ${o.name !== false ? `<div class="nm">${esc(it.name)}</div>` : ''}
      <div class="bw">${svg(it.code, { height: 40 })}</div>
      ${o.code !== false ? `<div class="cd">${esc(it.code)}</div>` : ''}
      ${o.price ? `<div class="pr">${esc(o.currency || '')} ${esc(it.priceText)}</div>` : ''}
    </div>`;
    const css = `
${S.roll ? `@page{size:${S.w}mm ${S.h}mm;margin:0}` : '@page{size:A4;margin:0}'}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}
body{font-family:Roboto,Arial,Helvetica,sans-serif;color:#000}
.sheet{${S.sheet ? `display:grid;grid-template-columns:repeat(${S.cols},${S.w}mm);grid-auto-rows:${S.h}mm;padding:${S.cols === 4 ? '10.8mm 8.4mm' : S.cols === 3 ? '15.5mm 0' : '10mm 6mm'};justify-content:center` : ''}}
.lb{width:${S.w}mm;height:${S.h}mm;padding:${small ? '1mm 2mm' : '1.6mm 2.6mm'};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;overflow:hidden;${S.roll ? 'page-break-after:always;break-after:page;' : ''}break-inside:avoid}
.shop{font-size:${small ? 5.5 : 7}pt;font-weight:700;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.nm{font-size:${small ? 6.5 : 8.5}pt;font-weight:600;line-height:1.1;max-height:2.3em;overflow:hidden;max-width:100%}
.bw{width:100%;flex:1;min-height:0;margin:.6mm 0;display:flex}.bcsvg{width:100%;height:100%}
.cd{font-size:${small ? 6 : 7.5}pt;letter-spacing:.08em;font-family:monospace}
.pr{font-size:${small ? 8 : 11}pt;font-weight:800}`;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Labels</title><style>${css}</style></head><body><div class="sheet">${flat.map(label).join('')}</div></body></html>`;
  }

  function print(htmlStr) {
    return new Promise((resolve, reject) => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0';
      f.onload = () => setTimeout(() => {
        try { f.contentWindow.focus(); f.contentWindow.print(); resolve(); } catch (e) { reject(e); }
        setTimeout(() => { try { f.remove(); } catch (e) {} }, 60000);
      }, 300);
      document.body.appendChild(f); f.srcdoc = htmlStr;
    });
  }

  window.BillauraLabels = { svg, html, print, SIZES, encode };
})();
