/* HP Server Monitor - standalone UI preview.
 * Open preview/index.html directly in a browser. No server, no fetch, no build.
 * Mock data updates every second; all charts and views are local.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- format
  const numberFormats = new Map();
  const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

  function isNumber(value) {
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  }

  function num(value, digits = 0, fallback = 'N/A') {
    if (!isNumber(value)) return fallback;
    const d = Math.max(0, Math.min(3, digits));
    let formatter = numberFormats.get(d);
    if (!formatter) {
      formatter = new Intl.NumberFormat('zh-CN', {
        minimumFractionDigits: d,
        maximumFractionDigits: d
      });
      numberFormats.set(d, formatter);
    }
    return formatter.format(Number(value));
  }

  function pct(value, digits = 1) {
    return isNumber(value) ? `${num(value, digits)}%` : 'N/A';
  }

  function bytes(value, digits = 1) {
    if (!isNumber(value)) return 'N/A';
    let n = Math.max(0, Number(value));
    let unit = 0;
    while (n >= 1024 && unit < BYTE_UNITS.length - 1) {
      n /= 1024;
      unit++;
    }
    return `${num(n, unit === 0 ? 0 : digits)} ${BYTE_UNITS[unit]}`;
  }

  function bytesShort(value) {
    if (!isNumber(value)) return 'N/A';
    let n = Math.max(0, Number(value));
    let unit = 0;
    while (n >= 1024 && unit < BYTE_UNITS.length - 1) {
      n /= 1024;
      unit++;
    }
    return `${num(n, unit === 0 ? 0 : 1)}${BYTE_UNITS[unit]}`;
  }

  function rate(value) {
    return isNumber(value) ? `${bytes(value)}/s` : 'N/A';
  }

  function mhz(value) {
    if (!isNumber(value)) return 'N/A';
    const n = Number(value);
    return n >= 1000 ? `${num(n / 1000, 2)} GHz` : `${num(n, 0)} MHz`;
  }

  function temp(value) {
    return isNumber(value) ? `${num(value, 1)}°C` : 'N/A';
  }

  function watt(value) {
    return isNumber(value) ? `${num(value, 1)} W` : 'N/A';
  }

  function volt(value) {
    return isNumber(value) ? `${num(value, 3)} V` : 'N/A';
  }

  function rpm(value) {
    return isNumber(value) ? `${num(value, 0)} RPM` : 'N/A';
  }

  function uptime(seconds) {
    if (!isNumber(seconds)) return 'N/A';
    let s = Math.max(0, Math.floor(Number(seconds)));
    const days = Math.floor(s / 86400);
    s %= 86400;
    const hours = Math.floor(s / 3600);
    s %= 3600;
    const minutes = Math.floor(s / 60);
    if (days > 0) return `${days} 天 ${hours} 小时`;
    if (hours > 0) return `${hours} 小时 ${minutes} 分`;
    if (minutes > 0) return `${minutes} 分`;
    return `${s} 秒`;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function clockSeconds(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '--:--:--';
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  }

  function dateTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${clockSeconds(date)}`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  const fmt = {
    isNumber, num, pct, bytes, bytesShort, rate, mhz, temp, watt, volt, rpm,
    uptime, clockSeconds, dateTime, clamp
  };

  // ---------------------------------------------------------------- DOM / UI
  const ICONS = {
    cpu: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    memory: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 7v4M12 7v4M17 7v4M6 17v3M12 17v3M18 17v3"/>',
    storage: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    network: '<path d="M4 9a13 13 0 0 1 16 0"/><path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5.5 5.5 0 0 1 7 0"/><path d="M12 19.5h.01"/>',
    fan: '<circle cx="12" cy="12" r="2"/><path d="M12 10c0-3 1-5 4-5s4 3 3 5-4 2-7 2"/><path d="M14 12c3 0 5 1 5 4s-3 4-5 3-2-4-2-7"/><path d="M12 14c0 3-1 5-4 5s-4-3-3-5 4-2 7-2"/><path d="M10 12c-3 0-5-1-5-4s3-4 5-3 2 4 2 7"/>',
    activity: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
    temp: '<path d="M10 13V5a2 2 0 1 1 4 0v8a4 4 0 1 1-4 0Z"/><path d="M12 9v6"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    battery: '<rect x="3" y="8" width="16" height="9" rx="2"/><path d="M21 11v3"/><path d="M6 11h6v3H6z"/>',
    server: '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
    shield: '<path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h4M12 17h8"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    alert: '<path d="M12 4 3 20h18L12 4Z"/><path d="M12 10v4M12 17h.01"/>',
    wifi: '<path d="M4 9a13 13 0 0 1 16 0"/><path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5.5 5.5 0 0 1 7 0"/><path d="M12 19.5h.01"/>',
    arrowDown: '<path d="M12 4v16M6 14l6 6 6-6"/>',
    arrowUp: '<path d="M12 20V4M6 10l6-6 6 6"/>',
    harddrive: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 16h10"/><path d="M7 8h.01M11 8h.01"/>',
    dot: '<circle cx="12" cy="12" r="3"/>'
  };

  function iconEl(name, size = 18) {
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

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
      else el.setAttribute(key, value === true ? '' : String(value));
    }
    appendChildren(el, children);
    return el;
  }

  function setText(el, text) {
    if (!el) return;
    const next = text === null || text === undefined ? '' : String(text);
    if (el.textContent !== next) el.textContent = next;
  }

  function card({ title = '', icon = '', sub = '', actions = null, className = '' } = {}) {
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
      root, head, body,
      setSub(text) { setText(subEl, text); }
    };
  }

  function reducedMotion() {
    return document.documentElement.dataset.reduceMotion === '1' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function animateNumber(el, value, formatFn = (v) => num(v)) {
    const target = Number(value);
    if (!el || !Number.isFinite(target)) {
      setText(el, 'N/A');
      el._value = undefined;
      return;
    }
    if (reducedMotion() || el._value === undefined) {
      el.textContent = formatFn(target);
      el._value = target;
      return;
    }
    if (el._raf) cancelAnimationFrame(el._raf);
    const from = el._value;
    const started = performance.now();
    const duration = 300;
    const tick = (now) => {
      const p = Math.max(0, Math.min(1, (now - started) / duration));
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = formatFn(from + (target - from) * eased);
      if (p < 1) el._raf = requestAnimationFrame(tick);
      else {
        el.textContent = formatFn(target);
        el._value = target;
        el._raf = 0;
      }
    };
    el._raf = requestAnimationFrame(tick);
  }

  function metric({ label = '', value = 'N/A', unit = '', hint = '', big = false } = {}) {
    const valueEl = h('span', { class: 'metric-number' }, value);
    const unitEl = h('span', { class: 'metric-unit' }, unit);
    const root = h('div', { class: `metric${big ? ' big' : ''}` },
      h('div', { class: 'metric-label' }, label),
      h('div', { class: 'metric-value' }, valueEl, unitEl),
      hint ? h('div', { class: 'metric-hint' }, hint) : null);
    return {
      root, el: valueEl, unitEl,
      set(number, formatFn = (v) => num(v), unitText) {
        if (!isNumber(number)) {
          setText(valueEl, 'N/A');
          if (unitText !== undefined) setText(unitEl, '');
          valueEl._value = undefined;
          return;
        }
        if (unitText !== undefined) setText(unitEl, unitText);
        animateNumber(valueEl, Number(number), formatFn);
      },
      setText(text) {
        setText(valueEl, text);
        setText(unitEl, '');
        valueEl._value = undefined;
      }
    };
  }

  function progress() {
    const fill = h('div', { class: 'progress-fill' });
    const root = h('div', { class: 'progress' }, fill);
    return {
      root,
      set(percent) {
        fill.style.transform = `scaleX(${clamp(Number(percent) || 0, 0, 100) / 100})`;
      }
    };
  }

  function badge(text, kind = '') {
    return h('span', { class: `badge ${kind}`.trim() }, text);
  }

  function empty(title, hint = '', icon = 'activity') {
    return h('div', { class: 'empty' },
      h('div', { class: 'empty-icon' }, iconEl(icon, 28)),
      h('p', { class: 'empty-title' }, title),
      hint ? h('p', { class: 'empty-hint' }, hint) : null);
  }

  function reconcile(container, keys, create) {
    const signature = keys.join('|');
    if (container.dataset.signature !== signature) {
      container.replaceChildren(...keys.map((key, index) => create(key, index)));
      container.dataset.signature = signature;
    }
    return Array.from(container.children);
  }

  const TEMP_STOPS = [
    [0, [0, 224, 184]], [48, [0, 224, 184]], [58, [255, 209, 102]],
    [68, [255, 209, 102]], [76, [255, 159, 67]], [84, [255, 159, 67]],
    [90, [255, 77, 109]], [110, [255, 45, 85]]
  ];

  function tempColor(value) {
    if (!isNumber(value)) return 'var(--muted)';
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
    return 'rgb(255, 45, 85)';
  }

  function applyTemp(el, value) {
    if (!el) return;
    el.style.setProperty('--temp-color', tempColor(value));
    el.style.color = tempColor(value);
    el.classList.toggle('is-hot', Number(value) > 85);
  }

  function toast(message) {
    const container = document.getElementById('toasts');
    if (!container) return;
    const node = h('div', { class: 'toast' }, message);
    container.append(node);
    setTimeout(() => {
      node.classList.add('out');
      setTimeout(() => node.remove(), 240);
    }, 2800);
  }

  // ---------------------------------------------------------------- charts
  const MONO = '"JetBrains Mono", "Cascadia Mono", Consolas, monospace';

  function withAlpha(color, alpha) {
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
      return `rgba(${parseInt(full.slice(0, 2), 16)}, ${parseInt(full.slice(2, 4), 16)}, ${parseInt(full.slice(4, 6), 16)}, ${alpha})`;
    }
    return color;
  }

  function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function prepareCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    return { ctx, width: rect.width, height: rect.height };
  }

  class LineChart {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.series = (options.series || [{ name: '数值', color: '#f5a623' }])
        .map((item) => ({ ...item, points: [] }));
      this.format = options.format || ((v) => num(v, 1));
      this.axisFormat = options.axisFormat || this.format;
      this.capacity = options.capacity || 300;
      this.baselineZero = options.baselineZero !== false;
      this.fixedMin = isNumber(options.min) ? Number(options.min) : null;
      this.fixedMax = isNumber(options.max) ? Number(options.max) : null;
      this._hover = null;
      this._raf = 0;
      this._onMove = (event) => {
        const rect = canvas.getBoundingClientRect();
        this._hover = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        this._schedule();
      };
      this._onLeave = () => { this._hover = null; this._schedule(); };
      canvas.addEventListener('pointermove', this._onMove);
      canvas.addEventListener('pointerleave', this._onLeave);
      this._observer = new ResizeObserver(() => this._schedule());
      this._observer.observe(canvas.parentElement || canvas);
      this._schedule();
    }

    setSeries(arrays) {
      arrays.forEach((points, index) => {
        if (this.series[index]) this.series[index].points = (points || []).slice(-this.capacity);
      });
      this._schedule();
    }

    push(values, timestamp) {
      this.series.forEach((series, index) => {
        series.points.push({ t: Number(timestamp), v: values[index] ?? null });
        if (series.points.length > this.capacity)
          series.points.splice(0, series.points.length - this.capacity);
      });
      this._schedule();
    }

    setCapacity(capacity) {
      this.capacity = Math.max(10, capacity);
      this.series.forEach((series) => {
        if (series.points.length > this.capacity)
          series.points.splice(0, series.points.length - this.capacity);
      });
      this._schedule();
    }

    _schedule() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this._render(); });
    }

    _render() {
      const prepared = prepareCanvas(this.canvas);
      if (!prepared) return;
      const { ctx, width, height } = prepared;
      const allPoints = this.series.flatMap((series) => series.points);
      const finitePoints = allPoints.filter((p) => isNumber(p.v));
      if (!finitePoints.length) {
        ctx.fillStyle = 'rgba(206, 188, 180, 0.55)';
        ctx.font = `14px ${MONO}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('暂无历史数据', width / 2, height / 2);
        return;
      }

      const pad = { l: 72, r: 16, t: 18, b: 30 };
      const plotW = Math.max(1, width - pad.l - pad.r);
      const plotH = Math.max(1, height - pad.t - pad.b);
      let minT = Math.min(...allPoints.map((p) => p.t));
      let maxT = Math.max(...allPoints.map((p) => p.t));
      if (maxT - minT < 1000) minT = maxT - 60_000;

      let minV = Math.min(...finitePoints.map((p) => Number(p.v)));
      let maxV = Math.max(...finitePoints.map((p) => Number(p.v)));
      if (this.fixedMin !== null) minV = this.fixedMin;
      else if (this.baselineZero) minV = Math.min(0, minV);
      if (this.fixedMax !== null) maxV = this.fixedMax;
      if (maxV - minV < 0.0001) {
        maxV += 1;
        if (!this.baselineZero) minV -= 1;
      }
      if (this.fixedMax === null) {
        const padding = (maxV - minV) * 0.12;
        maxV += padding;
        if (!this.baselineZero && this.fixedMin === null) minV -= padding;
      }

      const xOf = (t) => pad.l + ((t - minT) / (maxT - minT)) * plotW;
      const yOf = (v) => pad.t + (1 - (Number(v) - minV) / (maxV - minV)) * plotH;

      ctx.font = `13px ${MONO}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      for (let i = 0; i <= 3; i++) {
        const value = minV + ((maxV - minV) * i) / 3;
        const y = yOf(value);
        ctx.strokeStyle = 'rgba(255, 240, 230, 0.07)';
        ctx.beginPath();
        ctx.moveTo(pad.l, y);
        ctx.lineTo(width - pad.r, y);
        ctx.stroke();
        ctx.fillStyle = 'rgba(206, 188, 180, 0.65)';
        ctx.fillText(this.axisFormat(value), pad.l - 8, y);
      }

      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(206, 188, 180, 0.5)';
      for (let i = 0; i <= 2; i++) {
        const t = minT + ((maxT - minT) * i) / 2;
        const x = Math.min(width - pad.r - 24, Math.max(pad.l + 24, xOf(t)));
        ctx.fillText(clockSeconds(t), x, height - pad.b + 7);
      }

      for (const series of this.series) {
        const segments = [];
        let current = [];
        for (const point of series.points) {
          if (isNumber(point.v)) current.push(point);
          else if (current.length) { segments.push(current); current = []; }
        }
        if (current.length) segments.push(current);

        for (const segment of segments) {
          if (segment.length < 2) continue;
          const gradient = ctx.createLinearGradient(0, pad.t, 0, height - pad.b);
          gradient.addColorStop(0, withAlpha(series.color, 0.22));
          gradient.addColorStop(1, withAlpha(series.color, 0));
          ctx.beginPath();
          ctx.moveTo(xOf(segment[0].t), yOf(segment[0].v));
          for (let i = 1; i < segment.length; i++) ctx.lineTo(xOf(segment[i].t), yOf(segment[i].v));
          ctx.lineTo(xOf(segment[segment.length - 1].t), height - pad.b);
          ctx.lineTo(xOf(segment[0].t), height - pad.b);
          ctx.closePath();
          ctx.fillStyle = gradient;
          ctx.fill();
        }

        ctx.save();
        ctx.strokeStyle = series.color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.shadowColor = series.color;
        ctx.shadowBlur = 5;
        for (const segment of segments) {
          if (segment.length < 2) continue;
          ctx.beginPath();
          ctx.moveTo(xOf(segment[0].t), yOf(segment[0].v));
          for (let i = 1; i < segment.length; i++) ctx.lineTo(xOf(segment[i].t), yOf(segment[i].v));
          ctx.stroke();
        }
        ctx.restore();

        const last = [...series.points].reverse().find((p) => isNumber(p.v));
        if (last) {
          ctx.save();
          ctx.fillStyle = series.color;
          ctx.shadowColor = series.color;
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(xOf(last.t), yOf(last.v), 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      if (this._hover && this._hover.x >= pad.l && this._hover.x <= width - pad.r) {
        this._drawHover(ctx, width, height, pad, xOf, yOf);
      }
    }

    _drawHover(ctx, width, height, pad, xOf, yOf) {
      const reference = this.series.find((series) => series.points.some((p) => isNumber(p.v)));
      if (!reference) return;
      let nearest = null;
      for (const point of reference.points) {
        if (!isNumber(point.v)) continue;
        const distance = Math.abs(xOf(point.t) - this._hover.x);
        if (!nearest || distance < nearest.distance) nearest = { point, distance };
      }
      if (!nearest) return;

      const x = xOf(nearest.point.t);
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 240, 230, 0.18)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, height - pad.b);
      ctx.stroke();
      ctx.restore();

      const rows = [];
      for (const series of this.series) {
        let point = null;
        for (const candidate of series.points) {
          if (!isNumber(candidate.v)) continue;
          if (!point || Math.abs(candidate.t - nearest.point.t) < Math.abs(point.t - nearest.point.t))
            point = candidate;
        }
        if (!point) continue;
        rows.push({ name: series.name, color: series.color, value: point.v });
        ctx.save();
        ctx.fillStyle = series.color;
        ctx.shadowColor = series.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(xOf(point.t), yOf(point.v), 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (!rows.length) return;

      const lines = [dateTime(nearest.point.t)];
      for (const row of rows) lines.push(`${row.name ? row.name + ' ' : ''}${this.format(row.value)}`);
      ctx.font = `13px ${MONO}`;
      const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
      const boxW = textWidth + 22;
      const boxH = lines.length * 17 + 14;
      let boxX = x + 10;
      if (boxX + boxW > width - 6) boxX = x - boxW - 10;
      const boxY = Math.max(6, Math.min(height - boxH - 6, this._hover.y - boxH / 2));
      ctx.fillStyle = 'rgba(20, 14, 15, 0.92)';
      ctx.strokeStyle = 'rgba(255, 240, 230, 0.12)';
      roundRect(ctx, boxX, boxY, boxW, boxH, 10);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(238, 224, 216, 0.72)';
      ctx.fillText(lines[0], boxX + 11, boxY + 8);
      for (let i = 1; i < lines.length; i++) {
        ctx.fillStyle = rows[i - 1].color;
        ctx.fillText(lines[i], boxX + 11, boxY + 8 + i * 17);
      }
    }

    destroy() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._observer.disconnect();
      this.canvas.removeEventListener('pointermove', this._onMove);
      this.canvas.removeEventListener('pointerleave', this._onLeave);
    }
  }

  class RingGauge {
    constructor(canvas) {
      this.canvas = canvas;
      this.load = 0;
      this.temp = 0;
      this.tempColor = '#ff8a3d';
      this.targetLoad = 0;
      this.targetTemp = 0;
      this._raf = 0;
      this._observer = new ResizeObserver(() => this._render());
      this._observer.observe(canvas.parentElement || canvas);
      this._render();
    }

    set(load, temp, color) {
      this.targetLoad = clamp(Number(load) || 0, 0, 100);
      this.targetTemp = clamp(Number(temp) || 0, 0, 100);
      this.tempColor = color || '#ff8a3d';
      if (reducedMotion()) {
        this.load = this.targetLoad;
        this.temp = this.targetTemp;
        this._render();
        return;
      }
      if (this._raf) cancelAnimationFrame(this._raf);
      const fromLoad = this.load;
      const fromTemp = this.temp;
      const started = performance.now();
      const tick = (now) => {
        const p = Math.max(0, Math.min(1, (now - started) / 420));
        const eased = 1 - Math.pow(1 - p, 3);
        this.load = fromLoad + (this.targetLoad - fromLoad) * eased;
        this.temp = fromTemp + (this.targetTemp - fromTemp) * eased;
        this._render();
        if (p < 1) this._raf = requestAnimationFrame(tick);
        else this._raf = 0;
      };
      this._raf = requestAnimationFrame(tick);
    }

    _render() {
      const prepared = prepareCanvas(this.canvas);
      if (!prepared) return;
      const { ctx, width, height } = prepared;
      const cx = width / 2;
      const cy = height / 2;
      const baseRadius = Math.min(width, height) / 2 - 26;
      const outerRadius = baseRadius + 13;
      const start = -Math.PI / 2;
      ctx.lineCap = 'round';

      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 240, 230, 0.07)';
      ctx.lineWidth = 10;
      ctx.stroke();

      if (this.load > 0.4) {
        const gradient = ctx.createLinearGradient(cx - baseRadius, cy - baseRadius, cx + baseRadius, cy + baseRadius);
        gradient.addColorStop(0, '#f5a623');
        gradient.addColorStop(1, '#ff2a6d');
        ctx.save();
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 12;
        ctx.shadowColor = 'rgba(245,166,35,0.7)';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(cx, cy, baseRadius, start, start + (Math.PI * 2 * this.load) / 100);
        ctx.stroke();
        ctx.restore();
      }

      ctx.beginPath();
      ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 240, 230, 0.045)';
      ctx.lineWidth = 8;
      ctx.stroke();

      if (this.temp > 0.4) {
        ctx.save();
        ctx.strokeStyle = this.tempColor;
        ctx.lineWidth = 8;
        ctx.shadowColor = this.tempColor;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(cx, cy, outerRadius, start, start + (Math.PI * 2 * this.temp) / 100);
        ctx.stroke();
        ctx.restore();
      }
    }

    destroy() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._observer.disconnect();
    }
  }

  class Sparkline {
    constructor(canvas, color) {
      this.canvas = canvas;
      this.color = color;
      this.points = [];
      this._observer = new ResizeObserver(() => this._render());
      this._observer.observe(canvas.parentElement || canvas);
    }
    push(point) {
      this.points.push(point);
      if (this.points.length > 80) this.points.shift();
      this._render();
    }
    _render() {
      const prepared = prepareCanvas(this.canvas);
      if (!prepared) return;
      const { ctx, width, height } = prepared;
      const values = this.points.filter((p) => isNumber(p.v));
      if (values.length < 2) return;
      const minV = Math.min(...values.map((p) => Number(p.v)));
      const maxV = Math.max(...values.map((p) => Number(p.v)));
      const span = maxV - minV || 1;
      const pad = 4;
      const xOf = (index) => pad + (index / (this.points.length - 1)) * (width - pad * 2);
      const yOf = (value) => height - pad - ((Number(value) - minV) / span) * (height - pad * 2);
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, withAlpha(this.color, 0.28));
      gradient.addColorStop(1, withAlpha(this.color, 0));
      ctx.beginPath();
      let started = false;
      this.points.forEach((point, index) => {
        if (!isNumber(point.v)) { started = false; return; }
        if (!started) { ctx.moveTo(xOf(index), yOf(point.v)); started = true; }
        else ctx.lineTo(xOf(index), yOf(point.v));
      });
      const last = this.points[this.points.length - 1];
      if (last && isNumber(last.v)) {
        ctx.lineTo(xOf(this.points.length - 1), height - pad);
        ctx.lineTo(xOf(0), height - pad);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();
      }
      ctx.beginPath();
      started = false;
      this.points.forEach((point, index) => {
        if (!isNumber(point.v)) { started = false; return; }
        if (!started) { ctx.moveTo(xOf(index), yOf(point.v)); started = true; }
        else ctx.lineTo(xOf(index), yOf(point.v));
      });
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    destroy() { this._observer.disconnect(); }
  }

  // ---------------------------------------------------------------- mock data
  const GiB = 1024 ** 3;
  const MiB = 1024 ** 2;
  const BOOT = Date.now() - 3.4 * 86400 * 1000;
  const historyCache = new Map();
  let sequence = 0;
  let simulateMissing = false;
  let reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const netTotals = { up: 28.4 * GiB, down: 63.7 * GiB };

  function clampValue(value, min, max) {
    return clamp(value, min, max);
  }

  function makeSnapshot() {
    const now = Date.now();
    const t = now / 1000;
    const load = clampValue(22 + 13 * Math.sin(t / 8) + 6 * Math.sin(t / 2.7), 2, 88);
    const coreLoads = Array.from({ length: 8 }, (_, index) =>
      clampValue(load + 12 * Math.sin(t / (5 + index * 0.4) + index) + (Math.random() - 0.5) * 8, 0, 100));
    const tempBase = 52 + load * 0.19 + 2.5 * Math.sin(t / 15);
    const freq = 2100 + load * 15 + 120 * Math.sin(t / 4);
    const memUsed = (7.8 + 0.55 * Math.sin(t / 23)) * GiB;
    const memTotal = 16 * GiB;
    const netDown = 1_150_000 + 850_000 * (0.5 + 0.5 * Math.sin(t / 9)) + Math.random() * 90_000;
    const netUp = 120_000 + 95_000 * (0.5 + 0.5 * Math.sin(t / 12 + 1)) + Math.random() * 30_000;
    netTotals.down += netDown;
    netTotals.up += netUp;
    const diskRead = 2.2 * MiB + 1.8 * MiB * (0.5 + 0.5 * Math.sin(t / 7));
    const diskWrite = 1.1 * MiB + 1.4 * MiB * (0.5 + 0.5 * Math.sin(t / 5 + 2));
    const fanRpm = 2380 + load * 12 + 180 * Math.sin(t / 11);
    const batteryCharge = 87 - ((t % 3600) / 3600) * 0.8;

    const snapshot = {
      ts: new Date(now).toISOString(),
      seq: ++sequence,
      system: {
        hostname: 'OLD-LAPTOP',
        osName: 'Windows 10 Pro',
        osVersion: '22H2 (Build 19045)',
        uptimeSeconds: (now - BOOT) / 1000,
        cpuModel: 'Intel Core i5-8250U @ 1.60GHz',
        board: 'LENOVO 20K5S0VY00',
        bios: 'N25ET54W (1.36)',
        appVersion: '1.0.0-preview'
      },
      cpu: {
        model: 'Intel Core i5-8250U',
        physicalCores: 4,
        logicalCores: 8,
        load,
        coreLoads: coreLoads.map((value, index) => ({ index: index + 1, value })),
        freqMhz: freq,
        freqMinMhz: 812,
        freqMaxMhz: 3400,
        freqEffectiveMhz: freq * 0.93,
        multiplier: freq / 100,
        busClockMhz: 100,
        tempPackage: tempBase,
        tempMax: tempBase + 4,
        tempCores: Array.from({ length: 4 }, (_, index) => ({
          index: index + 1,
          value: tempBase - 3 + index * 1.2 + Math.sin(t / 13 + index) * 1.5
        })),
        powerPackage: 11 + load * 0.17,
        voltage: 0.92 + Math.sin(t / 10) * 0.03,
        processCount: 146,
        threadCount: 1284
      },
      memory: {
        totalBytes: memTotal,
        usedBytes: memUsed,
        freeBytes: memTotal - memUsed,
        load: (memUsed / memTotal) * 100,
        speedMhz: 2400,
        slotsUsed: 2,
        slotCount: 2,
        moduleType: 'DDR4',
        commitTotalBytes: memUsed + 2.8 * GiB,
        commitLimitBytes: 24 * GiB,
        pageFileUsedBytes: 0.9 * GiB
      },
      gpus: [{
        name: 'NVIDIA GeForce MX150',
        vendor: 'NVIDIA',
        load: clampValue(26 + 18 * Math.sin(t / 7), 0, 100),
        temp: 53 + 6 * Math.sin(t / 15),
        clockMhz: 1469 + 120 * Math.sin(t / 9),
        memUsedBytes: 1.1 * GiB,
        memTotalBytes: 2 * GiB,
        fanRpm: 2200 + 180 * Math.sin(t / 12),
        powerW: 11.5 + 2.4 * Math.sin(t / 8)
      }, {
        name: 'Intel UHD Graphics 620',
        vendor: 'Intel',
        load: clampValue(8 + 7 * Math.sin(t / 6), 0, 100),
        temp: 47 + 5 * Math.sin(t / 14),
        clockMhz: 950,
        memUsedBytes: 420 * MiB,
        memTotalBytes: 2 * GiB,
        powerW: 4.2
      }],
      disks: [{
        id: 'disk0',
        name: 'Samsung SSD 860 EVO 500GB',
        model: 'Samsung SSD 860 EVO 500GB',
        mediaType: 'SSD',
        temperature: 37 + 3 * Math.sin(t / 21),
        healthPercent: 96,
        healthStatus: 'OK',
        totalBytes: 465 * GiB,
        freeBytes: 186 * GiB,
        readBytesPerSec: diskRead,
        writeBytesPerSec: diskWrite,
        driveLetters: ['C:', 'D:']
      }],
      fans: [{
        id: 'fan0',
        name: 'CPU Fan',
        hardware: 'Nuvoton NCT6779D',
        rpm: fanRpm,
        percent: 52 + load * 0.25,
        source: 'lhm'
      }],
      network: {
        uploadBytesPerSec: netUp,
        downloadBytesPerSec: netDown,
        totalUploadedBytes: netTotals.up,
        totalDownloadedBytes: netTotals.down,
        publicIpv6: '2409:8a18:2710:de74:7040:ff62:3ef6:3',
        ipv6Addresses: [
          '2409:8a18:2710:de74:7040:ff62:3ef6:3',
          '2409:8a18:2710:de74:97cc:ddd8:d10f:ab2c'
        ],
        adapters: [{
          name: '以太网',
          description: 'Realtek PCIe GbE Family Controller',
          status: 'Up',
          mac: 'B0:25:AA:89:E4:BC',
          speedBps: 1_000_000_000,
          ipv4: ['192.168.1.10'],
          ipv6: ['2409:8a18:2710:de74:7040:ff62:3ef6:3']
        }]
      },
      battery: {
        present: true,
        chargePercent: batteryCharge,
        charging: false,
        onAc: true,
        designCapacityMwh: 45000,
        fullChargeCapacityMwh: 39800,
        healthPercent: 88.4,
        voltage: 12.4,
        powerW: 8.2,
        timeRemainingSeconds: 7200
      },
      env: {
        boardTemp: 41 + 2.5 * Math.sin(t / 18),
        chipsetTemp: 46 + 2 * Math.sin(t / 16),
        caseTemp: 34 + 1.5 * Math.sin(t / 25),
        vrmTemp: 51 + 3 * Math.sin(t / 20),
        extras: [
          { name: 'Temperature #3', value: 43 + 2 * Math.sin(t / 17) }
        ],
        thermalZones: [
          { name: 'ACPI Thermal Zone', value: 57 + 2 * Math.sin(t / 19) }
        ]
      },
      status: {
        admin: true,
        readOnly: false,
        pawnIo: true,
        lhmAvailable: true,
        lhmError: null,
        readErrors: 0,
        totalReadErrors: 0,
        sensorsMissing: [],
        samplingMs: 18,
        clients: 1,
        fanSource: 'lhm',
        wmiFanCount: 1,
        acpiThermalZoneCount: 1
      }
    };

    if (simulateMissing) {
      snapshot.cpu.tempPackage = null;
      snapshot.cpu.tempMax = null;
      snapshot.cpu.tempCores = [];
      snapshot.cpu.powerPackage = null;
      snapshot.cpu.voltage = null;
      snapshot.cpu.freqMhz = null;
      snapshot.cpu.freqEffectiveMhz = null;
      snapshot.cpu.multiplier = null;
      snapshot.gpus[0].temp = null;
      snapshot.disks[0].temperature = null;
      snapshot.disks[0].healthPercent = null;
      snapshot.fans = [];
      snapshot.env.boardTemp = null;
      snapshot.env.chipsetTemp = null;
      snapshot.env.caseTemp = null;
      snapshot.env.vrmTemp = null;
      snapshot.battery.healthPercent = null;
      snapshot.status.fanSource = 'none';
      snapshot.status.wmiFanCount = 0;
      snapshot.status.acpiThermalZoneCount = 1;
      snapshot.status.sensorsMissing = [
        'cpu.temp', 'cpu.power', 'gpu', 'fan', 'env.board', 'disk.temp', 'battery.health'
      ];
    }

    return snapshot;
  }

  const RANGE_SECONDS = { '5m': 300, '15m': 900, '1h': 3600 };

  // 总览与 GPU 页共用同一个“当前显卡”选择
  const GPU_KEY = 'hpmon.gpu';
  function savedGpu() {
    try { return localStorage.getItem(GPU_KEY) || ''; } catch { return ''; }
  }
  function saveGpu(name) {
    try { localStorage.setItem(GPU_KEY, name); } catch { }
  }

  function makeHistory(metric, range) {
    const key = `${metric}:${range}`;
    if (historyCache.has(key)) return historyCache.get(key);
    const count = RANGE_SECONDS[range] || 300;
    const end = Date.now();
    const points = [];
    for (let i = 0; i < count; i++) {
      const t = end - (count - 1 - i) * 1000;
      let value;
      switch (metric) {
        case 'cpu.load':
          value = clampValue(24 + 12 * Math.sin(i / 17) + 5 * Math.sin(i / 4.7), 1, 95);
          break;
        case 'cpu.temp':
          value = 56 + 7 * Math.sin(i / 21) + 2 * Math.sin(i / 6);
          break;
        case 'mem.percent':
          value = 48 + 3.5 * Math.sin(i / 40);
          break;
        case 'gpu.0.load':
          value = clampValue(26 + 18 * Math.sin(i / 23) + 6 * Math.sin(i / 6), 0, 100);
          break;
        case 'gpu.0.temp':
          value = 53 + 6 * Math.sin(i / 25) + 1.5 * Math.sin(i / 5);
          break;
        case 'gpu.1.load':
          value = clampValue(9 + 7 * Math.sin(i / 29), 0, 100);
          break;
        case 'gpu.1.temp':
          value = 47 + 5 * Math.sin(i / 31);
          break;
        case 'net.down':
          value = 1_000_000 + 700_000 * (0.5 + 0.5 * Math.sin(i / 13)) + Math.random() * 80_000;
          break;
        case 'net.up':
          value = 100_000 + 70_000 * (0.5 + 0.5 * Math.sin(i / 15 + 1)) + Math.random() * 20_000;
          break;
        case 'disk.read':
          value = 2.4 * MiB + 1.8 * MiB * (0.5 + 0.5 * Math.sin(i / 11));
          break;
        case 'disk.write':
          value = 1.2 * MiB + 1.2 * MiB * (0.5 + 0.5 * Math.sin(i / 9 + 2));
          break;
        case 'fan.max':
          value = 2500 + 420 * Math.sin(i / 26) + 80 * Math.sin(i / 7);
          break;
        default:
          value = 0;
      }
      points.push({ t, v: Math.max(0, value) });
    }
    historyCache.set(key, points);
    return points;
  }

  function clearHistory() {
    historyCache.clear();
  }

  // ---------------------------------------------------------------- views
  let state;

  const overviewView = {
    meta: { title: '总览', eyebrow: 'SYSTEM OVERVIEW', subtitle: '实时掌握这台服务器的呼吸' },
    mount(root) {
      const grid = h('div', { class: 'grid' });
      root.append(grid);
      const alerts = h('div', { class: 'span-12' });
      grid.append(alerts);

      const cpuCard = card({ title: 'CPU', icon: 'cpu', sub: '处理器实时负载', className: 'span-5 hero-card cpu-overview' });
      const ringCanvas = h('canvas');
      const ringLoad = h('span', { class: 'metric-number' }, 'N/A');
      const ringTemp = h('div', { class: 'ring-temp' }, '温度 N/A');
      const ringWrap = h('div', { class: 'ring-wrap' }, ringCanvas,
        h('div', { class: 'ring-center' },
          h('div', { class: 'ring-value' }, ringLoad, h('span', { class: 'ring-unit' }, '%')),
          h('div', { class: 'ring-label' }, 'CPU 占用'),
          ringTemp));
      const ring = new RingGauge(ringCanvas);
      const mFreq = metric({ label: '当前频率', big: true });
      const mPower = metric({ label: '封装功耗', big: true });
      const mVolt = metric({ label: '核心电压', big: true });
      const coreLineValue = h('span', { class: 'info-value' }, 'N/A');
      const coreLine = h('div', { class: 'cpu-coreline' },
        h('span', { class: 'info-label' }, '核心 / 线程'), coreLineValue);
      cpuCard.body.append(h('div', { class: 'hero-split cpu-hero' }, ringWrap,
        h('div', { class: 'cpu-quick' }, mFreq.root, mPower.root, mVolt.root)), coreLine);
      grid.append(cpuCard.root);

      const stack = h('div', { class: 'span-7 overview-side' });
      grid.append(stack);

      const memCard = card({ title: '内存', icon: 'memory', sub: '物理内存使用', className: 'overview-mem' });
      const memUsed = metric({ label: '已用' });
      const memFree = metric({ label: '可用' });
      const memProgress = progress();
      const memLeft = h('span', {}, 'N/A');
      const memRight = h('span', {}, 'N/A');
      const memMeta = h('div', { class: 'progress-row' });
      memCard.body.append(h('div', { class: 'mini-metrics' }, memUsed.root, memFree.root),
        h('div', { class: 'progress-space' }, memProgress.root),
        h('div', { class: 'progress-row' }, memLeft, memRight), memMeta);
      stack.append(memCard.root);

      const gpuPicker = h('div', { class: 'gpu-picker' });
      gpuPicker.hidden = true;
      const gpuCard = card({ title: 'GPU', icon: 'monitor', sub: '图形处理器', actions: gpuPicker, className: 'overview-gpu' });
      const gpuContent = h('div');
      const gpuName = h('div', { class: 'row-title' }, 'N/A');
      const gpuLoad = metric({ label: '占用' });
      const gpuTemp = metric({ label: '温度' });
      const gpuProgress = progress();
      const gpuMemText = h('div', { class: 'progress-row' });
      gpuContent.append(gpuName,
        h('div', { class: 'mini-metrics', style: { marginTop: '12px' } }, gpuLoad.root, gpuTemp.root),
        h('div', { class: 'progress-space' }, gpuProgress.root), gpuMemText);
      const gpuEmpty = empty('未检测到 GPU', '核显或驱动未暴露传感器时会显示此状态', 'monitor');
      gpuEmpty.hidden = true;
      gpuCard.body.append(gpuContent, gpuEmpty);
      stack.append(gpuCard.root);
      gpuMemText.replaceChildren(h('span', {}, '显存'), h('span', {}, 'N/A'));

      let gpuList = [];
      let gpuSelected = savedGpu();
      let pickerSignature = '';

      function currentGpu() {
        return gpuList.find((gpu) => gpu.name === gpuSelected) || gpuList[0] || null;
      }

      function renderGpuPicker() {
        gpuPicker.hidden = gpuList.length < 2;
        if (gpuList.length < 2) return;
        const signature = gpuList.map((gpu) => gpu.name).join('|');
        if (signature !== pickerSignature) {
          pickerSignature = signature;
          gpuPicker.replaceChildren(...gpuList.map((gpu, index) => {
            const label = `GPU${index + 1}`;
            const button = h('button', { type: 'button', class: 'chip', title: gpu.name || label, 'aria-label': gpu.name || label }, label);
            button.addEventListener('click', () => {
              gpuSelected = gpu.name || '';
              saveGpu(gpuSelected);
              renderGpuPicker();
              applyGpu();
            });
            return button;
          }));
        }
        gpuList.forEach((gpu, index) => {
          const button = gpuPicker.children[index];
          if (button) button.classList.toggle('active', gpu.name === gpuSelected);
        });
      }

      function applyGpu() {
        const gpu = currentGpu();
        gpuContent.hidden = !gpu;
        gpuEmpty.hidden = Boolean(gpu);
        if (!gpu) return;
        setText(gpuName, gpu.name || 'GPU');
        gpuLoad.set(gpu.load, (v) => num(v, 0), '%');
        gpuTemp.set(gpu.temp, (v) => num(v, 1), '°C');
        applyTemp(gpuTemp.el, gpu.temp);
        const memPct = isNumber(gpu.memUsedBytes) && isNumber(gpu.memTotalBytes) && gpu.memTotalBytes > 0
          ? (gpu.memUsedBytes / gpu.memTotalBytes) * 100 : 0;
        gpuProgress.set(memPct);
        setText(gpuMemText.lastChild, `${bytes(gpu.memUsedBytes)} / ${bytes(gpu.memTotalBytes)}`);
      }

      const batteryCard = card({ title: '电池', icon: 'battery', sub: '笔记本电池健康', className: 'overview-battery' });
      const batCharge = metric({ label: '剩余电量' });
      const batHealth = metric({ label: '健康度' });
      const batProgress = progress();
      const batStatus = h('div', { class: 'progress-row' });
      batteryCard.body.append(h('div', { class: 'mini-metrics' }, batCharge.root, batHealth.root),
        h('div', { class: 'progress-space' }, batProgress.root), batStatus);
      stack.append(batteryCard.root);

      const netCard = card({ title: '网络', icon: 'network', sub: '实时吞吐 · 最近 5 分钟', className: 'span-6' });
      const netDown = metric({ label: '下载' });
      const netUp = metric({ label: '上传' });
      const netCanvas = h('canvas');
      const netChart = new LineChart(netCanvas, {
        series: [{ name: '下载', color: '#ff8a3d' }, { name: '上传', color: '#ff2a6d' }],
        capacity: 300,
        format: (v) => rate(v),
        axisFormat: bytesShort,
        baselineZero: true
      });
      netChart.setSeries([makeHistory('net.down', '5m'), makeHistory('net.up', '5m')]);
      const netTotal = h('div', { class: 'progress-row' });
      netCard.body.append(h('div', { class: 'mini-metrics' }, netDown.root, netUp.root),
        h('div', { class: 'legend' },
          h('span', { class: 'legend-item' }, h('span', { class: 'legend-dot', style: { background: '#ff8a3d', color: '#ff8a3d' } }), '下载'),
          h('span', { class: 'legend-item' }, h('span', { class: 'legend-dot', style: { background: '#ff2a6d', color: '#ff2a6d' } }), '上传')),
        h('div', { class: 'chart-box small' }, netCanvas), netTotal);
      grid.append(netCard.root);

      const storageCard = card({ title: '存储', icon: 'storage', sub: '物理磁盘与容量', className: 'span-6' });
      const storageTotal = metric({ label: '总容量' });
      const storageFree = metric({ label: '剩余' });
      const storageProgress = progress();
      const storageMeta = h('div', { class: 'progress-row' });
      const storageList = h('div', { class: 'list', style: { marginTop: '14px' } });
      storageCard.body.append(h('div', { class: 'mini-metrics' }, storageTotal.root, storageFree.root),
        h('div', { class: 'progress-space' }, storageProgress.root), storageMeta, storageList);
      grid.append(storageCard.root);

      const systemCard = card({ title: '系统', icon: 'server', sub: '主机、主板与运行环境', className: 'span-12' });
      function infoCell(label, wrap = false) {
        const value = h('div', { class: `info-value${wrap ? ' wrap' : ''}` }, 'N/A');
        return {
          cell: h('div', { class: 'info-cell' }, h('div', { class: 'info-label' }, label), value),
          value
        };
      }
      const sysOs = infoCell('操作系统', true);
      const sysBoard = infoCell('主板 / BIOS', true);
      const sysCpu = infoCell('CPU 型号', true);
      const sysUptime = infoCell('运行时长');
      const sysProc = infoCell('进程 / 线程');
      const sysFan = infoCell('风扇');
      const sysEnv = infoCell('主板 / 机箱温度');
      const sysIpv6 = infoCell('公网 IPv6', true);
      systemCard.body.append(h('div', { class: 'info-grid' },
        sysOs.cell, sysBoard.cell, sysCpu.cell, sysUptime.cell, sysProc.cell, sysFan.cell, sysEnv.cell, sysIpv6.cell));
      grid.append(systemCard.root);

      function createStorageRow() {
        const title = h('div', { class: 'row-title' }, 'N/A');
        const sub = h('div', { class: 'row-sub' }, '');
        const temp = h('span', { class: 'badge' }, 'N/A');
        const free = h('span', { class: 'row-sub' }, 'N/A');
        const row = h('div', { class: 'row' },
          h('div', { class: 'row-main' }, title, sub),
          h('div', { class: 'row-side' }, temp, free));
        row._refs = { title, sub, temp, free };
        return row;
      }

      function update(snapshot) {
        const status = snapshot.status || {};
        const alertsList = [];
        if (!status.admin) alertsList.push(['warn', '未以管理员权限运行，温度、风扇、功耗等传感器可能缺失。']);
        if (!status.pawnIo) alertsList.push(['warn', '未检测到 PawnIO，CPU 温度/功耗与 EC 风扇可能无法读取。']);
        if (state.missing) alertsList.push(['info', '当前为“模拟传感器缺失”预览：温度/风扇/磁盘健康度会显示 N/A。']);
        alerts.replaceChildren(...alertsList.map(([kind, text]) =>
          h('div', { class: `alert ${kind}`.trim() }, iconEl(kind === 'bad' ? 'alert' : 'shield', 18), h('span', {}, text))));
        alerts.hidden = alertsList.length === 0;

        const cpu = snapshot.cpu || {};
        const load = isNumber(cpu.load) ? Number(cpu.load) : null;
        const tempValue = isNumber(cpu.tempPackage) ? Number(cpu.tempPackage) : null;
        animateNumber(ringLoad, load ?? NaN, (v) => num(v, 0));
        if (load === null) setText(ringLoad, 'N/A');
        setText(ringTemp, `温度 ${temp(tempValue)}`);
        applyTemp(ringTemp, tempValue);
        ring.set(load ?? 0, tempValue ?? 0, tempColor(tempValue));

        mFreq.set(cpu.freqMhz, (v) => num(v, 0), 'MHz');
        mPower.set(cpu.powerPackage, (v) => num(v, 1), 'W');
        mVolt.set(cpu.voltage, (v) => num(v, 3), 'V');
        setText(coreLineValue, `${cpu.physicalCores ?? '—'} 核 / ${cpu.logicalCores ?? '—'} 线程`);

        const memory = snapshot.memory || {};
        memUsed.set(memory.usedBytes, (v) => bytes(v));
        memFree.set(memory.freeBytes, (v) => bytes(v));
        memProgress.set(memory.load);
        setText(memLeft, `${bytes(memory.usedBytes)} / ${bytes(memory.totalBytes)}`);
        setText(memRight, pct(memory.load));
        memMeta.replaceChildren(h('span', {}, '频率 / 插槽'),
          h('span', {}, `${memory.speedMhz ? num(memory.speedMhz, 0) + ' MHz' : 'N/A'} · ${memory.slotsUsed ?? '—'}/${memory.slotCount ?? '—'} 槽`));

        gpuList = snapshot.gpus || [];
        if (gpuList.length && !gpuList.some((gpu) => gpu.name === gpuSelected)) {
          gpuSelected = gpuList[0].name || '';
          saveGpu(gpuSelected);
        }
        renderGpuPicker();
        applyGpu();

        const battery = snapshot.battery || {};
        batteryCard.root.hidden = !battery.present;
        if (battery.present) {
          batCharge.set(battery.chargePercent, (v) => num(v, 0), '%');
          batHealth.set(battery.healthPercent, (v) => num(v, 0), '%');
          batProgress.set(battery.chargePercent);
          batStatus.replaceChildren(h('span', {}, battery.charging ? '正在充电' : battery.onAc ? '已接电源' : '电池供电'),
            h('span', {}, isNumber(battery.powerW) ? `功耗 ${watt(battery.powerW)}` : ''));
        }

        const network = snapshot.network || {};
        netDown.set(network.downloadBytesPerSec, (v) => bytes(v), '/s');
        netUp.set(network.uploadBytesPerSec, (v) => bytes(v), '/s');
        netChart.push([network.downloadBytesPerSec ?? null, network.uploadBytesPerSec ?? null], Date.parse(snapshot.ts));
        netTotal.replaceChildren(h('span', {}, `累计下行 ${bytes(network.totalDownloadedBytes)}`),
          h('span', {}, `累计上行 ${bytes(network.totalUploadedBytes)}`));

        const disks = snapshot.disks || [];
        const total = disks.reduce((sum, d) => sum + (Number(d.totalBytes) || 0), 0);
        const free = disks.reduce((sum, d) => sum + (Number(d.freeBytes) || 0), 0);
        storageTotal.set(total || null, (v) => bytes(v));
        storageFree.set(free || null, (v) => bytes(v));
        storageProgress.set(total > 0 ? ((total - free) / total) * 100 : 0);
        storageMeta.replaceChildren(h('span', {}, `已用 ${bytes(total - free)}`),
          h('span', {}, total > 0 ? pct(((total - free) / total) * 100) : 'N/A'));
        const nodes = reconcile(storageList, disks.map((d) => d.id), createStorageRow);
        disks.forEach((disk, index) => {
          const row = nodes[index];
          if (!row) return;
          setText(row._refs.title, disk.model || disk.name);
          setText(row._refs.sub, `${(disk.driveLetters || []).join(' · ')} · ${disk.mediaType || '磁盘'}`);
          setText(row._refs.temp, temp(disk.temperature));
          applyTemp(row._refs.temp, disk.temperature);
          setText(row._refs.free, bytes(disk.freeBytes));
        });

        const system = snapshot.system || {};
        setText(sysOs.value, `${system.osName} · ${system.osVersion}`);
        setText(sysBoard.value, `${system.board} · ${system.bios}`);
        setText(sysCpu.value, system.cpuModel);
        setText(sysUptime.value, uptime(system.uptimeSeconds));
        setText(sysProc.value, `${num(cpu.processCount, 0)} / ${num(cpu.threadCount, 0)}`);
        const fans = snapshot.fans || [];
        const maxRpm = fans.reduce((max, fan) => Math.max(max, Number(fan.rpm) || 0), 0);
        setText(sysFan.value, fans.length ? `${fans.length} 个${maxRpm ? ` · 最高 ${rpm(maxRpm)}` : ''}` : 'N/A');
        const env = snapshot.env || {};
        setText(sysEnv.value, `${temp(env.boardTemp)} / ${temp(env.caseTemp)}`);
        setText(sysIpv6.value, network.publicIpv6 || 'N/A');
      }

      return { update, destroy() { ring.destroy(); netChart.destroy(); } };
    }
  };

  const cpuView = {
    meta: { title: 'CPU', eyebrow: 'PROCESSOR', subtitle: '频率、温度、功耗与每个逻辑核心' },
    mount(root) {
      const grid = h('div', { class: 'grid' });
      root.append(grid);

      const hero = card({ title: 'CPU 负载', icon: 'cpu', sub: '封装占用与温度', className: 'span-5 hero-card cpu-hero-card' });
      const ringCanvas = h('canvas');
      const ringLoad = h('span', { class: 'metric-number' }, 'N/A');
      const ringTemp = h('div', { class: 'ring-temp' }, '温度 N/A');
      const ringWrap = h('div', { class: 'ring-wrap' }, ringCanvas,
        h('div', { class: 'ring-center' },
          h('div', { class: 'ring-value' }, ringLoad, h('span', { class: 'ring-unit' }, '%')),
          h('div', { class: 'ring-label' }, 'CPU 占用'), ringTemp));
      const ring = new RingGauge(ringCanvas);
      const tempChips = h('div', { class: 'chip-list', style: { marginTop: '18px' } });
      hero.body.append(ringWrap, tempChips);
      grid.append(hero.root);

      const coreCard = card({ title: '核心负载', icon: 'activity', sub: '每个逻辑核心的实时占用', className: 'span-7 core-load-card' });
      const coreGrid = h('div', { class: 'core-grid' });
      coreCard.body.append(coreGrid);
      grid.append(coreCard.root);

      const loadCard = card({ title: '占用率历史', icon: 'activity', sub: '最近 5 分钟', className: 'span-6' });
      const loadCanvas = h('canvas');
      const loadChart = new LineChart(loadCanvas, {
        series: [{ name: '占用', color: '#f5a623' }],
        capacity: 300,
        format: (v) => pct(v),
        axisFormat: (v) => `${num(v, 0)}%`,
        min: 0,
        max: 100,
        baselineZero: true
      });
      loadChart.setSeries([makeHistory('cpu.load', '5m')]);
      loadCard.body.append(h('div', { class: 'chart-box' }, loadCanvas));
      const loadRange = rangeChips((range) => {
        loadChart.setCapacity(RANGE_SECONDS[range]);
        loadChart.setSeries([makeHistory('cpu.load', range)]);
        loadCard.setSub(`最近 ${range === '5m' ? '5 分钟' : range === '15m' ? '15 分钟' : '1 小时'}`);
      });
      loadCard.head.append(h('div', { class: 'card-actions' }, loadRange));
      grid.append(loadCard.root);

      const tempCard = card({ title: '温度历史', icon: 'temp', sub: '最近 5 分钟', className: 'span-6' });
      const tempCanvas = h('canvas');
      const tempChart = new LineChart(tempCanvas, {
        series: [{ name: '封装温度', color: '#ffb020' }],
        capacity: 300,
        format: (v) => temp(v),
        axisFormat: (v) => `${num(v, 0)}°`,
        baselineZero: false
      });
      tempChart.setSeries([makeHistory('cpu.temp', '5m')]);
      tempCard.body.append(h('div', { class: 'chart-box' }, tempCanvas));
      const tempRange = rangeChips((range) => {
        tempChart.setCapacity(RANGE_SECONDS[range]);
        tempChart.setSeries([makeHistory('cpu.temp', range)]);
        tempCard.setSub(`最近 ${range === '5m' ? '5 分钟' : range === '15m' ? '15 分钟' : '1 小时'}`);
      });
      tempCard.head.append(h('div', { class: 'card-actions' }, tempRange));
      grid.append(tempCard.root);

      const infoCard = card({ title: '处理器详情', icon: 'cpu', sub: '频率、功耗、电压与核心规模', className: 'span-12' });
      const modelLine = h('div', { class: 'info-cell', style: { marginBottom: '10px' } },
        h('div', { class: 'info-label' }, 'CPU 型号'),
        h('div', { class: 'info-value wrap' }, 'N/A'));
      const modelValue = modelLine.querySelector('.info-value');
      const mFreq = metric({ label: '当前频率', big: true });
      const mMin = metric({ label: '最低频率（本次运行）' });
      const mMax = metric({ label: '最高频率（本次运行）' });
      const mEffective = metric({ label: '有效频率' });
      const mMultiplier = metric({ label: '倍频（估算）' });
      const mBus = metric({ label: '总线频率' });
      const mPower = metric({ label: '封装功耗', big: true });
      const mVoltage = metric({ label: '核心电压', big: true });
      const mCores = metric({ label: '核心 / 线程' });
      const mProcess = metric({ label: '进程 / 线程总数' });
      const mTemp = metric({ label: '封装温度', big: true });
      const mTempMax = metric({ label: '最高核心温度' });
      infoCard.body.append(
        modelLine,
        h('div', { class: 'metrics-grid highlight-grid' }, mFreq.root, mPower.root, mVoltage.root, mTemp.root),
        h('div', { class: 'metrics-grid detail-grid' },
          mMin.root, mMax.root, mEffective.root, mMultiplier.root,
          mBus.root, mCores.root, mProcess.root, mTempMax.root));
      grid.append(infoCard.root);

      function buildCoreTile() {
        const label = h('span', { class: 'core-index' }, 'C0');
        const value = h('span', { class: 'core-percent' }, '—');
        const fill = h('div', { class: 'core-tile-fill' });
        const node = h('div', { class: 'core-tile' }, fill,
          h('div', { class: 'core-tile-content' }, label, value));
        node._refs = { label, value, fill };
        return node;
      }
      function buildChip() {
        const text = h('span', {}, 'N/A');
        const node = h('span', { class: 'chip temp-chip' }, text);
        node._text = text;
        return node;
      }

      function update(snapshot) {
        const cpu = snapshot.cpu || {};
        const load = isNumber(cpu.load) ? Number(cpu.load) : null;
        const tempValue = isNumber(cpu.tempPackage) ? Number(cpu.tempPackage) : null;
        animateNumber(ringLoad, load ?? NaN, (v) => num(v, 0));
        if (load === null) setText(ringLoad, 'N/A');
        setText(ringTemp, `温度 ${temp(tempValue)}`);
        applyTemp(ringTemp, tempValue);
        ring.set(load ?? 0, tempValue ?? 0, tempColor(tempValue));

        const loads = cpu.coreLoads || [];
        const coreNodes = reconcile(coreGrid, loads.map((c) => String(c.index)), buildCoreTile);
        loads.forEach((core, index) => {
          const node = coreNodes[index];
          if (!node) return;
          setText(node._refs.label, `C${core.index}`);
          setText(node._refs.value, isNumber(core.value) ? pct(core.value, 0) : '—');
          const ratio = clamp(Number(core.value) || 0, 0, 100) / 100;
          node._refs.fill.style.transform = `scaleX(${ratio})`;
          node.style.setProperty('--load', String(ratio));
        });

        const temps = cpu.tempCores || [];
        const chips = reconcile(tempChips, temps.map((c) => String(c.index)), buildChip);
        temps.forEach((core, index) => {
          const node = chips[index];
          if (!node) return;
          setText(node._text, `C${core.index} ${temp(core.value)}`);
          applyTemp(node, core.value);
        });

        loadChart.push([cpu.load ?? null], Date.parse(snapshot.ts));
        tempChart.push([cpu.tempPackage ?? null], Date.parse(snapshot.ts));

        mFreq.set(cpu.freqMhz, (v) => num(v, 0), 'MHz');
        mMin.set(cpu.freqMinMhz, (v) => num(v, 0), 'MHz');
        mMax.set(cpu.freqMaxMhz, (v) => num(v, 0), 'MHz');
        mEffective.set(cpu.freqEffectiveMhz, (v) => num(v, 0), 'MHz');
        mMultiplier.set(cpu.multiplier, (v) => num(v, 1), 'x');
        mBus.set(cpu.busClockMhz, (v) => num(v, 0), 'MHz');
        mPower.set(cpu.powerPackage, (v) => num(v, 1), 'W');
        mVoltage.set(cpu.voltage, (v) => num(v, 3), 'V');
        mCores.setText(`${cpu.physicalCores ?? '—'} 核 / ${cpu.logicalCores ?? '—'} 线程`);
        mProcess.setText(`${num(cpu.processCount, 0)} / ${num(cpu.threadCount, 0)}`);
        mTemp.set(cpu.tempPackage, (v) => num(v, 1), '°C');
        mTempMax.set(cpu.tempMax, (v) => num(v, 1), '°C');
        applyTemp(mTemp.el, cpu.tempPackage);
        applyTemp(mTempMax.el, cpu.tempMax);
        setText(modelValue, cpu.model || snapshot.system?.cpuModel || 'N/A');
      }

      return { update, destroy() { ring.destroy(); loadChart.destroy(); tempChart.destroy(); } };
    }
  };

  function rangeChips(onChange) {
    const ranges = [['5m', '5 分钟'], ['15m', '15 分钟'], ['1h', '1 小时']];
    const root = h('div', { class: 'range-chips' });
    const buttons = ranges.map(([value, label], index) => {
      const button = h('button', { type: 'button', class: `chip${index === 0 ? ' active' : ''}`, 'data-range': value }, label);
      button.addEventListener('click', () => {
        buttons.forEach((item) => item.classList.toggle('active', item === button));
        onChange(value);
      });
      root.append(button);
      return button;
    });
    return root;
  }

  const gpuView = {
    meta: { title: 'GPU', eyebrow: 'GRAPHICS', subtitle: '每块显卡的负载、温度、显存与频率' },
    mount(root) {
      const grid = h('div', { class: 'grid' });
      root.append(grid);

      let gpus = [];
      let selected = savedGpu();
      let range = '5m';
      let lastSignature = '';

      const hero = card({ title: '显卡负载', icon: 'monitor', sub: '当前所选显卡的占用与温度', className: 'span-5 hero-card gpu-hero-card' });
      const heroInner = h('div');
      const ringCanvas = h('canvas');
      const ringLoad = h('span', { class: 'metric-number' }, 'N/A');
      const ringTemp = h('div', { class: 'ring-temp' }, '温度 N/A');
      const ringWrap = h('div', { class: 'ring-wrap' }, ringCanvas,
        h('div', { class: 'ring-center' },
          h('div', { class: 'ring-value' }, ringLoad, h('span', { class: 'ring-unit' }, '%')),
          h('div', { class: 'ring-label' }, 'GPU 占用'), ringTemp));
      const ring = new RingGauge(ringCanvas);

      const mClock = metric({ label: '核心频率', big: true });
      const mPower = metric({ label: '整卡功耗', big: true });
      const mFan = metric({ label: '风扇转速', big: true });
      const memProgress = progress();
      const memLine = h('div', { class: 'progress-row' }, h('span', {}, '显存'), h('span', {}, 'N/A'));
      heroInner.append(
        h('div', { class: 'hero-split cpu-hero' }, ringWrap,
          h('div', { class: 'cpu-quick' }, mClock.root, mPower.root, mFan.root)),
        h('div', { class: 'progress-space', style: { marginTop: '14px' } }, memProgress.root),
        memLine);
      const heroEmpty = empty('未检测到 GPU', '核显或驱动未暴露传感器时会显示此状态', 'monitor');
      heroEmpty.hidden = true;
      hero.body.append(heroInner, heroEmpty);
      grid.append(hero.root);

      const listCard = card({ title: '显卡列表', icon: 'activity', sub: '点击切换要查看的显卡', className: 'span-7 gpu-list-card' });
      const list = h('div', { class: 'gpu-list' });
      const listEmpty = empty('没有可切换的显卡', '只会显示被识别到的显卡', 'monitor');
      listEmpty.hidden = true;
      listCard.body.append(list, listEmpty);
      grid.append(listCard.root);

      const loadCard = card({ title: '负载历史', icon: 'activity', sub: '最近 5 分钟', className: 'span-6' });
      const loadCanvas = h('canvas');
      const loadChart = new LineChart(loadCanvas, {
        series: [{ name: 'GPU 负载', color: '#f5a623' }],
        capacity: RANGE_SECONDS[range],
        format: (v) => pct(v), axisFormat: (v) => `${num(v, 0)}%`,
        min: 0, max: 100, baselineZero: true
      });
      loadCard.body.append(h('div', { class: 'chart-box' }, loadCanvas));
      grid.append(loadCard.root);

      const tempCard = card({ title: '温度历史', icon: 'temp', sub: '最近 5 分钟', className: 'span-6' });
      const tempCanvas = h('canvas');
      const tempChart = new LineChart(tempCanvas, {
        series: [{ name: 'GPU 温度', color: '#ffb020' }],
        capacity: RANGE_SECONDS[range],
        format: (v) => temp(v), axisFormat: (v) => `${num(v, 0)}°`, baselineZero: false
      });
      tempCard.body.append(h('div', { class: 'chart-box' }, tempCanvas));
      grid.append(tempCard.root);

      const rangeBar = rangeChips((value) => {
        range = value;
        loadChart.setCapacity(RANGE_SECONDS[value]);
        tempChart.setCapacity(RANGE_SECONDS[value]);
        loadCard.setSub(`最近 ${value === '5m' ? '5 分钟' : value === '15m' ? '15 分钟' : '1 小时'}`);
        tempCard.setSub(`最近 ${value === '5m' ? '5 分钟' : value === '15m' ? '15 分钟' : '1 小时'}`);
        reloadHistory();
      });
      loadCard.head.append(h('div', { class: 'card-actions' }, rangeBar));

      const detailCard = card({ title: '显卡详情', icon: 'monitor', sub: '型号、显存与传感器读数', className: 'span-12' });
      const modelLine = h('div', { class: 'info-cell', style: { marginBottom: '10px' } },
        h('div', { class: 'info-label' }, 'GPU 型号'),
        h('div', { class: 'info-value wrap' }, 'N/A'));
      const modelValue = modelLine.querySelector('.info-value');
      const mLoad = metric({ label: '当前负载', big: true });
      const mTemp = metric({ label: 'GPU 温度', big: true });
      const mMemPct = metric({ label: '显存占用', big: true });
      const mFreq = metric({ label: '核心频率', big: true });
      const mVramUsed = metric({ label: '显存已用' });
      const mVramTotal = metric({ label: '显存总量' });
      const mPowerDetail = metric({ label: '整卡功耗' });
      const mFanDetail = metric({ label: '风扇转速' });
      const mVendor = metric({ label: '厂商' });
      detailCard.body.append(modelLine,
        h('div', { class: 'metrics-grid highlight-grid' }, mLoad.root, mTemp.root, mMemPct.root, mFreq.root),
        h('div', { class: 'metrics-grid detail-grid' },
          mVramUsed.root, mVramTotal.root, mPowerDetail.root, mFanDetail.root, mVendor.root));
      grid.append(detailCard.root);

      function resolveIndex() {
        const index = gpus.findIndex((gpu) => gpu.name === selected);
        return index >= 0 ? index : 0;
      }

      function memoryPercent(gpu) {
        if (!gpu || !isNumber(gpu.memUsedBytes) || !isNumber(gpu.memTotalBytes) || gpu.memTotalBytes <= 0) return null;
        return (Number(gpu.memUsedBytes) / Number(gpu.memTotalBytes)) * 100;
      }

      function reloadHistory() {
        if (!gpus.length) {
          loadChart.setSeries([[]]);
          tempChart.setSeries([[]]);
          return;
        }
        const index = resolveIndex();
        loadChart.setSeries([makeHistory(`gpu.${index}.load`, range)]);
        tempChart.setSeries([makeHistory(`gpu.${index}.temp`, range)]);
      }

      function buildRow() {
        const name = h('div', { class: 'row-title' }, 'N/A');
        const sub = h('div', { class: 'row-sub' }, '');
        const load = h('span', { class: 'gpu-row-load' }, '—');
        const tempNode = h('span', { class: 'gpu-row-temp' }, '—');
        const fill = h('div', { class: 'gpu-row-fill' });
        const row = h('button', { type: 'button', class: 'row gpu-row' },
          h('div', { class: 'row-main' }, name, sub),
          h('div', { class: 'row-side' }, load, tempNode),
          h('div', { class: 'gpu-row-bar' }, fill));
        row._refs = { name, sub, load, tempNode, fill };
        row._name = '';
        row.addEventListener('click', () => {
          if (!row._name || row._name === selected) return;
          selected = row._name;
          saveGpu(selected);
          syncRows();
          applyGpu();
          reloadHistory();
        });
        return row;
      }

      function syncRows() {
        const nodes = reconcile(list, gpus.map((gpu, index) => gpu.name || `gpu-${index}`), buildRow);
        gpus.forEach((gpu, index) => {
          const row = nodes[index];
          if (!row) return;
          row._name = gpu.name || '';
          setText(row._refs.name, gpu.name || `GPU ${index + 1}`);
          const vram = isNumber(gpu.memTotalBytes) ? bytes(gpu.memTotalBytes) : '显存 N/A';
          setText(row._refs.sub, [gpu.vendor, vram].filter(Boolean).join(' · '));
          setText(row._refs.load, isNumber(gpu.load) ? pct(gpu.load, 0) : '—');
          setText(row._refs.tempNode, isNumber(gpu.temp) ? temp(gpu.temp) : '温度 N/A');
          applyTemp(row._refs.tempNode, gpu.temp);
          row._refs.fill.style.transform = `scaleX(${clamp(Number(gpu.load) || 0, 0, 100) / 100})`;
          const active = gpu.name === selected;
          row.classList.toggle('active', active);
          row.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
      }

      function applyGpu() {
        const gpu = gpus[resolveIndex()] || null;
        heroInner.hidden = !gpu;
        heroEmpty.hidden = Boolean(gpu);
        list.hidden = !gpu;
        listEmpty.hidden = Boolean(gpu);
        if (!gpu) {
          ring.set(0, 0);
          return;
        }

        const load = isNumber(gpu.load) ? Number(gpu.load) : null;
        const tempValue = isNumber(gpu.temp) ? Number(gpu.temp) : null;
        animateNumber(ringLoad, load ?? NaN, (v) => num(v, 0));
        if (load === null) setText(ringLoad, 'N/A');
        setText(ringTemp, `温度 ${temp(tempValue)}`);
        applyTemp(ringTemp, tempValue);
        ring.set(load ?? 0, tempValue ?? 0, tempColor(tempValue));

        mClock.set(gpu.clockMhz, (v) => num(v, 0), 'MHz');
        mPower.set(gpu.powerW, (v) => num(v, 1), 'W');
        mFan.set(gpu.fanRpm, (v) => num(v, 0), 'RPM');

        const memPct = memoryPercent(gpu);
        memProgress.set(memPct ?? 0);
        setText(memLine.lastChild, memPct === null
          ? `${bytes(gpu.memUsedBytes)} / ${bytes(gpu.memTotalBytes)}`
          : `${bytes(gpu.memUsedBytes)} / ${bytes(gpu.memTotalBytes)}（${pct(memPct, 0)}）`);

        setText(modelValue, gpu.name || 'N/A');
        mLoad.set(gpu.load, (v) => num(v, 0), '%');
        mTemp.set(gpu.temp, (v) => num(v, 1), '°C');
        applyTemp(mTemp.el, gpu.temp);
        mMemPct.setText(memPct === null ? 'N/A' : pct(memPct, 0));
        mFreq.set(gpu.clockMhz, (v) => num(v, 0), 'MHz');
        mVramUsed.setText(bytes(gpu.memUsedBytes));
        mVramTotal.setText(bytes(gpu.memTotalBytes));
        mPowerDetail.set(gpu.powerW, (v) => num(v, 1), 'W');
        mFanDetail.setText(rpm(gpu.fanRpm));
        mVendor.setText(gpu.vendor || 'N/A');
      }

      function update(snapshot) {
        const next = snapshot.gpus || [];
        const signature = next.map((gpu) => gpu.name).join('|');
        const changed = signature !== lastSignature;
        lastSignature = signature;
        gpus = next;

        if (gpus.length && !gpus.some((gpu) => gpu.name === selected)) {
          selected = gpus[0].name || '';
          saveGpu(selected);
        }

        syncRows();
        applyGpu();

        if (!gpus.length) {
          loadChart.setSeries([[]]);
          tempChart.setSeries([[]]);
          return;
        }

        if (changed) reloadHistory();

        const gpu = gpus[resolveIndex()];
        const timestamp = Date.parse(snapshot.ts);
        if (gpu && Number.isFinite(timestamp)) {
          loadChart.push([gpu.load ?? null], timestamp);
          tempChart.push([gpu.temp ?? null], timestamp);
        }
      }

      return { update, destroy() { ring.destroy(); loadChart.destroy(); tempChart.destroy(); } };
    }
  };

  const memoryView = {
    meta: { title: '内存', eyebrow: 'MEMORY', subtitle: '物理内存、提交内存与页面文件' },
    mount(root) {
      const grid = h('div', { class: 'grid' });
      root.append(grid);
      const hero = card({ title: '内存占用', icon: 'memory', sub: '物理内存实时使用率', className: 'span-5 hero-card' });
      const ringCanvas = h('canvas');
      const ringLoad = h('span', { class: 'metric-number' }, 'N/A');
      const ringDetail = h('div', { class: 'ring-temp' }, 'N/A');
      const ringWrap = h('div', { class: 'ring-wrap' }, ringCanvas,
        h('div', { class: 'ring-center' },
          h('div', { class: 'ring-value' }, ringLoad, h('span', { class: 'ring-unit' }, '%')),
          h('div', { class: 'ring-label' }, '已用内存'), ringDetail));
      const ring = new RingGauge(ringCanvas);
      hero.body.append(ringWrap);
      grid.append(hero.root);

      const statsCard = card({ title: '容量详情', icon: 'memory', sub: '容量、频率与插槽', className: 'span-7' });
      const mTotal = metric({ label: '总容量' });
      const mUsed = metric({ label: '已用' });
      const mFree = metric({ label: '可用' });
      const mSpeed = metric({ label: '内存频率' });
      const mSlots = metric({ label: '已用插槽' });
      const mType = metric({ label: '内存类型' });
      const commitProgress = progress();
      const commitLine = h('div', { class: 'progress-row' });
      const mCommit = metric({ label: '提交内存' });
      const mPage = metric({ label: '页面文件使用' });
      statsCard.body.append(h('div', { class: 'metrics-grid' },
        mTotal.root, mUsed.root, mFree.root, mSpeed.root, mSlots.root, mType.root),
        h('div', { class: 'progress-space' }, commitProgress.root), commitLine,
        h('div', { class: 'mini-metrics', style: { marginTop: '12px' } }, mCommit.root, mPage.root));
      grid.append(statsCard.root);

      const chartCard = card({ title: '内存占用历史', icon: 'activity', sub: '最近 5 分钟', className: 'span-12' });
      const canvas = h('canvas');
      const chart = new LineChart(canvas, {
        series: [{ name: '内存占用', color: '#ff8a3d' }], capacity: 300,
        format: (v) => pct(v), axisFormat: (v) => `${num(v, 0)}%`, min: 0, max: 100, baselineZero: true
      });
      chart.setSeries([makeHistory('mem.percent', '5m')]);
      chartCard.body.append(h('div', { class: 'chart-box tall' }, canvas));
      const range = rangeChips((value) => {
        chart.setCapacity(RANGE_SECONDS[value]);
        chart.setSeries([makeHistory('mem.percent', value)]);
        chartCard.setSub(`最近 ${value === '5m' ? '5 分钟' : value === '15m' ? '15 分钟' : '1 小时'}`);
      });
      chartCard.head.append(h('div', { class: 'card-actions' }, range));
      grid.append(chartCard.root);

      function update(snapshot) {
        const memory = snapshot.memory || {};
        const load = isNumber(memory.load) ? Number(memory.load) : null;
        animateNumber(ringLoad, load ?? NaN, (v) => num(v, 0));
        if (load === null) setText(ringLoad, 'N/A');
        setText(ringDetail, `${bytes(memory.usedBytes)} / ${bytes(memory.totalBytes)}`);
        ring.set(load ?? 0, 0, '#ff8a3d');

        mTotal.set(memory.totalBytes, (v) => bytes(v));
        mUsed.set(memory.usedBytes, (v) => bytes(v));
        mFree.set(memory.freeBytes, (v) => bytes(v));
        mSpeed.set(memory.speedMhz, (v) => num(v, 0), 'MHz');
        mSlots.setText(`${memory.slotsUsed ?? '—'} / ${memory.slotCount ?? '—'} 槽`);
        mType.setText(memory.moduleType || 'N/A');
        const commitPct = isNumber(memory.commitTotalBytes) && isNumber(memory.commitLimitBytes)
          ? (memory.commitTotalBytes / memory.commitLimitBytes) * 100 : 0;
        commitProgress.set(commitPct);
        commitLine.replaceChildren(h('span', {}, '提交内存'),
          h('span', {}, `${bytes(memory.commitTotalBytes)} / ${bytes(memory.commitLimitBytes)}`));
        mCommit.set(memory.commitTotalBytes, (v) => bytes(v));
        mPage.set(memory.pageFileUsedBytes, (v) => bytes(v));
        chart.push([memory.load ?? null], Date.parse(snapshot.ts));
      }

      return { update, destroy() { ring.destroy(); chart.destroy(); } };
    }
  };

  const storageView = {
    meta: { title: '存储', eyebrow: 'STORAGE', subtitle: '磁盘温度、健康度、容量与实时吞吐' },
    mount(root) {
      const grid = h('div', { class: 'grid' });
      root.append(grid);
      const summary = card({ title: '容量总览', icon: 'harddrive', sub: '所有固定磁盘', className: 'span-12' });
      const mTotal = metric({ label: '总容量' });
      const mUsed = metric({ label: '已使用' });
      const mFree = metric({ label: '剩余' });
      const mCount = metric({ label: '磁盘数量' });
      const summaryProgress = progress();
      const progressLine = h('div', { class: 'progress-row' });
      summary.body.append(h('div', { class: 'metrics-grid' }, mTotal.root, mUsed.root, mFree.root, mCount.root),
        h('div', { class: 'progress-space' }, summaryProgress.root), progressLine);
      grid.append(summary.root);

      const diskArea = h('div', { class: 'span-12' });
      const diskGrid = h('div', { class: 'grid' });
      const emptyNode = empty('没有读到磁盘信息', '请确认服务以管理员权限运行；机械硬盘的 SMART 温度需要 PawnIO 或厂商驱动支持。', 'harddrive');
      emptyNode.hidden = true;
      diskArea.append(diskGrid, emptyNode);
      grid.append(diskArea);

      const chartCard = card({ title: '磁盘总吞吐', icon: 'activity', sub: '所有磁盘读写速率之和 · 最近 5 分钟', className: 'span-12' });
      const canvas = h('canvas');
      const chart = new LineChart(canvas, {
        series: [{ name: '读取', color: '#f5a623' }, { name: '写入', color: '#ff2a6d' }],
        capacity: 300, format: (v) => rate(v), axisFormat: bytesShort, baselineZero: true
      });
      chart.setSeries([makeHistory('disk.read', '5m'), makeHistory('disk.write', '5m')]);
      chartCard.body.append(h('div', { class: 'legend' },
        h('span', { class: 'legend-item' }, h('span', { class: 'legend-dot', style: { background: '#f5a623', color: '#f5a623' } }), '读取'),
        h('span', { class: 'legend-item' }, h('span', { class: 'legend-dot', style: { background: '#ff2a6d', color: '#ff2a6d' } }), '写入')),
        h('div', { class: 'chart-box' }, canvas));
      const range = rangeChips((value) => {
        chart.setCapacity(RANGE_SECONDS[value]);
        chart.setSeries([makeHistory('disk.read', value), makeHistory('disk.write', value)]);
      });
      chartCard.head.append(h('div', { class: 'card-actions' }, range));
      grid.append(chartCard.root);

      function createDiskCard() {
        const c = card({ title: '存储设备', icon: 'harddrive', sub: 'S.M.A.R.T. · 容量 · 吞吐', className: 'disk-card span-6' });
        const name = h('div', { class: 'disk-name' }, 'N/A');
        const sub = h('div', { class: 'disk-sub' }, '');
        const media = h('span', { class: 'badge' }, '磁盘');
        const health = h('span', { class: 'badge' }, '健康 N/A');
        const tempNode = h('div', { class: 'disk-stat-value' }, 'N/A');
        const read = h('div', { class: 'disk-stat-value' }, 'N/A');
        const write = h('div', { class: 'disk-stat-value' }, 'N/A');
        const healthValue = h('div', { class: 'disk-stat-value' }, 'N/A');
        const space = progress();
        const lineLeft = h('span', {}, 'N/A');
        const lineRight = h('span', {}, 'N/A');
        c.body.append(h('div', { class: 'disk-head' },
          h('div', { style: { minWidth: '0' } }, name, sub),
          h('div', { class: 'disk-badges' }, media, health)),
          h('div', { class: 'disk-stats' },
            h('div', { class: 'disk-stat' }, h('div', { class: 'disk-stat-label' }, '温度'), tempNode),
            h('div', { class: 'disk-stat' }, h('div', { class: 'disk-stat-label' }, '健康'), healthValue),
            h('div', { class: 'disk-stat' }, h('div', { class: 'disk-stat-label' }, '读取'), read),
            h('div', { class: 'disk-stat' }, h('div', { class: 'disk-stat-label' }, '写入'), write)),
          space.root,
          h('div', { class: 'progress-row', style: { marginTop: '7px' } }, lineLeft, lineRight));
        c.root._refs = { name, sub, media, health, tempNode, read, write, healthValue, space, lineLeft, lineRight };
        return c.root;
      }

      function update(snapshot) {
        const disks = snapshot.disks || [];
        const total = disks.reduce((sum, d) => sum + (Number(d.totalBytes) || 0), 0);
        const free = disks.reduce((sum, d) => sum + (Number(d.freeBytes) || 0), 0);
        const used = Math.max(0, total - free);
        mTotal.set(total || null, (v) => bytes(v));
        mUsed.set(used || null, (v) => bytes(v));
        mFree.set(free || null, (v) => bytes(v));
        mCount.setText(`${disks.length} 块`);
        summaryProgress.set(total > 0 ? (used / total) * 100 : 0);
        progressLine.replaceChildren(h('span', {}, `已用 ${bytes(used)}`),
          h('span', {}, total > 0 ? pct((used / total) * 100) : ''));
        emptyNode.hidden = disks.length > 0;
        diskGrid.hidden = disks.length === 0;
        if (disks.length) {
          const nodes = reconcile(diskGrid, disks.map((d) => d.id), createDiskCard);
          disks.forEach((disk, index) => {
            const refs = nodes[index]?._refs;
            if (!refs) return;
            setText(refs.name, disk.model || disk.name);
            setText(refs.sub, `${(disk.driveLetters || []).join(' · ')} · ${disk.name}`);
            setText(refs.media, disk.mediaType || '磁盘');
            setText(refs.tempNode, temp(disk.temperature));
            applyTemp(refs.tempNode, disk.temperature);
            const hp = disk.healthPercent;
            const kind = isNumber(hp) ? (hp >= 80 ? 'good' : hp >= 50 ? 'warn' : 'bad') : 'info';
            setText(refs.health, isNumber(hp) ? `健康 ${num(hp, 0)}%` : (disk.healthStatus || '健康 N/A'));
            refs.health.className = `badge ${kind}`;
            setText(refs.healthValue, isNumber(hp) ? pct(hp) : (disk.healthStatus || 'N/A'));
            setText(refs.read, rate(disk.readBytesPerSec));
            setText(refs.write, rate(disk.writeBytesPerSec));
            const p = total > 0 ? ((total - free) / total) * 100 : 0;
            refs.space.set(p);
            setText(refs.lineLeft, `${bytes(used)} / ${bytes(total)}`);
            setText(refs.lineRight, `剩余 ${bytes(free)}`);
          });
        }
        const read = disks.reduce((sum, d) => sum + (Number(d.readBytesPerSec) || 0), 0);
        const write = disks.reduce((sum, d) => sum + (Number(d.writeBytesPerSec) || 0), 0);
        chart.push([disks.length ? read : null, disks.length ? write : null], Date.parse(snapshot.ts));
      }

      return { update, destroy() { chart.destroy(); } };
    }
  };

  const networkView = {
    meta: { title: '网络', eyebrow: 'NETWORK', subtitle: '实时上下行、累计流量、网卡与公网 IPv6' },
    mount(root) {
      const grid = h('div', { class: 'grid' });
      root.append(grid);
      const down = rateCard('下载', 'arrowDown', '#ff8a3d', 'span-6 hero-card');
      const up = rateCard('上传', 'arrowUp', '#ff2a6d', 'span-6 hero-card');
      grid.append(down.card.root, up.card.root);

      const chartCard = card({ title: '吞吐历史', icon: 'activity', sub: '最近 5 分钟', className: 'span-12' });
      const canvas = h('canvas');
      const chart = new LineChart(canvas, {
        series: [{ name: '下载', color: '#ff8a3d' }, { name: '上传', color: '#ff2a6d' }],
        capacity: 300, format: (v) => rate(v), axisFormat: bytesShort, baselineZero: true
      });
      chart.setSeries([makeHistory('net.down', '5m'), makeHistory('net.up', '5m')]);
      chartCard.body.append(h('div', { class: 'legend' },
        h('span', { class: 'legend-item' }, h('span', { class: 'legend-dot', style: { background: '#ff8a3d', color: '#ff8a3d' } }), '下载'),
        h('span', { class: 'legend-item' }, h('span', { class: 'legend-dot', style: { background: '#ff2a6d', color: '#ff2a6d' } }), '上传')),
        h('div', { class: 'chart-box tall' }, canvas));
      const range = rangeChips((value) => {
        chart.setCapacity(RANGE_SECONDS[value]);
        chart.setSeries([makeHistory('net.down', value), makeHistory('net.up', value)]);
      });
      chartCard.head.append(h('div', { class: 'card-actions' }, range));
      grid.append(chartCard.root);

      const adapterCard = card({ title: '网卡与地址', icon: 'network', sub: '本机活动网卡', className: 'span-8' });
      const adapterList = h('div', { class: 'adapter-list' });
      adapterCard.body.append(adapterList);
      grid.append(adapterCard.root);

      const ipCard = card({ title: '公网 IPv6', icon: 'wifi', sub: '来自本机全局单播地址', className: 'span-4' });
      const ipv6Primary = h('div', { class: 'info-value wrap', style: { marginTop: '4px' } }, 'N/A');
      const ipv6List = h('div', { class: 'code', style: { marginTop: '12px' } }, 'N/A');
      const ipv6Meta = h('div', { class: 'progress-row', style: { marginTop: '10px' } });
      ipCard.body.append(ipv6Primary, ipv6List, ipv6Meta);
      grid.append(ipCard.root);

      function rateCard(title, icon, color, className) {
        const c = card({ title, icon, sub: '实时速率', className });
        const value = metric({ label: title, big: true });
        const total = h('div', { class: 'progress-row', style: { marginTop: '12px' } });
        const canvas = h('canvas');
        const spark = new Sparkline(canvas, color);
        c.body.append(value.root, h('div', { class: 'chart-box small', style: { height: '94px', marginTop: '10px' } }, canvas), total);
        return { card: c, value, total, spark };
      }

      function createAdapterRow() {
        const title = h('div', { class: 'adapter-name' }, 'N/A');
        const sub = h('div', { class: 'adapter-sub' }, '');
        const ips = h('div', { class: 'adapter-ips' });
        const side = h('div', { class: 'adapter-side' }, '');
        const row = h('div', { class: 'adapter' }, h('div', { style: { minWidth: '0' } }, title, sub), ips, side);
        row._refs = { title, sub, ips, side };
        return row;
      }

      function update(snapshot) {
        const network = snapshot.network || {};
        down.value.set(network.downloadBytesPerSec, (v) => bytes(v), '/s');
        up.value.set(network.uploadBytesPerSec, (v) => bytes(v), '/s');
        down.total.replaceChildren(h('span', {}, `累计 ${bytes(network.totalDownloadedBytes)}`), h('span', {}, '自开机'));
        up.total.replaceChildren(h('span', {}, `累计 ${bytes(network.totalUploadedBytes)}`), h('span', {}, '自开机'));
        const t = Date.parse(snapshot.ts);
        down.spark.push({ t, v: network.downloadBytesPerSec });
        up.spark.push({ t, v: network.uploadBytesPerSec });
        chart.push([network.downloadBytesPerSec ?? null, network.uploadBytesPerSec ?? null], t);
        const adapters = network.adapters || [];
        const nodes = reconcile(adapterList, adapters.map((a) => a.name), createAdapterRow);
        adapters.forEach((adapter, index) => {
          const refs = nodes[index]?._refs;
          if (!refs) return;
          setText(refs.title, adapter.name);
          setText(refs.sub, `${adapter.description} · ${adapter.mac || ''}`);
          refs.ips.replaceChildren(...(adapter.ipv4 || []).map((ip) => h('span', { class: 'ip' }, ip)),
            ...(adapter.ipv6 || []).map((ip) => h('span', { class: 'ip v6' }, ip)));
          setText(refs.side, `${adapter.status} · ${num(adapter.speedBps / 1e6, 0)} Mbps`);
        });
        const addresses = network.ipv6Addresses || [];
        setText(ipv6Primary, network.publicIpv6 || 'N/A');
        ipv6List.textContent = addresses.length ? addresses.join('\n') : '未获取到全局 IPv6 地址';
        ipv6Meta.replaceChildren(h('span', {}, '地址数量'), h('span', {}, `${addresses.length} 个`));
      }

      return { update, destroy() { down.spark.destroy(); up.spark.destroy(); chart.destroy(); } };
    }
  };

  const fansView = {
    meta: { title: '风扇', eyebrow: 'THERMALS', subtitle: '风扇转速、PWM 占空比与主板环境温度' },
    mount(root) {
      const grid = h('div', { class: 'grid' });
      root.append(grid);
      const fanArea = h('div', { class: 'span-12' });
      const fanGrid = h('div', { class: 'fan-grid' });
      const fanEmpty = empty('没有读到风扇转速',
        '已按 LHM Fan → WMI Win32_Fan → ACPI 热区逐层尝试。笔记本风扇通常走 EC，需要管理员权限、PawnIO 与厂商 EC 驱动。', 'fan');
      fanEmpty.hidden = true;
      fanArea.append(fanGrid, fanEmpty);
      grid.append(fanArea);

      const chainCard = card({ title: '风扇读取链', icon: 'fan', sub: 'LHM → WMI → ACPI，逐层降级', className: 'span-12' });
      const chainList = h('div', { class: 'list' });
      function chainRow(label, hint) {
        const value = h('span', {}, 'N/A');
        const stateBadge = h('span', { class: 'badge' }, '—');
        const row = h('div', { class: 'row' },
          h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, label), h('div', { class: 'row-sub' }, hint)),
          h('div', { class: 'row-side' }, value, stateBadge));
        return { row, value, state: stateBadge };
      }
      const chainLhm = chainRow('1 · LibreHardwareMonitor Fan', '管理员 + PawnIO，EC/SuperIO 机型更完整');
      const chainWmi = chainRow('2 · WMI Win32_Fan', '部分机型只返回 DesiredSpeed，0 表示不可用');
      const chainAcpi = chainRow('3 · ACPI 热区', 'MSAcpi_ThermalZoneTemperature，仅温度兜底');
      chainList.append(chainLhm.row, chainWmi.row, chainAcpi.row);
      chainCard.body.append(chainList);
      grid.append(chainCard.root);

      const chartCard = card({ title: '最高转速历史', icon: 'fan', sub: '所有风扇中的最高 RPM · 最近 5 分钟', className: 'span-12' });
      const canvas = h('canvas');
      const chart = new LineChart(canvas, {
        series: [{ name: '最高 RPM', color: '#ff8a3d' }], capacity: 300,
        format: (v) => rpm(v), axisFormat: (v) => num(v, 0), baselineZero: true
      });
      chart.setSeries([makeHistory('fan.max', '5m')]);
      chartCard.body.append(h('div', { class: 'chart-box' }, canvas));
      const range = rangeChips((value) => {
        chart.setCapacity(RANGE_SECONDS[value]);
        chart.setSeries([makeHistory('fan.max', value)]);
      });
      chartCard.head.append(h('div', { class: 'card-actions' }, range));
      grid.append(chartCard.root);

      const envCard = card({ title: '环境温度', icon: 'temp', sub: '主板、芯片组、机箱与 ACPI 热区', className: 'span-12' });
      const mBoard = metric({ label: '主板温度' });
      const mChipset = metric({ label: '芯片组' });
      const mCase = metric({ label: '机箱 / 环境' });
      const mVrm = metric({ label: '供电 VRM' });
      const extras = h('div', { class: 'chip-list', style: { marginTop: '14px' } });
      const zones = h('div', { class: 'chip-list', style: { marginTop: '10px' } });
      envCard.body.append(h('div', { class: 'metrics-grid' }, mBoard.root, mChipset.root, mCase.root, mVrm.root),
        extras, h('div', { class: 'row-sub', style: { marginTop: '14px' } }, 'ACPI 热区（温度兜底，不是核心温度）'), zones);
      grid.append(envCard.root);

      function createFanCard() {
        const name = h('div', { class: 'fan-name' }, '风扇');
        const source = h('span', { class: 'badge' }, 'LHM');
        const hardware = h('div', { class: 'fan-hw' }, '');
        const rpmText = h('div', { class: 'fan-rpm' }, 'N/A');
        const percentText = h('span', {}, '占空比 N/A');
        const percentBar = progress();
        const c = card({ title: '风扇', icon: 'fan', className: 'fan-slot' });
        c.body.append(h('div', { class: 'fan-head' }, name, source), hardware, rpmText,
          h('div', { class: 'fan-percent' }, percentText, h('span', {}, 'PWM')), percentBar.root);
        c.root._refs = { name, source, hardware, rpmText, percentText, percentBar };
        return c.root;
      }

      function createChip() {
        const text = h('span', {}, 'N/A');
        const node = h('span', { class: 'chip temp-chip' }, text);
        node._text = text;
        return node;
      }

      function update(snapshot) {
        const fans = snapshot.fans || [];
        fanEmpty.hidden = fans.length > 0;
        fanGrid.hidden = fans.length === 0;
        if (fans.length) {
          const nodes = reconcile(fanGrid, fans.map((f) => f.id), createFanCard);
          fans.forEach((fan, index) => {
            const refs = nodes[index]?._refs;
            if (!refs) return;
            const wmi = fan.source === 'wmi';
            setText(refs.name, fan.name);
            setText(refs.source, wmi ? 'WMI' : 'LHM');
            refs.source.className = `badge ${wmi ? 'warn' : 'good'}`;
            setText(refs.hardware, fan.hardware || '');
            setText(refs.rpmText, rpm(fan.rpm));
            setText(refs.percentText, isNumber(fan.percent) ? `占空比 ${pct(fan.percent, 0)}` : '占空比 N/A');
            refs.percentBar.set(isNumber(fan.percent) ? fan.percent : 0);
          });
        }
        const status = snapshot.status || {};
        const lhmCount = fans.filter((f) => f.source !== 'wmi').length;
        const wmiUsed = fans.filter((f) => f.source === 'wmi').length;
        const wmiCount = Math.max(wmiUsed, status.wmiFanCount || 0);
        const zoneItems = snapshot.env?.thermalZones || [];
        const zoneCount = Math.max(zoneItems.length, status.acpiThermalZoneCount || 0);
        function setChain(chain, count, ready, missing, kind) {
          setText(chain.value, count > 0 ? ready : missing);
          setText(chain.state, count > 0 ? '可用' : '不可用');
          chain.state.className = `badge ${count > 0 ? kind : 'bad'}`;
        }
        setChain(chainLhm, lhmCount, `${lhmCount} 个`, '未读到', 'good');
        setChain(chainWmi, wmiCount, wmiUsed ? `${wmiUsed} 个（当前使用）` : `${wmiCount} 个备用`, '0 个条目', 'info');
        setChain(chainAcpi, zoneCount, `${zoneCount} 个热区`, '0 个热区', 'info');

        const maxRpm = fans.reduce((max, f) => Math.max(max, Number(f.rpm) || 0), 0);
        chart.push([fans.length ? maxRpm : null], Date.parse(snapshot.ts));
        const env = snapshot.env || {};
        mBoard.set(env.boardTemp, (v) => num(v, 1), '°C');
        mChipset.set(env.chipsetTemp, (v) => num(v, 1), '°C');
        mCase.set(env.caseTemp, (v) => num(v, 1), '°C');
        mVrm.set(env.vrmTemp, (v) => num(v, 1), '°C');
        [mBoard, mChipset, mCase, mVrm].forEach((m, index) => {
          const values = [env.boardTemp, env.chipsetTemp, env.caseTemp, env.vrmTemp];
          applyTemp(m.el, values[index]);
        });
        const extrasItems = env.extras || [];
        if (!extrasItems.length) extras.replaceChildren(h('span', { class: 'faint', style: { fontSize: '11px' } }, '没有额外的温度传感器'));
        else {
          const chips = reconcile(extras, extrasItems.map((item) => item.name), createChip);
          extrasItems.forEach((item, index) => {
            const node = chips[index];
            if (!node) return;
            setText(node._text, `${item.name} ${temp(item.value)}`);
            applyTemp(node, item.value);
          });
        }
        if (!zoneItems.length) zones.replaceChildren(h('span', { class: 'faint', style: { fontSize: '11px' } }, '未读到 ACPI 热区温度'));
        else {
          const chips = reconcile(zones, zoneItems.map((item) => item.name), createChip);
          zoneItems.forEach((item, index) => {
            const node = chips[index];
            if (!node) return;
            setText(node._text, `${item.name} ${temp(item.value)}`);
            applyTemp(node, item.value);
          });
        }
      }

      return { update, destroy() { chart.destroy(); } };
    }
  };

  const settingsView = {
    meta: { title: '设置', eyebrow: 'SETTINGS', subtitle: '账号、连接状态与运行诊断' },
    mount(root) {
      const grid = h('div', { class: 'grid' });
      root.append(grid);

      const account = card({ title: '账号', icon: 'shield', sub: '静态预览会话', className: 'span-6' });
      account.body.append(h('div', { class: 'kv' },
        h('div', { class: 'kv-row' }, h('span', { class: 'kv-key' }, '用户名'), h('span', { class: 'kv-value' }, 'admin')),
        h('div', { class: 'kv-row' }, h('span', { class: 'kv-key' }, '令牌'), h('span', { class: 'kv-value' }, '静态预览无 JWT'))),
        h('div', { class: 'settings-actions' },
          h('button', { class: 'btn', type: 'button', onclick: showPreviewLogin }, '预览登录页')));
      grid.append(account.root);

      const pref = card({ title: '预览控制', icon: 'settings', sub: '仅影响这一个静态页面', className: 'span-6' });
      const missingToggle = h('input', { type: 'checkbox' });
      missingToggle.checked = state.missing;
      missingToggle.addEventListener('change', () => setSimulateMissing(missingToggle.checked));
      const motionToggle = h('input', { type: 'checkbox' });
      motionToggle.checked = reduceMotion;
      motionToggle.addEventListener('change', () => {
        reduceMotion = motionToggle.checked;
        document.documentElement.dataset.reduceMotion = reduceMotion ? '1' : '0';
      });
      pref.body.append(
        h('label', { class: 'toggle' }, missingToggle,
          h('span', { class: 'toggle-track' }, h('span', { class: 'toggle-thumb' })),
          h('span', { class: 'toggle-text' }, '模拟传感器缺失（温度/风扇/磁盘健康度显示 N/A）')),
        h('label', { class: 'toggle', style: { marginTop: '10px' } }, motionToggle,
          h('span', { class: 'toggle-track' }, h('span', { class: 'toggle-thumb' })),
          h('span', { class: 'toggle-text' }, '减少动效（关闭极光、数字滚动与液态滑动）')),
        h('div', { class: 'settings-actions' },
          h('button', {
            class: 'btn',
            type: 'button',
            onclick: () => {
              resetMockData();
              missingToggle.checked = false;
            }
          }, '重置 Mock 数据')));
      grid.append(pref.root);

      const diag = card({ title: '运行诊断', icon: 'activity', sub: 'Mock 数据中的服务端状态', className: 'span-6' });
      function kv(label) {
        const value = h('span', { class: 'kv-value' }, 'N/A');
        return { row: h('div', { class: 'kv-row' }, h('span', { class: 'kv-key' }, label), value), value };
      }
      const kAdmin = kv('管理员权限');
      const kPawn = kv('PawnIO');
      const kLhm = kv('LHM 会话');
      const kFanSource = kv('风扇数据源');
      const kWmi = kv('WMI Win32_Fan');
      const kAcpi = kv('ACPI 热区');
      const kSample = kv('采样耗时');
      const kMissing = kv('缺失传感器');
      diag.body.append(h('div', { class: 'kv' },
        kAdmin.row, kPawn.row, kLhm.row, kFanSource.row, kWmi.row, kAcpi.row, kSample.row, kMissing.row));
      grid.append(diag.root);

      const apiCard = card({ title: '接口', icon: 'server', sub: '生产版同源鉴权 API', className: 'span-6' });
      apiCard.body.append(h('div', { class: 'code' },
        'GET  /api/snapshot\nGET  /api/history?metric=cpu.load&range=1h\nPOST /api/login\nGET  /api/health\nWS   /ws'));
      grid.append(apiCard.root);

      const note = card({ title: '配置', icon: 'settings', sub: '预览页不会读写 config.json', className: 'span-12' });
      note.body.append(h('div', { class: 'alert info', style: { marginBottom: '0' } },
        '这是独立静态预览：所有数据都是本地 mock，登录页只是样式预览，不会发起请求，也不会读取 config.json。'));
      grid.append(note.root);

      function update(snapshot) {
        const status = snapshot.status || {};
        setText(kAdmin.value, status.admin ? '已启用' : '只读降级');
        kAdmin.value.style.color = status.admin ? 'var(--teal)' : 'var(--amber)';
        setText(kPawn.value, status.pawnIo ? '已安装' : '未检测到');
        kPawn.value.style.color = status.pawnIo ? 'var(--teal)' : 'var(--amber)';
        setText(kLhm.value, status.lhmAvailable ? '正常' : '未初始化');
        kLhm.value.style.color = status.lhmAvailable ? 'var(--teal)' : 'var(--red)';
        const source = status.fanSource || 'none';
        setText(kFanSource.value, source === 'lhm' ? 'LHM Fan' : source === 'wmi' ? 'WMI Win32_Fan' : '无（UI 占位）');
        kFanSource.value.style.color = source === 'lhm' ? 'var(--teal)' : source === 'wmi' ? 'var(--amber)' : 'var(--red)';
        setText(kWmi.value, `${status.wmiFanCount ?? 0} 个条目`);
        setText(kAcpi.value, `${status.acpiThermalZoneCount ?? 0} 个热区`);
        setText(kSample.value, `${status.samplingMs ?? 0} ms`);
        setText(kMissing.value, (status.sensorsMissing || []).length ? status.sensorsMissing.join('、') : '无');
      }

      return { update, destroy() { } };
    }
  };

  // ---------------------------------------------------------------- shell
  const views = {
    overview: overviewView,
    cpu: cpuView,
    gpu: gpuView,
    memory: memoryView,
    storage: storageView,
    network: networkView,
    fans: fansView,
    settings: settingsView
  };

  const els = {
    app: document.getElementById('app'),
    sidebar: document.getElementById('sidebar'),
    liquid: document.getElementById('liquid'),
    view: document.getElementById('view'),
    pageTitle: document.getElementById('page-title'),
    pageEyebrow: document.getElementById('page-eyebrow'),
    pageSubtitle: document.getElementById('page-subtitle'),
    hostName: document.getElementById('host-name'),
    hostUptime: document.getElementById('host-uptime'),
    livePill: document.getElementById('live-pill'),
    liveText: document.getElementById('live-text'),
    previewLogin: document.getElementById('preview-login'),
    previewLoginClose: document.getElementById('preview-login-close')
  };

  state = {
    snapshot: null,
    active: null,
    activeId: null,
    lastTick: Date.now(),
    missing: false
  };

  function currentViewId() {
    const match = location.hash.match(/^#\/([a-z]+)/i);
    return match && views[match[1]] ? match[1] : 'overview';
  }

  function updateLiquid() {
    const active = els.sidebar.querySelector('.nav-bubble.active');
    if (!active) return;
    els.liquid.style.width = `${active.offsetWidth}px`;
    els.liquid.style.height = `${active.offsetHeight}px`;
    els.liquid.style.transform = `translate3d(${active.offsetLeft}px, ${active.offsetTop}px, 0)`;
  }

  function updateHost() {
    const system = state.snapshot?.system;
    if (!system) return;
    setText(els.hostName, system.hostname);
    setText(els.hostUptime, `已运行 ${uptime(system.uptimeSeconds)}`);
  }

  function updatePill() {
    const age = Math.max(0, Math.floor((Date.now() - state.lastTick) / 1000));
    els.livePill.classList.remove('warn', 'bad');
    els.livePill.classList.add('ok');
    setText(els.liveText, `预览模式 · 更新于 ${age} 秒前`);
  }

  function applySnapshot(snapshot) {
    state.snapshot = snapshot;
    updateHost();
    if (state.active?.update) state.active.update(snapshot);
    updatePill();
  }

  function route() {
    const id = currentViewId();
    if (state.activeId === id && state.active) {
      updateLiquid();
      return;
    }
    state.active?.destroy?.();
    state.activeId = id;
    const view = views[id];
    setText(els.pageTitle, view.meta.title);
    setText(els.pageEyebrow, view.meta.eyebrow);
    setText(els.pageSubtitle, `${view.meta.subtitle} · MOCK 预览`);
    document.title = `${view.meta.title} · HP Server Monitor Preview`;
    for (const bubble of document.querySelectorAll('.nav-bubble')) {
      const active = bubble.dataset.view === id;
      bubble.classList.toggle('active', active);
      if (active) bubble.setAttribute('aria-current', 'page');
      else bubble.removeAttribute('aria-current');
    }
    els.view.replaceChildren();
    state.active = view.mount(els.view);
    if (state.snapshot) state.active.update(state.snapshot);
    updateLiquid();
    window.scrollTo(0, 0);
  }

  function tick() {
    state.lastTick = Date.now();
    applySnapshot(makeSnapshot());
  }

  function setSimulateMissing(enabled) {
    state.missing = enabled;
    simulateMissing = enabled;
    clearHistory();
    applySnapshot(makeSnapshot());
    toast(enabled ? '已开启模拟传感器缺失' : '已恢复完整 Mock 数据');
  }

  function resetMockData() {
    state.missing = false;
    simulateMissing = false;
    clearHistory();
    applySnapshot(makeSnapshot());
    toast('Mock 数据已重置');
  }

  function showPreviewLogin() {
    els.previewLogin.hidden = false;
  }

  function init() {
    document.documentElement.dataset.reduceMotion =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? '1' : '0';
    if (!location.hash) history.replaceState(null, '', '#/overview');
    state.snapshot = makeSnapshot();
    route();
    updateHost();
    updatePill();
    window.setInterval(tick, 1000);
    window.setInterval(updatePill, 1000);
    window.addEventListener('hashchange', route);
    window.addEventListener('resize', () => requestAnimationFrame(updateLiquid));
    window.addEventListener('orientationchange', () => requestAnimationFrame(updateLiquid));
    document.querySelectorAll('.nav-bubble').forEach((bubble) => {
      bubble.addEventListener('click', () => {
        const id = bubble.dataset.view;
        if (state.activeId === id) return;
        location.hash = `#/${id}`;
      });
    });
    els.previewLoginClose.addEventListener('click', () => { els.previewLogin.hidden = true; });
    document.getElementById('preview-login-form').addEventListener('submit', (event) => event.preventDefault());
    requestAnimationFrame(updateLiquid);
  }

  init();
})();
