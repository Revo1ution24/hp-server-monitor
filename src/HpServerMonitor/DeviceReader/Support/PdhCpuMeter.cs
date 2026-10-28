using System.Runtime.InteropServices;

namespace HpServerMonitor.DeviceReader.Support;

/// <summary>
/// 通过 PDH 读取 \Processor Information(_Total)\% Processor Utility。
/// 这是任务管理器使用的口径（按当前频率折算，可能超过 100%）；
/// 与 LHM 的 % Processor Time（时间占用）不是同一个指标。
/// 计数器不可用时返回 null，并只告警一次，避免每秒刷日志。
/// </summary>
public sealed class PdhCpuMeter : IDisposable
{
    private const string CounterPath = @"\Processor Information(_Total)\% Processor Utility";
    private const uint PdhFmtDouble = 0x00000200;
    private const uint PdhFmtNoCap100 = 0x00008000;
    private const uint Format = PdhFmtDouble | PdhFmtNoCap100;
    private const long RetryIntervalMs = 60_000;

    [StructLayout(LayoutKind.Sequential)]
    private struct PdhFmtCounterValue
    {
        public uint CStatus;
        public double DoubleValue;
    }

    private readonly ILogger<PdhCpuMeter> _logger;
    private readonly object _gate = new();
    private IntPtr _query;
    private IntPtr _counter;
    private long _lastOpenAttempt;
    private int _formatFailures;
    private bool _warningLogged;

    public PdhCpuMeter(ILogger<PdhCpuMeter> logger)
    {
        _logger = logger;
    }

    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    private static extern uint PdhOpenQueryW(string? dataSource, IntPtr userData, out IntPtr query);

    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    private static extern uint PdhAddEnglishCounterW(IntPtr query, string counterPath, IntPtr userData, out IntPtr counter);

    [DllImport("pdh.dll")]
    private static extern uint PdhCollectQueryData(IntPtr query);

    [DllImport("pdh.dll")]
    private static extern uint PdhGetFormattedCounterValue(IntPtr counter, uint format, IntPtr type,
        out PdhFmtCounterValue value);

    [DllImport("pdh.dll")]
    private static extern uint PdhCloseQuery(IntPtr query);

    public double? Read()
    {
        lock (_gate)
        {
            if (_query == IntPtr.Zero && !TryOpen())
                return null;

            var collectStatus = PdhCollectQueryData(_query);
            if (collectStatus != 0)
            {
                WarnOnce($"PDH 采集失败（0x{collectStatus:X8}），将重建查询；本次有效占用不可用");
                Close();
                return null;
            }

            // 第一次采集只有基线，PDH 会返回无效数据；下一次 tick 起才有值
            var status = PdhGetFormattedCounterValue(_counter, Format, IntPtr.Zero, out var value);
            if (status != 0 || value.CStatus > 1)
            {
                _formatFailures++;
                if (_formatFailures > 1)
                {
                    WarnOnce(
                        $"PDH 读取 % Processor Utility 失败（PdhGet=0x{status:X8}，CStatus=0x{value.CStatus:X8}）；有效占用将显示为不可用");
                }

                return null;
            }

            _formatFailures = 0;

            var load = value.DoubleValue;
            if (!double.IsFinite(load) || load < 0)
                return null;

            // 有效占用可以超过 100%，只做一个离谱值保护
            return Math.Min(load, 400);
        }
    }

    private bool TryOpen()
    {
        var now = Environment.TickCount64;
        if (_lastOpenAttempt != 0 && now - _lastOpenAttempt < RetryIntervalMs)
            return false;
        _lastOpenAttempt = now;

        var openStatus = PdhOpenQueryW(null, IntPtr.Zero, out var query);
        if (openStatus != 0)
        {
            WarnOnce($"PDH 打开查询失败（0x{openStatus:X8}）；有效占用将显示为不可用");
            return false;
        }

        var addStatus = PdhAddEnglishCounterW(query, CounterPath, IntPtr.Zero, out var counter);
        if (addStatus != 0)
        {
            PdhCloseQuery(query);
            WarnOnce($"PDH 计数器不可用（0x{addStatus:X8}）：{CounterPath}");
            return false;
        }

        _query = query;
        _counter = counter;
        return true;
    }

    private void WarnOnce(string message)
    {
        if (_warningLogged)
            return;
        _warningLogged = true;
        _logger.LogWarning("{Message}", message);
    }

    private void Close()
    {
        if (_query != IntPtr.Zero)
        {
            try { PdhCloseQuery(_query); } catch { }
        }

        _query = IntPtr.Zero;
        _counter = IntPtr.Zero;
    }

    public void Dispose()
    {
        lock (_gate)
            Close();
    }
}
