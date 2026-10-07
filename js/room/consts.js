import { NORM } from '../rules.js';

// Константы и иконки редактора комнаты.
export const WALLS = ['Верхняя', 'Правая', 'Нижняя', 'Левая'];
export const ROLES = {
  normal: 'Обычная',
  kitchen: 'Кухня',
  oven: 'Духовка / плита',
  ac: 'Кондиционер',
  bath: 'Ванная',
};
export const TOOLS = [
  ['socket', 'Розетка'],
  ['switch', 'Выключатель'],
  ['lamp', 'Лампа'],
  ['box', 'Коробка'],
  ['panel', 'Щиток'],
  ['rj45', 'Интернет'],
  ['camera', 'Камера'],
];
export const COL = {
  socket: 'var(--blue)',
  switch: '#1B2530',
  lamp: 'var(--accent)',
  box: 'var(--orange)',
  panel: 'var(--red)',
  rj45: 'var(--teal)',
  camera: 'var(--teal)',
};
export const RECS = {
  bedroom:
    'Розеток: 1 на каждые 4 м периметра, не меньше 3, на высоте 30 см и не ближе 10 см к косяку. Выключатель на 90 см у двери со стороны ручки. Свет: 150 лк, тёплый (2700 К), бра у кровати.',
  living:
    'Розеток: 1 на каждые 4 м периметра, не меньше 3, на высоте 30 см. Выключатель на 90 см у двери. Свет: 150 лк.',
  kitchen:
    'Розеток не меньше 6–8: 4 над столешницей на 105–115 см (не ближе 60 см к мойке и 50 см к плите) и техника. Посудомойка 10–15 см, холодильник до 30 см, вытяжка около 2 м. Отдельная линия для духовки или плиты. Свет: 200 лк и подсветка столешницы.',
  bath: 'Розетки не ниже 60 см (лучше 130 см), не ближе 60 см к воде, влагозащита IP44, только через дифавтомат 30 мА. Выключатель лучше снаружи. Свет: 200 лк, IP44/IP65.',
  hall: 'Розеток 1–2. Щиток на высоте около 1,5 м у входной двери. Выключатель у двери. Свет: 100 лк.',
  office: 'Розеток: 1 на каждые 3 м периметра. Интернет-розетка не ближе 20 см к силовой. Свет: 300 лк, 4000 К.',
};
export const recOf = t => RECS[t] || 'Минимум: розетка, выключатель и лампа.';
export const snap = v => Math.round(v * 20) / 20;
export const defZ = (t, r) =>
  ({
    socket: NORM.socketZ,
    switch: NORM.switchZ,
    box: r.h - NORM.boxBelowCeil,
    panel: NORM.panelZ,
    rj45: NORM.socketZ,
    camera: Math.min(2.6, r.h - 0.2),
    lamp: r.h,
  })[t];

export function icon(t, x, y, k = 9, sel = false) {
  const c = COL[t],
    st = 'stroke="#fff" stroke-width="1.8"';
  let s = '';
  if (sel) s += `<circle cx="${x}" cy="${y}" r="${k + 7}" fill="none" stroke="var(--accent)" stroke-width="3"/>`;
  if (t === 'socket' || t === 'lamp' || t === 'rj45')
    s +=
      `<circle cx="${x}" cy="${y}" r="${k}" fill="${c}" ${st}/>` +
      (t === 'lamp' ? `<circle cx="${x}" cy="${y}" r="${k * 0.45}" fill="#fff" opacity=".9"/>` : '');
  else if (t === 'camera')
    s += `<polygon points="${x},${y - k - 1} ${x + k + 1},${y + k} ${x - k - 1},${y + k}" fill="${c}" ${st}/>`;
  else {
    const q = t === 'panel' ? k * 1.25 : k * 0.9;
    s += `<rect x="${x - q}" y="${y - q}" width="${q * 2}" height="${q * 2}" fill="${c}" ${st}/>`;
  }
  return s;
}
export const HINT = {
  null: 'Выберите, что поставить, или нажмите на значок, чтобы изменить его.',
  lamp: 'Лампы ставятся на потолок: нажмите в нужное место комнаты в виде «Сверху».',
};
