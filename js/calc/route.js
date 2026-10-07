// @ts-check
import { wallPt } from '../util.js';

// Геометрия кабеля: точки на общем плане и маршрут между ними.
// Внутри комнаты кабель идёт напрямик (по Манхэттену), между комнатами через двери.

export const RUN_BELOW = 0.2; // ход кабеля ниже потолка, м

export const gpt = (r, w, u) => {
  const [a, b] = wallPt(r, w, u);
  return [r.x + a, r.y + b];
};

/** Точка на общем плане. */
export const P = (r, x, y, z, wall = null) => ({ rid: r.id, h: r.h, x, y, z, wall });

export const itemPt = (r, i) => {
  if (i.wall == null) return P(r, r.x + i.x, r.y + (i.y || 0), i.z);
  const [x, y] = gpt(r, i.wall, i.x);
  return P(r, x, y, i.z, i.wall);
};

export const man = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Середины всех дверей между существующими комнатами. */
function doorNodes(p) {
  const doors = [];
  p.rooms.forEach(r => {
    (r.doors || []).forEach(d => {
      if (!p.rooms.some(x => x.id === d.toRoom)) return;
      const [x, y] = gpt(r, d.wall, d.pos + d.width / 2);
      doors.push({ x, y, rooms: [r.id, d.toRoom] });
    });
  });
  return doors;
}

/** Дейкстра по узлам: 0 — начало, 1 — конец, остальные — двери. */
function shortest(N) {
  const dist = N.map(() => Infinity);
  const done = N.map(() => false);
  const prev = N.map(() => -1);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    N.forEach((_, i) => {
      if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    });
    if (u < 0 || u === 1) break;
    done[u] = true;
    N.forEach((n, i) => {
      if (done[i] || !n.rooms.some(q => N[u].rooms.includes(q))) return;
      const d = dist[u] + man(N[u], n);
      if (d < dist[i]) {
        dist[i] = d;
        prev[i] = u;
      }
    });
  }
  return { dist, prev };
}

export function makeRouter(p) {
  const doors = doorNodes(p);
  return (a, b) => {
    if (a.rid === b.rid) return { len: man(a, b), ok: true, pts: [a, b] };
    const N = [{ x: a.x, y: a.y, rooms: [a.rid] }, { x: b.x, y: b.y, rooms: [b.rid] }, ...doors];
    const { dist, prev } = shortest(N);
    if (dist[1] === Infinity) return { len: man(a, b), ok: false, pts: [a, b] }; // нет прохода через двери: считаем напрямик
    const chain = [];
    for (let k = 1; k !== -1; k = prev[k]) chain.unshift(N[k]);
    return { len: dist[1], ok: true, pts: chain };
  };
}

/** Ломаная для 3D: строго по вертикали и горизонтали, без повторяющихся точек. */
function polyline(a, b, q, zr) {
  const raw = [
    [a.x, a.y, a.z],
    [a.x, a.y, zr],
  ];
  let cy = a.y;
  q.pts.slice(1).forEach(n => {
    raw.push([n.x, cy, zr], [n.x, n.y, zr]);
    cy = n.y;
  });
  raw.push([b.x, b.y, b.z]);
  return raw.filter((v, i) => !i || v.some((c, k) => Math.abs(c - raw[i - 1][k]) > 1e-6));
}

/**
 * Отрезок кабеля a → b: возвращает длину и (если задан kind) дописывает трассу в routes.
 * kind: trunk | light | sock | power | net
 */
export function makeLeg(route, routes) {
  return (a, b, kind, gid) => {
    const q = route(a, b);
    const zr = Math.min(a.h, b.h) - RUN_BELOW;
    if (kind) {
      const pts = polyline(a, b, q, zr);
      if (pts.length > 1) {
        routes.push({ kind, gid, zr, pts, a: { rid: a.rid, wall: a.wall }, b: { rid: b.rid, wall: b.wall } });
      }
    }
    return Math.abs(zr - a.z) + q.len + Math.abs(zr - b.z);
  };
}

/** Комнаты, до которых можно дойти от комнаты startId через двери. */
export function reachableRooms(rooms, startId) {
  const reach = new Set([startId]);
  for (let again = true; again;) {
    again = false;
    rooms.forEach(r => {
      (r.doors || []).forEach(d => {
        if (rooms.some(x => x.id === d.toRoom) && reach.has(r.id) !== reach.has(d.toRoom)) {
          reach.add(r.id);
          reach.add(d.toRoom);
          again = true;
        }
      });
    });
  }
  return reach;
}
