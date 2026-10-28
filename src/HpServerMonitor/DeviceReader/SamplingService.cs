using System.Diagnostics;
using System.Text;
using System.Text.Json;
using HpServerMonitor.Api;
using HpServerMonitor.DeviceReader.Support;
using HpServerMonitor.Hosting;

namespace HpServerMonitor.DeviceReader;

/// <summary>
/// 1Hz 采样主循环：更新 LHM、生成快照、写入历史、序列化一次并广播。
/// 采集异常只影响当前 tick，不会让后台服务退出。
/// </summary>
public sealed class SamplingService : BackgroundService
{
    private static readonly byte[] EnvelopePrefix = Encoding.UTF8.GetBytes("{\"type\":\"snapshot\",\"data\":");
    private static readonly byte[] EnvelopeSuffix = Encoding.UTF8.GetBytes("}");

    private readonly AppConfig _config;
    private readonly HardwareSession _session;
    private readonly SnapshotFactory _factory;
    private readonly SnapshotStore _store;
    private readonly HistoryStore _history;
    private readonly RealtimeHub _hub;
    private readonly ILogger<SamplingService> _logger;
    private long _lastSlowLog;

    public SamplingService(
        AppConfig config,
        HardwareSession session,
        SnapshotFactory factory,
        SnapshotStore store,
        HistoryStore history,
        RealtimeHub hub,
        ILogger<SamplingService> logger)
    {
        _config = config;
        _session = session;
        _factory = factory;
        _store = store;
        _history = history;
        _hub = hub;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Yield();

        var interval = TimeSpan.FromMilliseconds(_config.Sampling.IntervalMs);
        var storageEvery = Math.Max(1,
            (int)Math.Round((double)_config.Sampling.StorageIntervalMs / _config.Sampling.IntervalMs));

        using var timer = new PeriodicTimer(interval);
        var stopwatch = new Stopwatch();
        long sequence = 0;
        var tick = 0;

        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                tick++;
                stopwatch.Restart();

                try
                {
                    var updateStart = Stopwatch.GetTimestamp();
                    _session.EnsureOpen();
                    _session.Update(
                        includeStorage: tick == 1 || tick % storageEvery == 0,
                        includeGpu: tick == 1 || tick % 2 == 0);
                    var updateMs = (long)Stopwatch.GetElapsedTime(updateStart).TotalMilliseconds;

                    var snapshot = _factory.Build(++sequence);
                    var sensorMs = stopwatch.ElapsedMilliseconds;
                    snapshot.Status.SamplingMs = sensorMs;
                    snapshot.Status.Clients = _hub.ClientCount;

                    var json = JsonSerializer.SerializeToUtf8Bytes(snapshot, JsonDefaults.Api);
                    _history.Add(snapshot);
                    _store.Publish(snapshot, json);
                    _hub.Broadcast(BuildEnvelope(json));

                    var elapsed = stopwatch.ElapsedMilliseconds;
                    if (elapsed > 500 && Environment.TickCount64 - _lastSlowLog > 60_000)
                    {
                        _lastSlowLog = Environment.TickCount64;
                        _logger.LogWarning("采样耗时偏高：传感器 {SensorMs} ms / 总计 {Elapsed} ms；{Detail}",
                            sensorMs, elapsed, DescribeTimings(updateMs));
                    }
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "采样 tick 异常，服务继续运行");
                    try { await Task.Delay(1000, stoppingToken); }
                    catch (OperationCanceledException) { break; }
                }
            }
        }
        catch (OperationCanceledException)
        {
            // 正常停止
        }
    }

    private string DescribeTimings(long updateMs)
    {
        var parts = new List<string> { $"lhm-update {updateMs}ms" };
        parts.AddRange(_factory.LastTimings
            .OrderByDescending(pair => pair.Value)
            .Take(3)
            .Select(pair => $"{pair.Key} {pair.Value}ms"));
        return string.Join("，", parts);
    }

    private static byte[] BuildEnvelope(byte[] json)
    {
        var message = new byte[EnvelopePrefix.Length + json.Length + EnvelopeSuffix.Length];
        Buffer.BlockCopy(EnvelopePrefix, 0, message, 0, EnvelopePrefix.Length);
        Buffer.BlockCopy(json, 0, message, EnvelopePrefix.Length, json.Length);
        Buffer.BlockCopy(EnvelopeSuffix, 0, message, EnvelopePrefix.Length + json.Length, EnvelopeSuffix.Length);
        return message;
    }
}
