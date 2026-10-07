import { NORMS_NOTE } from '../rules.js';
import { esc } from '../util.js';
import { V, layers, LAYERS } from './state.js';

// Разметка шага «Модель» и подсветка включённых кнопок.

export function shellHtml(rooms = []) {
  return `<div class="tools" role="group" aria-label="Вид модели"><button data-q="view" data-v="iso">Под углом</button><button data-q="view" data-v="top">Сверху</button><button data-q="view" data-v="inside">Изнутри</button></div>
    <div class="canvas c3"><div class="c3msg muted"><span class="spin" aria-hidden="true"></span>Загрузка 3D…</div><div class="rcard" hidden></div></div>
    <div class="tools" role="group" aria-label="Комнаты">${rooms.map(r => `<button data-q="pick" data-id="${esc(r.id)}">${esc(r.name)}</button>`).join('')}</div>
    <div class="tools"><button data-q="ceil">Показать потолок</button><button data-q="low">Стены ниже</button></div>
    <div class="tools" role="group" aria-label="Слои">${LAYERS.map(([k, t]) => `<button data-q="layer" data-l="${k}">${t}</button>`).join('')}</div>
    <p class="muted small">Провода: <b style="color:var(--red)">■</b> от щитка к коробкам · <b style="color:#B38600">■</b> свет · <b style="color:var(--blue)">■</b> розетки · <b style="color:var(--orange)">■</b> мощные линии · <b style="color:var(--teal)">■</b> интернет и камеры. Значки и провода чуть крупнее настоящих, чтобы их было видно.</p>
    <div class="row"><button data-q="light">Проверить свет</button></div>
    <p class="muted small" id="lhint" hidden>Нажмите на выключатель (он обведён жёлтым кругом): свет включится в его комнате. Нажмите ещё раз, и свет погаснет. Свет также можно включить кнопкой в карточке комнаты.</p>
    <div class="row"><button class="primary" data-q="autoall">Расставить по правилам везде</button></div>
    <p class="muted small">${esc(NORMS_NOTE)}</p>
    <p class="muted small">Нажмите на комнату, чтобы подлететь к ней. Один палец — вращать, два пальца — приближать и двигать.</p>`;
}

export function syncButtons(el) {
  el.querySelectorAll('[data-q=view]').forEach(b => {
    const on = b.dataset.v === V.curView;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  });
  for (const [q, on] of [['ceil', V.ceil], ['low', V.low]]) {
    const b = el.querySelector(`[data-q=${q}]`);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  }
  el.querySelectorAll('[data-q=pick]').forEach(b => {
    const on = b.dataset.id === V.selId;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  });
  el.querySelectorAll('[data-q=layer]').forEach(b => {
    const on = layers[b.dataset.l];
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  });
  const lb = el.querySelector('[data-q=light]');
  lb.classList.toggle('on', V.lightMode);
  lb.setAttribute('aria-pressed', V.lightMode);
  lb.textContent = V.lightMode ? 'Выйти из проверки света' : 'Проверить свет';
  el.querySelector('#lhint').hidden = !V.lightMode;
}
