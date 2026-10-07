import { clamp, r2 } from '../util.js';
import { wseg, opSeg, segDist, shared, outer, opsOf, prune } from './geometry.js';

// Жесты на плане: перетаскивание комнаты и плана, щипок двумя пальцами, колесо, нажатие.
// h — доступ к состоянию редактора: { S, ctx, C, view, mode, sel, ov, redraw, draw, ui }.
// view, mode, sel и ov читаются и пишутся через геттеры/сеттеры, потому что их хозяин — plan2d.js.

const ZOOM = [8, 300]; // пределы масштаба, пикселей на метр

const snapTo = (h, r, x, y) => {
  const gr = v => Math.round(v * 10) / 10;
  x = gr(x);
  y = gr(y);
  const th = 12 / h.view.s;
  let bx = th;
  let by = th;
  let sx = x;
  let sy = y;
  for (const o of h.S.project.rooms) {
    if (o.id === r.id) continue;
    for (const [a, b] of [
      [o.x + o.w, x],
      [o.x, x + r.w],
      [o.x, x],
      [o.x + o.w, x + r.w],
    ]) {
      if (Math.abs(a - b) < bx) {
        bx = Math.abs(a - b);
        sx = x + a - b;
      }
    }
    for (const [a, b] of [
      [o.y + o.l, y],
      [o.y, y + r.l],
      [o.y, y],
      [o.y + o.l, y + r.l],
    ]) {
      if (Math.abs(a - b) < by) {
        by = Math.abs(a - b);
        sy = y + a - b;
      }
    }
  }
  return { x: r2(sx), y: r2(sy) };
};

/** Поставить дверь, окно или вход там, куда нажали. */
function placeOpening(h, hit) {
  const { S, ctx, C, mode } = h;
  const { r, wi, w } = hit;
  const p = S.project;
  const sg = wseg(r, wi);
  const tt = sg.o === 'h' ? w.x : w.y;
  const ivs = shared(p.rooms).filter(x => x.i === r.id && x.wi === wi);
  const inSh = ivs.find(x => tt >= x.lo && tt <= x.hi);
  const put = (lo, hi, wd) => {
    wd = Math.min(wd, hi - lo);
    return { width: r2(wd), pos: r2(clamp(tt - wd / 2, lo, hi - wd) - sg.a) };
  };
  if (mode === 'door') {
    if (!inSh)
      return ctx.toast('Дверь между комнатами ставится на общую стену. Сдвиньте комнаты вплотную друг к другу.');
    const i = r.doors.length;
    C(() => r.doors.push({ wall: wi, ...put(inSh.lo, inSh.hi, 0.9), swing: 'in', toRoom: inSh.j }));
    h.sel = { k: 'door', id: r.id, i };
  } else {
    if (inSh)
      return ctx.toast(
        mode === 'win' ? 'Окно ставится на наружную стену.' : 'Входная дверь ставится на наружную стену.',
      );
    const iv = outer(sg, ivs).find(([a, b]) => tt >= a && tt <= b);
    if (!iv) return;
    if (mode === 'win') {
      const i = r.windows.length;
      C(() => r.windows.push({ wall: wi, ...put(iv[0], iv[1], 1.5), sill: 0.9, height: 1.4 }));
      h.sel = { k: 'win', id: r.id, i };
    } else {
      C(() => {
        p.entrance = { roomId: r.id, wall: wi, ...put(iv[0], iv[1], 0.9), swing: 'in' };
      });
      h.sel = { k: 'ent' };
    }
  }
  h.draw();
  h.ui();
}

/** Ближайшая стена в пределах допуска. */
function nearestWall(rooms, w, tol) {
  let best = null;
  let bd = tol;
  for (const r of rooms) {
    for (let wi = 0; wi < 4; wi++) {
      const d = segDist(wseg(r, wi), w);
      if (d < bd) {
        bd = d;
        best = { r, wi, w };
      }
    }
  }
  return best;
}

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Преобразования координат и завершение жестов. h — общий контекст mount (plan2d.js).
function toolkit(svg, h) {
  const { S, ctx, C } = h;
  const rel = e => {
    const b = svg.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const toW = q => ({ x: (q.x - h.view.tx) / h.view.s, y: (q.y - h.view.ty) / h.view.s });
  const roomAt = w =>
    [...S.project.rooms].reverse().find(r => w.x >= r.x && w.x <= r.x + r.w && w.y >= r.y && w.y <= r.y + r.l);

  function tap(q) {
    const p = S.project;
    const w = toW(q);
    const tol = 22 / h.view.s;
    const hit = opsOf(p.rooms, p.entrance).find(x => segDist(opSeg(x.r, x.o), w) < tol);
    if (hit) {
      h.sel = hit.sel;
      h.draw();
      h.ui();
      return;
    }
    if (h.mode === 'move') {
      const r = roomAt(w);
      h.sel = r ? { k: 'room', id: r.id } : null;
      h.draw();
      h.ui();
      return;
    }
    const best = nearestWall(p.rooms, w, tol);
    if (!best) return ctx.toast('Нажмите точно на стену комнаты.');
    placeOpening(h, best);
  }

  function drop(gg) {
    const o = h.ov[gg.room.id];
    h.ov = {};
    if (o && (o.x !== gg.o.x || o.y !== gg.o.y)) {
      let n = 0;
      C(p => {
        Object.assign(
          p.rooms.find(x => x.id === gg.room.id),
          o,
        );
        n = prune(p);
      });
      if (n) ctx.toast('Двери между разъехавшимися комнатами удалены. Можно нажать «Отменить».');
    }
    h.draw();
    h.ui();
  }

  return { rel, toW, roomAt, tap, drop };
}

// gs — состояние жеста: { pts: Map указателей, g: перетаскивание, pinch: щипок }.
function onDown(h, k, gs, e) {
  const q = k.rel(e);
  gs.pts.set(e.pointerId, q);
  if (gs.pts.size === 2) {
    gs.g = null;
    const [a, b] = [...gs.pts.values()];
    gs.pinch = { d: dist(a, b), w: k.toW(mid(a, b)), s: h.view.s };
    return;
  }
  const room = h.mode === 'move' ? k.roomAt(k.toW(q)) : null;
  gs.g = { q0: q, moved: false, room, v0: { ...h.view }, o: room && { x: room.x, y: room.y } };
}

function onMove(h, k, gs, e) {
  if (!gs.pts.has(e.pointerId)) return;
  const q = k.rel(e);
  gs.pts.set(e.pointerId, q);
  const view = h.view;
  const { pinch, g } = gs;
  if (pinch && gs.pts.size === 2) {
    const [a, b] = [...gs.pts.values()];
    const c = mid(a, b);
    view.s = clamp((pinch.s * dist(a, b)) / pinch.d, ...ZOOM);
    view.tx = c.x - pinch.w.x * view.s;
    view.ty = c.y - pinch.w.y * view.s;
    h.redraw();
    return;
  }
  if (!g) return;
  const dx = q.x - g.q0.x;
  const dy = q.y - g.q0.y;
  if (!g.moved && Math.hypot(dx, dy) < 6) return;
  g.moved = true;
  if (g.room) {
    h.ov = { [g.room.id]: snapTo(h, g.room, g.o.x + dx / view.s, g.o.y + dy / view.s) };
    h.sel = { k: 'room', id: g.room.id };
  } else {
    view.tx = g.v0.tx + dx;
    view.ty = g.v0.ty + dy;
  }
  h.redraw();
}

function onUp(k, gs, e) {
  if (!gs.pts.has(e.pointerId)) return;
  gs.pts.delete(e.pointerId);
  if (gs.pinch) {
    if (gs.pts.size < 2) gs.pinch = null;
    gs.g = null;
    return;
  }
  if (!gs.g) return;
  const gg = gs.g;
  gs.g = null;
  if (!gg.moved) k.tap(gg.q0);
  else if (gg.room) k.drop(gg);
}

function onWheel(h, k, e) {
  e.preventDefault();
  const q = k.rel(e);
  const w = k.toW(q);
  const view = h.view;
  view.s = clamp(view.s * Math.exp(-e.deltaY * 0.0015), ...ZOOM);
  view.tx = q.x - w.x * view.s;
  view.ty = q.y - w.y * view.s;
  h.redraw();
}

export function attachGestures(svg, h) {
  const k = toolkit(svg, h);
  const gs = { pts: new Map(), g: null, pinch: null };
  svg.addEventListener('pointerdown', e => {
    svg.setPointerCapture(e.pointerId);
    onDown(h, k, gs, e);
  });
  svg.addEventListener('pointermove', e => onMove(h, k, gs, e));
  svg.addEventListener('pointerup', e => onUp(k, gs, e));
  svg.addEventListener('pointercancel', e => onUp(k, gs, e));
  svg.addEventListener('wheel', e => onWheel(h, k, e), { passive: false });
}
