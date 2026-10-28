using HpServerMonitor.DeviceReader.Models;

namespace HpServerMonitor.DeviceReader;

/// <summary>保存最近一份快照与其预序列化 JSON，API 读取时零拷贝、零采样锁。</summary>
public sealed class SnapshotStore
{
    private Snapshot? _current;
    private byte[] _json = Array.Empty<byte>();
    private long _lastTickTicks;

    public Snapshot? Current => Volatile.Read(ref _current);
    public byte[] Json => Volatile.Read(ref _json);
    public bool HasData => Json.Length > 0;

    public DateTimeOffset? LastTickUtc
    {
        get
        {
            var ticks = Volatile.Read(ref _lastTickTicks);
            return ticks == 0 ? null : new DateTimeOffset(ticks, TimeSpan.Zero);
        }
    }

    public void Publish(Snapshot snapshot, byte[] json)
    {
        Volatile.Write(ref _json, json);
        Volatile.Write(ref _current, snapshot);
        Volatile.Write(ref _lastTickTicks, DateTimeOffset.UtcNow.UtcTicks);
    }

    public bool IsFresh(TimeSpan maxAge)
        => LastTickUtc is { } last && DateTimeOffset.UtcNow - last <= maxAge;
}
