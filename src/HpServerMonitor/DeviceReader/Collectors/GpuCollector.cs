using HpServerMonitor.DeviceReader.Models;
using HpServerMonitor.DeviceReader.Support;
using LibreHardwareMonitor.Hardware;

namespace HpServerMonitor.DeviceReader.Collectors;

public sealed class GpuCollector
{
    private readonly HardwareSession _session;
    private readonly SafeLog _safe;

    public GpuCollector(HardwareSession session, SafeLog safe)
    {
        _session = session;
        _safe = safe;
    }

    public List<GpuSnapshot> Collect()
    {
        var result = new List<GpuSnapshot>();
        try
        {
            var gpus = _session.AllHardware()
                .Where(h => h.HardwareType is HardwareType.GpuNvidia
                    or HardwareType.GpuAmd
                    or HardwareType.GpuIntel)
                .GroupBy(h => h.Identifier.ToString())
                .Select(g => g.First());

            foreach (var gpu in gpus)
            {
                try
                {
                    var item = new GpuSnapshot
                    {
                        Name = gpu.Name,
                        Vendor = SensorQuery.VendorName(gpu.HardwareType),
                        Load = SensorQuery.Percent(SensorQuery.Value(gpu, SensorType.Load, "GPU Core"))
                               ?? SensorQuery.Percent(SensorQuery.Value(gpu, SensorType.Load, "D3D 3D")),
                        Temp = SensorQuery.Temperature(SensorQuery.Value(gpu, SensorType.Temperature,
                            "GPU Core", "GPU Memory Junction", "GPU Hot Spot")),
                        ClockMhz = SensorQuery.Positive(SensorQuery.Value(gpu, SensorType.Clock, "GPU Core")),
                        PowerW = SensorQuery.NonNegative(SensorQuery.Value(gpu, SensorType.Power,
                            "GPU Package", "GPU Power", "GPU Core"))
                    };

                    item.MemUsedBytes = SensorQuery.MegabytesToBytes(
                        SensorQuery.Value(gpu, SensorType.SmallData, "GPU Memory Used"))
                        ?? SensorQuery.MegabytesToBytes(
                            SensorQuery.Value(gpu, SensorType.SmallData, "D3D Dedicated Memory Used"));
                    item.MemTotalBytes = SensorQuery.MegabytesToBytes(
                        SensorQuery.Value(gpu, SensorType.SmallData, "GPU Memory Total"))
                        ?? SensorQuery.MegabytesToBytes(
                            SensorQuery.Value(gpu, SensorType.SmallData, "D3D Dedicated Memory Total"));

                    item.FanRpm = SensorQuery.NonNegative(
                        SensorQuery.Value(gpu, SensorType.Fan, "GPU Fan", "Fan")
                        ?? SensorQuery.ValueContains(gpu, SensorType.Fan, "Fan"));

                    result.Add(item);
                }
                catch (Exception ex)
                {
                    _safe.Error($"gpu-{gpu.Identifier}", ex, $"GPU {gpu.Name} 采集失败");
                }
            }
        }
        catch (Exception ex)
        {
            _safe.Error("gpu-collect", ex, "GPU 采集失败");
        }

        // 独显通常在列在最前，避免核显抢走总览/历史的第一条 GPU 数据
        result.Sort((a, b) => (b.MemTotalBytes ?? 0).CompareTo(a.MemTotalBytes ?? 0));
        return result;
    }
}
