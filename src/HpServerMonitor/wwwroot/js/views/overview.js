import * as api from '../api.js';
import * as charts from '../charts.js';
import * as fmt from '../format.js';
import * as ui from '../ui.js';

const GPU_STORAGE_KEY = 'hpmon.gpu.v2';

function savedGpuName() {
  try { return localStorage.getItem(GPU_STORAGE_KEY) || ''; } catch { return ''; }
}

function persistGpuName(name) {
  try { localStorage.setItem(GPU_STORAGE_KEY, name); } catch { }
}

export default {
  id: 'overview',
  title: '总览',
  eyebrow: 'SYSTEM OVERVIEW',
  subtitle: '实时掌握这台服务器的呼吸',

  mount(root, ctx) {
    let destroyed = false;
    const grid = ui.h('div', { class: 'grid' });
    root.append(grid);

    const alerts = ui.h('div', { class: 'span-12' });
    alerts.hidden = true;
    grid.append(alerts);

    // ---------- CPU 主卡片 ----------
    const cpuCard = ui.card({
      title: 'CPU',
      icon: 'cpu',
      sub: '处理器实时负载',
      className: 'span-5 hero-card cpu-overview'
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

    const mFreq = ui.metric({ label: '当前频率', big: true });
    const mPower = ui.metric({ label: '封装功耗', big: true });
    const mVolt = ui.metric({ label: '核心电压', big: true });
    const coreLineValue = ui.h('span', { class: 'info-value' }, 'N/A');
    const coreLine = ui.h('div', { class: 'cpu-coreline' },
      ui.h('span', { class: 'info-label' }, '核心 / 线程'),
      coreLineValue);

    cpuCard.body.append(
      ui.h('div', { class: 'hero-split cpu-hero' },
        ringWrap,
        ui.h('div', { class: 'cpu-quick' }, mFreq.root, mPower.root, mVolt.root)),
      coreLine);
    grid.append(cpuCard.root);

    // ---------- 右列 ----------
    const stack = ui.h('div', { class: 'span-7 overview-side' });
    grid.append(stack);

    // 内存
    const memCard = ui.card({ title: '内存', icon: 'memory', sub: '物理内存使用', className: 'overview-mem' });
    const memUsed = ui.metric({ label: '已用' });
    const memFree = ui.metric({ label: '可用' });
    const memProgress = ui.progress();
    const memLeft = ui.h('span', {}, 'N/A');
    const memRight = ui.h('span', {}, 'N/A');
    const memMeta = ui.h('div', { class: 'progress-row' }, ui.h('span', {}, '频率 / 插槽'), ui.h('span', {}, 'N/A'));
    memCard.body.append(
      ui.h('div', { class: 'mini-metrics' }, memUsed.root, memFree.root),
      ui.h('div', { class: 'progress-space' }, memProgress.root),
      ui.h('div', { class: 'progress-row' }, memLeft, memRight),
      memMeta);
    stack.append(memCard.root);

    // GPU
    const gpuPicker = ui.h('div', { class: 'gpu-picker', role: 'group', 'aria-label': '选择要显示的显卡' });
    gpuPicker.hidden = true;
    const gpuCard = ui.card({
      title: 'GPU',
      icon: 'monitor',
      sub: '图形处理器',
      actions: gpuPicker,
      className: 'overview-gpu'
    });
    const gpuContent = ui.h('div');
    const gpuName = ui.h('div', { class: 'row-title' }, 'N/A');
    const gpuLoad = ui.metric({ label: '占用' });
    const gpuTemp = ui.metric({ label: '温度' });
    const gpuProgress = ui.progress();
    const gpuMemText = ui.h('div', { class: 'progress-row' }, ui.h('span', {}, '显存'), ui.h('span', {}, 'N/A'));
    gpuContent.append(
      gpuName,
      ui.h('div', { class: 'mini-metrics', style: { marginTop: '12px' } }, gpuLoad.root, gpuTemp.root),
      ui.h('div', { class: 'progress-space' }, gpuProgress.root),
      gpuMemText);
    const gpuEmpty = ui.empty('未检测到 GPU', '核显或驱动未暴露传感器时会显示此状态', 'monitor');
    gpuEmpty.hidden = true;
    gpuCard.body.append(gpuContent, gpuEmpty);
    stack.append(gpuCard.root);

    // 显卡选择：多显卡时在卡片右上角显示 GPU1/GPU2 切换
    let gpuList = [];
    let gpuSelected = savedGpuName();
    let gpuUserPicked = gpuSelected.length > 0;
    let autoGpuName = '';
    let pickerSignature = '';

    // 活跃度：先比负载，负载相同再比显存占用；避免默认展示空闲的独显
    function activeGpu() {
      let best = null;
      for (const gpu of gpuList) {
        if (!best) {
          best = gpu;
          continue;
        }
        const load = fmt.isNumber(gpu.load) ? Number(gpu.load) : -1;
        const bestLoad = fmt.isNumber(best.load) ? Number(best.load) : -1;
        if (load > bestLoad) {
          best = gpu;
          continue;
        }
        if (load === bestLoad) {
          const memory = fmt.isNumber(gpu.memUsedBytes) ? Number(gpu.memUsedBytes) : 0;
          const bestMemory = fmt.isNumber(best.memUsedBytes) ? Number(best.memUsedBytes) : 0;
          if (memory > bestMemory) best = gpu;
        }
      }
      return best;
    }

    // 自动选择带上滞后：换卡需要拉开 10 个百分点，避免双 GPU 时每秒来回跳
    function autoGpu() {
      const best = activeGpu();
      if (!best) return null;
      if (!autoGpuName || !gpuList.some((gpu) => gpu.name === autoGpuName)) {
        autoGpuName = best.name || '';
        return best;
      }

      const current = gpuList.find((gpu) => gpu.name === autoGpuName);
      const currentLoad = fmt.isNumber(current.load) ? Number(current.load) : -1;
      const bestLoad = fmt.isNumber(best.load) ? Number(best.load) : -1;
      if (best.name !== autoGpuName && bestLoad >= currentLoad + 10) {
        autoGpuName = best.name || '';
        return best;
      }
      return current;
    }

    function currentGpu() {
      if (gpuList.length === 0) return null;
      if (gpuUserPicked) {
        const picked = gpuList.find((gpu) => gpu.name === gpuSelected);
        if (picked) return picked;
        // 用户选过的卡暂时不在列表里，退回自动选择
        gpuUserPicked = false;
        gpuSelected = '';
      }
      return autoGpu() || gpuList[0];
    }

    function renderGpuPicker() {
      gpuPicker.hidden = gpuList.length < 2;
      if (gpuList.length < 2) return;

      const signature = gpuList.map((gpu) => gpu.name).join('|');
      if (signature !== pickerSignature) {
        pickerSignature = signature;
        gpuPicker.replaceChildren(...gpuList.map((gpu, index) => {
          const label = `GPU${index + 1}`;
          const button = ui.h('button', {
            type: 'button',
            class: 'chip',
            title: gpu.name || label,
            'aria-label': gpu.name || label
          }, label);
          button.addEventListener('click', () => {
            gpuUserPicked = true;
            gpuSelected = gpu.name || '';
            persistGpuName(gpuSelected);
            renderGpuPicker();
            applyGpu();
          });
          return button;
        }));
      }

      const current = currentGpu();
      gpuList.forEach((gpu, index) => {
        const button = gpuPicker.children[index];
        if (button) button.classList.toggle('active', Boolean(current) && gpu.name === current.name);
      });
    }

    function applyGpu() {
      const gpu = currentGpu();
      gpuContent.hidden = !gpu;
      gpuEmpty.hidden = Boolean(gpu);
      if (!gpu) return;

      ui.setText(gpuName, gpu.name || 'GPU');
      gpuLoad.set(gpu.load, (value) => fmt.num(value, 0), '%');
      gpuTemp.set(gpu.temp, (value) => fmt.num(value, 1), '°C');
      ui.applyTemp(gpuTemp.el, gpu.temp);
      const memoryPercent = fmt.isNumber(gpu.memUsedBytes) && fmt.isNumber(gpu.memTotalBytes) && gpu.memTotalBytes > 0
        ? (gpu.memUsedBytes / gpu.memTotalBytes) * 100
        : 0;
      gpuProgress.set(memoryPercent);
      ui.setText(gpuMemText.lastChild,
        `${fmt.bytes(gpu.memUsedBytes)} / ${fmt.bytes(gpu.memTotalBytes)}`);
    }

    // 电池
    const batteryCard = ui.card({ title: '电池', icon: 'battery', sub: '笔记本电池健康', className: 'overview-battery' });
    const batCharge = ui.metric({ label: '剩余电量' });
    const batHealth = ui.metric({ label: '健康度' });
    const batProgress = ui.progress();
    const batStatus = ui.h('div', { class: 'progress-row' }, ui.h('span', {}, 'N/A'), ui.h('span', {}, 'N/A'));
    batteryCard.body.append(
      ui.h('div', { class: 'mini-metrics' }, batCharge.root, batHealth.root),
      ui.h('div', { class: 'progress-space' }, batProgress.root),
      batStatus);
    batteryCard.root.hidden = true;
    stack.append(batteryCard.root);

    // ---------- 网络 ----------
    const netCard = ui.card({
      title: '网络',
      icon: 'network',
      sub: '实时吞吐 · 最近 5 分钟',
      className: 'span-6'
    });
    const netDown = ui.metric({ label: '下载' });
    const netUp = ui.metric({ label: '上传' });
    const netCanvas = ui.h('canvas');
    const netChart = new charts.LineChart(netCanvas, {
      series: [
        { name: '下载', color: '#ff8a3d' },
        { name: '上传', color: '#ff2a6d' }
      ],
      capacity: 300,
      format: (value) => fmt.rate(value),
      axisFormat: fmt.bytesShort,
      baselineZero: true
    });
    const netTotal = ui.h('div', { class: 'progress-row' },
      ui.h('span', {}, '累计下行 N/A'),
      ui.h('span', {}, '累计上行 N/A'));
    netCard.body.append(
      ui.h('div', { class: 'mini-metrics' }, netDown.root, netUp.root),
      ui.h('div', { class: 'legend' },
        ui.h('span', { class: 'legend-item' }, ui.h('span', { class: 'legend-dot', style: { background: '#ff8a3d', color: '#ff8a3d' } }), '下载'),
        ui.h('span', { class: 'legend-item' }, ui.h('span', { class: 'legend-dot', style: { background: '#ff2a6d', color: '#ff2a6d' } }), '上传')),
      ui.h('div', { class: 'chart-box small' }, netCanvas),
      netTotal);
    grid.append(netCard.root);

    // ---------- 存储 ----------
    const storageCard = ui.card({
      title: '存储',
      icon: 'storage',
      sub: '物理磁盘与容量',
      className: 'span-6'
    });
    const storageTotal = ui.metric({ label: '总容量' });
    const storageFree = ui.metric({ label: '剩余' });
    const storageProgress = ui.progress();
    const storageMeta = ui.h('div', { class: 'progress-row' }, ui.h('span', {}, '已用'), ui.h('span', {}, 'N/A'));
    const storageList = ui.h('div', { class: 'list', style: { marginTop: '14px' } });
    storageCard.body.append(
      ui.h('div', { class: 'mini-metrics' }, storageTotal.root, storageFree.root),
      ui.h('div', { class: 'progress-space' }, storageProgress.root),
      storageMeta,
      storageList);
    grid.append(storageCard.root);

    // ---------- 系统信息 ----------
    const systemCard = ui.card({
      title: '系统',
      icon: 'server',
      sub: '主机、主板与运行环境',
      className: 'span-12'
    });

    function infoCell(label, wrap = false) {
      const value = ui.h('div', { class: `info-value${wrap ? ' wrap' : ''}` }, 'N/A');
      const cell = ui.h('div', { class: 'info-cell' },
        ui.h('div', { class: 'info-label' }, label), value);
      return { cell, value };
    }

    const sysOs = infoCell('操作系统', true);
    const sysBoard = infoCell('主板 / BIOS', true);
    const sysCpu = infoCell('CPU 型号', true);
    const sysUptime = infoCell('运行时长');
    const sysProc = infoCell('进程 / 线程');
    const sysFan = infoCell('风扇');
    const sysEnv = infoCell('主板 / 机箱温度');
    const sysIpv6 = infoCell('公网 IPv6', true);

    systemCard.body.append(ui.h('div', { class: 'info-grid' },
      sysOs.cell, sysBoard.cell, sysCpu.cell, sysUptime.cell,
      sysProc.cell, sysFan.cell, sysEnv.cell, sysIpv6.cell));
    grid.append(systemCard.root);

    // ---------- 历史数据 ----------
    Promise.all([
      api.history('net.down', '5m'),
      api.history('net.up', '5m')
    ]).then(([down, up]) => {
      if (destroyed) return;
      netChart.setSeries([down.points, up.points]);
    }).catch(() => { });

    function renderAlerts(snapshot) {
      const status = snapshot.status || {};
      const items = [];
      if (!status.admin)
        items.push(['warn', '未以管理员权限运行，温度、风扇、功耗等传感器可能缺失。']);
      if (!status.pawnIo)
        items.push(['warn', '未检测到 PawnIO，CPU 温度/功耗与 EC 风扇可能无法读取。']);
      else if (status.pawnIoRunning === false)
        items.push(['warn', 'PawnIO 已安装但服务未运行，CPU 温度/功耗与 EC 风扇可能无法读取。']);
      if (status.lhmAvailable === false)
        items.push(['bad', `LibreHardwareMonitor 初始化失败：${status.lhmError || '未知错误'}`]);
      if ((status.readErrors || 0) > 0)
        items.push(['info', `本次采样有 ${status.readErrors} 个传感器读取异常，已自动跳过。`]);

      const signature = items.map((item) => item.join(':')).join('|');
      if (alerts.dataset.signature === signature) return;
      alerts.dataset.signature = signature;
      alerts.replaceChildren(...items.map(([kind, text]) => ui.alert(text, kind)));
      alerts.hidden = items.length === 0;
    }

    function createStorageRow() {
      const title = ui.h('div', { class: 'row-title' }, 'N/A');
      const sub = ui.h('div', { class: 'row-sub' }, '');
      const temp = ui.h('span', { class: 'badge' }, 'N/A');
      const free = ui.h('span', { class: 'row-sub' }, 'N/A');
      const row = ui.h('div', { class: 'row' },
        ui.h('div', { class: 'row-main' }, title, sub),
        ui.h('div', { class: 'row-side' }, temp, free));
      row._title = title;
      row._sub = sub;
      row._temp = temp;
      row._free = free;
      return row;
    }

    function updateStorage(snapshot) {
      const disks = [...(snapshot.disks || [])].sort((a, b) =>
        String(a.driveLetters?.[0] || a.name || '').localeCompare(String(b.driveLetters?.[0] || b.name || '')));
      const total = disks.reduce((sum, disk) => sum + (Number(disk.totalBytes) || 0), 0);
      const free = disks.reduce((sum, disk) => sum + (Number(disk.freeBytes) || 0), 0);
      const used = total - free;

      storageTotal.set(total || null, (n) => fmt.bytes(n));
      storageFree.set(free || null, (n) => fmt.bytes(n));
      storageProgress.set(total > 0 ? (used / total) * 100 : 0);
      ui.setText(storageMeta.firstChild, total > 0 ? `已用 ${fmt.bytes(used)}` : '已用');
      ui.setText(storageMeta.lastChild, total > 0 ? fmt.pct((used / total) * 100) : 'N/A');

      const nodes = ui.reconcile(storageList, disks.map((disk) => disk.id || disk.name), createStorageRow);
      disks.forEach((disk, index) => {
        const row = nodes[index];
        if (!row) return;
        ui.setText(row._title, disk.model || disk.name || '磁盘');
        const letters = (disk.driveLetters || []).join(' · ');
        ui.setText(row._sub, [letters, disk.mediaType].filter(Boolean).join(' · ') || '磁盘');
        ui.setText(row._temp, fmt.temp(disk.temperature));
        ui.applyTemp(row._temp, disk.temperature);
        ui.setText(row._free, fmt.bytes(disk.freeBytes));
      });
    }

    function update(snapshot) {
      if (!snapshot) return;
      renderAlerts(snapshot);

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

      mFreq.set(cpu.freqMhz, (value) => fmt.num(value, 0), 'MHz');
      mPower.set(cpu.powerPackage, (value) => fmt.num(value, 1), 'W');
      mVolt.set(cpu.voltage, (value) => fmt.num(value, 3), 'V');
      ui.setText(coreLineValue, fmt.isNumber(cpu.physicalCores)
        ? `${cpu.physicalCores} 核 / ${cpu.logicalCores ?? '—'} 线程`
        : (fmt.isNumber(cpu.logicalCores) ? `${cpu.logicalCores} 线程` : 'N/A'));

      const memory = snapshot.memory || {};
      memUsed.set(memory.usedBytes, (value) => fmt.bytes(value));
      memFree.set(memory.freeBytes, (value) => fmt.bytes(value));
      memProgress.set(memory.load);
      ui.setText(memLeft, fmt.isNumber(memory.usedBytes) && fmt.isNumber(memory.totalBytes)
        ? `${fmt.bytes(memory.usedBytes)} / ${fmt.bytes(memory.totalBytes)}`
        : 'N/A');
      ui.setText(memRight, fmt.pct(memory.load));
      ui.setText(memMeta.lastChild,
        `${fmt.isNumber(memory.speedMhz) ? `${fmt.num(memory.speedMhz, 0)} MHz` : 'N/A'} · ` +
        `${fmt.isNumber(memory.slotsUsed) ? `${memory.slotsUsed}${fmt.isNumber(memory.slotCount) ? `/${memory.slotCount}` : ''} 槽` : 'N/A'}`);

      gpuList = snapshot.gpus || [];
      renderGpuPicker();
      applyGpu();

      const battery = snapshot.battery || {};
      batteryCard.root.hidden = !battery.present;
      if (battery.present) {
        batCharge.set(battery.chargePercent, (value) => fmt.num(value, 0), '%');
        batHealth.set(battery.healthPercent, (value) => fmt.num(value, 0), '%');
        batProgress.set(battery.chargePercent);
        ui.setText(batStatus.firstChild,
          battery.charging ? '正在充电' : (battery.onAc ? '已接电源' : '电池供电'));
        ui.setText(batStatus.lastChild, fmt.isNumber(battery.powerW) ? `功耗 ${fmt.watt(battery.powerW)}` : '');
      }

      const network = snapshot.network || {};
      netDown.set(network.downloadBytesPerSec, (value) => fmt.bytes(value), '/s');
      netUp.set(network.uploadBytesPerSec, (value) => fmt.bytes(value), '/s');
      const timestamp = Date.parse(snapshot.ts);
      if (Number.isFinite(timestamp)) {
        netChart.push([network.downloadBytesPerSec ?? null, network.uploadBytesPerSec ?? null], timestamp);
      }
      ui.setText(netTotal.firstChild, `累计下行 ${fmt.bytes(network.totalDownloadedBytes)}`);
      ui.setText(netTotal.lastChild, `累计上行 ${fmt.bytes(network.totalUploadedBytes)}`);

      updateStorage(snapshot);

      const system = snapshot.system || {};
      ui.setText(sysOs.value, [system.osName, system.osVersion].filter(Boolean).join(' · ') || 'N/A');
      ui.setText(sysBoard.value, [system.board, system.bios].filter(Boolean).join(' · ') || 'N/A');
      ui.setText(sysCpu.value, system.cpuModel || 'N/A');
      ui.setText(sysUptime.value, fmt.isNumber(system.uptimeSeconds) ? fmt.uptime(system.uptimeSeconds) : 'N/A');
      ui.setText(sysProc.value, fmt.isNumber(cpu.processCount)
        ? `${fmt.num(cpu.processCount, 0)} / ${fmt.num(cpu.threadCount, 0)}`
        : 'N/A');

      const fans = snapshot.fans || [];
      const rpmValues = fans
        .filter((fan) => fmt.isNumber(fan.rpm))
        .map((fan) => Number(fan.rpm));
      const maxRpm = rpmValues.length ? Math.max(...rpmValues) : null;
      ui.setText(sysFan.value, fans.length > 0
        ? `${fans.length} 个${maxRpm === null ? ' · 无转速' : ` · 最高 ${fmt.rpm(maxRpm)}`}`
        : 'N/A');

      const env = snapshot.env || {};
      ui.setText(sysEnv.value,
        [env.boardTemp, env.caseTemp].some(fmt.isNumber)
          ? `${fmt.temp(env.boardTemp)} / ${fmt.temp(env.caseTemp)}`
          : 'N/A');
      ui.setText(sysIpv6.value, network.publicIpv6 || 'N/A');
    }

    return {
      update,
      destroy() {
        destroyed = true;
        ring.destroy();
        netChart.destroy();
      }
    };
  }
};
