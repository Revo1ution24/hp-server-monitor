using System.Reflection;
using System.Text.Json;
using HpServerMonitor.Auth;
using HpServerMonitor.DeviceReader;
using HpServerMonitor.DeviceReader.Support;
using HpServerMonitor.Hosting;
using Microsoft.AspNetCore.Http;

namespace HpServerMonitor.Api;

public sealed record LoginRequest(string? Username, string? Password);

public static class ApiEndpoints
{
    public static void MapApi(this WebApplication app)
    {
        app.MapPost("/api/login", LoginAsync);
        app.MapGet("/api/health", Health);
        app.MapGet("/api/snapshot", SnapshotAsync);
        app.MapGet("/api/history", History);
    }

    private static async Task<IResult> LoginAsync(
        HttpContext context,
        AppConfig config,
        PasswordHasher hasher,
        JwtService jwt,
        LoginRateLimiter limiter,
        ILoggerFactory loggerFactory)
    {
        var logger = loggerFactory.CreateLogger("Api.Login");
        var remote = context.Connection.RemoteIpAddress;
        var ip = remote is null
            ? "unknown"
            : (remote.IsIPv4MappedToIPv6 ? remote.MapToIPv4() : remote).ToString();

        limiter.Cleanup();
        if (limiter.IsBlocked(ip, out var retryAfter))
        {
            context.Response.Headers.RetryAfter = retryAfter.ToString();
            return Results.Json(
                new { error = "尝试次数过多，请稍后再试", retryAfterSeconds = retryAfter },
                JsonDefaults.Api,
                statusCode: StatusCodes.Status429TooManyRequests);
        }

        LoginRequest? request;
        try
        {
            request = await context.Request.ReadFromJsonAsync<LoginRequest>(
                JsonDefaults.Api, context.RequestAborted);
        }
        catch (JsonException)
        {
            return Results.Json(new { error = "请求格式不正确" }, JsonDefaults.Api,
                statusCode: StatusCodes.Status400BadRequest);
        }
        catch (BadHttpRequestException)
        {
            return Results.Json(new { error = "请求格式不正确" }, JsonDefaults.Api,
                statusCode: StatusCodes.Status400BadRequest);
        }

        var username = request?.Username?.Trim() ?? "";
        var password = request?.Password ?? "";
        if (username.Length is 0 or > 64 || password.Length is 0 or > 256)
            return Results.Json(new { error = "用户名或密码错误" }, JsonDefaults.Api,
                statusCode: StatusCodes.Status401Unauthorized);

        var usernameOk = string.Equals(username, config.Auth.Username, StringComparison.Ordinal);
        // 即使用户名错误也执行一次 PBKDF2，避免通过响应时间枚举账号
        var passwordOk = hasher.Verify(password, config.Auth.PasswordHash);

        if (!usernameOk || !passwordOk)
        {
            limiter.RecordFailure(ip);
            logger.LogWarning("登录失败：IP={Ip}", ip);
            return Results.Json(new { error = "用户名或密码错误" }, JsonDefaults.Api,
                statusCode: StatusCodes.Status401Unauthorized);
        }

        limiter.Reset(ip);
        var (token, expiresAt) = jwt.Create(config.Auth.Username);
        context.Response.Headers.CacheControl = "no-store";
        logger.LogInformation("登录成功：IP={Ip}", ip);
        return Results.Json(new
        {
            token,
            expiresAt,
            username = config.Auth.Username
        }, JsonDefaults.Api);
    }

    private static IResult Health(SnapshotStore store)
    {
        var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.0.0";
        var status = !store.HasData
            ? "starting"
            : store.IsFresh(TimeSpan.FromSeconds(5)) ? "ok" : "degraded";

        return Results.Json(new
        {
            status,
            version,
            uptimeSeconds = (long)(Environment.TickCount64 / 1000),
            time = DateTimeOffset.Now
        }, JsonDefaults.Api);
    }

    private static async Task SnapshotAsync(HttpContext context, SnapshotStore store)
    {
        context.Response.Headers.CacheControl = "no-store";
        if (!store.HasData)
        {
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            context.Response.ContentType = "application/json; charset=utf-8";
            await context.Response.WriteAsync("{\"error\":\"采样尚未就绪\"}", context.RequestAborted);
            return;
        }

        context.Response.ContentType = "application/json; charset=utf-8";
        await context.Response.Body.WriteAsync(store.Json, context.RequestAborted);
    }

    private static IResult History(HttpContext context, HistoryStore history)
    {
        var metric = context.Request.Query["metric"].ToString();
        var range = context.Request.Query["range"].ToString();
        if (string.IsNullOrWhiteSpace(metric))
            return Results.Json(new { error = "缺少 metric 参数" }, JsonDefaults.Api,
                statusCode: StatusCodes.Status400BadRequest);

        var result = history.Query(metric, range, out var error);
        if (result is null)
            return Results.Json(new { error }, JsonDefaults.Api,
                statusCode: StatusCodes.Status400BadRequest);

        context.Response.Headers.CacheControl = "no-store";
        return Results.Json(result, JsonDefaults.Api);
    }
}
