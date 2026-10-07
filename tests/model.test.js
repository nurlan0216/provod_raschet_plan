import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES } from '../js/templates.js';
import { removeRoom, refit, normalizeProject, newProject, newRoom } from '../js/model.js';
import { autoPlaceAll } from '../js/rules.js';
import { calcProject } from '../js/calc.js';
import { lines } from '../js/estimate.js';
import { prune, rotate } from '../js/plan2d.js';

const tpl = id => TEMPLATES.find(t => t.id === id).build();

test('removeRoom не оставляет чужих выключателей и коробок', () => {
  const p = tpl('two');
  autoPlaceAll(p);
  const bath = p.rooms.find(r => r.type === 'bath');
  removeRoom(p, bath.id);
  assert.equal(p.rooms.flatMap(r => r.items).filter(i => i.ctl === bath.id).length, 0);
  assert.equal(calcProject(p).counts.switch, p.rooms.length);
});

test('шаблоны: расчёт и смета без NaN', () => {
  for (const t of TEMPLATES) {
    const p = t.build();
    autoPlaceAll(p);
    const R = calcProject(p);
    if (R.empty) continue;
    assert.ok(Number.isFinite(R.totalCable));
    assert.ok(lines(p, R).every(l => Number.isFinite(l.qty * l.price)));
  }
});

const wlen = (r, w) => (w % 2 ? r.l : r.w);

test('refit: после уменьшения комнаты ничего не выходит за стены, fixtures сброшены', () => {
  const p = tpl('two');
  autoPlaceAll(p);
  const r = p.rooms.find(x => x.type === 'kitchen');
  assert.ok(r.fixtures.length > 0);
  r.w = 1.5;
  r.l = 1.5;
  r.h = 2.4;
  assert.equal(refit(p, r), true);
  assert.deepEqual(r.fixtures, []);
  for (const o of [...r.doors, ...r.windows]) {
    assert.ok(o.pos >= 0 && o.pos + o.width <= wlen(r, o.wall) + 1e-9);
  }
  for (const i of r.items) {
    if (i.wall == null) assert.ok(i.x <= r.w && i.y <= r.l && i.z === r.h);
    else assert.ok(i.x >= 0 && i.x <= wlen(r, i.wall) && i.z <= r.h);
  }
});

test('refit + prune: двери к разъехавшимся комнатам удаляются', () => {
  const p = tpl('two');
  autoPlaceAll(p);
  const doors = () => p.rooms.reduce((s, x) => s + x.doors.length, 0),
    before = doors();
  const hall = p.rooms.find(x => x.type === 'hall');
  hall.l = 1.5;
  refit(p, hall);
  const n = prune(p);
  assert.ok(n > 0, 'хотя бы одна дверь должна быть удалена');
  assert.equal(before - doors(), n);
  assert.equal(prune(p), 0, 'повторный prune ничего не находит');
});

test('normalizeProject: мусор даёт null, неполные данные достраиваются', () => {
  for (const bad of [null, undefined, 5, 'x', [], {}, { rooms: 5 }, { rooms: {} }])
    assert.equal(normalizeProject(bad), null);
  const p = normalizeProject({ rooms: [null, {}, { id: 'a', type: 'zzz', w: -1, l: 'abc' }] });
  assert.equal(p.rooms.length, 1);
  const r = p.rooms[0];
  assert.equal(r.type, 'other');
  assert.deepEqual([r.w, r.l, r.h], [3, 4, 2.7]);
  assert.deepEqual([r.doors, r.windows, r.items, r.fixtures], [[], [], [], []]);
  assert.ok(p.id && p.settings.mainBreakerA);
});

test('normalizeProject: корректный проект не меняется', () => {
  const p = tpl('two');
  autoPlaceAll(p);
  assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(p))), p);
});

test('rotate: четыре поворота подряд возвращают исходные координаты', () => {
  const p = tpl('two');
  autoPlaceAll(p);
  p.entrance ||= null;
  for (const r of p.rooms) {
    const snap = JSON.stringify(r),
      ent = JSON.stringify(p.entrance);
    for (let k = 0; k < 4; k++) rotate(p, r);
    assert.equal(JSON.stringify(r), snap);
    assert.equal(JSON.stringify(p.entrance), ent);
  }
});

test('inkOn: тёмный текст на светлом полу, белый на тёмном', async () => {
  const { inkOn } = await import('../js/util.js');
  assert.equal(inkOn('#FFFFFF'), '#1B2530');
  assert.equal(inkOn('#F2B705'), '#1B2530');
  assert.equal(inkOn('#333333'), '#FFFFFF');
  assert.equal(inkOn('#000000'), '#FFFFFF');
  assert.equal(inkOn('red'), '#1B2530', 'неизвестный формат — тёмный');
});
