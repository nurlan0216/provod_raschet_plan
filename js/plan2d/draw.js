import { fmt } from '../model.js';
import { esc, inkOn } from '../util.js';
import { shared, outer, wseg, overlaps, opsOf } from './geometry.js';

// Отрисовка плана этажа: чистая функция «данные → разметка», без обращения к DOM.
// Возвращает { svg, info, ruler }: содержимое холста, строку «Площадь…» (null, если комнат нет) и ширину линейки.

/** Перевод метров плана в пиксели холста. */
const project = view => ({
  s: view.s,
  X: m => m * view.s + view.tx,
  Y: m => m * view.s + view.ty,
});

/** Линия сетки: тонкая каждые 10 см (или 1 м при малом масштабе), жирная каждый метр. */
function gridSvg(view, { W, H }, c) {
  const { s, X, Y } = c;
  const step = s >= 60 ? 0.1 : 1;
  const per = step === 1 ? 1 : 10;
  const k0 = [Math.ceil(-view.tx / s / step), Math.ceil(-view.ty / s / step)];
  const k1 = [(W - view.tx) / s / step, (H - view.ty) / s / step];
  let h = '';
  for (let k = k0[0]; k <= k1[0]; k++) {
    h += `<line x1="${X(k * step)}" y1="0" x2="${X(k * step)}" y2="${H}" class="${k % per ? 'g' : 'gm'}"/>`;
  }
  for (let k = k0[1]; k <= k1[1]; k++) {
    h += `<line x1="0" y1="${Y(k * step)}" x2="${W}" y2="${Y(k * step)}" class="${k % per ? 'g' : 'gm'}"/>`;
  }
  return h;
}

/** Пол комнат; наложившиеся комнаты обведены красным пунктиром. */
function floorsSvg(rs, bad, c) {
  const { s, X, Y } = c;
  return rs
    .map(r => {
      const warn = bad.has(r.id) ? ' stroke="var(--red)" stroke-width="3" stroke-dasharray="6 4"' : '';
      return `<rect x="${X(r.x)}" y="${Y(r.y)}" width="${r.w * s}" height="${r.l * s}" fill="${r.floor}" fill-opacity=".9"${warn}/>`;
    })
    .join('');
}

/** Стены: наружные толстые, общие (перегородки) тоньше. */
function wallsSvg(rs, sh, t, c) {
  const { s, X, Y } = c;
  const line = (sg, a, b, w) =>
    sg.o === 'h'
      ? `<line pathLength="1" x1="${X(a)}" y1="${Y(sg.c)}" x2="${X(b)}" y2="${Y(sg.c)}" stroke-width="${w}"/>`
      : `<line pathLength="1" x1="${X(sg.c)}" y1="${Y(a)}" x2="${X(sg.c)}" y2="${Y(b)}" stroke-width="${w}"/>`;
  let h = '<g style="stroke:var(--text)" stroke-linecap="square">';
  rs.forEach(r => {
    for (let wi = 0; wi < 4; wi++) {
      const A = wseg(r, wi);
      const here = sh.filter(x => x.i === r.id && x.wi === wi);
      outer(A, here).forEach(([a, b]) => {
        h += line(A, a, b, Math.max(3, 0.2 * s));
      });
      here
        .filter(x => x.i < x.j)
        .forEach(x => {
          h += line(A, x.lo, x.hi, Math.max(2, t * s));
        });
    }
  });
  return h + '</g>';
}

/** Жёлтая рамка выбранной комнаты. */
function frameSvg(rs, sel, c) {
  if (!sel || sel.k !== 'room') return '';
  const r = rs.find(x => x.id === sel.id);
  if (!r) return '';
  const { s, X, Y } = c;
  return `<rect x="${X(r.x)}" y="${Y(r.y)}" width="${r.w * s}" height="${r.l * s}" fill="none" stroke="var(--accent)" stroke-width="5"/>`;
}

/** Дверь, окно или входная дверь на стене. */
function openingSvg({ sel: sl, r, o, kind }, sel, t, c) {
  const { s, X, Y } = c;
  const sg = wseg(r, o.wall);
  const from = sg.a + o.pos;
  const to = from + o.width;
  const th = Math.max(5, t * s);
  const pt = u => (sg.o === 'h' ? [X(u), Y(sg.c)] : [X(sg.c), Y(u)]);
  const on = sel && sel.k === sl.k && sel.id === sl.id && sel.i === sl.i;
  const [x1, y1] = pt(from);
  const [x2, y2] = pt(to);
  const col = kind === 'ent' ? 'var(--red)' : kind === 'win' ? 'var(--blue)' : 'var(--text)';
  let h = '';
  if (on) {
    h += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--accent)" stroke-width="${th + 10}" stroke-linecap="round"/>`;
  }
  h += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--card)" stroke-width="${th + 2}"/>`;
  if (kind === 'win') {
    return h + `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="4"/>`;
  }
  const tv = sg.o === 'h' ? [1, 0] : [0, 1];
  const nv = [
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 0],
  ][o.wall].map(v => v * (o.swing === 'out' ? -1 : 1));
  const len = o.width * s;
  const ox = x1 + nv[0] * len;
  const oy = y1 + nv[1] * len;
  const sw = tv[0] * nv[1] - tv[1] * nv[0] > 0 ? 1 : 0;
  h += `<path d="M${x1} ${y1} L${ox} ${oy} M${x2} ${y2} A${len} ${len} 0 0 ${sw} ${ox} ${oy}" fill="none" stroke="${col}" stroke-width="2"/>`;
  if (kind === 'ent') {
    h += `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 8}" text-anchor="middle" class="t-m" font-weight="700" fill="var(--red)">Вход</text>`;
  }
  return h;
}

/** Подписи комнаты: название, площадь, ширина и длина (если комната на экране достаточно крупная). */
function labelsSvg(r, c) {
  const { s, X, Y } = c;
  const cx = X(r.x + r.w / 2);
  const cy = Y(r.y + r.l / 2);
  const INK = inkOn(r.floor);
  let h = `<text x="${cx}" y="${cy}" text-anchor="middle" class="t-l" font-weight="700" fill="${INK}">${esc(r.name)}</text>`;
  if (r.l * s > 60) {
    h += `<text x="${cx}" y="${cy}" dy="1.3em" text-anchor="middle" class="t-s" fill="${INK}">${fmt(+(r.w * r.l).toFixed(1))} м²</text>`;
  }
  if (r.w * s > 60) {
    h += `<text x="${cx}" y="${Y(r.y) + 17}" text-anchor="middle" class="t-s" fill="${INK}" opacity=".85">${fmt(r.w)}</text>`;
  }
  if (r.l * s > 60) {
    h += `<text transform="rotate(-90 ${X(r.x) + 15} ${cy})" x="${X(r.x) + 15}" y="${cy}" text-anchor="middle" class="t-s" fill="${INK}" opacity=".85">${fmt(r.l)}</text>`;
  }
  return h;
}

/** Строка «Площадь, размер» над планом. null — комнат нет, строку не трогаем. */
function infoHtml(rooms, bad) {
  if (!rooms.length) return null;
  const width = Math.max(...rooms.map(r => r.x + r.w)) - Math.min(...rooms.map(r => r.x));
  const length = Math.max(...rooms.map(r => r.y + r.l)) - Math.min(...rooms.map(r => r.y));
  const area = fmt(+rooms.reduce((a, r) => a + r.w * r.l, 0).toFixed(1));
  const warn = bad.size ? ' <span style="color:var(--red)">· комнаты наложились друг на друга</span>' : '';
  return `<b>Площадь ${area} м², размер ${fmt(+width.toFixed(1))} × ${fmt(+length.toFixed(1))} м</b>${warn}`;
}

/**
 * @param {{ project: object, ov: object, view: {s:number,tx:number,ty:number}, dim: {W:number,H:number}, sel: object|null }} a
 *   ov — временные положения комнат во время перетаскивания.
 */
export function renderPlan({ project: p, ov, view, dim, sel }) {
  const rs = p.rooms.map(r => (ov[r.id] ? { ...r, ...ov[r.id] } : r));
  const c = project(view);
  const sh = shared(rs);
  const bad = overlaps(rs);
  const t = (p.settings.wallThickness || 10) / 100;
  const svg = [
    gridSvg(view, dim, c),
    floorsSvg(rs, bad, c),
    wallsSvg(rs, sh, t, c),
    frameSvg(rs, sel, c),
    opsOf(rs, p.entrance)
      .map(op => openingSvg(op, sel, t, c))
      .join(''),
    rs.map(r => labelsSvg(r, c)).join(''),
  ].join('');
  return { svg, info: infoHtml(p.rooms, bad), ruler: view.s + 'px' };
}
