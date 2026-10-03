import { fmt } from './model.js';
import { NORMS_NOTE, controls } from './rules.js';

// Расчёт проводки (раздел 10). Все положения берутся с общего плана в метрах, поэтому
// при перемещении комнаты длины кабеля пересчитываются сами.
// Схема: щиток → распределительная коробка комнаты → точки (звезда от коробки).
// Кабель идёт только по стенам и потолку: по плану манхэттенское расстояние (через двери),
// по вертикали — по высотам. Горизонтальный ход проходит на 20 см ниже потолка.

export const RESERVE = 1.15;        // запас на кабель 15 %
const V = 230, K_LOAD = 0.8;        // нагрузка группы ≤ A × 230 В × 0,8
const DEMAND = 0.5;                 // коэффициент одновременности (не всё включено сразу)
const RUN_BELOW = 0.2;              // ход кабеля ниже потолка, м
const UTP_MAX = 90;                 // предел для UTP cat6, м
const MAIN_A = [16, 20, 25, 32, 40, 50, 63];
const PANEL_SIZES = [8, 12, 18, 24, 36, 48, 72];

const KIND = {                      // вид группы → сечение, автомат, макс. точек, название
  light:   { s: 1.5, a: 10, max: 15, name: 'Свет' },
  socket:  { s: 2.5, a: 16, max: 8,  name: 'Розетки' },
  kitchen: { s: 2.5, a: 16, max: 4,  name: 'Кухня' },
  bath:    { s: 2.5, a: 16, max: 2,  name: 'Ванная' },
  oven:    { s: 4,   a: 25, max: 1,  name: 'Духовка / плита' },
  ac:      { s: 2.5, a: 16, max: 1,  name: 'Кондиционер' }
};
// Ориентировочная мощность одной точки, Вт.
const WATT = { lamp: 10, socket: 250, kitchen: 700, bath: 1200, oven: 3500, ac: 1500, dishwasher: 2000, fridge: 300, hood: 200 };
export const ASSUMPTIONS = [
  'Мощность точек (ориентир): лампа 10 Вт, обычная розетка 250 Вт, над столешницей 700 Вт, посудомойка 2000 Вт, холодильник 300 Вт, вытяжка 200 Вт, ванная 1200 Вт, духовка 3500 Вт, кондиционер 1500 Вт.',
  'От коробки к каждой точке идёт отдельный отрезок кабеля (звезда). К длине добавлено 15 % на запас.',
  'Расчётная нагрузка дома: половина суммы мощностей (не всё включают одновременно).',
  'Интернет и камеры тянутся от щитка, там же стоит роутер и PoE-коммутатор.'
];

const r1 = v => Math.round(v * 10) / 10;
const limitW = a => a * V * K_LOAD;
const wpt = (r, w, u) => w === 0 ? [u, 0] : w === 1 ? [r.w, u] : w === 2 ? [u, r.l] : [0, u];
const gpt = (r, w, u) => { const [a, b] = wpt(r, w, u); return [r.x + a, r.y + b]; };
const P = (r, x, y, z, wall = null) => ({ rid: r.id, h: r.h, x, y, z, wall });                      // точка на общем плане
const itemPt = (r, i) => { if (i.wall == null) return P(r, r.x + i.x, r.y + (i.y || 0), i.z); const [x, y] = gpt(r, i.wall, i.x); return P(r, x, y, i.z, i.wall); };
const man = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

// Маршрут по плану между двумя точками: внутри комнаты напрямик (по Манхэттену), между комнатами через двери.
function makeRouter(p) {
  const doors = [];
  p.rooms.forEach(r => (r.doors || []).forEach(d => {
    if (!p.rooms.some(x => x.id === d.toRoom)) return;
    const [x, y] = gpt(r, d.wall, d.pos + d.width / 2);
    doors.push({ x, y, rooms: [r.id, d.toRoom] });
  }));
  return (a, b) => {
    if (a.rid === b.rid) return { len: man(a, b), ok: true, pts: [a, b] };
    const N = [{ x: a.x, y: a.y, rooms: [a.rid] }, { x: b.x, y: b.y, rooms: [b.rid] }, ...doors];
    const dist = N.map(() => Infinity), done = N.map(() => false), prev = N.map(() => -1); dist[0] = 0;
    for (;;) {
      let u = -1; N.forEach((_, i) => { if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i; });
      if (u < 0 || u === 1) break;
      done[u] = true;
      N.forEach((n, i) => { if (done[i] || !n.rooms.some(q => N[u].rooms.includes(q))) return; const d = dist[u] + man(N[u], n); if (d < dist[i]) { dist[i] = d; prev[i] = u; } });
    }
    if (dist[1] === Infinity) return { len: man(a, b), ok: false, pts: [a, b] };   // нет прохода через двери: считаем напрямик
    const chain = []; for (let k = 1; k !== -1; k = prev[k]) chain.unshift(N[k]);
    return { len: dist[1], ok: true, pts: chain };
  };
}

export function calcProject(p) {
  const rooms = p.rooms || [], st = p.settings || {}, three = !!st.threePhase, mainA = st.mainBreakerA || 40;
  const res = { empty: !rooms.length, warnings: [], groups: [], rooms: [], cable: {}, three, mainA };
  if (res.empty) return res;
  const warn = (level, text, room) => res.warnings.push({ level, text, room });
  const route = makeRouter(p);
  // Трассы для 3D: каждая — ломаная [x, y плана, высота] строго по вертикали и горизонтали. kind: trunk | light | sock | power | net
  const routes = [];
  const leg = (a, b, kind, gid) => {
    const q = route(a, b), zr = Math.min(a.h, b.h) - RUN_BELOW;
    if (kind) {
      const raw = [[a.x, a.y, a.z], [a.x, a.y, zr]]; let cy = a.y;
      q.pts.slice(1).forEach(n => { raw.push([n.x, cy, zr], [n.x, n.y, zr]); cy = n.y; });
      raw.push([b.x, b.y, b.z]);
      const pts = raw.filter((v, i) => !i || v.some((c, k) => Math.abs(c - raw[i - 1][k]) > 1e-6));
      if (pts.length > 1) routes.push({ kind, gid, zr, pts, a: { rid: a.rid, wall: a.wall }, b: { rid: b.rid, wall: b.wall } });
    }
    return Math.abs(zr - a.z) + q.len + Math.abs(zr - b.z);
  };

  // Щиток: настоящий, иначе условно у входной двери
  let panel = null;
  for (const r of rooms) { const i = (r.items || []).find(x => x.type === 'panel'); if (i) { panel = itemPt(r, i); break; } }
  if (!panel) {
    const e = p.entrance && rooms.find(r => r.id === p.entrance.roomId);
    if (e) { const [x, y] = gpt(e, p.entrance.wall, p.entrance.pos + p.entrance.width / 2); panel = P(e, x, y, 1.5); }
    else panel = P(rooms[0], rooms[0].x, rooms[0].y, 1.5);
    warn('error', 'Нет щитка. Длины посчитаны условно от входной двери. Поставьте щиток у входа, и расчёт станет точным.');
    res.panelAssumed = true;
  }

  // Распределительная коробка каждой комнаты (может стоять и в соседней комнате, например у ванной)
  const hubs = {};
  rooms.forEach(r => {
    const bx = rooms.flatMap(x => (x.items || []).filter(i => i.type === 'box' && (i.ctl || x.id) === r.id).map(i => ({ x, i })));
    if (bx.length) { const b = bx.find(q => q.x.id === r.id) || bx[0]; hubs[r.id] = { ...itemPt(b.x, b.i), assumed: false }; return; }
    const sw = controls(p, r)[0], host = sw && rooms.find(x => (x.items || []).includes(sw));
    hubs[r.id] = host ? { ...itemPt(host, sw), z: host.h - 0.25, assumed: true } : { ...P(r, r.x + r.w / 2, r.y + r.l / 2, r.h - 0.25), assumed: true };
  });

  // Порядок комнат: от ближних к щитку к дальним
  const toPanel = {}; rooms.forEach(r => { toPanel[r.id] = leg(panel, hubs[r.id]); });
  const order = [...rooms].sort((a, b) => toPanel[a.id] - toPanel[b.id]);
  const rank = Object.fromEntries(order.map((r, i) => [r.id, i]));

  // Точки: свет и розетки по видам
  const pts = { light: [], socket: [], kitchen: [], bath: [], oven: [], ac: [] };
  rooms.forEach(r => (r.items || []).forEach(i => {
    if (i.type === 'lamp') pts.light.push({ r, i, pt: itemPt(r, i), w: WATT.lamp });
    else if (i.type === 'socket') {
      const role = i.role || 'normal';
      const k = role === 'oven' ? 'oven' : role === 'ac' ? 'ac' : (role === 'bath' || r.type === 'bath') ? 'bath' : (role === 'kitchen' || r.type === 'kitchen') ? 'kitchen' : 'socket';
      const w = k === 'kitchen' ? (WATT[i.app] || WATT.kitchen) : WATT[k];
      pts[k].push({ r, i, pt: itemPt(r, i), w });
    }
  }));
  Object.values(pts).forEach(a => a.sort((x, y) => rank[x.r.id] - rank[y.r.id]));

  // Раскладка по группам
  const bundles = [];
  for (const k of Object.keys(KIND)) {
    const list = pts[k], lim = limitW(KIND[k].a), max = KIND[k].max, out = [];
    if (k === 'kitchen' || k === 'bath') {            // плотная упаковка: сначала мощные
      [...list].sort((x, y) => y.w - x.w).forEach(q => {
        const g = out.find(g => g.pts.length < max && g.power + q.w <= lim);
        if (g) { g.pts.push(q); g.power += q.w; } else out.push({ pts: [q], power: q.w });
      });
    } else {                                          // по порядку комнат, чтобы группа была компактной
      let cur = null;
      list.forEach(q => {
        if (!cur || cur.pts.length >= max || (cur.power + q.w > lim && cur.pts.length)) { cur = { pts: [], power: 0 }; out.push(cur); }
        cur.pts.push(q); cur.power += q.w;
      });
    }
    out.forEach(g => bundles.push({ kind: k, ...g }));
  }

  // Длина кабеля и описание каждой группы
  const count = {}, lightOf = {};
  bundles.forEach(b => {
    const K = KIND[b.kind]; count[b.kind] = (count[b.kind] || 0) + 1;
    const rIds = [...new Set(b.pts.map(q => q.r.id))].sort((x, y) => rank[x] - rank[y]);
    const named = rIds.map(id => rooms.find(r => r.id === id));
    let len = 0; const gi = bundles.indexOf(b), pk = b.kind === 'light' ? 'light' : (b.kind === 'oven' || b.kind === 'ac') ? 'power' : 'sock';
    if (b.kind === 'oven' || b.kind === 'ac') len = leg(panel, b.pts[0].pt, pk, gi);     // отдельная линия прямо к точке
    else {
      let prev = panel;
      named.forEach(r => { len += leg(prev, hubs[r.id], 'trunk', gi); prev = hubs[r.id]; });             // щиток → коробки по цепочке
      b.pts.forEach(q => { len += leg(hubs[q.r.id], q.pt, pk, gi); });                            // коробка → точка
    }
    const several = bundles.filter(x => x.kind === b.kind).length > 1;
    const name = b.kind === 'oven' || b.kind === 'ac' ? `${K.name} (${b.pts[0].r.name})` : several ? `${K.name} ${count[b.kind]}` : K.name;
    Object.assign(b, { id: b.kind + count[b.kind], name, section: K.s, breaker: K.a, modules: b.kind === 'light' ? 1 : 2,
      device: b.kind === 'light' ? 'автомат' : 'дифавтомат 30 мА', limitW: limitW(K.a), rooms: named.map(r => r.name), roomIds: rIds, len });
    if (b.kind === 'light') rIds.forEach(id => { if (!lightOf[id]) lightOf[id] = b; });
    if (b.power > b.limitW) { b.overload = true; warn('error', `Группа «${b.name}» перегружена: ${Math.round(b.power)} Вт при допустимых ${Math.round(b.limitW)} Вт. Разделите нагрузку или уберите мощный прибор.`, b.roomIds[0]); }
  });
  // Выключатели: кабель от коробки до выключателя входит в световую группу комнаты
  rooms.forEach(r => controls(p, r).forEach(sw => {
    const g = lightOf[r.id], host = rooms.find(x => (x.items || []).includes(sw)); if (!g || !host) return;
    g.len += leg(hubs[r.id], itemPt(host, sw), 'light', bundles.indexOf(g));
  }));
  bundles.forEach(b => { b.lenR = b.len * RESERVE; });

  // Фазы (опция «Три фазы»): нагрузка распределяется поровну, самые мощные группы первыми
  const phases = [0, 0, 0];
  if (three) [...bundles].sort((a, b) => b.power - a.power).forEach(b => { let m = 0; for (let k = 1; k < 3; k++) if (phases[k] < phases[m]) m = k; b.phase = m; phases[m] += b.power; });
  else bundles.forEach(b => { b.phase = null; phases[0] += b.power; });
  if (three) { const mx = Math.max(...phases), mn = Math.min(...phases); res.phaseSkew = mx ? (mx - mn) / mx : 0; }
  res.phases = three ? phases : null;

  // Интернет и камеры: UTP от щитка, длина с запасом ≤ 90 м, камеры по PoE
  const net = []; rooms.forEach(r => (r.items || []).forEach(i => { if (i.type === 'rj45' || i.type === 'camera') net.push({ r, i, pt: itemPt(r, i) }); }));
  let utp = 0, utpMax = 0, utpN = 0;
  net.forEach(q => {
    const l = leg(panel, q.pt, 'net', 100 + utpN++) * RESERVE; utp += l; utpMax = Math.max(utpMax, l);
    if (l > UTP_MAX) warn('error', `Кабель до интернет-точки в комнате «${q.r.name}» ${r1(l)} м, это больше ${UTP_MAX} м. Придвиньте точку к щитку или добавьте коммутатор поближе.`, q.r.id);
  });
  const cams = net.filter(q => q.i.type === 'camera').length, lines = net.length;
  res.net = { lines, cameras: cams, rj45: lines - cams, utp, utpMax, poePorts: cams ? [4, 8, 16, 24].find(n => n >= cams) || 24 : 0 };

  // Щиток
  const light = bundles.filter(b => b.kind === 'light').length, diff = bundles.length - light, intro = three ? 3 : 2;
  const used = light + diff * 2 + intro, need = Math.ceil(used * 1.2 - 1e-9), size = PANEL_SIZES.find(n => n >= need) || 72;
  res.panel = { light, diff, intro, used, need, size, tooBig: need > 72, n: bundles.length + 1 };   // n: клемм на шинах N и PE (по числу групп + запас)

  // Нагрузка и вводной автомат
  const total = bundles.reduce((s, b) => s + b.power, 0), demand = total * DEMAND, cap = limitW(mainA) * (three ? 3 : 1);
  const need2 = MAIN_A.find(a => limitW(a) * (three ? 3 : 1) >= demand) || 63;
  res.load = { total, demand, cap, needA: need2 };
  if (demand > cap) warn('error', `Вводной автомат ${mainA} А мал: расчётная нагрузка ${fmt(r1(demand / 1000))} кВт, а он тянет ${fmt(r1(cap / 1000))} кВт. По расчёту нужен около ${need2} А, но мощность разрешает поставщик электроэнергии: уточните её в договоре.`);

  // Предупреждения расчёта
  const reach = new Set([panel.rid]);   // какие комнаты достижимы от щитка через двери
  for (let again = true; again;) { again = false; rooms.forEach(r => (r.doors || []).forEach(d => {
    if (rooms.some(x => x.id === d.toRoom) && reach.has(r.id) !== reach.has(d.toRoom)) { reach.add(r.id); reach.add(d.toRoom); again = true; } })); }
  rooms.filter(r => !reach.has(r.id)).forEach(r => warn('error', `Комната «${r.name}» не соединена дверью с комнатой, где стоит щиток. Кабель посчитан напрямик. Добавьте дверь на плане.`, r.id));
  rooms.forEach(r => {
    const needHub = (r.items || []).some(i => i.type === 'lamp' || i.type === 'socket') || controls(p, r).length;
    if (needHub && hubs[r.id].assumed) warn('tip', `В комнате «${r.name}» нет распределительной коробки. Длина посчитана до выключателя или центра комнаты. Поставьте коробку у потолка.`, r.id);
  });

  // Итоги по сечениям и материалы
  const sec = { '1.5': 0, '2.5': 0, '4': 0 };
  bundles.forEach(b => { sec[String(b.section)] += b.len; });
  Object.keys(sec).forEach(k => { res.cable[k] = { raw: sec[k], total: sec[k] * RESERVE }; });
  res.cable.utp = { raw: utp / RESERVE, total: utp };
  res.groups = bundles; res.routes = routes;
  res.rooms = rooms.map(r => ({ id: r.id, name: r.name, toPanel: toPanel[r.id], hubAssumed: hubs[r.id].assumed, groups: bundles.filter(b => b.roomIds.includes(r.id)).length }));
  res.groupsByRoom = Object.fromEntries(res.rooms.map(x => [x.id, x.groups]));
  const cnt = t => rooms.reduce((s, r) => s + (r.items || []).filter(i => i.type === t).length, 0);
  res.counts = { socket: cnt('socket'), switch: cnt('switch'), lamp: cnt('lamp'), box: cnt('box'), panel: cnt('panel'), rj45: cnt('rj45'), camera: cnt('camera'),
    mountBoxes: cnt('socket') + cnt('switch') + cnt('rj45'), lightBreakers: light, diff16: bundles.filter(b => b.kind !== 'light' && b.breaker === 16).length, diff25: bundles.filter(b => b.breaker === 25).length,
    mainA, panelModules: res.panel.size, connectors: lines + cams, poePorts: res.net.poePorts };
  res.totalCable = res.cable['1.5'].total + res.cable['2.5'].total + res.cable['4'].total;
  return res;
}

/* ---------- экран «Расчёт проводки» ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const m1 = v => fmt(r1(v).toFixed(1)), kw = w => fmt((w / 1000).toFixed(1));
const sect = s => `3×${fmt(s)} мм²`;

export function mount(el, ctx) {
  const p = ctx.state.project, R = calcProject(p);
  if (R.empty) { el.innerHTML = '<p class="muted">Сначала добавьте комнаты и расставьте электрику: тогда здесь появится расчёт.</p>'; return () => {}; }
  const st = p.settings, L = ['L1', 'L2', 'L3'];
  const groups = R.groups.length ? R.groups.map(g => `<li class="item"><span><b>${esc(g.name)}</b>
      <small>${esc(g.rooms.join(', '))} · точек: ${g.pts.length}</small>
      <small${g.overload ? ' style="color:var(--red)"' : ''}>Нагрузка ${fmt(Math.round(g.power))} Вт из ${fmt(Math.round(g.limitW))} Вт</small>
      <small>${g.device === 'автомат' ? 'Автомат' : 'Дифавтомат 30 мА (защита от удара током)'} ${g.breaker} А · кабель ${sect(g.section)} · ${m1(g.lenR)} м${g.phase != null ? ' · фаза ' + L[g.phase] : ''}</small></span></li>`).join('')
    : '<li class="muted">Групп пока нет: расставьте розетки и лампы.</li>';
  const cab = k => R.cable[k].total ? `<p>Кабель ${sect(+k)}: <b>${m1(R.cable[k].total)} м</b></p>` : '';
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
    ${R.three ? `<p>Нагрузка по фазам: ${R.phases.map((w, i) => `${L[i]} ${kw(w)} кВт`).join(' · ')}</p>
      <p class="muted small">Перекос ${Math.round(R.phaseSkew * 100)} %. Он должен быть небольшим: группы раскладываются по фазам автоматически.</p>` : ''}</section>
  <section class="card"><h2>Интернет и камеры</h2>
    ${net.lines ? `<p>Линий UTP cat6: <b>${net.lines}</b> (розеток RJ45: ${net.rj45}, камер: ${net.cameras}). Всего ${m1(net.utp)} м, самая длинная ${m1(net.utpMax)} м из ${UTP_MAX} м.</p>
    ${net.cameras ? `<p>Камеры питаются по кабелю (PoE): нужен PoE-коммутатор на ${net.poePorts} портов.</p>` : ''}`
      : '<p class="muted">Интернет-розеток и камер пока нет.</p>'}</section>
  <section class="card"><h2>От щитка до комнат</h2><ul class="list">${R.rooms.map(x => `<li class="item"><span>${esc(x.name)}</span><b>${m1(x.toPanel)} м</b></li>`).join('')}</ul>
    <p class="muted small">Расстояние от щитка до распределительной коробки комнаты (без запаса).</p></section>
  <section class="card"><h2>Как мы считали</h2>${ASSUMPTIONS.map(a => `<p class="muted small">${esc(a)}</p>`).join('')}<p class="muted small">${esc(NORMS_NOTE)}</p></section>`;
  const onChange = e => { if (e.target.id !== 'c-main') return; const v = +e.target.value; ctx.commit(q => { q.settings.mainBreakerA = v; }); };
  const onClick = e => { if (!e.target.closest('[data-c=phase]')) return; ctx.commit(q => { q.settings.threePhase = !q.settings.threePhase; }); };
  el.addEventListener('change', onChange); el.addEventListener('click', onClick);
  return () => { el.removeEventListener('change', onChange); el.removeEventListener('click', onClick); };   // функция очистки при уходе с экрана
}
