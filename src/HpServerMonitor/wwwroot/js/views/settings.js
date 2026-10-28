import * as api from '../api.js';
import * as fmt from '../format.js';
import * as ui from '../ui.js';

const MISSING_LABELS = {
  lhm: 'LHM 未初始化',
  'cpu.temp': 'CPU 温度',
  'cpu.power': 'CPU 功耗',
  'cpu.voltage': 'CPU 电压',
  'cpu.freq': 'CPU 频率',
  'cpu.freqEffective': 'CPU 有效频率',
  gpu: 'GPU',
  'gpu.temp': 'GPU 温度',
  'gpu.power': 'GPU 功耗',
  'gpu.fan': 'GPU 风扇',
  fan: '风扇',
  'fan.rpm': '风扇转速',
  'fan.percent': '风扇占空比',
  'env.board': '主板温度',
  'env.chipset': '芯片组温度',
  'env.case': '机箱温度',
  'env.vrm': 'VRM 温度',
  disk: '磁盘',
  'disk.temp': '磁盘温度',
  'disk.health': '磁盘健康度',
  battery: '电池',
  'battery.health': '电池健康度',
  'mem.speed': '内存频率'
};

export default {
  id: 'settings',
  title: '设置',
  eyebrow: 'SETTINGS',
  subtitle: '账号、连接状态与运行诊断',

  mount(root, ctx) {
    const grid = ui.h('div', { class: 'grid' });
    root.append(grid);

    const session = api.getSession();

    // 账号
    const accountCard = ui.card({
      title: '账号',
      icon: 'shield',
      sub: '当前登录会话',
      className: 'span-6'
    });
    const username = ui.h('div', { class: 'kv-value' }, session?.username || 'N/A');
    const expires = ui.h('div', { class: 'kv-value' }, session?.expiresAt ? `${fmt.dateTime(session.expiresAt)}（${fmt.relativeUntil(session.expiresAt)}）` : 'N/A');
    const logout = ui.h('button', { class: 'btn danger', type: 'button' }, '退出登录');
    logout.addEventListener('click', () => ctx.onLogout());
    accountCard.body.append(
      ui.h('div', { class: 'kv' },
        ui.h('div', { class: 'kv-row' }, ui.h('span', { class: 'kv-key' }, '用户名'), username),
        ui.h('div', { class: 'kv-row' }, ui.h('span', { class: 'kv-key' }, '令牌有效期'), expires)),
      ui.h('div', { class: 'settings-actions' }, logout));
    grid.append(accountCard.root);

    // 偏好
    const prefCard = ui.card({
      title: '显示与连接',
      icon: 'settings',
      sub: '浏览器本地偏好',
      className: 'span-6'
    });
    const motion = ui.h('input', { type: 'checkbox' });
    motion.checked = ui.reducedMotion();
    motion.addEventListener('change', () => {
      ctx.setReducedMotion(motion.checked);
      ui.toast(motion.checked ? '已开启减少动效' : '已关闭减少动效');
    });
    const reconnect = ui.h('button', { class: 'btn', type: 'button' }, '重新连接');
    reconnect.addEventListener('click', () => ctx.onReconnect());
    prefCard.body.append(
      ui.h('label', { class: 'toggle' },
        motion,
        ui.h('span', { class: 'toggle-track' }, ui.h('span', { class: 'toggle-thumb' })),
        ui.h('span', { class: 'toggle-text' }, '减少动效（关闭极光漂移、数字滚动与液态滑动）')),
      ui.h('div', { class: 'settings-actions' }, reconnect));
    grid.append(prefCard.root);

    // 诊断
    const diagCard = ui.card({
      title: '运行诊断',
      icon: 'activity',
      sub: '服务端实时状态',
      className: 'span-6'
    });

    function kvRow(label) {
      const value = ui.h('span', { class: 'kv-value' }, 'N/A');
      const row = ui.h('div', { class: 'kv-row' }, ui.h('span', { class: 'kv-key' }, label), value);
      return { row, value };
    }

    const kAdmin = kvRow('管理员权限');
    const kPawn = kvRow('PawnIO');
    const kLhm = kvRow('LHM 会话');
    const kClients = kvRow('WebSocket 客户端');
    const kSampling = kvRow('传感器采样耗时');
    const kErrors = kvRow('读取异常');
    const kFanSource = kvRow('风扇数据源');
    const kWmiFan = kvRow('WMI Win32_Fan');
    const kAcpi = kvRow('ACPI 热区');
    const kMissing = kvRow('本次缺失的传感器');
    const kUnsupported = kvRow('疑似不支持');
    const kVersion = kvRow('服务版本');
    diagCard.body.append(ui.h('div', { class: 'kv' },
      kAdmin.row, kPawn.row, kLhm.row, kClients.row,
      kSampling.row, kErrors.row, kFanSource.row, kWmiFan.row,
      kAcpi.row, kMissing.row, kUnsupported.row, kVersion.row));
    grid.append(diagCard.root);

    // API
    const apiCard = ui.card({
      title: '接口',
      icon: 'server',
      sub: '同源鉴权 API',
      className: 'span-6'
    });
    apiCard.body.append(ui.h('div', { class: 'code' },
      'GET  /api/snapshot\n' +
      'GET  /api/history?metric=cpu.load&range=1h\n' +
      'POST /api/login\n' +
      'GET  /api/health\n' +
      'WS   /ws'));
    grid.append(apiCard.root);

    // 配置提示
    const noteCard = ui.card({
      title: '配置',
      icon: 'settings',
      sub: '修改后需要重启服务',
      className: 'span-12'
    });
    noteCard.body.append(ui.h('div', { class: 'alert info', style: { marginBottom: '0' } },
      '配置位于程序目录的 config.json。修改密码时填写 auth.password 明文并重启，首次启动会自动转成 PBKDF2 哈希；修改 auth.jwtSecret 会使现有登录全部失效。'));
    grid.append(noteCard.root);

    function update(snapshot) {
      const status = snapshot.status || {};
      kAdmin.value.textContent = status.admin ? '已启用' : '只读降级';
      kAdmin.value.style.color = status.admin ? 'var(--teal)' : 'var(--amber)';
      if (!status.pawnIo) {
        kPawn.value.textContent = '未检测到';
        kPawn.value.style.color = 'var(--amber)';
      } else if (status.pawnIoRunning === true) {
        kPawn.value.textContent = '已安装 · 运行中';
        kPawn.value.style.color = 'var(--teal)';
      } else if (status.pawnIoRunning === false) {
        kPawn.value.textContent = '已安装 · 服务未运行';
        kPawn.value.style.color = 'var(--amber)';
      } else {
        kPawn.value.textContent = '已安装（状态未知）';
        kPawn.value.style.color = 'var(--teal)';
      }
      kLhm.value.textContent = status.lhmAvailable ? '正常' : (status.lhmError || '未初始化');
      kLhm.value.style.color = status.lhmAvailable ? 'var(--teal)' : 'var(--red)';
      kClients.value.textContent = fmt.num(status.clients ?? 0, 0);
      kSampling.value.textContent = fmt.isNumber(status.samplingMs) ? `${fmt.num(status.samplingMs, 0)} ms` : 'N/A';
      kErrors.value.textContent = `${fmt.num(status.readErrors ?? 0, 0)} 本次 / ${fmt.num(status.totalReadErrors ?? 0, 0)} 累计`;
      const fans = snapshot.fans || [];
      const rpmFans = fans.filter((fan) => fmt.isNumber(fan.rpm));
      const fanSource = status.fanSource || 'none';
      if (fanSource === 'lhm') {
        kFanSource.value.textContent = rpmFans.length ? 'LHM Fan' : 'LHM（无转速读数）';
        kFanSource.value.style.color = rpmFans.length ? 'var(--teal)' : 'var(--amber)';
      } else if (fanSource === 'wmi') {
        kFanSource.value.textContent = rpmFans.length ? 'WMI Win32_Fan' : 'WMI（有条目，无转速）';
        kFanSource.value.style.color = rpmFans.length ? 'var(--teal)' : 'var(--amber)';
      } else {
        kFanSource.value.textContent = '无（UI 占位）';
        kFanSource.value.style.color = 'var(--red)';
      }
      kWmiFan.value.textContent = `${fmt.num(status.wmiFanCount ?? 0, 0)} 个条目`;
      kAcpi.value.textContent = `${fmt.num(status.acpiThermalZoneCount ?? 0, 0)} 个热区`;
      const missing = (status.sensorsMissing || []).map((key) => MISSING_LABELS[key] || key);
      kMissing.value.textContent = missing.length ? `${missing.length} 项：${missing.join('、')}` : '无';
      kMissing.value.style.color = missing.length ? 'var(--amber)' : 'var(--muted)';
      const unsupported = (status.sensorsUnsupported || []).map((key) => MISSING_LABELS[key] || key);
      kUnsupported.value.textContent = unsupported.length ? unsupported.join('、') : '无';
      kUnsupported.value.style.color = unsupported.length ? 'var(--faint)' : 'var(--muted)';
      kVersion.value.textContent = snapshot.system?.appVersion || 'N/A';

      const liveExpires = api.getSession()?.expiresAt;
      if (liveExpires) expires.textContent = `${fmt.dateTime(liveExpires)}（${fmt.relativeUntil(liveExpires)}）`;
    }

    return { update, destroy() { } };
  }
};
