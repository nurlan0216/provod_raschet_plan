import { shared, outer, wseg, prune, rotate, fitView } from './plan2d/geometry.js';
import { renderPlan } from './plan2d/draw.js';
import { HELP, getOp as panelGetOp, resolveSel, panelHtml, wallLabel } from './plan2d/panel.js';
import { attachGestures } from './plan2d/gestures.js';
import { bindButtons, bindFields, bindKeys } from './plan2d/buttons.js';
import { createContext } from './plan2d/context.js';
import { esc } from './util.js';
// Редактор плана этажа (вид сверху). Геометрия — plan2d/geometry.js, жесты — plan2d/gestures.js,
// отрисовка — plan2d/draw.js, панель выбранного объекта — plan2d/panel.js. Здесь: сборка экрана, кнопки, change.
const st = { view: null, viewPid: null, mode: 'move', sel: null };

export function mount(el, ctx) {
  const S = ctx.state,
    C = fn => ctx.commit(fn, true),
    $ = s => el.querySelector(s);
  el.innerHTML = `<div id="pi"></div><p class="muted small" id="ph"></p>
    <div class="tools" id="tm" role="group" aria-label="Режим плана"><button data-p="mode" data-v="move">Двигать</button><button data-p="mode" data-v="door">+ Дверь</button><button data-p="mode" data-v="win">+ Окно</button><button data-p="mode" data-v="ent">Вход</button></div>
    <div class="tools" id="tp" role="group" aria-label="Выбор комнаты">${S.project.rooms.map(r => `<button data-p="pick" data-id="${esc(r.id)}">${esc(r.name)}</button>`).join('')}</div>
    <div class="canvas"><svg></svg><div class="ruler"></div></div>
    <div class="tools"><button data-p="rot">Повернуть 90°</button><button data-p="auto">Разложить</button><button data-p="fit">Показать всё</button><button data-p="wall"></button></div>
    <div class="card" id="pp"></div>`;
  const svg = $('svg'),
    cv = $('.canvas');
  const loc = { ov: {} };
  const size = () => {
    const b = cv.getBoundingClientRect();
    return { W: b.width || 340, H: b.height || 400 };
  };
  // Перерисовка не чаще одного раза за кадр; размер холста пересчитывается только при его изменении.
  let dim = size(),
    raf = 0;
  const redraw = () => {
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0;
        draw();
      });
  };
  const ro = new ResizeObserver(() => {
    dim = size();
    redraw();
  });
  ro.observe(cv);
  function fit() {
    const { W, H } = size();
    st.view = fitView(S.project.rooms, W, H);
  }
  if (!st.view || st.viewPid !== S.project.id) {
    fit();
    st.viewPid = S.project.id;
  }

  st.intro = 0;
  function draw() {
    const out = renderPlan({ project: S.project, ov: loc.ov, view: st.view, dim, sel: st.sel });
    svg.innerHTML = out.svg;
    if (!st.intro) {
      st.intro = 1;
      svg.classList.add('intro');
      setTimeout(() => svg.classList.remove('intro'), 1200);
    }
    $('.ruler').style.width = out.ruler;
    if (out.info !== null) $('#pi').innerHTML = out.info;
  }
  const getOp = () => panelGetOp(S.project, st.sel);
  function ui() {
    const p = S.project;
    st.sel = resolveSel(p, st.sel);
    el.querySelectorAll('[data-p=mode]').forEach(b => {
      const on = b.dataset.v === st.mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    });
    el.querySelectorAll('[data-p=pick]').forEach(b => {
      const on = !!st.sel && st.sel.k === 'room' && b.dataset.id === st.sel.id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    });
    $('#ph').textContent = HELP[st.mode];
    $('[data-p=wall]').textContent = wallLabel(p);
    $('#pp').innerHTML = panelHtml(p, st.sel);
  }

  // Состояние (mode, sel, ov, view) живёт в модуле; X собирается в plan2d/context.js.
  const X = createContext({ S, ctx, C, redraw, draw, ui, fit, getOp }, st, loc);
  attachGestures(svg, X);
  bindButtons(el, X);
  bindFields(el, X);
  bindKeys(el, X);
  draw();
  ui();
  return () => {
    loc.ov = {};
    cancelAnimationFrame(raf);
    ro.disconnect();
  };
}
export { shared, outer, wseg, prune, rotate };
