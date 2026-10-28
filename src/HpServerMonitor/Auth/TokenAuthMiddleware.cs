using HpServerMonitor.Hosting;

namespace HpServerMonitor.Auth;

/// <summary>
/// /api/* 的 Bearer 校验。登录和健康检查公开，其余接口必须带有效 JWT。
/// WebSocket 在 RealtimeHub 内单独校验。
/// </summary>
public sealed class TokenAuthMiddleware
{
    private readonly RequestDelegate _next;
    private readonly JwtService _jwt;

    public TokenAuthMiddleware(RequestDelegate next, JwtService jwt)
    {
        _next = next;
        _jwt = jwt;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path;
        if (path.StartsWithSegments("/api") && !IsPublic(path))
        {
            var header = context.Request.Headers.Authorization.ToString();
            if (!header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                await UnauthorizedAsync(context, "缺少访问令牌");
                return;
            }

            var token = header["Bearer ".Length..].Trim();
            if (!_jwt.TryValidate(token, out var username, out var error))
            {
                await UnauthorizedAsync(context, error);
                return;
            }

            context.Items["hpmon.user"] = username;
        }

        await _next(context);
    }

    private static bool IsPublic(PathString path)
        => path.Value is "/api/login" or "/api/health";

    private static async Task UnauthorizedAsync(HttpContext context, string detail)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Headers.CacheControl = "no-store";
        var safe = detail.Replace("\"", "'", StringComparison.Ordinal);
        await context.Response.WriteAsync(
            $"{{\"error\":\"未登录或登录已过期\",\"detail\":\"{safe}\"}}",
            context.RequestAborted);
    }
}

public static class TokenAuthExtensions
{
    public static IApplicationBuilder UseTokenAuth(this IApplicationBuilder app)
        => app.UseMiddleware<TokenAuthMiddleware>();
}
