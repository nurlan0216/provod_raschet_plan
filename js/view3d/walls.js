import { shared, outer, wseg } from '../plan2d.js';
import { DOOR_H } from '../util.js';

// 3D: пол, стены с проёмами, потолок, подписи комнат. X — общее состояние сцены (см. init в view3d.js).

/** Подпись комнаты над стенами. */
export function label(T, text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(27,37,48,.88)';
  x.fillRect(8, 8, 240, 48);
  x.fillStyle = '#fff';
  x.font = '700 28px Manrope, Arial, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 128, 33, 224);
  const s = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(2.4, 0.6, 1);
  s.renderOrder = 10;
  return s;
}

/** Новый пустой мир: группы и все списки, которые наполняют walls, electric и light. */
export function resetWorld(X) {
  const T = X.T;
  X.world = new T.Group();
  X.wallsG = new T.Group();
  X.labelsG = new T.Group();
  X.world.add(X.wallsG, X.labelsG);
  Object.assign(X, { picks: [], ceils: [], swPicks: [], halos: [], levers: [], wireMs: [] });
  Object.assign(X, { RM: {}, RL: {}, RG: {}, iconG: {}, lv: {}, lt: {} });
}

/** Проёмы на стенах: отрезок линии, высоты, стекло ли. */
function collectOpenings(p) {
  const rs = p.rooms;
  const ops = [];
  const addOp = (r, o, y0, y1, glass) => {
    const s = wseg(r, o.wall);
    const a = s.a + o.pos;
    ops.push({ o: s.o, c: s.c, a, b: a + o.width, y0, y1, glass });
  };
  rs.forEach(r => {
    r.doors.forEach(d => addOp(r, d, 0, DOOR_H, false));
    r.windows.forEach(w => addOp(r, w, w.sill, w.sill + w.height, true));
  });
  const er = p.entrance && rs.find(x => x.id === p.entrance.roomId);
  if (er) addOp(er, p.entrance, 0, DOOR_H, false);
  return ops;
}

/** Кусок стены от a до b: коробки между проёмами и стекло окон. */
function wallPiece(X, ops, glassM, o, c, a, b2, H, t, color) {
  const T = X.T;
  const list = ops
    .filter(q => q.o === o && Math.abs(q.c - c) < 0.06 && q.b > a + 0.01 && q.a < b2 - 0.01)
    .sort((x, y) => x.a - y.a);
  const box = (u0, u1, y0, y1) => {
    if (u1 - u0 < 0.005 || y1 - y0 < 0.005) return;
    const m = new T.Mesh(new T.BoxGeometry(o === 'h' ? u1 - u0 : t, y1 - y0, o === 'h' ? t : u1 - u0), color);
    m.position.set(o === 'h' ? (u0 + u1) / 2 : c, (y0 + y1) / 2, o === 'h' ? c : (u0 + u1) / 2);
    m.castShadow = m.receiveShadow = true;
    X.wallsG.add(m);
  };
  let cur = a;
  list.forEach(q => {
    const qa = Math.max(q.a, a);
    const qb = Math.min(q.b, b2);
    const y0 = Math.min(q.y0, H);
    const y1 = Math.min(q.y1, H);
    box(cur - (cur === a ? t / 2 : 0), qa, 0, H);
    if (y0 > 0) box(qa, qb, 0, y0);
    if (y1 < H) box(qa, qb, y1, H);
    if (q.glass && y1 > y0) {
      const g = new T.Mesh(new T.PlaneGeometry(qb - qa, y1 - y0), glassM);
      const u = (qa + qb) / 2;
      g.position.set(o === 'h' ? u : c, (y0 + y1) / 2, o === 'h' ? c : u);
      if (o === 'v') g.rotation.y = Math.PI / 2;
      X.wallsG.add(g);
    }
    cur = Math.max(cur, qb);
  });
  box(cur - (cur === a ? t / 2 : 0), b2 + t / 2, 0, H);
}

/** Пол, потолок, невидимый «ящик» для нажатия, подпись, свет и стены одной комнаты. */
function buildRoom(X, r, k) {
  const { T, world } = X;
  const low = X.isLow();
  const { rs, sh, tIn, tOut, ops, glassM } = k;
  const cx = r.x + r.w / 2;
  const cz = r.y + r.l / 2;
  const H = low ? 0.3 : r.h;
  const rm = (X.RM[r.id] = {
    floor: new T.MeshStandardMaterial({ color: r.floor, roughness: 0.9 }),
    wall: new T.MeshStandardMaterial({ color: r.wall, roughness: 0.9 }),
    bf: new T.Color(r.floor),
    bw: new T.Color(r.wall),
  });
  X.lv[r.id] = X.lt[r.id] = X.litRooms.has(r.id) ? 1 : 0;
  const pl = (X.RL[r.id] = new T.PointLight(0xfff1cc, 0, Math.max(r.w, r.l) * 1.1, 1.2));
  pl.position.set(cx, Math.max(0.5, r.h - 0.4), cz);
  world.add(pl);
  const f = new T.Mesh(new T.BoxGeometry(r.w, 0.06, r.l), rm.floor);
  f.position.set(cx, -0.03, cz);
  f.receiveShadow = true;
  world.add(f);
  const c = new T.Mesh(
    new T.PlaneGeometry(r.w, r.l),
    new T.MeshStandardMaterial({ color: '#ffffff', side: T.DoubleSide }),
  );
  c.rotation.x = Math.PI / 2;
  c.position.set(cx, r.h, cz);
  c.visible = X.showCeil();
  X.ceils.push(c);
  world.add(c);
  const pk = new T.Mesh(
    new T.BoxGeometry(r.w, r.h, r.l),
    new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  pk.position.set(cx, r.h / 2, cz);
  pk.userData.id = r.id;
  X.picks.push(pk);
  world.add(pk);
  const lb = label(T, r.name);
  lb.position.set(cx, H + 0.45, cz);
  X.labelsG.add(lb);
  for (let wi = 0; wi < 4; wi++) {
    const A = wseg(r, wi);
    const ivs = sh.filter(x => x.i === r.id && x.wi === wi);
    outer(A, ivs).forEach(([a, b2]) => wallPiece(X, ops, glassM, A.o, A.c, a, b2, H, tOut, rm.wall));
    ivs
      .filter(x => x.i < x.j)
      .forEach(x => {
        const o2 = rs.find(q => q.id === x.j);
        const Hs = low ? 0.3 : Math.max(r.h, o2 ? o2.h : r.h);
        wallPiece(X, ops, glassM, A.o, A.c, x.lo, x.hi, Hs, tIn, rm.wall);
      });
  }
}

/** Все комнаты: возвращает общие стены и толщины для электрики. */
export function buildWalls(X, p) {
  const T = X.T;
  const rs = p.rooms;
  const glassM = new T.MeshStandardMaterial({
    color: 0x9fd0ff,
    transparent: true,
    opacity: 0.35,
    side: T.DoubleSide,
    depthWrite: false,
  });
  const ops = collectOpenings(p);
  const sh = shared(rs);
  const tOut = 0.2;
  const tIn = (p.settings.wallThickness || 10) / 100;
  rs.forEach(r => buildRoom(X, r, { rs, sh, tIn, tOut, ops, glassM }));
  return { sh, tIn, tOut };
}
