'use strict';
// DOM minimo per eseguire i flussi delle pagine in Node, senza browser o rete.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {};
    this.handlers = {}; this.value = ''; this.hidden = false; this.disabled = false; this.checked = false;
    this._text = ''; this.classes = new Set();
    this.classList = {
      contains: value => this.classes.has(value),
      add: (...values) => values.forEach(value => this.classes.add(value)),
      remove: (...values) => values.forEach(value => this.classes.delete(value)),
      toggle: (value, enabled) => {
        const yes = enabled === undefined ? !this.classes.has(value) : !!enabled;
        if (yes) this.classes.add(value); else this.classes.delete(value);
        return yes;
      }
    };
  }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set href(value) { this.attributes.href = value; }
  get href() { return this.attributes.href; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  append(...nodes) { nodes.forEach(node => { node.parent = this; this.children.push(node); }); }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); }
  async emit(name) { for (const fn of this.handlers[name] || []) await fn({ target: this }); }
  click() { return this.emit('click'); }
  matches(selector) {
    let excluded;
    selector = selector.replace(/:not\(([^)]+)\)/, (_, part) => { excluded = part; return ''; });
    if (excluded && this.matches(excluded)) return false;
    const tag = selector.match(/^[a-z]+/i)?.[0]; if (tag && tag.toUpperCase() !== this.tagName) return false;
    const id = selector.match(/#([\w-]+)/)?.[1]; if (id && this.id !== id) return false;
    for (const match of selector.matchAll(/\.([\w-]+)/g)) if (!this.classes.has(match[1])) return false;
    for (const match of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      const key = match[1].startsWith('data-') ? match[1].slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()) : null;
      const value = key ? this.dataset[key] : this.attributes[match[1]];
      if (value === undefined || (match[2] !== undefined && value !== match[2])) return false;
    }
    return true;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function documentFixture(ids = []) {
  const html = new Element('html'), body = new Element('body'); html.append(body);
  const doc = {
    documentElement: html, body, visibilityState: 'visible',
    createElement: tag => new Element(tag),
    getElementById: id => html.querySelector(`#${id}`),
    querySelectorAll: selector => html.querySelectorAll(selector),
    querySelector: selector => html.querySelector(selector)
  };
  ids.forEach(id => { const node = new Element(id.toLowerCase().includes('user') ? 'select' : 'div'); node.id = id; body.append(node); });
  return doc;
}
module.exports = { Element, documentFixture };
