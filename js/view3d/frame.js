import { paint } from './light.js';

// 3D: один кадр анимации: пролёт камеры, подъём стен, плавный свет, рычажки выключателей.
// Возвращает true, если что-то изменилось и сцену нужно перерисовать.
export function stepFrame(X, now) {
  const { camera, controls } = X;
  let ch = false;
  const tw = X.tw;
  if (tw) {
    const k = Math.min(1, (now - tw.t0) / tw.ms);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    camera.position.lerpVectors(tw.p0, tw.p1, e);
    controls.target.lerpVectors(tw.q0, tw.q1, e);
    if (k >= 1) X.tw = null;
    ch = true;
  }
  if (X.anim) {
    const k = Math.min(1, (now - X.anim.t0) / X.anim.ms);
    X.wallsG.scale.y = Math.max(0.001, 1 - Math.pow(1 - k, 3));
    if (k >= 1) {
      X.anim = null;
      X.wallsG.scale.y = 1;
    }
    ch = true;
  }
  const dt = now - X.prevT;
  X.prevT = now;
  for (const id in X.lt) {
    if (X.lv[id] === X.lt[id]) continue;
    const st = X.reduced() ? 1 : dt / 350;
    const l = X.lv[id];
    X.lv[id] = l < X.lt[id] ? Math.min(X.lt[id], l + st) : Math.max(X.lt[id], l - st);
    paint(X, id);
    ch = true;
  }
  if (X.swAnim.length) {
    X.swAnim = X.swAnim.filter(q => {
      const k = (now - q.t0) / 320;
      q.g.scale.setScalar(k >= 1 ? 1 : 1 + 0.3 * Math.sin(Math.PI * k) * (1 - k));
      return k < 1;
    });
    ch = true;
  }
  return controls.update() || ch;
}
