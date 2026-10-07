// @ts-check
/**
 * @typedef {{ wall: 0|1|2|3, pos: number, width: number, toRoom: string, swing?: 'in'|'out' }} Door
 * @typedef {{ wall: 0|1|2|3, pos: number, width: number, sill: number, height: number }} Window
 * @typedef {{ id: string, type: string, role?: string, wall: 0|1|2|3|null, x: number, y: number, z: number, ctl?: string, app?: string, ip?: string }} Item
 * @typedef {{ type: string, label: string, x0: number, y0: number, x1: number, y1: number }} Fixture
 * @typedef {{ id: string, name: string, type: string, w: number, l: number, h: number, x: number, y: number, rot: number, floor: string, wall: string,
 *   doors: Door[], windows: Window[], items: Item[], fixtures: Fixture[] }} Room
 * @typedef {{ roomId: string, wall: 0|1|2|3, pos: number, width: number }} Entrance
 * @typedef {{ mainBreakerA: number, threePhase: boolean, wallThickness: number, prices: Record<string, number> }} Settings
 * @typedef {{ v: number, id: string, name: string, created: number, updated: number, settings: Settings, entrance: Entrance|null, rooms: Room[] }} Project
 */
import { clamp, r2, wallLen } from './util.js';
// Модель данных. Все положения в метрах от одного начала координат (раздел 6.3).
// Стены комнаты: 0 = верх, 1 = право, 2 = низ, 3 = лево.
// pos = расстояние от начала стены (слева для верха/низа, сверху для лева/права) до начала проёма, м.
// Дверь между комнатами хранится один раз, в комнате-«владельце», с полем toRoom.
export const ROOM_TYPES = {
  bedroom: 'Спальня',
  living: 'Гостиная',
  kitchen: 'Кухня',
  bath: 'Ванная / санузел',
  hall: 'Коридор / прихожая',
  office: 'Кабинет',
  balcony: 'Балкон',
  storage: 'Кладовая',
  other: 'Другая',
};
export const TYPE_FLOOR = {
  bedroom: '#D8C7A8',
  living: '#CDB48F',
  kitchen: '#D9D2C3',
  bath: '#B8CBD6',
  hall: '#C9BBA3',
  office: '#C3B79E',
  balcony: '#BFC4C7',
  storage: '#C8C2B6',
  other: '#D8D2C4',
};
export const uid = () => Math.random().toString(36).slice(2, 9);
export const fmt = n => String(n).replace('.', ',');

export const newRoom = (o = {}) => ({
  id: uid(),
  name: 'Комната',
  type: 'bedroom',
  w: 3,
  l: 4,
  h: 2.7,
  x: 0,
  y: 0,
  rot: 0, // левый верхний угол на плане, м; поворот 0/90/180/270
  floor: TYPE_FLOOR[o.type || 'bedroom'],
  wall: '#F1EDE4',
  doors: [], // {wall, pos, width, toRoom}
  windows: [], // {wall, pos, width, sill, height}
  items: [], // {id, type, role, x, y, z, wall}
  fixtures: [], // мойка, плита, душ: {type, label, x0, y0, x1, y1}, ставит «Расставить по правилам»
  ...o,
});

export const newProject = (name = 'Новый проект') => ({
  v: 1,
  id: uid(),
  name,
  created: Date.now(),
  updated: Date.now(),
  settings: { mainBreakerA: 40, threePhase: false, wallThickness: 10, prices: {} },
  entrance: null, // {roomId, wall, pos, width}
  rooms: [],
});

const num = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);
// Привести сохранённые данные к рабочему виду. Мусор без rooms даёт null; недостающие поля добавляются.
export function normalizeProject(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.rooms)) return null;
  const base = newProject(String(p.name || 'Проект'));
  return {
    ...base,
    ...p,
    id: String(p.id || base.id),
    settings: { ...base.settings, ...(p.settings || {}) },
    rooms: p.rooms
      .filter(r => r && r.id)
      .map(r => ({
        ...newRoom(),
        ...r,
        type: ROOM_TYPES[r.type] ? r.type : 'other',
        w: num(r.w, 3),
        l: num(r.l, 4),
        h: num(r.h, 2.7),
        doors: r.doors || [],
        windows: r.windows || [],
        items: r.items || [],
        fixtures: r.fixtures || [],
      })),
  };
}
export const area = r => +(r.w * r.l).toFixed(1);
export const totalArea = rs => +rs.reduce((s, r) => s + r.w * r.l, 0).toFixed(1);
// Куда поставить новую комнату, пока нет редактора плана: справа от последней.
export const nextSlot = rs => ({ x: rs.length ? +Math.max(...rs.map(r => r.x + r.w)).toFixed(2) : 0, y: 0 });
export function removeRoom(p, id) {
  p.rooms = p.rooms.filter(r => r.id !== id);
  p.rooms.forEach(r => {
    r.doors = r.doors.filter(d => d.toRoom !== id);
    r.items = (r.items || []).filter(i => i.ctl !== id); // выключатели и коробки удалённой комнаты
  });
  if (p.entrance && p.entrance.roomId === id) p.entrance = null;
}

// Подогнать проёмы и электрику под новые размеры комнаты. Вызывать после изменения w / l / h.
// Возвращает true, если сброшены fixtures (мойка, плита, душ считались под старый размер).
export function refit(p, r) {
  const cl = (v, a, b) => r2(clamp(v, a, b));
  const ops = [...r.doors, ...r.windows, ...(p.entrance && p.entrance.roomId === r.id ? [p.entrance] : [])];
  ops.forEach(o => {
    const L = wallLen(r, o.wall);
    o.width = Math.min(o.width, L);
    o.pos = cl(o.pos, 0, L - o.width);
  });
  (r.items || []).forEach(i => {
    if (i.wall == null) {
      i.x = cl(i.x, 0.1, r.w - 0.1);
      i.y = cl(i.y || 0, 0.1, r.l - 0.1);
      i.z = r.h;
    } else {
      i.x = cl(i.x, 0, wallLen(r, i.wall));
      i.z = cl(i.z, 0.05, r.h - 0.05);
    }
  });
  const had = (r.fixtures || []).length > 0;
  r.fixtures = [];
  return had;
}
