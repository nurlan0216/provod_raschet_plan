// Настройки 3D-вида. Живут между открытиями шага «Модель», как раньше переменные модуля.
export const V = {
  low: false,
  ceil: false,
  selId: null,
  animPid: null,
  lastCam: null,
  curView: 'iso',
  lightMode: false,
  litPid: null,
};
export const litRooms = new Set();
export const layers = { wires: true, sock: true, light: true, net: true, labels: true };
export const LAYERS = [
  ['wires', 'Провода'],
  ['sock', 'Розетки'],
  ['light', 'Свет'],
  ['net', 'Интернет'],
  ['labels', 'Подписи'],
];
const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => mqReduce.matches;
