// @ts-check
import { controls } from '../rules.js';
import { itemPt } from './route.js';

// Группы линий: точки по видам, упаковка по нагрузке и длина кабеля каждой группы.

export const V = 230;
export const K_LOAD = 0.8; // нагрузка группы ≤ A × 230 В × 0,8
export const limitW = a => a * V * K_LOAD;

export const KIND = {
  // вид группы → сечение, автомат, макс. точек, название
  light: { s: 1.5, a: 10, max: 15, name: 'Свет' },
  socket: { s: 2.5, a: 16, max: 8, name: 'Розетки' },
  kitchen: { s: 2.5, a: 16, max: 4, name: 'Кухня' },
  bath: { s: 2.5, a: 16, max: 2, name: 'Ванная' },
  oven: { s: 4, a: 25, max: 1, name: 'Духовка / плита' },
  ac: { s: 2.5, a: 16, max: 1, name: 'Кондиционер' },
};

// Ориентировочная мощность одной точки, Вт.
export const WATT = {
  lamp: 10,
  socket: 250,
  kitchen: 700,
  bath: 1200,
  oven: 3500,
  ac: 1500,
  dishwasher: 2000,
  fridge: 300,
  hood: 200,
};

/** К какой группе относится розетка. */
function socketKind(r, i) {
  const role = i.role || 'normal';
  if (role === 'oven') return 'oven';
  if (role === 'ac') return 'ac';
  if (role === 'bath' || r.type === 'bath') return 'bath';
  if (role === 'kitchen' || r.type === 'kitchen') return 'kitchen';
  return 'socket';
}

/** Точки света и розеток по видам; внутри вида — от ближних к щитку комнат к дальним. */
export function collectPoints(rooms, rank) {
  const pts = { light: [], socket: [], kitchen: [], bath: [], oven: [], ac: [] };
  rooms.forEach(r => {
    (r.items || []).forEach(i => {
      if (i.type === 'lamp') {
        pts.light.push({ r, i, pt: itemPt(r, i), w: WATT.lamp });
      } else if (i.type === 'socket') {
        const k = socketKind(r, i);
        const w = k === 'kitchen' ? WATT[i.app] || WATT.kitchen : WATT[k];
        pts[k].push({ r, i, pt: itemPt(r, i), w });
      }
    });
  });
  Object.values(pts).forEach(a => a.sort((x, y) => rank[x.r.id] - rank[y.r.id]));
  return pts;
}

/** Плотная упаковка: сначала мощные точки. */
function packDense(list, max, lim) {
  const out = [];
  [...list]
    .sort((x, y) => y.w - x.w)
    .forEach(q => {
      const g = out.find(g => g.pts.length < max && g.power + q.w <= lim);
      if (g) {
        g.pts.push(q);
        g.power += q.w;
      } else {
        out.push({ pts: [q], power: q.w });
      }
    });
  return out;
}

/** По порядку комнат, чтобы группа была компактной. */
function packInOrder(list, max, lim) {
  const out = [];
  let cur = null;
  list.forEach(q => {
    if (!cur || cur.pts.length >= max || (cur.power + q.w > lim && cur.pts.length)) {
      cur = { pts: [], power: 0 };
      out.push(cur);
    }
    cur.pts.push(q);
    cur.power += q.w;
  });
  return out;
}

/** Раскладка точек по группам. */
export function packBundles(pts) {
  const bundles = [];
  for (const k of Object.keys(KIND)) {
    const lim = limitW(KIND[k].a);
    const max = KIND[k].max;
    const dense = k === 'kitchen' || k === 'bath';
    const out = dense ? packDense(pts[k], max, lim) : packInOrder(pts[k], max, lim);
    out.forEach(g => bundles.push({ kind: k, ...g }));
  }
  return bundles;
}

/**
 * Длина кабеля и описание каждой группы.
 * c = { rooms, rank, panel, hubs, leg, warn }. Возвращает световую группу каждой комнаты.
 */
export function describeBundles(bundles, c) {
  const { rooms, rank, panel, hubs, leg, warn } = c;
  const count = {};
  const lightOf = {};
  bundles.forEach(b => {
    const K = KIND[b.kind];
    count[b.kind] = (count[b.kind] || 0) + 1;
    const rIds = [...new Set(b.pts.map(q => q.r.id))].sort((x, y) => rank[x] - rank[y]);
    const named = rIds.map(id => rooms.find(r => r.id === id));
    const gi = bundles.indexOf(b);
    const single = b.kind === 'oven' || b.kind === 'ac';
    const pk = b.kind === 'light' ? 'light' : single ? 'power' : 'sock';
    let len = 0;
    if (single) {
      len = leg(panel, b.pts[0].pt, pk, gi); // отдельная линия прямо к точке
    } else {
      let prev = panel;
      named.forEach(r => {
        len += leg(prev, hubs[r.id], 'trunk', gi); // щиток → коробки по цепочке
        prev = hubs[r.id];
      });
      b.pts.forEach(q => {
        len += leg(hubs[q.r.id], q.pt, pk, gi); // коробка → точка
      });
    }
    const several = bundles.filter(x => x.kind === b.kind).length > 1;
    const name = single ? `${K.name} (${b.pts[0].r.name})` : several ? `${K.name} ${count[b.kind]}` : K.name;
    Object.assign(b, {
      id: b.kind + count[b.kind],
      name,
      section: K.s,
      breaker: K.a,
      modules: b.kind === 'light' ? 1 : 2,
      device: b.kind === 'light' ? 'автомат' : 'дифавтомат 30 мА',
      limitW: limitW(K.a),
      rooms: named.map(r => r.name),
      roomIds: rIds,
      len,
    });
    if (b.kind === 'light') {
      rIds.forEach(id => {
        if (!lightOf[id]) lightOf[id] = b;
      });
    }
    if (b.power > b.limitW) {
      b.overload = true;
      const text = `Группа «${b.name}» перегружена: ${Math.round(b.power)} Вт при допустимых ${Math.round(b.limitW)} Вт.`;
      warn('error', `${text} Разделите нагрузку или уберите мощный прибор.`, b.roomIds[0]);
    }
  });
  return lightOf;
}

/** Выключатели: кабель от коробки до выключателя входит в световую группу комнаты. */
export function addSwitchCable(p, bundles, lightOf, hubs, leg) {
  p.rooms.forEach(r => {
    controls(p, r).forEach(sw => {
      const g = lightOf[r.id];
      const host = p.rooms.find(x => (x.items || []).includes(sw));
      if (!g || !host) return;
      g.len += leg(hubs[r.id], itemPt(host, sw), 'light', bundles.indexOf(g));
    });
  });
}
