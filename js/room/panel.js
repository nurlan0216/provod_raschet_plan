import { fmt, area, ROOM_TYPES } from '../model.js';
import { NORMS_NOTE, controls } from '../rules.js';
import { esc } from '../util.js';
import { WALLS, ROLES, TOOLS, HINT, icon, recOf } from './consts.js';

// HTML-фрагменты редактора комнаты (без состояния и обработчиков).

export function shellHtml(back, type) {
  const views = `<button data-r="view" data-v="top">Сверху</button><button data-r="view" data-v="unroll">Развёртка стен</button><button data-r="view" data-v="iso">3D</button>`;
  const tools = TOOLS.map(
    ([t, n]) =>
      `<button data-r="tool" data-v="${t}"><svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">${icon(t, 11, 11, 7)}</svg> ${n}</button>`,
  ).join('');
  return `<div class="tools"><button data-r="close">${back}</button></div><p class="muted small" id="rs"></p>
    <div class="tools" role="group" aria-label="Вид комнаты">${views}</div>
    <div class="tools" role="group" aria-label="Что ставить">${tools}</div>
    <p class="muted small" id="rh"></p><div class="canvas" id="rc"><svg></svg></div><div class="fld"><label for="r-pick">Элемент в комнате</label><select id="r-pick"></select></div><div class="card" id="rp"></div>
    <div class="row"><button class="primary" data-r="auto">Расставить по правилам</button></div>
    <p class="muted small">${esc(NORMS_NOTE)}</p><div class="card" id="rr" hidden></div>
    <details class="card"><summary><b>Рекомендации для этой комнаты</b></summary><p>${esc(ROOM_TYPES[type])}: ${esc(recOf(type))}</p></details>`;
}

export function statsText(p, r) {
  const count = t => r.items.filter(i => i.type === t).length;
  return `${ROOM_TYPES[r.type]} · ${fmt(r.l)} × ${fmt(r.w)} м · ${fmt(area(r))} м². Розеток: ${count('socket')} · выключателей: ${controls(p, r).length} · ламп: ${count('lamp')}`;
}

export function hintText(tool) {
  if (!tool) return HINT.null;
  if (tool === 'lamp') return HINT.lamp;
  const name = TOOLS.find(t => t[0] === tool)[1].toLowerCase();
  return `Нажмите на стену или внутри комнаты: появится «${name}». Нажмите на кнопку ещё раз, чтобы закончить.`;
}

const options = (pairs, cur) =>
  pairs.map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${v}</option>`).join('');

const field = (k, lb, v) =>
  `<div><label for="rf-${k}">${lb}</label><input id="rf-${k}" type="number" inputmode="decimal" step="0.05" data-rf="${k}" value="${v}"></div>`;

export function itemPanelHtml(it) {
  if (!it)
    return '<p class="muted small">Нажмите на значок в комнате, чтобы изменить его высоту, назначение или удалить.</p>';
  const role =
    it.type === 'socket'
      ? `<div><label for="rf-role">Назначение</label><select id="rf-role" data-rf="role">${options(Object.entries(ROLES), it.role)}</select></div>`
      : '';
  const pos =
    it.wall == null
      ? field('x', 'От левой стены, м', it.x) + field('y', 'От верхней стены, м', it.y)
      : `<div><label for="rf-wall">Стена</label><select id="rf-wall" data-rf="wall">${options(
          WALLS.map((n, k) => [k, n]),
          it.wall,
        )}</select></div>${field('x', 'От угла стены, м', it.x)}${field('z', 'Высота от пола, м', it.z)}`;
  const name = TOOLS.find(t => t[0] === it.type)[1];
  return `<b>${name}</b><div class="pf">
        ${role}
        ${pos}
      </div><div class="row"><button class="danger" data-r="del">Удалить</button></div>`;
}

export function reportHtml(rep, bad) {
  const n = rep.n;
  const li = a => a.map(t => `<li>${esc(t)}</li>`).join('');
  const ok = '<p style="color:var(--green-d)"><b>Замечаний по нормам нет.</b></p>';
  const issues = `<p><b>Что проверить:</b></p><ul>${li(bad.map(x => x.text))}</ul>`;
  const tips = rep.tips.length ? `<p><b>Что сделано автоматически:</b></p><ul>${li(rep.tips)}</ul>` : '';
  return `<b>Готово.</b> Розеток: ${n.socket} · ламп: ${n.lamp} · выключателей: ${n.switch} · коробок: ${n.box}${n.panel ? ' · щиток: ' + n.panel : ''}${n.rj45 ? ' · интернет: ' + n.rj45 : ''}.
      ${bad.length ? issues : ok}
      ${tips}`;
}
