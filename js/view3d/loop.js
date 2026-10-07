import { stepFrame } from './frame.js';

// 3D: цикл отрисовки, подгонка размера холста и восстановление после потери WebGL-контекста.

/**
 * @param X        общее состояние сцены
 * @param renderer WebGL-рендерер
 * @param cv       контейнер холста (за его размером следим)
 * @param rebuild  пересборка сцены после восстановления контекста
 * @returns { start, stop }
 */
export function createLoop(X, renderer, cv, rebuild) {
  const { scene, camera, dom } = X;
  const ro = new ResizeObserver(() => {
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    X.dirty = true;
  });
  ro.observe(cv);
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const ch = stepFrame(X, performance.now());
    if (ch || X.dirty) {
      renderer.render(scene, camera);
      X.dirty = false;
    }
  };
  // Потеря WebGL-контекста (на мобильных после сворачивания): останавливаем цикл и пересобираем сцену при возврате.
  const onLost = e => {
    e.preventDefault();
    cancelAnimationFrame(raf);
  };
  const onRestored = () => {
    rebuild();
    X.dirty = true;
    loop();
  };
  dom.addEventListener('webglcontextlost', onLost);
  dom.addEventListener('webglcontextrestored', onRestored);
  return {
    start: loop,
    stop: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      dom.removeEventListener('webglcontextlost', onLost);
      dom.removeEventListener('webglcontextrestored', onRestored);
    },
  };
}
