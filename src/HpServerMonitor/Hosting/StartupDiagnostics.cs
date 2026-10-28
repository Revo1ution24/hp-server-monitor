using HpServerMonitor.Auth;
using HpServerMonitor.DeviceReader.Support;

namespace HpServerMonitor.Hosting;

/// <summary>启动时检测权限与传感器驱动环境，供 UI 做降级提示。</summary>
public sealed class StartupDiagnostics
{
    public bool IsAdministrator { get; }
    public bool PawnIoInstalled { get; }

    /// <summary>PawnIO 服务是否正在运行；null 表示已安装但无法查询服务状态。</summary>
    public bool? PawnIoRunning { get; }
    public string OsName { get; }
    public string Version { get; }

    public StartupDiagnostics()
    {
        IsAdministrator = CheckAdministrator();
        PawnIoInstalled = CheckPawnIo();
        PawnIoRunning = PawnIoInstalled ? NativeMethods.IsServiceRunning("PawnIO") : false;
        OsName = GetOsName(out var version);
        Version = version;
    }

    private static bool CheckAdministrator()
    {
        try
        {
            using var identity = System.Security.Principal.WindowsIdentity.GetCurrent();
            var principal = new System.Security.Principal.WindowsPrincipal(identity);
            return principal.IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
        }
        catch
        {
            return false;
        }
    }

    private static bool CheckPawnIo()
    {
        try
        {
            var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            var dir = Path.Combine(programFiles, "PawnIO");
            if (Directory.Exists(dir))
                return true;

            // 部分安装方式会把 DLL / 驱动放到 System32
            var system32 = Environment.GetFolderPath(Environment.SpecialFolder.System);
            if (File.Exists(Path.Combine(system32, "PawnIOLib.dll")))
                return true;
            if (File.Exists(Path.Combine(system32, "drivers", "PawnIO.sys")))
                return true;

            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(
                @"SYSTEM\CurrentControlSet\Services\PawnIO");
            return key is not null;
        }
        catch
        {
            return false;
        }
    }

    private static string GetOsName(out string version)
    {
        version = Environment.OSVersion.Version.ToString();
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(
                @"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
            var name = key?.GetValue("ProductName")?.ToString();
            var display = key?.GetValue("DisplayVersion")?.ToString();
            var build = key?.GetValue("CurrentBuildNumber")?.ToString();

            if (!string.IsNullOrWhiteSpace(build))
                version = $"{display ?? "Unknown"} (Build {build})";

            if (string.IsNullOrWhiteSpace(name))
                return "Windows";

            // Windows 11 的注册表 ProductName 仍可能是 Windows 10
            if (int.TryParse(build, out var buildNumber) && buildNumber >= 22000)
                name = name.Replace("Windows 10", "Windows 11", StringComparison.OrdinalIgnoreCase);

            return name;
        }
        catch
        {
            return "Windows";
        }
    }
}
