using Microsoft.AspNetCore.Http;

namespace HpServerMonitor.Hosting;

/// <summary>统一追加安全响应头。</summary>
public static class SecurityHeaders
{
    private const string Csp =
        "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; " +
        "img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
        "connect-src 'self' ws: wss:; font-src 'self'";

    public static IApplicationBuilder UseSecurityHeaders(this IApplicationBuilder app)
        => app.Use(async (context, next) =>
        {
            var headers = context.Response.Headers;
            headers["X-Content-Type-Options"] = "nosniff";
            headers["X-Frame-Options"] = "DENY";
            headers["Referrer-Policy"] = "no-referrer";
            headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
            headers["Content-Security-Policy"] = Csp;

            if (context.Request.IsHttps)
                headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";

            await next();
        });
}
