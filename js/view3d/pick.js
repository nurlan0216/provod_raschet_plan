import { toggle } from './light.js';

// 3D: нажатие на комнату или выключатель (один палец, короткое касание без сдвига).
// h = { lightMode, select }. Возвращает функцию, которая снимает обработчики.
export function attachPicking(X, h) {
  const { T, camera, dom } = X;
  const ray = new T.Raycaster();
  const v2 = new T.Vector2();
  let count = 0;
  let multi = false;
  let down = null;

  const onDown = e => {
    count++;
    if (count > 1) multi = true;
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const pick = e => {
    const b = dom.getBoundingClientRect();
    v2.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
    ray.setFromCamera(v2, camera);
    const sw = h.lightMode() ? ray.intersectObjects(X.swPicks, false)[0] : null;
    if (sw) return toggle(X, sw.object.userData.ctl);
    const hit = ray.intersectObjects(X.picks, false)[0];
    h.select(hit ? hit.object.userData.id : null, !!hit);
  };
  const onUp = e => {
    count = Math.max(0, count - 1);
    if (count) return;
    const tap = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && performance.now() - down.t < 600;
    if (!multi && tap) pick(e);
    multi = false;
    down = null;
  };
  dom.addEventListener('pointerdown', onDown);
  dom.addEventListener('pointerup', onUp);
  dom.addEventListener('pointercancel', onUp);
  return () => {
    dom.removeEventListener('pointerdown', onDown);
    dom.removeEventListener('pointerup', onUp);
    dom.removeEventListener('pointercancel', onUp);
  };
}
