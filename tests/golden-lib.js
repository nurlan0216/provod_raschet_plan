// Эталонные снимки расстановки и расчёта. Нужны, чтобы рефакторинг не менял результат без предупреждения.
// Случайные id (uid) в снимок не попадают: их заменяют метки r0, r1, i0, i1 … по порядку появления.
import { createHash } from 'node:crypto';
import { TEMPLATES } from '../js/templates.js';
import { ROOM_TYPES, refit } from '../js/model.js';
import { autoPlaceAll, autoPlaceRoom } from '../js/rules.js';
import { calcProject } from '../js/calc.js';
import { prune } from '../js/plan2d.js';

// Детерминированный генератор (mulberry32): одинаковый seed даёт одинаковый проект.
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Заменяет случайные id на метки в порядке обхода проекта.
export function stable(value, p) {
  const map = new Map();
  let ri = 0;
  let ii = 0;
  let fi = 0;
  p.rooms.forEach(r => map.set(r.id, 'r' + ri++));
  p.rooms.forEach(r => (r.fixtures || []).forEach(f => f.id && map.set(f.id, 'f' + fi++)));
  p.rooms.forEach(r => (r.items || []).forEach(i => map.set(i.id, 'i' + ii++)));
  const walk = v => {
    if (typeof v === 'string') return map.has(v) ? map.get(v) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [map.get(k) ?? k, walk(x)]));
    return v;
  };
  return walk(JSON.parse(JSON.stringify(value)));
}

export const digest = o => createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);

export function snapshot(p) {
  const placed = stable(
    p.rooms.map(r => ({ name: r.name, items: r.items, fixtures: r.fixtures })),
    p,
  );
  const calc = stable(calcProject(p), p);
  return { placed, calc };
}

// Случайный проект: шаблон + случайные размеры, типы и высоты комнат. Двери и проёмы подгоняются refit/prune.
export function randomProject(seed) {
  const rnd = prng(seed);
  const pick = a => a[Math.floor(rnd() * a.length)];
  const num = (a, b) => Math.round((a + rnd() * (b - a)) * 10) / 10;
  const p = pick(TEMPLATES.filter(t => t.id !== 'empty')).build();
  const types = Object.keys(ROOM_TYPES);
  p.rooms.forEach(r => {
    if (rnd() < 0.5) r.type = pick(types);
    r.w = num(1.5, 6);
    r.l = num(1.5, 6);
    r.h = num(2.4, 3.2);
    refit(p, r);
  });
  prune(p);
  return p;
}

export function placedTemplate(id) {
  const p = TEMPLATES.find(t => t.id === id).build();
  autoPlaceAll(p);
  return p;
}

export { autoPlaceAll, autoPlaceRoom, calcProject };
