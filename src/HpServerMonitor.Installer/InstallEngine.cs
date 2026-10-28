using System.Diagnostics;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace HpServerMonitor.Installer;

public sealed class InstallResult
{
    public string AccessUrl { get; set; } = "";
    public string PublicUrl { get; set; } = "";
    public string Username { get; set; } = "";
    public string GeneratedPassword { get; set; } = "";
    public bool Started { get; set; }
    public bool HealthOk { get; set; }
    public bool CaddyConfigured { get; set; }
    public string CaddyMode { get; set; } = "";
    public string CaddyMessage { get; set; } = "";
    public List<string> Warnings { get; } = new();
}

/// <summary>安装与卸载的实际动作：释放文件、写配置、调用 install-service.ps1 注册服务。</summary>
public static class InstallEngine
{
    private const string ServiceName = "HpServerMonitor";

    public static async Task<InstallResult> InstallAsync(IProgress<string> log, CancellationToken ct)
    {
        var result = new InstallResult();
        var dir = Path.GetFullPath(InstallerState.InstallDir);

        await Task.Run(async () =>
        {
            log.Report($"安装器版本：{typeof(InstallEngine).Assembly.GetName().Version?.ToString(3) ?? "unknown"}");
            log.Report($"安装目录：{dir}");

            // 1. 先停掉旧服务/任务，避免 exe 被占用
            log.Report("停止并移除旧的 HpServerMonitor 服务/任务（如存在）……");
            var uninstall = RunServiceScript("Uninstall", dir, false, log);
            if (uninstall.Code != 0)
                log.Report("未检测到可移除的旧安装，继续。");

            Shell.Run("taskkill.exe", "/F", "/IM", "HpServerMonitor.exe");

            // 2. 目录与文件
            Directory.CreateDirectory(dir);
            RepairPermissions(dir, log.Report);
            Directory.CreateDirectory(Path.Combine(dir, "logs"));
            log.Report("释放主程序 HpServerMonitor.exe……");
            ExtractResource("HpServerMonitor.exe", Path.Combine(dir, "HpServerMonitor.exe"));

            // 3. 配置
            log.Report("写入 config.json……");
            var generated = WriteConfig(dir, log.Report);
            if (!string.IsNullOrEmpty(generated))
            {
                result.GeneratedPassword = generated;
                log.Report("已生成随机登录密码，请在本页记录。");
            }

            // 4. 注册服务 / 计划任务
            if (InstallerState.Mode == RunMode.FilesOnly)
            {
                log.Report("按选择跳过服务注册：稍后可手动运行 HpServerMonitor.exe。");
            }
            else
            {
                var mode = InstallerState.Mode == RunMode.Service ? "Service" : "Task";
                log.Report(InstallerState.Mode == RunMode.Service
                    ? "注册 Windows 服务并启动……"
                    : "注册开机计划任务并启动……");

                var install = RunServiceScript("Install", dir, InstallerState.OpenFirewall, log, "-Mode", mode);
                if (install.Code != 0)
                    throw new InvalidOperationException("服务安装脚本失败（install-service.ps1）：\n" + Tail(install.Output));

                result.Started = true;
            }

            // 5. 防火墙（脚本已加过时这里是幂等的）
            if (InstallerState.OpenFirewall)
            {
                AddPortRule(InstallerState.HttpPort, $"HpServerMonitor LAN {InstallerState.HttpPort}", log.Report);

                if (InstallerState.UseCaddy)
                {
                    if (InstallerState.CaddyCertMode == CaddyCertificateMode.Automatic)
                    {
                        AddPortRule(80, "HpServerMonitor Caddy 80", log.Report);
                        AddPortRule(443, "HpServerMonitor Caddy 443", log.Report);
                    }
                    else
                    {
                        AddPortRule(InstallerState.CaddyHttpsPort,
                            $"HpServerMonitor Caddy {InstallerState.CaddyHttpsPort}", log.Report);
                    }
                }
            }

            // 6. Caddy：安装/接管，失败不影响主程序
            if (InstallerState.UseCaddy)
            {
                log.Report($"配置 Caddy 反向代理（{InstallerState.CaddyDomain}）……");
                try
                {
                    var caddy = await CaddyManager.ConfigureAsync(dir, log.Report, ct);
                    result.CaddyConfigured = caddy.Configured;
                    result.CaddyMode = caddy.Mode;
                    result.CaddyMessage = caddy.Message;
                }
                catch (Exception ex)
                {
                    result.Warnings.Add("Caddy 配置失败：" + ex.Message);
                    log.Report("Caddy 配置失败：" + ex.Message);
                }
            }

            // 7. 健康检查
            if (result.Started)
            {
                log.Report("等待服务响应健康检查……");
                result.HealthOk = await WaitForHealthAsync(InstallerState.HttpPort, log.Report, ct);
                if (!result.HealthOk)
                    result.Warnings.Add("健康检查超时：服务可能仍在启动，可稍后刷新页面或查看 logs\\hpmonitor.log。");
            }

            result.AccessUrl = InstallerState.AccessUrl;
            result.PublicUrl = InstallerState.PublicUrl;
            result.Username = InstallerState.Username;

            log.Report("安装完成。");
        }, ct);

        return result;
    }

    public static async Task UninstallAsync(string dir, bool keepData, bool removeFirewall, bool removeCaddy,
        IProgress<string> log, CancellationToken ct)
    {
        await Task.Run(() =>
        {
            log.Report("停止并删除服务/计划任务……");
            var result = RunServiceScript("Uninstall", dir, false, log);
            if (result.Code != 0)
                log.Report("服务/任务可能不存在，继续清理文件。");

            Shell.Run("taskkill.exe", "/F", "/IM", "HpServerMonitor.exe");

            if (removeCaddy)
            {
                log.Report("回退 Caddy 配置……");
                CaddyManager.Remove(dir, log.Report);
            }

            if (removeFirewall)
            {
                log.Report("移除防火墙规则……");
                var fw = Shell.RunPowerShell(
                    "Get-NetFirewallRule -DisplayName 'HpServerMonitor *' -ErrorAction SilentlyContinue | Remove-NetFirewallRule");
                if (fw.Code != 0)
                    log.Report("防火墙规则移除失败（可忽略）：" + Tail(fw.Output));
            }

            if (!Directory.Exists(dir))
            {
                log.Report("安装目录已不存在。");
                return;
            }

            if (keepData)
            {
                log.Report("保留 config.json 与 logs，删除程序文件……");
                foreach (var file in new[]
                         {
                             "HpServerMonitor.exe", "README.md", "install-service.ps1",
                             "Caddyfile", "Caddyfile.bak", "config.json.bak", "caddy-state.json"
                         })
                {
                    TryDelete(Path.Combine(dir, file));
                }
                log.Report("卸载完成：配置与日志已保留。");
            }
            else
            {
                log.Report("删除安装目录……");
                TryDeleteDirectory(dir);
                log.Report("卸载完成。");
            }
        }, ct);
    }

    // ---------- 内部实现 ----------

    private static void ExtractResource(string resourceSuffix, string targetPath)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var name = assembly.GetManifestResourceNames()
            .FirstOrDefault(n => n.EndsWith(resourceSuffix, StringComparison.OrdinalIgnoreCase));

        if (name is null)
            throw new InvalidOperationException($"安装器内部缺少资源 {resourceSuffix}，请重新构建安装器。");

        var temp = targetPath + ".new";
        using (var stream = assembly.GetManifestResourceStream(name)!)
        using (var file = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None))
            stream.CopyTo(file);

        // 旧的临时脚本可能被设成只读，先清属性再覆盖
        ClearReadOnly(targetPath);
        File.Move(temp, targetPath, overwrite: true);
    }

    /// <summary>把内嵌的 install-service.ps1 释放到临时目录并执行。</summary>
    private static (int Code, string Output) RunServiceScript(
        string action, string installDir, bool openFirewall, IProgress<string> log, params string[] extra)
    {
        var script = Path.Combine(Path.GetTempPath(), "HpServerMonitorSetup", "install-service.ps1");
        // 每次都重新释放：否则旧安装器留在 %TEMP% 的脚本会覆盖新版逻辑
        Directory.CreateDirectory(Path.GetDirectoryName(script)!);
        ExtractResource("install-service.ps1", script);

        var args = new List<string> { "-Action", action };
        args.AddRange(extra);
        args.Add("-Source");
        args.Add(installDir);
        args.Add("-InstallDir");
        args.Add(installDir);
        if (openFirewall)
            args.Add("-OpenFirewall");

        var result = Shell.RunPowerShell(Shell.BuildScriptCommand(script, args.ToArray()));
        foreach (var line in result.Output.Split('\n', StringSplitOptions.RemoveEmptyEntries))
            log.Report("  " + line.TrimEnd());
        return result;
    }

    private static string? WriteConfig(string dir, Action<string> log)
    {
        var path = Path.Combine(dir, "config.json");
        JsonObject root;

        if (File.Exists(path))
        {
            try
            {
                root = JsonNode.Parse(
                           File.ReadAllText(path),
                           documentOptions: new JsonDocumentOptions
                           {
                               CommentHandling = JsonCommentHandling.Skip,
                               AllowTrailingCommas = true
                           }) as JsonObject
                       ?? new JsonObject();
            }
            catch (JsonException)
            {
                File.Copy(path, path + ".bak", overwrite: true);
                log("现有 config.json 无法解析，已备份为 config.json.bak 并重新生成。");
                root = new JsonObject();
            }
        }
        else
        {
            root = new JsonObject();
        }

        var server = EnsureObject(root, "server");
        server["bind"] = InstallerState.BindAddress;
        server["httpPort"] = InstallerState.HttpPort;

        var auth = EnsureObject(root, "auth");
        auth["username"] = InstallerState.Username;
        auth["password"] = "";

        var existingHash = GetString(auth, "passwordHash");
        string? generated = null;

        if (!string.IsNullOrWhiteSpace(InstallerState.Password))
        {
            auth["passwordHash"] = PasswordHashing.Hash(InstallerState.Password);
            log("已写入新的管理员密码（PBKDF2 哈希）。");
        }
        else if (string.IsNullOrWhiteSpace(existingHash))
        {
            generated = PasswordHashing.GeneratePassword(16);
            auth["passwordHash"] = PasswordHashing.Hash(generated);
        }

        var secret = GetString(auth, "jwtSecret");
        if (!IsValidSecret(secret))
            auth["jwtSecret"] = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(48));

        EnsureObject(root, "sampling");
        EnsureObject(root, "security");

        var logging = EnsureObject(root, "logging");
        if (GetString(logging, "directory").Length == 0)
            logging["directory"] = "logs";

        var json = root.ToJsonString(new JsonSerializerOptions
        {
            WriteIndented = true,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        });

        var temp = path + ".tmp";
        File.WriteAllText(temp, json, new UTF8Encoding(false));
        ReplaceFile(temp, path, json);

        return generated;
    }

    /// <summary>
    /// 旧版本或手工 icacls 可能把 config.json 设成只读/仅 SYSTEM，导致升级时
    /// temp + Move 覆盖失败。这里先清只读属性，仍失败则退化为原地写入。
    /// </summary>
    private static void ReplaceFile(string temp, string path, string content)
    {
        try
        {
            ClearReadOnly(path);
            File.Move(temp, path, overwrite: true);
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or IOException)
        {
            TryDelete(temp);
            ClearReadOnly(path);
            File.WriteAllText(path, content, new UTF8Encoding(false));
        }
    }

    private static void ClearReadOnly(string path)
    {
        if (!File.Exists(path))
            return;

        var attributes = File.GetAttributes(path);
        if ((attributes & FileAttributes.ReadOnly) != 0)
            File.SetAttributes(path, attributes & ~FileAttributes.ReadOnly);
    }

    /// <summary>
    /// 升级前先接管并把 ACL 重置为继承默认值，修复上一版 ACL 或手工设置留下的
    /// “仅 SYSTEM / 缺少 DELETE”导致写入 config.json 失败的问题。
    /// 服务/计划任务模式的最终收紧仍由 install-service.ps1 完成。
    /// </summary>
    private static void RepairPermissions(string dir, Action<string> log)
    {
        var full = Path.GetFullPath(dir).TrimEnd(Path.DirectorySeparatorChar);
        var root = Path.GetPathRoot(full)?.TrimEnd(Path.DirectorySeparatorChar);

        if (string.Equals(full, root, StringComparison.OrdinalIgnoreCase) || IsProtectedDirectory(full))
        {
            log("安装目录位于受保护位置，跳过权限修复。");
            return;
        }

        log("修复安装目录权限……");
        Shell.Run("takeown.exe", "/f", full, "/r", "/d", "y");
        var reset = Shell.Run("icacls.exe", full, "/reset", "/T", "/C");
        if (reset.Code == 0)
            log("安装目录权限已重置为继承默认值。");
        else
            log("  icacls /reset 返回 " + reset.Code + "：" + Tail(reset.Output));
    }

    private static bool IsProtectedDirectory(string full)
    {
        string[] protectedPaths =
        {
            Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
        };

        return protectedPaths
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Any(path => string.Equals(
                Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar),
                full,
                StringComparison.OrdinalIgnoreCase));
    }

    private static void AddPortRule(int port, string displayName, Action<string> log)
    {
        var command =
            $"if (-not (Get-NetFirewallRule -DisplayName '{displayName}' -ErrorAction SilentlyContinue)) " +
            $"{{ New-NetFirewallRule -DisplayName '{displayName}' -Direction Inbound -Protocol TCP -LocalPort {port} " +
            "-Action Allow -Profile Private | Out-Null }";

        var result = Shell.RunPowerShell(command);
        if (result.Code == 0)
            log($"防火墙已允许 TCP {port}（专用网络）。");
        else
            log("防火墙规则添加失败（不影响本机访问）：" + Tail(result.Output));
    }

    private static async Task<bool> WaitForHealthAsync(int port, Action<string> log, CancellationToken ct)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };

        for (var attempt = 1; attempt <= 20; attempt++)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var body = await client.GetStringAsync($"http://127.0.0.1:{port}/api/health", ct);
                log($"健康检查通过（第 {attempt} 次）：{body.Trim()}");
                return true;
            }
            catch
            {
                await Task.Delay(1000, ct);
            }
        }

        return false;
    }

    private static JsonObject EnsureObject(JsonObject parent, string name)
    {
        if (parent[name] is JsonObject existing)
            return existing;

        var created = new JsonObject();
        parent[name] = created;
        return created;
    }

    private static string GetString(JsonObject obj, string key)
        => obj[key] is JsonValue value && value.TryGetValue<string>(out var text) ? text : "";

    private static bool IsValidSecret(string secret)
    {
        if (string.IsNullOrWhiteSpace(secret))
            return false;

        try
        {
            return Convert.FromBase64String(secret).Length >= 32;
        }
        catch
        {
            return false;
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
                File.Delete(path);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"删除失败 {path}: {ex.Message}");
        }
    }

    private static void TryDeleteDirectory(string dir)
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                Directory.Delete(dir, recursive: true);
                return;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"删除目录失败 {dir}: {ex.Message}");
                Thread.Sleep(500);
            }
        }
    }

    private static string Tail(string output)
    {
        var lines = output.Split('\n', StringSplitOptions.RemoveEmptyEntries);
        return string.Join(Environment.NewLine, lines.TakeLast(8)).Trim();
    }
}
