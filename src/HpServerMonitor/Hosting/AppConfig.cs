namespace HpServerMonitor.Hosting;

public sealed class AppConfig
{
    public ServerConfig Server { get; set; } = new();
    public AuthConfig Auth { get; set; } = new();
    public SamplingConfig Sampling { get; set; } = new();
    public SecurityConfig Security { get; set; } = new();
    public LoggingConfig Logging { get; set; } = new();

    /// <summary>把明显不合理的配置夹回安全范围，避免启动直接失败。</summary>
    public void Normalize()
    {
        Server.Bind = string.IsNullOrWhiteSpace(Server.Bind) ? "0.0.0.0" : Server.Bind.Trim();
        Server.HttpPort = Clamp(Server.HttpPort, 1, 65535, 8080);
        Server.HttpsPort = Clamp(Server.HttpsPort, 1, 65535, 5443);

        Auth.Username = string.IsNullOrWhiteSpace(Auth.Username) ? "admin" : Auth.Username.Trim();
        Auth.TokenHours = Clamp(Auth.TokenHours, 1, 720, 12);

        Sampling.IntervalMs = Clamp(Sampling.IntervalMs, 250, 10000, 1000);
        Sampling.StorageIntervalMs = Clamp(Sampling.StorageIntervalMs, 1000, 60000, 5000);
        Sampling.SlowInfoSeconds = Clamp(Sampling.SlowInfoSeconds, 15, 3600, 60);
        Sampling.HistoryPoints = Clamp(Sampling.HistoryPoints, 300, 86400, 3600);

        Security.LoginMaxAttempts = Clamp(Security.LoginMaxAttempts, 1, 100, 5);
        Security.LoginWindowSeconds = Clamp(Security.LoginWindowSeconds, 10, 3600, 60);

        Logging.Directory = string.IsNullOrWhiteSpace(Logging.Directory) ? "logs" : Logging.Directory.Trim();
        Logging.MaxFileSizeMb = Clamp(Logging.MaxFileSizeMb, 1, 100, 10);
        Logging.MaxFiles = Clamp(Logging.MaxFiles, 2, 10, 3);
    }

    private static int Clamp(int value, int min, int max, int fallback)
        => value < min || value > max ? fallback : value;
}

public sealed class ServerConfig
{
    public string Bind { get; set; } = "0.0.0.0";
    public int HttpPort { get; set; } = 8080;
    public bool HttpsEnabled { get; set; }
    public int HttpsPort { get; set; } = 5443;
    public string CertPath { get; set; } = "";
    public string CertPassword { get; set; } = "";
}

public sealed class AuthConfig
{
    public string Username { get; set; } = "admin";

    /// <summary>可选的明文初始密码：首次启动时自动转成 PBKDF2 哈希并清空。</summary>
    public string Password { get; set; } = "";

    /// <summary>PBKDF2-SHA256 哈希串，格式 pbkdf2-sha256$iterations$salt$hash。</summary>
    public string PasswordHash { get; set; } = "";

    /// <summary>JWT HS256 密钥（Base64，至少 32 字节）；为空时首次启动自动生成。</summary>
    public string JwtSecret { get; set; } = "";

    public int TokenHours { get; set; } = 12;
}

public sealed class SamplingConfig
{
    public int IntervalMs { get; set; } = 1000;
    public int StorageIntervalMs { get; set; } = 5000;
    public int SlowInfoSeconds { get; set; } = 60;
    public int HistoryPoints { get; set; } = 3600;
}

public sealed class SecurityConfig
{
    public int LoginMaxAttempts { get; set; } = 5;
    public int LoginWindowSeconds { get; set; } = 60;
}

public sealed class LoggingConfig
{
    public string Directory { get; set; } = "logs";
    public int MaxFileSizeMb { get; set; } = 10;
    public int MaxFiles { get; set; } = 3;
    public string MinimumLevel { get; set; } = "Information";
}
