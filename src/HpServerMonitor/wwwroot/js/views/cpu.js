import * as api from '../api.js';
import * as charts from '../charts.js';
import * as fmt from '../format.js';
import * as ui from '../ui.js';

const RANGE_POINTS = { '5m': 300, '15m': 900, '1h': 3600 };

export default {
  id: 'cpu',
  title: 'CPU',
  eyebrow: 'PROCESSOR',
  subtitle: '频率、温度、功耗与每个物理核心',

  mount(root) {
    let destroyed = false;
    const grid = ui.h('div', { class: 'grid' });
    root.append(grid);

    // 主环形
    const hero = ui.card({
      title: 'CPU 负载',
      icon: 'cpu',
      sub: '封装占用与温度',
      className: 'span-5 hero-card cpu-hero-card'
    });
    const ringCanvas = ui.h('canvas');
    const ringLoad = ui.h('span', { class: 'metric-number' }, 'N/A');
    const ringLabel = ui.h('div', { class: 'ring-label' }, 'CPU 占用');
    const ringTemp = ui.h('div', { class: 'ring-temp' }, '温度 N/A');
    const ringUtility = ui.h('div', {
      class: 'ring-utility',
      title: '时间口径：CPU 有多少时间在忙，封顶 100%'
    }, '时间占用 N/A');
    const ringWrap = ui.h('div', { class: 'ring-wrap' },
      ringCanvas,
      ui.h('div', { class: 'ring-center' },
        ui.h('div', { class: 'ring-value' }, ringLoad, ui.h('span', { class: 'ring-unit' }, '%')),
        ringLabel,
        ringTemp,
        ringUtility));
    const ring = new charts.RingGauge(ringCanvas);
    const tempChips = ui.h('div', { class: 'chip-list', style: { marginTop: '18px' } });
    hero.body.append(ringWrap, tempChips);
    grid.append(hero.root);

    // 核心负载
    const coreCard = ui.card({
      title: '核心负载',
      icon: 'activity',
      sub: '每个物理核心的实时占用（LHM 只提供物理核）',
      className: 'span-7 core-load-card'
    });
    const coreGrid = ui.h('div', { class: 'core-grid' });
    const coreEmpty = ui.empty('没有读到核心占用', '部分老 CPU 只暴露总占用率', 'cpu');
    coreEmpty.hidden = true;
    coreCard.body.append(coreGrid, coreEmpty);
    grid.append(coreCard.root);

    // 负载历史
    const loadCard = ui.card({
      title: '占用率历史',
      icon: 'activity',
      sub: '最近 5 分钟',
      className: 'span-6'
    });
    const loadCanvas = ui.h('canvas');
    const loadChart = new charts.LineChart(loadCanvas, {
      series: [
        { name: '有效占用', color: '#f5a623' },
        { name: '时间占用', color: '#00e0b8' }
      ],
      capacity: 300,
      format: (value) => fmt.pct(value),
      axisFormat: (value) => `${fmt.num(value, 0)}%`,
      baselineZero: true,
      min: 0
    });
    loadCard.body.append(
      ui.h('div', { class: 'legend' },
        ui.h('span', { class: 'legend-item' },
          ui.h('span', { class: 'legend-dot', style: { background: '#f5a623', color: '#f5a623' } }), '有效占用'),
        ui.h('span', { class: 'legend-item' },
          ui.h('span', { class: 'legend-dot', style: { background: '#00e0b8', color: '#00e0b8' } }), '时间占用')),
      ui.h('div', { class: 'chart-box' }, loadCanvas));
    const loadRange = ui.rangeChips(async (range) => {
      loadChart.setCapacity(RANGE_POINTS[range]);
      loadCard.setSub(`最近 ${range === '5m' ? '5 分钟' : range === '15m' ? '15 分钟' : '1 小时'}`);
      try {
        const [utility, load] = await Promise.all([
          api.history('cpu.utility', range),
          api.history('cpu.load', range)
        ]);
        if (!destroyed) loadChart.setSeries([utility.points, load.points]);
      } catch { }
    }, '5m');
    loadCard.head.querySelector('.card-actions')?.remove();
    loadCard.head.append(ui.h('div', { class: 'card-actions' }, loadRange));
    grid.append(loadCard.root);

    // 温度历史
    const tempCard = ui.card({
      title: '温度历史',
      icon: 'temp',
      sub: '最近 5 分钟',
      className: 'span-6'
    });
    const tempCanvas = ui.h('canvas');
    const tempChart = new charts.LineChart(tempCanvas, {
      series: [{ name: '封装温度', color: '#ffb020' }],
      capacity: 300,
      format: (value) => fmt.temp(value),
      axisFormat: (value) => `${fmt.num(value, 0)}°`,
      baselineZero: false
    });
    tempCard.body.append(ui.h('div', { class: 'chart-box' }, tempCanvas));
    const tempRange = ui.rangeChips(async (range) => {
      tempChart.setCapacity(RANGE_POINTS[range]);
      tempCard.setSub(`最近 ${range === '5m' ? '5 分钟' : range === '15m' ? '15 分钟' : '1 小时'}`);
      try {
        const data = await api.history('cpu.temp', range);
        if (!destroyed) tempChart.setSeries([data.points]);
      } catch { }
    }, '5m');
    tempCard.head.append(ui.h('div', { class: 'card-actions' }, tempRange));
    grid.append(tempCard.root);

    // 详细指标
    const infoCard = ui.card({
      title: '处理器详情',
      icon: 'cpu',
      sub: '频率、功耗、电压与核心规模',
      className: 'span-12'
    });
    const modelLine = ui.h('div', { class: 'info-cell', style: { marginBottom: '10px' } },
      ui.h('div', { class: 'info-label' }, 'CPU 型号'),
      ui.h('div', { class: 'info-value wrap' }, 'N/A'));
    const modelValue = modelLine.querySelector('.info-value');

    const mFreq = ui.metric({ label: '当前频率', big: true });
    const mMin = ui.metric({ label: '最低频率（本次运行）' });
    const mMax = ui.metric({ label: '最高频率（本次运行）' });
    const mEffective = ui.metric({ label: '有效频率' });
    const mMultiplier = ui.metric({ label: '倍频（估算）' });
    const mBus = ui.metric({ label: '总线频率' });
    const mPower = ui.metric({ label: '封装功耗', big: true });
    const mVoltage = ui.metric({ label: '核心电压', big: true });
    const mCores = ui.metric({ label: '核心 / 线程' });
    const mProcess = ui.metric({ label: '进程 / 线程总数' });
    const mTemp = ui.metric({ label: '封装温度', big: true });
    const mTempMax = ui.metric({ label: '最高核心温度' });

    infoCard.body.append(
      modelLine,
      ui.h('div', { class: 'metrics-grid highlight-grid' },
        mFreq.root, mPower.root, mVoltage.root, mTemp.root),
      ui.h('div', { class: 'metrics-grid detail-grid' },
        mMin.root, mMax.root, mEffective.root, mMultiplier.root,
        mBus.root, mCores.root, mProcess.root, mTempMax.root));
    grid.append(infoCard.root);

    Promise.all([
      api.history('cpu.utility', '5m'),
      api.history('cpu.load', '5m'),
      api.history('cpu.temp', '5m')
    ]).then(([utility, load, temp]) => {
      if (destroyed) return;
      loadChart.setSeries([utility.points, load.points]);
      tempChart.setSeries([temp.points]);
    }).catch(() => { });

    function buildCoreTile() {
      const label = ui.h('span', { class: 'core-index' }, 'C0');
      const value = ui.h('span', { class: 'core-percent' }, '—');
      const fill = ui.h('div', { class: 'core-tile-fill' });
      const node = ui.h('div', { class: 'core-tile' },
        fill,
        ui.h('div', { class: 'core-tile-content' }, label, value));
      node._label = label;
      node._value = value;
      node._fill = fill;
      return node;
    }

    function buildTempChip() {
      const value = ui.h('span', {}, 'C0 N/A');
      const node = ui.h('span', { class: 'chip temp-chip' }, value);
      node._value = value;
      return node;
    }

    function update(snapshot) {
      const cpu = snapshot.cpu || {};
      const load = fmt.isNumber(cpu.load) ? Number(cpu.load) : null;
      const utility = fmt.isNumber(cpu.loadUtility) ? Number(cpu.loadUtility) : null;
      const ringValue = utility ?? load;
      const temp = fmt.isNumber(cpu.tempPackage) ? Number(cpu.tempPackage) : null;

      ui.animateNumber(ringLoad, ringValue ?? NaN, (value) => fmt.num(value, 0));
      if (ringValue === null) ui.setText(ringLoad, 'N/A');
      ui.setText(ringLabel, utility === null ? 'CPU 占用' : 'CPU 有效占用');
      ui.setText(ringTemp, `温度 ${fmt.temp(temp)}`);
      ui.applyTemp(ringTemp, temp);
      ui.setText(ringUtility, utility === null
        ? '有效占用不可用'
        : `时间占用 ${fmt.pct(load ?? NaN, 0)}`);
      ring.set(ringValue ?? 0, temp ?? 0, ui.tempColor(temp));

      const coreLoads = cpu.coreLoads || [];
      coreEmpty.hidden = coreLoads.length > 0;
      coreGrid.hidden = coreLoads.length === 0;
      const coreNodes = ui.reconcile(coreGrid, coreLoads.map((core) => String(core.index)), buildCoreTile);
      coreLoads.forEach((core, index) => {
        const node = coreNodes[index];
        if (!node) return;
        ui.setText(node._label, `C${core.index}`);
        ui.setText(node._value, fmt.isNumber(core.value) ? fmt.pct(core.value, 0) : '—');
        const ratio = fmt.clamp(Number(core.value) || 0, 0, 100) / 100;
        node._fill.style.transform = `scaleX(${ratio})`;
        node.style.setProperty('--load', String(ratio));
      });

      const temps = cpu.tempCores || [];
      const tempNodes = ui.reconcile(tempChips, temps.map((core) => String(core.index)), buildTempChip);
      temps.forEach((core, index) => {
        const node = tempNodes[index];
        if (!node) return;
        ui.setText(node._value, `C${core.index} ${fmt.temp(core.value)}`);
        ui.applyTemp(node, core.value);
      });

      const timestamp = Date.parse(snapshot.ts);
      if (Number.isFinite(timestamp)) {
        loadChart.push([cpu.loadUtility ?? null, cpu.load ?? null], timestamp);
        tempChart.push([cpu.tempPackage ?? null], timestamp);
      }

      mFreq.set(cpu.freqMhz, (value) => fmt.num(value, 0), 'MHz');
      mMin.set(cpu.freqMinMhz, (value) => fmt.num(value, 0), 'MHz');
      mMax.set(cpu.freqMaxMhz, (value) => fmt.num(value, 0), 'MHz');
      mEffective.set(cpu.freqEffectiveMhz, (value) => fmt.num(value, 0), 'MHz');
      mMultiplier.set(cpu.multiplier, (value) => fmt.num(value, 1), 'x');
      mBus.set(cpu.busClockMhz, (value) => fmt.num(value, 0), 'MHz');
      mPower.set(cpu.powerPackage, (value) => fmt.num(value, 1), 'W');
      mVoltage.set(cpu.voltage, (value) => fmt.num(value, 3), 'V');
      mCores.setText(fmt.isNumber(cpu.physicalCores)
        ? `${cpu.physicalCores} 核 / ${cpu.logicalCores ?? '—'} 线程`
        : (fmt.isNumber(cpu.logicalCores) ? `${cpu.logicalCores} 线程` : 'N/A'));
      mProcess.setText(fmt.isNumber(cpu.processCount)
        ? `${fmt.num(cpu.processCount, 0)} / ${fmt.num(cpu.threadCount, 0)}`
        : 'N/A');
      mTemp.set(cpu.tempPackage, (value) => fmt.num(value, 1), '°C');
      mTempMax.set(cpu.tempMax, (value) => fmt.num(value, 1), '°C');
      ui.applyTemp(mTemp.el, cpu.tempPackage);
      ui.applyTemp(mTempMax.el, cpu.tempMax);
      ui.setText(modelValue, cpu.model || snapshot.system?.cpuModel || 'N/A');
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
