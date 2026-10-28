using System.Collections.Concurrent;
using System.Globalization;
using System.Management;
using System.Text.RegularExpressions;
using HpServerMonitor.Hosting;

namespace HpServerMonitor.DeviceReader.Support;

public sealed record CpuStaticInfo(string? Name, int? PhysicalCores, int? LogicalCores);

public sealed record BoardStaticInfo(string? Manufacturer, string? Product, string? BiosVersion);

public sealed record MemoryStaticInfo(
    double? SpeedMhz,
    int? SlotsUsed,
    int? SlotCount,
    long? TotalBytes,
    string? ModuleType);

public sealed record BatteryStaticInfo(double? DesignMwh, double? FullChargeMwh);

public sealed record PageFileStaticInfo(long? UsedBytes);

/// <summary>WMI Win32_Fan 的降级风扇信息；DesiredSpeed 可能为 0/空。</summary>
public sealed record WmiFanInfo(string Name, double? Rpm, string? Status, bool? ActiveCooling);

/// <summary>MSAcpi_ThermalZoneTemperature 的 ACPI 热区温度（摄氏度）。</summary>
public sealed record ThermalZoneInfo(string Name, double? TempC);

public sealed record PhysicalDiskInfo(
    int Index,
    string Model,
    long? SizeBytes,
    string? Status,
    string? MediaType,
    string[] DriveLetters);

/// <summary>
/// WMI 慢查询集中在这里，后台线程刷新，采样线程只读不可变快照。
/// 这样主板型号、内存条、电池设计容量、物理盘映射都不会拖慢 1Hz 采样。
/// </summary>
public sealed class SlowInfoCache : BackgroundService
{
    private static readonly Regex DeviceIdRegex = new("DeviceID=\"([^\"]+)\"", RegexOptions.Compiled);

    private readonly ILogger<SlowInfoCache> _logger;
    private readonly int _intervalSeconds;
    private readonly ConcurrentDictionary<string, long> _lastWarn = new(StringComparer.Ordinal);

    private CpuStaticInfo _cpu = new(null, null, null);
    private BoardStaticInfo _board = new(null, null, null);
    private MemoryStaticInfo _memory = new(null, null, null, null, null);
    private BatteryStaticInfo _battery = new(null, null);
    private PageFileStaticInfo _pageFile = new(null);
    private OsStaticInfo _os = new(null, null, null);
    private IReadOnlyList<PhysicalDiskInfo> _disks = Array.Empty<PhysicalDiskInfo>();
    private IReadOnlyList<WmiFanInfo> _wmiFans = Array.Empty<WmiFanInfo>();
    private IReadOnlyList<ThermalZoneInfo> _thermalZones = Array.Empty<ThermalZoneInfo>();

    public CpuStaticInfo Cpu => Volatile.Read(ref _cpu);
    public BoardStaticInfo Board => Volatile.Read(ref _board);
    public MemoryStaticInfo Memory => Volatile.Read(ref _memory);
    public BatteryStaticInfo Battery => Volatile.Read(ref _battery);
    public PageFileStaticInfo PageFile => Volatile.Read(ref _pageFile);
    public OsStaticInfo Os => Volatile.Read(ref _os);
    public IReadOnlyList<PhysicalDiskInfo> Disks => Volatile.Read(ref _disks);
    public IReadOnlyList<WmiFanInfo> WmiFans => Volatile.Read(ref _wmiFans);
    public IReadOnlyList<ThermalZoneInfo> ThermalZones => Volatile.Read(ref _thermalZones);

    public SlowInfoCache(AppConfig config, ILogger<SlowInfoCache> logger)
    {
        _logger = logger;
        _intervalSeconds = Math.Clamp(config.Sampling.SlowInfoSeconds, 15, 3600);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Yield();
        await Task.Run(RefreshEverything, stoppingToken);

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(_intervalSeconds));
        var tick = 0;
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                tick++;
                RefreshBattery();
                RefreshPageFile();
                RefreshWmiFans();
                RefreshThermalZones();

                if (tick % 5 == 0)
                {
                    RefreshMemory();
                    RefreshDisks();
                }
            }
        }
        catch (OperationCanceledException)
        {
            // 正常停止
        }
    }

    private void RefreshEverything()
    {
        RefreshStatic();
        RefreshMemory();
        RefreshBattery();
        RefreshPageFile();
        RefreshDisks();
        RefreshWmiFans();
        RefreshThermalZones();
        _logger.LogInformation("慢速信息缓存已初始化（WMI，间隔 {Interval}s）", _intervalSeconds);
    }

    private void RefreshStatic()
    {
        try
        {
            var cpus = Query(null, "SELECT Name, NumberOfCores, NumberOfLogicalProcessors FROM Win32_Processor");
            if (cpus.Count > 0)
            {
                var name = cpus.Select(c => GetString(c, "Name")).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v))?.Trim();
                var physical = cpus.Sum(c => (int?)GetInt(c, "NumberOfCores") ?? 0);
                var logical = cpus.Sum(c => (int?)GetInt(c, "NumberOfLogicalProcessors") ?? 0);
                _cpu = new CpuStaticInfo(
                    name,
                    physical > 0 ? physical : null,
                    logical > 0 ? logical : Environment.ProcessorCount);
            }
            else
            {
                _cpu = new CpuStaticInfo(null, null, Environment.ProcessorCount);
            }
        }
        catch (Exception ex)
        {
            WarnOnce("cpu-static", ex);
            _cpu = new CpuStaticInfo(null, null, Environment.ProcessorCount);
        }

        try
        {
            var boards = Query(null, "SELECT Manufacturer, Product, Version FROM Win32_BaseBoard");
            var board = boards.FirstOrDefault();
            var manufacturer = GetString(board, "Manufacturer")?.Trim();
            var product = GetString(board, "Product")?.Trim();
            var boardText = string.Join(" ", new[] { manufacturer, product }.Where(s => !string.IsNullOrWhiteSpace(s)));

            var bios = GetString(Query(null, "SELECT SMBIOSBIOSVersion, Version FROM Win32_BIOS").FirstOrDefault(), "SMBIOSBIOSVersion")?.Trim();
            _board = new BoardStaticInfo(
                string.IsNullOrWhiteSpace(manufacturer) ? null : manufacturer,
                string.IsNullOrWhiteSpace(product) ? null : product,
                string.IsNullOrWhiteSpace(bios) ? null : bios);

            if (string.IsNullOrWhiteSpace(boardText))
                _board = new BoardStaticInfo(null, null, _board.BiosVersion);
        }
        catch (Exception ex)
        {
            WarnOnce("board-static", ex);
        }

        try
        {
            _os = ReadOsInfo();
        }
        catch (Exception ex)
        {
            WarnOnce("os-static", ex);
        }
    }

    private static OsStaticInfo ReadOsInfo()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(
                @"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
            var product = key?.GetValue("ProductName")?.ToString();
            var display = key?.GetValue("DisplayVersion")?.ToString();
            var build = key?.GetValue("CurrentBuildNumber")?.ToString();
            if (!string.IsNullOrWhiteSpace(product) &&
                int.TryParse(build, out var buildNumber) && buildNumber >= 22000)
            {
                product = product.Replace("Windows 10", "Windows 11", StringComparison.OrdinalIgnoreCase);
            }
            return new OsStaticInfo(product, display, build ?? Environment.OSVersion.Version.Build.ToString(CultureInfo.InvariantCulture));
        }
        catch
        {
            return new OsStaticInfo(null, null, null);
        }
    }

    private void RefreshMemory()
    {
        try
        {
            var modules = Query(null,
                "SELECT Capacity, Speed, ConfiguredClockSpeed, SMBIOSMemoryType, MemoryType FROM Win32_PhysicalMemory");
            if (modules.Count == 0)
            {
                _memory = new MemoryStaticInfo(null, null, null, null, null);
                return;
            }

            long total = 0;
            double? speed = null;
            foreach (var module in modules)
            {
                total += GetLong(module, "Capacity") ?? 0;
                var configured = GetDouble(module, "ConfiguredClockSpeed");
                var rated = GetDouble(module, "Speed");
                var current = configured is > 0 ? configured : rated;
                if (current is > 0 && (speed is null || current > speed))
                    speed = current;
            }

            int? slotCount = null;
            try
            {
                var arrays = Query(null, "SELECT MemoryDevices FROM Win32_PhysicalMemoryArray");
                var count = arrays.Sum(a => (int?)GetInt(a, "MemoryDevices") ?? 0);
                if (count > 0)
                    slotCount = count;
            }
            catch
            {
                // 插槽总数读不到不影响已用插槽
            }

            var typeCode = GetInt(modules[0], "SMBIOSMemoryType") ?? GetInt(modules[0], "MemoryType");
            _memory = new MemoryStaticInfo(
                speed,
                modules.Count,
                slotCount,
                total > 0 ? total : null,
                MemoryTypeName(typeCode));
        }
        catch (Exception ex)
        {
            WarnOnce("memory-static", ex);
        }
    }

    private void RefreshBattery()
    {
        try
        {
            double? design = null;
            double? full = null;

            var designRows = Query(@"root\wmi", "SELECT DesignedCapacity FROM BatteryStaticData");
            var designValues = designRows
                .Select(r => GetDouble(r, "DesignedCapacity"))
                .Where(v => v is > 0)
                .Select(v => v!.Value)
                .ToArray();
            if (designValues.Length > 0)
                design = designValues.Sum();

            var fullRows = Query(@"root\wmi", "SELECT FullChargedCapacity FROM BatteryFullChargedCapacity");
            var fullValues = fullRows
                .Select(r => GetDouble(r, "FullChargedCapacity"))
                .Where(v => v is > 0)
                .Select(v => v!.Value)
                .ToArray();
            if (fullValues.Length > 0)
                full = fullValues.Sum();

            _battery = new BatteryStaticInfo(design, full);
        }
        catch (Exception ex)
        {
            WarnOnce("battery-static", ex);
        }
    }

    private void RefreshPageFile()
    {
        try
        {
            var rows = Query(null, "SELECT CurrentUsage, AllocatedBaseSize FROM Win32_PageFileUsage");
            if (rows.Count == 0)
            {
                _pageFile = new PageFileStaticInfo(null);
                return;
            }

            var usedMb = rows.Sum(r => GetDouble(r, "CurrentUsage") ?? 0);
            _pageFile = new PageFileStaticInfo((long)Math.Round(usedMb * 1024d * 1024d));
        }
        catch (Exception ex)
        {
            WarnOnce("pagefile-static", ex);
        }
    }

    /// <summary>第 2 层降级：WMI Win32_Fan。很多笔记本只返回 DesiredSpeed=0，仍保留条目供 UI 显示来源。</summary>
    private void RefreshWmiFans()
    {
        try
        {
            var rows = Query(null,
                "SELECT Name, DeviceID, DesiredSpeed, VariableSpeed, ActiveCooling, Status FROM Win32_Fan");
            var list = new List<WmiFanInfo>(rows.Count);
            foreach (var row in rows)
            {
                var name = GetString(row, "Name") ?? GetString(row, "DeviceID") ?? "WMI Fan";
                var speed = GetDouble(row, "DesiredSpeed");
                if (speed is <= 0 or > 20000)
                    speed = null;

                list.Add(new WmiFanInfo(
                    name,
                    speed,
                    GetString(row, "Status"),
                    GetBool(row, "ActiveCooling")));
            }
            _wmiFans = list;
        }
        catch (Exception ex)
        {
            _wmiFans = Array.Empty<WmiFanInfo>();
            WarnOnce("wmi-fan", ex);
        }
    }

    /// <summary>第 2 层降级：ACPI 热区温度。注意它通常不是风扇转速，只作为温度兜底。</summary>
    private void RefreshThermalZones()
    {
        try
        {
            var rows = Query(@"root\wmi",
                "SELECT InstanceName, CurrentTemperature FROM MSAcpi_ThermalZoneTemperature", 10);
            var list = new List<ThermalZoneInfo>(rows.Count);
            foreach (var row in rows)
            {
                var raw = GetDouble(row, "CurrentTemperature");
                if (raw is null)
                    continue;

                // WMI 返回十分之一开尔文
                var celsius = raw.Value / 10d - 273.15;
                if (celsius is <= -20 or >= 150)
                    continue;

                list.Add(new ThermalZoneInfo(
                    GetString(row, "InstanceName") ?? "ACPI Thermal Zone",
                    Math.Round(celsius, 1)));
            }
            _thermalZones = list;
        }
        catch (Exception ex)
        {
            _thermalZones = Array.Empty<ThermalZoneInfo>();
            WarnOnce("acpi-thermal", ex);
        }
    }

    private void RefreshDisks()
    {
        try
        {
            var drives = Query(null,
                "SELECT DeviceID, Index, Model, Size, Status, MediaType, InterfaceType FROM Win32_DiskDrive");
            if (drives.Count == 0)
            {
                _disks = Array.Empty<PhysicalDiskInfo>();
                return;
            }

            // 物理盘 → 分区 → 盘符
            var partitions = Query(null, "SELECT DeviceID, DiskIndex FROM Win32_DiskPartition");
            var partitionToDisk = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var partition in partitions)
            {
                var id = GetString(partition, "DeviceID");
                var diskIndex = GetInt(partition, "DiskIndex");
                if (id is not null && diskIndex is not null)
                    partitionToDisk[id] = diskIndex.Value;
            }

            var diskLetters = new Dictionary<int, SortedSet<string>>();
            var mappings = Query(null, "SELECT Antecedent, Dependent FROM Win32_LogicalDiskToPartition");
            foreach (var mapping in mappings)
            {
                var partitionId = ExtractDeviceId(GetString(mapping, "Antecedent"));
                var letter = ExtractDeviceId(GetString(mapping, "Dependent"));
                if (partitionId is null || letter is null || !partitionToDisk.TryGetValue(partitionId, out var diskIndex))
                    continue;

                if (!diskLetters.TryGetValue(diskIndex, out var set))
                    diskLetters[diskIndex] = set = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
                set.Add(letter);
            }

            // 现代存储命名空间能给出 SSD/HDD 与健康状态
            var msft = new Dictionary<int, (string? MediaType, string? Health)>();
            try
            {
                var rows = Query(@"root\Microsoft\Windows\Storage",
                    "SELECT DeviceId, MediaType, HealthStatus FROM MSFT_PhysicalDisk", 10);
                foreach (var row in rows)
                {
                    if (!int.TryParse(GetString(row, "DeviceId"), out var index))
                        continue;
                    var media = GetInt(row, "MediaType") switch
                    {
                        3 => "HDD",
                        4 => "SSD",
                        5 => "SCM",
                        _ => null
                    };
                    var health = GetInt(row, "HealthStatus") switch
                    {
                        0 => "OK",
                        1 => "Warning",
                        2 => "Unhealthy",
                        _ => null
                    };
                    msft[index] = (media, health);
                }
            }
            catch (Exception ex)
            {
                WarnOnce("msft-disks", ex);
            }

            var list = new List<PhysicalDiskInfo>(drives.Count);
            foreach (var drive in drives)
            {
                var index = GetInt(drive, "Index");
                if (index is null)
                    continue;

                var model = GetString(drive, "Model")?.Trim() ?? $"Disk {index}";
                var status = GetString(drive, "Status");
                string? mediaType = null;
                if (msft.TryGetValue(index.Value, out var extra))
                {
                    mediaType = extra.MediaType;
                    if (!string.IsNullOrWhiteSpace(extra.Health))
                        status = extra.Health;
                }

                mediaType ??= GuessMediaType(model, GetString(drive, "MediaType"));
                var letters = diskLetters.TryGetValue(index.Value, out var set)
                    ? set.ToArray()
                    : Array.Empty<string>();

                list.Add(new PhysicalDiskInfo(
                    index.Value,
                    model,
                    GetLong(drive, "Size"),
                    status,
                    mediaType,
                    letters));
            }

            _disks = list.OrderBy(d => d.Index).ToArray();
        }
        catch (Exception ex)
        {
            WarnOnce("disks-static", ex);
        }
    }

    private static string? GuessMediaType(string model, string? mediaType)
    {
        var text = $"{model} {mediaType}";
        if (text.Contains("SSD", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("NVMe", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("Solid State", StringComparison.OrdinalIgnoreCase))
            return "SSD";
        if (text.Contains("HDD", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("Hard Disk", StringComparison.OrdinalIgnoreCase))
            return "HDD";
        return null;
    }

    private static string? MemoryTypeName(int? code) => code switch
    {
        20 => "DDR",
        21 => "DDR2",
        22 => "DDR2 FB-DIMM",
        24 => "DDR3",
        26 => "DDR4",
        27 => "LPDDR",
        28 => "LPDDR2",
        29 => "LPDDR3",
        30 => "LPDDR4",
        34 => "DDR5",
        35 => "LPDDR5",
        null => null,
        _ => $"Type {code}"
    };

    private static string? ExtractDeviceId(string? wmiPath)
    {
        if (string.IsNullOrEmpty(wmiPath))
            return null;
        var match = DeviceIdRegex.Match(wmiPath);
        return match.Success ? match.Groups[1].Value : null;
    }

    private List<Dictionary<string, object?>> Query(string? scope, string wql, int timeoutSeconds = 8)
    {
        var list = new List<Dictionary<string, object?>>();
        var options = new System.Management.EnumerationOptions
        {
            Timeout = TimeSpan.FromSeconds(timeoutSeconds),
            ReturnImmediately = false
        };

        using var searcher = new ManagementObjectSearcher(
            new ManagementScope(scope ?? @"root\cimv2"),
            new ObjectQuery(wql),
            options);

        using var collection = searcher.Get();
        foreach (ManagementObject item in collection)
        {
            using (item)
            {
                var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
                foreach (PropertyData property in item.Properties)
                {
                    try { row[property.Name] = property.Value; } catch { }
                }
                list.Add(row);
            }
        }
        return list;
    }

    private static string? GetString(Dictionary<string, object?>? row, string name)
    {
        if (row is null || !row.TryGetValue(name, out var value) || value is null)
            return null;
        return value.ToString();
    }

    private static int? GetInt(Dictionary<string, object?>? row, string name)
    {
        if (row is null || !row.TryGetValue(name, out var value) || value is null)
            return null;
        try { return Convert.ToInt32(value, CultureInfo.InvariantCulture); }
        catch { return null; }
    }

    private static long? GetLong(Dictionary<string, object?>? row, string name)
    {
        if (row is null || !row.TryGetValue(name, out var value) || value is null)
            return null;
        try { return Convert.ToInt64(value, CultureInfo.InvariantCulture); }
        catch { return null; }
    }

    private static double? GetDouble(Dictionary<string, object?>? row, string name)
    {
        if (row is null || !row.TryGetValue(name, out var value) || value is null)
            return null;
        try { return Convert.ToDouble(value, CultureInfo.InvariantCulture); }
        catch { return null; }
    }

    private static bool? GetBool(Dictionary<string, object?>? row, string name)
    {
        if (row is null || !row.TryGetValue(name, out var value) || value is null)
            return null;
        try { return Convert.ToBoolean(value, CultureInfo.InvariantCulture); }
        catch { return null; }
    }

    private void WarnOnce(string key, Exception ex)
    {
        var now = Environment.TickCount64;
        if (_lastWarn.TryGetValue(key, out var last) && now - last < 300_000)
            return;
        _lastWarn[key] = now;
        _logger.LogWarning("WMI 查询失败（{Key}）：{Message}", key, ex.Message);
    }
}

public sealed record OsStaticInfo(string? ProductName, string? DisplayVersion, string? Build);
