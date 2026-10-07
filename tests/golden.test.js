// Сверка расстановки (autoPlaceRoom/autoPlaceAll) и расчёта (calcProject) с зафиксированными эталонами.
// Если тест упал после рефакторинга, поведение изменилось. Если изменение задумано, пересоздайте эталон:
//   node tests/golden-write.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TEMPLATES } from '../js/templates.js';
import { snapshot, digest, randomProject, placedTemplate, autoPlaceAll, autoPlaceRoom, prng } from './golden-lib.js';

const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8'));

for (const id of Object.keys(golden.templates)) {
  test(`эталон: шаблон «${id}», сводка расчёта`, () => {
    const { placed, calc } = snapshot(placedTemplate(id));
    const g = golden.templates[id];
    assert.deepEqual(
      placed.map(r => `${r.name}: ${r.items.length}`),
      g.itemsPerRoom,
    );
    assert.deepEqual(calc.counts, g.counts);
    assert.equal(calc.totalCable, g.totalCable);
    assert.equal(calc.mainA, g.mainA);
    assert.equal(calc.groups.length, g.groups);
    assert.deepEqual(calc.warnings, g.warnings);
  });

  test(`эталон: шаблон «${id}», полный снимок расстановки и расчёта`, () => {
    const { placed, calc } = snapshot(placedTemplate(id));
    assert.equal(digest(placed), golden.templates[id].placed, 'расстановка изменилась');
    assert.equal(digest(calc), golden.templates[id].calc, 'расчёт изменился');
  });
}

test('эталон: 60 случайных проектов (расстановка и расчёт)', () => {
  const bad = [];
  for (const seed of Object.keys(golden.random)) {
    const p = randomProject(+seed);
    autoPlaceAll(p);
    const { placed, calc } = snapshot(p);
    const g = golden.random[seed];
    if (digest(placed) !== g.placed) bad.push(`seed ${seed}: расстановка`);
    if (digest(calc) !== g.calc) bad.push(`seed ${seed}: расчёт`);
  }
  assert.deepEqual(bad, []);
});

test('autoPlaceRoom: повторная расстановка не меняет состав электрики', () => {
  const kinds = p =>
    p.rooms.map(r =>
      r.items
        .map(i => i.type)
        .sort()
        .join(),
    );
  for (const seed of [3, 11, 27]) {
    const p = randomProject(seed);
    autoPlaceAll(p);
    const before = kinds(p);
    p.rooms.forEach(r => autoPlaceRoom(p, r));
    assert.deepEqual(kinds(p), before);
  }
});

test('генератор prng детерминирован', () => {
  const a = prng(7);
  const b = prng(7);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test('шаблоны без электрики не падают в расчёте', () => {
  for (const t of TEMPLATES) assert.doesNotThrow(() => snapshot(t.build()));
});
