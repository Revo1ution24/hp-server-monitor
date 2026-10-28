import * as fmt from './format.js';

const MONO = '"JetBrains Mono", "Cascadia Mono", Consolas, monospace';

function isFiniteNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function withAlpha(color, alpha) {
  if (typeof color !== 'string') return `rgba(245, 166, 35, ${alpha})`;
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  }
  return color;
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function reducedMotion() {
  return document.documentElement.dataset.reduceMotion === '1' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// 1 小时 3600 点，绘制时抽样到约 600 点，老机器上显著降低 Canvas 开销
function decimate(segment) {
  if (segment.length <= 700) return segment;
  const step = Math.ceil(segment.length / 700);
  const result = [];
  for (let i = 0; i < segment.length; i += step) result.push(segment[i]);
  if (result[result.length - 1] !== segment[segment.length - 1])
    result.push(segment[segment.length - 1]);
  return result;
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

export class LineChart {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.series = (options.series || [{ name: '数值', color: '#f5a623' }])
      .map((item) => ({ name: item.name || '', color: item.color || '#f5a623', points: [] }));
    this.format = options.format || ((value) => fmt.num(value, 1));
    this.axisFormat = options.axisFormat || this.format;
    this.capacity = options.capacity || 300;
    this.baselineZero = options.baselineZero !== false;
    this.fixedMin = isFiniteNumber(options.min) ? Number(options.min) : null;
    this.fixedMax = isFiniteNumber(options.max) ? Number(options.max) : null;
    this._raf = 0;
    this._hover = null;
    this._destroyed = false;

    this._onMove = (event) => {
      const rect = this.canvas.getBoundingClientRect();
      this._hover = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      this._schedule();
    };
    this._onLeave = () => {
      this._hover = null;
      this._schedule();
    };

    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerleave', this._onLeave);
    this._observer = new ResizeObserver(() => this._schedule());
    this._observer.observe(canvas.parentElement || canvas);
    this._schedule();
  }

  setSeries(arrays) {
    arrays.forEach((points, index) => {
      const target = this.series[index];
      if (!target) return;
      target.points = (points || [])
        .filter((point) => point && isFiniteNumber(point.t))
        .slice(-this.capacity);
    });
    this._schedule();
  }

  push(values, timestamp) {
    this.series.forEach((series, index) => {
      series.points.push({
        t: Number(timestamp),
        v: values[index] === undefined ? null : values[index]
      });
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

  clear() {
    this.series.forEach((series) => { series.points = []; });
    this._schedule();
  }

  _schedule() {
    if (this._destroyed || this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this._render();
    });
  }

  _render() {
    const prepared = prepareCanvas(this.canvas);
    if (!prepared) return;
    const { ctx, width, height } = prepared;

    const allPoints = this.series.flatMap((series) => series.points);
    const finitePoints = allPoints.filter((point) => isFiniteNumber(point.v));
    if (allPoints.length === 0 || finitePoints.length === 0) {
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

    let minT = Math.min(...allPoints.map((point) => point.t));
    let maxT = Math.max(...allPoints.map((point) => point.t));
    if (maxT - minT < 1000) {
      minT = maxT - 60_000;
    }

    let minV = Math.min(...finitePoints.map((point) => Number(point.v)));
    let maxV = Math.max(...finitePoints.map((point) => Number(point.v)));
    if (this.fixedMin !== null) minV = this.fixedMin;
    else if (this.baselineZero) minV = Math.min(0, minV);
    if (this.fixedMax !== null) maxV = this.fixedMax;
    if (maxV - minV < 0.0001) {
      maxV += 1;
      minV = this.baselineZero ? 0 : minV - 1;
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
    ctx.lineWidth = 1;
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
      ctx.fillText(fmt.clockSeconds(t), x, height - pad.b + 7);
    }

    for (const series of this.series) {
      const segments = [];
      let current = [];
      for (const point of series.points) {
        if (isFiniteNumber(point.v)) {
          current.push(point);
        } else if (current.length) {
          segments.push(current);
          current = [];
        }
      }
      if (current.length) segments.push(current);

      const renderSegments = segments.map(decimate);

      for (const segment of renderSegments) {
        if (segment.length < 2) continue;
        const gradient = ctx.createLinearGradient(0, pad.t, 0, height - pad.b);
        gradient.addColorStop(0, withAlpha(series.color, 0.22));
        gradient.addColorStop(1, withAlpha(series.color, 0));
        ctx.beginPath();
        ctx.moveTo(xOf(segment[0].t), yOf(segment[0].v));
        for (let i = 1; i < segment.length; i++)
          ctx.lineTo(xOf(segment[i].t), yOf(segment[i].v));
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
      for (const segment of renderSegments) {
        if (segment.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(xOf(segment[0].t), yOf(segment[0].v));
        for (let i = 1; i < segment.length; i++)
          ctx.lineTo(xOf(segment[i].t), yOf(segment[i].v));
        ctx.stroke();
      }
      ctx.restore();

      const last = [...series.points].reverse().find((point) => isFiniteNumber(point.v));
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
      this._drawHover(ctx, width, height, pad, xOf, yOf, minT, maxT);
    }
  }

  _drawHover(ctx, width, height, pad, xOf, yOf, minT, maxT) {
    const reference = this.series.find((series) => series.points.some((point) => isFiniteNumber(point.v)));
    if (!reference) return;

    let nearest = null;
    for (const point of reference.points) {
      if (!isFiniteNumber(point.v)) continue;
      const distance = Math.abs(xOf(point.t) - this._hover.x);
      if (!nearest || distance < nearest.distance) nearest = { point, distance };
    }
    if (!nearest) return;

    const t = nearest.point.t;
    const x = xOf(t);
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
        if (!isFiniteNumber(candidate.v)) continue;
        if (!point || Math.abs(candidate.t - t) < Math.abs(point.t - t)) point = candidate;
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

    const lines = [fmt.dateTime(t)];
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
    ctx.lineWidth = 1;
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
    this._destroyed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._observer.disconnect();
    this.canvas.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('pointerleave', this._onLeave);
  }
}

export class RingGauge {
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
    this.targetLoad = fmt.clamp(Number(load) || 0, 0, 100);
    this.targetTemp = fmt.clamp(Number(temp) || 0, 0, 100);
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
    const start = performance.now();
    const duration = 420;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
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
    const size = Math.min(width, height);
    const baseRadius = size / 2 - 26;
    const outerRadius = baseRadius + 13;

    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 240, 230, 0.07)';
    ctx.lineWidth = 10;
    ctx.stroke();

    const startAngle = -Math.PI / 2;
    if (this.load > 0.4) {
      const gradient = ctx.createLinearGradient(cx - baseRadius, cy - baseRadius, cx + baseRadius, cy + baseRadius);
      gradient.addColorStop(0, '#f5a623');
      gradient.addColorStop(1, '#ff2a6d');
      ctx.save();
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 12;
      ctx.shadowColor = 'rgba(245, 166, 35, 0.7)';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius, startAngle, startAngle + (Math.PI * 2 * this.load) / 100);
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
      ctx.arc(cx, cy, outerRadius, startAngle, startAngle + (Math.PI * 2 * this.temp) / 100);
      ctx.stroke();
      ctx.restore();
    }
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._observer.disconnect();
  }
}

export class Sparkline {
  constructor(canvas, { color = '#f5a623', capacity = 60 } = {}) {
    this.canvas = canvas;
    this.color = color;
    this.capacity = capacity;
    this.points = [];
    this._raf = 0;
    this._observer = new ResizeObserver(() => this._schedule());
    this._observer.observe(canvas.parentElement || canvas);
    this._schedule();
  }

  setData(points) {
    this.points = (points || []).filter((point) => point && isFiniteNumber(point.t)).slice(-this.capacity);
    this._schedule();
  }

  push(point) {
    if (!point || !isFiniteNumber(point.t)) return;
    this.points.push(point);
    if (this.points.length > this.capacity)
      this.points.splice(0, this.points.length - this.capacity);
    this._schedule();
  }

  _schedule() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this._render();
    });
  }

  _render() {
    const prepared = prepareCanvas(this.canvas);
    if (!prepared) return;
    const { ctx, width, height } = prepared;
    const values = this.points.filter((point) => isFiniteNumber(point.v));
    if (values.length < 2) return;

    const minV = Math.min(...values.map((point) => Number(point.v)));
    const maxV = Math.max(...values.map((point) => Number(point.v)));
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
      if (!isFiniteNumber(point.v)) {
        started = false;
        return;
      }
      if (!started) {
        ctx.moveTo(xOf(index), yOf(point.v));
        started = true;
      } else {
        ctx.lineTo(xOf(index), yOf(point.v));
      }
    });
    const last = this.points[this.points.length - 1];
    if (last && isFiniteNumber(last.v)) {
      ctx.lineTo(xOf(this.points.length - 1), height - pad);
      ctx.lineTo(xOf(0), height - pad);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    ctx.beginPath();
    started = false;
    this.points.forEach((point, index) => {
      if (!isFiniteNumber(point.v)) {
        started = false;
        return;
      }
      if (!started) {
        ctx.moveTo(xOf(index), yOf(point.v));
        started = true;
      } else {
        ctx.lineTo(xOf(index), yOf(point.v));
      }
    });
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._observer.disconnect();
  }
}
