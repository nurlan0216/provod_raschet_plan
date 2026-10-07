import { fmt, area } from '../model.js';
import { calcProject } from '../calc.js';
import { esc } from '../util.js';

// 3D: жёлтая рамка выбранной комнаты и карточка с её данными.

/**
 * @param X     общее состояние сцены
 * @param card  элемент карточки (.rcard)
 * @param h     { getSel, setSel } — выбранная комната хранится в view3d.js
 * @returns { showSel, updateCard }
 */
export function createCard(X, card, h) {
  const { T, scene, P } = X;
  let frame = null;

  function updateCard() {
    const r = P().rooms.find(x => x.id === h.getSel());
    if (!r) {
      card.hidden = true;
      return;
    }
    const n = t => r.items.filter(i => i.type === t).length;
    const groups = calcProject(P()).groupsByRoom?.[r.id] ?? 0;
    const lightBtn =
      X.lightMode() && r.items.some(i => i.type === 'lamp')
        ? `<button data-q="lighttoggle">${X.litRooms.has(r.id) ? 'Выключить свет' : 'Включить свет'}</button>`
        : '';
    card.hidden = false;
    card.innerHTML = `<button class="x" data-q="close" aria-label="Закрыть">✕</button><b>${esc(r.name)}</b>
        <div class="muted">${fmt(area(r))} м² · розеток: ${n('socket')} · ламп: ${n('lamp')} · групп: ${groups}</div>
        <div class="row"><button class="primary" data-q="open">Открыть комнату</button><button data-q="addel">Добавить электрику</button>${lightBtn}</div>`;
  }

  /** Обновить рамку и карточку; если выбранной комнаты больше нет, сбросить выбор. */
  function showSel() {
    if (frame) {
      scene.remove(frame);
      frame.geometry.dispose();
      frame = null;
    }
    const r = P().rooms.find(x => x.id === h.getSel());
    if (!r) {
      h.setSel(null);
      updateCard();
      return;
    }
    const edges = new T.EdgesGeometry(new T.BoxGeometry(r.w, r.h, r.l));
    frame = new T.LineSegments(edges, new T.LineBasicMaterial({ color: 0xf2b705 }));
    frame.position.set(r.x + r.w / 2, r.h / 2, r.y + r.l / 2);
    scene.add(frame);
    updateCard();
  }

  return { showSel, updateCard };
}
