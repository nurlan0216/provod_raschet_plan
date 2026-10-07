// @ts-check
import { r1 } from '../util.js';
import { itemPt } from './route.js';

// Интернет и камеры: UTP от щитка, длина с запасом ≤ 90 м, камеры по PoE.

export const UTP_MAX = 90; // предел для UTP cat6, м

export function calcNet(rooms, panel, leg, reserve, warn) {
  const net = [];
  rooms.forEach(r => {
    (r.items || []).forEach(i => {
      if (i.type === 'rj45' || i.type === 'camera') net.push({ r, i, pt: itemPt(r, i) });
    });
  });
  let utp = 0;
  let utpMax = 0;
  net.forEach((q, n) => {
    const l = leg(panel, q.pt, 'net', 100 + n) * reserve;
    utp += l;
    utpMax = Math.max(utpMax, l);
    if (l > UTP_MAX) {
      const text = `Кабель до интернет-точки в комнате «${q.r.name}» ${r1(l)} м, это больше ${UTP_MAX} м.`;
      warn('error', `${text} Придвиньте точку к щитку или добавьте коммутатор поближе.`, q.r.id);
    }
  });
  const cameras = net.filter(q => q.i.type === 'camera').length;
  const lines = net.length;
  const poePorts = cameras ? [4, 8, 16, 24].find(n => n >= cameras) || 24 : 0;
  return { net: { lines, cameras, rj45: lines - cameras, utp, utpMax, poePorts }, utp };
}
