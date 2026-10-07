// 3D: режим «Проверить свет»: подсветка комнат, выключатели, плавное включение. X — общее состояние сцены.

/** Перекрасить комнату по её яркости lv[id] (0..1). */
export function paint(X, id) {
  const m = X.RM[id];
  if (!m) return;
  const light = X.lightMode();
  const l = X.lv[id] || 0;
  const k = light ? 0.28 + 0.72 * l : 1;
  const e = light ? 0.12 * l : 0;
  m.floor.color.copy(m.bf).multiplyScalar(k);
  m.wall.color.copy(m.bw).multiplyScalar(k);
  m.floor.emissive.setRGB(1, 0.85, 0.55).multiplyScalar(e);
  m.wall.emissive.setRGB(1, 0.85, 0.55).multiplyScalar(e);
  if (X.RL[id]) X.RL[id].intensity = light ? 8 * l : 0;
  if (X.RG[id]) {
    X.RG[id].glow.opacity = light ? l : 0.35;
    X.RG[id].lamp.emissiveIntensity = light ? 0.1 + 0.9 * l : 0.6;
  }
  X.dirty = true;
}

/** Включить или выключить режим проверки света для всей сцены. */
export function applyLight(X) {
  const light = X.lightMode();
  X.hemi.intensity = light ? 0.45 : 1.0;
  X.sun.intensity = light ? 0.35 : 1.4;
  X.halos.forEach(h => {
    h.visible = light;
  });
  Object.keys(X.RM).forEach(id => paint(X, id));
  X.updateCard();
  X.dirty = true;
}

/** Щёлкнуть выключатель: свет комнаты включается или гаснет. */
export function toggle(X, id) {
  const on = !X.litRooms.has(id);
  if (on) X.litRooms.add(id);
  else X.litRooms.delete(id);
  X.lt[id] = on ? 1 : 0;
  if (X.reduced()) {
    X.lv[id] = X.lt[id];
    paint(X, id);
  }
  X.levers
    .filter(q => q.ctl === id)
    .forEach(q => {
      q.lever.rotation.x = on ? -0.5 : 0.5;
      if (!X.reduced()) X.swAnim.push({ g: q.g, t0: performance.now() });
    });
  X.updateCard();
  X.dirty = true;
}
