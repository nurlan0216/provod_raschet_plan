import { fmt, uid } from '../model.js';
import { checkRoom, autoPlaceRoom } from '../rules.js';
import { r2, wallLen as wl, invalid, valid } from '../util.js';
import { defZ } from './consts.js';
import { locate } from './views.js';
import { st } from './state.js';
import { reportHtml } from './panel.js';

// Обработчики редактора комнаты. m — общий контекст mount: { el, svg, ctx, R, C, draw, ui, hits, G, drag, ovr }.

const refresh = m => {
  m.draw();
  m.ui();
};

const rel = (m, e) => {
  const b = m.svg.getBoundingClientRect();
  return { x: e.clientX - b.left, y: e.clientY - b.top };
};

const hitAt = (m, q) => {
  let best = null;
  let bd = 22;
  m.hits.forEach(t => {
    const d = Math.hypot(t.x - q.x, t.y - q.y);
    if (d < bd) {
      bd = d;
      best = t.id;
    }
  });
  return best;
};

export function bindPointer(m) {
  const { svg } = m;
  svg.addEventListener('pointerdown', e => {
    const q = rel(m, e);
    const id = hitAt(m, q);
    m.drag = { q0: q, id, moved: false };
    if (id && st.vw === 'top') svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', e => onMove(m, e));
  svg.addEventListener('pointerup', () => onUp(m));
  svg.addEventListener('pointercancel', () => {
    m.drag = null;
    m.ovr = null;
  });
}

function onMove(m, e) {
  const d = m.drag;
  if (!d || !d.id || st.vw !== 'top') return;
  const q = rel(m, e);
  if (!d.moved && Math.hypot(q.x - d.q0.x, q.y - d.q0.y) < 6) return;
  d.moved = true;
  const it = m.R().items.find(i => i.id === d.id);
  const loc = it && locate(m.R(), st.vw, m.G, q, it.type);
  if (loc && loc !== 'lamp') {
    m.ovr = { id: it.id, ...loc };
    st.sel = it.id;
    m.draw();
  }
}

function onUp(m) {
  const d = m.drag;
  m.drag = null;
  if (!d) return;
  if (d.moved) return finishDrag(m);
  if (d.id) {
    st.sel = d.id;
    return refresh(m);
  }
  if (!st.tool) {
    st.sel = null;
    return refresh(m);
  }
  placeItem(m, d);
}

function finishDrag(m) {
  const o = m.ovr;
  m.ovr = null;
  if (o) {
    const it = m.R().items.find(i => i.id === o.id);
    m.C(() => {
      it.wall = o.wall;
      it.x = o.x;
      it.y = o.y;
    });
  }
  refresh(m);
}

function placeItem(m, d) {
  const { ctx } = m;
  if (st.vw === 'iso')
    return ctx.toast('В этом виде можно только смотреть. Ставьте элементы в видах «Сверху» и «Развёртка стен».');
  const r = m.R();
  const loc = locate(r, st.vw, m.G, d.q0, st.tool);
  if (loc === 'lamp') return ctx.toast('Лампы ставятся на потолок: переключитесь на вид «Сверху».');
  if (!loc) return ctx.toast('Нажмите внутри комнаты или на её стене.');
  const it = {
    id: uid(),
    type: st.tool,
    ...(st.tool === 'socket' ? { role: 'normal' } : {}),
    wall: loc.wall,
    x: loc.x,
    y: loc.y,
    z: loc.z ?? defZ(st.tool, r),
  };
  m.C(() => r.items.push(it));
  st.sel = it.id;
  refresh(m);
}

export function bindClick(m) {
  m.el.addEventListener('click', async e => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    const a = b.dataset.r;
    if (a === 'close') m.ctx.closeRoom();
    else if (a === 'view') {
      st.vw = b.dataset.v;
      refresh(m);
    } else if (a === 'tool') {
      st.tool = st.tool === b.dataset.v ? null : b.dataset.v;
      m.ui();
    } else if (a === 'auto') await autoPlace(m);
    else if (a === 'del') await removeSelected(m);
  });
}

async function autoPlace(m) {
  const r = m.R();
  const { S } = m;
  const msg =
    'В комнате уже есть элементы. Расставить заново? Старые заменятся новыми (это можно отменить кнопкой «Отменить»).';
  if (r.items.length && !(await m.ctx.confirmBox(msg, 'Да, расставить заново'))) return;
  let rep;
  let bad;
  m.C(() => {
    rep = autoPlaceRoom(S.project, r);
    bad = checkRoom(S.project, r);
  });
  st.sel = null;
  refresh(m);
  const box = m.el.querySelector('#rr');
  box.hidden = false;
  box.innerHTML = reportHtml(rep, bad);
}

async function removeSelected(m) {
  if (!(await m.ctx.confirmBox('Удалить этот элемент?'))) return;
  const r = m.R();
  m.C(() => {
    r.items = r.items.filter(i => i.id !== st.sel);
  });
  st.sel = null;
  refresh(m);
}

export function bindChange(m) {
  m.el.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'r-pick') {
      st.sel = t.value || null;
      return refresh(m);
    }
    const f = t.dataset.rf;
    const r = m.R();
    const it = f && r.items.find(i => i.id === st.sel);
    if (!it) return;
    if (f === 'role') {
      m.C(() => {
        it.role = t.value;
      });
      return;
    }
    if (f === 'wall') {
      const w = +t.value;
      m.C(() => {
        it.wall = w;
        it.x = Math.min(it.x, wl(r, w));
      });
      return refresh(m);
    }
    changeNumber(m, t, f, it, r);
  });
}

function changeNumber(m, t, f, it, r) {
  const v = parseFloat(String(t.value).replace(',', '.'));
  const rng = {
    x: [0, it.wall == null ? r.w : wl(r, it.wall), 'Расстояние от стены'],
    y: [0, r.l, 'Расстояние от стены'],
    z: [0.05, r.h - 0.05, 'Высота'],
  }[f];
  if (!(v >= rng[0] && v <= rng[1])) {
    invalid(t, `${rng[2]}: введите число от ${fmt(r2(rng[0]))} до ${fmt(r2(rng[1]))} м.`);
    return;
  }
  valid(t);
  m.C(() => {
    it[f] = r2(v);
  });
  refresh(m);
}
