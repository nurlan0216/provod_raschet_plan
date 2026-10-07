// Общий контекст для жестов, кнопок и полей редактора плана.
// base — функции и данные mount; st — состояние модуля (view, mode, sel); local — состояние одного mount (ov).
export function createContext(base, st, local) {
  return {
    ...base,
    get view() {
      return st.view;
    },
    get mode() {
      return st.mode;
    },
    set mode(v) {
      st.mode = v;
    },
    get sel() {
      return st.sel;
    },
    set sel(v) {
      st.sel = v;
    },
    get ov() {
      return local.ov;
    },
    set ov(v) {
      local.ov = v;
    },
  };
}
