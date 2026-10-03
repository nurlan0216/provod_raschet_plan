import { fmt, area } from './model.js';
import { shared, outer, wseg } from './plan2d.js';
import { NORMS_NOTE, autoPlaceAll } from './rules.js';
import { calcProject } from './calc.js';
// 3D-модель по данным плана (Three.js грузится при первом открытии шага; план x→X, план y→Z, высота→Y).
let low = false, ceil = false, selId = null, animPid = null, lastCam = null, curView = 'iso';
let lightMode = false, litPid = null; const litRooms = new Set();
const layers = { wires: true, sock: true, light: true, net: true, labels: true };
const LAYERS = [['wires', 'Провода'], ['sock', 'Розетки'], ['light', 'Свет'], ['net', 'Интернет'], ['labels', 'Подписи']];
const WCOL = { trunk: '#C93A2B', light: '#F2B705', sock: '#2B7DE9', power: '#E8830C', net: '#0E9F9D' };
const WLAYER = { light: 'light', sock: 'sock', power: 'sock', net: 'net' };
const NRM = [[0, 1], [-1, 0], [0, -1], [1, 0]], ROT = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DOOR_H = 2.1;

export function mount(el, ctx) {
  const S = ctx.state; let dead = false, stop = () => {}, api = null;
  if (litPid !== S.project.id) { litPid = S.project.id; litRooms.clear(); lightMode = false; }
  el.innerHTML = `<div class="tools"><button data-q="view" data-v="iso">Под углом</button><button data-q="view" data-v="top">Сверху</button><button data-q="view" data-v="inside">Изнутри</button></div>
    <div class="canvas c3"><div class="c3msg muted">Загрузка 3D…</div><div class="rcard" hidden></div></div>
    <div class="tools"><button data-q="ceil">Показать потолок</button><button data-q="low">Стены ниже</button></div>
    <div class="tools" role="group" aria-label="Слои">${LAYERS.map(([k, t]) => `<button data-q="layer" data-l="${k}">${t}</button>`).join('')}</div>
    <p class="muted small">Провода: <b style="color:var(--red)">■</b> от щитка к коробкам · <b style="color:#B38600">■</b> свет · <b style="color:var(--blue)">■</b> розетки · <b style="color:#E8830C">■</b> мощные линии · <b style="color:var(--teal)">■</b> интернет и камеры. Значки и провода чуть крупнее настоящих, чтобы их было видно.</p>
    <div class="row"><button data-q="light">Проверить свет</button></div>
    <p class="muted small" id="lhint" hidden>Нажмите на выключатель (он обведён жёлтым кругом): свет включится в его комнате. Нажмите ещё раз, и свет погаснет. Свет также можно включить кнопкой в карточке комнаты.</p>
    <div class="row"><button class="primary" data-q="autoall">Расставить по правилам везде</button></div>
    <p class="muted small">${esc(NORMS_NOTE)}</p>
    <p class="muted small">Нажмите на комнату, чтобы подлететь к ней. Один палец — вращать, два пальца — приближать и двигать.</p>`;
  const cv = el.querySelector('.c3'), card = el.querySelector('.rcard'), msg = el.querySelector('.c3msg');
  const sync = () => { el.querySelectorAll('[data-q=view]').forEach(b => b.classList.toggle('on', b.dataset.v === curView));
    el.querySelector('[data-q=ceil]').classList.toggle('on', ceil); el.querySelector('[data-q=low]').classList.toggle('on', low);
    el.querySelectorAll('[data-q=layer]').forEach(b => { const on = layers[b.dataset.l]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    const lb = el.querySelector('[data-q=light]'); lb.classList.toggle('on', lightMode); lb.setAttribute('aria-pressed', lightMode); lb.textContent = lightMode ? 'Выйти из проверки света' : 'Проверить свет';
    el.querySelector('#lhint').hidden = !lightMode; };
  sync();
  Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')])
    .then(([T, O]) => { if (dead) return; msg.remove(); api = init(T, O.OrbitControls); stop = api.stop; if (S.focus) { const f = S.focus; S.focus = null; api.focus(f.room, f.item); } })
    .catch(() => { msg.textContent = 'Не удалось загрузить 3D. Для первого запуска нужен интернет, потом модель работает без него.'; });
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-q]'); if (!b) return; const a = b.dataset.q;
    if (a === 'autoall') {
      if (!S.project.rooms.length) return;
      if (S.project.rooms.some(r => r.items.length) && !await ctx.confirmBox('В комнатах уже есть элементы. Расставить везде заново? Старые заменятся новыми (это можно отменить кнопкой «Отменить»).', 'Да, расставить заново')) return;
      let rep; ctx.commit(p => { rep = autoPlaceAll(p); });
      const bad = rep.issues.filter(x => x.level === 'error').length;
      ctx.toast(`Расставлено: розеток ${rep.n.socket}, ламп ${rep.n.lamp}, выключателей ${rep.n.switch}. ` + (bad ? `Есть замечания (${bad}): откройте комнату, там они объяснены.` : rep.tips.length ? 'Замечаний по нормам нет.' : 'Замечаний нет.'));
      return;
    }
    if (!api) return;
    if (a === 'view') { curView = b.dataset.v; api.view(curView); }
    else if (a === 'ceil') { ceil = !ceil; api.ceil(); }
    else if (a === 'low') { low = !low; api.build(); }
    else if (a === 'layer') { layers[b.dataset.l] = !layers[b.dataset.l]; api.layers(); }
    else if (a === 'light') {
      if (!lightMode && !S.project.rooms.some(r => r.items.some(i => i.type === 'switch'))) { ctx.toast('Выключателей пока нет. Нажмите «Расставить по правилам везде», потом проверяйте свет.'); return; }
      lightMode = !lightMode; api.light();
    }
    else if (a === 'lighttoggle') { if (selId) api.toggle(selId); }
    else if (a === 'close') api.select(null, false);
    else if (a === 'open' || a === 'addel') { if (selId) ctx.openRoom(selId); }
    sync();
  });

  function init(T, Orbit) {
    const P = () => S.project, pid = S.project.id;
    const W0 = cv.clientWidth || 340, H0 = cv.clientHeight || 400;
    const renderer = new T.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(W0, H0);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.setClearColor(getComputedStyle(cv).backgroundColor); cv.prepend(renderer.domElement);
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(45, W0 / H0, 0.05, 500);
    const hemi = new T.HemisphereLight(0xffffff, 0x8a8f98, 1.0); scene.add(hemi);
    const sun = new T.DirectionalLight(0xffffff, 1.4); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 4; scene.add(sun, sun.target);
    const controls = new Orbit(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.touches = { ONE: T.TOUCH.ROTATE, TWO: T.TOUCH.DOLLY_PAN };
    let inside = false, world = null, wallsG = null, frame = null, picks = [], ceils = [], dirty = true, tw = null, anim = null;
    let RM = {}, RL = {}, RG = {}, lv = {}, lt = {}, swPicks = [], halos = [], levers = [], swAnim = [], wireMs = [], iconG = {}, labelsG = null, prevT = performance.now();
    const setInside = v => { inside = v; controls.minDistance = v ? 0.02 : 0.5; controls.maxPolarAngle = v ? Math.PI * 0.99 : Math.PI / 2 - 0.03; };
    setInside(false);

    const bounds = () => { const rs = P().rooms; if (!rs.length) return { cx: 0, cz: 0, rad: 5 };
      const x0 = Math.min(...rs.map(r => r.x)), x1 = Math.max(...rs.map(r => r.x + r.w)), z0 = Math.min(...rs.map(r => r.y)), z1 = Math.max(...rs.map(r => r.y + r.l));
      return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, rad: Math.hypot(x1 - x0, z1 - z0) / 2 + 1 }; };
    function label(text) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
      x.fillStyle = 'rgba(27,37,48,.88)'; x.fillRect(8, 8, 240, 48); x.fillStyle = '#fff'; x.font = '700 28px Manrope, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 128, 33, 224);
      const s = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), depthTest: false, transparent: true })); s.scale.set(2.4, 0.6, 1); s.renderOrder = 10; return s;
    }
    function build() {
      if (world) { world.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); scene.remove(world); }
      world = new T.Group(); wallsG = new T.Group(); labelsG = new T.Group(); world.add(wallsG, labelsG); picks = []; ceils = [];
      const p = P(), rs = p.rooms; RM = {}; RL = {}; RG = {}; swPicks = []; halos = []; levers = []; wireMs = []; iconG = {}; lv = {}; lt = {};
      const glassM = new T.MeshStandardMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.35, side: T.DoubleSide, depthWrite: false });
      const b = bounds(); sun.position.set(b.cx + b.rad * 1.2, b.rad * 2, b.cz + b.rad * 0.8); sun.target.position.set(b.cx, 0, b.cz);
      Object.assign(sun.shadow.camera, { left: -b.rad * 1.3, right: b.rad * 1.3, top: b.rad * 1.3, bottom: -b.rad * 1.3, near: 0.5, far: b.rad * 6 }); sun.shadow.camera.updateProjectionMatrix();
      const ops = [], addOp = (r, o, y0, y1, glass) => { const s = wseg(r, o.wall), a = s.a + o.pos; ops.push({ o: s.o, c: s.c, a, b: a + o.width, y0, y1, glass }); };
      rs.forEach(r => { r.doors.forEach(d => addOp(r, d, 0, DOOR_H, false)); r.windows.forEach(w => addOp(r, w, w.sill, w.sill + w.height, true)); });
      const er = p.entrance && rs.find(x => x.id === p.entrance.roomId); if (er) addOp(er, p.entrance, 0, DOOR_H, false);
      const sh = shared(rs), tOut = 0.2, tIn = (p.settings.wallThickness || 10) / 100;
      function piece(o, c, a, b2, H, t, color) {
        const list = ops.filter(q => q.o === o && Math.abs(q.c - c) < 0.06 && q.b > a + 0.01 && q.a < b2 - 0.01).sort((x, y) => x.a - y.a);
        const box = (u0, u1, y0, y1) => { if (u1 - u0 < 0.005 || y1 - y0 < 0.005) return;
          const m = new T.Mesh(new T.BoxGeometry(o === 'h' ? u1 - u0 : t, y1 - y0, o === 'h' ? t : u1 - u0), color);
          m.position.set(o === 'h' ? (u0 + u1) / 2 : c, (y0 + y1) / 2, o === 'h' ? c : (u0 + u1) / 2); m.castShadow = m.receiveShadow = true; wallsG.add(m); };
        let cur = a;
        list.forEach(q => { const qa = Math.max(q.a, a), qb = Math.min(q.b, b2), y0 = Math.min(q.y0, H), y1 = Math.min(q.y1, H);
          box(cur - (cur === a ? t / 2 : 0), qa, 0, H); if (y0 > 0) box(qa, qb, 0, y0); if (y1 < H) box(qa, qb, y1, H);
          if (q.glass && y1 > y0) { const g = new T.Mesh(new T.PlaneGeometry(qb - qa, y1 - y0), glassM), u = (qa + qb) / 2;
            g.position.set(o === 'h' ? u : c, (y0 + y1) / 2, o === 'h' ? c : u); if (o === 'v') g.rotation.y = Math.PI / 2; wallsG.add(g); }
          cur = Math.max(cur, qb); });
        box(cur - (cur === a ? t / 2 : 0), b2 + t / 2, 0, H);
      }
      rs.forEach(r => {
        const cx = r.x + r.w / 2, cz = r.y + r.l / 2, H = low ? 0.3 : r.h;
        const rm = RM[r.id] = { floor: new T.MeshStandardMaterial({ color: r.floor, roughness: 0.9 }), wall: new T.MeshStandardMaterial({ color: r.wall, roughness: 0.9 }), bf: new T.Color(r.floor), bw: new T.Color(r.wall) };
        lv[r.id] = lt[r.id] = litRooms.has(r.id) ? 1 : 0;
        const pl = RL[r.id] = new T.PointLight(0xfff1cc, 0, Math.max(r.w, r.l) * 1.1, 1.2); pl.position.set(cx, Math.max(0.5, r.h - 0.4), cz); world.add(pl);
        const f = new T.Mesh(new T.BoxGeometry(r.w, 0.06, r.l), rm.floor); f.position.set(cx, -0.03, cz); f.receiveShadow = true; world.add(f);
        const c = new T.Mesh(new T.PlaneGeometry(r.w, r.l), new T.MeshStandardMaterial({ color: '#ffffff', side: T.DoubleSide })); c.rotation.x = Math.PI / 2; c.position.set(cx, r.h, cz); c.visible = ceil; ceils.push(c); world.add(c);
        const pk = new T.Mesh(new T.BoxGeometry(r.w, r.h, r.l), new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); pk.position.set(cx, r.h / 2, cz); pk.userData.id = r.id; picks.push(pk); world.add(pk);
        const lb = label(r.name); lb.position.set(cx, H + 0.45, cz); labelsG.add(lb);
        for (let wi = 0; wi < 4; wi++) { const A = wseg(r, wi), ivs = sh.filter(x => x.i === r.id && x.wi === wi);
          outer(A, ivs).forEach(([a, b2]) => piece(A.o, A.c, a, b2, H, tOut, rm.wall));
          ivs.filter(x => x.i < x.j).forEach(x => { const o2 = rs.find(q => q.id === x.j); piece(A.o, A.c, x.lo, x.hi, low ? 0.3 : Math.max(r.h, o2 ? o2.h : r.h), tIn, rm.wall); }); }
      });
      buildElectric(p, rs, sh, tIn, tOut);
      scene.add(world); applyLayers(); applyLight(); showSel(); dirty = true;
    }

    /* ---- электрика: значки, провода, свет ---- */
    function glowTex(ring) {
      const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
      if (ring) { x.strokeStyle = '#F2B705'; x.lineWidth = 8; x.beginPath(); x.arc(32, 32, 24, 0, 7); x.stroke(); x.strokeStyle = '#1B2530'; x.lineWidth = 2; x.beginPath(); x.arc(32, 32, 29, 0, 7); x.stroke(); }
      else { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,225,130,1)'); g.addColorStop(1, 'rgba(255,200,80,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); }
      return new T.CanvasTexture(c);
    }
    function buildElectric(p, rs, sh, tIn, tOut) {
      const mats = {}, M = (c, o = {}) => mats[c + JSON.stringify(o)] || (mats[c + JSON.stringify(o)] = new T.MeshStandardMaterial({ color: c, roughness: 0.55, ...o }));
      ['sock', 'light', 'net', 'box', 'panel'].forEach(k => { iconG[k] = new T.Group(); world.add(iconG[k]); });
      const bx = (w, h, d, m, x = 0, y = 0, z = 0) => { const q = new T.Mesh(new T.BoxGeometry(w, h, d), m); q.position.set(x, y, z); return q; };
      const cyl = (rad, len, m, x, y, z) => { const q = new T.Mesh(new T.CylinderGeometry(rad, rad, len, 10), m); q.rotation.x = Math.PI / 2; q.position.set(x, y, z); return q; };
      const inner = (r, wi, u) => (sh.some(q => q.i === r.id && q.wi === wi && u >= q.lo - 0.01 && u <= q.hi + 0.01) ? tIn : tOut) / 2;
      const place = (g, r, it, depth) => {
        if (it.wall == null) { g.position.set(r.x + it.x, it.z, r.y + (it.y || 0)); return; }
        const wi = it.wall, loc = wi === 0 ? [it.x, 0] : wi === 1 ? [r.w, it.x] : wi === 2 ? [it.x, r.l] : [0, it.x];
        const off = inner(r, wi, (wi % 2 ? r.y : r.x) + it.x) + depth / 2;
        g.position.set(r.x + loc[0] + NRM[wi][0] * off, it.z, r.y + loc[1] + NRM[wi][1] * off); g.rotation.y = ROT[wi];
      };
      const glowM = new T.SpriteMaterial({ map: glowTex(false), blending: T.AdditiveBlending, depthWrite: false, transparent: true });
      const haloM = new T.SpriteMaterial({ map: glowTex(true), depthTest: false, transparent: true });
      rs.forEach(r => {
        const rg = RG[r.id] = { glow: glowM.clone(), lamp: new T.MeshStandardMaterial({ color: '#F2B705', emissive: '#F2B705', emissiveIntensity: 0.6, roughness: 0.4 }) };
        (r.items || []).forEach(it => {
          const g = new T.Group(); let depth = 0.04, layer = 'sock';
          if (it.type === 'socket') {
            const pw = it.role === 'oven' || it.role === 'ac';
            g.add(bx(0.11, 0.11, 0.04, M(pw ? '#E8830C' : '#2B7DE9')), cyl(0.012, 0.02, M('#1B2530'), -0.025, 0, 0.03), cyl(0.012, 0.02, M('#1B2530'), 0.025, 0, 0.03));
          } else if (it.type === 'switch') {
            layer = 'light'; depth = 0.04; const lev = bx(0.035, 0.055, 0.02, M('#1B2530'), 0, 0, 0.045), pv = new T.Group(); pv.add(lev);
            g.add(bx(0.11, 0.11, 0.03, M('#1B2530')), bx(0.09, 0.09, 0.01, M('#F4F2EC'), 0, 0, 0.02), pv);
            const ctl = it.ctl || r.id; pv.rotation.x = litRooms.has(ctl) ? -0.5 : 0.5; levers.push({ ctl, lever: pv, g });
          } else if (it.type === 'lamp') {
            layer = 'light'; const d = new T.Mesh(new T.CylinderGeometry(0.13, 0.13, 0.05, 20), rg.lamp); g.add(d);
            const sp = new T.Sprite(rg.glow); sp.scale.set(0.9, 0.9, 1); sp.position.y = -0.1; g.add(sp); g.position.set(r.x + it.x, r.h - 0.03, r.y + (it.y || 0));
            iconG[layer].add(g); return;
          } else if (it.type === 'box') { layer = 'box'; depth = 0.06; g.add(bx(0.13, 0.13, 0.06, M('#E8830C'))); }
          else if (it.type === 'panel') { layer = 'panel'; depth = 0.1; g.add(bx(0.3, 0.4, 0.1, M('#C93A2B')), bx(0.26, 0.36, 0.01, M('#8E2A20'), 0, 0, 0.055)); }
          else if (it.type === 'rj45') { layer = 'net'; depth = 0.03; g.add(bx(0.09, 0.09, 0.03, M('#0E9F9D')), bx(0.04, 0.03, 0.01, M('#1B2530'), 0, 0, 0.02)); }
          else if (it.type === 'camera') { layer = 'net'; depth = 0.1; g.add(bx(0.1, 0.08, 0.1, M('#0E9F9D')), cyl(0.03, 0.06, M('#1B2530'), 0, 0, 0.08)); }
          else return;
          place(g, r, it, depth); iconG[layer].add(g);
          if (it.type === 'switch') {
            const pick = new T.Mesh(new T.SphereGeometry(0.22, 8, 8), new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); pick.position.copy(g.position); pick.userData.ctl = it.ctl || r.id; swPicks.push(pick); world.add(pick);
            const h = new T.Sprite(haloM); h.scale.set(0.55, 0.55, 1); h.position.copy(g.position); h.renderOrder = 11; halos.push(h); world.add(h);
          }
        });
      });
      // провода по трассам из calc.js: вертикали и горизонтали, у каждой группы свой небольшой сдвиг по высоте
      const R = calcProject(p), segs = {}, Y = new T.Vector3(0, 1, 0), same = (u, v) => Math.abs(u[0] - v[0]) < 1e-6 && Math.abs(u[1] - v[1]) < 1e-6;
      (R.routes || []).forEach(rt => {
        const ro = ((rt.gid % 5) - 2) * 0.02, src = rt.pts, shifted = new Set();
        const pts = src.map(q => [q[0], q[1], q[2] + (Math.abs(q[2] - rt.zr) < 1e-6 ? ro : 0)]);
        const inset = (end, idxs) => { const room = rs.find(x => x.id === end.rid); if (!room || end.wall == null) return;
          idxs.forEach(i => { if (shifted.has(i)) return; shifted.add(i); const wi = end.wall, u = wi % 2 ? src[i][1] : src[i][0], k = inner(room, wi, u) + 0.03;
            pts[i][0] += NRM[wi][0] * k; pts[i][1] += NRM[wi][1] * k; }); };
        const n = src.length, first = [], last = [];
        for (let i = 0; i < n && same(src[i], src[0]); i++) first.push(i);
        for (let i = n - 1; i >= 0 && same(src[i], src[n - 1]); i--) last.push(i);
        inset(rt.a, first); inset(rt.b, last);
        for (let i = 1; i < n; i++) { const a = new T.Vector3(pts[i - 1][0], pts[i - 1][2], pts[i - 1][1]), b = new T.Vector3(pts[i][0], pts[i][2], pts[i][1]);
          if (a.distanceTo(b) > 0.005) (segs[rt.kind] = segs[rt.kind] || []).push([a, b]); }
      });
      const unit = new T.CylinderGeometry(0.022, 0.022, 1, 6), dm = new T.Object3D();
      Object.entries(segs).forEach(([k, list]) => {
        const im = new T.InstancedMesh(unit.clone(), new T.MeshStandardMaterial({ color: WCOL[k], emissive: WCOL[k], emissiveIntensity: 0.15, roughness: 0.5 }), list.length);
        list.forEach(([a, b], i) => { const d = b.clone().sub(a), len = d.length(); dm.position.copy(a).add(b).multiplyScalar(0.5); dm.quaternion.setFromUnitVectors(Y, d.normalize()); dm.scale.set(1, len, 1); dm.updateMatrix(); im.setMatrixAt(i, dm.matrix); });
        im.userData.cat = k; wireMs.push(im); world.add(im);
      });
      unit.dispose();
    }
    function applyLayers() {
      wireMs.forEach(m => { const c = m.userData.cat; m.visible = layers.wires && (c === 'trunk' || layers[WLAYER[c]]); });
      if (iconG.sock) { iconG.sock.visible = layers.sock; iconG.light.visible = layers.light; iconG.net.visible = layers.net; iconG.box.visible = layers.wires; iconG.panel.visible = true; }
      if (labelsG) labelsG.visible = layers.labels; dirty = true;
    }
    function paint(id) {
      const m = RM[id]; if (!m) return; const l = lv[id] || 0, k = lightMode ? 0.28 + 0.72 * l : 1, e = lightMode ? 0.12 * l : 0;
      m.floor.color.copy(m.bf).multiplyScalar(k); m.wall.color.copy(m.bw).multiplyScalar(k);
      m.floor.emissive.setRGB(1, 0.85, 0.55).multiplyScalar(e); m.wall.emissive.setRGB(1, 0.85, 0.55).multiplyScalar(e);
      if (RL[id]) RL[id].intensity = lightMode ? 8 * l : 0;
      if (RG[id]) { RG[id].glow.opacity = lightMode ? l : 0.35; RG[id].lamp.emissiveIntensity = lightMode ? 0.1 + 0.9 * l : 0.6; }
      dirty = true;
    }
    function applyLight() {
      hemi.intensity = lightMode ? 0.45 : 1.0; sun.intensity = lightMode ? 0.35 : 1.4;
      halos.forEach(h => { h.visible = lightMode; }); Object.keys(RM).forEach(paint); updateCard(); dirty = true;
    }
    function toggle(id) {
      const on = !litRooms.has(id); on ? litRooms.add(id) : litRooms.delete(id); lt[id] = on ? 1 : 0;
      if (reduced()) { lv[id] = lt[id]; paint(id); }
      levers.filter(q => q.ctl === id).forEach(q => { q.lever.rotation.x = on ? -0.5 : 0.5; if (!reduced()) swAnim.push({ g: q.g, t0: performance.now() }); });
      updateCard(); dirty = true;
    }
    function showSel() {
      if (frame) { scene.remove(frame); frame.geometry.dispose(); frame = null; }
      const r = P().rooms.find(x => x.id === selId); if (!r) { selId = null; updateCard(); return; }
      frame = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(r.w, r.h, r.l)), new T.LineBasicMaterial({ color: 0xF2B705 }));
      frame.position.set(r.x + r.w / 2, r.h / 2, r.y + r.l / 2); scene.add(frame); updateCard();
    }
    function updateCard() {
      const r = P().rooms.find(x => x.id === selId); if (!r) { card.hidden = true; return; }
      const n = t => r.items.filter(i => i.type === t).length; card.hidden = false;
      card.innerHTML = `<button class="x" data-q="close" aria-label="Закрыть">✕</button><b>${esc(r.name)}</b>
        <div class="muted">${fmt(area(r))} м² · розеток: ${n('socket')} · ламп: ${n('lamp')} · групп: ${calcProject(P()).groupsByRoom?.[r.id] ?? 0}</div>
        <div class="row"><button class="primary" data-q="open">Открыть комнату</button><button data-q="addel">Добавить электрику</button>${lightMode && r.items.some(i => i.type === 'lamp') ? `<button data-q="lighttoggle">${litRooms.has(r.id) ? 'Выключить свет' : 'Включить свет'}</button>` : ''}</div>`;
    }
    function flyTo(p, t, ms = 700) {
      const P1 = new T.Vector3(...p), T1 = new T.Vector3(...t);
      if (!ms || reduced()) { camera.position.copy(P1); controls.target.copy(T1); controls.update(); dirty = true; return; }
      tw = { t0: performance.now(), ms, p0: camera.position.clone(), q0: controls.target.clone(), p1: P1, q1: T1 };
    }
    function view(name, instant) {
      const b = bounds(), d = b.rad * 2.4 / Math.min(1, camera.aspect * 1.15), ms = instant ? 0 : 800; setInside(name === 'inside');
      if (name === 'top') flyTo([b.cx, d * 1.1, b.cz + 0.01], [b.cx, 0, b.cz], ms);
      else if (name === 'iso') { const v = new T.Vector3(0.55, 0.7, 0.75).normalize().multiplyScalar(d); flyTo([b.cx + v.x, v.y, b.cz + v.z], [b.cx, 0, b.cz], ms); }
      else { const rs = P().rooms, er = P().entrance && rs.find(x => x.id === P().entrance.roomId), r = rs.find(x => x.id === selId) || er || rs[0]; if (!r) return;
        const cx = r.x + r.w / 2, cz = r.y + r.l / 2; let dx = b.cx - cx, dz = b.cz - cz; const l = Math.hypot(dx, dz); if (l < 0.5) { dx = 0; dz = -1; } else { dx /= l; dz /= l; }
        flyTo([cx, 1.6, cz], [cx + dx * 0.1, 1.6, cz + dz * 0.1], ms); }
    }
    function select(id, fly) {
      selId = id; showSel();
      const r = P().rooms.find(x => x.id === id);
      if (r && fly) { const cx = r.x + r.w / 2, cz = r.y + r.l / 2, d = Math.max(r.w, r.l) * 1.2 + 3, v = new T.Vector3(0.5, 0.8, 0.7).normalize().multiplyScalar(d);
        setInside(false); curView = null; sync(); flyTo([cx + v.x, v.y, cz + v.z], [cx, 0.5, cz]); }
      dirty = true;
    }
    // «Показать на модели» из экрана проверки: подлететь к комнате и к элементу, пометить его красной сеткой
    let mark = null;
    function focus(rid, iid) {
      select(rid, true);
      if (mark) { scene.remove(mark); mark.geometry.dispose(); mark.material.dispose(); mark = null; dirty = true; }
      const r = P().rooms.find(x => x.id === rid), it = r && iid && r.items.find(x => x.id === iid); if (!it) return;
      const u = it.x, w = it.wall, pt = w == null ? [r.x + u, r.y + (it.y || 0)] : w === 0 ? [r.x + u, r.y] : w === 1 ? [r.x + r.w, r.y + u] : w === 2 ? [r.x + u, r.y + r.l] : [r.x, r.y + u];
      mark = new T.Mesh(new T.SphereGeometry(0.22, 16, 12), new T.MeshBasicMaterial({ color: 0xC93A2B, wireframe: true }));
      mark.position.set(pt[0], it.z, pt[1]); scene.add(mark);
      const dx = r.x + r.w / 2 - pt[0], dz = r.y + r.l / 2 - pt[1], l = Math.hypot(dx, dz) || 1;
      flyTo([pt[0] + dx / l * 2.2, Math.min(r.h - 0.1, it.z + 1), pt[1] + dz / l * 2.2], [pt[0], it.z, pt[1]]);
    }
    /* ---- нажатие на комнату ---- */
    const ray = new T.Raycaster(), v2 = new T.Vector2(); let count = 0, multi = false, down = null;
    const dom = renderer.domElement;
    const onDown = e => { count++; if (count > 1) multi = true; down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    const onUp = e => { count = Math.max(0, count - 1); if (count) return;
      if (!multi && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && performance.now() - down.t < 600) {
        const b = dom.getBoundingClientRect(); v2.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
        ray.setFromCamera(v2, camera);
        const sw = lightMode ? ray.intersectObjects(swPicks, false)[0] : null;
        if (sw) toggle(sw.object.userData.ctl);
        else { const h = ray.intersectObjects(picks, false)[0]; select(h ? h.object.userData.id : null, !!h); } }
      multi = false; down = null; };
    dom.addEventListener('pointerdown', onDown); dom.addEventListener('pointerup', onUp); dom.addEventListener('pointercancel', onUp);
    /* ---- размер, цикл, очистка ---- */
    const ro = new ResizeObserver(() => { const w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true; });
    ro.observe(cv);
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop); const now = performance.now(); let ch = false;
      if (tw) { const k = Math.min(1, (now - tw.t0) / tw.ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        camera.position.lerpVectors(tw.p0, tw.p1, e); controls.target.lerpVectors(tw.q0, tw.q1, e); if (k >= 1) tw = null; ch = true; }
      if (anim) { const k = Math.min(1, (now - anim.t0) / anim.ms); wallsG.scale.y = Math.max(0.001, 1 - Math.pow(1 - k, 3)); if (k >= 1) { anim = null; wallsG.scale.y = 1; } ch = true; }
      const dt = now - prevT; prevT = now;
      for (const id in lt) if (lv[id] !== lt[id]) { const st = reduced() ? 1 : dt / 350; lv[id] = lv[id] < lt[id] ? Math.min(lt[id], lv[id] + st) : Math.max(lt[id], lv[id] - st); paint(id); ch = true; }
      if (swAnim.length) { swAnim = swAnim.filter(q => { const k = (now - q.t0) / 320; q.g.scale.setScalar(k >= 1 ? 1 : 1 + 0.3 * Math.sin(Math.PI * k) * (1 - k)); return k < 1; }); ch = true; }
      if (controls.update()) ch = true;
      if (ch || dirty) { renderer.render(scene, camera); dirty = false; }
    };
    build();
    if (lastCam && lastCam.pid === pid) { camera.position.fromArray(lastCam.pos); controls.target.fromArray(lastCam.tgt); setInside(curView === 'inside'); controls.update(); }
    else view(curView === 'top' || curView === 'inside' ? curView : 'iso', true);
    if (animPid !== pid && !reduced()) { wallsG.scale.y = 0.001; anim = { t0: performance.now(), ms: 900 }; }
    animPid = pid; loop();
    return {
      build, select, focus, view, toggle, layers: applyLayers, light: applyLight, ceil: () => { ceils.forEach(c => { c.visible = ceil; }); dirty = true; },
      stop: () => { cancelAnimationFrame(raf); lastCam = { pid, pos: camera.position.toArray(), tgt: controls.target.toArray() };
        ro.disconnect(); dom.removeEventListener('pointerdown', onDown); dom.removeEventListener('pointerup', onUp); dom.removeEventListener('pointercancel', onUp);
        controls.dispose(); if (world) world.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
        renderer.dispose(); dom.remove(); }
    };
  }
  return () => { dead = true; stop(); };
}
