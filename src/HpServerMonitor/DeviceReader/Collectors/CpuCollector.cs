using HpServerMonitor.DeviceReader.Models;
using HpServerMonitor.DeviceReader.Support;
using LibreHardwareMonitor.Hardware;

namespace HpServerMonitor.DeviceReader.Collectors;

public sealed class CpuCollector
{
    private readonly HardwareSession _session;
    private readonly SlowInfoCache _slow;
    private readonly SafeLog _safe;
    private readonly PdhCpuMeter _pdh;
    private double? _minFreq;
    private double? _maxFreq;

    public CpuCollector(HardwareSession session, SlowInfoCache slow, SafeLog safe, PdhCpuMeter pdh)
    {
        _session = session;
        _slow = slow;
        _safe = safe;
        _pdh = pdh;
    }

    public CpuSnapshot Collect()
    {
        var result = new CpuSnapshot();
        try
        {
            var staticInfo = _slow.Cpu;
            result.Model = staticInfo.Name;
            result.PhysicalCores = staticInfo.PhysicalCores;
            result.LogicalCores = staticInfo.LogicalCores ?? Environment.ProcessorCount;

            var perf = NativeMethods.GetPerformanceStatus();
            if (perf.Ok)
            {
                result.ProcessCount = perf.ProcessCount;
                result.ThreadCount = perf.ThreadCount;
            }

            // 独立于 LHM 的 Windows 计数器：即使 LHM 不可用也能给出有效占用
            result.LoadUtility = _pdh.Read();

            var cpu = _session.Find(HardwareType.Cpu);
            if (cpu is null)
                return result;

            result.Model = string.IsNullOrWhiteSpace(cpu.Name) ? result.Model : cpu.Name;

            var coreLoadSensors = SensorQuery.OfType(cpu, SensorType.Load)
                .Where(s => SensorQuery.CoreNumber(s.Name) > 0)
                .GroupBy(s => SensorQuery.CoreNumber(s.Name))
                .Select(g => (Index: g.Key, Sensor: g.First()))
                .OrderBy(x => x.Index)
                .ToArray();

            foreach (var item in coreLoadSensors)
            {
                result.CoreLoads.Add(new CoreValue
                {
                    Index = item.Index,
                    Value = SensorQuery.Percent(SensorQuery.ValueOf(item.Sensor))
                });
            }

            var totalLoad = SensorQuery.Value(cpu, SensorType.Load, "CPU Total");
            result.Load = SensorQuery.Percent(totalLoad) ??
                           (coreLoadSensors.Length > 0
                               ? coreLoadSensors.Average(x => SensorQuery.Percent(SensorQuery.ValueOf(x.Sensor)) ?? 0)
                               : null);

            var clockSensors = SensorQuery.OfType(cpu, SensorType.Clock)
                .Where(s => SensorQuery.CoreNumber(s.Name) > 0)
                .ToArray();

            var averageClock = SensorQuery.Value(cpu, SensorType.Clock, "Cores (Average)")
                               ?? SensorQuery.Average(clockSensors);
            var effectiveClock = SensorQuery.Value(cpu, SensorType.Clock, "Cores (Average Effective)")
                                 ?? SensorQuery.ValueContains(cpu, SensorType.Clock, "Average Effective");
            var busClock = SensorQuery.Value(cpu, SensorType.Clock, "Bus Speed");

            var currentFreq = averageClock is > 0 ? averageClock : effectiveClock;
            result.FreqMhz = SensorQuery.Positive(currentFreq);
            result.FreqEffectiveMhz = SensorQuery.Positive(effectiveClock);
            result.BusClockMhz = SensorQuery.Positive(busClock);

            if (currentFreq is > 0)
            {
                _minFreq = _minFreq is null ? currentFreq : Math.Min(_minFreq.Value, currentFreq.Value);
                _maxFreq = _maxFreq is null ? currentFreq : Math.Max(_maxFreq.Value, currentFreq.Value);
            }
            result.FreqMinMhz = _minFreq;
            result.FreqMaxMhz = _maxFreq;

            var bus = busClock is > 0 ? busClock.Value : 100f;
            var multiplierBase = effectiveClock is > 0 ? effectiveClock : currentFreq;
            if (multiplierBase is > 0 && bus > 0)
                result.Multiplier = Math.Round(multiplierBase.Value / bus, 1);

            var packageTemp = SensorQuery.Temperature(
                SensorQuery.Value(cpu, SensorType.Temperature,
                    "CPU Package", "Core (Tctl/Tdie)", "Core Max", "CPU Core", "Package"));

            var coreTemps = SensorQuery.OfType(cpu, SensorType.Temperature)
                .Where(s => SensorQuery.CoreNumber(s.Name) > 0)
                .GroupBy(s => SensorQuery.CoreNumber(s.Name))
                .Select(g => (Index: g.Key, Sensor: g.First()))
                .OrderBy(x => x.Index)
                .ToArray();

            foreach (var item in coreTemps)
            {
                result.TempCores.Add(new CoreValue
                {
                    Index = item.Index,
                    Value = SensorQuery.Temperature(SensorQuery.ValueOf(item.Sensor))
                });
            }

            result.TempPackage = packageTemp ?? result.TempCores
                .Select(c => c.Value)
                .Where(v => v is not null)
                .Select(v => v!.Value)
                .DefaultIfEmpty(0)
                .Max();

            if (result.TempPackage is <= 0)
                result.TempPackage = null;

            result.TempMax = coreTemps
                .Select(x => SensorQuery.Temperature(SensorQuery.ValueOf(x.Sensor)))
                .Where(v => v is not null)
                .Select(v => v!.Value)
                .DefaultIfEmpty(packageTemp ?? 0)
                .Max();
            if (result.TempMax is <= 0)
                result.TempMax = null;

            var packagePower = SensorQuery.Value(cpu, SensorType.Power,
                "CPU Package", "Package", "Package Power");
            result.PowerPackage = packagePower is > 0 ? packagePower : null;

            var voltage = SensorQuery.Value(cpu, SensorType.Voltage,
                "CPU Core Voltage", "CPU VCore", "Vcore");
            if (voltage is null)
            {
                voltage = SensorQuery.Average(SensorQuery.OfType(cpu, SensorType.Voltage)
                    .Where(s => s.Name.Contains("VID", StringComparison.OrdinalIgnoreCase)));
            }
            result.Voltage = SensorQuery.Positive(voltage);
        }
        catch (Exception ex)
        {
            _safe.Error("cpu-collect", ex, "CPU 采集失败");
        }

        return result;
    }
}
