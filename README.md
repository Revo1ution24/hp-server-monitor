# HP Server Monitor

![.NET 8](https://img.shields.io/badge/.NET-8.0-512BD4)
![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-0078D4)
![Frontend](https://img.shields.io/badge/frontend-vanilla%20JS-f7df1e)
![Version](https://img.shields.io/badge/version-1.0.3-2ea44f)

面向 Windows 10 老笔记本的家用服务器状态监视系统：

- **后端**：.NET 8 + ASP.NET Core Minimal API，`LibreHardwareMonitorLib` 读取传感器，PDH 补充 CPU 有效占用
- **前端**：原生 ES Module + 手写 CSS + Canvas 图表，无 npm、无构建链
- **通信**：WebSocket 每秒推送快照，HTTP API 提供快照/历史/登录
- **部署**：win-x64 自包含单文件 exe，可注册 Windows 服务或计划任务；另附图形化安装向导
- **安全**：PBKDF2 密码哈希、JWT、登录限流、WebSocket 鉴权、安装目录 ACL 收紧

示例访问地址：`https://monitor.example.com`（由 Caddy/Nginx 做 TLS 终止，请替换为你自己的域名）
默认监听：`http://0.0.0.0:8080`，局域网访问示例 `http://192.168.1.10:8080`

> **1.0.3 更新**：CPU 主环改为“有效占用”（PDH `% Processor Utility`，与任务管理器同口径），下方小字保留时间占用；新增 `cpu.utility` 历史、字段级缺失诊断、PawnIO 服务状态、GPU 活跃卡选择、安装目录权限收紧。

---


## 1. 快速开始

### 1.0 图形安装器（推荐）

构建后会得到 `dist\HpServerMonitorSetup.exe`（主程序已内嵌）。把它拷到目标笔记本，右键“以管理员身份运行”，按向导走完即可，无需手工编辑 JSON：

1. **基础配置**：安装目录（默认 `C:\HpServerMonitor`）、监听地址（`127.0.0.1` / `0.0.0.0`）、HTTP 端口、管理员用户名与密码（可一键生成随机密码）。
2. **运行方式**：Windows 服务 / 开机计划任务 / 仅复制文件；可选开放防火墙、安装后自动打开浏览器；可选“安装并接管 Caddy”：填写域名、HTTPS 端口、Caddy 安装目录（默认 `D:\Program Files\Caddy`）和证书验证方式。
3. **安装**：自动完成停止旧服务、释放 exe、写入 PBKDF2 密码哈希、注册并启动服务、配置 Caddy、健康检查，最后显示访问地址与账号。

已有安装可直接覆盖升级：向导会保留 `config.json` 中未修改的字段，密码留空则沿用旧密码。首页还有“卸载已有安装”入口：停止并删除服务/任务、可选移除防火墙规则、可选回退 Caddy 配置，并选择是否保留配置与日志。

**Caddy 的两种处理方式：**

- **全新安装**：从 `caddyserver.com` 下载官方 `caddy.exe`（约 50 MB，需要联网）到指定目录，把站点写入安装目录的 `Caddyfile`，注册并启动名为 `Caddy` 的 Windows 服务。
- **接管已有 Caddy**：探测 `Caddy` / `caddy` 服务及其 `--config` 文件，把本站点块（带 `# >>> HpServerMonitor (managed) >>>` 标记）追加进去，然后 `caddy reload`；重载失败会回滚配置并重启服务。
- 卸载时按记录回退：追加模式移除站点块，托管模式删除 Caddy 服务（Caddy 程序文件保留）。

**证书验证方式（家宽端口被封锁时很关键）：**

| 方式 | 依赖 | 适用场景 |
|---|---|---|
| 自动（HTTP-01 / TLS-ALPN-01） | 运营商放行入站 80/443 | 有公网 IP 且端口未被封 |
| DNS-01（dynv6） | dynv6 API Token | 80/443 被封，例如移动家宽 |
| 自签名 `tls internal` | 无 | 内网 / 临时验证，浏览器会告警 |

选择 DNS-01 时安装器会下载带 `github.com/caddy-dns/dynv6` 插件的 Caddy（`caddy-dynv6.exe`），把 dynv6 API Token 写进 Caddyfile，并把该文件的 ACL 收紧为仅 SYSTEM / Administrators 可读写：

```caddyfile
{
    https_port 8443
}

monitor.example.com {
    tls {
        dns dynv6 <你的 dynv6 API Token>
    }
    reverse_proxy 127.0.0.1:7898
    ...
}
```

HTTPS 端口填非 443 时，访问地址会带上端口，例如 `https://monitor.example.com:8443`。

> `caddyserver.com` 的在线构建服务没有收录 dynv6 插件，所以安装器按以下顺序找可用的插件版 Caddy：
> 1. 构建时放在 `dist\caddy-dynv6.exe`（会内嵌进安装器，Setup 体积增加约 30–50 MB）；
> 2. 与 `HpServerMonitorSetup.exe` 同目录的 `caddy-dynv6.exe`；
> 3. 本机已有的带 `dns.providers.dynv6` 模块的 Caddy。
>
> 三者都不存在时，DNS-01 会报错并提示，需要改用自动验证或自签名。

> 安装器需要管理员权限；密码只以 PBKDF2 哈希写入配置文件。域名需解析到本机；自动验证要求 80/443 入站可达，DNS-01 则不需要任何入站端口。

### 1.1 构建

只需要构建机安装 .NET 8 SDK 或更新版本（本仓库已用 .NET 10 SDK 验证可编译 `net8.0`）：

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

输出目录 `dist\`，其中：

```text
dist\
  HpServerMonitorSetup.exe  # 图形安装器（内嵌主程序，单文件）
  HpServerMonitor.exe       # 自包含单文件，目标机无需安装 .NET
  config.json               # 首次构建时从 config.example.json 复制
  README.md
  logs\
```

`build.ps1` 不会覆盖已存在的 `config.json`。

### 1.2 首次运行（控制台模式）

用**管理员** PowerShell 运行一次，确认传感器读取正常：

```powershell
cd dist
.\HpServerMonitor.exe
```

首次启动如果 `config.json` 中没有 `auth.passwordHash`，程序会：

1. 生成 16 位随机密码；
2. 生成随机 JWT 密钥；
3. 把密码的 PBKDF2 哈希与密钥写回 `config.json`；
4. 在控制台和 `logs\hpmonitor.log` 中输出初始密码。

浏览器打开 `http://192.168.1.10:8080`，用 `admin` + 日志中的密码登录。

> 生产环境建议用服务方式运行，避免退出控制台导致停止。服务默认以 LocalSystem 运行，天然具备读取传感器所需的管理员权限。

### 1.3 注册 Windows 服务

管理员 PowerShell：

```powershell
cd dist
powershell -ExecutionPolicy Bypass -File .\install-service.ps1 -Action Install -Mode Service
```

脚本会：

- 复制 exe/config/README 到 `C:\HpServerMonitor`（可通过 `-InstallDir` 修改）；
- 创建服务 `HpServerMonitor`，启动类型自动，崩溃后自动重启；
- 保留目标目录已有的 `config.json`，不会覆盖密码。

常用操作：

```powershell
.\install-service.ps1 -Action Status
.\install-service.ps1 -Action Start
.\install-service.ps1 -Action Stop
.\install-service.ps1 -Action Uninstall
```

如果不想用服务，可注册开机计划任务（最高权限）：

```powershell
.\install-service.ps1 -Action Install -Mode Task -OpenFirewall
```

`-OpenFirewall` 会为内网 8080 端口添加 Private 配置文件入站规则；公网只应开放 443/80。

### 1.4 修改密码

编辑 `C:\HpServerMonitor\config.json`：

```json
"auth": {
  "username": "admin",
  "password": "你的新密码",
  "passwordHash": "",
  ...
}
```

重启服务。程序启动时会把 `password` 转成 PBKDF2 哈希、清空明文，并写回 `passwordHash`。

也可以直接填写 `passwordHash`，格式：

```text
pbkdf2-sha256$210000$<Base64盐>$<Base64哈希>
```

修改 `auth.jwtSecret` 会让所有已签发令牌立即失效。

---

## 2. 配置项

`config.json` 位于 exe 同目录；相对路径均相对 exe 目录解析。

| 字段 | 默认值 | 说明 |
|---|---|---|
| `server.bind` | `0.0.0.0` | 监听地址。若 Caddy 与程序同机，建议改为 `127.0.0.1` |
| `server.httpPort` | `8080` | HTTP 端口 |
| `server.httpsEnabled` | `false` | 是否由 Kestrel 直接启用 HTTPS |
| `server.httpsPort` | `5443` | Kestrel HTTPS 端口 |
| `server.certPath` | `""` | PFX 证书路径（相对 exe 或绝对路径） |
| `server.certPassword` | `""` | PFX 密码 |
| `auth.username` | `admin` | 唯一登录用户名 |
| `auth.password` | `""` | 可选明文初始密码，启动时自动转哈希并清空 |
| `auth.passwordHash` | `""` | PBKDF2-SHA256 哈希 |
| `auth.jwtSecret` | `""` | Base64 JWT 密钥，至少 32 字节；为空自动生成 |
| `auth.tokenHours` | `12` | 登录令牌有效期（小时） |
| `sampling.intervalMs` | `1000` | 主采样间隔；老机器可调到 1500/2000 |
| `sampling.storageIntervalMs` | `5000` | SMART 更新间隔 |
| `sampling.slowInfoSeconds` | `60` | WMI 慢信息刷新间隔 |
| `sampling.historyPoints` | `3600` | 每个指标保留的历史点数 |
| `security.loginMaxAttempts` | `5` | 登录失败限流次数 |
| `security.loginWindowSeconds` | `60` | 限流窗口 |
| `logging.directory` | `logs` | 日志目录 |
| `logging.maxFileSizeMb` | `10` | 单文件上限 |
| `logging.maxFiles` | `3` | 当前文件 + 备份总数 |
| `logging.minimumLevel` | `Information` | `Debug/Information/Warning/Error` |

安装器在“Windows 服务 / 计划任务”模式下会把安装目录 ACL 收紧为 SYSTEM + Administrators（`config.json` 里有 JWT 密钥与密码哈希）。手动部署可执行：

```powershell
icacls C:\HpServerMonitor /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" /T
```

> `仅复制文件` 模式不会收紧权限，方便以普通用户手动运行 exe。收紧后修改 `config.json` 需要管理员权限的编辑器。

---

## 3. 反向代理与 HTTPS

### 3.1 Caddy（推荐）

Caddy 与 HpServerMonitor 在同一台笔记本上。仓库根目录已经提供完整的 [Caddyfile](Caddyfile)：

> 使用图形安装器时这一步可以自动完成：勾选“安装并接管 Caddy”即可下载/注册服务或把站点追加进已有配置，无需手工执行本节。

```caddyfile
monitor.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:8080

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Frame-Options "DENY"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "no-referrer"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        Cross-Origin-Opener-Policy "same-origin"
        Cross-Origin-Resource-Policy "same-origin"
        X-XSS-Protection "0"
        -Server
    }
}
```

此时建议把 `server.bind` 改为 `127.0.0.1`，避免 8080 被局域网/公网直接访问。
Caddy 会自动处理 WebSocket Upgrade，不需要额外配置。

如果 `monitor.example.com` 不是可公开签发证书的域名，Caddy 自动 HTTPS 会失败。可以选择：

- 使用真实域名 + Let's Encrypt；
- 使用 Cloudflare 等平台签发的源站证书；
- 内网实验时使用 `tls internal`（需要把 Caddy 根证书装进客户端信任库）。

### 3.2 Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name monitor.example.com;

    ssl_certificate     /etc/ssl/hpserver.crt;
    ssl_certificate_key /etc/ssl/hpserver.key;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

> 程序只信任来自本机回环地址的 `X-Forwarded-For`，用于登录限流识别真实 IP。
> 如果反代不在同一台机器，需要把反代 IP 加入信任列表，否则限流会按反代 IP 计算。

### 3.3 公网安全清单

- 路由器只映射 443/80，**不要映射 8080**。
- 使用强密码，定期轮换；不要使用默认密码。
- 不要把 `config.json` 提交到 Git 或发到聊天工具。
- 不需要外网时关闭端口映射，仅保留内网访问。
- 关注 `logs\hpmonitor.log` 的登录失败记录。

---

## 4. API

除登录和健康检查外，全部需要：

```http
Authorization: Bearer <JWT>
```

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/login` | `{username,password}` → `{token,expiresAt,username}`；失败 401/429 |
| `GET` | `/api/snapshot` | 完整快照，camelCase；采样未就绪返回 503 |
| `GET` | `/api/history?metric=cpu.load&range=1h` | `range` 支持 `5m/15m/1h` |
| `GET` | `/api/health` | 公开健康检查 |
| `WS` | `/ws` | 每秒 `{"type":"snapshot","data":{...}}` |

WebSocket 鉴权优先使用 `Sec-WebSocket-Protocol: hpmon, <jwt>`，也兼容 `?token=<jwt>` 调试。

可用历史指标：

```text
cpu.load  cpu.utility  cpu.temp  cpu.power  cpu.freq
mem.percent  mem.used
gpu.load  gpu.temp  gpu.memUsed
gpu.0.load  gpu.0.temp  gpu.0.memUsed   （按显卡索引，最多 4 块，供 GPU 页切换使用）
net.up  net.down
disk.read  disk.write
battery.level  fan.max
```

测试命令：

```powershell
# 健康检查
Invoke-RestMethod http://127.0.0.1:8080/api/health

# 登录
$body = @{ username='admin'; password='你的密码' } | ConvertTo-Json
$login = Invoke-RestMethod http://127.0.0.1:8080/api/login -Method Post -Body $body -ContentType 'application/json'

# 快照
Invoke-RestMethod http://127.0.0.1:8080/api/snapshot -Headers @{ Authorization = "Bearer $($login.token)" }
```

---

## 5. 传感器排查（重要）

### 5.1 先确认权限

- 服务模式：默认 LocalSystem，已具备管理员权限。
- 控制台模式：必须“以管理员身份运行 PowerShell”，否则温度、风扇、功耗通常为空。
- 设置页会显示 `管理员权限`、`PawnIO`（含服务是否运行）、`LHM 会话`、本次缺失的传感器与“疑似不支持”列表。

### 5.2 PawnIO（LHM 0.9.6 必需）

`LibreHardwareMonitorLib 0.9.6` 使用 PawnIO 驱动框架读取 MSR/EC/SMBus。**未安装 PawnIO 时**：

- CPU 温度、封装功耗、倍频、核心电压可能为 `N/A`；
- 风扇转速/占空比通常为 `N/A`；
- 内存频率/插槽信息可能缺失。

处理：

1. 从 PawnIO 官方项目安装驱动（管理员）；
2. 重启 Windows；
3. 重启 HpServerMonitor；
4. 设置页确认 `PawnIO = 已安装 · 运行中`（驱动存在但服务未运行时也会给出告警）。

部分机器还需关闭“内核隔离 → 内存完整性”（HVCI），否则第三方驱动可能被阻止。这是安全性权衡，请自行评估。

### 5.3 风扇三层降级

风扇页现在明确显示读取链：

1. **LibreHardwareMonitor Fan 传感器**（首选）
   - 需要管理员权限 + PawnIO；
   - LHM 已启用 `IsControllerEnabled=true`，可读取 SuperIO / EC / 主板子硬件；
   - 能同时给出 RPM 和部分 PWM 占空比（Control 传感器）。
2. **WMI Win32_Fan / MSAcpi_ThermalZoneTemperature**（兜底）
   - `Win32_Fan` 的 `DesiredSpeed` 在部分机型是真实 RPM，很多笔记本返回 `0` 或空；
   - `MSAcpi_ThermalZoneTemperature` 返回的是 ACPI 热区温度（十分之一开尔文），**不是风扇转速**；
   - 程序把 ACPI 热区温度单独显示在“环境温度”卡片下方，不会伪装成 CPU 核心温度。
3. **UI 占位**
   - 读不到时显示空状态卡片和三层读取链状态；
   - 风扇卡片显示 `N/A`，不会让页面报错；
   - 设置页显示 `风扇数据源`、`WMI Win32_Fan` 条目数、`ACPI 热区` 数量。

老笔记本的大致概率（不是保证，取决于具体机型和 BIOS）：

| 机型类型 | LHM Fan RPM | WMI Win32_Fan | ACPI 热区温度 |
|---|---|---|---|
| 有公开 SuperIO/EC 的老 Intel 笔记本 | 高 | 中低（常为 0） | 中 |
| 老 AMD A 系列 / 早期 Ryzen 笔记本 | 中 | 中低（常为 0） | 中 |
| OEM 锁 EC、只走厂商驱动的机型 | 低 | 低 | 中（可能只有热区） |

判断方法：看风扇页“风扇读取链”和设置页的诊断值。如果 LHM 已经读到 RPM，WMI/ACPI 只作为备用；如果三层都没有转速，属于硬件/驱动限制，建议用 HWiNFO 交叉验证。风扇占空比只有部分 SuperIO/EC 暴露，读到多少显示多少。

### 5.4 CPU 温度读不到：驱动与杀毒误报

本项目固定使用 `LibreHardwareMonitorLib 0.9.6`，它读取 MSR/EC/SMBus 的内核驱动是 **PawnIO**：

- 需要安装 PawnIO（`PawnIO.sys` + `PawnIOLib.dll`）；
- LHM 会按平台加载内嵌模块：`IntelMSR.bin`、`AMDFamily0F.bin`、`AMDFamily10.bin`、`AMDFamily17.bin`、`RyzenSMU.bin`、`LpcACPIEC.bin`、`IsaBridgeEC.bin` 等；
- 安装后必须重启 Windows，并确保 HpServerMonitor 以管理员/LocalSystem 运行；
- 设置页的 `PawnIO` 会变为“已安装”。

如果 CPU 温度仍然为 `N/A`：

- 部分老 AMD/Intel 平台的 EC/BIOS 根本不暴露该传感器，换任何软件都读不到；
- 虚拟机、WSL、云主机没有物理 MSR；
- 可以看风扇页的 ACPI 热区温度作为粗略参考，但它不是核心温度。

**杀毒软件误报处理：**

- 旧版 LibreHardwareMonitor 使用 `WinRing0x64.sys` / `inpoutx64.dll`，这类内核驱动容易被 Defender 或第三方杀软标记为 `HackTool`/易受攻击驱动；本项目**不降级到旧版 LHM**，优先 PawnIO。
- 只从 PawnIO 官方项目获取安装包，安装前用 PowerShell 验证签名：

```powershell
Get-AuthenticodeSignature "C:\Program Files\PawnIO\PawnIOLib.dll" | Format-List
```

- 如果杀软误报，只对以下路径加**最小范围**排除，不要关闭全局实时防护：
  - `C:\HpServerMonitor\`
  - `C:\Program Files\PawnIO\`
- 也可以把样本提交给杀软厂商做误报申诉；企业环境应遵循安全策略。
- Windows“内核隔离 → 内存完整性（HVCI）”可能阻止驱动加载；如果确认是它导致，需自行评估是否关闭。
- 不要为了读温度关闭 Windows Defender 全局防护或随意下载来源不明的 `WinRing0` 驱动。

CPU 频率补充说明：

- Intel 需要 MSR 访问，AMD 需要 SMU 访问，都依赖 PawnIO；
- 老 CPU 可能只暴露封装温度，不暴露每个核心温度；UI 会自动隐藏不存在的部分；
- “最低/最高频率”是**本次服务运行期间**观察到的最小/最大值，不是硬件规格频率；
- “倍频（估算）”= 当前有效频率 / 总线频率；总线读不到时按 100 MHz 估算。

### 5.5 存储 SMART

- 需要管理员权限；部分 USB 硬盘盒、RAID 卡、虚拟磁盘不透传 SMART。
- NVMe 通常能读到 `Life`（剩余寿命）；机械盘可能只有温度没有健康百分比。
- 健康度读不到时显示 `N/A`，但容量/读写速率仍可用。
- 可用 CrystalDiskInfo / smartctl 交叉验证。

### 5.6 电池健康度

- 电量/充电状态来自 `GetSystemPowerStatus`；设计容量/满充容量来自 WMI `root\wmi`。
- 如果健康度为空，运行 `powercfg /batteryreport` 生成报告对照。
- 台式机没有电池时，电池卡片会自动隐藏。

### 5.7 网络与 IPv6

- “公网 IPv6”取本机网卡上的全局单播地址（GUA），不是外部网站探测结果。
- 有 GUA 不代表公网可达：还需要路由器放行 IPv6、防火墙允许入站。
- 累计流量来自网卡 IPv4 计数器（自开机），实时速率优先使用 LHM。
- 站点部署在 IPv4 环境时，IPv6 卡片显示 `N/A` 属正常。

### 5.8 温度色阶

`< 50°C` 青绿 → `50~70°C` 黄 → `70~85°C` 橙 → `> 85°C` 红，颜色平滑插值；高温数字带轻微脉动辉光。

### 5.9 独立静态 UI 预览
`preview\index.html`、`preview\style.css`、`preview\app.js` 是一套完全独立的 UI 预览：

- 直接用浏览器打开 `preview\index.html`，不需要启动后端、不需要 npm；
- 内置 mock 快照与 1 秒模拟刷新，覆盖总览 / CPU / 内存 / 存储 / 网络 / 风扇 / 设置 7 个视图；
- 包含环形仪表、Canvas 折线、液态气泡侧栏、温度色阶、数字滚动与移动端底部导航；
- 可在设置页选择“预览登录页”，方便调登录卡片；
- 调完样式后，把视觉规则同步到 `src\HpServerMonitor\wwwroot\` 即可。

### 5.10 CPU 占用的两种口径

| 字段 | 来源 | 含义 |
|---|---|---|
| `cpu.load` | LHM `CPU Total`（`NtQuerySystemInformation`） | `% Processor Time`，CPU 有多少时间在忙，封顶 100% |
| `cpu.loadUtility` | PDH `\Processor Information(_Total)\% Processor Utility` | 频率加权口径，与任务管理器一致，可能超过 100% |

总览与 CPU 页的主环默认显示有效占用，下方小字显示时间占用；PDH 计数器不可用时自动回退到时间口径，并在日志里记录一次带 HRESULT 的告警。

与任务管理器、游戏加加对比时看主环；需要“CPU 忙了多少时间”时看下方时间占用。两者本来就不是同一个指标，数值不同是正常的。

---

## 6. 性能设计

默认节奏：

- 主循环 **1 秒**：CPU / 内存 / 主板 / 网络 / 电池；
- **GPU 每 2 秒**：部分独显单次更新需要几十毫秒，隔帧更新可显著降低 CPU；
- **存储 SMART 每 5 秒**；
- **WMI 慢查询每 60 秒**（物理盘映射每 5 分钟）；
- 每 tick 只序列化一次 JSON，所有 WebSocket 客户端复用同一份字节；
- 慢采样日志会输出 `传感器耗时 / 总耗时`，并附带 `lhm-update` 与最慢的采集器，便于定位 SMART/GPU 更新开销；
- 历史数据纯内存环形缓冲，约 1 MB；
- 日志异步写入，单文件 10 MB，保留 3 个。
- 单文件发布关闭了压缩（约 100 MB），换取更低的工作集内存与更快启动；实测空闲工作集约 127 MB。

如果老机器仍然吃力，可把 `sampling.intervalMs` 调到 `1500` 或 `2000`，并适当增大 `storageIntervalMs`。

---

## 7. 目录结构

```text
config.example.json              # 配置模板
Caddyfile                        # Caddy 反代 + 安全响应头
assets\app.ico                   # 主程序与安装器图标
build.ps1
install-service.ps1
preview\                         # 可直接双击打开的独立 UI 预览（mock 数据）
  index.html
  style.css
  app.js
src\HpServerMonitor.Installer\   # WPF 图形安装向导（内嵌主程序与 install-service.ps1）
  MainWindow.xaml                # 向导框架
  InstallerState.cs              # 共享安装参数
  InstallEngine.cs               # 释放文件、写配置、注册服务、卸载
  Pages\                         # 欢迎 / 配置 / 运行方式 / 安装 / 卸载
src\HpServerMonitor\
  Program.cs                     # 启动、Kestrel、DI、中间件
  Hosting\                       # 配置、日志、内嵌静态资源、启动诊断
  Auth\                          # PBKDF2、JWT、限流、鉴权中间件
  Api\                           # Minimal API + WebSocket Hub
  DeviceReader\
    HardwareSession.cs           # LHM 唯一访问点
    SamplingService.cs           # 1Hz 采样、历史、广播
    SnapshotFactory.cs
    Collectors\                  # CPU/内存/GPU/存储/风扇/网络/电池/系统/环境
    Support\                     # 传感器查询、WMI 缓存、历史环形缓冲、PDH、Win32
  wwwroot\                       # 编译进程序集的前端
```

---

## 8. 常见问题

### 启动失败：端口被占用

```powershell
netstat -ano | findstr :8080
```

结束占用进程，或修改 `server.httpPort`。

### 服务启动后立即停止

- 查看 `C:\HpServerMonitor\logs\hpmonitor.log`；
- 查看“事件查看器 → Windows 日志 → 应用程序”；
- 确认 `config.json` 是合法 JSON（支持注释与尾逗号）；
- 确认 exe 路径、目录写权限正常。

### 浏览器一直显示“连接中断”

- 确认页面通过同一地址访问，且反代支持 WebSocket Upgrade；
- Nginx 是否配置 `proxy_set_header Upgrade/Connection`；
- 直连 `http://192.168.1.10:8080` 是否正常；
- 浏览器控制台是否有 CSP/网络错误。

### 登录 429

同 IP 60 秒内失败 5 次会触发限流。等待窗口结束再试；确认没有脚本在反复登录。

### 401 / 自动回登录页

- JWT 默认 12 小时过期；
- 修改 `auth.jwtSecret` 后所有令牌立即失效；
- 重新登录即可。

### 页面显示 N/A

这是设计行为：单个传感器缺失不会让页面或服务崩溃。按第 5 节逐项排查；能读到多少显示多少。设置页的“疑似不支持”表示服务运行 30 秒后仍未读到过该字段，通常是机型/驱动不提供此传感器，而不是权限问题。

### 第一次启动密码忘了

删除 `config.json` 中的 `auth.passwordHash`，重启服务；程序会重新生成随机密码并写入日志。注意这也会保留 `auth.jwtSecret`，已有令牌仍可能有效；如需强制下线，同时清空 `auth.jwtSecret`。

---

## 9. 依赖说明

- `LibreHardwareMonitorLib 0.9.6`：传感器读取（会带入其自身的 HidSharp/DiskInfoToolkit 等依赖）。
- `Microsoft.Extensions.Hosting.WindowsServices`：Windows 服务生命周期（微软官方包）。
- `System.Management`：WMI 电池容量/内存条/物理盘映射（LHM 自身也依赖）。
- CPU 有效占用使用 Windows 自带的 PDH 计数器（`pdh.dll` P/Invoke），不引入额外 NuGet 包。
- JWT、密码哈希、静态资源托管、滚动日志、登录限流、图表与动画均为手写实现，无其他第三方前端库。

---

## 10. 许可

本仓库当前未附带开源许可证（All rights reserved）。如果需要在其它项目中复用，请先补充合适的 `LICENSE` 文件。
