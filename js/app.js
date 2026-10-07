import * as store from './storage.js';
import {
  newProject,
  newRoom,
  nextSlot,
  removeRoom,
  refit,
  area,
  totalArea,
  fmt,
  ROOM_TYPES,
  TYPE_FLOOR,
} from './model.js';
import { TEMPLATES } from './templates.js';
import * as plan2d from './plan2d.js';
import * as view3d from './view3d.js';
import * as room from './room.js';
import * as check from './check.js';
import * as estimate from './estimate.js';
import { esc, invalid, valid } from './util.js';

const STEPS = [
  { t: 'Начало', q: 'С чего начнём?' },
  { t: 'Комнаты', q: 'Какие комнаты в квартире?' },
  { t: 'План', q: 'Как комнаты стоят на этаже?', mod: plan2d },
  { t: 'Модель', q: 'Посмотрите дом и расставьте электрику', mod: view3d },
  { t: 'Проверка', q: 'Проверка и расчёт проводки', mod: check },
  { t: 'Покупки', q: 'Что купить и сколько это стоит?', mod: estimate },
];
const MAX_UNDO = 30;
const state = { project: null, step: 0, history: [], editing: null, editRoom: null };
const ctx = {
  state,
  commit,
  toast,
  confirmBox,
  save: () => persist(),
  openRoom: id => {
    state.editRoom = id;
    render();
    enter();
    $('#screen').scrollTop = 0;
  },
  closeRoom: () => {
    state.editRoom = null;
    render();
    enter();
    $('#screen').scrollTop = 0;
  },
  showOnModel: (room, item) => {
    state.focus = { room, item };
    go(3);
  },
};
const $ = s => document.querySelector(s);
let cleanup = null;

/* ---------- сообщения и подтверждение ---------- */
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.id);
  toast.id = setTimeout(() => t.classList.remove('show'), Math.min(9000, Math.max(2800, 1200 + msg.length * 55)));
}
function confirmBox(text, yes = 'Да, удалить') {
  return new Promise(res => {
    const d = $('#dlg');
    $('#dlg-text').textContent = text;
    $('#dlg-yes').textContent = yes;
    d.onclose = () => res(false);
    $('#dlg-yes').onclick = () => {
      res(true);
      closeDlg(d);
    };
    $('#dlg-no').onclick = () => closeDlg(d);
    d.showModal();
  });
}
// Закрытие с коротким затуханием. Esc закрывает мгновенно, это нормально.
function closeDlg(d) {
  return new Promise(done => {
    if (!d.open || d.classList.contains('out')) return done();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      d.close();
      return done();
    }
    const fin = () => {
      clearTimeout(t);
      d.removeEventListener('animationend', onEnd);
      d.classList.remove('out');
      if (d.open) d.close();
      done();
    };
    const onEnd = e => e.target === d && fin();
    const t = setTimeout(fin, 300); // запас, если animationend не придёт
    d.classList.add('out');
    d.addEventListener('animationend', onEnd);
  });
}

/* ---------- состояние, сохранение, отмена ---------- */
// Автосохранение с задержкой 250 мс: проект не сериализуется на каждое нажатие клавиши.
let saveTimer = 0,
  saveFailed = false,
  savePending = false;
function persist() {
  state.project.updated = Date.now();
  savePending = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}
function flush() {
  clearTimeout(saveTimer);
  if (!savePending) return;
  savePending = false;
  const ok = store.saveCurrent(state.project, state.step);
  if (!ok && !saveFailed)
    toast('Память браузера заполнена: изменения не сохраняются. Удалите старые проекты на шаге «Начало».');
  saveFailed = !ok;
}
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});
// Любое изменение проходит через commit: так работает отмена (30 шагов).
// quiet=true: не перерисовывать экран (чтобы не терять фокус при вводе в форму).
// coalesce: серия правок с одним ключом (ввод цены) за 1,5 с склеивается в одну запись истории.
let lastKey = '',
  lastAt = 0;
export function commit(mutator, quiet = false, coalesce = '') {
  const now = Date.now();
  if (!(coalesce && coalesce === lastKey && now - lastAt < 1500)) {
    state.history.push(JSON.stringify(state.project));
    if (state.history.length > MAX_UNDO) state.history.shift();
  }
  lastKey = coalesce;
  lastAt = now;
  mutator(state.project);
  persist();
  quiet ? renderBar() : render();
}
export function undo() {
  if (!state.history.length) return toast('Отменять пока нечего.');
  lastKey = '';
  state.project = JSON.parse(state.history.pop());
  persist();
  render();
  toast('Последнее действие отменено.');
}
// Есть ли в текущем проекте изменения, которых нет в сохранённой копии (поле updated не учитывается).
const snap = p => JSON.stringify({ ...p, updated: 0 });
const unsaved = () => {
  const s = store.loadProject(state.project.id);
  return state.project.rooms.length > 0 && (!s || snap(s) !== snap(state.project));
};
function setProject(p) {
  state.project = p;
  state.history = [];
  lastKey = '';
  persist();
  render();
}
function go(i) {
  i = Math.max(0, Math.min(STEPS.length - 1, i));
  if (i > 1 && !state.project.rooms.length) {
    toast('Сначала добавьте хотя бы одну комнату или выберите шаблон.');
    i = 1;
  }
  state.step = i;
  state.editing = null;
  state.editRoom = null;
  persist();
  render({ focusTitle: true });
  enter();
  $('#screen').scrollTop = 0;
}

/* ---------- экраны ---------- */
function startScreen() {
  const list = store.listProjects();
  return `<section class="card"><h2>Выберите шаблон</h2><div class="tpls">${TEMPLATES.map(t => {
    const p = t.build(),
      info = p.rooms.length
        ? `комнат: ${p.rooms.length} · ${fmt(totalArea(p.rooms))} м², с дверями и окнами`
        : 'начать с нуля';
    return `<button class="tpl" data-act="tpl" data-id="${t.id}"><b>${t.title}</b><small>${info}</small></button>`;
  }).join('')}</div></section>
    <section class="card"><label for="pname">Название проекта</label>
    <input id="pname" value="${esc(state.project.name)}" autocomplete="off">
    <div class="row"><button class="primary" data-act="save">Сохранить проект</button></div></section>
    <section class="card"><h2>Сохранённые проекты</h2>
    ${
      list.length
        ? list
            .map(
              p => `<div class="item"><span>${esc(p.name)}<small>комнат: ${p.rooms} · ${new Date(p.updated).toLocaleString('ru-RU')}</small></span>
      <span class="row"><button data-act="open" data-id="${p.id}">Открыть</button><button class="danger" data-act="del" data-id="${p.id}">Удалить</button></span></div>`,
            )
            .join('')
        : '<p class="muted">Пока нет сохранённых проектов.</p>'
    }</section>`;
}
function roomsScreen() {
  const rs = state.project.rooms;
  const r = state.editing && rs.find(x => x.id === state.editing);
  if (r) return roomForm(r);
  state.editing = null;
  return `<section class="card">${
    rs.length
      ? `<p><b>Комнат: ${rs.length}</b> · общая площадь ${fmt(totalArea(rs))} м²</p>`
      : '<p class="muted">Комнат пока нет. Нажмите «Добавить комнату».</p>'
  }
    <ul class="list">${rs
      .map(
        x => `<li class="item"><span><b>${esc(x.name)}</b><small>${ROOM_TYPES[x.type]} · ${fmt(x.l)} × ${fmt(x.w)} м · ${fmt(area(x))} м²</small></span>
      <button data-act="edit" data-id="${x.id}">Изменить</button></li>`,
      )
      .join('')}</ul>
    <div class="row"><button class="primary" data-act="add">+ Добавить комнату</button></div></section>
    <p class="muted small">Двери и окна вы добавите на шаге «План».</p>`;
}
function roomForm(r) {
  const num = (k, label, min, max) =>
    `<div class="fld"><label for="f-${k}">${label}</label><input id="f-${k}" type="number" inputmode="decimal" step="0.1" min="${min}" max="${max}" value="${r[k]}" data-f="${k}" data-min="${min}" data-max="${max}" data-label="${label}"></div>`;
  return `<section class="card">
    <div class="fld"><label for="f-name">Название</label><input id="f-name" data-f="name" value="${esc(r.name)}" autocomplete="off"></div>
    <div class="fld"><label for="f-type">Тип комнаты</label><select id="f-type" data-f="type">${Object.entries(
      ROOM_TYPES,
    )
      .map(([k, v]) => `<option value="${k}"${k === r.type ? ' selected' : ''}>${v}</option>`)
      .join('')}</select></div>
    <div class="grid2">${num('l', 'Длина, м', 0.8, 30)}${num('w', 'Ширина, м', 0.8, 30)}</div>
    ${num('h', 'Высота потолка, м', 2, 5)}
    <p class="muted">Площадь: <b id="f-area">${fmt(area(r))} м²</b></p>
    <div class="grid2"><div class="fld"><label for="f-floor">Цвет пола</label><input id="f-floor" type="color" data-f="floor" value="${r.floor}"></div>
    <div class="fld"><label for="f-wall">Цвет стен</label><input id="f-wall" type="color" data-f="wall" value="${r.wall}"></div></div>
    <p class="muted small">Цвета по желанию: они меняют только вид.</p>
    <div class="row"><button class="primary" data-act="done">Готово</button><button class="danger" data-act="rm" data-id="${r.id}">Удалить комнату</button></div></section>`;
}
function renderBar() {
  $('#b-back').disabled = state.step === 0 && !state.editRoom;
  $('#b-next').disabled = state.step === STEPS.length - 1;
  $('#b-undo').textContent = `↶ Отменить${state.history.length ? ' (' + state.history.length + ')' : ''}`;
  $('#b-undo').disabled = !state.history.length;
}
// Как найти тот же элемент после перерисовки: по id или по набору data-атрибутов.
const selectorOf = el =>
  el.id
    ? '#' + CSS.escape(el.id)
    : [...el.attributes]
        .filter(a => a.name.startsWith('data-'))
        .map(a => `[${a.name}="${CSS.escape(a.value)}"]`)
        .join('') || null;
function render({ focusTitle = false } = {}) {
  const was = document.activeElement;
  const key = was && was !== document.body ? selectorOf(was) : null;
  const s = STEPS[state.step];
  $('#steps').innerHTML = `<div class="dots">${STEPS.map(
    (x, i) =>
      `<button class="dot ${i === state.step ? 'on' : ''} ${i < state.step ? 'done' : ''}" data-act="go" data-i="${i}" aria-label="Шаг ${i + 1}: ${x.t}"${i === state.step ? ' aria-current="step"' : ''}>${i + 1}</button>`,
  ).join('')}</div>
    <div class="stitle">Шаг ${state.step + 1} из ${STEPS.length} · ${s.t}</div>`;
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  const er = state.editRoom && state.project.rooms.find(x => x.id === state.editRoom);
  if (!er) state.editRoom = null;
  const body = er
    ? '<section class="card" id="mount"></section>'
    : state.step === 0
      ? startScreen()
      : state.step === 1
        ? roomsScreen()
        : '<section class="card" id="mount"></section>';
  const q = er ? 'Комната: ' + esc(er.name) : state.step === 1 && state.editing ? 'Параметры комнаты' : s.q;
  $('#screen').innerHTML = `<h1>${q}</h1>${body}`;
  if (er) cleanup = room.mount($('#mount'), ctx);
  else if (s.mod) cleanup = s.mod.mount($('#mount'), ctx);
  document.title = `${s.t} · ЭлектроПлан`;
  const again = !focusTitle && key && document.querySelector(key);
  if (again) again.focus({ preventScroll: true });
  else if (focusTitle) {
    const h = $('#screen h1');
    h.tabIndex = -1;
    h.focus({ preventScroll: true });
  }
  renderBar();
}

/* ---------- действия ---------- */
function setFont(px) {
  px = Math.max(15, Math.min(26, px));
  document.documentElement.style.setProperty('--fs', px + 'px');
  store.setPref('fs', px);
}
const curFont = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--fs'), 10) || 17;
// Короткое появление экрана. Класс снимается сразу после анимации, иначе она повторится при любом render().
function enter() {
  const s = $('#screen');
  s.classList.remove('enter');
  void s.offsetWidth;
  s.classList.add('enter');
  clearTimeout(enter.t);
  enter.t = setTimeout(() => s.classList.remove('enter'), 450);
}
const top = () => {
  $('#screen').scrollTop = 0;
};

const actions = {
  'fs-': () => setFont(curFont() - 2),
  'fs+': () => setFont(curFont() + 2),
  back: () => (state.editRoom ? ctx.closeRoom() : go(state.step - 1)),
  next: () => go(state.step + 1),
  go: b => go(+b.dataset.i),
  undo,
  save: () =>
    toast(
      store.saveProject(state.project)
        ? 'Проект сохранён.'
        : 'Не удалось сохранить: память браузера недоступна или заполнена. Освободите место и попробуйте снова.',
    ),
  tpl: async b => {
    if (
      unsaved() &&
      !(await confirmBox(
        'Текущий проект не сохранён и будет заменён. Если он нужен, сначала нажмите «Сохранить проект».',
        'Да, заменить',
      ))
    )
      return;
    const t = TEMPLATES.find(x => x.id === b.dataset.id);
    state.editing = null;
    state.step = 1;
    setProject(t.build());
    enter();
    top();
  },
  open: async b => {
    const p = store.loadProject(b.dataset.id);
    if (!p) return toast('Проект не найден.');
    if (
      unsaved() &&
      !(await confirmBox('Текущий проект не сохранён. Открыть другой и потерять изменения?', 'Да, открыть'))
    )
      return;
    state.editing = null;
    setProject(p);
    enter();
  },
  del: async b => {
    if (await confirmBox('Удалить этот проект без возможности вернуть?')) {
      store.deleteProject(b.dataset.id);
      render();
      toast('Проект удалён.');
    }
  },
  add: () => {
    commit(p => {
      const n = p.rooms.filter(r => r.type === 'bedroom').length,
        s = nextSlot(p.rooms);
      const r = newRoom({ name: ROOM_TYPES.bedroom + (n ? ' ' + (n + 1) : ''), x: s.x, y: s.y });
      p.rooms.push(r);
      state.editing = r.id;
    });
    enter();
    top();
  },
  edit: b => {
    state.editing = b.dataset.id;
    render();
    enter();
    top();
  },
  done: () => {
    state.editing = null;
    render();
    enter();
    top();
  },
  rm: async b => {
    const r = state.project.rooms.find(x => x.id === b.dataset.id);
    if (r && (await confirmBox(`Удалить комнату «${r.name}»? Двери к ней тоже удалятся.`))) {
      commit(p => {
        removeRoom(p, r.id);
        state.editing = null;
      });
      top();
    }
  },
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b && actions[b.dataset.act]) actions[b.dataset.act](b);
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'pname')
    return commit(p => {
      p.name = t.value.trim() || 'Без названия';
    }, true);
  const f = t.dataset.f,
    r = state.editing && state.project.rooms.find(x => x.id === state.editing);
  if (!f || !r) return;
  let v = t.value;
  if (f === 'w' || f === 'l' || f === 'h') {
    v = parseFloat(String(v).replace(',', '.'));
    const min = +t.dataset.min,
      max = +t.dataset.max;
    if (!(v >= min && v <= max)) {
      invalid(t, `${t.dataset.label}: введите число от ${fmt(min)} до ${fmt(max)}.`);
      return;
    }
    valid(t);
    v = Math.round(v * 100) / 100;
  } else if (f === 'name') {
    v = v.trim() || ROOM_TYPES[r.type];
    t.value = v;
  }
  let n = 0,
    fx = false;
  commit(p => {
    const q = p.rooms.find(x => x.id === r.id),
      old = q.type;
    q[f] = v;
    if (f === 'type') {
      if (q.name === ROOM_TYPES[old]) q.name = ROOM_TYPES[v];
      if (q.floor === TYPE_FLOOR[old]) q.floor = TYPE_FLOOR[v];
    }
    if (f === 'w' || f === 'l' || f === 'h') {
      fx = refit(p, q);
      n = plan2d.prune(p);
    }
  }, true);
  if (n) toast('Двери между комнатами, которые больше не стоят вплотную, удалены. Можно нажать «Отменить».');
  else if (fx) toast('Положение мойки, плиты и душа сброшено. Нажмите «Расставить по правилам» в комнате.');
  const q = state.project.rooms.find(x => x.id === r.id);
  if (f === 'type') {
    $('#f-name').value = q.name;
    $('#f-floor').value = q.floor;
  }
  $('#f-area').textContent = fmt(area(q)) + ' м²';
});
document.addEventListener('keydown', e => {
  if (
    (e.ctrlKey || e.metaKey) &&
    e.code === 'KeyZ' &&
    !e.shiftKey &&
    !e.target.closest('input,select,textarea,[contenteditable]')
  ) {
    e.preventDefault();
    undo();
  }
});

/* ---------- запуск ---------- */
setFont(store.getPref('fs', 17));
const cur = store.loadCurrent();
state.project = cur?.project || newProject();
state.step = Math.min(cur?.step || 0, STEPS.length - 1);
try {
  render();
} catch (e) {
  console.error(e);
  recover();
}
// Высота нижней панели меняется, когда подписи кнопок переносятся на несколько строк: тост держится над ней.
const bar = $('.bar');
new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', bar.offsetHeight + 'px')).observe(bar);
function recover() {
  $('#screen').innerHTML =
    '<section class="card"><h2>Не удалось открыть проект</h2><p>Данные повреждены. Сохранённые проекты не затронуты.</p><div class="row"><button class="primary" id="reset-cur">Начать заново</button></div></section>';
  $('#reset-cur').onclick = () => {
    store.clearCurrent();
    location.reload();
  };
}
/* ---------- офлайн: service worker ---------- */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type !== 'offline-ready' || store.getPref('offlineSeen', false)) return;
    if (e.data.three) {
      store.setPref('offlineSeen', true);
      toast('Готово: приложение теперь работает без интернета.');
    } else toast('3D-библиотека пока не сохранена. Откройте приложение ещё раз при включённом интернете.');
  });
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
if (location.hash === '#debug') window.ElectroPlan = { state, commit, undo, openRoom: id => ctx.openRoom(id) }; // для отладки в консоли
