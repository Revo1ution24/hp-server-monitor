import * as api from '../api.js';
import * as charts from '../charts.js';
import * as fmt from '../format.js';
import * as ui from '../ui.js';

const RANGE_POINTS = { '5m': 300, '15m': 900, '1h': 3600 };

export default {
  id: 'memory',
  title: '内存',
  eyebrow: 'MEMORY',
  subtitle: '物理内存、提交内存与页面文件',

  mount(root) {
    let destroyed = false;
    const grid = ui.h('div', { class: 'grid' });
    root.append(grid);

    const hero = ui.card({
      title: '内存占用',
      icon: 'memory',
      sub: '物理内存实时使用率',
      className: 'span-5 hero-card'
    });
    const ringCanvas = ui.h('canvas');
    const ringLoad = ui.h('span', { class: 'metric-number' }, 'N/A');
    const ringDetail = ui.h('div', { class: 'ring-temp' }, 'N/A');
    const ringWrap = ui.h('div', { class: 'ring-wrap' },
      ringCanvas,
      ui.h('div', { class: 'ring-center' },
        ui.h('div', { class: 'ring-value' }, ringLoad, ui.h('span', { class: 'ring-unit' }, '%')),
        ui.h('div', { class: 'ring-label' }, '已用内存'),
        ringDetail));
    const ring = new charts.RingGauge(ringCanvas);
    hero.body.append(ringWrap);
    grid.append(hero.root);

    const statsCard = ui.card({
      title: '容量详情',
      icon: 'memory',
      sub: '容量、频率与插槽',
      className: 'span-7'
    });
    const mTotal = ui.metric({ label: '总容量' });
    const mUsed = ui.metric({ label: '已用' });
    const mFree = ui.metric({ label: '可用' });
    const mSpeed = ui.metric({ label: '内存频率' });
    const mSlots = ui.metric({ label: '已用插槽' });
    const mType = ui.metric({ label: '内存类型' });

    const commitProgress = ui.progress();
    const commitLine = ui.h('div', { class: 'progress-row' }, ui.h('span', {}, '提交内存'), ui.h('span', {}, 'N/A'));
    const mCommit = ui.metric({ label: '提交内存' });
    const mPage = ui.metric({ label: '页面文件使用' });

    statsCard.body.append(
      ui.h('div', { class: 'metrics-grid' }, mTotal.root, mUsed.root, mFree.root, mSpeed.root, mSlots.root, mType.root),
      ui.h('div', { class: 'progress-space' }, commitProgress.root),
      commitLine,
      ui.h('div', { class: 'mini-metrics', style: { marginTop: '12px' } }, mCommit.root, mPage.root));
    grid.append(statsCard.root);

    const chartCard = ui.card({
      title: '内存占用历史',
      icon: 'activity',
      sub: '最近 5 分钟',
      className: 'span-12'
    });
    const canvas = ui.h('canvas');
    const chart = new charts.LineChart(canvas, {
      series: [{ name: '内存占用', color: '#ff8a3d' }],
      capacity: 300,
      format: (value) => fmt.pct(value),
      axisFormat: (value) => `${fmt.num(value, 0)}%`,
      baselineZero: true,
      min: 0,
      max: 100
    });
    chartCard.body.append(ui.h('div', { class: 'chart-box tall' }, canvas));
    const range = ui.rangeChips(async (value) => {
      chart.setCapacity(RANGE_POINTS[value]);
      chartCard.setSub(`最近 ${value === '5m' ? '5 分钟' : value === '15m' ? '15 分钟' : '1 小时'}`);
      try {
        const data = await api.history('mem.percent', value);
        if (!destroyed) chart.setSeries([data.points]);
      } catch { }
    }, '5m');
    chartCard.head.append(ui.h('div', { class: 'card-actions' }, range));
    grid.append(chartCard.root);

    api.history('mem.percent', '5m').then((data) => {
      if (!destroyed) chart.setSeries([data.points]);
    }).catch(() => { });

    function update(snapshot) {
      const memory = snapshot.memory || {};
      const load = fmt.isNumber(memory.load) ? Number(memory.load) : null;
      ui.animateNumber(ringLoad, load ?? NaN, (value) => fmt.num(value, 0));
      if (load === null) ui.setText(ringLoad, 'N/A');
      ui.setText(ringDetail, fmt.isNumber(memory.usedBytes) && fmt.isNumber(memory.totalBytes)
        ? `${fmt.bytes(memory.usedBytes)} / ${fmt.bytes(memory.totalBytes)}`
        : 'N/A');
      ring.set(load ?? 0, 0, '#ff8a3d');

      mTotal.set(memory.totalBytes, (value) => fmt.bytes(value));
      mUsed.set(memory.usedBytes, (value) => fmt.bytes(value));
      mFree.set(memory.freeBytes, (value) => fmt.bytes(value));
      mSpeed.set(memory.speedMhz, (value) => fmt.num(value, 0), 'MHz');
      mSlots.setText(fmt.isNumber(memory.slotsUsed)
        ? `${memory.slotsUsed}${fmt.isNumber(memory.slotCount) ? ` / ${memory.slotCount}` : ''} 槽`
        : 'N/A');
      mType.setText(memory.moduleType || 'N/A');

      const commitUsed = memory.commitTotalBytes;
      const commitLimit = memory.commitLimitBytes;
      const commitPercent = fmt.isNumber(commitUsed) && fmt.isNumber(commitLimit) && commitLimit > 0
        ? (commitUsed / commitLimit) * 100
        : 0;
      commitProgress.set(commitPercent);
      commitLine.firstChild.textContent = '提交内存';
      commitLine.lastChild.textContent = fmt.isNumber(commitUsed) && fmt.isNumber(commitLimit)
        ? `${fmt.bytes(commitUsed)} / ${fmt.bytes(commitLimit)}`
        : 'N/A';
      mCommit.set(commitUsed, (value) => fmt.bytes(value));
      mPage.set(memory.pageFileUsedBytes, (value) => fmt.bytes(value));

      const timestamp = Date.parse(snapshot.ts);
      if (Number.isFinite(timestamp))
        chart.push([memory.load ?? null], timestamp);
    }

    return {
      update,
      destroy() {
        destroyed = true;
        ring.destroy();
        chart.destroy();
      }
    };
  }
};
