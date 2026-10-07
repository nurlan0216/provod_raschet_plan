import { fmt } from '../model.js';
import { esc } from '../util.js';

// Панель выбранного объекта на плане: комната (кнопка «Открыть») или проём (поля размеров, поворот, удаление).

export const HELP = {
  move: 'Нажмите на комнату и перетащите её. Двумя пальцами можно приблизить план.',
  door: 'Нажмите на общую стену между комнатами — там появится дверь.',
  win: 'Нажмите на наружную стену — там появится окно.',
  ent: 'Нажмите на наружную стену — там будет входная дверь и щиток.',
};

const HINT = '<p class="muted small">Нажмите на комнату, дверь или окно, чтобы изменить.</p>';

/** Выбранный проём вместе с его комнатой: { r, o } или null. */
export function getOp(p, sel) {
  if (!sel || sel.k === 'room') return null;
  if (sel.k === 'ent') {
    const r = p.entrance && p.rooms.find(x => x.id === p.entrance.roomId);
    return r ? { r, o: p.entrance } : null;
  }
  const r = p.rooms.find(x => x.id === sel.id);
  const o = r && (sel.k === 'door' ? r.doors : r.windows)[sel.i];
  return o ? { r, o } : null;
}

/** Выбор, который ещё существует в проекте, иначе null (комнату или проём могли удалить). */
export function resolveSel(p, sel) {
  if (!sel) return null;
  if (sel.k === 'room') return p.rooms.some(x => x.id === sel.id) ? sel : null;
  return getOp(p, sel) ? sel : null;
}

const roomHtml = r =>
  `<b>${esc(r.name)}</b><span class="muted"> · ${fmt(r.l)} × ${fmt(r.w)} м</span><div class="row"><button class="primary" data-p="open">Открыть комнату</button></div>`;

const field = (k, lb, v) =>
  `<div><label for="pf-${k}">${lb}</label><input id="pf-${k}" type="number" inputmode="decimal" step="0.05" data-pf="${k}" value="${v}"></div>`;

function opHtml(p, sel, { r, o }) {
  const win = sel.k === 'win';
  const other = p.rooms.find(x => x.id === o.toRoom);
  const title = win ? 'Окно' : sel.k === 'ent' ? 'Входная дверь' : 'Дверь';
  const to = other ? ' → ' + esc(other.name) : '';
  const sill = win ? field('sill', 'Высота от пола, м', o.sill) + field('height', 'Высота окна, м', o.height) : '';
  const swing = win ? '' : `<button data-p="swing">Открывается: ${o.swing === 'out' ? 'наружу' : 'внутрь'}</button>`;
  return `<b>${title}: ${esc(r.name)}${to}</b><div class="pf">${field('width', 'Ширина, м', o.width)}${field('pos', 'От угла стены, м', o.pos)}
        ${sill}</div>
        <div class="row">${swing}<button class="danger" data-p="del">Удалить</button></div>`;
}

/** Разметка панели. sel должен быть уже проверен через resolveSel. */
export function panelHtml(p, sel) {
  if (!sel) return HINT;
  if (sel.k === 'room') return roomHtml(p.rooms.find(x => x.id === sel.id));
  return opHtml(p, sel, getOp(p, sel));
}

/** Подпись кнопки толщины стен. */
export const wallLabel = p => (p.settings.wallThickness === 20 ? 'Несущие стены 20 см' : 'Перегородки 10 см');
