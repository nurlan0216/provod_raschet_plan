import { fmt } from './model.js';
import { NORMS_NOTE, checkRoom } from './rules.js';
import { calcProject, mount as mountCalc } from './calc.js';
import { esc } from './util.js';

// Этап 8: экран «Проверка». Сводит в один список замечания по комнатам (rules.checkRoom),
// по расчёту (calc.warnings) и по щитку/фазам, рисует схему щитка.
// Замечание: { level: 'error' | 'tip', text, room, item } — room/item нужны для «Показать на модели».
const SIZES = [8, 12, 18, 24, 36, 48, 72];
const SKEW_TIP = 0.3; // перекос по фазам больше 30 % → совет

export function collect(p, R = calcProject(p)) {
  const rooms = p.rooms || [],
    out = [];
  if (!rooms.length) return out;
  const add = (level, text, room, item) => out.push({ level, text, room, item });
  const home = (p.entrance && rooms.some(r => r.id === p.entrance.roomId) && p.entrance.roomId) || rooms[0].id;

  if (!rooms.some(r => (r.items || []).some(i => i.type === 'panel')))
    add(
      'error',
      'Нет щитка. Поставьте его у входной двери на высоте около 1,5 м. Кнопка «Расставить по правилам» делает это сама.',
      home,
    );
  rooms.forEach(r =>
    checkRoom(p, r).forEach(x =>
      add(
        x.level,
        x.text.startsWith('В комнате') ? x.text.replace('В комнате', `В комнате «${r.name}»`) : `${r.name}: ${x.text}`,
        r.id,
        x.id,
      ),
    ),
  );
  // замечания расчёта: щиток и коробки уже учтены выше, повторять не нужно
  R.warnings.forEach(w => {
    if (!/^Нет щитка|нет распределительной коробки/.test(w.text)) add(w.level, w.text, w.room || home);
  });

  const chosen = p.settings && p.settings.panelModules,
    pn = R.panel;
  if (pn.tooBig)
    add(
      'error',
      `Щиток мал: нужно около ${pn.need} модулей, а в один корпус помещается до 72. Поставьте два щитка или уберите лишние группы.`,
      home,
    );
  else if (chosen && chosen < pn.used)
    add(
      'error',
      `Щиток мал: вы выбрали ${chosen} модулей, а автоматам нужно ${pn.used}. Выберите щиток побольше (от ${pn.need} модулей).`,
      home,
    );
  else if (chosen && chosen < pn.need)
    add(
      'tip',
      `В щитке на ${chosen} модулей почти нет запаса. Лучше взять от ${pn.need}: потом можно добавить автомат.`,
      home,
    );

  if (R.three && R.phaseSkew > SKEW_TIP)
    add(
      'tip',
      `Нагрузка по фазам неравномерная: перекос ${Math.round(R.phaseSkew * 100)} %. Старайтесь, чтобы мощные группы не оказывались на одной фазе.`,
      home,
    );
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
}

/* ---------- схема щитка (одна линия, SVG) ---------- */
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
function lines2(s) {
  // название в две строки по 11 знаков
  if (s.length <= 11) return [s, ''];
  const i = s.lastIndexOf(' ', 11);
  return i > 3 ? [cut(s.slice(0, i), 11), cut(s.slice(i + 1), 11)] : [cut(s, 11), cut(s.slice(11), 11)];
}
export function schemeSvg(R) {
  const n = R.groups.length,
    W = Math.max(330, 120 + n * 92 + 10),
    cx = i => 150 + i * 92,
    bus = cx(Math.max(0, n - 1)) + 30;
  const L = ['L1', 'L2', 'L3'],
    sec = s => '3×' + fmt(s);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="290" viewBox="0 0 ${W} 290" font-family="inherit" font-size="12" fill="var(--text)" stroke="none">
    <g stroke="var(--text)" stroke-width="2" fill="none"><path class="wire" pathLength="1" d="M60 26V44M60 88V112"/><path class="wire" pathLength="1" style="--d:200ms" d="M60 112H${bus}"/></g>
    <text x="60" y="16" text-anchor="middle" font-weight="700">${R.three ? 'Ввод 3×230 В' : 'Ввод 230 В'}</text>
    <rect x="22" y="44" width="76" height="44" rx="6" fill="var(--card)" stroke="var(--text)" stroke-width="2"/>
    <text x="60" y="63" text-anchor="middle" font-weight="700">Вводной</text><text x="60" y="80" text-anchor="middle">${R.three ? '3P ' : ''}C${R.mainA} А</text>`;
  R.groups.forEach((g, i) => {
    const x = cx(i),
      bad = g.overload,
      [a, b] = lines2(g.name),
      st = bad ? 'var(--red)' : 'var(--text)';
    s += `<g class="gbox" style="--d:${300 + i * 90}ms"><title>${esc(g.name)}: ${esc(g.rooms.join(', '))}</title>
      <path class="wire" pathLength="1" style="--d:${350 + i * 90}ms" d="M${x} 112V128M${x} 180V214" stroke="var(--text)" stroke-width="2" fill="none"/>
      <rect x="${x - 34}" y="128" width="68" height="52" rx="6" fill="var(--card)" stroke="${st}" stroke-width="${bad ? 3 : 2}"/>
      <text x="${x}" y="148" text-anchor="middle" font-weight="700">C${g.breaker} А</text>
      <text x="${x}" y="166" text-anchor="middle" font-size="12">${g.device === 'автомат' ? 'автомат' : 'ДА 30 мА'}</text>
      <text x="${x}" y="230" text-anchor="middle" font-weight="700">${sec(g.section)}</text>
      <text x="${x}" y="247" text-anchor="middle">${esc(a)}</text><text x="${x}" y="261" text-anchor="middle">${esc(b)}</text>
      ${g.phase != null ? `<text x="${x}" y="278" text-anchor="middle" font-weight="700">${L[g.phase]}</text>` : ''}</g>`;
  });
  return s + '</svg>';
}

/* ---------- экран ---------- */
export function mount(el, ctx, R = calcProject(ctx.state.project)) {
  const p = ctx.state.project;
  if (!p.rooms.length) {
    el.innerHTML =
      '<p class="muted">Сначала добавьте комнаты и расставьте электрику: тогда здесь появится проверка.</p>';
    return () => {};
  }
  const list = collect(p, R),
    ne = list.filter(x => x.level === 'error').length,
    nt = list.length - ne;
  const chosen = (p.settings && p.settings.panelModules) || '';
  const status = list.length
    ? `<section class="card"><h2>Замечания</h2><p><b>Ошибок: ${ne}</b> · советов: ${nt}</p><ul class="list">${list
        .map(
          (x, i) => `<li class="iss ${x.level === 'error' ? 'err' : 'tip'}">
        <b>${x.level === 'error' ? 'Ошибка' : 'Совет'}</b><span>${esc(x.text)}</span>
        ${x.room ? `<button data-k="show" data-i="${i}">Показать на модели</button>` : ''}</li>`,
        )
        .join('')}</ul></section>`
    : '<section class="card okbox" role="status"><b>✔ Всё в порядке</b><span>Замечаний нет. Проект можно показывать электрику.</span></section>';
  el.innerHTML = `${status}
    <section class="card"><h2>Схема щитка</h2>
      ${
        R.groups.length
          ? `<div class="scroll" role="img" aria-label="Схема щитка: вводной автомат и ${R.groups.length} групп">${schemeSvg(R)}</div>
        <p class="muted small">ДА 30 мА — дифавтомат (защита от удара током). Нули (N) и заземление (PE) идут на отдельные шины, никогда на одну. Под каждым автоматом: сечение кабеля, название группы и фаза.</p>`
          : '<p class="muted">Групп пока нет: расставьте розетки и лампы, и схема появится.</p>'
      }
      <div class="fld"><label for="k-size">Щиток, модулей</label>
        <select id="k-size"><option value=""${chosen ? '' : ' selected'}>Подобрать само (${R.panel.tooBig ? '2 по 48' : R.panel.size})</option>${SIZES.map(n => `<option value="${n}"${n === chosen ? ' selected' : ''}>${n}</option>`).join('')}</select></div></section>
    <div id="calc"></div>
    <p class="muted small">${esc(NORMS_NOTE)}</p>`;
  const stopCalc = mountCalc(el.querySelector('#calc'), ctx, R);
  const onClick = e => {
    const b = e.target.closest('[data-k=show]');
    if (!b) return;
    const x = list[+b.dataset.i];
    if (x) ctx.showOnModel(x.room, x.item);
  };
  const onChange = e => {
    if (e.target.id !== 'k-size') return;
    const v = +e.target.value || null;
    ctx.commit(q => {
      q.settings.panelModules = v;
    });
  };
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  return () => {
    stopCalc();
    el.removeEventListener('click', onClick);
    el.removeEventListener('change', onChange);
  };
}
