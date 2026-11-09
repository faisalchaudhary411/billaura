/* Billaura – © 2026 Billaura. All rights reserved.
 * ui.js: branded replacements for the browser's own dialogs and form controls
 *   BillauraUI.confirm / prompt / choice  -> promise based dialogs (no more "xyz.github.io says")
 *   BillauraUI.pick                       -> bottom sheet picker
 *   enhance()                             -> turns every <select>, <input type=date> and <datalist> input
 *                                            into app-styled controls (the real element stays, hidden, so
 *                                            existing code that reads .value keeps working)
 */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; };

  // ---------------------------------------------------------------- dialogs
  function dialog(o) {
    return new Promise(resolve => {
      const back = el(`<div class="ui-back"><div class="ui-dlg" role="dialog" aria-modal="true">
        ${o.title ? `<div class="ui-title">${esc(o.title)}</div>` : ''}
        <div class="ui-msg">${esc(o.message || '').replace(/\n/g, '<br>')}</div>
        ${o.input ? `<input class="ui-input form-input" type="${o.type || 'text'}" ${o.type === 'number' ? 'inputmode="decimal" step="any"' : ''} value="${esc(o.value || '')}" placeholder="${esc(o.placeholder || '')}" autocomplete="off" />` : ''}
        <div class="ui-btns ${o.buttons.length > 2 ? 'stack' : ''}">${o.buttons.map((b, i) => `<button type="button" class="ui-btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>
      </div></div>`);
      document.body.appendChild(back);
      const inp = back.querySelector('.ui-input');
      let done = false;
      const finish = (v) => { if (done) return; done = true; back.classList.add('out'); setTimeout(() => back.remove(), 120); resolve(v); };
      back.querySelectorAll('.ui-btn').forEach(b => b.addEventListener('click', () => {
        const i = +b.dataset.i; const btn = o.buttons[i];
        finish(o.input ? (btn.ok ? inp.value : null) : (btn.value !== undefined ? btn.value : i));
      }));
      back.addEventListener('click', e => { if (e.target === back && !o.modal) finish(o.input ? null : (o.cancelValue !== undefined ? o.cancelValue : false)); });
      document.addEventListener('keydown', function k(e) {
        if (done) return document.removeEventListener('keydown', k);
        if (e.key === 'Escape') finish(o.input ? null : (o.cancelValue !== undefined ? o.cancelValue : false));
        if (e.key === 'Enter' && inp) { const ok = o.buttons.findIndex(b => b.ok); if (ok >= 0) back.querySelectorAll('.ui-btn')[ok].click(); }
      });
      setTimeout(() => { if (inp) { inp.focus(); inp.select(); } }, 60);
    });
  }
  function confirmDlg(message, o) {
    o = o || {};
    return dialog({ title: o.title || 'Please confirm', message, cancelValue: false,
      buttons: [{ label: o.cancelText || 'Cancel', value: false, cls: 'ghost' }, { label: o.okText || 'OK', value: true, cls: o.danger ? 'danger' : 'primary' }] });
  }
  function promptDlg(message, value, o) {
    o = o || {};
    return dialog({ title: o.title || '', message, input: true, value, type: o.type, placeholder: o.placeholder,
      buttons: [{ label: 'Cancel', cls: 'ghost' }, { label: o.okText || 'OK', ok: true, cls: 'primary' }] });
  }
  // choice: labels -> resolves with index (or -1 when dismissed)
  function choiceDlg(message, labels, o) {
    o = o || {};
    return dialog({ title: o.title || '', message, cancelValue: -1,
      buttons: labels.map((l, i) => ({ label: l, value: i, cls: i === 0 ? 'primary' : 'ghost' })).concat([{ label: 'Cancel', value: -1, cls: 'ghost' }]) });
  }

  // ---------------------------------------------------------------- pick sheet
  function pick(o) {
    const old = document.getElementById('pickSheet'); if (old) old.remove();
    const opts = o.options.map(x => typeof x === 'string' ? { value: x, label: x } : x);
    const back = el('<div id="pickSheet" class="ps-back"></div>');
    const close = () => back.remove();
    const search = o.search !== undefined ? o.search : opts.length > 8;
    back.innerHTML = `<div class="ps-sheet"><div class="ps-head"><b>${esc(o.title || 'Select')}</b><button type="button" class="ps-x" aria-label="Close">✕</button></div>
      ${search ? '<input class="form-input ps-q" placeholder="Search" />' : ''}<div class="ps-list"></div>
      ${o.addNew ? `<button type="button" class="ps-add">+ ${esc(o.addNew)}</button>` : ''}</div>`;
    document.body.appendChild(back);
    const draw = q => {
      const list = opts.filter(x => !q || String(x.label).toLowerCase().includes(q.toLowerCase()));
      back.querySelector('.ps-list').innerHTML = list.map(x => `<button type="button" class="ps-item ${String(x.value) === String(o.selected) ? 'sel' : ''}" data-i="${opts.indexOf(x)}"><span class="ps-radio"></span>${esc(x.label)}</button>`).join('') || '<div class="doc-empty">Nothing found</div>';
      back.querySelectorAll('.ps-item').forEach(b => b.onclick = () => { const x = opts[+b.dataset.i]; close(); o.onPick(x.value, x.label); });
    };
    draw('');
    back.onclick = e => { if (e.target === back) close(); };
    back.querySelector('.ps-x').onclick = close;
    const q = back.querySelector('.ps-q'); if (q) q.oninput = () => draw(q.value);
    const a = back.querySelector('.ps-add');
    if (a) a.onclick = async () => {
      const n = ((await promptDlg(o.addNew.replace(/^Add New /, 'New ') + ' name', '')) || '').trim();
      if (n) { close(); o.onPick(o.normalize ? o.normalize(n) : n); }
    };
  }

  // ---------------------------------------------------------------- calendar picker
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  function fmtDate(v) {
    if (!v) return '';
    const d = new Date(v + 'T12:00:00'); if (isNaN(d)) return v;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function calendar(o) {
    const old = document.getElementById('pickSheet'); if (old) old.remove();
    const back = el('<div id="pickSheet" class="ps-back"></div>');
    const close = () => back.remove();
    let cur = o.value ? new Date(o.value + 'T12:00:00') : new Date();
    if (isNaN(cur)) cur = new Date();
    let view = new Date(cur.getFullYear(), cur.getMonth(), 1);
    const min = o.min || '', max = o.max || '', todayIso = iso(new Date());
    const draw = () => {
      const y = view.getFullYear(), m = view.getMonth();
      const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
      let cells = '';
      for (let i = 0; i < first; i++) cells += '<span></span>';
      for (let d = 1; d <= days; d++) {
        const k = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        const dis = (min && k < min) || (max && k > max);
        cells += `<button type="button" class="cal-d ${k === o.value ? 'sel' : ''} ${k === todayIso ? 'today' : ''}" data-k="${k}" ${dis ? 'disabled' : ''}>${d}</button>`;
      }
      back.innerHTML = `<div class="ps-sheet cal"><div class="ps-head"><b>${esc(o.title || 'Select date')}</b><button type="button" class="ps-x" aria-label="Close">✕</button></div>
        <div class="cal-nav"><button type="button" data-n="-12">«</button><button type="button" data-n="-1">‹</button><b>${MONTHS[m]} ${y}</b><button type="button" data-n="1">›</button><button type="button" data-n="12">»</button></div>
        <div class="cal-w"><span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span></div>
        <div class="cal-g">${cells}</div>
        <div class="cal-foot"><button type="button" class="ui-btn ghost" data-act="clear">Clear</button><button type="button" class="ui-btn primary" data-act="today">Today</button></div></div>`;
      back.querySelector('.ps-x').onclick = close;
      back.querySelectorAll('[data-n]').forEach(b => b.onclick = () => { view = new Date(y, m + (+b.dataset.n), 1); draw(); });
      back.querySelectorAll('.cal-d').forEach(b => b.onclick = () => { close(); o.onPick(b.dataset.k); });
      back.querySelector('[data-act="today"]').onclick = () => { const t = todayIso; if ((min && t < min) || (max && t > max)) return; close(); o.onPick(t); };
      back.querySelector('[data-act="clear"]').onclick = () => { close(); o.onPick(''); };
    };
    document.body.appendChild(back); draw();
    back.onclick = e => { if (e.target === back) close(); };
  }

  // ---------------------------------------------------------------- field enhancers
  const selDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const inpDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const arrow = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';
  const calIc = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';

  function enhanceSelect(s) {
    if (s.dataset.enh || s.dataset.noenh || s.style.display === 'none' || s.multiple) return;
    s.dataset.enh = '1';
    const btn = el(`<button type="button" class="ps-field sel-enh ${s.className.includes('form-input') || s.className.includes('form-select') ? '' : ''}"><span class="sel-txt"></span>${arrow}</button>`);
    if (s.getAttribute('style')) btn.setAttribute('style', s.getAttribute('style'));
    const refresh = () => {
      const o = s.options[s.selectedIndex];
      const t = o ? o.textContent.trim() : '';
      const sp = btn.querySelector('.sel-txt'); sp.textContent = t || s.getAttribute('placeholder') || 'Select'; sp.classList.toggle('ph', !t);
      btn.disabled = s.disabled;
    };
    s.parentNode.insertBefore(btn, s);
    s.style.display = 'none';
    Object.defineProperty(s, 'value', { get() { return selDesc.get.call(this); }, set(v) { selDesc.set.call(this, v); refresh(); }, configurable: true });
    s.addEventListener('change', refresh);
    new MutationObserver(refresh).observe(s, { childList: true, subtree: true, attributes: true, attributeFilter: ['selected', 'disabled'] });
    btn.addEventListener('click', () => {
      const lab = (s.closest('.form-group') && s.closest('.form-group').querySelector('.form-label')) || null;
      pick({ title: (lab && lab.textContent.trim()) || s.getAttribute('aria-label') || 'Select', selected: s.value,
        options: Array.from(s.options).filter(o => !o.disabled).map(o => ({ value: o.value, label: o.textContent.trim() || '—' })),
        onPick: v => { selDesc.set.call(s, v); refresh(); s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); } });
    });
    refresh();
  }

  function enhanceDate(i) {
    if (i.dataset.enh || i.dataset.noenh) return;
    i.dataset.enh = '1';
    const cls = i.className;
    const btn = el(`<button type="button" class="ps-field date-enh ${cls.includes('doc-date-input') ? 'compact' : ''}"><span class="sel-txt"></span>${calIc}</button>`);
    const refresh = () => { const sp = btn.querySelector('.sel-txt'); const v = inpDesc.get.call(i); sp.textContent = v ? fmtDate(v) : (i.getAttribute('placeholder') || 'Select date'); sp.classList.toggle('ph', !v); btn.disabled = i.disabled; };
    if (i.getAttribute('style') && !/display/.test(i.getAttribute('style'))) btn.setAttribute('style', i.getAttribute('style'));
    i.parentNode.insertBefore(btn, i);
    i.style.display = 'none';
    Object.defineProperty(i, 'value', { get() { return inpDesc.get.call(this); }, set(v) { inpDesc.set.call(this, v); refresh(); }, configurable: true });
    btn.addEventListener('click', () => {
      const lab = i.closest('.form-group') && i.closest('.form-group').querySelector('.form-label');
      calendar({ title: (lab && lab.textContent.trim()) || 'Select date', value: i.value, min: i.min, max: i.max,
        onPick: v => { inpDesc.set.call(i, v); refresh(); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); } });
    });
    refresh();
  }

  let suggBox = null;
  function enhanceList(i) {
    if (i.dataset.enh || !i.getAttribute('list')) return;
    const dl = document.getElementById(i.getAttribute('list'));
    if (!dl) return;
    i.dataset.enh = '1';
    i.dataset.listid = i.getAttribute('list');
    i.removeAttribute('list');
    const show = () => {
      const opts = Array.from((document.getElementById(i.dataset.listid) || dl).options).map(o => o.value);
      const q = i.value.trim().toLowerCase();
      const m = opts.filter(v => v && v.toLowerCase().includes(q) && v.toLowerCase() !== q).slice(0, 8);
      hideSugg();
      if (!m.length) return;
      suggBox = el(`<div class="sugg">${m.map(v => `<button type="button">${esc(v)}</button>`).join('')}</div>`);
      const r = i.getBoundingClientRect();
      suggBox.style.cssText = `left:${r.left}px;top:${r.bottom + 4}px;width:${r.width}px`;
      document.body.appendChild(suggBox);
      suggBox.querySelectorAll('button').forEach((b, k) => b.addEventListener('mousedown', e => {
        e.preventDefault(); inpDesc.set.call(i, m[k]); hideSugg();
        i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true }));
      }));
    };
    i.addEventListener('focus', show); i.addEventListener('input', show); i.addEventListener('blur', () => setTimeout(hideSugg, 120));
  }
  function hideSugg() { if (suggBox) { suggBox.remove(); suggBox = null; } }

  function enhance(root) {
    root = root || document;
    root.querySelectorAll('select').forEach(enhanceSelect);
    root.querySelectorAll('input[type="date"]').forEach(enhanceDate);
    root.querySelectorAll('input[list]').forEach(enhanceList);
  }
  let queued = false;
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; try { enhance(document); } catch (e) { console.error('ui enhance', e); } }); }
  function start() {
    enhance(document);
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  window.BillauraUI = { confirm: confirmDlg, prompt: promptDlg, choice: choiceDlg, pick, calendar, enhance, fmtDate };
})();
