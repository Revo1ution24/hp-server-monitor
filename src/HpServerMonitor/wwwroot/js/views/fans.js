import * as api from '../api.js';
import * as charts from '../charts.js';
import * as fmt from '../format.js';
import * as ui from '../ui.js';

const RANGE_POINTS = { '5m': 300, '15m': 900, '1h': 3600 };

export default {
  id: 'fans',
  title: '风扇',
  eyebrow: 'THERMALS',
  subtitle: '风扇转速、PWM 占空比与主板环境温度',

  mount(root) {
    let destroyed = false;
    const grid = ui.h('div', { class: 'grid' });
    root.append(grid);

    const fanArea = ui.h('div', { class: 'span-12' });
    const fanGrid = ui.h('div', { class: 'fan-grid' });
    const fanEmpty = ui.empty(
      '没有读到风扇转速',
      '已按 LHM Fan → WMI Win32_Fan → ACPI 热区逐层尝试。笔记本风扇通常走 EC，需要管理员权限、PawnIO 与厂商 EC 驱动；部分机型确实不暴露转速。',
      'fan');
    fanEmpty.hidden = true;
    fanArea.append(fanGrid, fanEmpty);
    grid.append(fanArea);

    // 三层降级链状态
    const chainCard = ui.card({
      title: '风扇读取链',
      icon: 'fan',
      sub: 'LHM → WMI → ACPI，逐层降级',
      className: 'span-12'
    });
    const chainList = ui.h('div', { class: 'list' });

    function createChainRow(label, hint) {
      const value = ui.h('span', {}, 'N/A');
      const state = ui.h('span', { class: 'badge' }, '—');
      const row = ui.h('div', { class: 'row' },
        ui.h('div', { class: 'row-main' },
          ui.h('div', { class: 'row-title' }, label),
          ui.h('div', { class: 'row-sub' }, hint)),
        ui.h('div', { class: 'row-side' }, value, state));
      return { row, value, state };
    }

    const chainLhm = createChainRow('1 · LibreHardwareMonitor Fan', '需要管理员 + PawnIO，EC/SuperIO 机型更完整');
    const chainWmi = createChainRow('2 · WMI Win32_Fan', '部分机型只返回 DesiredSpeed，0 表示不可用');
    const chainAcpi = createChainRow('3 · ACPI 热区', 'MSAcpi_ThermalZoneTemperature，仅提供温度兜底');
    chainList.append(chainLhm.row, chainWmi.row, chainAcpi.row);
    chainCard.body.append(
      chainList,
      ui.h('p', { class: 'faint', style: { marginTop: '10px', fontSize: '11px', lineHeight: '1.6' } },
        '读取顺序是 LHM → WMI → ACPI。下级数据不会伪造 RPM；没有转速时显示 N/A，并在设置页保留诊断信息。'));
    grid.append(chainCard.root);

    const chartCard = ui.card({
      title: '最高转速历史',
      icon: 'fan',
      sub: '所有风扇中的最高 RPM · 最近 5 分钟',
      className: 'span-12'
    });
    const canvas = ui.h('canvas');
    const chart = new charts.LineChart(canvas, {
      series: [{ name: '最高 RPM', color: '#ff8a3d' }],
      capacity: 300,
      format: (value) => fmt.rpm(value),
      axisFormat: (value) => fmt.num(value, 0),
      baselineZero: true
    });
    chartCard.body.append(ui.h('div', { class: 'chart-box' }, canvas));
    const range = ui.rangeChips(async (value) => {
      chart.setCapacity(RANGE_POINTS[value]);
      try {
        const data = await api.history('fan.max', value);
        if (!destroyed) chart.setSeries([data.points]);
      } catch { }
    }, '5m');
    chartCard.head.append(ui.h('div', { class: 'card-actions' }, range));
    grid.append(chartCard.root);

    const envCard = ui.card({
      title: '环境温度',
      icon: 'temp',
      sub: '主板、芯片组、机箱与额外传感器',
      className: 'span-12'
    });
    const mBoard = ui.metric({ label: '主板温度' });
    const mChipset = ui.metric({ label: '芯片组' });
    const mCase = ui.metric({ label: '机箱 / 环境' });
    const mVrm = ui.metric({ label: '供电 VRM' });
    const envGrid = ui.h('div', { class: 'metrics-grid' },
      mBoard.root, mChipset.root, mCase.root, mVrm.root);
    const extras = ui.h('div', { class: 'chip-list', style: { marginTop: '14px' } });
    const zones = ui.h('div', { class: 'chip-list', style: { marginTop: '10px' } });
    envCard.body.append(
      envGrid,
      extras,
      ui.h('div', { class: 'row-sub', style: { marginTop: '14px' } }, 'ACPI 热区（温度兜底，不是核心温度）'),
      zones);
    grid.append(envCard.root);

    api.history('fan.max', '5m').then((data) => {
      if (!destroyed) chart.setSeries([data.points]);
    }).catch(() => { });

    function createFanCard() {
      const name = ui.h('div', { class: 'fan-name' }, '风扇');
      const source = ui.h('span', { class: 'badge' }, 'LHM');
      const hardware = ui.h('div', { class: 'fan-hw' }, '');
      const rpm = ui.h('div', { class: 'fan-rpm' }, 'N/A');
      const percentText = ui.h('span', {}, '占空比 N/A');
      const percentBar = ui.progress();
      const card = ui.card({ title: '风扇', icon: 'fan', className: 'fan-slot' });
      card.body.append(
        ui.h('div', { class: 'fan-head' }, name, source),
        hardware,
        rpm,
        ui.h('div', { class: 'fan-percent' }, percentText, ui.h('span', {}, 'PWM')),
        percentBar.root);
      card.root._refs = { name, source, hardware, rpm, percentText, percentBar };
      return card.root;
    }

    function createExtraChip() {
      const text = ui.h('span', {}, 'N/A');
      const node = ui.h('span', { class: 'chip temp-chip' }, text);
      node._text = text;
      return node;
    }

    function update(snapshot) {
      const fans = snapshot.fans || [];
      fanEmpty.hidden = fans.length > 0;
      fanGrid.hidden = fans.length === 0;
      if (fans.length > 0) {
        const nodes = ui.reconcile(fanGrid, fans.map((fan) => fan.id || fan.name), createFanCard);
        fans.forEach((fan, index) => {
          const refs = nodes[index]?._refs;
          if (!refs) return;
          const wmi = fan.source === 'wmi';
          const hasRpm = fmt.isNumber(fan.rpm);
          const hasPercent = fmt.isNumber(fan.percent);
          ui.setText(refs.name, fan.name || '风扇');
          ui.setText(refs.source, wmi ? 'WMI' : 'LHM');
          refs.source.className = `badge ${hasRpm ? 'good' : 'warn'}`.trim();
          ui.setText(refs.hardware, fan.hardware || '');
          ui.setText(refs.rpm, hasRpm ? fmt.rpm(fan.rpm) : 'N/A');
          ui.setText(refs.percentText, hasPercent
            ? `占空比 ${fmt.pct(fan.percent, 0)}`
            : (hasRpm ? '占空比 N/A' : '该机型不提供转速与占空比'));
          refs.percentBar.set(hasPercent ? fan.percent : 0);
        });
      }

      const status = snapshot.status || {};
      const lhmFans = fans.filter((fan) => fan.source !== 'wmi');
      const lhmReading = lhmFans.filter((fan) => fmt.isNumber(fan.rpm) || fmt.isNumber(fan.percent)).length;
      const wmiFans = fans.filter((fan) => fan.source === 'wmi');
      const wmiReading = wmiFans.filter((fan) => fmt.isNumber(fan.rpm)).length;
      const wmiCount = Math.max(wmiFans.length, Number(status.wmiFanCount) || 0);
      const zoneItems = (snapshot.env?.thermalZones || []);
      const zoneCount = Math.max(zoneItems.length, Number(status.acpiThermalZoneCount) || 0);

      const setChain = (chain, ok, valueText, stateText, badgeKind) => {
        ui.setText(chain.value, valueText);
        ui.setText(chain.state, stateText);
        chain.state.className = `badge ${ok ? badgeKind : 'bad'}`.trim();
      };
      setChain(chainLhm, lhmReading > 0,
        lhmReading > 0
          ? `${lhmReading} 个`
          : (lhmFans.length > 0 ? `${lhmFans.length} 个条目（无读数）` : '未读到'),
        lhmReading > 0 ? '可用' : '不可用', 'good');
      setChain(chainWmi, wmiReading > 0,
        wmiReading > 0
          ? `${wmiReading} 个（当前使用）`
          : (wmiCount > 0 ? `${wmiCount} 个条目（无转速）` : '0 个条目'),
        wmiReading > 0 ? '可用' : (wmiCount > 0 ? '无转速' : '不可用'), 'info');
      setChain(chainAcpi, zoneCount > 0,
        zoneCount > 0 ? `${zoneCount} 个热区` : '0 个热区',
        zoneCount > 0 ? '可用' : '不可用', 'info');

      const rpmValues = fans
        .filter((fan) => fmt.isNumber(fan.rpm))
        .map((fan) => Number(fan.rpm));
      const maxRpm = rpmValues.length ? Math.max(...rpmValues) : null;
      const timestamp = Date.parse(snapshot.ts);
      if (Number.isFinite(timestamp))
        chart.push([maxRpm], timestamp);

      const env = snapshot.env || {};
      mBoard.set(env.boardTemp, (value) => fmt.num(value, 1), '°C');
      mChipset.set(env.chipsetTemp, (value) => fmt.num(value, 1), '°C');
      mCase.set(env.caseTemp, (value) => fmt.num(value, 1), '°C');
      mVrm.set(env.vrmTemp, (value) => fmt.num(value, 1), '°C');
      ui.applyTemp(mBoard.el, env.boardTemp);
      ui.applyTemp(mChipset.el, env.chipsetTemp);
      ui.applyTemp(mCase.el, env.caseTemp);
      ui.applyTemp(mVrm.el, env.vrmTemp);

      const items = env.extras || [];
      if (items.length === 0) {
        extras.replaceChildren(ui.h('span', { class: 'faint', style: { fontSize: '11px' } }, '没有额外的温度传感器'));
      } else {
        const nodes = ui.reconcile(extras, items.map((item) => item.name || ''), createExtraChip);
        items.forEach((item, index) => {
          const node = nodes[index];
          if (!node) return;
          ui.setText(node._text, `${item.name || '传感器'} ${fmt.temp(item.value)}`);
          ui.applyTemp(node, item.value);
        });
      }

      if (zoneItems.length === 0) {
        zones.replaceChildren(ui.h('span', { class: 'faint', style: { fontSize: '11px' } }, '未读到 ACPI 热区温度'));
      } else {
        const nodes = ui.reconcile(zones, zoneItems.map((zone) => zone.name || ''), createExtraChip);
        zoneItems.forEach((zone, index) => {
          const node = nodes[index];
          if (!node) return;
          ui.setText(node._text, `${zone.name || 'ACPI 热区'} ${fmt.temp(zone.value)}`);
          ui.applyTemp(node, zone.value);
        });
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
