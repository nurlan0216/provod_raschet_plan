// Визуальные эффекты интерфейса: ripple на кнопках, тень шапки при прокрутке, прогресс шагов.
// Не трогает состояние приложения; без движения при prefers-reduced-motion.
const calm = matchMedia('(prefers-reduced-motion: reduce)');

export function initFx() {
  document.addEventListener(
    'pointerdown',
    e => {
      if (calm.matches) return;
      const b = e.target.closest?.('button:not(:disabled)');
      if (!b) return;
      const r = b.getBoundingClientRect();
      b.style.setProperty('--rx', e.clientX - r.left + 'px');
      b.style.setProperty('--ry', e.clientY - r.top + 'px');
      b.classList.remove('rip');
      void b.offsetWidth;
      b.classList.add('rip');
    },
    { passive: true },
  );
  document.addEventListener('animationend', e => e.target.classList?.remove('rip'), true);
  const top = document.querySelector('.top'),
    main = document.querySelector('main');
  main?.addEventListener('scroll', () => top?.classList.toggle('scrolled', main.scrollTop > 4), { passive: true });
}

// Доля пройденных шагов для линии прогресса (0..1).
export function setProgress(i, n) {
  const d = document.querySelector('.dots');
  if (d) requestAnimationFrame(() => d.style.setProperty('--p', n > 1 ? i / (n - 1) : 0));
}
