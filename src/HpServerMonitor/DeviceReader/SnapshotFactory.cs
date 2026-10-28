using System.Diagnostics;
using HpServerMonitor.DeviceReader.Collectors;
using HpServerMonitor.DeviceReader.Models;
using HpServerMonitor.DeviceReader.Support;
using HpServerMonitor.Hosting;

namespace HpServerMonitor.DeviceReader;

/// <summary>把各采集器组装成一份完整快照，并汇总降级状态。</summary>
public sealed class SnapshotFactory
{
    /// <summary>首次采样后经过多少 tick 才把“一直没读到”的字段判定为疑似不支持，避免启动抖动误判。</summary>
    private const int UnsupportedGraceBuilds = 30;

    private readonly HardwareSession _session;
    private readonly SlowInfoCache _slow;
    private readonly SafeLog _safe;
    private readonly StartupDiagnostics _diagnostics;
    private readonly CpuCollector _cpu;
    private readonly MemoryCollector _memory;
    private readonly GpuCollector _gpu;
    private readonly StorageCollector _storage;
    private readonly FanCollector _fan;
    private readonly NetworkCollector _network;
    private readonly BatteryCollector _battery;
    private readonly SystemCollector _system;
    private readonly EnvironmentCollector _environment;
    private readonly HashSet<string> _everSeen = new(StringComparer.Ordinal);
    private int _buildCount;
    private IReadOnlyDictionary<string, long> _lastTimings = new Dictionary<string, long>();

    /// <summary>上一次 Build 各采集器的耗时（毫秒），仅用于慢采样诊断日志。</summary>
    public IReadOnlyDictionary<string, long> LastTimings => _lastTimings;

    public SnapshotFactory(
        HardwareSession session,
        SlowInfoCache slow,
        SafeLog safe,
        StartupDiagnostics diagnostics,
        PdhCpuMeter pdh)
    {
        _session = session;
        _slow = slow;
        _safe = safe;
        _diagnostics = diagnostics;
        _cpu = new CpuCollector(session, slow, safe, pdh);
        _memory = new MemoryCollector(slow, safe);
        _gpu = new GpuCollector(session, safe);
        _storage = new StorageCollector(session, slow, safe);
        _fan = new FanCollector(session, slow, safe);
        _network = new NetworkCollector(session, safe);
        _battery = new BatteryCollector(slow, session, safe);
        _system = new SystemCollector(slow, diagnostics, safe);
        _environment = new EnvironmentCollector(session, slow, safe);
    }

    public Snapshot Build(long sequence)
    {
        _buildCount++;
        var timings = new Dictionary<string, long>(9);

        var snapshot = new Snapshot
        {
            Ts = DateTimeOffset.Now,
            Seq = sequence
        };

        snapshot.Cpu = Measure("cpu", _cpu.Collect, timings);
        snapshot.Memory = Measure("memory", _memory.Collect, timings);
        snapshot.Gpus = Measure("gpu", _gpu.Collect, timings);
        snapshot.Disks = Measure("storage", _storage.Collect, timings);
        snapshot.Fans = Measure("fan", _fan.Collect, timings);
        snapshot.Network = Measure("network", _network.Collect, timings);
        snapshot.Battery = Measure("battery", _battery.Collect, timings);
        snapshot.Env = Measure("env", _environment.Collect, timings);
        snapshot.System = Measure("system", _system.Collect, timings);
        _lastTimings = timings;

        if (string.IsNullOrWhiteSpace(snapshot.System.CpuModel))
            snapshot.System.CpuModel = snapshot.Cpu.Model;

        snapshot.Status = new StatusSnapshot
        {
            Admin = _diagnostics.IsAdministrator,
            ReadOnly = !_diagnostics.IsAdministrator,
            PawnIo = _diagnostics.PawnIoInstalled,
            PawnIoRunning = _diagnostics.PawnIoRunning,
            LhmAvailable = _session.Available,
            LhmError = _session.Error,
            ReadErrors = _safe.TakeTickErrors(),
            TotalReadErrors = _safe.TotalErrors,
            FanSource = snapshot.Fans.Count == 0 ? "none" : snapshot.Fans[0].Source ?? "lhm",
            WmiFanCount = _slow.WmiFans.Count,
            AcpiThermalZoneCount = _slow.ThermalZones.Count
        };
        snapshot.Status.SensorsMissing = FindMissing(snapshot);
        return snapshot;
    }

    private static T Measure<T>(string key, Func<T> collect, Dictionary<string, long> timings)
    {
        var start = Stopwatch.GetTimestamp();
        var result = collect();
        timings[key] = (long)Stopwatch.GetElapsedTime(start).TotalMilliseconds;
        return result;
    }

    private List<string> FindMissing(Snapshot snapshot)
    {
        var missing = new List<string>();
        var present = new HashSet<string>(StringComparer.Ordinal);

        void Check(string key, bool hasValue)
        {
            if (hasValue)
                present.Add(key);
            else
                missing.Add(key);
        }

        Check("lhm", snapshot.Status.LhmAvailable);
        Check("cpu.temp", snapshot.Cpu.TempPackage is not null);
        Check("cpu.power", snapshot.Cpu.PowerPackage is not null);
        Check("cpu.voltage", snapshot.Cpu.Voltage is not null);
        Check("cpu.freq", snapshot.Cpu.FreqMhz is not null);
        Check("cpu.freqEffective", snapshot.Cpu.FreqEffectiveMhz is not null);

        var hasGpu = snapshot.Gpus.Count > 0;
        Check("gpu", hasGpu);
        if (hasGpu)
        {
            Check("gpu.temp", snapshot.Gpus.Any(g => g.Temp is not null));
            Check("gpu.power", snapshot.Gpus.Any(g => g.PowerW is not null));
            Check("gpu.fan", snapshot.Gpus.Any(g => g.FanRpm is not null));
        }

        var hasFan = snapshot.Fans.Count > 0;
        Check("fan", hasFan);
        if (hasFan)
        {
            Check("fan.rpm", snapshot.Fans.Any(f => f.Rpm is not null));
            Check("fan.percent", snapshot.Fans.Any(f => f.Percent is not null));
        }

        Check("env.board", snapshot.Env.BoardTemp is not null);
        Check("env.chipset", snapshot.Env.ChipsetTemp is not null);
        Check("env.case", snapshot.Env.CaseTemp is not null);
        Check("env.vrm", snapshot.Env.VrmTemp is not null);

        var hasDisk = snapshot.Disks.Count > 0;
        Check("disk", hasDisk);
        if (hasDisk)
        {
            Check("disk.temp", snapshot.Disks.Any(d => d.Temperature is not null));
            Check("disk.health", snapshot.Disks.Any(d => d.HealthPercent is not null));
        }

        Check("battery", snapshot.Battery.Present);
        if (snapshot.Battery.Present)
            Check("battery.health", snapshot.Battery.HealthPercent is not null);

        Check("mem.speed", snapshot.Memory.SpeedMhz is not null);

        foreach (var key in present)
            _everSeen.Add(key);

        // 只有权限和 LHM 都正常时，“一直读不到”才等价于该机型不支持
        snapshot.Status.SensorsUnsupported = _buildCount > UnsupportedGraceBuilds
            && snapshot.Status.Admin
            && snapshot.Status.LhmAvailable
                ? missing.Where(key => !_everSeen.Contains(key)).Distinct().ToList()
                : new List<string>();

        return missing;
    }
}
