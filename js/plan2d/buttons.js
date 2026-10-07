import { fmt } from '../model.js';
import { r2, wallLen as wlen, invalid, valid } from '../util.js';
import { prune, rotate, autoLayout } from './geometry.js';

// Кнопки и поля панели редактора плана. X — общий контекст mount (см. plan2d.js):
// { S, ctx, C, draw, ui, fit, getOp, mode, sel }.

const redrawAll = X => {
  X.draw();
  X.ui();
};

export function bindButtons(el, X) {
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    const a = b.dataset.p;
    if (a === 'mode') {
      X.mode = b.dataset.v;
      X.ui();
    } else if (a === 'fit') {
      X.fit();
      X.draw();
    } else if (a === 'pick') {
      X.sel = { k: 'room', id: b.dataset.id };
      redrawAll(X);
    } else if (a === 'open') {
      if (X.sel && X.sel.k === 'room') X.ctx.openRoom(X.sel.id);
    } else if (a === 'wall') toggleWall(X);
    else if (a === 'rot') rotateSelected(X);
    else if (a === 'auto') layoutRooms(X);
    else if (a === 'swing') flipSwing(X);
    else if (a === 'del') await deleteOpening(X);
  });
}

function toggleWall(X) {
  const p = X.S.project;
  X.C(() => {
    p.settings.wallThickness = p.settings.wallThickness === 20 ? 10 : 20;
  });
  redrawAll(X);
}

function rotateSelected(X) {
  const { S, ctx, sel } = X;
  if (!sel || sel.k !== 'room') return ctx.toast('Сначала нажмите на комнату, которую нужно повернуть.');
  const p = S.project;
  let n = 0;
  X.C(() => {
    rotate(
      p,
      p.rooms.find(x => x.id === sel.id),
    );
    n = prune(p);
  });
  if (n) ctx.toast('Двери, которые больше не на общей стене, удалены.');
  redrawAll(X);
}

function layoutRooms(X) {
  const p = X.S.project;
  let n = 0;
  X.C(() => {
    autoLayout(p);
    n = prune(p);
  });
  X.fit();
  redrawAll(X);
  X.ctx.toast(
    'Комнаты разложены.' + (n ? ' Двери между разъехавшимися комнатами удалены.' : '') + ' Можно нажать «Отменить».',
  );
}

function flipSwing(X) {
  const op = X.getOp();
  if (!op) return;
  X.C(() => {
    op.o.swing = op.o.swing === 'out' ? 'in' : 'out';
  });
  redrawAll(X);
}

async function deleteOpening(X) {
  const { S, ctx, sel } = X;
  const op = X.getOp();
  if (!op || !(await ctx.confirmBox(sel.k === 'win' ? 'Удалить это окно?' : 'Удалить эту дверь?'))) return;
  const p = S.project;
  X.C(() => {
    if (sel.k === 'ent') p.entrance = null;
    else (sel.k === 'door' ? op.r.doors : op.r.windows).splice(sel.i, 1);
  });
  X.sel = null;
  redrawAll(X);
}

export function bindFields(el, X) {
  el.addEventListener('change', e => {
    const t = e.target;
    const f = t.dataset.pf;
    const op = f && X.getOp();
    if (!op) return;
    const { r, o } = op;
    const win = X.sel.k === 'win';
    const v = parseFloat(String(t.value).replace(',', '.'));
    const rng = {
      width: win ? [0.4, 4, 'Ширина окна'] : [0.6, 1.6, 'Ширина двери'],
      pos: [0, wlen(r, o.wall) - o.width, 'Расстояние от угла'],
      sill: [0, 2, 'Высота от пола'],
      height: [0.3, 2.5, 'Высота окна'],
    }[f];
    if (!(v >= rng[0] && v <= rng[1])) {
      invalid(t, `${rng[2]}: введите число от ${fmt(r2(rng[0]))} до ${fmt(r2(rng[1]))} м.`);
      return;
    }
    valid(t);
    X.C(() => {
      o[f] = r2(v);
      if (f === 'width') o.pos = r2(Math.min(o.pos, wlen(r, o.wall) - o.width));
    });
    X.draw();
  });
}

// Клавиатура на плане: фокус на холсте или на кнопке выбора комнаты. Стрелки двигают выбранную комнату
// на 10 см (с Shift на 50 см), Enter на холсте открывает её.
export function bindKeys(el, X) {
  const svg = el.querySelector('svg'),
    group = el.querySelector('#tp');
  svg.tabIndex = 0;
  svg.setAttribute('role', 'application');
  svg.setAttribute(
    'aria-label',
    'План этажа. Выберите комнату кнопками выше. Стрелки двигают её на 10 см, Shift — на 50 см, Enter открывает.',
  );
  const onKey = e => {
    const sel = X.sel;
    if (!sel || sel.k !== 'room') return;
    if (e.key === 'Enter' && e.target === svg) return X.ctx.openRoom(sel.id);
    const st = e.shiftKey ? 0.5 : 0.1;
    const d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
    if (!d) return;
    e.preventDefault();
    let n = 0;
    X.ctx.commit(
      p => {
        const r = p.rooms.find(x => x.id === sel.id);
        r.x = r2(r.x + d[0]);
        r.y = r2(r.y + d[1]);
        n = prune(p);
      },
      true,
      'kbd-move:' + sel.id,
    );
    if (n) X.ctx.toast('Двери между разъехавшимися комнатами удалены. Можно нажать «Отменить».');
    X.redraw();
    X.ui();
  };
  svg.addEventListener('keydown', onKey);
  group.addEventListener('keydown', e => {
    if (e.target.closest('[data-p=pick]')) onKey(e);
  });
}
