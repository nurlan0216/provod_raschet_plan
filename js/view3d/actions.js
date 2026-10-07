import { autoPlaceAll } from '../rules.js';
import { V, layers } from './state.js';

// Кнопки шага «Модель». env: { ctx, S, boot, sync, getApi }.

export function bindActions(el, env) {
  const { ctx, S } = env;
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    const a = b.dataset.q;
    if (a === 'retry') return env.boot();
    if (a === 'autoall') return autoAll(ctx, S);
    const api = env.getApi();
    if (!api) return;
    if (a === 'view') {
      V.curView = b.dataset.v;
      api.view(V.curView);
    } else if (a === 'ceil') {
      V.ceil = !V.ceil;
      api.ceil();
    } else if (a === 'low') {
      V.low = !V.low;
      api.build();
    } else if (a === 'layer') {
      layers[b.dataset.l] = !layers[b.dataset.l];
      api.layers();
    } else if (a === 'pick') {
      api.select(b.dataset.id, true);
    } else if (a === 'light') {
      if (!toggleLightMode(ctx, S, api)) return;
    } else if (a === 'lighttoggle') {
      if (V.selId) api.toggle(V.selId);
    } else if (a === 'close') api.select(null, false);
    else if (a === 'open' || a === 'addel') {
      if (V.selId) ctx.openRoom(V.selId);
    }
    env.sync();
  });
}

// false: выключателей нет, режим не включён (и sync не нужен).
function toggleLightMode(ctx, S, api) {
  if (!V.lightMode && !S.project.rooms.some(r => r.items.some(i => i.type === 'switch'))) {
    ctx.toast('Выключателей пока нет. Нажмите «Расставить по правилам везде», потом проверяйте свет.');
    return false;
  }
  V.lightMode = !V.lightMode;
  api.light();
  return true;
}

async function autoAll(ctx, S) {
  if (!S.project.rooms.length) return;
  const msg =
    'В комнатах уже есть элементы. Расставить везде заново? Старые заменятся новыми (это можно отменить кнопкой «Отменить»).';
  if (S.project.rooms.some(r => r.items.length) && !(await ctx.confirmBox(msg, 'Да, расставить заново'))) return;
  let rep;
  ctx.commit(p => {
    rep = autoPlaceAll(p);
  });
  const bad = rep.issues.filter(x => x.level === 'error').length;
  const tail = bad
    ? `Есть замечания (${bad}): откройте комнату, там они объяснены.`
    : rep.tips.length
      ? 'Замечаний по нормам нет.'
      : 'Замечаний нет.';
  ctx.toast(`Расставлено: розеток ${rep.n.socket}, ламп ${rep.n.lamp}, выключателей ${rep.n.switch}. ` + tail);
}
