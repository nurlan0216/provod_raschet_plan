import { bounds } from './camera.js';

// 3D: рендерер, сцена, камера, свет и орбитальное управление.
// Возвращает { X, renderer }: X — общее состояние сцены, его наполняют и читают модули в js/view3d/.

/**
 * @param T      модуль three
 * @param Orbit  класс OrbitControls
 * @param cv     контейнер холста
 * @param deps   { P, reduced, litRooms, layers, isLow, showCeil, lightMode, updateCard } — доступ к состоянию экрана
 */
export function createScene(T, Orbit, cv, deps) {
  const W0 = cv.clientWidth || 340;
  const H0 = cv.clientHeight || 400;
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(W0, H0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.setClearColor(getComputedStyle(cv).backgroundColor);
  cv.prepend(renderer.domElement);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(45, W0 / H0, 0.05, 500);
  const hemi = new T.HemisphereLight(0xffffff, 0x8a8f98, 1.0);
  scene.add(hemi);
  const sun = new T.DirectionalLight(0xffffff, 1.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  const dom = renderer.domElement;
  const controls = new Orbit(camera, dom);
  dom.tabIndex = 0;
  dom.setAttribute('role', 'application');
  dom.setAttribute(
    'aria-label',
    '3D-модель квартиры. Стрелки двигают камеру. Комнату можно выбрать кнопками под холстом.',
  );
  controls.listenToKeyEvents(dom);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.touches = { ONE: T.TOUCH.ROTATE, TWO: T.TOUCH.DOLLY_PAN };
  // Если пользователь схватил сцену во время пролёта, пролёт прерывается и не борется с OrbitControls.
  controls.addEventListener('start', () => {
    X.tw = null;
  });

  const X = {
    T,
    scene,
    camera,
    controls,
    dom,
    hemi,
    sun,
    P: deps.P,
    reduced: deps.reduced,
    litRooms: deps.litRooms,
    layers: deps.layers,
    dirty: true,
    tw: null,
    anim: null,
    prevT: performance.now(),
    swAnim: [],
    isLow: deps.isLow,
    showCeil: deps.showCeil,
    lightMode: deps.lightMode,
    updateCard: deps.updateCard,
    world: null,
    wallsG: null,
    labelsG: null,
    picks: [],
    ceils: [],
    swPicks: [],
    halos: [],
    levers: [],
    wireMs: [],
    RM: {},
    RL: {},
    RG: {},
    iconG: {},
    lv: {},
    lt: {},
  };
  return { X, renderer };
}

/** Поставить солнце и границы его теней по размеру дома. */
export function placeSun(X) {
  const { sun } = X;
  const b = bounds(X);
  sun.position.set(b.cx + b.rad * 1.2, b.rad * 2, b.cz + b.rad * 0.8);
  sun.target.position.set(b.cx, 0, b.cz);
  const k = b.rad * 1.3;
  Object.assign(sun.shadow.camera, { left: -k, right: k, top: k, bottom: -k, near: 0.5, far: b.rad * 6 });
  sun.shadow.camera.updateProjectionMatrix();
}

/** Освободить GPU-память всего, что есть в группе (геометрии, материалы, текстуры, instanced-меши). */
export const disposeTree = root =>
  root.traverse(o => {
    if (o.isInstancedMesh) o.dispose();
    if (o.geometry) o.geometry.dispose();
    [].concat(o.material || []).forEach(m => {
      if (m.map) m.map.dispose();
      m.dispose();
    });
  });

/** Полностью освободить сцену: управление, ресурсы, WebGL-контекст (браузер держит их около 16) и холст. */
export function destroyScene(X, renderer) {
  X.controls.dispose();
  if (X.world) disposeTree(X.world);
  renderer.dispose();
  renderer.forceContextLoss();
  X.dom.remove();
}
