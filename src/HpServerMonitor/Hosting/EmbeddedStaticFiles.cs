using System.Reflection;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Http;

namespace HpServerMonitor.Hosting;

/// <summary>
/// 从程序集清单资源中提供 wwwroot 静态文件。
/// 发布后 exe 旁边不需要 wwwroot 目录，所有前端文件都在程序集里。
/// </summary>
public static class EmbeddedStaticFiles
{
    private const string Prefix = "web/";
    private static readonly Dictionary<string, byte[]> Files = Load();
    private static readonly Dictionary<string, string> Etags = BuildEtags();
    private static readonly Dictionary<string, string> ContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8",
        [".css"] = "text/css; charset=utf-8",
        [".js"] = "text/javascript; charset=utf-8",
        [".mjs"] = "text/javascript; charset=utf-8",
        [".json"] = "application/json; charset=utf-8",
        [".svg"] = "image/svg+xml",
        [".png"] = "image/png",
        [".ico"] = "image/x-icon",
        [".woff2"] = "font/woff2",
        [".txt"] = "text/plain; charset=utf-8"
    };

    public static IApplicationBuilder UseEmbeddedStaticFiles(this IApplicationBuilder app)
        => app.Use(async (context, next) =>
        {
            if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
            {
                await next();
                return;
            }

            var relative = NormalizePath(context.Request.Path.Value);
            if (relative is null || !Files.TryGetValue(relative, out var bytes))
            {
                await next();
                return;
            }

            var extension = Path.GetExtension(relative);
            context.Response.ContentType = ContentTypes.TryGetValue(extension, out var type)
                ? type
                : "application/octet-stream";
            context.Response.ContentLength = bytes.Length;
            context.Response.Headers.CacheControl = "no-cache";
            var etag = Etags[relative];
            context.Response.Headers.ETag = etag;

            if (context.Request.Headers.IfNoneMatch.ToString().Contains(etag, StringComparison.Ordinal))
            {
                context.Response.StatusCode = StatusCodes.Status304NotModified;
                context.Response.ContentLength = null;
                return;
            }

            if (HttpMethods.IsHead(context.Request.Method))
                return;

            await context.Response.Body.WriteAsync(bytes, context.RequestAborted);
        });

    private static string? NormalizePath(string? raw)
    {
        if (string.IsNullOrEmpty(raw) || raw == "/")
            return "index.html";

        string path;
        try
        {
            path = Uri.UnescapeDataString(raw);
        }
        catch
        {
            return null;
        }

        path = path.TrimStart('/').Replace('\\', '/');
        if (path.Length == 0)
            return "index.html";
        if (path.EndsWith('/'))
            path += "index.html";

        // 拒绝目录穿越；资源字典只做精确匹配，本身也不存在文件系统访问
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Any(s => s is "." or ".."))
            return null;

        return path;
    }

    /// <summary>按内容哈希生成 ETag；长度相同的改动也能让浏览器拿到新文件。</summary>
    private static Dictionary<string, string> BuildEtags()
        => Files.ToDictionary(
            pair => pair.Key,
            pair => $"\"{Convert.ToHexString(SHA256.HashData(pair.Value), 0, 8)}\"",
            StringComparer.Ordinal);

    private static Dictionary<string, byte[]> Load()
    {
        var result = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        var assembly = typeof(EmbeddedStaticFiles).Assembly;

        foreach (var name in assembly.GetManifestResourceNames())
        {
            if (!name.StartsWith(Prefix, StringComparison.Ordinal))
                continue;

            var key = name[Prefix.Length..].Replace('\\', '/');
            using var stream = assembly.GetManifestResourceStream(name);
            if (stream is null)
                continue;
            using var ms = new MemoryStream();
            stream.CopyTo(ms);
            result[key] = ms.ToArray();
        }

        return result;
    }
}
