// Модель данных. Все положения в метрах от одного начала координат (раздел 6.3).
// Стены комнаты: 0 = верх, 1 = право, 2 = низ, 3 = лево.
// pos = расстояние от начала стены (слева для верха/низа, сверху для лева/права) до начала проёма, м.
// Дверь между комнатами хранится один раз, в комнате-«владельце», с полем toRoom.
export const ROOM_TYPES = {
  bedroom: 'Спальня', living: 'Гостиная', kitchen: 'Кухня', bath: 'Ванная / санузел',
  hall: 'Коридор / прихожая', office: 'Кабинет', balcony: 'Балкон', storage: 'Кладовая', other: 'Другая'
};
export const TYPE_FLOOR = {
  bedroom: '#D8C7A8', living: '#CDB48F', kitchen: '#D9D2C3', bath: '#B8CBD6',
  hall: '#C9BBA3', office: '#C3B79E', balcony: '#BFC4C7', storage: '#C8C2B6', other: '#D8D2C4'
};
export const uid = () => Math.random().toString(36).slice(2, 9);
export const fmt = n => String(n).replace('.', ',');

export const newRoom = (o = {}) => ({
  id: uid(), name: 'Комната', type: 'bedroom', w: 3, l: 4, h: 2.7,
  x: 0, y: 0, rot: 0,               // левый верхний угол на плане, м; поворот 0/90/180/270
  floor: TYPE_FLOOR[o.type || 'bedroom'], wall: '#F1EDE4',
  doors: [],                         // {wall, pos, width, toRoom}
  windows: [],                       // {wall, pos, width, sill, height}
  items: [],                         // {id, type, role, x, y, z, wall}
  fixtures: [],                      // мойка, плита, душ: {type, label, x0, y0, x1, y1}, ставит «Расставить по правилам»
  ...o
});

export const newProject = (name = 'Новый проект') => ({
  v: 1, id: uid(), name, created: Date.now(), updated: Date.now(),
  settings: { mainBreakerA: 40, threePhase: false, wallThickness: 10, prices: {} },
  entrance: null,                    // {roomId, wall, pos, width}
  rooms: []
});

export const area = r => +(r.w * r.l).toFixed(1);
export const totalArea = rs => +rs.reduce((s, r) => s + r.w * r.l, 0).toFixed(1);
// Куда поставить новую комнату, пока нет редактора плана: справа от последней.
export const nextSlot = rs => ({ x: rs.length ? +Math.max(...rs.map(r => r.x + r.w)).toFixed(2) : 0, y: 0 });
export function removeRoom(p, id) {
  p.rooms = p.rooms.filter(r => r.id !== id);
  p.rooms.forEach(r => { r.doors = r.doors.filter(d => d.toRoom !== id); });
  if (p.entrance && p.entrance.roomId === id) p.entrance = null;
}
