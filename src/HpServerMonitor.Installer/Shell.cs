using System.Diagnostics;
using System.Text;

namespace HpServerMonitor.Installer;

/// <summary>启动外部进程（PowerShell / sc / taskkill）并收集输出。</summary>
internal static class Shell
{
    public static (int Code, string Output) Run(string fileName, params string[] args)
    {
        var psi = new ProcessStartInfo(fileName)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };

        foreach (var arg in args)
            psi.ArgumentList.Add(arg);

        using var process = new Process { StartInfo = psi };
        process.Start();

        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        process.WaitForExit();

        return (process.ExitCode, stdout.Result + stderr.Result);
    }

    public static (int Code, string Output) RunPowerShell(string command)
        => Run("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
            "-Command", "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " + command);

    public static bool ServiceExists() => Run("sc.exe", "query", "HpServerMonitor").Code == 0;

    public static string Quote(string value) => "'" + value.Replace("'", "''") + "'";

    /// <summary>
    /// 把脚本路径和参数拼成 PowerShell 命令行。
    /// 参数名（-Action / -Mode 等）必须裸写：加引号会被当成位置参数值，导致 ValidateSet 校验失败。
    /// </summary>
    public static string BuildScriptCommand(string scriptPath, params string[] scriptArgs)
    {
        var sb = new StringBuilder();
        sb.Append("& ").Append(Quote(scriptPath));

        foreach (var arg in scriptArgs)
        {
            var isParameterName = arg.StartsWith("-", StringComparison.Ordinal) && !arg.Contains(' ');
            sb.Append(' ').Append(isParameterName ? arg : Quote(arg));
        }

        return sb.ToString();
    }
}
