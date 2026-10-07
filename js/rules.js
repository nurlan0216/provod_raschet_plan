// @ts-check
import { uid } from './model.js';
import { clamp, r2, wallLen as wl, wallPt as wp, DOOR_H } from './util.js';
// Нормы и автоматическая расстановка (раздел 9). Нормы ориентировочные (ПУЭ, СП).
// Стены: 0 верх, 1 право, 2 низ, 3 лево. Настенный элемент: wall, x (от угла стены), z (высота).
// Потолочный (лампа): wall=null, x/y от левого верхнего угла, z=высота потолка.
// Доп. поля элементов: app (dishwasher|fridge|hood|oven), ip, ctl (id комнаты, чей свет включает выключатель/коробка,
// если они стоят в соседней комнате, например снаружи ванной). Room.fixtures: мойка, плита, душ (для проверки расстояний).
export const NORMS_NOTE =
  'Нормы ориентировочные (ПУЭ, СП). Проверьте действующие нормы вашей страны и покажите проект электрику.';
// Высоты и расстояния норм (м): одно место правки для расстановки, проверки и редактора комнаты.
export const NORM = {
  socketZ: 0.3,
  switchZ: 0.9,
  kitchenZ: 1.1,
  hoodZ: 2.0,
  dishwasherZ: 0.12,
  bathSocketZ: 1.3,
  bathMinZ: 0.6,
  panelZ: 1.5,
  boxBelowCeil: 0.25,
  ceilGap: 0.15,
  jambGap: 0.1,
  sinkGap: 0.6,
  stoveGap: 0.5,
  camMin: 2.5,
  camMax: 3.0,
};
const OPP = { 0: 2, 1: 3, 2: 0, 3: 1 };
const LUX = { kitchen: 200, bath: 200, office: 300, living: 150, bedroom: 150, hall: 100 };
const ceil = v => Math.ceil(v - 1e-9);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const rectD = (p, f) => Math.hypot(Math.max(f.x0 - p[0], 0, p[0] - f.x1), Math.max(f.y0 - p[1], 0, p[1] - f.y1));
const rectRect = (a, b) => Math.hypot(Math.max(a.x0 - b.x1, b.x0 - a.x1, 0), Math.max(a.y0 - b.y1, b.y0 - a.y1, 0));
const ptOf = (r, i) => (i.wall == null ? [i.x, i.y] : wp(r, i.wall, i.x));
const cm = v => Math.round(v * 100);

// Все проёмы комнаты: свои двери и окна, входная дверь, двери соседей в эту комнату.
export function openingsOf(p, r) {
  const out = [
    ...r.doors.map(d => ({ wall: d.wall, pos: d.pos, width: d.width, k: 'door', to: d.toRoom, z0: 0, z1: DOOR_H })),
    ...r.windows.map(w => ({
      wall: w.wall,
      pos: w.pos,
      width: w.width,
      k: 'win',
      sill: w.sill,
      height: w.height,
      z0: w.sill,
      z1: w.sill + w.height,
    })),
  ];
  if (p.entrance && p.entrance.roomId === r.id)
    out.push({
      wall: p.entrance.wall,
      pos: p.entrance.pos,
      width: p.entrance.width,
      k: 'door',
      ent: true,
      to: null,
      z0: 0,
      z1: DOOR_H,
    });
  p.rooms.forEach(o => {
    if (o === r) return;
    o.doors.forEach(d => {
      if (d.toRoom !== r.id) return;
      const w = OPP[d.wall];
      out.push({
        wall: w,
        pos: r2((d.wall % 2 ? o.y : o.x) + d.pos - (w % 2 ? r.y : r.x)),
        width: d.width,
        k: 'door',
        to: o.id,
        z0: 0,
        z1: DOOR_H,
      });
    });
  });
  return out;
}
// Выключатели, которые включают свет в комнате r (в том числе стоящие снаружи).
export const controls = (p, r) =>
  p.rooms.flatMap(x => (x.items || []).filter(i => i.type === 'switch' && (i.ctl || x.id) === r.id));

// Сколько чего нужно комнате (ориентиры раздела 9).
export function targets(r) {
  const P = 2 * (r.w + r.l),
    A = r.w * r.l,
    lux = LUX[r.type] || 100;
  const minSockets =
    {
      bedroom: Math.max(3, ceil(P / 4)),
      living: Math.max(3, ceil(P / 4)),
      kitchen: 6,
      hall: 1,
      office: Math.max(1, ceil(P / 3)),
      bath: 1,
    }[r.type] || 1;
  const want =
    r.type === 'hall' ? (A >= 5 ? 2 : 1) : r.type === 'bath' ? (A > 4 ? 2 : 1) : r.type === 'kitchen' ? 8 : minSockets;
  return { minSockets, want, lux, lamps: Math.max(1, ceil((A * lux) / 250)) }; // лампа 500 лм, коэффициент 0,5 → ÷250
}

/* ---------- геометрия: свободные участки стен ---------- */
// Участки стен, где на высоте z можно поставить элемент: o.m отступ от проёма, o.c от угла, o.hw полуширина, o.sep зазор до соседних элементов.
function spans(r, ops, occ, z, o) {
  const out = [];
  for (let w = 0; w < 4; w++) {
    let segs = [[o.c, wl(r, w) - o.c]];
    const cut = (a, b) => {
      segs = segs.flatMap(([s, e]) =>
        b <= s || a >= e ? [[s, e]] : [...(a > s ? [[s, a]] : []), ...(b < e ? [[b, e]] : [])],
      );
    };
    ops.forEach(q => {
      if (q.wall === w && z > q.z0 - 0.12 && z < q.z1 + 0.12) cut(q.pos - o.m - o.hw, q.pos + q.width + o.m + o.hw);
    });
    occ.forEach(q => {
      if (q.wall === w && Math.abs(q.z - z) < 0.5) cut(q.x - q.hw - o.sep - o.hw, q.x + q.hw + o.sep + o.hw);
    });
    segs.forEach(([s, e]) => {
      if (e - s >= 0.02) out.push({ wall: w, a: s, b: e });
    });
  }
  return out;
}
const cands = sp =>
  sp.flatMap(s => {
    const out = [];
    for (let x = s.a; x <= s.b + 1e-9; x += 0.05) out.push({ wall: s.wall, x: Math.min(r2(x), s.b) });
    return out;
  });
const okAt = (sp, wall, x) => sp.some(s => s.wall === wall && x >= s.a - 1e-6 && x <= s.b + 1e-6);
function pickEven(sp, n) {
  // n точек равномерно по свободной длине периметра
  const tot = sp.reduce((s, q) => s + q.b - q.a, 0);
  if (!tot || !n) return [];
  return Array.from({ length: n }, (_, k) => {
    let t = (tot * (k + 0.5)) / n;
    for (const q of sp) {
      const L = q.b - q.a;
      if (t <= L + 1e-9) return { wall: q.wall, x: Math.min(r2(q.a + t), q.b) };
      t -= L;
    }
  });
}
const wallRect = (r, w, c, ww, d, type, label) => {
  const a = c - ww / 2,
    b = c + ww / 2;
  const q = w === 0 ? [a, 0, b, d] : w === 1 ? [r.w - d, a, r.w, b] : w === 2 ? [a, r.l - d, b, r.l] : [0, a, d, b];
  return { type, label, x0: r2(q[0]), y0: r2(q[1]), x1: r2(q[2]), y1: r2(q[3]) };
};
const mk = (type, wall, x, z, extra = {}) => ({ id: uid(), type, wall, x: r2(x), y: 0, z: r2(z), ...extra });
const occOf = room =>
  (room.items || [])
    .filter(i => i.wall != null)
    .map(i => ({ wall: i.wall, x: i.x, z: i.z, hw: i.type === 'panel' ? 0.15 : 0.04 }));
function lampGrid(r, n) {
  // равномерная сетка с отступом от стен
  let best = null;
  for (let c = 1; c <= n; c++) {
    const rw = ceil(n / c),
      cost = Math.abs(r.w / c / (r.l / rw) - 1) + 0.35 * (c * rw - n);
    if (!best || cost < best.cost) best = { c, rw, cost };
  }
  const out = [];
  for (let j = 0; j < best.rw; j++)
    for (let i = 0; i < best.c; i++)
      out.push({ x: r2((r.w * (i + 0.5)) / best.c), y: r2((r.l * (j + 0.5)) / best.rw) });
  return out;
}

/* ---------- кухня и ванная: где стоят мойка, плита, душ ---------- */
function slots(r, ops, ww, avoidWin) {
  const out = [];
  for (let w = 0; w < 4; w++)
    for (let x = ww / 2 + 0.1; x <= wl(r, w) - ww / 2 - 0.1 + 1e-9; x += 0.05) {
      const a = x - ww / 2,
        b = x + ww / 2;
      if (ops.some(q => q.wall === w && (q.k === 'door' || avoidWin) && b > q.pos - 0.1 && a < q.pos + q.width + 0.1))
        continue;
      out.push({ wall: w, x: r2(x) });
    }
  return out;
}
function planKitchen(r, ops) {
  const ss = slots(r, ops, 0.6, false);
  if (!ss.length) return null;
  const cost = c => {
    const ws = ops.filter(q => q.k === 'win' && q.wall === c.wall),
      L = wl(r, c.wall);
    return ws.length
      ? Math.min(...ws.map(q => Math.abs(c.x - (q.pos + q.width / 2))))
      : 3 + Math.abs(c.x - L / 2) - 0.1 * L;
  }; // мойка под окном, иначе по центру длинной стены
  const s = ss.map(c => ({ ...c, k: cost(c) })).sort((a, b) => a.k - b.k)[0],
    sc = wp(r, s.wall, s.x),
    sink = { wall: s.wall, x: s.x, c: sc, rect: wallRect(r, s.wall, s.x, 0.6, 0.6, 'sink', 'Мойка') };
  const pts = c => wp(r, c.wall, c.x);
  let st = null;
  for (const thr of [1.5, 1.2, 0.9]) {
    const sc2 = c => Math.abs(dist(pts(c), sc) - 1.8) + (c.wall === s.wall ? 0 : 0.2);
    const cs = slots(r, ops, 0.6, true)
      .filter(c => dist(pts(c), sc) >= thr)
      .sort((a, b) => sc2(a) - sc2(b));
    if (cs.length) {
      st = cs[0];
      break;
    }
  }
  if (!st) st = slots(r, ops, 0.6, false).sort((a, b) => dist(pts(b), sc) - dist(pts(a), sc))[0];
  const stove = { wall: st.wall, x: st.x, c: pts(st), rect: wallRect(r, st.wall, st.x, 0.6, 0.6, 'stove', 'Плита') };
  return { sink, stove };
}
function planBath(r, ops) {
  const ds = ops.filter(q => q.k === 'door').map(q => wp(r, q.wall, q.pos + q.width / 2)),
    sd = Math.max(0.6, Math.min(0.9, Math.min(r.w, r.l) / 2 - 0.05));
  const corner = [
    [0, 0],
    [r.w, 0],
    [r.w, r.l],
    [0, r.l],
  ]
    .map(c => ({ c, k: ds.length ? Math.min(...ds.map(d => dist(c, d))) : 0 }))
    .sort((a, b) => b.k - a.k)[0].c;
  const shower = {
    type: 'shower',
    label: 'Душ / ванна',
    x0: corner[0] === 0 ? 0 : r2(r.w - sd),
    y0: corner[1] === 0 ? 0 : r2(r.l - sd),
    x1: corner[0] === 0 ? sd : r.w,
    y1: corner[1] === 0 ? sd : r.l,
  };
  const sink = slots(r, ops, 0.55, false)
    .map(c => ({ c, rect: wallRect(r, c.wall, c.x, 0.55, 0.45, 'sink', 'Раковина') }))
    .filter(o => rectRect(o.rect, shower) > 0.05)
    .sort((a, b) => rectRect(b.rect, shower) - rectRect(a.rect, shower))[0];
  return [shower, ...(sink ? [sink.rect] : [])];
}

/* ---------- расстановка одной комнаты ---------- */
const SOCKET_GAPS = { m: 0.15, c: 0.25, hw: 0.04, sep: 0.3 }; // отступы для розеток

/** Убрать прежнюю расстановку этой комнаты. */
function clearOld(p, r) {
  p.rooms.forEach(o => {
    if (o !== r) o.items = (o.items || []).filter(i => i.ctl !== r.id); // старые «внешние» выключатели этой комнаты
  });
  r.items = (r.items || []).filter(i => i.ctl && i.ctl !== r.id); // свои старые убираем, чужие оставляем
  r.fixtures = [];
}

/** Всё, что нужно шагам расстановки: проёмы, занятые места, добавление элемента, подсказки. */
function makeCtx(p, r) {
  const rep = { tips: [] };
  const ops = openingsOf(p, r);
  const occ = occOf(r);
  const h = r.h;
  const wet = r.type === 'bath' ? { ip: 'IP44' } : {};
  const add = (room, it, o, hw = 0.04) => {
    room.items.push(it);
    if (it.wall != null) o.push({ wall: it.wall, x: it.x, z: it.z, hw });
    return it;
  };
  const S = (wall, x, z, extra = {}) =>
    add(r, mk('socket', wall, x, clamp(z, 0.1, h - 0.15), { role: 'normal', ...wet, ...extra }), occ);
  const sockSpans = z => spans(r, ops, occ, z, SOCKET_GAPS);
  return { p, r, h, ops, occ, t: targets(r), wet, rep, tip: s => rep.tips.push(s), add, S, sockSpans };
}

/** Где ставить выключатель: у двери со стороны ручки; для ванной — снаружи, в соседней комнате. */
function findSwitchHost(c) {
  const { p, r, ops, occ } = c;
  const nb = id => p.rooms.find(x => x.id === id);
  const doors = ops.filter(q => q.k === 'door');
  const isBath = r.type === 'bath';
  let host = r;
  let hops = ops;
  let hocc = occ;
  let door = isBath
    ? doors.find(q => q.to && nb(q.to))
    : doors.find(q => q.ent) || doors.find(q => q.to && (nb(q.to) || {}).type === 'hall') || doors[0];
  if (isBath && door) {
    host = nb(door.to);
    hops = openingsOf(p, host);
    hocc = occOf(host);
    door = hops.find(q => q.k === 'door' && q.to === r.id);
  }
  if (isBath && !door) {
    host = r;
    hops = ops;
    hocc = occ;
    door = doors[0];
  }
  return { host, hops, hocc, door };
}

/** Выключатель у двери (10–15 см от косяка) и коробка рядом, у потолка. */
function placeSwitch(c) {
  const { r, ops, occ, h, add, tip } = c;
  const { host, hops, hocc, door } = findSwitchHost(c);
  const ctl = host === r ? {} : { ctl: r.id };
  if (!door) {
    const g = cands(spans(r, ops, occ, NORM.switchZ, { m: 0.1, c: 0.3, hw: 0, sep: 0.1 }))[0];
    if (g) {
      add(r, mk('switch', g.wall, g.x, NORM.switchZ), occ, 0);
      add(r, mk('box', g.wall, g.x, h - NORM.boxBelowCeil), occ, 0.05);
    }
    tip('В комнате нет двери, выключатель поставлен у угла. Добавьте дверь на плане и расставьте заново.');
    return;
  }
  const L = wl(host, door.wall);
  const a = door.pos;
  const b = door.pos + door.width;
  const sp = spans(host, hops, hocc, NORM.switchZ, { m: 0.1, c: 0.08, hw: 0, sep: 0.1 });
  const side = a < L - b ? [b + 0.12, a - 0.12] : [a - 0.12, b + 0.12]; // дверь навешена у ближнего угла, ручка с дальней стороны
  let x = side.map(r2).find(v => okAt(sp, door.wall, v));
  let wall = door.wall;
  if (x == null) {
    const dc = wp(host, door.wall, a + door.width / 2);
    const g = cands(sp).sort((u, v) => dist(wp(host, u.wall, u.x), dc) - dist(wp(host, v.wall, v.x), dc))[0];
    if (g) {
      wall = g.wall;
      x = g.x;
    }
  }
  if (x == null) return;
  add(host, mk('switch', wall, x, NORM.switchZ, ctl), hocc, 0);
  const zb = host.h - NORM.boxBelowCeil;
  const bs = spans(host, hops, hocc, zb, { m: 0.1, c: 0.08, hw: 0.05, sep: 0.05 });
  const bx = [0, 0.3, -0.3, 0.6, -0.6].map(d => r2(x + d)).find(v => okAt(bs, wall, v));
  if (bx != null) add(host, mk('box', wall, bx, zb, ctl), hocc, 0.05);
  else tip('Коробку у выключателя поставить негде: окна или двери мешают. Добавьте её вручную.');
  if (host !== r) tip(`Выключатель для ванной стоит снаружи, в комнате «${host.name}», рядом с дверью.`);
}

/** Щиток: в комнате с входной дверью, около 1,5 м, рядом со входом. */
function placePanel(c) {
  const { p, r, ops, occ, add, tip } = c;
  const ent = p.entrance && p.entrance.roomId === r.id && ops.find(q => q.ent);
  if (!ent) return;
  const ec = wp(r, ent.wall, ent.pos + ent.width / 2);
  const g = cands(spans(r, ops, occ, NORM.panelZ, { m: 0.25, c: 0.2, hw: 0.15, sep: 0.1 })).sort(
    (u, v) => dist(wp(r, u.wall, u.x), ec) - dist(wp(r, v.wall, v.x), ec),
  )[0];
  if (g) add(r, mk('panel', g.wall, g.x, NORM.panelZ), occ, 0.15);
  else tip('Щиток поставить негде: у входа нет свободной стены. Освободите место или поставьте щиток вручную.');
}

/** Четыре розетки над столешницей: рядом с мойкой и плитой, но не ближе 65 и 55 см. */
function pickCountertop(c, kit) {
  const { r } = c;
  const { sink, stove } = kit;
  const pool = cands(c.sockSpans(NORM.kitchenZ))
    .map(g => ({ ...g, pt: wp(r, g.wall, g.x) }))
    .filter(g => rectD(g.pt, sink.rect) >= 0.65 && rectD(g.pt, stove.rect) >= 0.55);
  const near = pool.filter(g => Math.min(dist(g.pt, sink.c), dist(g.pt, stove.c)) <= 2.4);
  const mid = [(sink.c[0] + stove.c[0]) / 2, (sink.c[1] + stove.c[1]) / 2];
  const ord = (near.length >= 4 ? near : pool).sort((a, b) => dist(a.pt, mid) - dist(b.pt, mid));
  const ch = [];
  for (const gap of [0.9, 0.6, 0.4]) {
    for (const g of ord) {
      if (ch.length >= 4) break;
      if (ch.every(q => dist(q.pt, g.pt) >= gap)) ch.push(g);
    }
    if (ch.length >= 4) break;
  }
  return ch;
}

/** Кухня: плита, розетки над столешницей, посудомойка, холодильник, вытяжка. */
function placeKitchenSockets(c, kit) {
  const { r, h, S, tip, sockSpans } = c;
  const { sink, stove } = kit;
  r.fixtures = [sink.rect, stove.rect];
  const zs = clamp(NORM.hoodZ, 1.8, h - 0.2);
  S(stove.wall, stove.x, NORM.socketZ, { role: 'oven', app: 'oven' });
  const ch = pickCountertop(c, kit);
  ch.forEach(g => S(g.wall, g.x, NORM.kitchenZ, { role: 'kitchen' }));
  if (ch.length < 4) {
    tip(
      `Над столешницей помещаются только ${ch.length} розетки: нужны 4. Рядом с мойкой и плитой мало свободной стены.`,
    );
  }
  const dw = cands(sockSpans(NORM.dishwasherZ)).sort(
    (a, b) => dist(wp(r, a.wall, a.x), sink.c) - dist(wp(r, b.wall, b.x), sink.c),
  )[0];
  if (dw) S(dw.wall, dw.x, NORM.dishwasherZ, { role: 'kitchen', app: 'dishwasher' });
  const away = g => Math.min(dist(g.pt, sink.c), dist(g.pt, stove.c));
  const fr = cands(sockSpans(NORM.socketZ))
    .map(g => ({ ...g, pt: wp(r, g.wall, g.x) }))
    .filter(g => rectD(g.pt, stove.rect) >= 0.5 && rectD(g.pt, sink.rect) >= 0.3)
    .sort((a, b) => away(b) - away(a))[0];
  if (fr) S(fr.wall, fr.x, NORM.socketZ, { role: 'kitchen', app: 'fridge' });
  S(stove.wall, stove.x, zs, { role: 'kitchen', app: 'hood' });
  tip(
    'Положение мойки и плиты выбрано автоматически (мойка у окна, плита в 1,5–2 м от неё). Они показаны пунктиром на виде «Сверху».',
  );
}

/** Ванная: душ и раковина, розетки на 130 см не ближе 65 см от воды. */
function placeBathSockets(c) {
  const { r, ops, S, tip, t, sockSpans } = c;
  r.fixtures = planBath(r, ops);
  const pool = cands(sockSpans(NORM.bathSocketZ))
    .map(g => ({ ...g, pt: wp(r, g.wall, g.x) }))
    .filter(g => r.fixtures.every(f => rectD(g.pt, f) >= 0.65));
  const ch = [];
  const sk = r.fixtures.find(f => f.type === 'sink');
  const ref = sk ? [(sk.x0 + sk.x1) / 2, (sk.y0 + sk.y1) / 2] : [r.w / 2, r.l / 2];
  pool.sort((a, b) => dist(a.pt, ref) - dist(b.pt, ref));
  for (const g of pool) {
    if (ch.length >= t.want) break;
    if (ch.every(q => dist(q.pt, g.pt) >= 1)) ch.push(g);
  }
  ch.forEach(g => S(g.wall, g.x, NORM.bathSocketZ, { role: 'bath' }));
  if (!ch.length) {
    tip(
      'Розетку в ванной не поставил: нет места дальше 60 см от воды. Для стиральной машины используйте соседнюю комнату.',
    );
  }
  tip(
    'В ванной розетки на высоте 130 см, влагозащита IP44, только через дифавтомат 30 мА. Положение душа и раковины выбрано автоматически.',
  );
}

/** Розетки: кухня, ванная или равномерно по свободной длине стен. */
function placeSockets(c) {
  const { r, ops, t, S, tip, sockSpans } = c;
  const kit = r.type === 'kitchen' ? planKitchen(r, ops) : null;
  if (kit) return placeKitchenSockets(c, kit);
  if (r.type === 'bath') return placeBathSockets(c);
  pickEven(sockSpans(NORM.socketZ), t.want).forEach(g => S(g.wall, g.x, NORM.socketZ));
  if (!r.items.some(i => i.type === 'socket'))
    tip('Для розеток нет свободной стены (двери и окна занимают её целиком).');
}

/** Лампы: сетка по освещённости, число = площадь × лк ÷ 250. */
function placeLamps(c) {
  const { r, h, t, wet, occ, add, rep } = c;
  lampGrid(r, t.lamps).forEach(g => add(r, mk('lamp', null, g.x, h, { ...wet, y: g.y }), occ));
  Object.assign(rep, { lux: t.lux, lamps: t.lamps });
}

/** Интернет: не ближе 20 см к силовой розетке, рядом с ней (там же питание роутера). */
function placeNet(c) {
  const { r, ops, occ, add } = c;
  if (!['living', 'office', 'bedroom'].includes(r.type)) return;
  const S0 = r.items.filter(i => i.type === 'socket').map(i => [...ptOf(r, i), i.z]);
  const ps = g => [...wp(r, g.wall, g.x), NORM.socketZ];
  const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const g = cands(spans(r, ops, occ, NORM.socketZ, SOCKET_GAPS))
    .map(q => ({ ...q, k: S0.length ? Math.min(...S0.map(s => d3(s, ps(q)))) : 1 }))
    .filter(q => q.k >= 0.3)
    .sort((a, b) => a.k - b.k)[0];
  if (g) add(r, mk('rj45', g.wall, g.x, NORM.socketZ), occ);
}

export function autoPlaceRoom(p, r) {
  clearOld(p, r);
  const c = makeCtx(p, r);
  placeSwitch(c);
  placePanel(c);
  placeSockets(c);
  placeLamps(c);
  placeNet(c);
  const n = ty => r.items.filter(i => i.type === ty).length;
  c.rep.n = {
    socket: n('socket'),
    lamp: n('lamp'),
    switch: controls(p, r).length,
    box: n('box'),
    panel: n('panel'),
    rj45: n('rj45'),
  };
  return c.rep;
}

// Весь объект: все комнаты по очереди.
export function autoPlaceAll(p) {
  p.rooms.forEach(r => {
    r.items = [];
  });
  const tips = [],
    n = { socket: 0, lamp: 0, switch: 0, panel: 0 };
  p.rooms.forEach(r => {
    const rep = autoPlaceRoom(p, r);
    rep.tips.forEach(s => tips.push(`${r.name}: ${s}`));
    Object.keys(n).forEach(k => {
      n[k] += rep.n[k];
    });
  });
  if (!p.entrance)
    tips.unshift(
      'Не отмечена входная дверь, поэтому щиток не поставлен. На шаге «План» нажмите «Вход» и выберите стену.',
    );
  return { tips, n, issues: p.rooms.flatMap(r => checkRoom(p, r)) };
}

/* ---------- проверка комнаты по нормам (замечания простыми словами) ---------- */
export function checkRoom(p, r) {
  const out = [],
    ops = openingsOf(p, r),
    t = targets(r),
    fx = r.fixtures || [],
    its = r.items || [];
  const push = (level, text, id) => out.push({ level, text, id, room: r.id });
  its.forEach(i => {
    const pt = ptOf(r, i),
      z = i.z,
      role = i.role || 'normal';
    if (i.type === 'socket') {
      if (z > r.h - NORM.ceilGap + 0.005)
        push('error', `Розетка слишком близко к потолку: ${cm(r.h - z)} см, нужно от 15 см. Опустите её.`, i.id);
      if (i.wall != null)
        ops.forEach(q => {
          if (q.wall === i.wall && q.k === 'door' && z < q.z1) {
            const d = i.x < q.pos ? q.pos - i.x : i.x > q.pos + q.width ? i.x - q.pos - q.width : 0;
            if (d < NORM.jambGap - 0.005)
              push('error', `Розетка в ${cm(d)} см от дверного косяка, нужно не меньше 10 см. Сдвиньте её.`, i.id);
          }
        });
      if (role === 'bath' || r.type === 'bath') {
        if (z < NORM.bathMinZ - 0.005)
          push(
            'error',
            `В ванной розетка на высоте ${cm(z)} см, нужно не ниже 60 см (лучше 130 см). Поднимите её.`,
            i.id,
          );
        fx.forEach(f => {
          const d = rectD(pt, f);
          if (d < NORM.sinkGap - 0.005)
            push(
              'error',
              `Розетка в ${cm(d)} см от воды (${f.label.toLowerCase()}), нужно не меньше 60 см. Перенесите её.`,
              i.id,
            );
        });
      } else if (!i.app && role !== 'oven') {
        fx.forEach(f => {
          const need = f.type === 'stove' ? NORM.stoveGap : NORM.sinkGap,
            d = rectD(pt, f);
          if ((f.type === 'sink' || f.type === 'stove') && d < need - 0.005)
            push(
              'error',
              `Розетка в ${cm(d)} см от ${f.type === 'sink' ? 'мойки' : 'плиты'}, нужно не меньше ${cm(need)} см. Перенесите её.`,
              i.id,
            );
        });
        if (role === 'normal' && (z < 0.2 || z > 0.5))
          push('tip', `Обычную розетку принято ставить на высоте около 30 см, у вас ${cm(z)} см.`, i.id);
        if (role === 'kitchen' && z >= 0.9 && (z < 1.05 - 0.005 || z > 1.15 + 0.005))
          push('tip', `Розетки над столешницей ставят на 105–115 см, у вас ${cm(z)} см.`, i.id);
      }
    } else if (i.type === 'switch') {
      if (z < 0.8 || z > 1.0) push('tip', `Выключатель обычно ставят на высоте 90 см, у вас ${cm(z)} см.`, i.id);
    } else if (i.type === 'box') {
      const g = r.h - z;
      if (g < NORM.ceilGap - 0.005 || g > 0.3 + 0.005)
        push('tip', `Распределительная коробка должна быть в 15–30 см от потолка, у вас ${cm(g)} см.`, i.id);
    } else if (i.type === 'panel') {
      if (z < NORM.panelZ - 0.1 || z > NORM.panelZ + 0.1)
        push('tip', `Щиток ставят на высоте около 1,5 м, у вас ${cm(z)} см.`, i.id);
    } else if (i.type === 'camera') {
      if (z < NORM.camMin - 0.005 || z > NORM.camMax + 0.005)
        push('tip', `Камеру ставят на высоте 2,5–3 м, у вас ${cm(z)} см.`, i.id);
    } else if (i.type === 'rj45') {
      its
        .filter(s => s.type === 'socket')
        .forEach(s => {
          const sp = ptOf(r, s),
            d = Math.hypot(pt[0] - sp[0], pt[1] - sp[1], z - s.z);
          if (d < 0.2 - 0.005)
            push('error', `Интернет-розетка в ${cm(d)} см от силовой, нужно не меньше 20 см. Раздвиньте их.`, i.id);
        });
    }
  });
  const ns = its.filter(i => i.type === 'socket').length,
    nl = its.filter(i => i.type === 'lamp').length;
  if (ns < t.minSockets) push('error', `Мало розеток: ${ns}, для такой комнаты нужно не меньше ${t.minSockets}.`);
  if (nl < t.lamps)
    push(
      nl ? 'tip' : 'error',
      nl ? `Света маловато: ${nl} ламп, для ${t.lux} лк нужно около ${t.lamps}.` : 'В комнате нет ламп.',
    );
  if (!controls(p, r).length) push('error', 'В комнате нет выключателя. Поставьте его у двери на высоте 90 см.');
  if (
    !its.some(i => i.type === 'box') &&
    !p.rooms.some(x => (x.items || []).some(i => i.type === 'box' && i.ctl === r.id))
  )
    push('error', 'В комнате нет распределительной коробки. Поставьте её у потолка рядом с выключателем.');
  if (r.type === 'kitchen' && !its.some(i => i.role === 'oven'))
    push('tip', 'На кухне нет отдельной линии для духовки или плиты.');
  return out;
}
