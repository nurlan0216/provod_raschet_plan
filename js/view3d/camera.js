// 3D: камера: границы дома, пролёт к виду или комнате, выбор комнаты, метка элемента.
// X — общее состояние сцены; h — доступ к состоянию view3d.js: { getSel, setSel, setCurView, sync, showSel }.

/** Центр и радиус всех комнат на плане. */
export function bounds(X) {
  const rs = X.P().rooms;
  if (!rs.length) return { cx: 0, cz: 0, rad: 5 };
  const x0 = Math.min(...rs.map(r => r.x));
  const x1 = Math.max(...rs.map(r => r.x + r.w));
  const z0 = Math.min(...rs.map(r => r.y));
  const z1 = Math.max(...rs.map(r => r.y + r.l));
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, rad: Math.hypot(x1 - x0, z1 - z0) / 2 + 1 };
}

/** Точка элемента на общем плане. */
const itemXY = (r, it) => {
  const u = it.x;
  const w = it.wall;
  if (w == null) return [r.x + u, r.y + (it.y || 0)];
  if (w === 0) return [r.x + u, r.y];
  if (w === 1) return [r.x + r.w, r.y + u];
  if (w === 2) return [r.x + u, r.y + r.l];
  return [r.x, r.y + u];
};

// Красная сетка на элементе. Возвращает [позиция камеры, цель] или null, если элемента нет.
function placeMark(X, rid, iid) {
  const { T, scene } = X;
  if (X.mark) {
    scene.remove(X.mark);
    X.mark.geometry.dispose();
    X.mark.material.dispose();
    X.mark = null;
    X.dirty = true;
  }
  const r = X.P().rooms.find(x => x.id === rid);
  const it = r && iid && r.items.find(x => x.id === iid);
  if (!it) return null;
  const pt = itemXY(r, it);
  X.mark = new T.Mesh(
    new T.SphereGeometry(0.22, 16, 12),
    new T.MeshBasicMaterial({ color: 0xc93a2b, wireframe: true }),
  );
  X.mark.position.set(pt[0], it.z, pt[1]);
  scene.add(X.mark);
  const dx = r.x + r.w / 2 - pt[0];
  const dz = r.y + r.l / 2 - pt[1];
  const l = Math.hypot(dx, dz) || 1;
  return [
    [pt[0] + (dx / l) * 2.2, Math.min(r.h - 0.1, it.z + 1), pt[1] + (dz / l) * 2.2],
    [pt[0], it.z, pt[1]],
  ];
}

export function createCamera(X, h) {
  const { T, camera, controls } = X;
  const P = X.P;

  const setInside = v => {
    controls.minDistance = v ? 0.02 : 0.5;
    controls.maxPolarAngle = v ? Math.PI * 0.99 : Math.PI / 2 - 0.03;
  };

  function flyTo(p, t, ms = 700) {
    const P1 = new T.Vector3(...p);
    const T1 = new T.Vector3(...t);
    if (!ms || X.reduced()) {
      camera.position.copy(P1);
      controls.target.copy(T1);
      controls.update();
      X.dirty = true;
      return;
    }
    X.tw = { t0: performance.now(), ms, p0: camera.position.clone(), q0: controls.target.clone(), p1: P1, q1: T1 };
  }

  /** Вид «изнутри»: из выбранной (или входной, или первой) комнаты в сторону центра дома. */
  function flyInside(b, ms) {
    const rs = P().rooms;
    const er = P().entrance && rs.find(x => x.id === P().entrance.roomId);
    const r = rs.find(x => x.id === h.getSel()) || er || rs[0];
    if (!r) return;
    const cx = r.x + r.w / 2;
    const cz = r.y + r.l / 2;
    let dx = b.cx - cx;
    let dz = b.cz - cz;
    const l = Math.hypot(dx, dz);
    if (l < 0.5) {
      dx = 0;
      dz = -1;
    } else {
      dx /= l;
      dz /= l;
    }
    flyTo([cx, 1.6, cz], [cx + dx * 0.1, 1.6, cz + dz * 0.1], ms);
  }

  function view(name, instant) {
    const b = bounds(X);
    const d = (b.rad * 2.4) / Math.min(1, camera.aspect * 1.15);
    const ms = instant ? 0 : 800;
    setInside(name === 'inside');
    if (name === 'top') {
      flyTo([b.cx, d * 1.1, b.cz + 0.01], [b.cx, 0, b.cz], ms);
    } else if (name === 'iso') {
      const v = new T.Vector3(0.55, 0.7, 0.75).normalize().multiplyScalar(d);
      flyTo([b.cx + v.x, v.y, b.cz + v.z], [b.cx, 0, b.cz], ms);
    } else {
      flyInside(b, ms);
    }
  }

  function select(id, fly) {
    h.setSel(id);
    h.showSel();
    const r = P().rooms.find(x => x.id === id);
    if (r && fly) {
      const cx = r.x + r.w / 2;
      const cz = r.y + r.l / 2;
      const d = Math.max(r.w, r.l) * 1.2 + 3;
      const v = new T.Vector3(0.5, 0.8, 0.7).normalize().multiplyScalar(d);
      setInside(false);
      h.setCurView(null);
      h.sync();
      flyTo([cx + v.x, v.y, cz + v.z], [cx, 0.5, cz]);
    }
    X.dirty = true;
  }

  // «Показать на модели» из экрана проверки: подлететь к комнате и к элементу, пометить его красной сеткой
  function focus(rid, iid) {
    select(rid, true);
    const target = placeMark(X, rid, iid);
    if (target) flyTo(...target);
  }

  return { setInside, flyTo, view, select, focus };
}
