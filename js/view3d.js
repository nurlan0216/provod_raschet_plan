import { resetWorld, buildWalls } from './view3d/walls.js';
import { buildElectric, applyLayers } from './view3d/electric.js';
import { applyLight, toggle } from './view3d/light.js';
import { createCamera } from './view3d/camera.js';
import { createScene, placeSun, disposeTree, destroyScene } from './view3d/scene.js';
import { createLoop } from './view3d/loop.js';
import { createCard } from './view3d/card.js';
import { attachPicking } from './view3d/pick.js';
import { V, litRooms, layers, reduced } from './view3d/state.js';
import { shellHtml, syncButtons } from './view3d/shell.js';
import { bindActions } from './view3d/actions.js';
// 3D-модель по данным плана (Three.js грузится при первом открытии шага; план x→X, план y→Z, высота→Y).
export function mount(el, ctx) {
  const S = ctx.state;
  let dead = false;
  let stop = () => {};
  let api = null;
  if (V.litPid !== S.project.id) {
    V.litPid = S.project.id;
    litRooms.clear();
    V.lightMode = false;
  }
  el.innerHTML = shellHtml(S.project.rooms);
  const cv = el.querySelector('.c3');
  const card = el.querySelector('.rcard');
  const msg = el.querySelector('.c3msg');
  const sync = () => syncButtons(el);
  sync();
  const fail = (text, retry) => {
    cv.querySelector('canvas')?.remove();
    msg.hidden = false;
    msg.innerHTML = `<div><p>${text}</p>${retry ? '<button data-q="retry">Повторить</button>' : ''}</div>`;
  };
  const boot = () => {
    msg.hidden = false;
    msg.innerHTML = '<span class="spin" aria-hidden="true"></span>Загрузка 3D…';
    Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')])
      .then(([T, O]) => {
        if (dead) return;
        try {
          api = init({ S, cv, card, sync }, T, O.OrbitControls);
        } catch (e) {
          console.error(e);
          return fail('3D недоступно: браузер не смог создать графический контекст (WebGL). Остальные шаги работают.');
        }
        msg.hidden = true;
        stop = api.stop;
        if (S.focus) {
          const f = S.focus;
          S.focus = null;
          api.focus(f.room, f.item);
        }
      })
      .catch(() => {
        if (!dead)
          fail('Не удалось загрузить 3D. Для первого запуска нужен интернет, потом модель работает без него.', true);
      });
  };
  boot();
  bindActions(el, { ctx, S, boot, sync, getApi: () => api });
  return () => {
    dead = true;
    stop();
  };
}

// Сцена Three.js. dom: { S, cv, card, sync }. Возвращает api для кнопок (view3d/actions.js).
function init(dom, T, Orbit) {
  const { S, cv, card, sync } = dom;
  const P = () => S.project;
  const pid = P().id;
  const setSel = id => {
    V.selId = id;
  };
  const { X, renderer } = createScene(T, Orbit, cv, {
    P,
    reduced,
    litRooms,
    layers,
    isLow: () => V.low,
    showCeil: () => V.ceil,
    lightMode: () => V.lightMode,
    updateCard: () => ui.updateCard(),
  });
  const { scene, camera, controls } = X;
  const ui = createCard(X, card, { getSel: () => V.selId, setSel });
  const cam = createCamera(X, {
    getSel: () => V.selId,
    setSel,
    setCurView: v => {
      V.curView = v;
    },
    sync,
    showSel: () => ui.showSel(),
  });
  cam.setInside(false);

  function build() {
    if (X.world) {
      disposeTree(X.world);
      scene.remove(X.world);
    }
    resetWorld(X);
    placeSun(X);
    buildElectric(X, P(), buildWalls(X, P()));
    scene.add(X.world);
    applyLayers(X);
    applyLight(X);
    ui.showSel();
    X.dirty = true;
  }

  const detachPick = attachPicking(X, { lightMode: () => V.lightMode, select: cam.select });
  const rl = createLoop(X, renderer, cv, build);

  build();
  restoreCamera(X, cam, pid);
  if (V.animPid !== pid && !reduced()) {
    X.wallsG.scale.y = 0.001;
    X.anim = { t0: performance.now(), ms: 900 };
  }
  V.animPid = pid;
  rl.start();
  return {
    build,
    select: cam.select,
    focus: cam.focus,
    view: cam.view,
    toggle: id => toggle(X, id),
    layers: () => applyLayers(X),
    light: () => applyLight(X),
    ceil: () => {
      X.ceils.forEach(c => {
        c.visible = V.ceil;
      });
      X.dirty = true;
    },
    stop: () => {
      V.lastCam = { pid, pos: camera.position.toArray(), tgt: controls.target.toArray() };
      rl.stop();
      detachPick();
      destroyScene(X, renderer);
    },
  };
}

// Камера возвращается туда, где её оставили (в том же проекте); иначе стандартный вид.
function restoreCamera(X, cam, pid) {
  const last = V.lastCam;
  if (last && last.pid === pid) {
    X.camera.position.fromArray(last.pos);
    X.controls.target.fromArray(last.tgt);
    cam.setInside(V.curView === 'inside');
    X.controls.update();
  } else {
    cam.view(V.curView === 'top' || V.curView === 'inside' ? V.curView : 'iso', true);
  }
}
