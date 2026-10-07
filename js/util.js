// Общие мелкие функции. Не импортирует другие модули приложения.
export const esc = s =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const r2 = v => Math.round(v * 100) / 100;
export const wallLen = (r, w) => (w % 2 ? r.l : r.w);
export const wallPt = (r, w, u) => (w === 0 ? [u, 0] : w === 1 ? [r.w, u] : w === 2 ? [u, r.l] : [0, u]);
export const DOOR_H = 2.1;
export const r1 = v => Math.round(v * 10) / 10;

/** Цвет текста (тёмный или белый), читаемый на фоне `hex` вида #rrggbb; при другом формате — тёмный. */
export const inkOn = hex => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return '#1B2530';
  const c = [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.18 ? '#1B2530' : '#FFFFFF';
};

/** Показывает ошибку под полем: значение остаётся, поле подсвечивается, текст связан через aria-describedby. */
export function invalid(input, msg) {
  input.setAttribute('aria-invalid', 'true');
  let e = input.parentElement.querySelector('.err');
  if (!e) {
    e = document.createElement('small');
    e.className = 'err';
    e.id = (input.id || 'fld') + '-err';
    e.setAttribute('role', 'alert');
    input.after(e);
  }
  e.textContent = msg;
  input.setAttribute('aria-describedby', e.id);
}
/** Убирает ошибку, поставленную через invalid(). */
export function valid(input) {
  input.removeAttribute('aria-invalid');
  input.removeAttribute('aria-describedby');
  input.parentElement.querySelector('.err')?.remove();
}
