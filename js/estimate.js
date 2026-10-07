import { fmt, area } from './model.js';
import { copyText, downloadCsv } from './estimate/export.js';
import { NORMS_NOTE } from './rules.js';
import { calcProject } from './calc.js';
import { schemeSvg } from './check.js';
import { esc, wallPt as wpt, invalid, valid } from './util.js';

// Цвета печатного SVG заданы hex-значениями: он вставляется в #print и уходит на печать/в PDF вне тем приложения,
// CSS-переменные там не нужны. Все цвета собраны здесь.
const PRINT_COL = { win: '#2B7DE9', yellow: '#F2B705', red: '#C93A2B', teal: '#0E9F9D', gray: '#566270' };

// Этап 9: экран «Покупки». Смета по результатам расчёта (calc.js), цены в тенге правятся прямо в таблице
// и хранятся в project.settings.prices. Печать: отдельный блок #print, виден только при печати.
const NB = '\u00A0';
export const money = n => Math.round(n).toLocaleString('ru-RU').replace(/\s/g, NB) + NB + '₸';
const qtyTxt = q => fmt(Number.isInteger(q) ? q : q.toFixed(1));

// Стартовые цены, ₸ (раздел 12). Цены с пометкой ASSUMED в исходном промте не заданы: взяты примерные, их стоит поправить.
const DEF = {
  c15: 450,
  c25: 700,
  c4: 1100,
  utp: 250,
  strobe: 1500,
  socket: 1200,
  sw: 1000,
  mb: 150,
  box: 300,
  a10: 1500,
  d16: 9000,
  d25: 11000,
  cam: 25000,
  poe: 18000,
  rj45: 1500,
  lamp: 800,
  main1: 4000,
  main3: 10000,
};
const panelPrice = n => (n === 24 ? 9000 : Math.round(((9000 / 24) * n) / 100) * 100);
const ASSUMED = k => ['rj45', 'lamp', 'main1', 'main3'].includes(k) || (k.startsWith('panel') && k !== 'panel24');

// Строки сметы: { key, name, qty, unit, price, def, assumed }. Пустые строки (количество 0) не показываем.
export function lines(p, R = calcProject(p)) {
  if (R.empty) return [];
  const c = R.counts,
    st = p.settings || {},
    pr = st.prices || {},
    out = [];
  const add = (key, name, qty, unit, def) => {
    if (qty > 0)
      out.push({ key, name, qty, unit, def, price: Number.isFinite(pr[key]) ? pr[key] : def, assumed: ASSUMED(key) });
  };
  const m = k => Math.ceil(R.cable[k].total - 1e-9);
  add('c15', 'Кабель 3×1,5 мм² (свет)', m('1.5'), 'м', DEF.c15);
  add('c25', 'Кабель 3×2,5 мм² (розетки)', m('2.5'), 'м', DEF.c25);
  add('c4', 'Кабель 3×4 мм² (духовка, плита)', m('4'), 'м', DEF.c4);
  add('utp', 'Кабель UTP cat6 (интернет, камеры)', Math.ceil(R.cable.utp.total - 1e-9), 'м', DEF.utp);
  add(
    'strobe',
    'Штроба под кабель',
    Math.ceil(R.cable['1.5'].raw + R.cable['2.5'].raw + R.cable['4'].raw - 1e-9),
    'м',
    DEF.strobe,
  );
  add('socket', 'Розетка', c.socket, 'шт', DEF.socket);
  add('rj45', 'Розетка RJ45 (интернет)', c.rj45, 'шт', DEF.rj45);
  add('sw', 'Выключатель', c.switch, 'шт', DEF.sw);
  add('mb', 'Подрозетник', c.mountBoxes, 'шт', DEF.mb);
  add('box', 'Распределительная коробка', c.box, 'шт', DEF.box);
  add('lamp', 'Светильник', c.lamp, 'шт', DEF.lamp);
  add('a10', 'Автомат 10 А (свет)', c.lightBreakers, 'шт', DEF.a10);
  add('d16', 'Дифавтомат 16 А (защита от удара током)', c.diff16, 'шт', DEF.d16);
  add('d25', 'Дифавтомат 25 А (духовка, плита)', c.diff25, 'шт', DEF.d25);
  add(
    R.three ? 'main3' : 'main1',
    `Вводной автомат ${R.mainA} А${R.three ? ', 3 полюса' : ''}`,
    1,
    'шт',
    R.three ? DEF.main3 : DEF.main1,
  );
  const size = st.panelModules || R.panel.size,
    two = R.panel.tooBig && !st.panelModules;
  if (R.groups.length)
    add(
      'panel' + (two ? 48 : size),
      `Щиток, модулей: ${two ? 48 : size}`,
      two ? 2 : 1,
      'шт',
      panelPrice(two ? 48 : size),
    );
  add('cam', 'Камера', c.camera, 'шт', DEF.cam);
  if (c.camera) add('poe', `PoE-коммутатор, портов: ${c.poePorts}`, 1, 'шт', DEF.poe);
  return out;
}
export const total = ls => ls.reduce((s, l) => s + Math.round(l.qty * l.price), 0);

/* ---------- Excel и CSV ---------- */
const head = ['Наименование', 'Кол-во', 'Ед.', 'Цена, ₸', 'Сумма, ₸'];
const rowsOf = ls => [
  head,
  ...ls.map(l => [l.name, qtyTxt(l.qty), l.unit, String(l.price), String(Math.round(l.qty * l.price))]),
  ['Итого', '', '', '', String(total(ls))],
];
export const toTsv = ls =>
  rowsOf(ls)
    .map(r => r.join('\t'))
    .join('\n');
export const toCsv = ls =>
  '\uFEFF' +
  rowsOf(ls)
    .map(r => r.map(c => (/[;"\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(';'))
    .join('\r\n');

/* ---------- план этажа для печати (SVG в метрах) ---------- */
export function planSvg(p) {
  const rs = p.rooms;
  if (!rs.length) return '';
  const pad = 0.9,
    X0 = Math.min(...rs.map(r => r.x)) - pad,
    Y0 = Math.min(...rs.map(r => r.y)) - pad;
  const W = Math.max(...rs.map(r => r.x + r.w)) + pad - X0,
    H = Math.max(...rs.map(r => r.y + r.l)) + pad - Y0;
  const seg = (r, w, pos, wd) => {
    const a = wpt(r, w, pos),
      b = wpt(r, w, pos + wd);
    return `x1="${r.x + a[0]}" y1="${r.y + a[1]}" x2="${r.x + b[0]}" y2="${r.y + b[1]}"`;
  };
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${X0} ${Y0} ${W} ${H}" width="100%" font-family="Manrope,Arial,sans-serif" role="img" aria-label="План этажа">`;
  rs.forEach(r => {
    s += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.l}" fill="#F7F4EC" stroke="#1B2530" stroke-width=".12"/>`;
  });
  rs.forEach(r => {
    (r.doors || []).forEach(d => {
      s += `<line ${seg(r, d.wall, d.pos, d.width)} stroke="#fff" stroke-width=".16"/><line ${seg(r, d.wall, d.pos, d.width)} stroke="#8A6D1E" stroke-width=".04" stroke-dasharray=".1 .08"/>`;
    });
    (r.windows || []).forEach(w => {
      s += `<line ${seg(r, w.wall, w.pos, w.width)} stroke="${PRINT_COL.win}" stroke-width=".14"/>`;
    });
    s +=
      `<text x="${r.x + r.w / 2}" y="${r.y + r.l / 2 - 0.05}" font-size=".3" font-weight="700" text-anchor="middle" fill="#1B2530">${esc(r.name)}</text>` +
      `<text x="${r.x + r.w / 2}" y="${r.y + r.l / 2 + 0.3}" font-size=".24" text-anchor="middle" fill="${PRINT_COL.gray}">${fmt(r.w)} × ${fmt(r.l)} м · ${fmt(area(r))} м²</text>`;
  });
  rs.forEach(r =>
    (r.items || []).forEach(i => {
      const [a, b] = i.wall == null ? [i.x, i.y || 0] : wpt(r, i.wall, i.x),
        x = r.x + a,
        y = r.y + b,
        k = 0.1;
      if (i.type === 'socket')
        s += `<circle cx="${x}" cy="${y}" r="${k}" fill="${PRINT_COL.win}" stroke="#fff" stroke-width=".02"/>`;
      else if (i.type === 'lamp')
        s += `<circle cx="${x}" cy="${y}" r="${k}" fill="${PRINT_COL.yellow}" stroke="#1B2530" stroke-width=".03"/>`;
      else if (i.type === 'switch')
        s += `<rect x="${x - k}" y="${y - k}" width="${2 * k}" height="${2 * k}" fill="#1B2530"/>`;
      else if (i.type === 'box')
        s += `<rect x="${x - k}" y="${y - k}" width="${2 * k}" height="${2 * k}" fill="#fff" stroke="#1B2530" stroke-width=".03"/>`;
      else if (i.type === 'panel') s += `<rect x="${x - 0.15}" y="${y - 0.15}" width=".3" height=".3" fill="${PRINT_COL.red}"/>`;
      else s += `<circle cx="${x}" cy="${y}" r="${k}" fill="${PRINT_COL.teal}"/>`;
    }),
  );
  const e = p.entrance && rs.find(r => r.id === p.entrance.roomId);
  if (e) {
    const w = p.entrance.wall,
      a = wpt(e, w, p.entrance.pos + p.entrance.width / 2),
      x = e.x + a[0],
      y = e.y + a[1];
    const [tx, ty, an] =
      w === 0
        ? [x, y - 0.3, 'middle']
        : w === 2
          ? [x, y + 0.5, 'middle']
          : w === 1
            ? [x + 0.25, y + 0.08, 'start']
            : [x - 0.25, y + 0.08, 'end'];
    s += `<line ${seg(e, w, p.entrance.pos, p.entrance.width)} stroke="${PRINT_COL.red}" stroke-width=".18"/><text x="${tx}" y="${ty}" font-size=".3" font-weight="700" text-anchor="${an}" fill="${PRINT_COL.red}">Вход</text>`;
  }
  // линейка 1 м
  s += `<line x1="${X0 + 0.3}" y1="${Y0 + H - 0.3}" x2="${X0 + 1.3}" y2="${Y0 + H - 0.3}" stroke="#1B2530" stroke-width=".06"/><text x="${X0 + 1.4}" y="${Y0 + H - 0.22}" font-size=".24" fill="#1B2530">1 м</text>`;
  return s + '</svg>';
}

/* ---------- блок «Как проложить провода» ---------- */
const STEPS = [
  'Разметка: отметьте на стенах трассы, места коробок, подрозетников и щитка.',
  'Штроба: пропилите борозды под кабель по разметке.',
  'Гофра: уложите кабель в гофрированную трубу и закрепите в штробе.',
  'Коробки: установите распределительные коробки у потолка, так чтобы к ним был доступ.',
  'Подрозетники: установите их под розетки и выключатели.',
  'Щиток: смонтируйте щиток и автоматы по схеме.',
  'Прозвонка и замер изоляции: проверьте каждую линию и сопротивление изоляции до штукатурки.',
  'Подключение к сети: ввод и счётчик подключает только электрик с допуском.',
];
const RULES = [
  'Трассы только вертикально и горизонтально, никаких диагоналей.',
  'От потолка 15–20 см.',
  'Не ближе 10 см к углам и проёмам.',
  'Силовой кабель и интернет пересекайте под углом 90°.',
  'Соединения только в распределительных коробках, не в штробе.',
];
const WARN = 'Внимание: ввод в квартиру и счётчик подключает только электрик с допуском. Не делайте это сами.';
const howto =
  () => `<h2>Как проложить провода</h2><h3>Порядок работ</h3><ol>${STEPS.map(x => `<li>${x}</li>`).join('')}</ol>
  <h3>Правила</h3><ul>${RULES.map(x => `<li>${x}</li>`).join('')}</ul><p class="warnb"><b>${WARN}</b></p>`;

/* ---------- печатная версия ---------- */
const LOGO =
  '<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="8" fill="#F2B705"/><path d="M19 5L9 19h7l-2 10 11-15h-7z" fill="#1B2530"/></svg>';
function printHtml(p, R, ls) {
  const g = R.groups,
    L = ['L1', 'L2', 'L3'];
  return `<header class="ph">${LOGO}<div><b>ЭлектроПлан</b><br>${esc(p.name)} · ${new Date().toLocaleDateString('ru-RU')}</div></header>
  <section class="pp"><h2>План этажа</h2>${planSvg(p)}
    <p class="small">● розетка (синий) · ● лампа (жёлтый) · ■ выключатель · □ коробка · ■ щиток (красный) · ● интернет и камеры (бирюзовый)</p></section>
  <section class="pp"><h2>Схема щитка</h2>${g.length ? schemeSvg(R) : '<p>Групп нет.</p>'}</section>
  <section class="pp"><h2>Группы</h2>${
    g.length
      ? `<table><thead><tr><th>Группа</th><th>Комнаты</th><th>Точек</th><th>Нагрузка, Вт</th><th>Защита</th><th>Кабель</th><th>Длина, м</th></tr></thead><tbody>${g
          .map(
            x =>
              `<tr><td>${esc(x.name)}${x.phase != null ? ' · ' + L[x.phase] : ''}</td><td>${esc(x.rooms.join(', '))}</td><td>${x.pts.length}</td><td>${Math.round(x.power)}</td><td>${x.device === 'автомат' ? 'автомат' : 'ДА 30 мА'} ${x.breaker} А</td><td>3×${fmt(x.section)}</td><td>${fmt(x.lenR.toFixed(1))}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : '<p>Групп нет.</p>'
  }</section>
  <section class="pp"><h2>Смета</h2>${est(ls)}</section>
  <section class="pp">${howto()}<p class="small">${esc(NORMS_NOTE)}</p></section>`;
}
const est =
  ls => `<table><thead><tr><th>Наименование</th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>${ls
    .map(
      l =>
        `<tr><td>${esc(l.name)}</td><td>${qtyTxt(l.qty)}</td><td>${l.unit}</td><td>${money(l.price)}</td><td>${money(l.qty * l.price)}</td></tr>`,
    )
    .join('')}</tbody>
  <tfoot><tr><td colspan="4"><b>Итого</b></td><td><b>${money(total(ls))}</b></td></tr></tfoot></table>`;

/* ---------- экран ---------- */
const parsePrice = v => {
  const n = parseFloat(
    String(v)
      .replace(/[\s\u00A0]/g, '')
      .replace(',', '.'),
  );
  return n >= 0 && n < 1e8 ? Math.round(n) : NaN;
};

function screenHtml(ls) {
  return `<section class="card tot"><span>Итого</span><b id="e-total">${money(total(ls))}</b></section>
    <section class="card"><h2>Смета</h2>
      <div class="eh" aria-hidden="true"><span>Кол-во</span><span>Цена, ₸</span><span>Сумма</span></div>
      ${ls
        .map(
          l => `<div class="er" data-k="${l.key}" data-q="${l.qty}"><div class="en">${esc(l.name)}${l.assumed ? ' <small class="muted">(цена примерная)</small>' : ''}</div>
        <span class="eq">${qtyTxt(l.qty)} ${l.unit}</span>
        <div><input class="ep" id="ep-${l.key}" inputmode="decimal" value="${l.price}" aria-label="Цена, ₸: ${esc(l.name)}" autocomplete="off"></div>
        <b class="es">${money(l.qty * l.price)}</b></div>`,
        )
        .join('')}
      <p class="muted small">Цены в тенге можно менять прямо в таблице, они сохраняются. Количество кабеля с запасом 15 %. Цены с пометкой «примерная» вы не задавали: поставьте свои.</p>
      <div class="row"><button class="primary" data-e="print">Печать / PDF</button><button data-e="copy">Копировать для Excel</button><button data-e="csv">Скачать CSV</button><button class="danger" data-e="reset">Сбросить цены</button></div></section>
    <section class="card">${howto()}</section>
    <p class="muted small">${esc(NORMS_NOTE)}</p>`;
}

export function mount(el, ctx) {
  const p = ctx.state.project,
    R = calcProject(p);
  if (R.empty) {
    el.innerHTML = '<p class="muted">Сначала добавьте комнаты и расставьте электрику: тогда здесь появится смета.</p>';
    return () => {};
  }
  const ls = lines(p, R);
  if (!R.groups.length && !ls.some(l => l.key === 'c15' || l.key === 'utp')) {
    el.innerHTML =
      '<p class="muted">Пока нечего покупать: расставьте розетки, лампы и щиток (шаг «Модель», кнопка «Расставить по правилам везде»).</p>' +
      `<section class="card">${howto()}</section>`;
    return () => {};
  }
  el.innerHTML = screenHtml(ls);
  const pr = document.createElement('div');
  pr.id = 'print';
  document.body.appendChild(pr);
  const cur = () => lines(ctx.state.project, R);
  const build = () => {
    pr.innerHTML = printHtml(ctx.state.project, R, cur());
  };
  const recompute = () => {
    const now = cur(),
      by = Object.fromEntries(now.map(l => [l.key, l]));
    el.querySelectorAll('.er').forEach(r => {
      const l = by[r.dataset.k];
      if (l) r.querySelector('.es').textContent = money(l.qty * l.price);
    });
    el.querySelector('#e-total').textContent = money(total(now));
  };
  const setPrice = (key, v) => {
    ctx.commit(
      q => {
        (q.settings.prices ||= {})[key] = v;
      },
      true,
      'price:' + key,
    );
    recompute();
  };
  const onInput = e => {
    if (!e.target.classList.contains('ep')) return;
    const v = parsePrice(e.target.value);
    if (!Number.isNaN(v)) {
      valid(e.target);
      setPrice(e.target.closest('.er').dataset.k, v);
    }
  };
  const onChange = e => {
    if (!e.target.classList.contains('ep')) return;
    const v = parsePrice(e.target.value);
    if (Number.isNaN(v)) {
      invalid(e.target, 'Цена: введите число от 0 до 99 999 999, например 1200.');
      return;
    }
    valid(e.target);
    e.target.value = v;
  };
  const onClick = async e => {
    const b = e.target.closest('[data-e]');
    if (!b) return;
    if (b.dataset.e === 'print') {
      build();
      window.print();
    } else if (b.dataset.e === 'copy') copyText(ctx, toTsv(cur()));
    else if (b.dataset.e === 'csv') downloadCsv(ctx, toCsv(cur()));
    else if (
      b.dataset.e === 'reset' &&
      (await ctx.confirmBox(
        'Вернуть все цены к стартовым? Ваши цены пропадут (это можно отменить кнопкой «Отменить»).',
        'Да, вернуть',
      ))
    )
      ctx.commit(q => {
        q.settings.prices = {};
      });
  };
  window.addEventListener('beforeprint', build);
  el.addEventListener('input', onInput);
  el.addEventListener('change', onChange);
  el.addEventListener('click', onClick);
  return () => {
    window.removeEventListener('beforeprint', build);
    el.removeEventListener('input', onInput);
    el.removeEventListener('change', onChange);
    el.removeEventListener('click', onClick);
    pr.remove();
  };
}
