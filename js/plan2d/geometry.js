import { r2, clamp } from '../util.js';

// Геометрия плана этажа: стены, общие стены, проёмы, поворот и автораскладка комнат.
// w/l — размеры комнаты в её текущем положении на плане: поворот на 90° меняет их местами
// и переписывает стены и позиции дверей и окон (rot — счётчик поворотов).

const OPP = { 0: 2, 1: 3, 2: 0, 3: 1 };

/** Стена комнаты как отрезок: o — ориентация, c — координата линии, a..b — протяжённость. */
export const wseg = (r, w) => {
  if (w === 0) return { o: 'h', c: r.y, a: r.x, b: r.x + r.w };
  if (w === 1) return { o: 'v', c: r.x + r.w, a: r.y, b: r.y + r.l };
  if (w === 2) return { o: 'h', c: r.y + r.l, a: r.x, b: r.x + r.w };
  return { o: 'v', c: r.x, a: r.y, b: r.y + r.l };
};

/** Проём (дверь или окно) как отрезок на стене. */
export const opSeg = (r, o) => {
  const s = wseg(r, o.wall);
  return { o: s.o, c: s.c, a: s.a + o.pos, b: s.a + o.pos + o.width };
};

/** Расстояние от точки плана до отрезка. */
export const segDist = (s, p) => {
  const u = s.o === 'h' ? p.x : p.y;
  const v = s.o === 'h' ? p.y : p.x;
  return Math.hypot(u < s.a ? s.a - u : u > s.b ? u - s.b : 0, v - s.c);
};

/** Общие стены: участки, где стена одной комнаты совпадает со стеной соседа. */
export function shared(rooms) {
  const out = [];
  for (const r of rooms) {
    for (let wi = 0; wi < 4; wi++) {
      const A = wseg(r, wi);
      for (const o of rooms) {
        if (o === r) continue;
        const B = wseg(o, OPP[wi]);
        if (A.o !== B.o || Math.abs(A.c - B.c) > 0.02) continue;
        const lo = Math.max(A.a, B.a);
        const hi = Math.min(A.b, B.b);
        if (hi - lo > 0.05) out.push({ i: r.id, wi, j: o.id, lo, hi });
      }
    }
  }
  return out;
}

/** Наружные участки стены: отрезок A без общих интервалов ivs. */
export function outer(A, ivs) {
  let segs = [[A.a, A.b]];
  for (const s of ivs) {
    segs = segs.flatMap(([a, b]) => {
      if (s.hi <= a || s.lo >= b) return [[a, b]];
      return [...(s.lo > a ? [[a, s.lo]] : []), ...(s.hi < b ? [[s.hi, b]] : [])];
    });
  }
  return segs;
}

/** id комнат, которые наложились друг на друга. */
export const overlaps = rs => {
  const bad = new Set();
  rs.forEach((a, i) => {
    rs.slice(i + 1).forEach(b => {
      const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const dy = Math.min(a.y + a.l, b.y + b.l) - Math.max(a.y, b.y);
      if (dx > 0.02 && dy > 0.02) bad.add(a.id).add(b.id);
    });
  });
  return bad;
};

/** Все проёмы плана: двери, окна и входная дверь. */
export const opsOf = (rs, ent) => {
  const out = [];
  rs.forEach(r => {
    r.doors.forEach((o, i) => out.push({ sel: { k: 'door', id: r.id, i }, r, o, kind: 'door' }));
    r.windows.forEach((o, i) => out.push({ sel: { k: 'win', id: r.id, i }, r, o, kind: 'win' }));
  });
  const er = ent && rs.find(x => x.id === ent.roomId);
  if (er) out.push({ sel: { k: 'ent' }, r: er, o: ent, kind: 'ent' });
  return out;
};

/** Убрать двери между комнатами, которые больше не стоят вплотную. Возвращает число убранных. */
export function prune(p) {
  const sh = shared(p.rooms);
  let n = 0;
  for (const r of p.rooms) {
    const keep = r.doors.filter(d => {
      const s = wseg(r, d.wall);
      const from = s.a + d.pos;
      const to = from + d.width;
      return sh.some(
        x => x.i === r.id && x.wi === d.wall && x.j === d.toRoom && from >= x.lo - 0.05 && to <= x.hi + 0.05,
      );
    });
    n += r.doors.length - keep.length;
    r.doors = keep;
  }
  return n;
}

/** Повернуть комнату по часовой стрелке вместе с проёмами, электрикой и мойкой/плитой. */
export function rotate(p, r) {
  const L = r.l;
  [r.w, r.l] = [r.l, r.w];
  r.rot = ((r.rot || 0) + 90) % 360;
  const fix = o => {
    if (o.wall === 1 || o.wall === 3) o.pos = r2(L - o.pos - o.width);
    o.wall = (o.wall + 1) % 4;
  };
  r.doors.forEach(fix);
  r.windows.forEach(fix);
  if (p.entrance && p.entrance.roomId === r.id) fix(p.entrance);
  (r.items || []).forEach(i => {
    if (i.wall == null) {
      const x = i.x;
      i.x = r2(L - i.y);
      i.y = x;
    } else {
      if (i.wall === 1 || i.wall === 3) i.x = r2(L - i.x);
      i.wall = (i.wall + 1) % 4;
    }
  });
  (r.fixtures || []).forEach(f => {
    Object.assign(f, { x0: r2(L - f.y1), x1: r2(L - f.y0), y0: f.x0, y1: f.x1 });
  });
}

/** Разложить комнаты рядами. */
export function autoLayout(p) {
  const rs = p.rooms;
  const total = rs.reduce((s, r) => s + r.w * r.l, 0);
  const rowW = Math.max(Math.sqrt(total) * 1.3, ...rs.map(r => r.w));
  let x = 0;
  let y = 0;
  let rh = 0;
  for (const r of rs) {
    if (x > 0 && x + r.w > rowW + 0.01) {
      x = 0;
      y += rh;
      rh = 0;
    }
    r.x = r2(x);
    r.y = r2(y);
    x += r.w;
    rh = Math.max(rh, r.l);
  }
}

// Масштаб и сдвиг так, чтобы все комнаты поместились в холст W×H.
export function fitView(rs, W, H) {
  if (!rs.length) return { s: 60, tx: 20, ty: 20 };
  const x0 = Math.min(...rs.map(r => r.x));
  const y0 = Math.min(...rs.map(r => r.y));
  const bw = Math.max(...rs.map(r => r.x + r.w)) - x0;
  const bl = Math.max(...rs.map(r => r.y + r.l)) - y0;
  const s = clamp(Math.min((W - 40) / bw, (H - 40) / bl), 8, 300);
  return { s, tx: (W - bw * s) / 2 - x0 * s, ty: (H - bl * s) / 2 - y0 * s };
}
