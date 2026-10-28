using System.Net;
using HpServerMonitor.Api;
using HpServerMonitor.Auth;
using HpServerMonitor.DeviceReader;
using HpServerMonitor.DeviceReader.Support;
using HpServerMonitor.Hosting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.AspNetCore.Server.Kestrel.Https;
using Microsoft.Extensions.Hosting.WindowsServices;
using Microsoft.Extensions.Logging;

var paths = new AppPaths(AppContext.BaseDirectory);
var hasher = new PasswordHasher();
var configStore = new ConfigStore(paths, hasher);

ConfigLoadResult loaded;
try
{
    loaded = configStore.LoadOrCreate();
}
catch (Exception ex)
{
    Console.Error.WriteLine($"[HpServerMonitor] 配置初始化失败：{ex.Message}");
    return 1;
}

var config = loaded.Config;
var warnings = new List<string>();

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = AppContext.BaseDirectory
});

builder.Host.UseWindowsService(options => options.ServiceName = "HpServerMonitor");

builder.Logging.ClearProviders();
builder.Logging.SetMinimumLevel(ParseLevel(config.Logging.MinimumLevel));
builder.Logging.AddSimpleConsole(options =>
{
    options.SingleLine = true;
    options.TimestampFormat = "HH:mm:ss ";
});
builder.Logging.AddProvider(new RollingFileLoggerProvider(paths, config.Logging));

builder.WebHost.ConfigureKestrel(options =>
{
    options.AddServerHeader = false;
    options.Limits.MaxRequestBodySize = 64 * 1024;
    options.Limits.KeepAliveTimeout = TimeSpan.FromMinutes(2);

    if (!IPAddress.TryParse(config.Server.Bind, out var bind))
    {
        bind = IPAddress.Any;
        warnings.Add($"监听地址 {config.Server.Bind} 无法解析，已回退到 0.0.0.0");
    }

    options.Listen(bind, config.Server.HttpPort);

    if (!config.Server.HttpsEnabled)
        return;

    var certPath = paths.Resolve(config.Server.CertPath);
    if (string.IsNullOrWhiteSpace(config.Server.CertPath) || !File.Exists(certPath))
    {
        warnings.Add($"HTTPS 已启用但证书不存在：{certPath}；本次仅启动 HTTP");
        return;
    }

    try
    {
        options.Listen(bind, config.Server.HttpsPort, listen =>
            listen.UseHttps(certPath, config.Server.CertPassword));
    }
    catch (Exception ex)
    {
        warnings.Add($"HTTPS 监听失败：{ex.Message}；本次仅启动 HTTP");
    }
});

builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(new[]
    {
        "application/json",
        "image/svg+xml"
    });
});

builder.Services.AddSingleton(paths);
builder.Services.AddSingleton(config);
builder.Services.AddSingleton(configStore);
builder.Services.AddSingleton(hasher);
builder.Services.AddSingleton<StartupDiagnostics>();
builder.Services.AddSingleton<JwtService>();
builder.Services.AddSingleton<LoginRateLimiter>();
builder.Services.AddSingleton<SafeLog>();
builder.Services.AddSingleton<HardwareSession>();
builder.Services.AddSingleton<PdhCpuMeter>();
builder.Services.AddSingleton<HistoryStore>();
builder.Services.AddSingleton<SnapshotStore>();
builder.Services.AddSingleton<RealtimeHub>();
builder.Services.AddSingleton<SlowInfoCache>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<SlowInfoCache>());
builder.Services.AddSingleton<SnapshotFactory>();
builder.Services.AddSingleton<SamplingService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<SamplingService>());

var app = builder.Build();

var startupLog = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");

if (loaded.CreatedNew)
    startupLog.LogInformation("未找到 config.json，已生成默认配置");
if (loaded.PasswordUpgraded)
    startupLog.LogInformation("已将 config.json 中的明文密码转换为 PBKDF2 哈希");
if (loaded.GeneratedPassword is not null)
{
    startupLog.LogWarning("首次启动登录密码：{Password}（请登录后修改 config.json 的 auth.password 并重启）",
        loaded.GeneratedPassword);
    Console.WriteLine();
    Console.WriteLine("============================================================");
    Console.WriteLine($"  首次启动登录密码：{loaded.GeneratedPassword}");
    Console.WriteLine("  用户名：" + config.Auth.Username);
    Console.WriteLine("  请记录后删除控制台窗口，建议登录后在 config.json 中修改密码。");
    Console.WriteLine("============================================================");
    Console.WriteLine();
}

foreach (var warning in warnings)
    startupLog.LogWarning("{Warning}", warning);

var diagnostics = app.Services.GetRequiredService<StartupDiagnostics>();
startupLog.LogInformation(
    "HpServerMonitor v{Version} | {Os} | 管理员={Admin} | PawnIO={PawnIo}",
    typeof(Program).Assembly.GetName().Version?.ToString(3) ?? "1.0.0",
    diagnostics.OsName,
    diagnostics.IsAdministrator,
    diagnostics.PawnIoInstalled);
startupLog.LogInformation("HTTP 监听：http://{Bind}:{Port}", config.Server.Bind, config.Server.HttpPort);
if (config.Server.HttpsEnabled)
    startupLog.LogInformation("HTTPS 监听：https://{Bind}:{Port}", config.Server.Bind, config.Server.HttpsPort);

if (!diagnostics.IsAdministrator)
    startupLog.LogWarning("当前不是管理员权限，已进入只读降级模式：温度、风扇、功耗等传感器可能不可用");

if (!diagnostics.PawnIoInstalled)
    startupLog.LogWarning(
        "未检测到 PawnIO。LibreHardwareMonitor 0.9.6 需要它读取 CPU 温度/功耗、EC 风扇等；详见 README 的传感器排查章节");
else if (diagnostics.PawnIoRunning == false)
    startupLog.LogWarning("PawnIO 已安装但服务未运行，CPU 温度/功耗与 EC 风扇可能无法读取");

var forwarded = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
};
forwarded.KnownNetworks.Clear();
forwarded.KnownProxies.Clear();
// 只信任本机反代（Caddy/Nginx）传来的 X-Forwarded-*
forwarded.KnownProxies.Add(IPAddress.Loopback);
forwarded.KnownProxies.Add(IPAddress.IPv6Loopback);

app.UseForwardedHeaders(forwarded);
app.UseResponseCompression();
app.UseSecurityHeaders();
app.UseEmbeddedStaticFiles();
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(30) });
app.UseTokenAuth();
app.MapApi();
app.MapGet("/ws", async (HttpContext context, RealtimeHub hub, JwtService jwt, ILogger<RealtimeHub> logger) =>
{
    await hub.HandleAsync(context, jwt, logger);
});

app.Lifetime.ApplicationStarted.Register(() => startupLog.LogInformation("服务已就绪"));
app.Lifetime.ApplicationStopped.Register(() => startupLog.LogInformation("服务已停止"));

try
{
    await app.RunAsync();
    return 0;
}
catch (Exception ex)
{
    startupLog.LogCritical(ex, "服务异常退出");
    return 1;
}

static LogLevel ParseLevel(string? value)
    => Enum.TryParse<LogLevel>(value, true, out var level) ? level : LogLevel.Information;
