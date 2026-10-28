using System.Diagnostics;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace HpServerMonitor.Installer;

public sealed class CaddyResult
{
    public bool Configured { get; set; }
    public string Mode { get; set; } = "";
    public string Url { get; set; } = "";
    public string Message { get; set; } = "";
}

/// <summary>
/// Caddy 的安装与接管：
/// 已有 Caddy 服务时把站点块追加进它的 Caddyfile 并重载；
/// 没有时下载官方 caddy.exe 到指定目录，注册为 Windows 服务。
/// </summary>
internal static class CaddyManager
{
    private const string ServiceName = "Caddy";
    private const string BlockStart = "# >>> HpServerMonitor (managed) >>>";
    private const string BlockEnd = "# <<< HpServerMonitor (managed) <<<";
    private const string StateFileName = "caddy-state.json";
    private const string DownloadUrlAuto = "https://caddyserver.com/api/download?os=windows&arch=amd64";
    private const string DownloadUrlDynv6 = "https://caddyserver.com/api/download?os=windows&arch=amd64&p=github.com/caddy-dns/dynv6";

    public static async Task<CaddyResult> ConfigureAsync(string appDir, Action<string> log, CancellationToken ct)
    {
        var result = new CaddyResult();
        var domain = InstallerState.CaddyDomain.Trim();
        var certMode = InstallerState.CaddyCertMode;
        var httpsPort = InstallerState.CaddyHttpsPort;
        var needDynv6 = certMode == CaddyCertificateMode.Dns01;
        var block = BuildSiteBlock(domain, InstallerState.HttpPort, certMode, InstallerState.Dynv6Token.Trim());

        var state = ReadState(appDir);
        var existing = FindService();
        var managedByUs = state?.Mode == "managed" || IsInsideAppDir(existing?.ConfigPath, appDir);

        if (existing is not null)
            log($"检测到已有 Caddy 服务：{existing.Name}");

        // 1. 接管别人已有的 Caddy：只追加站点（不改全局端口）
        if (!managedByUs && existing is not null &&
            !string.IsNullOrWhiteSpace(existing.ConfigPath) && File.Exists(existing.ConfigPath))
        {
            var configPath = existing.ConfigPath!;

            if (httpsPort != 443)
                throw new InvalidOperationException(
                    "现有 Caddy 服务的全局 HTTPS 端口无法由安装器单独修改。" +
                    "请把 HTTPS 端口改回 443，或先停用旧 Caddy 让安装器托管。");

            if (needDynv6 && !HasDynv6Plugin(existing.ExePath))
                throw new InvalidOperationException(
                    "现有 Caddy 不含 dynv6 插件，无法使用 DNS-01。请改用自动验证，或让安装器托管 Caddy。");

            var text = File.ReadAllText(configPath);

            // 先去掉上一次安装写入的块，避免把自己的旧配置误判成“已存在站点”
            if (ContainsSite(RemoveBlock(text), domain))
            {
                log($"现有 Caddyfile 已包含站点 {domain}，未做改动。");
                result.Configured = true;
                result.Mode = "appended";
                result.Url = InstallerState.PublicUrl;
                result.Message = "现有 Caddy 配置已包含该域名，站点块保持原样。";
                return result;
            }

            log($"把 {domain} 站点块追加到 {configPath} ……");
            var backup = configPath + ".hpmonitor.bak";
            File.Copy(configPath, backup, overwrite: true);

            try
            {
                AppendBlock(configPath, block);
                if (!TryReload(existing.ExePath, configPath, log) && !RestartService(existing.Name, log))
                    throw new InvalidOperationException("Caddy 重载/重启失败，配置已回滚。请确认 Caddyfile 语法与端口占用。");
            }
            catch
            {
                File.Copy(backup, configPath, overwrite: true);
                RestartService(existing.Name, log);
                throw;
            }

            SaveState(appDir, "appended", existing.Name, existing.ExePath ?? "", configPath, certMode, httpsPort);
            result.Configured = true;
            result.Mode = "appended";
            result.Url = InstallerState.PublicUrl;
            result.Message = "已追加站点到现有 Caddy 配置并重载。";
            log(result.Message);
            return result;
        }

        // 2. 完整接管（或全新安装）
        var exe = await EnsureCaddyExeAsync(managedByUs ? null : existing?.ExePath, needDynv6, log, ct);
        var caddyfile = Path.Combine(appDir, "Caddyfile");
        WriteCaddyfile(caddyfile, block, httpsPort, log);

        if (needDynv6)
            TightenCaddyfileAcl(caddyfile, log);

        if (existing is not null)
        {
            log($"停止并替换旧 Caddy 服务 {existing.Name}（旧服务配置未被修改）……");
            StopAndDelete(existing.Name);
        }

        CreateService(ServiceName, exe, caddyfile, log);
        SaveState(appDir, "managed", ServiceName, exe, caddyfile, certMode, httpsPort);

        result.Configured = true;
        result.Mode = "managed";
        result.Url = InstallerState.PublicUrl;
        result.Message = $"Caddy 已注册为 Windows 服务，配置：{caddyfile}";
        log(result.Message);
        return result;
    }

    private sealed record CaddyState(string Mode);

    private static CaddyState? ReadState(string appDir)
    {
        var path = Path.Combine(appDir, StateFileName);
        if (!File.Exists(path))
            return null;

        try
        {
            var node = JsonNode.Parse(File.ReadAllText(path)) as JsonObject;
            var mode = node?["mode"]?.GetValue<string>() ?? "";
            return mode.Length == 0 ? null : new CaddyState(mode);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>卸载时按记录的方式回退：移除站点块或删除 Caddy 服务。</summary>
    public static void Remove(string appDir, Action<string> log)
    {
        var statePath = Path.Combine(appDir, StateFileName);
        if (!File.Exists(statePath))
            return;

        string mode = "";
        string serviceName = ServiceName;
        string configPath = "";
        string exePath = "";

        try
        {
            var node = JsonNode.Parse(File.ReadAllText(statePath)) as JsonObject;
            mode = node?["mode"]?.GetValue<string>() ?? "";
            serviceName = node?["serviceName"]?.GetValue<string>() ?? ServiceName;
            configPath = node?["configPath"]?.GetValue<string>() ?? "";
            exePath = node?["caddyExe"]?.GetValue<string>() ?? "";
        }
        catch (Exception ex)
        {
            log("读取 Caddy 安装记录失败：" + ex.Message);
        }

        if (mode == "appended" && configPath.Length > 0 && File.Exists(configPath))
        {
            log($"从现有 Caddyfile 移除站点块：{configPath}");
            try
            {
                File.Copy(configPath, configPath + ".hpmonitor.bak", overwrite: true);
                var text = File.ReadAllText(configPath);
                var updated = RemoveBlock(text);
                if (!string.Equals(text, updated, StringComparison.Ordinal))
                {
                    File.WriteAllText(configPath, updated, new UTF8Encoding(false));
                    if (!TryReload(exePath, configPath, log))
                        RestartService(serviceName, log);
                }
                else
                {
                    log("未找到本站点块，跳过。");
                }
            }
            catch (Exception ex)
            {
                log("移除站点块失败：" + ex.Message);
            }
        }
        else if (mode == "managed")
        {
            log($"停止并删除 Caddy 服务 {serviceName}（Caddy 程序文件保留）……");
            StopAndDelete(serviceName);
        }

        try
        {
            File.Delete(statePath);
        }
        catch
        {
            // 忽略
        }
    }

    // ---------- 服务探测 ----------

    private sealed record CaddyService(string Name, string? ExePath, string? ConfigPath);

    private static CaddyService? FindService()
    {
        const string script =
            "$s = Get-CimInstance Win32_Service | Where-Object { $_.Name -in @('Caddy','caddy') } | " +
            "Select-Object -First 1 -Property Name,PathName | ConvertTo-Json -Compress; $s";

        var run = Shell.RunPowerShell(script);
        if (run.Code != 0 || string.IsNullOrWhiteSpace(run.Output))
            return null;

        try
        {
            using var doc = JsonDocument.Parse(run.Output.Trim());
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
                return null;

            var name = root.TryGetProperty("Name", out var nameNode) ? nameNode.GetString() : null;
            var pathName = root.TryGetProperty("PathName", out var pathNode) ? pathNode.GetString() : null;

            if (string.IsNullOrWhiteSpace(name))
                return null;

            return new CaddyService(name!, ExtractExePath(pathName), ExtractConfigPath(pathName));
        }
        catch
        {
            return null;
        }
    }

    private static string? ExtractExePath(string? pathName)
    {
        if (string.IsNullOrWhiteSpace(pathName))
            return null;

        var quoted = Regex.Match(pathName, "^\\s*\"([^\"]+)\"");
        if (quoted.Success)
            return quoted.Groups[1].Value;

        var first = pathName.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        return first is not null && first.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? first : null;
    }

    private static string? ExtractConfigPath(string? pathName)
    {
        if (string.IsNullOrWhiteSpace(pathName))
            return null;

        var match = Regex.Match(pathName, "-{1,2}config(?:=|\\s+)(?:\"([^\"]+)\"|'([^']+)'|(\\S+))",
            RegexOptions.IgnoreCase);

        if (!match.Success)
            return null;

        for (var i = 1; i <= 3; i++)
        {
            if (match.Groups[i].Success && match.Groups[i].Value.Length > 0)
                return match.Groups[i].Value;
        }

        return null;
    }

    // ---------- caddy.exe ----------

    private static async Task<string> EnsureCaddyExeAsync(string? preferred, bool needDynv6,
        Action<string> log, CancellationToken ct)
    {
        var fileName = needDynv6 ? "caddy-dynv6.exe" : "caddy.exe";
        var targetDir = string.IsNullOrWhiteSpace(InstallerState.CaddyDir)
            ? InstallerState.DefaultCaddyDir
            : InstallerState.CaddyDir;

        if (needDynv6)
        {
            // 1. 安装器内置的插件版（构建时若提供了 dist\caddy-dynv6.exe 就会内嵌）
            var bundled = TryExtractBundledDynv6(targetDir, log);
            if (bundled is not null)
                return bundled;

            // 2. 与安装器同目录的 caddy-dynv6.exe
            var sibling = Path.Combine(AppContext.BaseDirectory, fileName);
            if (File.Exists(sibling))
            {
                Directory.CreateDirectory(targetDir);
                var copied = Path.Combine(targetDir, fileName);
                File.Copy(sibling, copied, overwrite: true);
                log($"已使用安装器同目录的 {fileName}：{copied}");
                return copied;
            }
        }

        if (!string.IsNullOrWhiteSpace(preferred) && File.Exists(preferred) &&
            (!needDynv6 || HasDynv6Plugin(preferred)))
        {
            log($"复用已安装的 Caddy：{preferred}");
            return preferred;
        }

        var candidates = new List<string>();
        if (!string.IsNullOrWhiteSpace(InstallerState.CaddyDir))
        {
            candidates.Add(Path.Combine(InstallerState.CaddyDir, fileName));
            candidates.Add(Path.Combine(InstallerState.CaddyDir, "caddy.exe"));
        }

        candidates.Add(@"C:\Program Files\Caddy\caddy.exe");
        candidates.Add(@"D:\Program Files\Caddy\caddy.exe");
        candidates.Add(@"C:\Caddy\caddy.exe");

        foreach (var candidate in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!File.Exists(candidate))
                continue;

            if (needDynv6 && !HasDynv6Plugin(candidate))
                continue;

            log($"找到本机 Caddy：{candidate}");
            return candidate;
        }

        var where = Shell.Run("where.exe", "caddy.exe");
        if (where.Code == 0)
        {
            var fromPath = where.Output.Split('\n')
                .Select(line => line.Trim())
                .FirstOrDefault(File.Exists);

            if (fromPath is not null && (!needDynv6 || HasDynv6Plugin(fromPath)))
            {
                log($"在 PATH 中找到 Caddy：{fromPath}");
                return fromPath;
            }
        }

        var target = Path.Combine(targetDir, fileName);
        log($"未找到{(needDynv6 ? "带 dynv6 插件的" : "")}Caddy，准备从 caddyserver.com 下载到 {targetDir}（约 50 MB）……");
        Directory.CreateDirectory(targetDir);
        await DownloadAsync(target, needDynv6, log, ct);
        return target;
    }

    private static string? TryExtractBundledDynv6(string targetDir, Action<string> log)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var name = assembly.GetManifestResourceNames()
            .FirstOrDefault(n => n.EndsWith("caddy-dynv6.exe", StringComparison.OrdinalIgnoreCase));

        if (name is null)
            return null;

        Directory.CreateDirectory(targetDir);
        var target = Path.Combine(targetDir, "caddy-dynv6.exe");
        var temp = target + ".new";

        using (var stream = assembly.GetManifestResourceStream(name)!)
        using (var file = File.Create(temp))
            stream.CopyTo(file);

        File.Move(temp, target, overwrite: true);
        log($"已释放安装器内置的 Caddy（dynv6 插件版）：{target}");
        return target;
    }

    /// <summary>DNS-01 需要带 dynv6 插件的 Caddy，检查安装器内置、同目录或目标目录是否已有。</summary>
    public static bool Dynv6CaddyAvailable(string? caddyDir = null)
    {
        var assembly = Assembly.GetExecutingAssembly();
        if (assembly.GetManifestResourceNames()
            .Any(n => n.EndsWith("caddy-dynv6.exe", StringComparison.OrdinalIgnoreCase)))
        {
            return true;
        }

        if (File.Exists(Path.Combine(AppContext.BaseDirectory, "caddy-dynv6.exe")))
            return true;

        var dir = string.IsNullOrWhiteSpace(caddyDir)
            ? (string.IsNullOrWhiteSpace(InstallerState.CaddyDir) ? InstallerState.DefaultCaddyDir : InstallerState.CaddyDir)
            : caddyDir;

        return File.Exists(Path.Combine(dir, "caddy-dynv6.exe"));
    }

    private static bool HasDynv6Plugin(string? exe)
    {
        if (string.IsNullOrWhiteSpace(exe) || !File.Exists(exe))
            return false;

        var run = Shell.Run(exe, "list-modules");
        return run.Code == 0 &&
               run.Output.Contains("dns.providers.dynv6", StringComparison.OrdinalIgnoreCase);
    }

    private static async Task DownloadAsync(string target, bool withDynv6, Action<string> log, CancellationToken ct)
    {
        var url = withDynv6 ? DownloadUrlDynv6 : DownloadUrlAuto;

        using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(15) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("HpServerMonitorSetup/1.0");

        using var response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode)
        {
            var hint = withDynv6
                ? "caddyserver.com 的在线构建服务未收录 dynv6 插件，无法自动下载。请把 caddy-dynv6.exe 放到安装器同目录后重试，或改用自签名/自动验证。"
                : "请检查网络或代理后重试。";

            throw new InvalidOperationException($"下载 Caddy 失败：HTTP {(int)response.StatusCode}。{hint}");
        }

        var temp = target + ".download";
        await using (var file = File.Create(temp))
        {
            await response.Content.CopyToAsync(file, ct);
        }

        var length = new FileInfo(temp).Length;
        if (length < 5_000_000)
        {
            File.Delete(temp);
            throw new InvalidOperationException("下载的 Caddy 文件异常（体积过小），请检查网络或代理后重试。");
        }

        using (var stream = File.OpenRead(temp))
        {
            var header = new byte[2];
            if (stream.Read(header, 0, 2) < 2 || header[0] != 'M' || header[1] != 'Z')
            {
                File.Delete(temp);
                throw new InvalidOperationException("下载内容不是有效的 Windows 可执行文件，请检查网络或代理后重试。");
            }
        }

        File.Move(temp, target, overwrite: true);
        log($"Caddy 已下载：{target}（{length / 1024 / 1024} MB）");
    }

    // ---------- Caddyfile ----------

    private static string BuildSiteBlock(string domain, int appPort, CaddyCertificateMode certMode, string dnsToken)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"{domain} {{");

        switch (certMode)
        {
            case CaddyCertificateMode.Internal:
                sb.AppendLine("    tls internal");
                break;
            case CaddyCertificateMode.Dns01:
                sb.AppendLine("    tls {");
                sb.AppendLine($"        dns dynv6 {dnsToken}");
                sb.AppendLine("    }");
                break;
        }

        sb.AppendLine("    encode gzip");
        sb.AppendLine();
        sb.AppendLine($"    reverse_proxy 127.0.0.1:{appPort}");
        sb.AppendLine();
        sb.AppendLine("    header {");
        sb.AppendLine("        Strict-Transport-Security \"max-age=31536000; includeSubDomains\"");
        sb.AppendLine("        X-Frame-Options \"DENY\"");
        sb.AppendLine("        X-Content-Type-Options \"nosniff\"");
        sb.AppendLine("        Referrer-Policy \"no-referrer\"");
        sb.AppendLine("        Permissions-Policy \"camera=(), microphone=(), geolocation=()\"");
        sb.AppendLine("        Cross-Origin-Opener-Policy \"same-origin\"");
        sb.AppendLine("        Cross-Origin-Resource-Policy \"same-origin\"");
        sb.AppendLine("        X-XSS-Protection \"0\"");
        sb.AppendLine("        -Server");
        sb.AppendLine("    }");
        sb.AppendLine();
        sb.AppendLine("    log");
        sb.AppendLine("}");
        return sb.ToString();
    }

    private static void WriteCaddyfile(string path, string block, int httpsPort, Action<string> log)
    {
        if (File.Exists(path))
            File.Copy(path, path + ".bak", overwrite: true);

        var content = httpsPort == 443
            ? block
            : "{\n    https_port " + httpsPort + "\n}\n\n" + block;

        File.WriteAllText(path, content, new UTF8Encoding(false));
        log($"Caddyfile 已写入：{path}（HTTPS 端口 {httpsPort}）");
    }

    private static bool ContainsSite(string text, string domain)
    {
        var pattern = "(?m)^\\s*(?:https?://)?" + Regex.Escape(domain) + "[\\s,]*\\{";
        return Regex.IsMatch(text, pattern, RegexOptions.IgnoreCase);
    }

    private static void AppendBlock(string configPath, string block)
    {
        var text = RemoveBlock(File.ReadAllText(configPath));
        text = text.TrimEnd() + Environment.NewLine + Environment.NewLine +
               BlockStart + Environment.NewLine + block.TrimEnd() + Environment.NewLine +
               BlockEnd + Environment.NewLine;
        File.WriteAllText(configPath, text, new UTF8Encoding(false));
    }

    private static string RemoveBlock(string text)
        => Regex.Replace(text, Regex.Escape(BlockStart) + ".*?" + Regex.Escape(BlockEnd) + "\\s*",
            string.Empty, RegexOptions.Singleline);

    private static bool IsInsideAppDir(string? path, string appDir)
    {
        if (string.IsNullOrWhiteSpace(path))
            return false;

        try
        {
            var full = Path.GetFullPath(path);
            var root = Path.GetFullPath(appDir).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            return full.StartsWith(root, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static void TightenCaddyfileAcl(string path, Action<string> log)
    {
        var run = Shell.Run("icacls.exe", path, "/inheritance:r",
            "/grant:r", "SYSTEM:(R,W)", "Administrators:(R,W)");

        if (run.Code == 0)
            log("已收紧 Caddyfile 权限（仅 SYSTEM / Administrators 可读写）。");
        else
            log("Caddyfile 权限收紧失败（不影响运行）：" + run.Output.Trim());
    }

    // ---------- 服务操作 ----------

    private static void CreateService(string name, string exe, string caddyfile, Action<string> log)
    {
        var binPath = $"\"{exe}\" run --config \"{caddyfile}\" --adapter caddyfile";
        var script =
            "$ErrorActionPreference='Stop'; " +
            "New-Service -Name " + Shell.Quote(name) +
            " -BinaryPathName " + Shell.Quote(binPath) +
            " -DisplayName 'Caddy' -StartupType Automatic | Out-Null; " +
            "Start-Service " + Shell.Quote(name) + "; " +
            "(Get-Service " + Shell.Quote(name) + ").Status";

        var run = Shell.RunPowerShell(script);
        if (run.Code != 0)
            throw new InvalidOperationException(
                "注册 Caddy 服务失败：" + run.Output.Trim() +
                "\n请确认 HTTPS 端口未被占用，且 Caddyfile 语法正确。");

        if (!run.Output.Contains("Running", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Caddy 服务已注册但未运行，请查看 Caddy 日志排查端口占用或证书配置。");

        Shell.Run("sc.exe", "failure", name, "reset=", "86400",
            "actions=", "restart/5000/restart/10000/restart/30000");
        log("Caddy 服务已注册并启动。");
    }

    private static bool TryReload(string? exe, string configPath, Action<string> log)
    {
        if (string.IsNullOrWhiteSpace(exe) || !File.Exists(exe))
            return false;

        var script = "& " + Shell.Quote(exe) + " reload --config " + Shell.Quote(configPath) +
                     " --adapter caddyfile 2>&1 | Out-String";

        var run = Shell.RunPowerShell(script);
        if (run.Code == 0)
        {
            log("Caddy 已重载配置。");
            return true;
        }

        log("caddy reload 未成功，改为重启服务。");
        return false;
    }

    private static bool RestartService(string name, Action<string> log)
    {
        Shell.Run("sc.exe", "stop", name);
        Thread.Sleep(2500);
        var start = Shell.Run("sc.exe", "start", name);
        Thread.Sleep(2000);

        var state = Shell.RunPowerShell("(Get-Service " + Shell.Quote(name) + " -ErrorAction SilentlyContinue).Status");
        if (state.Output.Contains("Running", StringComparison.OrdinalIgnoreCase))
        {
            log($"Caddy 服务 {name} 已重启。");
            return true;
        }

        log($"Caddy 服务 {name} 未能启动，请检查 Caddyfile 与端口占用。");
        return false;
    }

    private static void StopAndDelete(string name)
    {
        Shell.Run("sc.exe", "stop", name);
        Thread.Sleep(2000);
        Shell.Run("sc.exe", "delete", name);

        // 删除是异步的，等 sc 查不到服务再继续，避免重建同名服务失败
        for (var attempt = 0; attempt < 12; attempt++)
        {
            if (Shell.Run("sc.exe", "query", name).Code != 0)
                return;
            Thread.Sleep(1000);
        }
    }

    // ---------- 安装记录 ----------

    private static void SaveState(string appDir, string mode, string serviceName, string exe,
        string configPath, CaddyCertificateMode certMode, int httpsPort)
    {
        var state = new JsonObject
        {
            ["mode"] = mode,
            ["serviceName"] = serviceName,
            ["caddyExe"] = exe,
            ["configPath"] = configPath,
            ["certificatemode"] = certMode.ToString(),
            ["httpsPort"] = httpsPort
        };

        File.WriteAllText(Path.Combine(appDir, StateFileName),
            state.ToJsonString(new JsonSerializerOptions { WriteIndented = true }),
            new UTF8Encoding(false));
    }
}
