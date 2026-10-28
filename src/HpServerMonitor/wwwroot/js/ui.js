import * as fmt from './format.js';

const ICONS = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  cpu: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/><rect x="10.5" y="10.5" width="3" height="3" rx="1"/>',
  memory: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 7v4M12 7v4M17 7v4M6 17v3M12 17v3M18 17v3"/>',
  storage: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  network: '<path d="M4 9a13 13 0 0 1 16 0"/><path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5.5 5.5 0 0 1 7 0"/><path d="M12 19.5h.01"/>',
  fan: '<circle cx="12" cy="12" r="2"/><path d="M12 10c0-3 1-5 4-5s4 3 3 5-4 2-7 2"/><path d="M14 12c3 0 5 1 5 4s-3 4-5 3-2-4-2-7"/><path d="M12 14c0 3-1 5-4 5s-4-3-3-5 4-2 7-2"/><path d="M10 12c-3 0-5-1-5-4s3-4 5-3 2 4 2 7"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h4M12 17h8"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  temp: '<path d="M10 13V5a2 2 0 1 1 4 0v8a4 4 0 1 1-4 0Z"/><path d="M12 9v6"/>',
  power: '<path d="M12 3v9"/><path d="M6 7a8 8 0 1 0 12 0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  battery: '<rect x="3" y="8" width="16" height="9" rx="2"/><path d="M21 11v3"/><path d="M6 11h6v3H6z"/>',
  activity: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  arrowDown: '<path d="M12 4v16M6 14l6 6 6-6"/>',
  arrowUp: '<path d="M12 20V4M6 10l6-6 6 6"/>',
  server: '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
  shield: '<path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
  alert: '<path d="M12 4 3 20h18L12 4Z"/><path d="M12 10v4M12 17h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  wifi: '<path d="M2.5 9a15 15 0 0 1 19 0"/><path d="M5.5 12.5a10 10 0 0 1 13 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><path d="M12 19.5h.01"/>',
  harddrive: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 16h10"/><path d="M7 8h.01M11 8h.01"/>'
};

export function iconEl(name, size = 18) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon-svg');
  svg.innerHTML = ICONS[name] || ICONS.dot;
  return svg;
}

function appendChildren(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) appendChildren(el, child);
    else if (child instanceof Node) el.append(child);
    else el.append(document.createTextNode(String(child)));
  }
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'html') el.innerHTML = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  appendChildren(el, children);
  return el;
}

export function setText(el, text) {
  if (!el) return;
  const next = text === null || text === undefined ? '' : String(text);
  if (el.textContent !== next) el.textContent = next;
}

export function card({ title = '', icon = '', sub = '', actions = null, className = '' } = {}) {
  const titleLine = h('div', { class: 'card-title' }, icon ? iconEl(icon, 16) : null, h('span', {}, title));
  const subEl = h('p', { class: 'card-sub' }, sub);
  const left = h('div', { class: 'card-title-wrap' }, titleLine, subEl);
  const head = h('div', { class: 'card-head' }, left);
  if (actions) {
    const box = h('div', { class: 'card-actions' });
    if (Array.isArray(actions)) appendChildren(box, actions);
    else if (actions instanceof Node) box.append(actions);
    else box.append(String(actions));
    head.append(box);
  }
  const body = h('div', { class: 'card-body' });
  const root = h('section', { class: `card ${className}`.trim() }, head, body);
  return {
    root,
    head,
    body,
    setSub(text) { setText(subEl, text); }
  };
}

export function metric({ label = '', value = 'N/A', unit = '', hint = '', big = false, className = '' } = {}) {
  const valueEl = h('span', { class: 'metric-number' }, value);
  const unitEl = h('span', { class: 'metric-unit' }, unit);
  const root = h('div', { class: `metric${big ? ' big' : ''} ${className}`.trim() },
    h('div', { class: 'metric-label' }, label),
    h('div', { class: 'metric-value' }, valueEl, unitEl),
    hint ? h('div', { class: 'metric-hint' }, hint) : null);
  return {
    root,
    el: valueEl,
    unitEl,
    set(number, formatFn = (v) => fmt.num(v), unitText) {
      if (number === null || number === undefined || !Number.isFinite(Number(number))) {
        setText(valueEl, 'N/A');
        if (unitText !== undefined) setText(unitEl, '');
        valueEl._hpmonValue = undefined;
        return;
      }
      if (unitText !== undefined) setText(unitEl, unitText);
      animateNumber(valueEl, Number(number), formatFn);
    },
    setText(text) {
      setText(valueEl, text);
      setText(unitEl, '');
      valueEl._hpmonValue = undefined;
    }
  };
}

export function animateNumber(el, value, formatFn = (v) => fmt.num(v)) {
  const target = Number(value);
  if (!el || !Number.isFinite(target)) {
    setText(el, 'N/A');
    return;
  }

  if (reducedMotion() || el._hpmonValue === undefined) {
    el.textContent = formatFn(target);
    el._hpmonValue = target;
    return;
  }

  if (el._hpmonRaf) cancelAnimationFrame(el._hpmonRaf);
  const from = el._hpmonValue;
  const started = performance.now();
  const duration = 300;

  const tick = (now) => {
    const p = Math.max(0, Math.min(1, (now - started) / duration));
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = formatFn(from + (target - from) * eased);
    if (p < 1) {
      el._hpmonRaf = requestAnimationFrame(tick);
    } else {
      el.textContent = formatFn(target);
      el._hpmonValue = target;
      el._hpmonRaf = 0;
    }
  };
  el._hpmonRaf = requestAnimationFrame(tick);
}

export function progress({ className = '', value = 0 } = {}) {
  const fill = h('div', { class: 'progress-fill' });
  const root = h('div', { class: `progress ${className}`.trim() }, fill);
  return {
    root,
    fill,
    set(percent) {
      const p = fmt.clamp(Number(percent) || 0, 0, 100);
      fill.style.transform = `scaleX(${p / 100})`;
    }
  };
}

export function rangeChips(onChange, initial = '5m') {
  const ranges = [['5m', '5 分钟'], ['15m', '15 分钟'], ['1h', '1 小时']];
  const root = h('div', { class: 'range-chips' });
  const buttons = ranges.map(([value, label]) => {
    const button = h('button', {
      type: 'button',
      class: `chip${value === initial ? ' active' : ''}`,
      'data-range': value
    }, label);
    button.addEventListener('click', () => {
      for (const item of buttons) item.classList.toggle('active', item === button);
      onChange(value);
    });
    root.append(button);
    return button;
  });
  return root;
}

export function badge(text, kind = '') {
  return h('span', { class: `badge ${kind}`.trim() }, text);
}

export function empty(title, hint = '', icon = 'activity') {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, iconEl(icon, 28)),
    h('p', { class: 'empty-title' }, title),
    hint ? h('p', { class: 'empty-hint' }, hint) : null);
}

export function alert(text, kind = 'warn') {
  return h('div', { class: `alert ${kind}`.trim() },
    iconEl(kind === 'bad' ? 'alert' : 'shield', 18),
    h('span', {}, text));
}

export function reconcile(container, keys, create) {
  const signature = keys.join('|');
  if (container.dataset.signature !== signature) {
    container.replaceChildren(...keys.map((key, index) => create(key, index)));
    container.dataset.signature = signature;
  }
  return Array.from(container.children);
}

export function toast(message, kind = 'info') {
  const container = document.getElementById('toasts');
  if (!container) return;
  const node = h('div', { class: `toast ${kind}`.trim() }, message);
  container.append(node);
  window.setTimeout(() => {
    node.classList.add('out');
    window.setTimeout(() => node.remove(), 240);
  }, 3200);
}

export function reducedMotion() {
  return document.documentElement.dataset.reduceMotion === '1' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function setReducedMotion(enabled) {
  document.documentElement.dataset.reduceMotion = enabled ? '1' : '0';
}

const TEMP_STOPS = [
  [0, [0, 224, 184]],
  [48, [0, 224, 184]],
  [58, [255, 209, 102]],
  [68, [255, 209, 102]],
  [76, [255, 159, 67]],
  [84, [255, 159, 67]],
  [90, [255, 77, 109]],
  [110, [255, 45, 85]]
];

export function tempColor(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'var(--muted)';
  const n = Number(value);
  for (let i = 0; i < TEMP_STOPS.length - 1; i++) {
    const [a, ca] = TEMP_STOPS[i];
    const [b, cb] = TEMP_STOPS[i + 1];
    if (n >= a && n <= b) {
      const p = b === a ? 0 : (n - a) / (b - a);
      const rgb = ca.map((c, index) => Math.round(c + (cb[index] - c) * p));
      return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    }
  }
  const last = TEMP_STOPS[TEMP_STOPS.length - 1][1];
  return `rgb(${last[0]}, ${last[1]}, ${last[2]})`;
}

export function applyTemp(el, value) {
  if (!el) return;
  const color = tempColor(value);
  el.style.setProperty('--temp-color', color);
  el.style.color = color;
  el.classList.toggle('is-hot', Number(value) > 85);
}
