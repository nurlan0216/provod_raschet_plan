// @ts-check
import { controls } from '../rules.js';
import { itemPt, gpt, P } from './route.js';
import { limitW } from './groups.js';

// Щиток, распределительные коробки, фазы и вводной автомат.

const DEMAND = 0.5; // коэффициент одновременности (не всё включено сразу)
const MAIN_A = [16, 20, 25, 32, 40, 50, 63];
const PANEL_SIZES = [8, 12, 18, 24, 36, 48, 72];

/** Щиток: настоящий, иначе условно у входной двери. */
export function findPanel(p) {
  const rooms = p.rooms;
  for (const r of rooms) {
    const i = (r.items || []).find(x => x.type === 'panel');
    if (i) return { pt: itemPt(r, i), assumed: false };
  }
  const e = p.entrance && rooms.find(r => r.id === p.entrance.roomId);
  if (!e) return { pt: P(rooms[0], rooms[0].x, rooms[0].y, 1.5), assumed: true };
  const [x, y] = gpt(e, p.entrance.wall, p.entrance.pos + p.entrance.width / 2);
  return { pt: P(e, x, y, 1.5), assumed: true };
}

/** Распределительная коробка каждой комнаты (может стоять и в соседней комнате, например у ванной). */
export function findHubs(p) {
  const rooms = p.rooms;
  const hubs = {};
  rooms.forEach(r => {
    const bx = rooms.flatMap(x =>
      (x.items || []).filter(i => i.type === 'box' && (i.ctl || x.id) === r.id).map(i => ({ x, i })),
    );
    if (bx.length) {
      const b = bx.find(q => q.x.id === r.id) || bx[0];
      hubs[r.id] = { ...itemPt(b.x, b.i), assumed: false };
      return;
    }
    const sw = controls(p, r)[0];
    const host = sw && rooms.find(x => (x.items || []).includes(sw));
    hubs[r.id] = host
      ? { ...itemPt(host, sw), z: host.h - 0.25, assumed: true }
      : { ...P(r, r.x + r.w / 2, r.y + r.l / 2, r.h - 0.25), assumed: true };
  });
  return hubs;
}

/** Фазы (опция «Три фазы»): нагрузка распределяется поровну, самые мощные группы первыми. */
export function assignPhases(bundles, three) {
  const phases = [0, 0, 0];
  if (!three) {
    bundles.forEach(b => {
      b.phase = null;
      phases[0] += b.power;
    });
    return { phases: null, skew: null };
  }
  [...bundles]
    .sort((a, b) => b.power - a.power)
    .forEach(b => {
      let m = 0;
      for (let k = 1; k < 3; k++) if (phases[k] < phases[m]) m = k;
      b.phase = m;
      phases[m] += b.power;
    });
  const mx = Math.max(...phases);
  const mn = Math.min(...phases);
  return { phases, skew: mx ? (mx - mn) / mx : 0 };
}

/** Сколько модулей нужно в щитке. */
export function sizePanel(bundles, three) {
  const light = bundles.filter(b => b.kind === 'light').length;
  const diff = bundles.length - light;
  const intro = three ? 3 : 2;
  const used = light + diff * 2 + intro;
  const need = Math.ceil(used * 1.2 - 1e-9);
  const size = PANEL_SIZES.find(n => n >= need) || 72;
  // n: клемм на шинах N и PE (по числу групп + запас)
  return { light, diff, intro, used, need, size, tooBig: need > 72, n: bundles.length + 1 };
}

/** Нагрузка дома и нужный вводной автомат. */
export function calcLoad(bundles, three, mainA) {
  const total = bundles.reduce((s, b) => s + b.power, 0);
  const demand = total * DEMAND;
  const cap = limitW(mainA) * (three ? 3 : 1);
  const needA = MAIN_A.find(a => limitW(a) * (three ? 3 : 1) >= demand) || 63;
  return { total, demand, cap, needA };
}
