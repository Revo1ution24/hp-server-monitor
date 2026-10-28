using System.Collections.Concurrent;
using System.Globalization;

namespace HpServerMonitor.Hosting;

/// <summary>登录失败限流：同一 IP 在时间窗口内最多 N 次失败。</summary>
public sealed class LoginRateLimiter
{
    private sealed class Entry
    {
        public readonly Queue<long> Failures = new();
    }

    private readonly ConcurrentDictionary<string, Entry> _entries = new(StringComparer.Ordinal);
    private readonly int _maxAttempts;
    private readonly TimeSpan _window;

    public LoginRateLimiter(AppConfig config)
    {
        _maxAttempts = config.Security.LoginMaxAttempts;
        _window = TimeSpan.FromSeconds(config.Security.LoginWindowSeconds);
    }

    /// <summary>请求是否已被限流；被限流时返回需要等待的秒数。</summary>
    public bool IsBlocked(string ip, out int retryAfterSeconds)
    {
        retryAfterSeconds = 0;
        if (!_entries.TryGetValue(ip, out var entry))
            return false;

        lock (entry)
        {
            Prune(entry);
            if (entry.Failures.Count < _maxAttempts)
                return false;

            var oldest = entry.Failures.Peek();
            var remaining = _window - TimeSpan.FromMilliseconds(Environment.TickCount64 - oldest);
            retryAfterSeconds = Math.Max(1, (int)Math.Ceiling(remaining.TotalSeconds));
            return true;
        }
    }

    public void RecordFailure(string ip)
    {
        var entry = _entries.GetOrAdd(ip, _ => new Entry());
        lock (entry)
        {
            Prune(entry);
            entry.Failures.Enqueue(Environment.TickCount64);
        }
    }

    public void Reset(string ip)
        => _entries.TryRemove(ip, out _);

    public void Cleanup()
    {
        foreach (var pair in _entries)
        {
            lock (pair.Value)
            {
                Prune(pair.Value);
                if (pair.Value.Failures.Count == 0)
                    _entries.TryRemove(pair.Key, out _);
            }
        }
    }

    private void Prune(Entry entry)
    {
        var cutoff = Environment.TickCount64 - (long)_window.TotalMilliseconds;
        while (entry.Failures.Count > 0 && entry.Failures.Peek() < cutoff)
            entry.Failures.Dequeue();
    }

    public string Describe()
        => string.Create(CultureInfo.InvariantCulture, $"{_maxAttempts} 次 / {_window.TotalSeconds:0} 秒");
}
