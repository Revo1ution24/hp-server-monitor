namespace HpServerMonitor.Installer;

public enum RunMode
{
    Service,
    ScheduledTask,
    FilesOnly
}

/// <summary>Caddy 的证书获取方式。</summary>
public enum CaddyCertificateMode
{
    /// <summary>HTTP-01 / TLS-ALPN-01，需要运营商放行 80/443 入站。</summary>
    Automatic,

    /// <summary>DNS-01（dynv6），不需要任何入站端口。</summary>
    Dns01,

    /// <summary>自签名 tls internal，浏览器会提示不受信任。</summary>
    Internal
}

/// <summary>向导各页共享的安装参数。</summary>
public static class InstallerState
{
    public const string DefaultInstallDir = @"C:\HpServerMonitor";
    public const string DefaultCaddyDir = @"D:\Program Files\Caddy";

    public static string InstallDir { get; set; } = DefaultInstallDir;
    public static string BindAddress { get; set; } = "127.0.0.1";
    public static int HttpPort { get; set; } = 8080;
    public static string Username { get; set; } = "admin";
    public static string Password { get; set; } = "";
    public static RunMode Mode { get; set; } = RunMode.Service;
    public static bool OpenFirewall { get; set; } = true;
    public static bool OpenBrowserAfter { get; set; } = true;
    public static bool UseCaddy { get; set; }
    public static string CaddyDomain { get; set; } = "monitor.example.com";
    public static string CaddyDir { get; set; } = DefaultCaddyDir;
    public static int CaddyHttpsPort { get; set; } = 443;
    public static CaddyCertificateMode CaddyCertMode { get; set; } = CaddyCertificateMode.Automatic;
    public static string Dynv6Token { get; set; } = "";

    public static bool ExistingInstall { get; private set; }
    public static string ExistingPasswordHash { get; private set; } = "";

    /// <summary>本机访问地址；0.0.0.0 时用回环地址展示。</summary>
    public static string AccessUrl
    {
        get
        {
            var host = BindAddress is "0.0.0.0" or "::" or "*" ? "127.0.0.1" : BindAddress;
            return $"http://{host}:{HttpPort}";
        }
    }

    public static string PublicUrl
    {
        get
        {
            if (!UseCaddy || string.IsNullOrWhiteSpace(CaddyDomain))
                return AccessUrl;

            var port = CaddyHttpsPort is > 0 and not 443 ? ":" + CaddyHttpsPort : "";
            return $"https://{CaddyDomain}{port}";
        }
    }

    /// <summary>检测是否已安装过（服务存在或默认目录下已有配置）。</summary>
    public static void Detect()
    {
        ExistingInstall = Shell.ServiceExists() || File.Exists(Path.Combine(DefaultInstallDir, "config.json"));
        ExistingPasswordHash = ReadPasswordHash(DefaultInstallDir);
    }

    /// <summary>读取指定目录下配置文件中已有的密码哈希，读不到就返回空串。</summary>
    public static string ReadPasswordHash(string directory)
    {
        var configPath = Path.Combine(directory, "config.json");
        if (!File.Exists(configPath))
            return "";

        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(
                File.ReadAllText(configPath),
                new System.Text.Json.JsonDocumentOptions
                {
                    CommentHandling = System.Text.Json.JsonCommentHandling.Skip,
                    AllowTrailingCommas = true
                });

            if (doc.RootElement.TryGetProperty("auth", out var auth) &&
                auth.TryGetProperty("passwordHash", out var hash))
            {
                return hash.GetString() ?? "";
            }
        }
        catch
        {
            // 配置损坏时按全新安装处理
        }

        return "";
    }
}
