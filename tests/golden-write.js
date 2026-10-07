// Пересоздание tests/golden.json. Запускать только если результат расчёта изменён намеренно:
//   node tests/golden-write.js
import { writeFileSync } from 'node:fs';
import { TEMPLATES } from '../js/templates.js';
import { snapshot, digest, randomProject, placedTemplate, autoPlaceAll } from './golden-lib.js';

export const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

const out = { templates: {}, random: {} };
for (const t of TEMPLATES.filter(x => x.id !== 'empty')) {
  const p = placedTemplate(t.id);
  const { placed, calc } = snapshot(p);
  out.templates[t.id] = {
    // читаемая сводка: при расхождении сразу видно, что изменилось
    itemsPerRoom: placed.map(r => `${r.name}: ${r.items.length}`),
    counts: calc.counts,
    totalCable: calc.totalCable,
    mainA: calc.mainA,
    groups: calc.groups.length,
    warnings: calc.warnings,
    // хэши полного снимка: ловят любое изменение координат, групп, трасс и щитка
    placed: digest(placed),
    calc: digest(calc),
  };
}
for (const s of SEEDS) {
  const p = randomProject(s);
  autoPlaceAll(p);
  const { placed, calc } = snapshot(p);
  out.random[s] = { placed: digest(placed), calc: digest(calc) };
}
writeFileSync(new URL('./golden.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log('golden.json записан');
