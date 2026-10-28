import * as api from '../api.js';
import * as charts from '../charts.js';
import * as fmt from '../format.js';
import * as ui from '../ui.js';

const RANGE_POINTS = { '5m': 300, '15m': 900, '1h': 3600 };

function healthBadge(disk) {
  if (fmt.isNumber(disk.healthPercent)) {
    const value = Number(disk.healthPercent);
    const kind = value >= 80 ? 'good' : value >= 50 ? 'warn' : 'bad';
    return { text: `健康 ${fmt.num(value, 0)}%`, kind };
  }
  if (disk.healthStatus) {
    const raw = String(disk.healthStatus);
    const kind = /ok|healthy/i.test(raw) ? 'good' : /warn/i.test(raw) ? 'warn' : 'bad';
    return { text: raw, kind };
  }
  return { text: '健康 N/A', kind: '' };
}

export default {
  id: 'storage',
  title: '存储',
  eyebrow: 'STORAGE',
  subtitle: '磁盘温度、健康度、容量与实时吞吐',

  mount(root) {
    let destroyed = false;
    const grid = ui.h('div', { class: 'grid' });
    root.append(grid);

    const summary = ui.card({
      title: '容量总览',
      icon: 'harddrive',
      sub: '所有固定磁盘',
      className: 'span-12'
    });
    const mTotal = ui.metric({ label: '总容量' });
    const mUsed = ui.metric({ label: '已使用' });
    const mFree = ui.metric({ label: '剩余' });
    const mCount = ui.metric({ label: '磁盘数量' });
    const progress = ui.progress();
    const progressLine = ui.h('div', { class: 'progress-row' },
      ui.h('span', {}, 'N/A'), ui.h('span', {}, 'N/A'));
    summary.body.append(
      ui.h('div', { class: 'metrics-grid' }, mTotal.root, mUsed.root, mFree.root, mCount.root),
      ui.h('div', { class: 'progress-space' }, progress.root),
      progressLine);
    grid.append(summary.root);

    const diskArea = ui.h('div', { class: 'span-12' });
    const diskGrid = ui.h('div', { class: 'grid', style: { gap: '16px' } });
    const empty = ui.empty(
      '没有读到磁盘信息',
      '请确认服务以管理员权限运行；机械硬盘的 SMART 温度需要 PawnIO 或厂商驱动支持。',
      'harddrive');
    empty.hidden = true;
    diskArea.append(diskGrid, empty);
    grid.append(diskArea);

    const chartCard = ui.card({
      title: '磁盘总吞吐',
      icon: 'activity',
      sub: '所有磁盘读写速率之和 · 最近 5 分钟',
      className: 'span-12'
    });
    const canvas = ui.h('canvas');
    const chart = new charts.LineChart(canvas, {
      series: [
        { name: '读取', color: '#f5a623' },
        { name: '写入', color: '#ff2a6d' }
      ],
      capacity: 300,
      format: (value) => fmt.rate(value),
      axisFormat: fmt.bytesShort,
      baselineZero: true
    });
    chartCard.body.append(
      ui.h('div', { class: 'legend' },
        ui.h('span', { class: 'legend-item' }, ui.h('span', { class: 'legend-dot', style: { background: '#f5a623', color: '#f5a623' } }), '读取'),
        ui.h('span', { class: 'legend-item' }, ui.h('span', { class: 'legend-dot', style: { background: '#ff2a6d', color: '#ff2a6d' } }), '写入')),
      ui.h('div', { class: 'chart-box' }, canvas));
    const range = ui.rangeChips(async (value) => {
      chart.setCapacity(RANGE_POINTS[value]);
      try {
        const [read, write] = await Promise.all([
          api.history('disk.read', value),
          api.history('disk.write', value)
        ]);
        if (!destroyed) chart.setSeries([read.points, write.points]);
      } catch { }
    }, '5m');
    chartCard.head.append(ui.h('div', { class: 'card-actions' }, range));
    grid.append(chartCard.root);

    Promise.all([
      api.history('disk.read', '5m'),
      api.history('disk.write', '5m')
    ]).then(([read, write]) => {
      if (!destroyed) chart.setSeries([read.points, write.points]);
    }).catch(() => { });

    function createDiskCard() {
      const card = ui.card({
        title: '存储设备',
        icon: 'harddrive',
        sub: 'S.M.A.R.T. · 容量 · 吞吐',
        className: 'disk-card span-6'
      });

      const name = ui.h('div', { class: 'disk-name' }, 'N/A');
      const sub = ui.h('div', { class: 'disk-sub' }, '');
      const media = ui.h('span', { class: 'badge' }, '—');
      const health = ui.h('span', { class: 'badge' }, '健康 N/A');
      const temp = ui.h('div', { class: 'disk-stat-value' }, 'N/A');
      const read = ui.h('div', { class: 'disk-stat-value' }, 'N/A');
      const write = ui.h('div', { class: 'disk-stat-value' }, 'N/A');
      const healthValue = ui.h('div', { class: 'disk-stat-value' }, 'N/A');
      const space = ui.progress();
      const lineLeft = ui.h('span', {}, 'N/A');
      const lineRight = ui.h('span', {}, 'N/A');

      card.body.append(
        ui.h('div', { class: 'disk-head' },
          ui.h('div', { style: { minWidth: '0' } }, name, sub),
          ui.h('div', { class: 'disk-badges' }, media, health)),
        ui.h('div', { class: 'disk-stats' },
          ui.h('div', { class: 'disk-stat' }, ui.h('div', { class: 'disk-stat-label' }, '温度'), temp),
          ui.h('div', { class: 'disk-stat' }, ui.h('div', { class: 'disk-stat-label' }, '健康'), healthValue),
          ui.h('div', { class: 'disk-stat' }, ui.h('div', { class: 'disk-stat-label' }, '读取'), read),
          ui.h('div', { class: 'disk-stat' }, ui.h('div', { class: 'disk-stat-label' }, '写入'), write)),
        space.root,
        ui.h('div', { class: 'progress-row', style: { marginTop: '7px' } }, lineLeft, lineRight));

      card.root._refs = { name, sub, media, health, temp, healthValue, read, write, space, lineLeft, lineRight };
      return card.root;
    }

    function updateDisk(rootNode, disk) {
      const refs = rootNode._refs;
      if (!refs) return;
      const letters = (disk.driveLetters || []).join(' · ');
      ui.setText(refs.name, disk.model || disk.name || '磁盘');
      ui.setText(refs.sub, [letters, disk.name !== disk.model ? disk.name : ''].filter(Boolean).join(' · ') || '物理磁盘');
      ui.setText(refs.media, disk.mediaType || '磁盘');
      ui.setText(refs.temp, fmt.temp(disk.temperature));
      ui.applyTemp(refs.temp, disk.temperature);

      const health = healthBadge(disk);
      ui.setText(refs.health, health.text);
      refs.health.className = `badge ${health.kind}`.trim();
      ui.setText(refs.healthValue, fmt.isNumber(disk.healthPercent) ? fmt.pct(disk.healthPercent) : (disk.healthStatus || 'N/A'));

      ui.setText(refs.read, fmt.rate(disk.readBytesPerSec));
      ui.setText(refs.write, fmt.rate(disk.writeBytesPerSec));

      const total = Number(disk.totalBytes) || 0;
      const free = Number(disk.freeBytes) || 0;
      const used = Math.max(0, total - free);
      refs.space.set(total > 0 ? (used / total) * 100 : 0);
      ui.setText(refs.lineLeft, total > 0 ? `${fmt.bytes(used)} / ${fmt.bytes(total)}` : '容量 N/A');
      ui.setText(refs.lineRight, total > 0 ? `剩余 ${fmt.bytes(free)}` : '');
    }

    function update(snapshot) {
      const disks = [...(snapshot.disks || [])].sort((a, b) =>
        String(a.driveLetters?.[0] || a.name || '').localeCompare(String(b.driveLetters?.[0] || b.name || '')));

      const total = disks.reduce((sum, disk) => sum + (Number(disk.totalBytes) || 0), 0);
      const free = disks.reduce((sum, disk) => sum + (Number(disk.freeBytes) || 0), 0);
      const used = Math.max(0, total - free);

      mTotal.set(total || null, (value) => fmt.bytes(value));
      mUsed.set(used || null, (value) => fmt.bytes(value));
      mFree.set(free || null, (value) => fmt.bytes(value));
      mCount.setText(disks.length ? `${disks.length} 块` : 'N/A');
      progress.set(total > 0 ? (used / total) * 100 : 0);
      ui.setText(progressLine.firstChild, total > 0 ? `已用 ${fmt.bytes(used)}` : '已用 N/A');
      ui.setText(progressLine.lastChild, total > 0 ? fmt.pct((used / total) * 100) : '');

      empty.hidden = disks.length > 0;
      diskGrid.hidden = disks.length === 0;
      if (disks.length > 0) {
        const nodes = ui.reconcile(diskGrid, disks.map((disk) => disk.id || disk.name), createDiskCard);
        disks.forEach((disk, index) => updateDisk(nodes[index], disk));
      }

      const timestamp = Date.parse(snapshot.ts);
      if (Number.isFinite(timestamp)) {
        const read = disks.reduce((sum, disk) => sum + (Number(disk.readBytesPerSec) || 0), 0);
        const write = disks.reduce((sum, disk) => sum + (Number(disk.writeBytesPerSec) || 0), 0);
        chart.push([read, write], timestamp);
      }
    }

    return {
      update,
      destroy() {
        destroyed = true;
        chart.destroy();
      }
    };
  }
};
