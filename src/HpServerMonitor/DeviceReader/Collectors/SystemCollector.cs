using System.Reflection;
using System.Runtime.InteropServices;
using HpServerMonitor.DeviceReader.Models;
using HpServerMonitor.DeviceReader.Support;
using HpServerMonitor.Hosting;

namespace HpServerMonitor.DeviceReader.Collectors;

public sealed class SystemCollector
{
    private readonly SlowInfoCache _slow;
    private readonly StartupDiagnostics _diagnostics;
    private readonly SafeLog _safe;
    private readonly string _version;

    public SystemCollector(SlowInfoCache slow, StartupDiagnostics diagnostics, SafeLog safe)
    {
        _slow = slow;
        _diagnostics = diagnostics;
        _safe = safe;
        _version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.0.0";
    }

    public SystemSnapshot Collect()
    {
        var result = new SystemSnapshot
        {
            Hostname = Environment.MachineName,
            OsName = _slow.Os.ProductName ?? _diagnostics.OsName,
            OsVersion = BuildOsVersion(),
            AppVersion = _version
        };

        try
        {
            var uptime = Environment.TickCount64 / 1000d;
            result.UptimeSeconds = uptime;
            result.BootTime = DateTimeOffset.Now.AddSeconds(-uptime);
        }
        catch (Exception ex)
        {
            _safe.Warn("uptime", $"开机时长读取失败：{ex.Message}");
        }

        try
        {
            var cpu = _slow.Cpu.Name;
            if (!string.IsNullOrWhiteSpace(cpu))
                result.CpuModel = cpu;

            var board = _slow.Board;
            var boardText = string.Join(" ", new[] { board.Manufacturer, board.Product }
                .Where(s => !string.IsNullOrWhiteSpace(s)));
            if (!string.IsNullOrWhiteSpace(boardText))
                result.Board = boardText;
            if (!string.IsNullOrWhiteSpace(board.BiosVersion))
                result.Bios = board.BiosVersion;
        }
        catch (Exception ex)
        {
            _safe.Warn("system-static", $"系统信息读取失败：{ex.Message}");
        }

        if (string.IsNullOrWhiteSpace(result.OsVersion))
            result.OsVersion = RuntimeInformation.OSDescription;

        return result;
    }

    private string BuildOsVersion()
    {
        var os = _slow.Os;
        if (!string.IsNullOrWhiteSpace(os.DisplayVersion) && !string.IsNullOrWhiteSpace(os.Build))
            return $"{os.DisplayVersion} (Build {os.Build})";
        if (!string.IsNullOrWhiteSpace(os.Build))
            return $"Build {os.Build}";
        return RuntimeInformation.OSDescription;
    }
}
