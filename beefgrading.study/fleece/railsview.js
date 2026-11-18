// Rails dashboard: save the current rail, organize saved rails, post and use officials online.
// Self-contained view. mountRails(el, host) renders into el and returns { refresh, destroy, useOfficial(o) }.
//   host = {
//     getSession(),                  // the object app.js save() persists: { name, n, key, auto, sheets:[{name, saved:{answers,flags}}] }
//     loadSession(session),          // replace the whole session (session shape as above, from rails.toSession)
//     loadKey(fleeces, n, title),    // key only: fleeces = array of 20 {grade,length,yield,purity,character}
//     toast(msg),
//     escapeHtml(v),                 // optional; falls back to the escaper below
//     rails, online, download,       // optional overrides (tests): createRails() store, online.js module, download(name, text)
//   }
// Pure helpers are exported for tests. No DOM is touched at import time.
import { createRails } from './rails.js';
import * as onlineMod from './online.js';
import { decodeKey } from './keycodec.js';
import { scoreSheet } from './scoring.js';

export const SHARE_PARAM = 'official';

// ---------- pure helpers ----------
const AMP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => AMP[c]); }
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// CSV cell: quote when needed, and neutralize spreadsheet formulas in text (= + - @ tab CR).
export function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// rail: a full rails.js record ({n, key, sheets:[{name, a, flags}]}). Same columns as the Results CSV.
export function railCsv(rail) {
  const n = rail && Number.isInteger(rail.n) ? rail.n : 20;
  const keyRows = (decodeKey(rail && rail.key) || []).slice(0, n);
  const head = ['Name', 'Score', 'Total', 'Points off', 'To confirm', 'Grading checks'];
  for (let i = 1; i <= n; i++) head.push('F' + i + ' off');
  const lines = [head.map(csvCell).join(',')];
  for (const sh of (rail && rail.sheets) || []) {
    const r = scoreSheet(decodeKey(sh.a) || [], keyRows);
    const fl = sh.flags || {};
    const row = [sh.name, r.score, r.total, r.off, fl.need || 0, fl.audit || 0];
    for (let i = 0; i < n; i++) row.push(r.fleeces[i] && r.fleeces[i].graded ? r.fleeces[i].off : '');
    lines.push(row.map(csvCell).join(','));
  }
  return lines.join('\n');
}

export function csvFileName(rail) {
  const slug = String((rail && rail.title) || 'rail').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'rail';
  const date = rail && /^\d{4}-\d{2}-\d{2}$/.test(rail.date || '') ? rail.date : '';
  return `${slug}${date ? '-' + date : ''}.csv`;
}

export function fmtDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return '';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
export const fmtStamp = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

export function todayStr(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Fleece rows (within n) that carry any key value.
export function keyedRows(key, n = 20) {
  if (!Array.isArray(key)) return 0;
  const lim = Number.isInteger(n) ? n : 20;
  return key.slice(0, lim).filter((k) => k && ['grade', 'length', 'yield', 'purity', 'character'].some((f) => Number.isInteger(k[f]))).length;
}
export function sessionInfo(s) {
  const o = s && typeof s === 'object' ? s : {};
  return { sheets: Array.isArray(o.sheets) ? o.sheets.length : 0, keyed: keyedRows(o.key, o.n), name: typeof o.name === 'string' ? o.name : '' };
}
export const sessionHasWork = (s) => { const i = sessionInfo(s); return i.sheets > 0 || i.keyed > 0; };

// Share link for a posted official: same page, query replaced by ?official=<id>.
export function shareUrl(id, base) {
  const u = new URL(base);
  u.search = ''; u.hash = '';
  u.searchParams.set(SHARE_PARAM, id);
  return u.toString();
}
// app.js: read ?official=<id> on load (location.search). Returns an id or ''.
export function officialIdFromSearch(search) {
  const v = new URLSearchParams(String(search || '')).get(SHARE_PARAM) || '';
  return /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : '';
}

// online.js error code -> a short quiet sentence. ctx: 'list' (the officials section) or 'action'.
export function onlineMessage(error, ctx = 'action') {
  if (ctx === 'list') {
    if (error === 'offline') return 'Posted officials need a connection.';
    if (error === 'denied') return 'Posted officials are not available yet.';
    return 'Could not load posted officials.';
  }
  if (error === 'offline') return 'Needs a connection.';
  if (error === 'denied') return 'Not available yet.';
  if (error === 'auth') return 'Sign in did not finish.';
  if (error === 'invalid') return "That key can't be posted.";
  if (error === 'notfound') return 'That official is gone.';
  return 'Try again in a moment.';
}

// ---------- view ----------
const FOCUS_KEYS = ['act', 'id', 'oid', 'tag'];

export function mountRails(el, host) {
  const rails = host.rails || createRails();
  const on = host.online || onlineMod;
  const esc = typeof host.escapeHtml === 'function' ? host.escapeHtml : escapeHtml;
  const toast = (m) => { try { host.toast(m); } catch (e) { /* host toast is best effort */ } };
  const session = () => { try { return host.getSession() || {}; } catch (e) { return {}; } };

  const st = { q: '', tag: '', openId: null };
  let off = { state: 'idle', items: [], uid: '', error: '' };
  let offToken = 0, destroyed = false, locked = false, resolveAsk = null;

  el.innerHTML = `
<section class="rl" aria-labelledby="rl-h">
  <div class="rl-main">
    <header class="rl-head"><h2 class="h2" id="rl-h">Rails</h2><p class="mut">Save a class to keep its official key and scored sheets. Rails stay on this device.</p></header>
    <button type="button" class="cta" data-act="save"><span>Save current rail</span><span class="cta-s" data-rl="save-s"></span></button>
    <div class="rl-tools">
      <label class="fld"><span class="lab sr">Search rails</span><input type="search" data-rl="q" placeholder="Search title, tag, notes, names" autocomplete="off" maxlength="200"></label>
      <div class="rl-tags" role="group" aria-label="Filter by tag" data-rl="tags"></div>
    </div>
    <p class="rl-count mut" data-rl="count" aria-live="polite"></p>
    <ul class="rl-list" data-rl="list"></ul>
  </div>
  <aside class="rl-side" aria-labelledby="rl-oh">
    <header class="rl-head"><h2 class="h2" id="rl-oh">Posted officials</h2><p class="mut">Keys other graders posted. Use one to load its key into your session.</p></header>
    <div class="rl-off" data-rl="off"></div>
  </aside>
  <dialog class="rl-dlg" data-rl="dlg" aria-labelledby="rl-dlg-t" aria-describedby="rl-dlg-d"></dialog>
</section>`;
  const $ = (k) => el.querySelector(`[data-rl="${k}"]`);
  const dlg = $('dlg');

  // ----- dialogs (one <dialog>, used for forms and confirms) -----
  function fieldHtml(f) {
    const id = 'rl-f-' + f.name;
    const common = `id="${id}" name="${esc(f.name)}" maxlength="${f.max || 80}"`;
    let input;
    if (f.type === 'textarea') input = `<textarea ${common} rows="3">${esc(f.value)}</textarea>`;
    else if (f.type === 'date') input = `<input ${common} type="date" value="${esc(f.value)}">`;
    else input = `<input ${common} type="text" value="${esc(f.value)}" autocomplete="off"${f.list ? ' list="rl-tags-dl"' : ''}>`;
    return `<div class="fld"><label class="lab" for="${id}">${esc(f.label)}</label>${input}</div>`;
  }
  function ask({ title, body = '', fields = [], ok = 'OK', danger = false }) {
    if (resolveAsk) resolveAsk(null);
    const tags = fields.some((f) => f.list) ? `<datalist id="rl-tags-dl">${rails.tags().map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist>` : '';
    dlg.setAttribute('role', danger ? 'alertdialog' : 'dialog');
    dlg.innerHTML = `<form class="rl-f" novalidate>
      <h2 class="h2" id="rl-dlg-t">${esc(title)}</h2>
      <p class="mut" id="rl-dlg-d">${esc(body)}</p>
      ${fields.map(fieldHtml).join('')}${tags}
      <div class="rl-dacts"><button type="button" class="tbtn" data-dlg="cancel">Cancel</button><button type="submit" class="ibtn${danger ? ' rl-danger' : ''}" data-dlg="ok">${esc(ok)}</button></div>
    </form>`;
    return new Promise((res) => {
      resolveAsk = res;
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
      const first = danger ? dlg.querySelector('[data-dlg="cancel"]') : dlg.querySelector('input, textarea') || dlg.querySelector('[data-dlg="ok"]');
      if (first) first.focus();
    });
  }
  function closeAsk(v) {
    const r = resolveAsk; resolveAsk = null;
    if (dlg.open) { if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open'); }
    if (r) r(v);
  }
  dlg.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const v = {};
    for (const c of dlg.querySelectorAll('input[name], textarea[name]')) v[c.name] = c.value;
    closeAsk(v);
  });
  dlg.addEventListener('click', (ev) => {
    if (ev.target === dlg || (ev.target.closest && ev.target.closest('[data-dlg="cancel"]'))) closeAsk(null);
  });
  dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); closeAsk(null); });
  dlg.addEventListener('close', () => { if (!dlg.open) closeAsk(null); }); // a stale event while a newer dialog is open is ignored

  // ----- focus helpers (keep the keyboard user's place across a re-render) -----
  function focusKey(node) {
    const d = node && node.dataset; if (!d || !d.act) return '';
    return FOCUS_KEYS.filter((k) => d[k] !== undefined).map((k) => `[data-${k}="${CSS.escape(d[k])}"]`).join('');
  }
  function refocus(sel) {
    if (!sel || destroyed) return;
    const n = el.querySelector(sel);
    if (n && n !== document.activeElement) n.focus({ preventScroll: true });
  }

  // ----- local rails -----
  function renderSave() {
    const info = sessionInfo(session());
    const b = el.querySelector('[data-act="save"]');
    const has = info.sheets > 0 || info.keyed > 0;
    b.disabled = !has;
    $('save-s').textContent = has ? `${plural(info.sheets, 'sheet')}, ${info.keyed} keyed` : 'Nothing to save yet';
  }
  function railRow(r) {
    const open = r.id === st.openId, s = r.summary, id = esc(r.id);
    const meta1 = [esc(fmtDate(r.date)), r.tag ? `<span class="rl-tg">${esc(r.tag)}</span>` : ''].filter(Boolean).join(' &middot; ');
    const meta2 = `${plural(s.sheets, 'sheet')} &middot; ${s.keyed} keyed${r.postedId ? ' &middot; Posted' : ''}`;
    const score = s.avg != null ? `<span class="rl-score"><span class="num">${esc(s.avg)}</span><small>avg</small></span>` : '';
    let detail = '';
    if (open) {
      const stat = s.avg != null ? `Average ${esc(s.avg)}, top ${esc(s.top)}, out of ${esc(s.total)}.` : 'No scores yet. Scores need an official key and at least one sheet.';
      detail = `<div class="rl-dt" id="rl-d-${id}" role="group" aria-label="Actions for ${esc(r.title)}">
        <p class="rl-stat">${stat}</p>
        ${r.notes ? `<p class="rl-notes">${esc(r.notes)}</p>` : ''}
        <div class="rl-acts">
          <button type="button" class="ibtn" data-act="open" data-id="${id}">Open</button>
          <button type="button" class="tbtn" data-act="edit" data-id="${id}">Rename or edit</button>
          <button type="button" class="tbtn" data-act="dup" data-id="${id}">Duplicate</button>
          <button type="button" class="tbtn" data-act="csv" data-id="${id}">Download CSV</button>
          ${r.postedId ? `<button type="button" class="tbtn" data-act="copy" data-id="${id}">Copy share link</button>` : `<button type="button" class="tbtn" data-act="post" data-id="${id}">Post official</button>`}
          <button type="button" class="tbtn rl-del" data-act="del" data-id="${id}">Delete</button>
        </div>
      </div>`;
    }
    return `<li class="rl-row${open ? ' is-open' : ''}">
      <button type="button" class="rl-hd" data-act="toggle" data-id="${id}" aria-expanded="${open}"${open ? ` aria-controls="rl-d-${id}"` : ''}>
        <span class="rl-t"><span class="rl-name">${esc(r.title)}</span><span class="rl-meta">${meta1}</span><span class="rl-meta">${meta2}</span></span>${score}
      </button>${detail}
    </li>`;
  }
  function renderList() {
    const tags = rails.tags();
    if (st.tag && !tags.some((t) => t.toLowerCase() === st.tag.toLowerCase())) st.tag = '';
    const total = rails.list().length;
    const rows = rails.list({ q: st.q, tag: st.tag });
    $('tags').innerHTML = tags.length ? [''].concat(tags).map((t) => {
      const on_ = t.toLowerCase() === st.tag.toLowerCase();
      return `<button type="button" class="rl-chip" data-act="tag" data-tag="${esc(t)}" aria-pressed="${on_}">${t ? esc(t) : 'All'}</button>`;
    }).join('') : '';
    $('tags').hidden = !tags.length;
    if (st.openId && !rows.some((r) => r.id === st.openId)) st.openId = null;
    $('count').textContent = total ? (rows.length === total ? plural(total, 'rail') : `${rows.length} of ${plural(total, 'rail')}`) : '';
    const list = $('list');
    if (!total) {
      list.innerHTML = '<li class="rl-empty"><p class="rl-name">No saved rails yet</p><p class="mut">A rail is one class: its official key and every scored sheet. Save the current session to keep it here.</p></li>';
    } else if (!rows.length) {
      list.innerHTML = '<li class="rl-empty"><p class="rl-name">No rails match</p><p class="mut">Try a different search or tag.</p><button type="button" class="tbtn" data-act="clear">Clear filters</button></li>';
    } else list.innerHTML = rows.map(railRow).join('');
  }
  const fieldsFor = (v) => [
    { name: 'title', label: 'Title', value: v.title, max: 80 },
    { name: 'date', label: 'Class date', value: v.date, type: 'date' },
    { name: 'tag', label: 'Tag (a group, like a contest or year)', value: v.tag, max: 30, list: true },
    { name: 'notes', label: 'Notes', value: v.notes, type: 'textarea', max: 2000 },
  ];
  const storeError = (res) => (res && res.error === 'quota' ? 'Not enough storage on this device to save.' : 'Could not save on this device.');

  // ----- posted officials -----
  function offRow(o) {
    const mine = !!off.uid && o.ownerUid === off.uid, oid = esc(o.id), t = esc(o.title);
    const meta = [plural(o.n, 'fleece'), o.ownerName ? 'by ' + o.ownerName : '', fmtStamp(o.createdAt)].filter(Boolean).join(' · ');
    return `<li class="rl-of"><p class="rl-name">${t}</p><p class="rl-meta">${esc(meta)}</p>
      <div class="rl-acts">
        <button type="button" class="ibtn" data-act="use" data-oid="${oid}" aria-label="Use ${t}">Use</button>
        <button type="button" class="tbtn" data-act="ocopy" data-oid="${oid}" aria-label="Copy share link for ${t}">Copy link</button>
        ${mine ? `<button type="button" class="tbtn rl-del" data-act="odel" data-oid="${oid}" aria-label="Delete ${t}">Delete</button>` : ''}
      </div></li>`;
  }
  function renderOff() {
    const box = $('off');
    if (off.state === 'loading' || off.state === 'idle') {
      box.innerHTML = '<div class="rl-sk" role="status" aria-label="Loading posted officials"><i></i><i></i><i></i></div>';
    } else if (off.state === 'err') {
      box.innerHTML = `<div class="rl-quiet"><p class="mut" role="status">${esc(onlineMessage(off.error, 'list'))}</p>${off.error === 'denied' ? '' : '<button type="button" class="tbtn" data-act="retry">Try again</button>'}</div>`;
    } else if (!off.items.length) {
      box.innerHTML = '<div class="rl-quiet"><p class="mut">No officials posted yet. Post one from a saved rail.</p></div>';
    } else box.innerHTML = `<ul class="rl-oflist">${off.items.map(offRow).join('')}</ul>`;
  }
  async function loadOfficials() {
    const tok = ++offToken;
    off = { state: 'loading', items: [], uid: '', error: '' };
    renderOff();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { off = { ...off, state: 'err', error: 'offline' }; renderOff(); return; }
    const res = await on.listOfficials(30);
    if (destroyed || tok !== offToken) return;
    if (!res.ok) { off = { ...off, state: 'err', error: res.error || 'error' }; renderOff(); return; }
    let uid = '';
    try { const u = await on.currentUser(); if (u && u.ok && u.user && !u.user.anonymous) uid = u.user.uid; } catch (e) { /* not signed in */ }
    if (destroyed || tok !== offToken) return;
    off = { state: 'ok', items: res.items, uid, error: '' };
    renderOff();
  }

  async function copy(text, okMsg) {
    try { await navigator.clipboard.writeText(text); toast(okMsg); } catch (e) { toast('Link: ' + text); }
  }
  const linkFor = (id) => shareUrl(id, location.href);

  // Load an official's key into the session (confirm first when a key is already there).
  async function useOfficial(o) {
    if (keyedRows(session().key, session().n)) {
      const ok = await ask({ title: 'Replace the current key?', body: `The session already has an official key. Using “${o.title}” replaces it. Scanned sheets stay.`, ok: 'Use this key', danger: true });
      if (!ok) return;
    }
    host.loadKey(o.fleeces, o.n, o.title);
    toast(`Loaded ${o.title}.`);
  }

  // ----- actions -----
  const ACTS = {
    toggle(id) { st.openId = st.openId === id ? null : id; renderList(); },
    tag(_, b) { st.tag = b.dataset.tag || ''; renderList(); },
    clear() { st.q = ''; st.tag = ''; $('q').value = ''; renderList(); },
    retry() { return loadOfficials(); },

    async save() {
      const s = session(), info = sessionInfo(s);
      if (!info.sheets && !info.keyed) { toast('Nothing to save yet. Add an official key or scan a sheet.'); return; }
      const v = await ask({ title: 'Save current rail', body: `${plural(info.sheets, 'sheet')} and ${info.keyed} keyed ${info.keyed === 1 ? 'fleece' : 'fleeces'}.`, fields: fieldsFor({ title: info.name, date: todayStr(), tag: '', notes: '' }), ok: 'Save rail' });
      if (!v) return;
      const res = rails.saveFromSession(s, v);
      if (!res.ok) { toast(storeError(res)); return; }
      st.q = ''; st.tag = ''; $('q').value = ''; st.openId = res.id;
      renderList(); toast('Saved to Rails.');
    },
    async open(id) {
      const r = rails.get(id);
      if (!r) { toast('That rail is gone.'); renderList(); return; }
      const info = sessionInfo(session());
      if (info.sheets || info.keyed) {
        const bits = [info.sheets ? plural(info.sheets, 'sheet') : '', info.keyed ? 'an official key' : ''].filter(Boolean).join(' and ');
        const ok = await ask({ title: 'Replace the current session?', body: `The session has ${bits}. Opening “${r.title}” replaces it. Save it as a rail first to keep it.`, ok: 'Open rail', danger: true });
        if (!ok) return;
      }
      const sess = rails.toSession(id);
      if (!sess) { toast('Could not open that rail.'); return; }
      host.loadSession(sess);
      toast(`Opened ${r.title}.`);
    },
    async edit(id) {
      const r = rails.get(id); if (!r) return;
      const v = await ask({ title: 'Rename or edit', fields: fieldsFor(r), ok: 'Save changes' });
      if (!v) return;
      const res = rails.update(id, v);
      if (!res.ok) { toast(storeError(res)); return; }
      renderList(); toast('Rail updated.');
    },
    dup(id) {
      const res = rails.duplicate(id);
      if (!res.ok) { toast(storeError(res)); return; }
      st.openId = res.id; renderList(); toast('Duplicated.');
    },
    async del(id) {
      const r = rails.get(id); if (!r) return;
      const ok = await ask({ title: 'Delete this rail?', body: `“${r.title}” and its ${plural(r.sheets.length, 'sheet')} are removed from this device. This can't be undone.${r.postedId ? ' The posted official stays online.' : ''}`, ok: 'Delete rail', danger: true });
      if (!ok) return;
      rails.remove(id);
      if (st.openId === id) st.openId = null;
      renderList(); toast('Rail deleted.');
    },
    csv(id) {
      const r = rails.get(id); if (!r) return;
      if (!r.sheets.length) { toast('No sheets to export yet.'); return; }
      const text = railCsv(r), name = csvFileName(r);
      if (typeof host.download === 'function') { host.download(name, text); return; }
      const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = name; a.hidden = true;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    },
    async post(id) {
      const r = rails.get(id); if (!r) return;
      if (!r.summary.keyed) { toast('This rail has no official key to post.'); return; }
      const ok = await ask({ title: 'Post as an official?', body: `Anyone can see and use the key for “${r.title}”. Student sheets are not posted. Posting asks you to sign in with Google.`, ok: 'Post official' });
      if (!ok) return;
      toast('Posting...');
      const res = await on.postOfficial({ title: r.title, n: r.n, key: r.key });
      if (destroyed) return;
      if (!res.ok) { toast(`Could not post. ${onlineMessage(res.error)}`); return; }
      rails.update(id, { postedId: res.id });
      renderList();
      await copy(linkFor(res.id), 'Posted. Share link copied.');
      loadOfficials();
    },
    copy(id) {
      const r = rails.get(id);
      if (r && r.postedId) return copy(linkFor(r.postedId), 'Share link copied.');
      return undefined;
    },
    use(_, b) { const o = off.items.find((x) => x.id === b.dataset.oid); return o ? useOfficial(o) : undefined; },
    ocopy(_, b) { return copy(linkFor(b.dataset.oid), 'Share link copied.'); },
    async odel(_, b) {
      const o = off.items.find((x) => x.id === b.dataset.oid); if (!o) return;
      const ok = await ask({ title: 'Delete this posted official?', body: `“${o.title}” is removed for everyone. Share links to it stop working.`, ok: 'Delete official', danger: true });
      if (!ok) return;
      const res = await on.deleteOfficial(o.id);
      if (destroyed) return;
      if (!res.ok) { toast(`Could not delete. ${onlineMessage(res.error)}`); return; }
      for (const r of rails.list()) if (r.postedId === o.id) rails.update(r.id, { postedId: null });
      off = { ...off, items: off.items.filter((x) => x.id !== o.id) };
      renderOff(); renderList(); toast('Posted official deleted.');
    },
  };
  const ONLINE_ACTS = new Set(['post', 'odel']);

  const onClick = async (ev) => {
    const b = ev.target.closest && ev.target.closest('[data-act]');
    if (!b || !el.contains(b) || dlg.contains(b)) return;
    const act = b.dataset.act, fn = ACTS[act];
    if (!fn || b.disabled) return;
    if (ONLINE_ACTS.has(act)) { if (locked) return; locked = true; }
    const fk = focusKey(b);
    try { await fn(b.dataset.id, b); } catch (e) { toast('Something went wrong. Try again.'); } finally {
      if (ONLINE_ACTS.has(act)) locked = false;
      refocus(fk);
    }
  };
  const onSearch = (ev) => { st.q = ev.target.value; renderList(); };
  const onOnline = () => { if (off.state === 'err' && off.error === 'offline') loadOfficials(); };
  el.addEventListener('click', onClick);
  $('q').addEventListener('input', onSearch);
  window.addEventListener('online', onOnline);

  renderSave(); renderList(); loadOfficials();

  return {
    // Call when the Rails tab is shown: re-reads the session and the saved rails.
    // Offer one official (from a share link): same confirm and load as the Use button. The Rails tab must be showing.
    useOfficial,
    refresh() { if (destroyed) return; renderSave(); renderList(); if (off.state === 'err') loadOfficials(); },
    destroy() {
      destroyed = true; closeAsk(null);
      el.removeEventListener('click', onClick); window.removeEventListener('online', onOnline);
      el.innerHTML = '';
    },
  };
}
