// Точечные эталоны на границах норм и расчётных порогов. Дополняют golden.test.js: хэши снимков ловят
// любое изменение на шаблонах и 60 случайных проектах, но не те пороги, которых в них нет
// (камеры и PoE, предел UTP, номиналы вводного автомата, размеры щитка, зазоры до косяка, мойки и плиты).
// Значения выбраны с запасом около 3 см (или 5 %) по обе стороны границы: сдвиг нормы на такую величину тест заметит.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject, newRoom } from '../js/model.js';
import { checkRoom, NORM } from '../js/rules.js';
import { calcProject } from '../js/calc.js';
import { calcNet, UTP_MAX } from '../js/calc/net.js';
import { calcLoad, sizePanel } from '../js/calc/panel.js';
import { limitW } from '../js/calc/groups.js';
import { placedTemplate } from './golden-lib.js';

/* ---------- сеть: PoE-порты и предел UTP ---------- */

const netRoom = items => newRoom({ id: 'r1', name: 'Зал', w: 4, l: 3, h: 2.7, items });
const cams = n =>
  Array.from({ length: n }, (_, k) => ({ id: 'c' + k, type: 'camera', wall: 0, x: 0.2 + k * 0.1, z: 2.7 }));

test('PoE-порты: ближайший коммутатор на 4, 8, 16 или 24 порта', () => {
  const want = { 1: 4, 4: 4, 5: 8, 8: 8, 9: 16, 16: 16, 17: 24, 24: 24, 30: 24 };
  for (const [n, ports] of Object.entries(want)) {
    const { net } = calcNet(
      [netRoom(cams(+n))],
      {},
      () => 10,
      1,
      () => {},
    );
    assert.equal(net.cameras, +n);
    assert.equal(net.poePorts, ports, `камер: ${n}`);
  }
  assert.equal(
    calcNet(
      [netRoom([])],
      {},
      () => 10,
      1,
      () => {},
    ).net.poePorts,
    0,
    'без камер портов нет',
  );
});

test('UTP: предупреждение только когда кабель длиннее предела', () => {
  assert.equal(UTP_MAX, 90);
  const room = netRoom([{ id: 'n1', type: 'rj45', wall: 0, x: 1, z: 0.3 }]);
  const run = len => {
    const out = [];
    calcNet(
      [room],
      {},
      () => len,
      1,
      (lvl, text, rid) => out.push({ lvl, text, rid }),
    );
    return out;
  };
  assert.deepEqual(run(85), [], '85 м: можно');
  const w = run(95);
  assert.equal(w.length, 1, '95 м: предупреждение');
  assert.equal(w[0].lvl, 'error');
  assert.equal(w[0].rid, 'r1');
  assert.match(w[0].text, /больше 90 м/);
});

test('UTP: запас на кабель умножается до сравнения с пределом', () => {
  const room = netRoom([{ id: 'n1', type: 'rj45', wall: 0, x: 1, z: 0.3 }]);
  const out = [];
  calcNet(
    [room],
    {},
    () => 80,
    1.15,
    (...a) => out.push(a),
  ); // 80 × 1,15 = 92 м
  assert.equal(out.length, 1);
});

/* ---------- вводной автомат и щиток ---------- */

test('вводной автомат: наименьший номинал, который тянет нагрузку', () => {
  // нагрузка = мощность × 0,5 (коэффициент одновременности); предел автомата = A × 230 × 0,8
  const demandW = d => [{ power: d * 2 }];
  const cases = [
    [2900, 16],
    [3000, 20],
    [3700, 25],
    [4600, 25],
    [4700, 32],
    [6000, 40],
    [7500, 50],
    [9500, 63],
    [99999, 63],
  ];
  for (const [d, a] of cases) {
    const r = calcLoad(demandW(d), false, 40);
    assert.equal(r.demand, d);
    assert.equal(r.needA, a, `нагрузка ${d} Вт`);
  }
  assert.equal(calcLoad(demandW(9000), true, 40).needA, 20, 'три фазы: предел втрое выше');
  assert.equal(calcLoad(demandW(3000), false, 25).cap, limitW(25));
  assert.equal(calcLoad(demandW(3000), true, 25).cap, limitW(25) * 3);
});

test('вводной автомат по умолчанию 40 А, выбранный номинал сохраняется', () => {
  const p = placedTemplate('studio');
  delete p.settings.mainBreakerA;
  assert.equal(calcProject(p).mainA, 40);
  p.settings.mainBreakerA = 25;
  assert.equal(calcProject(p).mainA, 25);
});

test('щиток: модули, запас 20 % и ближайший корпус', () => {
  const lights = n => Array.from({ length: n }, () => ({ kind: 'light' }));
  const diffs = n => Array.from({ length: n }, () => ({ kind: 'socket' }));
  // вводные 2 модуля, свет 1, дифавтомат 2; нужно ceil(занято × 1,2)
  const s = sizePanel([...lights(3), ...diffs(2)], false);
  assert.deepEqual([s.light, s.diff, s.intro, s.used, s.need, s.size], [3, 2, 2, 9, 11, 12]);
  assert.equal(sizePanel([...lights(3), ...diffs(2)], true).intro, 3, 'три фазы: вводные 3 модуля');
  const want = [
    [38, 48, false], //  занято 40, нужно 48
    [39, 72, false], //  занято 41, нужно 50
    [58, 72, false], //  занято 60, нужно 72
    [59, 72, true], //   занято 61, нужно 74: два корпуса
  ];
  for (const [n, size, tooBig] of want) {
    const r = sizePanel(lights(n), false);
    assert.equal(r.size, size, `света: ${n}`);
    assert.equal(r.tooBig, tooBig, `света: ${n}`);
  }
});

/* ---------- checkRoom: зазоры и высоты из NORM ---------- */

// Комната 4 × 3 м, высота 2,7 м, дверь на стене 0 в позиции 1,0 м шириной 0,9 м.
function room(items, fixtures = []) {
  const p = newProject('t');
  const r = newRoom({
    id: 'r1',
    name: 'Зал',
    type: 'other',
    w: 4,
    l: 3,
    h: 2.7,
    items,
    fixtures,
    doors: [{ wall: 0, pos: 1, width: 0.9, toRoom: null }],
  });
  p.rooms = [r];
  return { p, r };
}
const sock = (o = {}) => ({ id: 's1', type: 'socket', role: 'normal', wall: 2, x: 3, z: 0.3, ...o });
const msgs = (items, fixtures) => {
  const { p, r } = room(items, fixtures);
  return checkRoom(p, r).filter(c => c.id === items[0].id);
};
const has = (list, re) => list.some(c => re.test(c.text));

test('NORM: значения норм не менялись', () => {
  assert.equal(NORM.ceilGap, 0.15);
  assert.equal(NORM.jambGap, 0.1);
  assert.equal(NORM.sinkGap, 0.6);
  assert.equal(NORM.stoveGap, 0.5);
  assert.equal(NORM.camMin, 2.5);
  assert.equal(NORM.camMax, 3.0);
});

test('checkRoom: розетка не ближе 15 см к потолку', () => {
  assert.equal(has(msgs([sock({ z: 2.7 - 0.18 })]), /потолку/), false);
  assert.equal(has(msgs([sock({ z: 2.7 - 0.12 })]), /потолку/), true);
});

test('checkRoom: розетка не ближе 10 см к дверному косяку', () => {
  // дверь занимает 1,0–1,9 м стены 0; розетка слева от косяка
  assert.equal(has(msgs([sock({ wall: 0, x: 1 - 0.13 })]), /косяка/), false);
  assert.equal(has(msgs([sock({ wall: 0, x: 1 - 0.07 })]), /косяка/), true);
  // справа от косяка
  assert.equal(has(msgs([sock({ wall: 0, x: 1.9 + 0.13 })]), /косяка/), false);
  assert.equal(has(msgs([sock({ wall: 0, x: 1.9 + 0.07 })]), /косяка/), true);
  // выше двери косяк не мешает
  assert.equal(has(msgs([sock({ wall: 0, x: 1.2, z: 2.2 })]), /косяка/), false);
});

test('checkRoom: розетка не ближе 60 см к мойке и 50 см к плите', () => {
  const sink = { type: 'sink', label: 'Мойка', x0: 1, y0: 2.4, x1: 1.6, y1: 3 };
  const stove = { type: 'stove', label: 'Плита', x0: 1, y0: 2.4, x1: 1.6, y1: 3 };
  // розетка на стене 2 (низ комнаты, y = 3), справа от прибора на расстоянии d
  const at = d => sock({ wall: 2, x: 1.6 + d });
  assert.equal(has(msgs([at(0.63)], [sink]), /мойки/), false);
  assert.equal(has(msgs([at(0.57)], [sink]), /мойки/), true);
  assert.equal(has(msgs([at(0.53)], [stove]), /плиты/), false);
  assert.equal(has(msgs([at(0.47)], [stove]), /плиты/), true);
  // между 50 и 60 см плита уже не мешает, а мойка ещё мешает
  assert.equal(has(msgs([at(0.55)], [stove]), /плиты/), false);
  assert.equal(has(msgs([at(0.55)], [sink]), /мойки/), true);
});

test('checkRoom: камера на высоте 2,5–3 м', () => {
  const cam = z => ({ id: 'c1', type: 'camera', wall: 0, x: 3, z });
  assert.equal(has(msgs([cam(2.4)]), /Камеру/), true);
  assert.equal(has(msgs([cam(2.6)]), /Камеру/), false);
  assert.equal(has(msgs([cam(2.95)]), /Камеру/), false);
  assert.equal(has(msgs([cam(3.1)]), /Камеру/), true);
});
