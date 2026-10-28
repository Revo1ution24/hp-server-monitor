using HpServerMonitor.DeviceReader.Models;
using HpServerMonitor.DeviceReader.Support;

namespace HpServerMonitor.DeviceReader.Collectors;

public sealed class MemoryCollector
{
    private readonly SlowInfoCache _slow;
    private readonly SafeLog _safe;

    public MemoryCollector(SlowInfoCache slow, SafeLog safe)
    {
        _slow = slow;
        _safe = safe;
    }

    public MemorySnapshot Collect()
    {
        var result = new MemorySnapshot();
        try
        {
            var memory = NativeMethods.GetMemoryStatus();
            if (memory.Ok)
            {
                result.TotalBytes = memory.TotalBytes;
                result.FreeBytes = memory.AvailableBytes;
                result.UsedBytes = Math.Max(0, memory.TotalBytes - memory.AvailableBytes);
                result.Load = memory.TotalBytes > 0
                    ? Math.Round((double)result.UsedBytes.Value / memory.TotalBytes * 100, 1)
                    : null;
            }

            var performance = NativeMethods.GetPerformanceStatus();
            if (performance.Ok)
            {
                result.CommitTotalBytes = performance.CommitTotalBytes;
                result.CommitLimitBytes = performance.CommitLimitBytes;
            }

            var modules = _slow.Memory;
            result.SpeedMhz = modules.SpeedMhz;
            result.SlotsUsed = modules.SlotsUsed;
            result.SlotCount = modules.SlotCount;
            result.ModuleType = modules.ModuleType;
            if (result.TotalBytes is null)
                result.TotalBytes = modules.TotalBytes;

            result.PageFileUsedBytes = _slow.PageFile.UsedBytes;
        }
        catch (Exception ex)
        {
            _safe.Error("memory-collect", ex, "内存采集失败");
        }

        return result;
    }
}
