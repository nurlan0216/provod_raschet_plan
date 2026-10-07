// @ts-check
import { fmt } from './model.js';
import { NORMS_NOTE, controls } from './rules.js';
import { esc, r1 } from './util.js';
import { makeRouter, makeLeg, reachableRooms } from './calc/route.js';
import { KIND, limitW, collectPoints, packBundles, describeBundles, addSwitchCable } from './calc/groups.js';
import { findPanel, findHubs, assignPhases, sizePanel, calcLoad } from './calc/panel.js';
import { calcNet, UTP_MAX } from './calc/net.js';

// Расчёт проводки (раздел 10). Все положения берутся с общего плана в метрах, поэтому
// при перемещении комнаты длины кабеля пересчитываются сами.
// Схема: щиток → распределительная коробка комнаты → точки (звезда от коробки).
// Кабель идёт только по стенам и потолку: по плану манхэттенское расстояние (через двери),
// по вертикали — по высотам. Горизонтальный ход проходит на 20 см ниже потолка.
// Шаги расчёта лежат в js/calc/: route (маршруты), groups (группы линий), panel (щиток), net (интернет).

export const RESERVE = 1.15; // запас на кабель 15 %

export const ASSUMPTIONS = [
  'Мощность точек (ориентир): лампа 10 Вт, обычная розетка 250 Вт, над столешницей 700 Вт, посудомойка 2000 Вт, холодильник 300 Вт, вытяжка 200 Вт, ванная 1200 Вт, духовка 3500 Вт, кондиционер 1500 Вт.',
  'От коробки к каждой точке идёт отдельный отрезок кабеля (звезда). К длине добавлено 15 % на запас.',
  'Расчётная нагрузка дома: половина суммы мощностей (не всё включают одновременно).',
  'Интернет и камеры тянутся от щитка, там же стоит роутер и PoE-коммутатор.',
];

/** Предупреждения о комнатах без двери к щитку и без распределительной коробки. */
function roomWarnings(p, panel, hubs, warn) {
  const rooms = p.rooms;
  const reach = reachableRooms(rooms, panel.rid);
  rooms
    .filter(r => !reach.has(r.id))
    .forEach(r => {
      const text = `Комната «${r.name}» не соединена дверью с комнатой, где стоит щиток.`;
      warn('error', `${text} Кабель посчитан напрямик. Добавьте дверь на плане.`, r.id);
    });
  rooms.forEach(r => {
    const needHub = (r.items || []).some(i => i.type === 'lamp' || i.type === 'socket') || controls(p, r).length;
    if (needHub && hubs[r.id].assumed) {
      const text = `В комнате «${r.name}» нет распределительной коробки.`;
      warn('tip', `${text} Длина посчитана до выключателя или центра комнаты. Поставьте коробку у потолка.`, r.id);
    }
  });
}

/** Итоги по сечениям кабеля. */
function cableTotals(bundles, utp) {
  const sec = { 1.5: 0, 2.5: 0, 4: 0 };
  bundles.forEach(b => {
    sec[String(b.section)] += b.len;
  });
  const cable = {};
  Object.keys(sec).forEach(k => {
    cable[k] = { raw: sec[k], total: sec[k] * RESERVE };
  });
  cable.utp = { raw: utp / RESERVE, total: utp };
  return cable;
}

/** Сколько элементов каждого вида стоит на плане и что из них нужно купить. */
function countItems(rooms, bundles, res) {
  const cnt = t => rooms.reduce((s, r) => s + (r.items || []).filter(i => i.type === t).length, 0);
  return {
    socket: cnt('socket'),
    switch: cnt('switch'),
    lamp: cnt('lamp'),
    box: cnt('box'),
    panel: cnt('panel'),
    rj45: cnt('rj45'),
    camera: cnt('camera'),
    mountBoxes: cnt('socket') + cnt('switch') + cnt('rj45'),
    lightBreakers: res.panel.light,
    diff16: bundles.filter(b => b.kind !== 'light' && b.breaker === 16).length,
    diff25: bundles.filter(b => b.breaker === 25).length,
    mainA: res.mainA,
    panelModules: res.panel.size,
    connectors: res.net.lines + res.net.cameras,
    poePorts: res.net.poePorts,
  };
}

export function calcProject(p) {
  const rooms = p.rooms || [];
  const st = p.settings || {};
  const three = !!st.threePhase;
  const mainA = st.mainBreakerA || 40;
  const res = { empty: !rooms.length, warnings: [], groups: [], rooms: [], cable: {}, three, mainA };
  if (res.empty) return res;
  const warn = (level, text, room) => res.warnings.push({ level, text, room });

  const routes = []; // трассы для 3D
  const leg = makeLeg(makeRouter(p), routes);

  const found = findPanel(p);
  const panel = found.pt;
  if (found.assumed) {
    warn(
      'error',
      'Нет щитка. Длины посчитаны условно от входной двери. Поставьте щиток у входа, и расчёт станет точным.',
    );
    res.panelAssumed = true;
  }
  const hubs = findHubs(p);

  // Порядок комнат: от ближних к щитку к дальним
  const toPanel = {};
  rooms.forEach(r => {
    toPanel[r.id] = leg(panel, hubs[r.id]);
  });
  const order = [...rooms].sort((a, b) => toPanel[a.id] - toPanel[b.id]);
  const rank = Object.fromEntries(order.map((r, i) => [r.id, i]));

  const bundles = packBundles(collectPoints(rooms, rank));
  const lightOf = describeBundles(bundles, { rooms, rank, panel, hubs, leg, warn });
  addSwitchCable(p, bundles, lightOf, hubs, leg);
  bundles.forEach(b => {
    b.lenR = b.len * RESERVE;
  });

  const ph = assignPhases(bundles, three);
  if (three) res.phaseSkew = ph.skew;
  res.phases = ph.phases;

  const { net, utp } = calcNet(rooms, panel, leg, RESERVE, warn);
  res.net = net;
  res.panel = sizePanel(bundles, three);
  res.load = calcLoad(bundles, three, mainA);
  if (res.load.demand > res.load.cap) {
    const need = `${fmt(r1(res.load.demand / 1000))} кВт, а он тянет ${fmt(r1(res.load.cap / 1000))} кВт`;
    warn(
      'error',
      `Вводной автомат ${mainA} А мал: расчётная нагрузка ${need}. По расчёту нужен около ${res.load.needA} А, но мощность разрешает поставщик электроэнергии: уточните её в договоре.`,
    );
  }
  roomWarnings(p, panel, hubs, warn);

  res.cable = cableTotals(bundles, utp);
  res.groups = bundles;
  res.routes = routes;
  res.rooms = rooms.map(r => ({
    id: r.id,
    name: r.name,
    toPanel: toPanel[r.id],
    hubAssumed: hubs[r.id].assumed,
    groups: bundles.filter(b => b.roomIds.includes(r.id)).length,
  }));
  res.groupsByRoom = Object.fromEntries(res.rooms.map(x => [x.id, x.groups]));
  res.counts = countItems(rooms, bundles, res);
  res.totalCable = res.cable['1.5'].total + res.cable['2.5'].total + res.cable['4'].total;
  return res;
}

/* ---------- экран «Расчёт проводки» ---------- */
const m1 = v => fmt(r1(v).toFixed(1)),
  kw = w => fmt((w / 1000).toFixed(1));
const sect = s => `3×${fmt(s)} мм²`;

export function mount(el, ctx, R = calcProject(ctx.state.project)) {
  const p = ctx.state.project;
  if (R.empty) {
    el.innerHTML = '<p class="muted">Сначала добавьте комнаты и расставьте электрику: тогда здесь появится расчёт.</p>';
    return () => {};
  }
  const st = p.settings,
    L = ['L1', 'L2', 'L3'];
  const groups = R.groups.length
    ? R.groups
        .map(
          g => `<li class="item"><span><b>${esc(g.name)}</b>
      <small>${esc(g.rooms.join(', '))} · точек: ${g.pts.length}</small>
      <small${g.overload ? ' style="color:var(--red)"' : ''}>Нагрузка ${fmt(Math.round(g.power))} Вт из ${fmt(Math.round(g.limitW))} Вт</small>
      <small>${g.device === 'автомат' ? 'Автомат' : 'Дифавтомат 30 мА (защита от удара током)'} ${g.breaker} А · кабель ${sect(g.section)} · ${m1(g.lenR)} м${g.phase != null ? ' · фаза ' + L[g.phase] : ''}</small></span></li>`,
        )
        .join('')
    : '<li class="muted">Групп пока нет: расставьте розетки и лампы.</li>';
  const cab = k => (R.cable[k].total ? `<p>Кабель ${sect(+k)}: <b>${m1(R.cable[k].total)} м</b></p>` : '');
  const net = R.net;
  el.innerHTML = `
  <section class="card"><h2>Кабель</h2>
    <p style="font-size:1.4rem;margin:0 0 6px"><b>${m1(R.totalCable)} м</b> силового кабеля</p>
    ${cab('1.5')}${cab('2.5')}${cab('4')}
    <p class="muted small">Длины считаются по реальным расстояниям на плане, с запасом 15 %. Подвиньте комнату на плане, и они изменятся.</p></section>
  <section class="card"><h2>Группы и автоматы</h2><ul class="list">${groups}</ul></section>
  <section class="card"><h2>Щиток</h2>
    <p>Нужно мест (модулей): <b>${R.panel.used}</b>, с запасом 20 %: <b>${R.panel.need}</b>.</p>
    <p>Подойдёт щиток на <b>${R.panel.tooBig ? 'два корпуса по 48' : R.panel.size} модулей</b>.</p>
    <p class="muted small">Считали: автоматы света ${R.panel.light} × 1, дифавтоматы ${R.panel.diff} × 2, ввод ${R.panel.intro}. Нули (N) и заземление (PE) на отдельных шинах, никогда на одной. Клемм на каждой шине не меньше ${R.panel.n}.</p>
    <div class="fld"><label for="c-main">Вводной автомат, А (мощность из договора с поставщиком электроэнергии)</label>
    <select id="c-main">${[16, 20, 25, 32, 40, 50, 63].map(a => `<option value="${a}"${a === R.mainA ? ' selected' : ''}>${a} А</option>`).join('')}</select></div>
    <p>Нагрузка дома: <b>${kw(R.load.demand)} кВт</b> из ${kw(R.load.cap)} кВт, которые тянет автомат. По расчёту хватит ${R.load.needA} А.</p>
    <div class="row"><button data-c="phase" aria-pressed="${R.three}">Три фазы: ${R.three ? 'включено' : 'выключено'}</button></div>
    ${
      R.three
        ? `<p>Нагрузка по фазам: ${R.phases.map((w, i) => `${L[i]} ${kw(w)} кВт`).join(' · ')}</p>
      <p class="muted small">Перекос ${Math.round(R.phaseSkew * 100)} %. Он должен быть небольшим: группы раскладываются по фазам автоматически.</p>`
        : ''
    }</section>
  <section class="card"><h2>Интернет и камеры</h2>
    ${
      net.lines
        ? `<p>Линий UTP cat6: <b>${net.lines}</b> (розеток RJ45: ${net.rj45}, камер: ${net.cameras}). Всего ${m1(net.utp)} м, самая длинная ${m1(net.utpMax)} м из ${UTP_MAX} м.</p>
    ${net.cameras ? `<p>Камеры питаются по кабелю (PoE): нужен PoE-коммутатор на ${net.poePorts} портов.</p>` : ''}`
        : '<p class="muted">Интернет-розеток и камер пока нет.</p>'
    }</section>
  <section class="card"><h2>От щитка до комнат</h2><ul class="list">${R.rooms.map(x => `<li class="item"><span>${esc(x.name)}</span><b>${m1(x.toPanel)} м</b></li>`).join('')}</ul>
    <p class="muted small">Расстояние от щитка до распределительной коробки комнаты (без запаса).</p></section>
  <section class="card"><h2>Как мы считали</h2>${ASSUMPTIONS.map(a => `<p class="muted small">${esc(a)}</p>`).join('')}<p class="muted small">${esc(NORMS_NOTE)}</p></section>`;
  const onChange = e => {
    if (e.target.id !== 'c-main') return;
    const v = +e.target.value;
    ctx.commit(q => {
      q.settings.mainBreakerA = v;
    });
  };
  const onClick = e => {
    if (!e.target.closest('[data-c=phase]')) return;
    ctx.commit(q => {
      q.settings.threePhase = !q.settings.threePhase;
    });
  };
  el.addEventListener('change', onChange);
  el.addEventListener('click', onClick);
  return () => {
    el.removeEventListener('change', onChange);
    el.removeEventListener('click', onClick);
  }; // функция очистки при уходе с экрана
}
