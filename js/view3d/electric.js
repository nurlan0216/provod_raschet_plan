// 3D: значки электрики (розетки, выключатели, лампы, коробки, щиток), провода по трассам расчёта и слои.
// X — общее состояние сцены (см. init в view3d.js).
import { calcProject } from '../calc.js';

const WCOL = { trunk: '#C93A2B', light: '#F2B705', sock: '#2B7DE9', power: '#E8830C', net: '#0E9F9D' };
const WLAYER = { light: 'light', sock: 'sock', power: 'sock', net: 'net' };
const NRM = [
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 0],
];
const ROT = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

/** Текстура свечения лампы или жёлтого кольца у выключателя. */
function glowTex(T, ring) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  if (ring) {
    x.strokeStyle = '#F2B705';
    x.lineWidth = 8;
    x.beginPath();
    x.arc(32, 32, 24, 0, 7);
    x.stroke();
    x.strokeStyle = '#1B2530';
    x.lineWidth = 2;
    x.beginPath();
    x.arc(32, 32, 29, 0, 7);
    x.stroke();
  } else {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,225,130,1)');
    g.addColorStop(1, 'rgba(255,200,80,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
  }
  return new T.CanvasTexture(c);
}

/** Материалы с кешем и мелкие помощники для значков. */
function makeKit(T) {
  const mats = {};
  const M = (c, o = {}) =>
    mats[c + JSON.stringify(o)] ||
    (mats[c + JSON.stringify(o)] = new T.MeshStandardMaterial({ color: c, roughness: 0.55, ...o }));
  const bx = (w, h, d, m, x = 0, y = 0, z = 0) => {
    const q = new T.Mesh(new T.BoxGeometry(w, h, d), m);
    q.position.set(x, y, z);
    return q;
  };
  const cyl = (rad, len, m, x, y, z) => {
    const q = new T.Mesh(new T.CylinderGeometry(rad, rad, len, 10), m);
    q.rotation.x = Math.PI / 2;
    q.position.set(x, y, z);
    return q;
  };
  return { M, bx, cyl };
}

/** Половина толщины стены в точке u: внутренняя или наружная. */
const innerOf = (sh, tIn, tOut) => (r, wi, u) =>
  (sh.some(q => q.i === r.id && q.wi === wi && u >= q.lo - 0.01 && u <= q.hi + 0.01) ? tIn : tOut) / 2;

/** Поставить значок на стену (или на потолок, если wall == null). */
function placeIcon(inner, g, r, it, depth) {
  if (it.wall == null) {
    g.position.set(r.x + it.x, it.z, r.y + (it.y || 0));
    return;
  }
  const wi = it.wall;
  const loc = wi === 0 ? [it.x, 0] : wi === 1 ? [r.w, it.x] : wi === 2 ? [it.x, r.l] : [0, it.x];
  const off = inner(r, wi, (wi % 2 ? r.y : r.x) + it.x) + depth / 2;
  g.position.set(r.x + loc[0] + NRM[wi][0] * off, it.z, r.y + loc[1] + NRM[wi][1] * off);
  g.rotation.y = ROT[wi];
}

/** Модель одного элемента. Возвращает { g, layer, depth } или null, если такой элемент не рисуем. */
function makeIcon(X, kit, r, it, rg) {
  const { T } = X;
  const { M, bx, cyl } = kit;
  const g = new T.Group();
  if (it.type === 'socket') {
    const pw = it.role === 'oven' || it.role === 'ac';
    g.add(
      bx(0.11, 0.11, 0.04, M(pw ? '#E8830C' : '#2B7DE9')),
      cyl(0.012, 0.02, M('#1B2530'), -0.025, 0, 0.03),
      cyl(0.012, 0.02, M('#1B2530'), 0.025, 0, 0.03),
    );
    return { g, layer: 'sock', depth: 0.04 };
  }
  if (it.type === 'switch') {
    const lev = bx(0.035, 0.055, 0.02, M('#1B2530'), 0, 0, 0.045);
    const pv = new T.Group();
    pv.add(lev);
    g.add(bx(0.11, 0.11, 0.03, M('#1B2530')), bx(0.09, 0.09, 0.01, M('#F4F2EC'), 0, 0, 0.02), pv);
    const ctl = it.ctl || r.id;
    pv.rotation.x = X.litRooms.has(ctl) ? -0.5 : 0.5;
    X.levers.push({ ctl, lever: pv, g });
    return { g, layer: 'light', depth: 0.04 };
  }
  if (it.type === 'lamp') {
    g.add(new T.Mesh(new T.CylinderGeometry(0.13, 0.13, 0.05, 20), rg.lamp));
    const sp = new T.Sprite(rg.glow);
    sp.scale.set(0.9, 0.9, 1);
    sp.position.y = -0.1;
    g.add(sp);
    g.position.set(r.x + it.x, r.h - 0.03, r.y + (it.y || 0));
    return { g, layer: 'light', depth: 0, onCeiling: true };
  }
  if (it.type === 'box') {
    g.add(bx(0.13, 0.13, 0.06, M('#E8830C')));
    return { g, layer: 'box', depth: 0.06 };
  }
  if (it.type === 'panel') {
    g.add(bx(0.3, 0.4, 0.1, M('#C93A2B')), bx(0.26, 0.36, 0.01, M('#8E2A20'), 0, 0, 0.055));
    return { g, layer: 'panel', depth: 0.1 };
  }
  if (it.type === 'rj45') {
    g.add(bx(0.09, 0.09, 0.03, M('#0E9F9D')), bx(0.04, 0.03, 0.01, M('#1B2530'), 0, 0, 0.02));
    return { g, layer: 'net', depth: 0.03 };
  }
  if (it.type === 'camera') {
    g.add(bx(0.1, 0.08, 0.1, M('#0E9F9D')), cyl(0.03, 0.06, M('#1B2530'), 0, 0, 0.08));
    return { g, layer: 'net', depth: 0.1 };
  }
  return null;
}

/** Значки всех элементов; у выключателей ещё невидимая зона нажатия и жёлтое кольцо. */
function buildIcons(X, rs, inner) {
  const { T, world } = X;
  const kit = makeKit(T);
  ['sock', 'light', 'net', 'box', 'panel'].forEach(k => {
    X.iconG[k] = new T.Group();
    world.add(X.iconG[k]);
  });
  const glowM = new T.SpriteMaterial({
    map: glowTex(T, false),
    blending: T.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const haloM = new T.SpriteMaterial({ map: glowTex(T, true), depthTest: false, transparent: true });
  rs.forEach(r => {
    const rg = (X.RG[r.id] = {
      glow: glowM.clone(),
      lamp: new T.MeshStandardMaterial({
        color: '#F2B705',
        emissive: '#F2B705',
        emissiveIntensity: 0.6,
        roughness: 0.4,
      }),
    });
    (r.items || []).forEach(it => {
      const icon = makeIcon(X, kit, r, it, rg);
      if (!icon) return;
      const { g, layer, depth } = icon;
      if (!icon.onCeiling) placeIcon(inner, g, r, it, depth);
      X.iconG[layer].add(g);
      if (it.type !== 'switch') return;
      const pick = new T.Mesh(
        new T.SphereGeometry(0.22, 8, 8),
        new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      pick.position.copy(g.position);
      pick.userData.ctl = it.ctl || r.id;
      X.swPicks.push(pick);
      world.add(pick);
      const h = new T.Sprite(haloM);
      h.scale.set(0.55, 0.55, 1);
      h.position.copy(g.position);
      h.renderOrder = 11;
      X.halos.push(h);
      world.add(h);
    });
  });
}

/** Отрезки проводов по трассам из calc.js: вертикали и горизонтали, у каждой группы свой небольшой сдвиг по высоте. */
function wireSegments(T, p, rs, inner) {
  const R = calcProject(p);
  const segs = {};
  const same = (u, v) => Math.abs(u[0] - v[0]) < 1e-6 && Math.abs(u[1] - v[1]) < 1e-6;
  (R.routes || []).forEach(rt => {
    const ro = ((rt.gid % 5) - 2) * 0.02;
    const src = rt.pts;
    const shifted = new Set();
    const pts = src.map(q => [q[0], q[1], q[2] + (Math.abs(q[2] - rt.zr) < 1e-6 ? ro : 0)]);
    const inset = (end, idxs) => {
      const room = rs.find(x => x.id === end.rid);
      if (!room || end.wall == null) return;
      idxs.forEach(i => {
        if (shifted.has(i)) return;
        shifted.add(i);
        const wi = end.wall;
        const u = wi % 2 ? src[i][1] : src[i][0];
        const k = inner(room, wi, u) + 0.03;
        pts[i][0] += NRM[wi][0] * k;
        pts[i][1] += NRM[wi][1] * k;
      });
    };
    const n = src.length;
    const first = [];
    const last = [];
    for (let i = 0; i < n && same(src[i], src[0]); i++) first.push(i);
    for (let i = n - 1; i >= 0 && same(src[i], src[n - 1]); i--) last.push(i);
    inset(rt.a, first);
    inset(rt.b, last);
    for (let i = 1; i < n; i++) {
      const a = new T.Vector3(pts[i - 1][0], pts[i - 1][2], pts[i - 1][1]);
      const b = new T.Vector3(pts[i][0], pts[i][2], pts[i][1]);
      if (a.distanceTo(b) > 0.005) (segs[rt.kind] = segs[rt.kind] || []).push([a, b]);
    }
  });
  return segs;
}

/** Провода: по одной InstancedMesh на вид линии. */
function buildWires(X, p, rs, inner) {
  const { T, world } = X;
  const segs = wireSegments(T, p, rs, inner);
  const Y = new T.Vector3(0, 1, 0);
  const unit = new T.CylinderGeometry(0.022, 0.022, 1, 6);
  const dm = new T.Object3D();
  Object.entries(segs).forEach(([k, list]) => {
    const mat = new T.MeshStandardMaterial({
      color: WCOL[k],
      emissive: WCOL[k],
      emissiveIntensity: 0.15,
      roughness: 0.5,
    });
    const im = new T.InstancedMesh(unit.clone(), mat, list.length);
    list.forEach(([a, b], i) => {
      const d = b.clone().sub(a);
      const len = d.length();
      dm.position.copy(a).add(b).multiplyScalar(0.5);
      dm.quaternion.setFromUnitVectors(Y, d.normalize());
      dm.scale.set(1, len, 1);
      dm.updateMatrix();
      im.setMatrixAt(i, dm.matrix);
    });
    im.userData.cat = k;
    X.wireMs.push(im);
    world.add(im);
  });
  unit.dispose();
}

export function buildElectric(X, p, geo) {
  const rs = p.rooms;
  const inner = innerOf(geo.sh, geo.tIn, geo.tOut);
  buildIcons(X, rs, inner);
  buildWires(X, p, rs, inner);
}

/** Показать или скрыть провода, значки и подписи по переключателям слоёв. */
export function applyLayers(X) {
  const layers = X.layers;
  X.wireMs.forEach(m => {
    const c = m.userData.cat;
    m.visible = layers.wires && (c === 'trunk' || layers[WLAYER[c]]);
  });
  const g = X.iconG;
  if (g.sock) {
    g.sock.visible = layers.sock;
    g.light.visible = layers.light;
    g.net.visible = layers.net;
    g.box.visible = layers.wires;
    g.panel.visible = true;
  }
  if (X.labelsG) X.labelsG.visible = layers.labels;
  X.dirty = true;
}
