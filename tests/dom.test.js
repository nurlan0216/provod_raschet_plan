import test from 'node:test';
import assert from 'node:assert/strict';
import { invalid, valid } from '../js/util.js';

// Минимальная подмена DOM: хватает для invalid()/valid() (без jsdom и новых зависимостей).
class El {
  constructor(tag) {
    this.tag = tag;
    this.attrs = {};
    this.children = [];
    this.parentElement = null;
    this.className = '';
    this.id = '';
    this.textContent = '';
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  removeAttribute(k) {
    delete this.attrs[k];
  }
  append(c) {
    c.parentElement = this;
    this.children.push(c);
  }
  after(c) {
    const p = this.parentElement;
    c.parentElement = p;
    p.children.splice(p.children.indexOf(this) + 1, 0, c);
  }
  remove() {
    const p = this.parentElement;
    p.children.splice(p.children.indexOf(this), 1);
    this.parentElement = null;
  }
  querySelector(sel) {
    const cls = sel.slice(1);
    return this.children.find(c => c.className === cls) ?? null;
  }
}
globalThis.document = { createElement: t => new El(t) };

const field = () => {
  const wrap = new El('div'),
    input = new El('input');
  input.id = 'ep-c15';
  wrap.append(input);
  return { wrap, input };
};

test('invalid: aria-invalid, .err с role=alert и aria-describedby', () => {
  const { wrap, input } = field();
  invalid(input, 'Ошибка');
  const err = wrap.querySelector('.err');
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.equal(err.getAttribute('role'), 'alert');
  assert.equal(err.textContent, 'Ошибка');
  assert.equal(input.getAttribute('aria-describedby'), err.id);
  assert.equal(err.id, 'ep-c15-err');
});

test('повторный invalid не создаёт второй .err, а обновляет текст', () => {
  const { wrap, input } = field();
  invalid(input, 'Первая');
  invalid(input, 'Вторая');
  assert.equal(wrap.children.filter(c => c.className === 'err').length, 1);
  assert.equal(wrap.querySelector('.err').textContent, 'Вторая');
});

test('valid убирает aria-invalid, aria-describedby и .err; без ошибки не падает', () => {
  const { wrap, input } = field();
  valid(input);
  invalid(input, 'Ошибка');
  valid(input);
  assert.equal(input.getAttribute('aria-invalid'), null);
  assert.equal(input.getAttribute('aria-describedby'), null);
  assert.equal(wrap.querySelector('.err'), null);
});
