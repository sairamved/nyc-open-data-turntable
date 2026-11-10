/* Data Turntable: each dataset is a record.
 * Center = day it went public, radius = years since (same scale for all), angle = day of year (Jan 1 at 12 o'clock).
 * Record: black, white hole per scheduled update up to the last real one.
 * Help desk disc underneath, locked to it: white, black hole per answered ticket. Seen only through update holes. */

const GEO = {
  label:  0.07,   // empty center, fraction of R
  pad:    0.035,  // gap before the rim, fraction of R
};

const HOLES = {
  size: 0.30,   // hole radius, fraction of the ring gap
  min:  0.32,   // px
};

const FILM = { ticketHit: 12 };   // px tap radius around a ticket

const RECORD = {
  scaleFrom: 0.94,
  spring: { stiffness: 220, damping: 26 },
};

const STACK = {
  record: '#000', recordHole: '#fff',
  desk:   '#fff', deskHole:   '#000',
  rim:    '#000',
};

const THUMB = { px: 112 };

const VIEW = { zoomMin: 1, zoomMax: 16 };

/* ---------- data ---------- */
const DATA = await (await fetch('data/turntable.json', { cache: 'no-cache' })).json();
const DAY = 864e5, YEAR = 365.2425;
const START = new Date(DATA.start + 'T00:00:00Z');
const dayOf = iso => iso == null ? null : Math.round((Date.parse(iso + 'T00:00:00Z') - START) / DAY);
const SPAN_DAYS = dayOf(DATA.today), SPAN_YEARS = SPAN_DAYS / YEAR;
const fmt = d => new Date(START.getTime() + d * DAY).toISOString().slice(0, 10);
const num = n => n.toLocaleString('en-US');
const $ = id => document.getElementById(id);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const START_FRAC = (START - Date.UTC(START.getUTCFullYear(), 0, 1)) / DAY / YEAR;
const yearFrac = d => ((START_FRAC + d / YEAR) % 1 + 1) % 1;

// days since DATA.start; the center is the published day, or the last update if earlier
const RECORDS = DATA.datasets.map(d => {
  const publishedDay = dayOf(d.published), lastDay = dayOf(d.lastUpdated);
  return { ...d, publishedDay, lastDay, centerDay: Math.min(publishedDay ?? lastDay, lastDay),
           tickets: d.tickets.map(t => ({ ...t, day: dayOf(t.date) })) };
});

function polar(d, origin, R) {
  const years = (d - origin) / YEAR;
  const r = R * (GEO.label + (1 - GEO.label - GEO.pad) * years / SPAN_YEARS);
  const a = yearFrac(d) * Math.PI * 2 - Math.PI / 2;
  return [r * Math.cos(a), r * Math.sin(a), r];
}
const ringGap = R => R * (1 - GEO.label - GEO.pad) / SPAN_YEARS;

/* ---------- drawing ---------- */
const holeSize = (R, holeScale) => Math.max(HOLES.min, ringGap(R) * HOLES.size * holeScale);

function recordHoles(b, R, holeScale = 1) {
  const path = new Path2D(), h = holeSize(R, holeScale);
  const add = d => { const [x, y] = polar(d, b.centerDay, R); path.moveTo(x + h, y); path.arc(x, y, h, 0, Math.PI * 2); };
  if (b.updateIntervalDays) {   // one hole per scheduled update, up to the last real one
    const end = Math.min(SPAN_DAYS, b.lastDay + b.updateIntervalDays / 2);
    for (let n = 1, d = b.centerDay + b.updateIntervalDays; d <= end; d = b.centerDay + (++n) * b.updateIntervalDays) add(d);
  } else if (b.lastDay > b.centerDay) add(b.lastDay);   // no schedule: last change only
  return path;
}
function drawRecord(ctx, b, R, holeScale = 1, holes, ink = STACK.record, holeInk = STACK.recordHole) {
  ctx.fillStyle = ink;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  if (ink !== STACK.record) drawRim(ctx, R);
  ctx.fillStyle = holeInk; ctx.fill(holes || recordHoles(b, R, holeScale));
}
// 1px outline on screen at any zoom
function drawRim(ctx, R) {
  const m = ctx.getTransform(), k = Math.hypot(m.a, m.b) / Math.min(2, devicePixelRatio || 1);
  ctx.strokeStyle = STACK.rim; ctx.lineWidth = 1 / k;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
}

// answered tickets only
function filmHoles(b, R, holeScale = 1) {
  const path = new Path2D();
  for (const t of b.tickets) {
    if (t.day < b.centerDay || !t.reply) continue;
    const [x, y] = polar(t.day, b.centerDay, R), h = holeSize(R, holeScale);
    path.moveTo(x + h, y); path.arc(x, y, h, 0, Math.PI * 2);
  }
  return path;
}

/* ---------- shelf ---------- */
let rows = [];
const io = new IntersectionObserver(es => {
  for (const e of es) if (e.isIntersecting) { paintThumb(e.target); io.unobserve(e.target); }
}, { rootMargin: '400px' });

// one shared canvas, thumbnails saved as images
const thumbCanvas = document.createElement('canvas');
function paintThumb(img) {
  const b = RECORDS[+img.dataset.i];
  const dpr = Math.min(2, devicePixelRatio || 1), cv = thumbCanvas;
  cv.width = cv.height = THUMB.px * dpr;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, THUMB.px / 2 * dpr, THUMB.px / 2 * dpr);
  const R = THUMB.px / 2 - 2;
  drawRecord(ctx, b, R, 1);
  ctx.save(); ctx.clip(recordHoles(b, R, 1)); ctx.fillStyle = STACK.deskHole; ctx.fill(filmHoles(b, R, 1)); ctx.restore();
  img.src = cv.toDataURL();
}

// cumulative filter steps
const STEPS = [
  { label: 'All datasets',             test: () => true },
  { label: 'Type = dataset',           test: b => b.type === 'dataset' },
  { label: 'Has a published date',     test: b => b.publishedDay != null },
  { label: 'Has update schedule',      test: b => b.updateIntervalDays != null },
  { label: 'Marked as automated',      test: b => b.automated === true },
  { label: 'Maps to Help Desk ticket', test: b => b.tickets.length > 0 },
  { label: 'Reply exists',             test: b => b.tickets.some(t => t.reply) },   // form letters count
];
let stepAt = STEPS.length - 1;
const passed = [];   // passed[i]: indexes through step i
{
  let cur = RECORDS.map((_, i) => i);
  for (const st of STEPS) { cur = cur.filter(i => st.test(RECORDS[i])); passed.push(cur); }
}
function buildSteps() {
  const ol = $('steps'); ol.replaceChildren();
  STEPS.forEach((st, i) => {
    const li = document.createElement('li');
    const bt = document.createElement('button');
    bt.type = 'button'; bt.setAttribute('aria-pressed', String(i === stepAt));
    const n = document.createElement('span'); n.className = 'n'; n.textContent = num(passed[i].length);
    bt.append(st.label + ' ', n);
    bt.addEventListener('click', () => { stepAt = i; buildSteps(); buildShelf(); ol.children[i].firstChild.focus(); });
    li.append(bt); ol.append(li);
  });
}

function buildShelf() {
  rows = passed[stepAt].map(i => [RECORDS[i], i]);
  const ul = $('shelf');
  ul.replaceChildren();
  for (const [b, i] of rows) {
    const li = document.createElement('li');
    const bt = document.createElement('button');
    bt.className = 'rec'; bt.type = 'button'; bt.dataset.i = i;
    bt.setAttribute('aria-label', `${b.name}. ${b.type}, ${b.updateFrequency || 'no update frequency'}, ${b.publishedDay != null ? `public ${fmt(b.publishedDay)}` : 'no public date'}, last update ${fmt(b.lastDay)}${b.tickets.length ? `, ${plural(b.tickets.length, 'help desk ticket')}` : ''}`);
    const cv = document.createElement('img'); cv.dataset.i = i; cv.alt = ''; cv.width = cv.height = THUMB.px;
    bt.append(cv); li.append(bt); ul.append(li);
    io.observe(cv);
  }
  $('sub').textContent = `${num(rows.length)} of ${num(RECORDS.length)} datasets shown`;
  $('status').textContent = `${rows.length} records shown`;
}

const statusOf = b => b.onSchedule === true ? 'On schedule' : b.onSchedule === false ? 'Behind schedule' : 'No schedule';
function infoFor(b) {
  return `${b.name} — ${b.agencyShort ?? 'no agency'} · ${b.type} · ${b.updateFrequency || 'no update frequency'} · ${b.publishedDay != null ? `public ${fmt(b.publishedDay)}` : 'no public date'} · last update ${fmt(b.lastDay)}` +
    (b.tickets.length ? ` · ${plural(b.tickets.length, 'help desk ticket')}` : '') + (b.onSchedule === false ? ' · behind schedule' : '');
}
$('shelf').addEventListener('pointerover', e => { const bt = e.target.closest('.rec'); if (bt) $('info').firstChild.textContent = infoFor(RECORDS[+bt.dataset.i]); });
$('shelf').addEventListener('focusin', e => { const bt = e.target.closest('.rec'); if (bt) $('info').firstChild.textContent = infoFor(RECORDS[+bt.dataset.i]); });
$('shelf').addEventListener('click', e => { const bt = e.target.closest('.rec'); if (bt) openPlayer(+bt.dataset.i, null, bt); });

/* ---------- player ---------- */
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DRIFT = reduced ? 0 : 12;   // °/s
const P = { idx: -1, ticket: null, returnTo: null, rot: 0, drift: DRIFT, hole: 1, view: 'both', zoom: 1, panX: 0, panY: 0,
            recScale: 1, recV: 0, recAlpha: 1, dirty: true };
let stageSketch = null;

function openPlayer(i, ticketId, from) {
  if ($('player').hidden) P.returnTo = from || document.activeElement;
  P.idx = i; P.ticket = ticketId;
  $('player').hidden = false;
  document.body.style.overflow = 'hidden';
  for (const el of [document.querySelector('header'), document.querySelector('main')]) el.inert = true;
  const b = RECORDS[i];
  $('stage-title').textContent = b.name;
  buildPanel(b, ticketId);
  P.zoom = 1; P.panX = 0; P.panY = 0;
  if (reduced) { P.recScale = 1; P.recAlpha = 1; }
  else { P.recScale = RECORD.scaleFrom; P.recAlpha = 0; P.recV = 0; }   // scale and fade in
  if (!stageSketch) stageSketch = new p5(stage, 'stage'); else stageSketch.loop();
  $('close').focus({ preventScroll: true });
}

function closePlayer() {
  $('player').hidden = true;
  document.body.style.overflow = '';
  for (const el of [document.querySelector('header'), document.querySelector('main')]) el.inert = false;
  if (stageSketch) stageSketch.noLoop();
  const back = P.returnTo && document.contains(P.returnTo) ? P.returnTo : null;
  if (back) back.focus({ preventScroll: true });
  P.idx = -1;
}

function step(dir) {
  if (P.idx < 0) return;
  const pos = rows.findIndex(([, i]) => i === P.idx);
  const nx = rows[(pos + dir + rows.length) % rows.length];
  if (nx) openPlayer(nx[1], null);
}

function selectTicket(id, scroll = true) {
  P.ticket = id;
  document.querySelectorAll('#p-body article').forEach(a => {
    const cur = a.id === `t-${id}`;
    a.classList.toggle('current', cur);
    if (cur) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
  });
  if (scroll && id) { const a = $(`t-${id}`); if (a) a.scrollIntoView({ block: 'start' }); }
  kick();
}

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const k in attrs || {}) { if (attrs[k] == null) continue; if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
  for (const k of kids) if (k != null) e.append(k);   // text nodes, no HTML
  return e;
}
function buildPanel(b, ticketId) {
  const body = $('p-body');
  body.replaceChildren();
  const facts = [['Agency', b.agency ?? 'Not given'], ['Type', b.type], ['Updates', b.updateFrequency || 'Not given'], ['Automated', b.automated === true ? 'Yes' : b.automated === false ? 'No' : 'Not given'], ['Public since', b.publishedDay != null ? fmt(b.publishedDay) : 'Not given'],
    ['Last update', fmt(b.lastDay)], ['Status', statusOf(b)], ['Visits', num(b.visits)], ['Downloads', num(b.downloads)]];
  const notes = [];
  if (b.publishedDay == null) notes.push('No public date, so the record starts at its last data change.');
  else if (b.lastDay < b.publishedDay) notes.push('Its data last changed before it went public, so the record starts at that earlier date.');
  if (!b.updateIntervalDays) notes.push('No update schedule, so the record has one hole, at its last data change.');
  body.append(
    el('p', { class: 'kicker' }, b.type),
    el('h2', { id: 'p-title' }, b.name),
    el('dl', { class: 'facts' }, ...facts.flatMap(([k, v]) => [el('dt', null, k), el('dd', null, String(v))])),
    ...notes.map(t => el('p', { class: 'summary' }, t)),
    el('a', { href: `https://data.cityofnewyork.us/d/${b.uid}`, target: '_blank', rel: 'noopener' }, 'Open on NYC Open Data ↗'),
    el('h3', null, 'Help desk'));
  if (!b.tickets.length) { body.append(el('p', { class: 'none' }, 'No help desk tickets name this dataset, so the help desk disc underneath has no holes.')); return; }
  const ne = b.tickets.filter(t => t.kind === 'error').length, nr = b.tickets.filter(t => t.reply).length;
  body.append(el('p', { class: 'summary' }, `${plural(b.tickets.length, 'ticket')} · ${plural(ne, 'error report')} · ${plural(b.tickets.length - ne, 'question')} · ${nr} replied · newest first`));
  for (const t of [...b.tickets].reverse()) {
    const show = el('button', { type: 'button', 'aria-label': `Show ticket ${t.id} on the disc` }, `#${t.id}`);
    show.addEventListener('click', () => selectTicket(t.id, false));
    body.append(el('article', { id: `t-${t.id}`, class: t.id === ticketId ? 'current' : null },
      el('div', { class: 'thead' }, el('span', { class: 'kind' }, t.kind === 'error' ? 'Error report' : 'Question'),
        show, el('time', { datetime: t.date }, t.date), el('span', null, t.status)),
      el('p', { class: 'from' }, 'From a member of the public'), el('p', { class: 'msg' }, t.question),
      t.reply ? el('div', { class: 'reply' }, el('p', { class: 'from' }, `Reply · ${t.agency}`), el('p', { class: 'msg' }, t.reply))
          : el('p', { class: 'none' }, 'No reply recorded, so no hole on the disc.')));
  }
  $('panel').scrollTop = 0;
  if (ticketId) selectTicket(ticketId);
}

// player canvas; screen = (cx + panX, cy + panY) + world * zoom
function stage(s) {
  let R = 100, cx = 0, cy = 0, drag = null, last = 0, paths = null, pathKey = '';
  const fit = () => {
    const box = $('stage').getBoundingClientRect();
    s.resizeCanvas(box.width, box.height);
    const wide = box.width > 560;
    R = Math.max(60, Math.min(box.width - 32, box.height - (wide ? 250 : 70)) / 2);
    cx = box.width / 2; cy = wide ? 48 + R + 8 : box.height / 2 + 14;
    kick();
  };
  const ensurePaths = () => {
    const key = `${P.idx}|${R}|${P.hole}`;
    if (key === pathKey) return;
    pathKey = key;
    const b = RECORDS[P.idx];
    const film = filmHoles(b, R, P.hole);
    const holes = recordHoles(b, R, P.hole);
    paths = { holes, film };
    s.canvas.setAttribute('aria-label', `Record for ${b.name}. ${plural(b.tickets.length, 'help desk ticket')} cut into the help desk disc underneath.`);
  };
  const toWorld = (px, py) => [(px - cx - P.panX) / P.zoom, (py - cy - P.panY) / P.zoom];
  const centerScreen = () => [cx + P.panX, cy + P.panY];
  function hitTicket(px, py) {
    if (P.idx < 0 || P.view === 'record') return null;
    const b = RECORDS[P.idx], a = P.rot * Math.PI / 180;
    const [dx, dy] = toWorld(px, py);
    const x = dx * Math.cos(-a) - dy * Math.sin(-a), y = dx * Math.sin(-a) + dy * Math.cos(-a);
    const r0 = FILM.ticketHit / P.zoom;
    let best = null, bd = r0 * r0;
    for (const t of b.tickets) { if (t.day < b.centerDay || !t.reply) continue; const [tx, ty] = polar(t.day, b.centerDay, R); const d = (tx - x) ** 2 + (ty - y) ** 2; if (d < bd) { bd = d; best = t; } }
    return best;
  }
  s.zoomAt = (px, py, k) => {
    const z = Math.max(VIEW.zoomMin, Math.min(VIEW.zoomMax, P.zoom * k));
    if (z === P.zoom) return;
    P.panX = (px - cx) - (px - cx - P.panX) * z / P.zoom;
    P.panY = (py - cy) - (py - cy - P.panY) * z / P.zoom;
    P.zoom = z;
    if (z === 1) { P.panX = 0; P.panY = 0; }
    kick();
  };
  s.setup = () => {
    s.createCanvas(10, 10);
    s.pixelDensity(Math.min(2, devicePixelRatio || 1));
    fit();
    const c = s.canvas;
    c.setAttribute('role', 'img');
    new ResizeObserver(fit).observe($('stage'));
    // one pointer turns; two pinch-zoom and pan
    const pts = new Map();
    const at = e => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    let pinch = null;
    const pinchState = () => {
      const [a, b] = [...pts.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };
    c.addEventListener('pointerdown', e => {
      pts.set(e.pointerId, at(e));
      try { c.setPointerCapture(e.pointerId); } catch {}
      if (pts.size === 2) { drag = null; pinch = pinchState(); return; }
      if (pts.size > 2) return;
      const q = at(e), hit = hitTicket(q.x, q.y);
      if (hit) { selectTicket(hit.id); return; }
      const [fx, fy] = centerScreen();
      drag = { a0: Math.atan2(q.y - fy, q.x - fx), rot0: P.rot, fx, fy };
    });
    const lift = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) drag = null; };
    c.addEventListener('pointerup', lift);
    c.addEventListener('pointercancel', lift);
    c.addEventListener('pointermove', e => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, at(e));
      if (pinch && pts.size >= 2) {
        const now = pinchState();
        if (pinch.d > 0) s.zoomAt(now.mx, now.my, now.d / pinch.d);
        if (P.zoom > 1) { P.panX += now.mx - pinch.mx; P.panY += now.my - pinch.my; kick(); }
        pinch = now;
        return;
      }
      const q = at(e);
      if (drag) setRot(drag.rot0 + (Math.atan2(q.y - drag.fy, q.x - drag.fx) - drag.a0) * 180 / Math.PI);
      else c.style.cursor = hitTicket(q.x, q.y) ? 'pointer' : 'grab';
    });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      if (e.ctrlKey) s.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.01));   // trackpad pinch
      else if (P.zoom > 1) { P.panX -= e.deltaX; P.panY -= e.deltaY; kick(); }
    }, { passive: false });
    let g = 1;   // Safari pinch
    c.addEventListener('gesturestart', e => { e.preventDefault(); g = 1; });
    c.addEventListener('gesturechange', e => { e.preventDefault(); if (pinch) return; s.zoomAt(e.clientX - c.getBoundingClientRect().left, e.clientY - c.getBoundingClientRect().top, e.scale / g); g = e.scale; });
    last = performance.now();
  };
  s.draw = () => {
    if (P.idx < 0) return;
    const now = performance.now(), elapsed = Math.min(0.25, (now - last) / 1000); last = now;
    const dt = 1 / 120;   // fixed spring substeps
    const spr = (x, v, target, k, c) => { const a = -k * (x - target) - c * v; v += a * dt; x += v * dt; return [x, v]; };
    if (!reduced) for (let t = 0; t < elapsed; t += dt) {
      [P.recScale, P.recV] = spr(P.recScale, P.recV, 1, RECORD.spring.stiffness, RECORD.spring.damping);
      P.recAlpha = Math.min(1, P.recAlpha + dt * 6);
    }
    if (P.drift) setRot(P.rot + P.drift * elapsed, true);
    ensurePaths();
    const b = RECORDS[P.idx], ctx = s.drawingContext, dpr = s.pixelDensity();
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const view = () => { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.translate(cx + P.panX, cy + P.panY); ctx.scale(P.zoom, P.zoom); };
    const record = () => { view(); ctx.scale(P.recScale, P.recScale); ctx.rotate(P.rot * Math.PI / 180); };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, s.canvas.width, s.canvas.height);
    record(); ctx.globalAlpha = P.recAlpha;
    if (P.view === 'film') drawRecord(ctx, b, R, P.hole, paths.film, STACK.desk, STACK.deskHole);
    else {
      drawRecord(ctx, b, R, P.hole, paths.holes);
      if (P.view === 'both') {   // tickets seen through update holes
        ctx.save(); ctx.clip(paths.holes); ctx.fillStyle = STACK.deskHole; ctx.fill(paths.film); ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    const t = P.view !== 'record' && P.ticket && b.tickets.find(t => t.id === P.ticket && t.day >= b.centerDay);
    if (t) {   // ring the selected ticket
      record();
      const [x, y] = polar(t.day, b.centerDay, R), r = 9 / P.zoom, w = 1 / P.zoom;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r + 2.5 * w, 0, Math.PI * 2); ctx.arc(x, y, r - 2.5 * w, 0, Math.PI * 2, true); ctx.fill('evenodd');
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(x, y, r + w, 0, Math.PI * 2); ctx.arc(x, y, r - w, 0, Math.PI * 2, true); ctx.fill('evenodd');
    }
    ctx.restore();
    const moving = P.drift || (!reduced && (Math.abs(P.recScale - 1) > 1e-4 || P.recAlpha < 1));
    if (!moving && !P.dirty) s.noLoop();
    P.dirty = false;
  };
}
const kick = () => { if (stageSketch) { P.dirty = true; stageSketch.loop(); } };

/* ---------- dials ---------- */
function setRot(v, fromDrift) {
  v = ((v + 180) % 360 + 360) % 360 - 180;
  P.rot = v; $('d-rot').value = v.toFixed(1); $('o-rot').textContent = `${v.toFixed(1)}°`;
  if (!fromDrift) kick();
}
$('d-rot').addEventListener('input', e => setRot(+e.target.value));
$('d-drift').addEventListener('input', e => { P.drift = +e.target.value; $('o-drift').textContent = `${P.drift}°/s`; kick(); });
$('d-hole').addEventListener('input', e => { P.hole = +e.target.value; $('o-hole').textContent = P.hole.toFixed(2); kick(); });
for (const bt of document.querySelectorAll('[data-view]')) bt.addEventListener('click', () => {
  P.view = bt.dataset.view;
  document.querySelectorAll('[data-view]').forEach(x => x.setAttribute('aria-pressed', String(x === bt)));
  kick();
});
$('d-reset').addEventListener('click', () => {
  setRot(0);
  P.drift = DRIFT; $('d-drift').value = DRIFT; $('o-drift').textContent = `${DRIFT}°/s`;
  P.hole = 1; $('d-hole').value = 1; $('o-hole').textContent = '1.00';
  P.zoom = 1; P.panX = 0; P.panY = 0; kick();
});
$('d-drift').value = DRIFT; $('o-drift').textContent = `${DRIFT}°/s`;
$('close').addEventListener('click', closePlayer);
$('prev').addEventListener('click', () => step(-1));
$('next').addEventListener('click', () => step(1));

window.addEventListener('keydown', e => {
  if ($('player').hidden || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape') { e.preventDefault(); closePlayer(); return; }
  const tag = e.target.tagName;
  if (tag === 'INPUT' || e.target.closest?.('#panel')) return;
  switch (e.key) {
    case 'ArrowLeft': e.preventDefault(); step(-1); break;
    case 'ArrowRight': e.preventDefault(); step(1); break;
    case '+': case '=': stageSketch.zoomAt(stageSketch.canvas.clientWidth / 2, stageSketch.canvas.clientHeight / 2, 1.5); break;
    case '-': case '_': stageSketch.zoomAt(stageSketch.canvas.clientWidth / 2, stageSketch.canvas.clientHeight / 2, 1 / 1.5); break;
  }
});

buildSteps();
buildShelf();
