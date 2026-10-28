using System.Collections.Concurrent;

namespace HpServerMonitor.DeviceReader.Support;

/// <summary>
/// 传感器读取异常的统一收口：吞掉异常、计数，并按 key 限制日志频率，
/// 避免某个坏传感器每秒刷满日志。
/// </summary>
public sealed class SafeLog
{
    private readonly ILogger<SafeLog> _logger;
    private readonly ConcurrentDictionary<string, long> _lastWarn = new(StringComparer.Ordinal);
    private int _tickErrors;
    private long _totalErrors;

    public SafeLog(ILogger<SafeLog> logger)
    {
        _logger = logger;
    }

    public long TotalErrors => Interlocked.Read(ref _totalErrors);

    public void Error(string key, Exception ex, string message)
    {
        Interlocked.Increment(ref _tickErrors);
        Interlocked.Increment(ref _totalErrors);
        Warn(key, $"{message}：{ex.GetType().Name}: {ex.Message}");
    }

    public void Warn(string key, string message)
    {
        var now = Environment.TickCount64;
        if (_lastWarn.TryGetValue(key, out var last) && now - last < 60_000)
            return;

        _lastWarn[key] = now;
        _logger.LogWarning("{Key}: {Message}", key, message);
    }

    /// <summary>采样循环每 tick 调用一次，返回本 tick 的异常数。</summary>
    public int TakeTickErrors() => Interlocked.Exchange(ref _tickErrors, 0);
}
