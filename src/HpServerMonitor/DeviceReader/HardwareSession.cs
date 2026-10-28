using HpServerMonitor.DeviceReader.Support;
using LibreHardwareMonitor.Hardware;

namespace HpServerMonitor.DeviceReader;

/// <summary>
/// LibreHardwareMonitor 的唯一访问点。LHM 不是线程安全的，
/// 因此所有 Update/读取都必须在采样线程内完成。
/// </summary>
public sealed class HardwareSession : IDisposable
{
    private readonly ILogger<HardwareSession> _logger;
    private readonly SafeLog _safe;
    private readonly object _gate = new();
    private Computer? _computer;
    private long _lastOpenAttempt;

    public bool Available { get; private set; }
    public string? Error { get; private set; }
    public DateTimeOffset? LastOpenAt { get; private set; }

    public HardwareSession(ILogger<HardwareSession> logger, SafeLog safe)
    {
        _logger = logger;
        _safe = safe;
    }

    public void EnsureOpen()
    {
        lock (_gate)
        {
            if (_computer is not null && Available)
                return;

            var now = Environment.TickCount64;
            if (_lastOpenAttempt != 0 && now - _lastOpenAttempt < 60_000)
                return;
            _lastOpenAttempt = now;

            Computer? computer = null;
            try
            {
                computer = new Computer
                {
                    IsCpuEnabled = true,
                    IsGpuEnabled = true,
                    IsMemoryEnabled = true,
                    IsMotherboardEnabled = true,
                    IsControllerEnabled = true,
                    IsNetworkEnabled = true,
                    IsStorageEnabled = true,
                    IsBatteryEnabled = true,
                    IsPsuEnabled = false,
                    IsPowerMonitorEnabled = false
                };
                computer.Open();

                _computer = computer;
                Available = true;
                Error = null;
                LastOpenAt = DateTimeOffset.Now;
                _logger.LogInformation("LibreHardwareMonitor 已打开，检测到 {Count} 个硬件", computer.Hardware.Count);
            }
            catch (Exception ex)
            {
                Available = false;
                Error = $"{ex.GetType().Name}: {ex.Message}";
                _logger.LogWarning(ex, "LibreHardwareMonitor 打开失败；将以只读降级模式继续运行");
                try { computer?.Close(); } catch { }
                _computer = null;
            }
        }
    }

    /// <summary>
    /// 分级更新：CPU/主板/内存/网络每 tick 更新；GPU 默认隔一个 tick（部分独显
    /// 单次更新要几十毫秒）；存储 SMART 更新更慢，由调用方按 5 秒节奏控制。
    /// </summary>
    public void Update(bool includeStorage, bool includeGpu)
    {
        var computer = _computer;
        if (computer is null || !Available)
            return;

        IHardware[] hardware;
        try
        {
            hardware = computer.Hardware.ToArray();
        }
        catch (Exception ex)
        {
            _safe.Error("lhm-root", ex, "枚举硬件失败");
            return;
        }

        foreach (var item in hardware)
        {
            if (item.HardwareType == HardwareType.Storage && !includeStorage)
                continue;
            if (!includeGpu && item.HardwareType is HardwareType.GpuNvidia
                or HardwareType.GpuAmd or HardwareType.GpuIntel)
                continue;
            UpdateRecursive(item);
        }
    }

    private void UpdateRecursive(IHardware hardware)
    {
        try
        {
            hardware.Update();
        }
        catch (Exception ex)
        {
            _safe.Error($"lhm-{hardware.Identifier}", ex, $"更新 {hardware.Name} 失败");
        }

        foreach (var sub in hardware.SubHardware)
            UpdateRecursive(sub);
    }

    public IEnumerable<IHardware> AllHardware()
    {
        var computer = _computer;
        if (computer is null)
            yield break;

        IHardware[] top;
        try { top = computer.Hardware.ToArray(); }
        catch { yield break; }

        foreach (var hardware in top)
        {
            foreach (var item in Walk(hardware))
                yield return item;
        }
    }

    private static IEnumerable<IHardware> Walk(IHardware hardware)
    {
        yield return hardware;
        foreach (var sub in hardware.SubHardware)
        {
            foreach (var item in Walk(sub))
                yield return item;
        }
    }

    public IHardware? Find(HardwareType type)
    {
        try
        {
            return AllHardware().FirstOrDefault(h => h.HardwareType == type);
        }
        catch
        {
            return null;
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            try { _computer?.Close(); } catch { }
            _computer = null;
            Available = false;
        }
    }
}
