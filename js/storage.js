import { normalizeProject } from './model.js';
// Всё хранится только на устройстве. Любая операция защищена от ошибок памяти.
const read = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : d;
  } catch {
    return d;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
};

export const clearCurrent = () => {
  try {
    localStorage.removeItem('ep:current');
  } catch {}
};
export const listProjects = () =>
  Object.values(read('ep:projects', {}))
    .filter(p => p && Array.isArray(p.rooms))
    .sort((a, b) => b.updated - a.updated)
    .map(({ id, name, updated, rooms }) => ({ id, name, updated, rooms: rooms.length }));
export const saveProject = p => {
  const all = read('ep:projects', {});
  all[p.id] = p;
  return write('ep:projects', all);
};
export const loadProject = id => normalizeProject(read('ep:projects', {})[id]);
export const deleteProject = id => {
  const all = read('ep:projects', {});
  delete all[id];
  return write('ep:projects', all);
};
export const saveCurrent = (project, step) => write('ep:current', { project, step });
export const loadCurrent = () => {
  const c = read('ep:current', null),
    p = normalizeProject(c && c.project);
  return p ? { project: p, step: +c.step || 0 } : null;
};
export const getPref = (k, d) => read('ep:pref:' + k, d);
export const setPref = (k, v) => write('ep:pref:' + k, v);
