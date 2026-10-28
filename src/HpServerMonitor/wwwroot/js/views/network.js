import * as api from '../api.js';
import * as charts from '../charts.js';
import * as fmt from '../format.js';
import * as ui from '../ui.js';

const RANGE_POINTS = { '5m': 300, '15m': 900, '1h': 3600 };

export default {
  id: 'network',
  title: '网络',
  eyebrow: 'NETWORK',
  subtitle: '实时上下行、累计流量、网卡与公网 IPv6',

  mount(root) {
    let destroyed = false;
    const grid = ui.h('div', { class: 'grid' });
    root.append(grid);

    function rateCard(title, icon, color, className) {
      const card = ui.card({ title, icon, sub: '实时速率', className });
      const value = ui.metric({ label: title, big: true });
      const total = ui.h('div', { class: 'progress-row', style: { marginTop: '12px' } },
        ui.h('span', {}, '累计 N/A'), ui.h('span', {}, ''));
      const sparkCanvas = ui.h('canvas');
      const spark = new charts.Sparkline(sparkCanvas, { color, capacity: 60 });
      card.body.append(
        value.root,
        ui.h('div', { class: 'chart-box small', style: { height: '94px', marginTop: '10px' } }, sparkCanvas),
        total);
      return { card, value, total, spark };
    }

    const down = rateCard('下载', 'arrowDown', '#ff8a3d', 'span-6 hero-card');
    const up = rateCard('上传', 'arrowUp', '#ff2a6d', 'span-6 hero-card');
    grid.append(down.card.root, up.card.root);

    const chartCard = ui.card({
      title: '吞吐历史',
      icon: 'activity',
      sub: '最近 5 分钟',
      className: 'span-12'
    });
    const canvas = ui.h('canvas');
    const chart = new charts.LineChart(canvas, {
      series: [
        { name: '下载', color: '#ff8a3d' },
        { name: '上传', color: '#ff2a6d' }
      ],
      capacity: 300,
      format: (value) => fmt.rate(value),
      axisFormat: fmt.bytesShort,
      baselineZero: true
    });
    chartCard.body.append(
      ui.h('div', { class: 'legend' },
        ui.h('span', { class: 'legend-item' }, ui.h('span', { class: 'legend-dot', style: { background: '#ff8a3d', color: '#ff8a3d' } }), '下载'),
        ui.h('span', { class: 'legend-item' }, ui.h('span', { class: 'legend-dot', style: { background: '#ff2a6d', color: '#ff2a6d' } }), '上传')),
      ui.h('div', { class: 'chart-box tall' }, canvas));
    const range = ui.rangeChips(async (value) => {
      chart.setCapacity(RANGE_POINTS[value]);
      chartCard.setSub(`最近 ${value === '5m' ? '5 分钟' : value === '15m' ? '15 分钟' : '1 小时'}`);
      try {
        const [d, u] = await Promise.all([
          api.history('net.down', value),
          api.history('net.up', value)
        ]);
        if (!destroyed) chart.setSeries([d.points, u.points]);
      } catch { }
    }, '5m');
    chartCard.head.append(ui.h('div', { class: 'card-actions' }, range));
    grid.append(chartCard.root);

    const adapterCard = ui.card({
      title: '网卡与地址',
      icon: 'network',
      sub: '本机活动网卡',
      className: 'span-8'
    });
    const adapterList = ui.h('div', { class: 'adapter-list' });
    const adapterEmpty = ui.empty('没有活动网卡', '检查网线或无线连接', 'wifi');
    adapterEmpty.hidden = true;
    adapterCard.body.append(adapterList, adapterEmpty);
    grid.append(adapterCard.root);

    const ipCard = ui.card({
      title: '公网 IPv6',
      icon: 'wifi',
      sub: '来自本机全局单播地址',
      className: 'span-4'
    });
    const ipv6Primary = ui.h('div', { class: 'info-value wrap', style: { marginTop: '4px' } }, 'N/A');
    const ipv6List = ui.h('div', { class: 'code', style: { marginTop: '12px' } }, 'N/A');
    const ipv6Meta = ui.h('div', { class: 'progress-row', style: { marginTop: '10px' } },
      ui.h('span', {}, '地址数量'), ui.h('span', {}, 'N/A'));
    ipCard.body.append(ipv6Primary, ipv6List, ipv6Meta);
    grid.append(ipCard.root);

    Promise.all([
      api.history('net.down', '5m'),
      api.history('net.up', '5m')
    ]).then(([d, u]) => {
      if (destroyed) return;
      chart.setSeries([d.points, u.points]);
    }).catch(() => { });

    function createAdapterRow() {
      const title = ui.h('div', { class: 'adapter-name' }, 'N/A');
      const sub = ui.h('div', { class: 'adapter-sub' }, '');
      const ips = ui.h('div', { class: 'adapter-ips' });
      const side = ui.h('div', { class: 'adapter-side' }, '');
      const row = ui.h('div', { class: 'adapter' },
        ui.h('div', { style: { minWidth: '0' } }, title, sub),
        ips,
        side);
      row._title = title;
      row._sub = sub;
      row._ips = ips;
      row._side = side;
      return row;
    }

    function updateAdapter(row, adapter) {
      ui.setText(row._title, adapter.name || '网卡');
      ui.setText(row._sub, [adapter.description, adapter.mac].filter(Boolean).join(' · '));
      const signature = [...(adapter.ipv4 || []), '|', ...(adapter.ipv6 || [])].join(',');
      if (row._ips.dataset.signature !== signature) {
        row._ips.dataset.signature = signature;
        row._ips.replaceChildren(
          ...(adapter.ipv4 || []).map((ip) => ui.h('span', { class: 'ip' }, ip)),
          ...(adapter.ipv6 || []).map((ip) => ui.h('span', { class: 'ip v6' }, ip)));
      }
      const speed = fmt.isNumber(adapter.speedBps) ? `${fmt.num(adapter.speedBps / 1_000_000, 0)} Mbps` : '';
      ui.setText(row._side, [adapter.status, speed].filter(Boolean).join(' · '));
    }

    function update(snapshot) {
      const network = snapshot.network || {};
      down.value.set(network.downloadBytesPerSec, (value) => fmt.bytes(value), '/s');
      up.value.set(network.uploadBytesPerSec, (value) => fmt.bytes(value), '/s');
      ui.setText(down.total.firstChild, `累计 ${fmt.bytes(network.totalDownloadedBytes)}`);
      ui.setText(up.total.firstChild, `累计 ${fmt.bytes(network.totalUploadedBytes)}`);
      ui.setText(down.total.lastChild, '自开机');
      ui.setText(up.total.lastChild, '自开机');

      const timestamp = Date.parse(snapshot.ts);
      if (Number.isFinite(timestamp)) {
        down.spark.push({ t: timestamp, v: network.downloadBytesPerSec ?? null });
        up.spark.push({ t: timestamp, v: network.uploadBytesPerSec ?? null });
        chart.push([network.downloadBytesPerSec ?? null, network.uploadBytesPerSec ?? null], timestamp);
      }

      const adapters = network.adapters || [];
      adapterEmpty.hidden = adapters.length > 0;
      adapterList.hidden = adapters.length === 0;
      if (adapters.length > 0) {
        const nodes = ui.reconcile(adapterList, adapters.map((adapter) => adapter.name || adapter.mac || ''), createAdapterRow);
        adapters.forEach((adapter, index) => updateAdapter(nodes[index], adapter));
      }

      const addresses = network.ipv6Addresses || [];
      ui.setText(ipv6Primary, network.publicIpv6 || 'N/A');
      ipv6List.textContent = addresses.length ? addresses.join('\n') : '未获取到全局 IPv6 地址';
      ui.setText(ipv6Meta.lastChild, addresses.length ? `${addresses.length} 个` : '0 个');
    }

    return {
      update,
      destroy() {
        destroyed = true;
        down.spark.destroy();
        up.spark.destroy();
        chart.destroy();
      }
    };
  }
};
