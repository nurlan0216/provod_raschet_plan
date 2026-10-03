import { fmt } from './model.js';
// Редактор плана этажа (вид сверху). w/l — размеры комнаты в её текущем положении на плане:
// поворот на 90° меняет их местами и переписывает стены/позиции дверей и окон (rot — счётчик поворотов).
const OPP = { 0: 2, 1: 3, 2: 0, 3: 1 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = v => Math.round(v * 100) / 100;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wseg = (r, w) => w === 0 ? { o: 'h', c: r.y, a: r.x, b: r.x + r.w } : w === 1 ? { o: 'v', c: r.x + r.w, a: r.y, b: r.y + r.l }
  : w === 2 ? { o: 'h', c: r.y + r.l, a: r.x, b: r.x + r.w } : { o: 'v', c: r.x, a: r.y, b: r.y + r.l };
const wlen = (r, w) => (w % 2 ? r.l : r.w);
const opSeg = (r, o) => { const s = wseg(r, o.wall); return { o: s.o, c: s.c, a: s.a + o.pos, b: s.a + o.pos + o.width }; };
const segDist = (s, p) => { const u = s.o === 'h' ? p.x : p.y, v = s.o === 'h' ? p.y : p.x;
  return Math.hypot(u < s.a ? s.a - u : u > s.b ? u - s.b : 0, v - s.c); };

// Общие стены: участки, где стена одной комнаты совпадает со стеной соседа.
function shared(rooms) {
  const out = [];
  for (const r of rooms) for (let wi = 0; wi < 4; wi++) { const A = wseg(r, wi);
    for (const o of rooms) { if (o === r) continue; const B = wseg(o, OPP[wi]);
      if (A.o !== B.o || Math.abs(A.c - B.c) > 0.02) continue;
      const lo = Math.max(A.a, B.a), hi = Math.min(A.b, B.b);
      if (hi - lo > 0.05) out.push({ i: r.id, wi, j: o.id, lo, hi }); } }
  return out;
}
function outer(A, ivs) {
  let segs = [[A.a, A.b]];
  for (const s of ivs) segs = segs.flatMap(([a, b]) => s.hi <= a || s.lo >= b ? [[a, b]] : [...(s.lo > a ? [[a, s.lo]] : []), ...(s.hi < b ? [[s.hi, b]] : [])]);
  return segs;
}
const overlaps = rs => new Set(rs.flatMap((a, i) => rs.slice(i + 1).filter(b =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.02 && Math.min(a.y + a.l, b.y + b.l) - Math.max(a.y, b.y) > 0.02).flatMap(b => [a.id, b.id])));
const opsOf = (rs, ent) => {
  const out = [];
  rs.forEach(r => { r.doors.forEach((o, i) => out.push({ sel: { k: 'door', id: r.id, i }, r, o, kind: 'door' }));
    r.windows.forEach((o, i) => out.push({ sel: { k: 'win', id: r.id, i }, r, o, kind: 'win' })); });
  const er = ent && rs.find(x => x.id === ent.roomId); if (er) out.push({ sel: { k: 'ent' }, r: er, o: ent, kind: 'ent' });
  return out;
};
function prune(p) { // убрать двери между комнатами, которые больше не стоят вплотную
  const sh = shared(p.rooms); let n = 0;
  for (const r of p.rooms) { const keep = r.doors.filter(d => { const s = wseg(r, d.wall), f = s.a + d.pos, t = f + d.width;
      return sh.some(x => x.i === r.id && x.wi === d.wall && x.j === d.toRoom && f >= x.lo - 0.05 && t <= x.hi + 0.05); });
    n += r.doors.length - keep.length; r.doors = keep; }
  return n;
}
function rotate(p, r) { // по часовой стрелке
  const L = r.l; [r.w, r.l] = [r.l, r.w]; r.rot = ((r.rot || 0) + 90) % 360;
  const fix = o => { if (o.wall === 1 || o.wall === 3) o.pos = r2(L - o.pos - o.width); o.wall = (o.wall + 1) % 4; };
  r.doors.forEach(fix); r.windows.forEach(fix); if (p.entrance && p.entrance.roomId === r.id) fix(p.entrance);
  (r.items || []).forEach(i => { if (i.wall == null) { const x = i.x; i.x = r2(L - i.y); i.y = x; } else { if (i.wall === 1 || i.wall === 3) i.x = r2(L - i.x); i.wall = (i.wall + 1) % 4; } });   // электрика поворачивается вместе с комнатой
  (r.fixtures || []).forEach(f => { const q = { x0: r2(L - f.y1), x1: r2(L - f.y0), y0: f.x0, y1: f.x1 }; Object.assign(f, q); });
}
function autoLayout(p) {
  const rs = p.rooms, total = rs.reduce((s, r) => s + r.w * r.l, 0), rowW = Math.max(Math.sqrt(total) * 1.3, ...rs.map(r => r.w));
  let x = 0, y = 0, rh = 0;
  for (const r of rs) { if (x > 0 && x + r.w > rowW + 0.01) { x = 0; y += rh; rh = 0; } r.x = r2(x); r.y = r2(y); x += r.w; rh = Math.max(rh, r.l); }
}

let view = null, viewPid = null, mode = 'move', sel = null;
const HELP = { move: 'Нажмите на комнату и перетащите её. Двумя пальцами можно приблизить план.', door: 'Нажмите на общую стену между комнатами — там появится дверь.',
  win: 'Нажмите на наружную стену — там появится окно.', ent: 'Нажмите на наружную стену — там будет входная дверь и щиток.' };

export function mount(el, ctx) {
  const S = ctx.state, C = fn => ctx.commit(fn, true), $ = s => el.querySelector(s);
  el.innerHTML = `<div id="pi"></div><p class="muted small" id="ph"></p>
    <div class="tools" id="tm"><button data-p="mode" data-v="move">Двигать</button><button data-p="mode" data-v="door">+ Дверь</button><button data-p="mode" data-v="win">+ Окно</button><button data-p="mode" data-v="ent">Вход</button></div>
    <div class="canvas"><svg></svg><div class="ruler"></div></div>
    <div class="tools"><button data-p="rot">Повернуть 90°</button><button data-p="auto">Разложить</button><button data-p="fit">Показать всё</button><button data-p="wall"></button></div>
    <div class="card" id="pp"></div>`;
  const svg = $('svg'), cv = $('.canvas'); let ov = {};
  const size = () => { const b = cv.getBoundingClientRect(); return { W: b.width || 340, H: b.height || 400 }; };
  function fit() {
    const rs = S.project.rooms, { W, H } = size(); if (!rs.length) { view = { s: 60, tx: 20, ty: 20 }; return; }
    const x0 = Math.min(...rs.map(r => r.x)), y0 = Math.min(...rs.map(r => r.y)), bw = Math.max(...rs.map(r => r.x + r.w)) - x0, bl = Math.max(...rs.map(r => r.y + r.l)) - y0;
    const s = clamp(Math.min((W - 40) / bw, (H - 40) / bl), 8, 300); view = { s, tx: (W - bw * s) / 2 - x0 * s, ty: (H - bl * s) / 2 - y0 * s };
  }
  if (!view || viewPid !== S.project.id) { fit(); viewPid = S.project.id; }

  function draw() {
    const p = S.project, rs = p.rooms.map(r => ov[r.id] ? { ...r, ...ov[r.id] } : r), { W, H } = size(), s = view.s;
    const X = m => m * s + view.tx, Y = m => m * s + view.ty, sh = shared(rs), bad = overlaps(rs), t = (p.settings.wallThickness || 10) / 100;
    let h = '';
    const step = s >= 60 ? 0.1 : 1, k0 = [Math.ceil(-view.tx / s / step), Math.ceil(-view.ty / s / step)], k1 = [(W - view.tx) / s / step, (H - view.ty) / s / step], per = step === 1 ? 1 : 10;
    for (let k = k0[0]; k <= k1[0]; k++) h += `<line x1="${X(k * step)}" y1="0" x2="${X(k * step)}" y2="${H}" class="${k % per ? 'g' : 'gm'}"/>`;
    for (let k = k0[1]; k <= k1[1]; k++) h += `<line x1="0" y1="${Y(k * step)}" x2="${W}" y2="${Y(k * step)}" class="${k % per ? 'g' : 'gm'}"/>`;
    rs.forEach(r => { h += `<rect x="${X(r.x)}" y="${Y(r.y)}" width="${r.w * s}" height="${r.l * s}" fill="${r.floor}" fill-opacity=".9"${bad.has(r.id) ? ' stroke="var(--red)" stroke-width="3" stroke-dasharray="6 4"' : ''}/>`; });
    const ln = (sg, a, b, w) => sg.o === 'h' ? `<line x1="${X(a)}" y1="${Y(sg.c)}" x2="${X(b)}" y2="${Y(sg.c)}" stroke-width="${w}"/>` : `<line x1="${X(sg.c)}" y1="${Y(a)}" x2="${X(sg.c)}" y2="${Y(b)}" stroke-width="${w}"/>`;
    h += '<g style="stroke:var(--text)" stroke-linecap="square">';
    rs.forEach(r => { for (let wi = 0; wi < 4; wi++) { const A = wseg(r, wi);
        outer(A, sh.filter(x => x.i === r.id && x.wi === wi)).forEach(([a, b]) => { h += ln(A, a, b, Math.max(3, 0.2 * s)); });
        sh.filter(x => x.i === r.id && x.wi === wi && x.i < x.j).forEach(x => { h += ln(A, x.lo, x.hi, Math.max(2, t * s)); }); } });
    h += '</g>';
    if (sel && sel.k === 'room') { const r = rs.find(x => x.id === sel.id); if (r) h += `<rect x="${X(r.x)}" y="${Y(r.y)}" width="${r.w * s}" height="${r.l * s}" fill="none" stroke="var(--accent)" stroke-width="5"/>`; }
    opsOf(rs, p.entrance).forEach(({ sel: sl, r, o, kind }) => {
      const sg = wseg(r, o.wall), f = sg.a + o.pos, to = f + o.width, th = Math.max(5, t * s), pt = u => sg.o === 'h' ? [X(u), Y(sg.c)] : [X(sg.c), Y(u)];
      const on = sel && sel.k === sl.k && sel.id === sl.id && sel.i === sl.i, [x1, y1] = pt(f), [x2, y2] = pt(to), col = kind === 'ent' ? 'var(--red)' : kind === 'win' ? 'var(--blue)' : 'var(--text)';
      if (on) h += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--accent)" stroke-width="${th + 10}" stroke-linecap="round"/>`;
      h += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--card)" stroke-width="${th + 2}"/>`;
      if (kind === 'win') h += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="4"/>`;
      else { const tv = sg.o === 'h' ? [1, 0] : [0, 1], nv = [[0, 1], [-1, 0], [0, -1], [1, 0]][o.wall].map(v => v * (o.swing === 'out' ? -1 : 1)), len = o.width * s,
          ox = x1 + nv[0] * len, oy = y1 + nv[1] * len, sw = tv[0] * nv[1] - tv[1] * nv[0] > 0 ? 1 : 0;
        h += `<path d="M${x1} ${y1} L${ox} ${oy} M${x2} ${y2} A${len} ${len} 0 0 ${sw} ${ox} ${oy}" fill="none" stroke="${col}" stroke-width="2"/>`;
        if (kind === 'ent') h += `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 8}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--red)">Вход</text>`; }
    });
    rs.forEach(r => { const cx = X(r.x + r.w / 2), cy = Y(r.y + r.l / 2);
      h += `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="15" font-weight="700" fill="#1B2530">${esc(r.name)}</text>`;
      if (r.l * s > 60) h += `<text x="${cx}" y="${cy + 17}" text-anchor="middle" font-size="12" fill="#1B2530">${fmt(+(r.w * r.l).toFixed(1))} м²</text>`;
      if (r.w * s > 60) h += `<text x="${cx}" y="${Y(r.y) + 17}" text-anchor="middle" font-size="12" fill="#1B2530" opacity=".85">${fmt(r.w)}</text>`;
      if (r.l * s > 60) h += `<text transform="rotate(-90 ${X(r.x) + 15} ${cy})" x="${X(r.x) + 15}" y="${cy}" text-anchor="middle" font-size="12" fill="#1B2530" opacity=".85">${fmt(r.l)}</text>`; });
    svg.innerHTML = h; $('.ruler').style.width = s + 'px';
    const rr = S.project.rooms;
    if (rr.length) { const bw = Math.max(...rr.map(r => r.x + r.w)) - Math.min(...rr.map(r => r.x)), bl = Math.max(...rr.map(r => r.y + r.l)) - Math.min(...rr.map(r => r.y));
      $('#pi').innerHTML = `<b>Площадь ${fmt(+rr.reduce((a, r) => a + r.w * r.l, 0).toFixed(1))} м², размер ${fmt(+bw.toFixed(1))} × ${fmt(+bl.toFixed(1))} м</b>${bad.size ? ' <span style="color:var(--red)">· комнаты наложились друг на друга</span>' : ''}`; }
  }
  const getOp = () => { const p = S.project; if (!sel || sel.k === 'room') return null;
    if (sel.k === 'ent') { const r = p.entrance && p.rooms.find(x => x.id === p.entrance.roomId); return r ? { r, o: p.entrance } : null; }
    const r = p.rooms.find(x => x.id === sel.id), o = r && (sel.k === 'door' ? r.doors : r.windows)[sel.i]; return o ? { r, o } : null; };
  function ui() {
    const p = S.project; el.querySelectorAll('[data-p=mode]').forEach(b => b.classList.toggle('on', b.dataset.v === mode)); $('#ph').textContent = HELP[mode];
    $('[data-p=wall]').textContent = (p.settings.wallThickness === 20 ? 'Несущие стены 20 см' : 'Перегородки 10 см');
    let h = '<p class="muted small">Нажмите на комнату, дверь или окно, чтобы изменить.</p>';
    if (sel && sel.k === 'room') { const r = p.rooms.find(x => x.id === sel.id); if (r) h = `<b>${esc(r.name)}</b><span class="muted"> · ${fmt(r.l)} × ${fmt(r.w)} м</span><div class="row"><button class="primary" data-p="open">Открыть комнату</button></div>`; else sel = null; }
    else if (sel) { const op = getOp(); if (!op) sel = null; else { const { r, o } = op, win = sel.k === 'win', other = p.rooms.find(x => x.id === o.toRoom);
      const f = (k, lb, v) => `<div><label for="pf-${k}">${lb}</label><input id="pf-${k}" type="number" inputmode="decimal" step="0.05" data-pf="${k}" value="${v}"></div>`;
      h = `<b>${win ? 'Окно' : sel.k === 'ent' ? 'Входная дверь' : 'Дверь'}: ${esc(r.name)}${other ? ' → ' + esc(other.name) : ''}</b><div class="pf">${f('width', 'Ширина, м', o.width)}${f('pos', 'От угла стены, м', o.pos)}
        ${win ? f('sill', 'Высота от пола, м', o.sill) + f('height', 'Высота окна, м', o.height) : ''}</div>
        <div class="row">${win ? '' : `<button data-p="swing">Открывается: ${o.swing === 'out' ? 'наружу' : 'внутрь'}</button>`}<button class="danger" data-p="del">Удалить</button></div>`; } }
    $('#pp').innerHTML = sel ? h : '<p class="muted small">Нажмите на комнату, дверь или окно, чтобы изменить.</p>';
  }

  /* ---- жесты ---- */
  const pts = new Map(); let g = null, pinch = null;
  const rel = e => { const b = svg.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  const toW = q => ({ x: (q.x - view.tx) / view.s, y: (q.y - view.ty) / view.s });
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const roomAt = w => [...S.project.rooms].reverse().find(r => w.x >= r.x && w.x <= r.x + r.w && w.y >= r.y && w.y <= r.y + r.l);
  function snap(r, x, y) {
    const gr = v => Math.round(v * 10) / 10; x = gr(x); y = gr(y); const th = 12 / view.s; let bx = th, by = th, sx = x, sy = y;
    for (const o of S.project.rooms) { if (o.id === r.id) continue;
      for (const [a, b] of [[o.x + o.w, x], [o.x, x + r.w], [o.x, x], [o.x + o.w, x + r.w]]) if (Math.abs(a - b) < bx) { bx = Math.abs(a - b); sx = x + a - b; }
      for (const [a, b] of [[o.y + o.l, y], [o.y, y + r.l], [o.y, y], [o.y + o.l, y + r.l]]) if (Math.abs(a - b) < by) { by = Math.abs(a - b); sy = y + a - b; } }
    return { x: r2(sx), y: r2(sy) };
  }
  svg.addEventListener('pointerdown', e => {
    svg.setPointerCapture(e.pointerId); const q = rel(e); pts.set(e.pointerId, q);
    if (pts.size === 2) { g = null; const [a, b] = [...pts.values()]; pinch = { d: dist(a, b), w: toW(mid(a, b)), s: view.s }; return; }
    const room = mode === 'move' ? roomAt(toW(q)) : null; g = { q0: q, moved: false, room, v0: { ...view }, o: room && { x: room.x, y: room.y } };
  });
  svg.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return; const q = rel(e); pts.set(e.pointerId, q);
    if (pinch && pts.size === 2) { const [a, b] = [...pts.values()], c = mid(a, b); view.s = clamp(pinch.s * dist(a, b) / pinch.d, 8, 300); view.tx = c.x - pinch.w.x * view.s; view.ty = c.y - pinch.w.y * view.s; draw(); return; }
    if (!g) return; const dx = q.x - g.q0.x, dy = q.y - g.q0.y; if (!g.moved && Math.hypot(dx, dy) < 6) return; g.moved = true;
    if (g.room) { ov = { [g.room.id]: snap(g.room, g.o.x + dx / view.s, g.o.y + dy / view.s) }; sel = { k: 'room', id: g.room.id }; } else { view.tx = g.v0.tx + dx; view.ty = g.v0.ty + dy; }
    draw();
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId);
    if (pinch) { if (pts.size < 2) pinch = null; g = null; return; }
    if (!g) return; const gg = g; g = null;
    if (!gg.moved) tap(gg.q0);
    else if (gg.room) { const o = ov[gg.room.id]; ov = {}; if (o && (o.x !== gg.o.x || o.y !== gg.o.y)) { let n = 0; C(p => { Object.assign(p.rooms.find(x => x.id === gg.room.id), o); n = prune(p); }); if (n) ctx.toast('Двери между разъехавшимися комнатами удалены. Можно нажать «Отменить».'); } draw(); ui(); }
  };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  svg.addEventListener('wheel', e => { e.preventDefault(); const q = rel(e), w = toW(q); view.s = clamp(view.s * Math.exp(-e.deltaY * 0.0015), 8, 300); view.tx = q.x - w.x * view.s; view.ty = q.y - w.y * view.s; draw(); }, { passive: false });

  function tap(q) {
    const w = toW(q), tol = 16 / view.s, p = S.project;
    const hit = opsOf(p.rooms, p.entrance).find(x => segDist(opSeg(x.r, x.o), w) < tol);
    if (hit) { sel = hit.sel; draw(); ui(); return; }
    if (mode === 'move') { const r = roomAt(w); sel = r ? { k: 'room', id: r.id } : null; draw(); ui(); return; }
    let best = null, bd = tol;
    for (const r of p.rooms) for (let wi = 0; wi < 4; wi++) { const d = segDist(wseg(r, wi), w); if (d < bd) { bd = d; best = { r, wi }; } }
    if (!best) return ctx.toast('Нажмите точно на стену комнаты.');
    const { r, wi } = best, sg = wseg(r, wi), tt = sg.o === 'h' ? w.x : w.y, ivs = shared(p.rooms).filter(x => x.i === r.id && x.wi === wi), inSh = ivs.find(x => tt >= x.lo && tt <= x.hi);
    const put = (lo, hi, wd) => { wd = Math.min(wd, hi - lo); return { width: r2(wd), pos: r2(clamp(tt - wd / 2, lo, hi - wd) - sg.a) }; };
    if (mode === 'door') {
      if (!inSh) return ctx.toast('Дверь между комнатами ставится на общую стену. Сдвиньте комнаты вплотную друг к другу.');
      const i = r.doors.length; C(() => r.doors.push({ wall: wi, ...put(inSh.lo, inSh.hi, 0.9), swing: 'in', toRoom: inSh.j })); sel = { k: 'door', id: r.id, i };
    } else {
      if (inSh) return ctx.toast(mode === 'win' ? 'Окно ставится на наружную стену.' : 'Входная дверь ставится на наружную стену.');
      const iv = outer(sg, ivs).find(([a, b]) => tt >= a && tt <= b); if (!iv) return;
      if (mode === 'win') { const i = r.windows.length; C(() => r.windows.push({ wall: wi, ...put(iv[0], iv[1], 1.5), sill: 0.9, height: 1.4 })); sel = { k: 'win', id: r.id, i }; }
      else { C(() => { p.entrance = { roomId: r.id, wall: wi, ...put(iv[0], iv[1], 0.9), swing: 'in' }; }); sel = { k: 'ent' }; }
    }
    draw(); ui();
  }

  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-p]'); if (!b) return; const a = b.dataset.p, p = S.project;
    if (a === 'mode') { mode = b.dataset.v; ui(); }
    else if (a === 'fit') { fit(); draw(); }
    else if (a === 'open') { if (sel && sel.k === 'room') ctx.openRoom(sel.id); }
    else if (a === 'wall') { C(() => { p.settings.wallThickness = p.settings.wallThickness === 20 ? 10 : 20; }); draw(); ui(); }
    else if (a === 'rot') {
      if (!sel || sel.k !== 'room') return ctx.toast('Сначала нажмите на комнату, которую нужно повернуть.');
      let n = 0; C(() => { rotate(p, p.rooms.find(x => x.id === sel.id)); n = prune(p); }); if (n) ctx.toast('Двери, которые больше не на общей стене, удалены.'); draw(); ui();
    } else if (a === 'auto') {
      let n = 0; C(() => { autoLayout(p); n = prune(p); }); fit(); draw(); ui(); ctx.toast('Комнаты разложены.' + (n ? ' Двери между разъехавшимися комнатами удалены.' : '') + ' Можно нажать «Отменить».');
    } else if (a === 'swing') { const op = getOp(); if (op) { C(() => { op.o.swing = op.o.swing === 'out' ? 'in' : 'out'; }); draw(); ui(); } }
    else if (a === 'del') {
      const op = getOp(); if (!op || !await ctx.confirmBox(sel.k === 'win' ? 'Удалить это окно?' : 'Удалить эту дверь?')) return;
      C(() => { if (sel.k === 'ent') p.entrance = null; else (sel.k === 'door' ? op.r.doors : op.r.windows).splice(sel.i, 1); }); sel = null; draw(); ui();
    }
  });
  el.addEventListener('change', e => {
    const t = e.target, f = t.dataset.pf, op = f && getOp(); if (!op) return;
    const { r, o } = op, win = sel.k === 'win', v = parseFloat(String(t.value).replace(',', '.'));
    const rng = { width: win ? [0.4, 4, 'Ширина окна'] : [0.6, 1.6, 'Ширина двери'], pos: [0, wlen(r, o.wall) - o.width, 'Расстояние от угла'], sill: [0, 2, 'Высота от пола'], height: [0.3, 2.5, 'Высота окна'] }[f];
    if (!(v >= rng[0] && v <= rng[1])) { ctx.toast(`${rng[2]}: введите число от ${fmt(r2(rng[0]))} до ${fmt(r2(rng[1]))} м.`); t.value = o[f]; return; }
    C(() => { o[f] = r2(v); if (f === 'width') o.pos = r2(Math.min(o.pos, wlen(r, o.wall) - o.width)); }); draw();
  });
  draw(); ui();
  return () => { ov = {}; };
}
export { shared, outer, wseg };
