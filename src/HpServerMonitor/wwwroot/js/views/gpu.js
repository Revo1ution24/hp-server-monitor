import * as api from '../api.js';
import * as charts from '../charts.js';
import * as fmt from '../format.js';
import * as ui from '../ui.js';

const RANGE_POINTS = { '5m': 300, '15m': 900, '1h': 3600 };
const STORAGE_KEY = 'hpmon.gpu';

function savedName() {
  try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
}

function persistName(name) {
  try { localStorage.setItem(STORAGE_KEY, name); } catch { }
}

function rangeLabel(range) {
  return `最近 ${range === '5m' ? '5 分钟' : range === '15m' ? '15 分钟' : '1 小时'}`;
}

export default {
  id: 'gpu',
  title: 'GPU',
  eyebrow: 'GRAPHICS',
  subtitle: '每块显卡的负载、温度、显存与频率',

  mount(root) {
    let destroyed = false;
    let gpus = [];
    let selected = savedName();
    let range = '5m';
    let lastSignature = '';

    const grid = ui.h('div', { class: 'grid' });
    root.append(grid);

    // ---------- 主环形 ----------
    const hero = ui.card({
      title: '显卡负载',
      icon: 'monitor',
      sub: '当前所选显卡的占用与温度',
      className: 'span-5 hero-card gpu-hero-card'
    });
    const heroInner = ui.h('div');
    const ringCanvas = ui.h('canvas');
    const ringLoad = ui.h('span', { class: 'metric-number' }, 'N/A');
    const ringTemp = ui.h('div', { class: 'ring-temp' }, '温度 N/A');
    const ringWrap = ui.h('div', { class: 'ring-wrap' },
      ringCanvas,
      ui.h('div', { class: 'ring-center' },
        ui.h('div', { class: 'ring-value' }, ringLoad, ui.h('span', { class: 'ring-unit' }, '%')),
        ui.h('div', { class: 'ring-label' }, 'GPU 占用'),
        ringTemp));
    const ring = new charts.RingGauge(ringCanvas);

    const mClock = ui.metric({ label: '核心频率', big: true });
    const mPower = ui.metric({ label: '整卡功耗', big: true });
    const mFan = ui.metric({ label: '风扇转速', big: true });
    const memProgress = ui.progress();
    const memLine = ui.h('div', { class: 'progress-row' }, ui.h('span', {}, '显存'), ui.h('span', {}, 'N/A'));

    heroInner.append(
      ui.h('div', { class: 'hero-split cpu-hero' },
        ringWrap,
        ui.h('div', { class: 'cpu-quick' }, mClock.root, mPower.root, mFan.root)),
      ui.h('div', { class: 'progress-space', style: { marginTop: '14px' } }, memProgress.root),
      memLine);

    const heroEmpty = ui.empty('未检测到 GPU', '核显或驱动未暴露传感器时会显示此状态', 'monitor');
    heroEmpty.hidden = true;
    hero.body.append(heroInner, heroEmpty);
    grid.append(hero.root);

    // ---------- 显卡列表（选择器） ----------
    const listCard = ui.card({
      title: '显卡列表',
      icon: 'activity',
      sub: '点击切换要查看的显卡',
      className: 'span-7 gpu-list-card'
    });
    const list = ui.h('div', { class: 'gpu-list' });
    const listEmpty = ui.empty('没有可切换的显卡', '只会显示被 LibreHardwareMonitor 识别的显卡', 'monitor');
    listEmpty.hidden = true;
    listCard.body.append(list, listEmpty);
    grid.append(listCard.root);

    // ---------- 历史曲线 ----------
    const loadCard = ui.card({ title: '负载历史', icon: 'activity', sub: rangeLabel(range), className: 'span-6' });
    const loadCanvas = ui.h('canvas');
    const loadChart = new charts.LineChart(loadCanvas, {
      series: [{ name: 'GPU 负载', color: '#f5a623' }],
      capacity: RANGE_POINTS[range],
      format: (value) => fmt.pct(value),
      axisFormat: (value) => `${fmt.num(value, 0)}%`,
      min: 0,
      max: 100,
      baselineZero: true
    });
    loadCard.body.append(ui.h('div', { class: 'chart-box' }, loadCanvas));
    const rangeChips = ui.rangeChips((value) => {
      range = value;
      loadChart.setCapacity(RANGE_POINTS[value]);
      tempChart.setCapacity(RANGE_POINTS[value]);
      loadCard.setSub(rangeLabel(range));
      tempCard.setSub(rangeLabel(range));
      reloadHistory();
    }, '5m');
    loadCard.head.append(ui.h('div', { class: 'card-actions' }, rangeChips));
    grid.append(loadCard.root);

    const tempCard = ui.card({ title: '温度历史', icon: 'temp', sub: rangeLabel(range), className: 'span-6' });
    const tempCanvas = ui.h('canvas');
    const tempChart = new charts.LineChart(tempCanvas, {
      series: [{ name: 'GPU 温度', color: '#ffb020' }],
      capacity: RANGE_POINTS[range],
      format: (value) => fmt.temp(value),
      axisFormat: (value) => `${fmt.num(value, 0)}°`,
      baselineZero: false
    });
    tempCard.body.append(ui.h('div', { class: 'chart-box' }, tempCanvas));
    grid.append(tempCard.root);

    // ---------- 详情 ----------
    const detailCard = ui.card({
      title: '显卡详情',
      icon: 'monitor',
      sub: '型号、显存与传感器读数',
      className: 'span-12'
    });
    const modelLine = ui.h('div', { class: 'info-cell', style: { marginBottom: '10px' } },
      ui.h('div', { class: 'info-label' }, 'GPU 型号'),
      ui.h('div', { class: 'info-value wrap' }, 'N/A'));
    const modelValue = modelLine.querySelector('.info-value');

    const mLoad = ui.metric({ label: '当前负载', big: true });
    const mTemp = ui.metric({ label: 'GPU 温度', big: true });
    const mMemPct = ui.metric({ label: '显存占用', big: true });
    const mFreq = ui.metric({ label: '核心频率', big: true });

    const mVramUsed = ui.metric({ label: '显存已用' });
    const mVramTotal = ui.metric({ label: '显存总量' });
    const mPowerDetail = ui.metric({ label: '整卡功耗' });
    const mFanDetail = ui.metric({ label: '风扇转速' });
    const mVendor = ui.metric({ label: '厂商' });

    detailCard.body.append(
      modelLine,
      ui.h('div', { class: 'metrics-grid highlight-grid' }, mLoad.root, mTemp.root, mMemPct.root, mFreq.root),
      ui.h('div', { class: 'metrics-grid detail-grid' },
        mVramUsed.root, mVramTotal.root, mPowerDetail.root, mFanDetail.root, mVendor.root));
    grid.append(detailCard.root);

    // ---------- 选择逻辑 ----------
    function resolveIndex() {
      const index = gpus.findIndex((gpu) => gpu.name === selected);
      return index >= 0 ? index : 0;
    }

    function memoryPercent(gpu) {
      if (!gpu || !fmt.isNumber(gpu.memUsedBytes) || !fmt.isNumber(gpu.memTotalBytes) || gpu.memTotalBytes <= 0)
        return null;
      return (Number(gpu.memUsedBytes) / Number(gpu.memTotalBytes)) * 100;
    }

    async function reloadHistory() {
      if (!gpus.length) {
        loadChart.clear();
        tempChart.clear();
        return;
      }
      const index = resolveIndex();
      try {
        const [load, temp] = await Promise.all([
          api.history(`gpu.${index}.load`, range),
          api.history(`gpu.${index}.temp`, range)
        ]);
        if (destroyed) return;
        loadChart.setSeries([load.points]);
        tempChart.setSeries([temp.points]);
      } catch {
        if (!destroyed) {
          loadChart.setSeries([[]]);
          tempChart.setSeries([[]]);
        }
      }
    }

    function buildRow() {
      const name = ui.h('div', { class: 'row-title' }, 'N/A');
      const sub = ui.h('div', { class: 'row-sub' }, '');
      const load = ui.h('span', { class: 'gpu-row-load' }, '—');
      const temp = ui.h('span', { class: 'gpu-row-temp' }, '—');
      const fill = ui.h('div', { class: 'gpu-row-fill' });
      const bar = ui.h('div', { class: 'gpu-row-bar' }, fill);
      const row = ui.h('button', { type: 'button', class: 'row gpu-row' },
        ui.h('div', { class: 'row-main' }, name, sub),
        ui.h('div', { class: 'row-side' }, load, temp),
        bar);
      row._refs = { name, sub, load, temp, fill };
      row._name = '';
      row.addEventListener('click', () => {
        if (!row._name || row._name === selected) return;
        selected = row._name;
        persistName(selected);
        syncRows();
        applyGpu();
        loadChart.clear();
        tempChart.clear();
        reloadHistory();
      });
      return row;
    }

    function syncRows() {
      const nodes = ui.reconcile(list, gpus.map((gpu, index) => gpu.name || `gpu-${index}`), buildRow);
      gpus.forEach((gpu, index) => {
        const row = nodes[index];
        if (!row) return;
        row._name = gpu.name || '';
        ui.setText(row._refs.name, gpu.name || `GPU ${index + 1}`);
        const vram = fmt.isNumber(gpu.memTotalBytes) ? fmt.bytes(gpu.memTotalBytes) : '显存 N/A';
        ui.setText(row._refs.sub, [gpu.vendor, vram].filter(Boolean).join(' · '));
        ui.setText(row._refs.load, fmt.isNumber(gpu.load) ? fmt.pct(gpu.load, 0) : '—');
        ui.setText(row._refs.temp, fmt.isNumber(gpu.temp) ? fmt.temp(gpu.temp) : '温度 N/A');
        ui.applyTemp(row._refs.temp, gpu.temp);
        row._refs.fill.style.transform = `scaleX(${fmt.clamp(Number(gpu.load) || 0, 0, 100) / 100})`;
        const active = gpu.name === selected;
        row.classList.toggle('active', active);
        row.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }

    // 把当前选中显卡的实时值写入各卡片
    function applyGpu() {
      const gpu = gpus[resolveIndex()] || null;
      const hasGpu = Boolean(gpu);
      heroInner.hidden = !hasGpu;
      heroEmpty.hidden = hasGpu;
      list.hidden = !hasGpu;
      listEmpty.hidden = hasGpu;

      if (!gpu) {
        ring.set(0, 0);
        return;
      }

      const load = fmt.isNumber(gpu.load) ? Number(gpu.load) : null;
      const temp = fmt.isNumber(gpu.temp) ? Number(gpu.temp) : null;
      ui.animateNumber(ringLoad, load ?? NaN, (value) => fmt.num(value, 0));
      if (load === null) ui.setText(ringLoad, 'N/A');
      ui.setText(ringTemp, `温度 ${fmt.temp(temp)}`);
      ui.applyTemp(ringTemp, temp);
      ring.set(load ?? 0, temp ?? 0, ui.tempColor(temp));

      mClock.set(gpu.clockMhz, (value) => fmt.num(value, 0), 'MHz');
      mPower.set(gpu.powerW, (value) => fmt.num(value, 1), 'W');
      mFan.set(gpu.fanRpm, (value) => fmt.num(value, 0), 'RPM');

      const memPct = memoryPercent(gpu);
      memProgress.set(memPct ?? 0);
      ui.setText(memLine.lastChild, memPct === null
        ? `${fmt.bytes(gpu.memUsedBytes)} / ${fmt.bytes(gpu.memTotalBytes)}`
        : `${fmt.bytes(gpu.memUsedBytes)} / ${fmt.bytes(gpu.memTotalBytes)}（${fmt.pct(memPct, 0)}）`);

      ui.setText(modelValue, gpu.name || 'N/A');
      mLoad.set(gpu.load, (value) => fmt.num(value, 0), '%');
      mTemp.set(gpu.temp, (value) => fmt.num(value, 1), '°C');
      ui.applyTemp(mTemp.el, gpu.temp);
      mMemPct.setText(memPct === null ? 'N/A' : fmt.pct(memPct, 0));
      mFreq.set(gpu.clockMhz, (value) => fmt.num(value, 0), 'MHz');
      mVramUsed.setText(fmt.bytes(gpu.memUsedBytes));
      mVramTotal.setText(fmt.bytes(gpu.memTotalBytes));
      mPowerDetail.set(gpu.powerW, (value) => fmt.num(value, 1), 'W');
      mFanDetail.setText(fmt.rpm(gpu.fanRpm));
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
        persistName(selected);
      }

      syncRows();
      applyGpu();

      if (!gpus.length) {
        loadChart.clear();
        tempChart.clear();
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

    return {
      update,
      destroy() {
        destroyed = true;
        ring.destroy();
        loadChart.destroy();
        tempChart.destroy();
      }
    };
  }
};
