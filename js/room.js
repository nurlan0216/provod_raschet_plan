import { fmt, area, uid, ROOM_TYPES } from './model.js';
import { NORMS_NOTE, autoPlaceRoom, checkRoom, controls, openingsOf } from './rules.js';
// Редактор комнаты. Элемент: {id, type, role, x, y, z, wall}.
// Настенный: wall 0–3, x — расстояние от угла стены (слева/сверху), y=0, z — высота от пола.
// Потолочный (лампа): wall=null, x/y — от левого верхнего угла комнаты, z=высота потолка.
const WALLS = ['Верхняя', 'Правая', 'Нижняя', 'Левая'];
const ROLES = { normal: 'Обычная', kitchen: 'Кухня', oven: 'Духовка / плита', ac: 'Кондиционер', bath: 'Ванная' };
const TOOLS = [['socket', 'Розетка'], ['switch', 'Выключатель'], ['lamp', 'Лампа'], ['box', 'Коробка'], ['panel', 'Щиток'], ['rj45', 'Интернет'], ['camera', 'Камера']];
const COL = { socket: '#2B7DE9', switch: '#1B2530', lamp: '#F2B705', box: '#E8830C', panel: '#C93A2B', rj45: '#0E9F9D', camera: '#0E9F9D' };
const NOTE = 'Нормы ориентировочные: проверьте действующие нормы вашей страны.';
const RECS = {
  bedroom: 'Розеток: 1 на каждые 4 м периметра, не меньше 3, на высоте 30 см и не ближе 10 см к косяку. Выключатель на 90 см у двери со стороны ручки. Свет: 150 лк, тёплый (2700 К), бра у кровати.',
  living: 'Розеток: 1 на каждые 4 м периметра, не меньше 3, на высоте 30 см. Выключатель на 90 см у двери. Свет: 150 лк.',
  kitchen: 'Розеток не меньше 6–8: 4 над столешницей на 105–115 см (не ближе 60 см к мойке и 50 см к плите) и техника. Посудомойка 10–15 см, холодильник до 30 см, вытяжка около 2 м. Отдельная линия для духовки или плиты. Свет: 200 лк и подсветка столешницы.',
  bath: 'Розетки не ниже 60 см (лучше 130 см), не ближе 60 см к воде, влагозащита IP44, только через дифавтомат 30 мА. Выключатель лучше снаружи. Свет: 200 лк, IP44/IP65.',
  hall: 'Розеток 1–2. Щиток на высоте около 1,5 м у входной двери. Выключатель у двери. Свет: 100 лк.',
  office: 'Розеток: 1 на каждые 3 м периметра. Интернет-розетка не ближе 20 см к силовой. Свет: 300 лк, 4000 К.'
};
const recOf = t => (RECS[t] || 'Минимум: розетка, выключатель и лампа.') + ' ' + NOTE;
const r2 = v => Math.round(v * 100) / 100, snap = v => Math.round(v * 20) / 20, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wl = (r, w) => (w % 2 ? r.l : r.w);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const defZ = (t, r) => ({ socket: 0.3, switch: 0.9, box: r.h - 0.25, panel: 1.5, rj45: 0.3, camera: Math.min(2.6, r.h - 0.2), lamp: r.h }[t]);
const wp = (r, w, u) => w === 0 ? [u, 0] : w === 1 ? [r.w, u] : w === 2 ? [u, r.l] : [0, u];

function icon(t, x, y, k = 9, sel = false) {
  const c = COL[t], st = 'stroke="var(--card)" stroke-width="1.8"'; let s = '';
  if (sel) s += `<circle cx="${x}" cy="${y}" r="${k + 7}" fill="none" stroke="var(--accent)" stroke-width="3"/>`;
  if (t === 'socket' || t === 'lamp' || t === 'rj45') s += `<circle cx="${x}" cy="${y}" r="${k}" fill="${c}" ${st}/>` + (t === 'lamp' ? `<circle cx="${x}" cy="${y}" r="${k * 0.45}" fill="#fff" opacity=".9"/>` : '');
  else if (t === 'camera') s += `<polygon points="${x},${y - k - 1} ${x + k + 1},${y + k} ${x - k - 1},${y + k}" fill="${c}" ${st}/>`;
  else { const q = t === 'panel' ? k * 1.25 : k * 0.9; s += `<rect x="${x - q}" y="${y - q}" width="${q * 2}" height="${q * 2}" fill="${c}" ${st}/>`; }
  return s;
}
let tool = null, vw = 'top', sel = null;
const HINT = { null: 'Выберите, что поставить, или нажмите на значок, чтобы изменить его.', lamp: 'Лампы ставятся на потолок: нажмите в нужное место комнаты в виде «Сверху».' };

export function mount(el, ctx) {
  const S = ctx.state, C = fn => ctx.commit(fn, true), R = () => S.project.rooms.find(x => x.id === S.editRoom), $ = s => el.querySelector(s);
  const back = S.step === 2 ? '← К плану' : S.step === 3 ? '← К модели' : '← Назад';
  el.innerHTML = `<div class="tools"><button data-r="close">${back}</button></div><p class="muted small" id="rs"></p>
    <div class="tools"><button data-r="view" data-v="top">Сверху</button><button data-r="view" data-v="unroll">Развёртка стен</button><button data-r="view" data-v="iso">3D</button></div>
    <div class="tools">${TOOLS.map(([t, n]) => `<button data-r="tool" data-v="${t}"><svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">${icon(t, 11, 11, 7)}</svg> ${n}</button>`).join('')}</div>
    <p class="muted small" id="rh"></p><div class="canvas" id="rc"><svg></svg></div><div class="card" id="rp"></div>
    <div class="row"><button class="primary" data-r="auto">Расставить по правилам</button></div>
    <p class="muted small">${esc(NORMS_NOTE)}</p><div class="card" id="rr" hidden></div>
    <details class="card"><summary><b>Рекомендации для этой комнаты</b></summary><p>${esc(ROOM_TYPES[R().type])}: ${esc(recOf(R().type))}</p></details>`;
  const box = $('#rc'), svg = box.querySelector('svg'); let hits = [], G = {}, drag = null, ovr = null;

  function draw() {
    const r = R(), p = S.project, W = box.clientWidth || 340, ops = openingsOf(p, r); hits = []; let h = '', Hh;
    const items = r.items.map(i => ovr && ovr.id === i.id ? { ...i, ...ovr } : i), pos = [];
    if (vw === 'unroll') {
      const s = Math.min(90, 260 / r.h), gap = 0.25, lens = [r.w, r.l, r.w, r.l], y0 = 26, fl = y0 + r.h * s, ux = []; let u = 12;
      lens.forEach((L, i) => { ux[i] = u; u += (L + gap) * s; }); G = { s, gap, ux, lens, fl }; Hh = fl + 24;
      box.style.cssText = `height:${Hh}px;min-height:0;overflow-x:auto;overflow-y:hidden`; svg.style.cssText = `width:${u + 4}px;height:${Hh}px;touch-action:pan-x pan-y`;
      lens.forEach((L, i) => { h += `<rect x="${ux[i]}" y="${y0}" width="${L * s}" height="${r.h * s}" fill="${r.wall}" stroke="var(--text)" stroke-width="2"/><text x="${ux[i]}" y="${y0 - 8}" font-size="13" font-weight="700" fill="currentColor">${WALLS[i]} · ${fmt(L)} м</text>`;
        [0.3, 0.9].forEach(z => { h += `<line x1="${ux[i]}" x2="${ux[i] + L * s}" y1="${fl - z * s}" y2="${fl - z * s}" stroke="#8a8f98" stroke-dasharray="4 4" opacity=".6"/>`; if (i === 0) h += `<text x="${ux[i] + 3}" y="${fl - z * s - 3}" font-size="11" fill="#566270">${z * 100} см</text>`; }); });
      ops.forEach(o => { const x = ux[o.wall] + o.pos * s, y1 = o.k === 'win' ? fl - (o.sill + o.height) * s : fl - 2.1 * s, y2 = o.k === 'win' ? fl - o.sill * s : fl;
        h += `<rect x="${x}" y="${y1}" width="${o.width * s}" height="${y2 - y1}" fill="${o.k === 'win' ? 'rgba(43,125,233,.25)' : 'rgba(0,0,0,.08)'}" stroke="${o.k === 'win' ? '#2B7DE9' : '#566270'}" stroke-width="2"/>`; });
      items.forEach(i => { if (i.wall == null) return; const x = ux[i.wall] + i.x * s, y = fl - i.z * s; pos.push([i, x, y]); });
    } else if (vw === 'iso') {
      const P3 = (X, Y, Z) => [(X - Z) * 0.866, (X + Z) * 0.5 - Y], pts = [[0, 0, 0], [r.w, 0, 0], [r.w, 0, r.l], [0, 0, r.l], [0, r.h, 0], [r.w, r.h, 0], [0, r.h, r.l]].map(q => P3(...q));
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]), bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys), H0 = Math.min(innerHeight * 0.6, 460), s = Math.min((W - 40) / bw, (H0 - 40) / bh);
      const ox = (W - bw * s) / 2 - Math.min(...xs) * s, oy = (H0 - bh * s) / 2 - Math.min(...ys) * s, Q = (X, Y, Z) => { const q = P3(X, Y, Z); return [q[0] * s + ox, q[1] * s + oy]; };
      const poly = (a, f) => `<polygon points="${a.map(q => Q(...q).join(',')).join(' ')}" fill="${f}" stroke="var(--text)" stroke-width="2" fill-opacity=".92"/>`;
      Hh = H0; box.style.cssText = `height:${H0}px;overflow:hidden`; svg.style.cssText = 'width:100%;height:100%';
      h += poly([[0, 0, 0], [r.w, 0, 0], [r.w, 0, r.l], [0, 0, r.l]], r.floor) + poly([[0, 0, 0], [r.w, 0, 0], [r.w, r.h, 0], [0, r.h, 0]], r.wall) + poly([[0, 0, 0], [0, 0, r.l], [0, r.h, r.l], [0, r.h, 0]], r.wall);
      items.forEach(i => { const [X, Y, Z] = i.wall == null ? [i.x, r.h, i.y] : i.wall === 0 ? [i.x, i.z, 0] : i.wall === 1 ? [r.w, i.z, i.x] : i.wall === 2 ? [i.x, i.z, r.l] : [0, i.z, i.x]; const q = Q(X, Y, Z); pos.push([i, q[0], q[1]]); });
      h += `<text x="10" y="20" font-size="13" fill="currentColor">Этот вид только для просмотра</text>`;
    } else {
      const H0 = Math.min(innerHeight * 0.6, 460), s = Math.min((W - 70) / r.w, (H0 - 70) / r.l), ox = (W - r.w * s) / 2, oy = (H0 - r.l * s) / 2; G = { ox, oy, s };
      Hh = H0; box.style.cssText = `height:${H0}px;overflow:hidden`; svg.style.cssText = 'width:100%;height:100%;touch-action:none';
      const L = (w, u) => { const [x, y] = wp(r, w, u); return [ox + x * s, oy + y * s]; };
      h += `<rect x="${ox}" y="${oy}" width="${r.w * s}" height="${r.l * s}" fill="${r.floor}" fill-opacity=".9" stroke="var(--text)" stroke-width="6"/>`;
      (r.fixtures || []).forEach(f => { const fx = ox + f.x0 * s, fy = oy + f.y0 * s, fw = (f.x1 - f.x0) * s, fh = (f.y1 - f.y0) * s;
        h += `<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="rgba(120,140,160,.22)" stroke="#566270" stroke-width="2" stroke-dasharray="4 3"/><text x="${fx + fw / 2}" y="${fy + fh / 2 + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor" stroke="var(--card)" stroke-width="3" paint-order="stroke">${esc(f.label)}</text>`; });
      ops.forEach(o => { const [x1, y1] = L(o.wall, o.pos), [x2, y2] = L(o.wall, o.pos + o.width); h += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--card)" stroke-width="9"/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.k === 'win' ? '#2B7DE9' : '#566270'}" stroke-width="${o.k === 'win' ? 4 : 2}" ${o.k === 'door' ? 'stroke-dasharray="5 4"' : ''}/>`; });
      h += `<text x="${ox + r.w * s / 2}" y="${oy - 12}" text-anchor="middle" font-size="13" fill="currentColor">${fmt(r.w)} м</text><text transform="rotate(-90 ${ox - 12} ${oy + r.l * s / 2})" x="${ox - 12}" y="${oy + r.l * s / 2}" text-anchor="middle" font-size="13" fill="currentColor">${fmt(r.l)} м</text>`;
      items.forEach(i => { const [x, y] = i.wall == null ? [ox + i.x * s, oy + i.y * s] : L(i.wall, i.x); pos.push([i, x, y]); });
    }
    pos.forEach(([i, x, y]) => { h += icon(i.type, x, y, i.type === 'panel' ? 9 : 10, i.id === sel); hits.push({ id: i.id, x, y }); });
    svg.innerHTML = h; void Hh;
  }
  function ui() {
    const r = R(); $('#rs').textContent = `${ROOM_TYPES[r.type]} · ${fmt(r.l)} × ${fmt(r.w)} м · ${fmt(area(r))} м². Розеток: ${r.items.filter(i => i.type === 'socket').length} · выключателей: ${controls(S.project, r).length} · ламп: ${r.items.filter(i => i.type === 'lamp').length}`;
    el.querySelectorAll('[data-r=view]').forEach(b => b.classList.toggle('on', b.dataset.v === vw));
    el.querySelectorAll('[data-r=tool]').forEach(b => b.classList.toggle('on', b.dataset.v === tool));
    $('#rh').textContent = tool ? (tool === 'lamp' ? HINT.lamp : `Нажмите на стену или внутри комнаты: появится «${TOOLS.find(t => t[0] === tool)[1].toLowerCase()}». Нажмите на кнопку ещё раз, чтобы закончить.`) : HINT.null;
    const it = r.items.find(i => i.id === sel); if (!it) sel = null;
    const f = (k, lb, v) => `<div><label for="rf-${k}">${lb}</label><input id="rf-${k}" type="number" inputmode="decimal" step="0.05" data-rf="${k}" value="${v}"></div>`;
    $('#rp').innerHTML = !it ? '<p class="muted small">Нажмите на значок в комнате, чтобы изменить его высоту, назначение или удалить.</p>' :
      `<b>${TOOLS.find(t => t[0] === it.type)[1]}</b><div class="pf">
        ${it.type === 'socket' ? `<div><label for="rf-role">Назначение</label><select id="rf-role" data-rf="role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}"${k === it.role ? ' selected' : ''}>${v}</option>`).join('')}</select></div>` : ''}
        ${it.wall == null ? f('x', 'От левой стены, м', it.x) + f('y', 'От верхней стены, м', it.y)
          : `<div><label for="rf-wall">Стена</label><select id="rf-wall" data-rf="wall">${WALLS.map((n, k) => `<option value="${k}"${k === it.wall ? ' selected' : ''}>${n}</option>`).join('')}</select></div>${f('x', 'От угла стены, м', it.x)}${f('z', 'Высота от пола, м', it.z)}`}
      </div><div class="row"><button class="danger" data-r="del">Удалить</button></div>`;
  }
  function locate(q, type) {
    const r = R();
    if (vw === 'top') { const x = (q.x - G.ox) / G.s, y = (q.y - G.oy) / G.s; if (x < -0.5 || y < -0.5 || x > r.w + 0.5 || y > r.l + 0.5) return null;
      if (type === 'lamp') return { wall: null, x: snap(clamp(x, 0.1, r.w - 0.1)), y: snap(clamp(y, 0.1, r.l - 0.1)) };
      const d = [y, r.w - x, r.l - y, x], w = d.indexOf(Math.min(...d)); return { wall: w, x: snap(clamp(w % 2 ? y : x, 0, wl(r, w))), y: 0 }; }
    if (type === 'lamp') return 'lamp';
    let i = 0; while (i < 3 && q.x > G.ux[i] + (G.lens[i] + G.gap / 2) * G.s) i++;
    return { wall: i, x: snap(clamp((q.x - G.ux[i]) / G.s, 0, G.lens[i])), y: 0, z: clamp(snap((G.fl - q.y) / G.s), 0.05, r.h - 0.05) };
  }
  const rel = e => { const b = svg.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  const hitAt = q => { let b = null, bd = 20; hits.forEach(t => { const d = Math.hypot(t.x - q.x, t.y - q.y); if (d < bd) { bd = d; b = t.id; } }); return b; };
  svg.addEventListener('pointerdown', e => { const q = rel(e), id = hitAt(q); drag = { q0: q, id, moved: false }; if (id && vw === 'top') svg.setPointerCapture(e.pointerId); });
  svg.addEventListener('pointermove', e => {
    if (!drag || !drag.id || vw !== 'top') return; const q = rel(e); if (!drag.moved && Math.hypot(q.x - drag.q0.x, q.y - drag.q0.y) < 6) return;
    drag.moved = true; const it = R().items.find(i => i.id === drag.id), loc = it && locate(q, it.type); if (loc && loc !== 'lamp') { ovr = { id: it.id, ...loc }; sel = it.id; draw(); }
  });
  svg.addEventListener('pointerup', () => {
    const d = drag; drag = null; if (!d) return;
    if (d.moved) { const o = ovr; ovr = null; if (o) { const it = R().items.find(i => i.id === o.id); C(() => { it.wall = o.wall; it.x = o.x; it.y = o.y; }); } draw(); ui(); return; }
    if (d.id) { sel = d.id; draw(); ui(); return; }
    if (!tool) { sel = null; draw(); ui(); return; }
    if (vw === 'iso') return ctx.toast('В этом виде можно только смотреть. Ставьте элементы в видах «Сверху» и «Развёртка стен».');
    const loc = locate(d.q0, tool), r = R();
    if (loc === 'lamp') return ctx.toast('Лампы ставятся на потолок: переключитесь на вид «Сверху».');
    if (!loc) return ctx.toast('Нажмите внутри комнаты или на её стене.');
    const it = { id: uid(), type: tool, ...(tool === 'socket' ? { role: 'normal' } : {}), wall: loc.wall, x: loc.x, y: loc.y, z: loc.z ?? defZ(tool, r) };
    C(() => r.items.push(it)); sel = it.id; draw(); ui();
  });
  svg.addEventListener('pointercancel', () => { drag = null; ovr = null; });
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-r]'); if (!b) return; const a = b.dataset.r, r = R();
    if (a === 'close') ctx.closeRoom();
    else if (a === 'view') { vw = b.dataset.v; draw(); ui(); }
    else if (a === 'tool') { tool = tool === b.dataset.v ? null : b.dataset.v; ui(); }
    else if (a === 'auto') {
      if (r.items.length && !await ctx.confirmBox('В комнате уже есть элементы. Расставить заново? Старые заменятся новыми (это можно отменить кнопкой «Отменить»).', 'Да, расставить заново')) return;
      let rep, bad; C(() => { rep = autoPlaceRoom(S.project, r); bad = checkRoom(S.project, r); }); sel = null; draw(); ui(); report(rep, bad);
    }
    else if (a === 'del') { if (await ctx.confirmBox('Удалить этот элемент?')) { C(() => { r.items = r.items.filter(i => i.id !== sel); }); sel = null; draw(); ui(); } }
  });
  el.addEventListener('change', e => {
    const t = e.target, f = t.dataset.rf, r = R(), it = f && r.items.find(i => i.id === sel); if (!it) return;
    if (f === 'role') { C(() => { it.role = t.value; }); return; }
    if (f === 'wall') { const w = +t.value; C(() => { it.wall = w; it.x = Math.min(it.x, wl(r, w)); }); draw(); ui(); return; }
    const v = parseFloat(String(t.value).replace(',', '.')), rng = { x: [0, it.wall == null ? r.w : wl(r, it.wall), 'Расстояние от стены'], y: [0, r.l, 'Расстояние от стены'], z: [0.05, r.h - 0.05, 'Высота'] }[f];
    if (!(v >= rng[0] && v <= rng[1])) { ctx.toast(`${rng[2]}: введите число от ${fmt(r2(rng[0]))} до ${fmt(r2(rng[1]))} м.`); t.value = it[f]; return; }
    C(() => { it[f] = r2(v); }); draw(); ui();
  });
  function report(rep, bad) {
    const n = rep.n, box = $('#rr'), li = a => a.map(t => `<li>${esc(t)}</li>`).join('');
    box.hidden = false;
    box.innerHTML = `<b>Готово.</b> Розеток: ${n.socket} · ламп: ${n.lamp} · выключателей: ${n.switch} · коробок: ${n.box}${n.panel ? ' · щиток: ' + n.panel : ''}${n.rj45 ? ' · интернет: ' + n.rj45 : ''}.
      ${bad.length ? `<p><b>Что проверить:</b></p><ul>${li(bad.map(x => x.text))}</ul>` : '<p style="color:var(--green-d)"><b>Замечаний по нормам нет.</b></p>'}
      ${rep.tips.length ? `<p><b>Что сделано автоматически:</b></p><ul>${li(rep.tips)}</ul>` : ''}`;
  }
  draw(); ui();
  return () => {};
}
