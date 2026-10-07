import { fmt } from '../model.js';
import { esc, clamp, wallLen as wl, wallPt as wp } from '../util.js';
import { WALLS, snap } from './consts.js';

// Три вида комнаты. Каждый возвращает { h: SVG-разметка, pos: [[item, x, y]], boxCss, svgCss, G? }.
// G нужен для пересчёта координат касания в координаты комнаты (locate).

const topHeight = () => Math.min(innerHeight * 0.6, 460);

export function viewUnroll(r, ops, items) {
  const s = Math.min(90, 260 / r.h);
  const gap = 0.25;
  const lens = [r.w, r.l, r.w, r.l];
  const y0 = 26;
  const fl = y0 + r.h * s;
  const ux = [];
  let u = 12;
  lens.forEach((L, i) => {
    ux[i] = u;
    u += (L + gap) * s;
  });
  const Hh = fl + 24;
  let h = '';
  lens.forEach((L, i) => {
    h += `<rect x="${ux[i]}" y="${y0}" width="${L * s}" height="${r.h * s}" fill="${r.wall}" stroke="var(--text)" stroke-width="2"/><text x="${ux[i]}" y="${y0 - 8}" class="t-m" font-weight="700" fill="currentColor">${WALLS[i]} · ${fmt(L)} м</text>`;
    h += heightMarks(ux[i], L, s, fl, i === 0);
  });
  ops.forEach(o => {
    h += unrollOpening(o, ux, s, fl);
  });
  const pos = [];
  items.forEach(i => {
    if (i.wall == null) return;
    pos.push([i, ux[i.wall] + i.x * s, fl - i.z * s]);
  });
  return {
    h,
    pos,
    G: { s, gap, ux, lens, fl },
    boxCss: `height:${Hh}px;min-height:0;overflow-x:auto;overflow-y:hidden`,
    svgCss: `width:${u + 4}px;height:${Hh}px;touch-action:pan-x pan-y`,
  };
}

function heightMarks(x0, L, s, fl, withLabel) {
  let h = '';
  [0.3, 0.9].forEach(z => {
    h += `<line x1="${x0}" x2="${x0 + L * s}" y1="${fl - z * s}" y2="${fl - z * s}" stroke="#8a8f98" stroke-dasharray="4 4" opacity=".6"/>`;
    if (withLabel)
      h += `<text x="${x0 + 3}" y="${fl - z * s - 3}" class="t-s" fill="var(--muted)">${z * 100} см</text>`;
  });
  return h;
}

function unrollOpening(o, ux, s, fl) {
  const win = o.k === 'win';
  const x = ux[o.wall] + o.pos * s;
  const y1 = win ? fl - (o.sill + o.height) * s : fl - 2.1 * s;
  const y2 = win ? fl - o.sill * s : fl;
  return `<rect x="${x}" y="${y1}" width="${o.width * s}" height="${y2 - y1}" fill="${win ? 'rgba(43,125,233,.25)' : 'rgba(0,0,0,.08)'}" stroke="${win ? 'var(--blue)' : 'var(--muted)'}" stroke-width="2"/>`;
}

const P3 = (X, Y, Z) => [(X - Z) * 0.866, (X + Z) * 0.5 - Y];

export function viewIso(r, items, W) {
  const pts = [
    [0, 0, 0],
    [r.w, 0, 0],
    [r.w, 0, r.l],
    [0, 0, r.l],
    [0, r.h, 0],
    [r.w, r.h, 0],
    [0, r.h, r.l],
  ].map(q => P3(...q));
  const xs = pts.map(q => q[0]);
  const ys = pts.map(q => q[1]);
  const bw = Math.max(...xs) - Math.min(...xs);
  const bh = Math.max(...ys) - Math.min(...ys);
  const H0 = topHeight();
  const s = Math.min((W - 40) / bw, (H0 - 40) / bh);
  const ox = (W - bw * s) / 2 - Math.min(...xs) * s;
  const oy = (H0 - bh * s) / 2 - Math.min(...ys) * s;
  const Q = (X, Y, Z) => {
    const q = P3(X, Y, Z);
    return [q[0] * s + ox, q[1] * s + oy];
  };
  const poly = (a, f) =>
    `<polygon points="${a.map(q => Q(...q).join(',')).join(' ')}" fill="${f}" stroke="var(--text)" stroke-width="2" fill-opacity=".92"/>`;
  let h = isoShell(r, poly);
  const pos = [];
  items.forEach(i => {
    const [X, Y, Z] = isoPoint(r, i);
    const q = Q(X, Y, Z);
    pos.push([i, q[0], q[1]]);
  });
  h += `<text x="10" y="20" class="t-m" fill="currentColor">Этот вид только для просмотра</text>`;
  return { h, pos, boxCss: `height:${H0}px;overflow:hidden`, svgCss: 'width:100%;height:100%' };
}

function isoShell(r, poly) {
  const floor = [
    [0, 0, 0],
    [r.w, 0, 0],
    [r.w, 0, r.l],
    [0, 0, r.l],
  ];
  const back = [
    [0, 0, 0],
    [r.w, 0, 0],
    [r.w, r.h, 0],
    [0, r.h, 0],
  ];
  const side = [
    [0, 0, 0],
    [0, 0, r.l],
    [0, r.h, r.l],
    [0, r.h, 0],
  ];
  return poly(floor, r.floor) + poly(back, r.wall) + poly(side, r.wall);
}

function isoPoint(r, i) {
  if (i.wall == null) return [i.x, r.h, i.y];
  if (i.wall === 0) return [i.x, i.z, 0];
  if (i.wall === 1) return [r.w, i.z, i.x];
  if (i.wall === 2) return [i.x, i.z, r.l];
  return [0, i.z, i.x];
}

export function viewTop(r, ops, items, W) {
  const H0 = topHeight();
  const s = Math.min((W - 70) / r.w, (H0 - 70) / r.l);
  const ox = (W - r.w * s) / 2;
  const oy = (H0 - r.l * s) / 2;
  const L = (w, u) => {
    const [x, y] = wp(r, w, u);
    return [ox + x * s, oy + y * s];
  };
  let h = `<rect x="${ox}" y="${oy}" width="${r.w * s}" height="${r.l * s}" fill="${r.floor}" fill-opacity=".9" stroke="var(--text)" stroke-width="6"/>`;
  (r.fixtures || []).forEach(f => {
    h += topFixture(f, ox, oy, s);
  });
  ops.forEach(o => {
    h += topOpening(o, L);
  });
  h += `<text x="${ox + (r.w * s) / 2}" y="${oy - 12}" text-anchor="middle" class="t-m" fill="currentColor">${fmt(r.w)} м</text><text transform="rotate(-90 ${ox - 12} ${oy + (r.l * s) / 2})" x="${ox - 12}" y="${oy + (r.l * s) / 2}" text-anchor="middle" class="t-m" fill="currentColor">${fmt(r.l)} м</text>`;
  const pos = [];
  items.forEach(i => {
    const [x, y] = i.wall == null ? [ox + i.x * s, oy + i.y * s] : L(i.wall, i.x);
    pos.push([i, x, y]);
  });
  return {
    h,
    pos,
    G: { ox, oy, s },
    boxCss: `height:${H0}px;overflow:hidden`,
    svgCss: 'width:100%;height:100%;touch-action:none',
  };
}

function topFixture(f, ox, oy, s) {
  const fx = ox + f.x0 * s;
  const fy = oy + f.y0 * s;
  const fw = (f.x1 - f.x0) * s;
  const fh = (f.y1 - f.y0) * s;
  return `<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="rgba(120,140,160,.22)" stroke="var(--muted)" stroke-width="2" stroke-dasharray="4 3"/><text x="${fx + fw / 2}" y="${fy + fh / 2 + 4}" text-anchor="middle" class="t-s" font-weight="700" fill="currentColor" stroke="var(--card)" stroke-width="3" paint-order="stroke">${esc(f.label)}</text>`;
}

function topOpening(o, L) {
  const [x1, y1] = L(o.wall, o.pos);
  const [x2, y2] = L(o.wall, o.pos + o.width);
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--card)" stroke-width="9"/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.k === 'win' ? 'var(--blue)' : 'var(--muted)'}" stroke-width="${o.k === 'win' ? 4 : 2}" ${o.k === 'door' ? 'stroke-dasharray="5 4"' : ''}/>`;
}

// Касание q (координаты в SVG) → положение элемента в комнате. null: мимо комнаты; 'lamp': лампу здесь не поставить.
export function locate(r, vw, G, q, type) {
  if (vw === 'top') {
    const x = (q.x - G.ox) / G.s;
    const y = (q.y - G.oy) / G.s;
    if (x < -0.5 || y < -0.5 || x > r.w + 0.5 || y > r.l + 0.5) return null;
    if (type === 'lamp') return { wall: null, x: snap(clamp(x, 0.1, r.w - 0.1)), y: snap(clamp(y, 0.1, r.l - 0.1)) };
    const d = [y, r.w - x, r.l - y, x];
    const w = d.indexOf(Math.min(...d));
    return { wall: w, x: snap(clamp(w % 2 ? y : x, 0, wl(r, w))), y: 0 };
  }
  if (type === 'lamp') return 'lamp';
  let i = 0;
  while (i < 3 && q.x > G.ux[i] + (G.lens[i] + G.gap / 2) * G.s) i++;
  return {
    wall: i,
    x: snap(clamp((q.x - G.ux[i]) / G.s, 0, G.lens[i])),
    y: 0,
    z: clamp(snap((G.fl - q.y) / G.s), 0.05, r.h - 0.05),
  };
}
