import { openingsOf } from './rules.js';
import { icon, TOOLS } from './room/consts.js';
import { esc } from './util.js';
import { viewUnroll, viewIso, viewTop } from './room/views.js';
import { shellHtml, statsText, hintText, itemPanelHtml } from './room/panel.js';
import { bindPointer, bindClick, bindChange } from './room/handlers.js';
import { st } from './room/state.js';
// Редактор комнаты. Элемент: {id, type, role, x, y, z, wall}.
// Настенный: wall 0–3, x — расстояние от угла стены (слева/сверху), y=0, z — высота от пола.
// Потолочный (лампа): wall=null, x/y — от левого верхнего угла комнаты, z=высота потолка.

export function mount(el, ctx) {
  const S = ctx.state;
  const R = () => S.project.rooms.find(x => x.id === S.editRoom);
  const $ = s => el.querySelector(s);
  const back = S.step === 2 ? '← К плану' : S.step === 3 ? '← К модели' : '← Назад';
  el.innerHTML = shellHtml(back, R().type);
  const box = $('#rc');
  const svg = box.querySelector('svg');
  const m = { el, svg, ctx, S, R, C: fn => ctx.commit(fn, true), hits: [], G: {}, drag: null, ovr: null };

  function draw() {
    const r = R();
    const ops = openingsOf(S.project, r);
    const items = r.items.map(i => (m.ovr && m.ovr.id === i.id ? { ...i, ...m.ovr } : i));
    const W = box.clientWidth || 340;
    const v =
      st.vw === 'unroll'
        ? viewUnroll(r, ops, items)
        : st.vw === 'iso'
          ? viewIso(r, items, W)
          : viewTop(r, ops, items, W);
    if (v.G) m.G = v.G;
    box.style.cssText = v.boxCss;
    svg.style.cssText = v.svgCss;
    m.hits = [];
    let h = v.h;
    v.pos.forEach(([i, x, y]) => {
      h += icon(i.type, x, y, i.type === 'panel' ? 9 : 10, i.id === st.sel);
      m.hits.push({ id: i.id, x, y });
    });
    svg.innerHTML = h;
  }

  // Список элементов для выбора без мыши. Пересобирается только при изменении состава, чтобы не терять фокус.
  const pickSel = $('#r-pick');
  let pickHtml = '';
  function fillPick(r) {
    const cnt = {};
    const opts = r.items.map(i => {
      cnt[i.type] = (cnt[i.type] || 0) + 1;
      return `<option value="${esc(i.id)}">${cnt[i.type]}. ${TOOLS.find(t => t[0] === i.type)[1]}</option>`;
    });
    const html = '<option value="">Не выбран</option>' + opts.join('');
    if (html !== pickHtml) {
      pickHtml = html;
      pickSel.innerHTML = html;
    }
    pickSel.value = st.sel || '';
  }

  function ui() {
    const r = R();
    $('#rs').textContent = statsText(S.project, r);
    el.querySelectorAll('[data-r=view]').forEach(b => {
      const on = b.dataset.v === st.vw;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    });
    el.querySelectorAll('[data-r=tool]').forEach(b => {
      const on = b.dataset.v === st.tool;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    });
    $('#rh').textContent = hintText(st.tool);
    const it = r.items.find(i => i.id === st.sel);
    if (!it) st.sel = null;
    fillPick(r);
    $('#rp').innerHTML = itemPanelHtml(it);
  }

  m.draw = draw;
  m.ui = ui;
  bindPointer(m);
  bindClick(m);
  bindChange(m);
  let rf = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(rf);
    rf = requestAnimationFrame(draw);
  });
  ro.observe(box);
  draw();
  ui();
  return () => {
    cancelAnimationFrame(rf);
    ro.disconnect();
  };
}
