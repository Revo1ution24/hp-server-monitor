using HpServerMonitor.DeviceReader.Models;
using HpServerMonitor.Hosting;

namespace HpServerMonitor.DeviceReader.Support;

public sealed record HistoryPoint(long T, double? V);

public sealed class HistoryResult
{
    public string Metric { get; set; } = "";
    public string Range { get; set; } = "1h";
    public int IntervalMs { get; set; } = 1000;
    public List<HistoryPoint> Points { get; set; } = new();
}

/// <summary>
/// 纯内存环形缓冲：每个指标保留最近 N 个点（默认 3600），不落库。
/// 缺失值也写入 null，前端折线会出现自然断点。
/// </summary>
public sealed class HistoryStore
{
    public static readonly string[] SupportedMetrics =
    {
        "cpu.load", "cpu.utility", "cpu.temp", "cpu.power", "cpu.freq",
        "mem.percent", "mem.used",
        "gpu.load", "gpu.temp", "gpu.memUsed",
        "net.up", "net.down",
        "disk.read", "disk.write",
        "battery.level", "fan.max"
    };

    private readonly Dictionary<string, Ring> _rings;
    private readonly int _intervalMs;

    /// <summary>最多为多少块显卡保留独立历史（GPU 页切换显卡时使用）。</summary>
    public const int GpuHistorySlots = 4;

    public HistoryStore(AppConfig config)
    {
        _intervalMs = config.Sampling.IntervalMs;
        var capacity = config.Sampling.HistoryPoints;
        _rings = SupportedMetrics.ToDictionary(m => m, _ => new Ring(capacity), StringComparer.OrdinalIgnoreCase);

        // 预建每块显卡的历史环，避免 API 并发查询时动态写字典
        for (var i = 0; i < GpuHistorySlots; i++)
        {
            foreach (var suffix in new[] { "load", "temp", "memUsed" })
                _rings[$"gpu.{i}.{suffix}"] = new Ring(capacity);
        }
    }

    public void Add(Snapshot snapshot)
    {
        var t = snapshot.Ts.ToUnixTimeMilliseconds();
        var gpu = snapshot.Gpus.FirstOrDefault();

        Add("cpu.load", t, snapshot.Cpu.Load);
        Add("cpu.utility", t, snapshot.Cpu.LoadUtility);
        Add("cpu.temp", t, snapshot.Cpu.TempPackage);
        Add("cpu.power", t, snapshot.Cpu.PowerPackage);
        Add("cpu.freq", t, snapshot.Cpu.FreqMhz);
        Add("mem.percent", t, snapshot.Memory.Load);
        Add("mem.used", t, snapshot.Memory.UsedBytes);
        Add("gpu.load", t, gpu?.Load);
        Add("gpu.temp", t, gpu?.Temp);
        Add("gpu.memUsed", t, gpu?.MemUsedBytes);

        // 按显卡索引单独记录，供 GPU 页切换显卡后取各自曲线
        for (var i = 0; i < Math.Min(snapshot.Gpus.Count, GpuHistorySlots); i++)
        {
            var item = snapshot.Gpus[i];
            Add($"gpu.{i}.load", t, item.Load);
            Add($"gpu.{i}.temp", t, item.Temp);
            Add($"gpu.{i}.memUsed", t, item.MemUsedBytes);
        }
        Add("net.up", t, snapshot.Network.UploadBytesPerSec);
        Add("net.down", t, snapshot.Network.DownloadBytesPerSec);
        Add("disk.read", t, Sum(snapshot.Disks.Select(d => d.ReadBytesPerSec)));
        Add("disk.write", t, Sum(snapshot.Disks.Select(d => d.WriteBytesPerSec)));
        Add("battery.level", t, snapshot.Battery.ChargePercent);

        var maxRpm = snapshot.Fans
            .Select(f => f.Rpm)
            .Where(v => v is not null)
            .DefaultIfEmpty(null)
            .Max();
        Add("fan.max", t, maxRpm);
    }

    public HistoryResult? Query(string metric, string range, out string? error)
    {
        error = null;
        if (!_rings.TryGetValue(metric, out var ring))
        {
            error = $"不支持的指标：{metric}";
            return null;
        }

        var parsed = ParseRange(range);
        if (parsed is null)
        {
            error = "range 只支持 5m、15m、1h";
            return null;
        }

        // 按实际采样间隔换算点数；默认 1 秒时正好是 300/900/3600 点
        var points = Math.Max(1, (int)Math.Round(parsed.Value.Seconds * 1000d / _intervalMs));
        return new HistoryResult
        {
            Metric = metric,
            Range = parsed.Value.Range,
            IntervalMs = _intervalMs,
            Points = ring.Last(points)
        };
    }

    private void Add(string metric, long ts, double? value)
    {
        if (_rings.TryGetValue(metric, out var ring))
            ring.Add(ts, value);
    }

    private static double? Sum(IEnumerable<double?> values)
    {
        double total = 0;
        var any = false;
        foreach (var value in values)
        {
            if (value is null)
                continue;
            total += value.Value;
            any = true;
        }
        return any ? total : null;
    }

    public static (string Range, int Seconds)? ParseRange(string? range) => range?.Trim().ToLowerInvariant() switch
    {
        null or "" or "1h" => ("1h", 3600),
        "5m" => ("5m", 300),
        "15m" => ("15m", 900),
        _ => null
    };

    private sealed class Ring
    {
        private readonly long[] _timestamps;
        private readonly double[] _values;
        private readonly bool[] _hasValue;
        private readonly object _gate = new();
        private int _start;
        private int _count;

        public Ring(int capacity)
        {
            capacity = Math.Max(1, capacity);
            _timestamps = new long[capacity];
            _values = new double[capacity];
            _hasValue = new bool[capacity];
        }

        public void Add(long ts, double? value)
        {
            lock (_gate)
            {
                int position;
                if (_count < _timestamps.Length)
                {
                    position = (_start + _count) % _timestamps.Length;
                    _count++;
                }
                else
                {
                    position = _start;
                    _start = (_start + 1) % _timestamps.Length;
                }

                _timestamps[position] = ts;
                _hasValue[position] = value is not null;
                _values[position] = value ?? 0;
            }
        }

        public List<HistoryPoint> Last(int points)
        {
            lock (_gate)
            {
                var count = Math.Min(Math.Max(0, points), _count);
                var result = new List<HistoryPoint>(count);
                var offset = _count - count;
                for (var i = 0; i < count; i++)
                {
                    var index = (_start + offset + i) % _timestamps.Length;
                    result.Add(new HistoryPoint(
                        _timestamps[index],
                        _hasValue[index] ? _values[index] : null));
                }
                return result;
            }
        }
    }
}
