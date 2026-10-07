import { newProject, newRoom, uid } from './model.js';

// Комнаты уже стоят на плане и соединены дверями. Электрику добавит «Расставить по правилам» (этап 5).
// doors: [стена, pos, ширина, ключ соседней комнаты]; windows: [стена, pos, ширина]
function make(name, spec, ent) {
  const p = newProject(name),
    ids = {};
  spec.forEach(s => {
    ids[s.key] = uid();
  });
  p.rooms = spec.map(s =>
    newRoom({
      id: ids[s.key],
      name: s.name,
      type: s.type,
      w: s.w,
      l: s.l,
      x: s.x,
      y: s.y,
      doors: (s.doors || []).map(d => ({ wall: d[0], pos: d[1], width: d[2], toRoom: ids[d[3]] })),
      windows: (s.windows || []).map(w => ({ wall: w[0], pos: w[1], width: w[2], sill: 0.9, height: 1.4 })),
    }),
  );
  p.entrance = { roomId: ids[ent.room], wall: ent.wall, pos: ent.pos, width: 0.9 };
  return p;
}

export const TEMPLATES = [
  {
    id: 'studio',
    title: 'Квартира-студия',
    build: () =>
      make(
        'Студия',
        [
          {
            key: 's',
            name: 'Студия',
            type: 'living',
            w: 5,
            l: 6,
            x: 0,
            y: 0,
            doors: [[1, 0.5, 0.8, 'b']],
            windows: [
              [0, 1, 1.8],
              [3, 2, 1.8],
            ],
          },
          { key: 'b', name: 'Ванная', type: 'bath', w: 2, l: 2.5, x: 5, y: 0 },
        ],
        { room: 's', wall: 2, pos: 3.8 },
      ),
  },
  {
    id: 'two',
    title: '2-комнатная квартира',
    build: () =>
      make(
        '2-комнатная',
        [
          {
            key: 'h',
            name: 'Коридор',
            type: 'hall',
            w: 1.6,
            l: 4,
            x: 4,
            y: 0,
            doors: [
              [3, 1.5, 0.9, 'z'],
              [1, 1.5, 0.9, 's'],
              [2, 0.3, 0.8, 'b'],
            ],
          },
          {
            key: 'z',
            name: 'Зал',
            type: 'living',
            w: 4,
            l: 5,
            x: 0,
            y: 0,
            doors: [[2, 2, 1.2, 'k']],
            windows: [
              [0, 1, 1.5],
              [3, 1.5, 1.5],
            ],
          },
          {
            key: 's',
            name: 'Спальня',
            type: 'bedroom',
            w: 3,
            l: 4,
            x: 5.6,
            y: 0,
            windows: [
              [0, 0.75, 1.5],
              [1, 1.2, 1.5],
            ],
          },
          { key: 'k', name: 'Кухня', type: 'kitchen', w: 3, l: 3, x: 1, y: 5, windows: [[2, 0.75, 1.5]] },
          { key: 'b', name: 'Ванная', type: 'bath', w: 2, l: 2, x: 4, y: 4 },
        ],
        { room: 'h', wall: 0, pos: 0.35 },
      ),
  },
  { id: 'empty', title: 'Пустой проект', build: () => newProject('Новый проект') },
];
