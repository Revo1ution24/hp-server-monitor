using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using HpServerMonitor.Hosting;

namespace HpServerMonitor.Auth;

/// <summary>
/// 手写的最小 JWT（HS256）实现，避免为了一个令牌引入额外依赖。
/// 只支持本站需要的 sub / iss / iat / nbf / exp / jti 字段。
/// </summary>
public sealed class JwtService
{
    private const string Issuer = "hpmon";
    private readonly byte[] _key;
    private readonly int _tokenHours;

    public JwtService(AppConfig config)
    {
        _key = Convert.FromBase64String(config.Auth.JwtSecret);
        if (_key.Length < 32)
            throw new InvalidOperationException("config.json 中的 auth.jwtSecret 至少需要 32 字节（Base64 解码后）。");
        _tokenHours = config.Auth.TokenHours;
    }

    public (string Token, DateTimeOffset ExpiresAt) Create(string username)
    {
        var now = DateTimeOffset.UtcNow;
        var expires = now.AddHours(_tokenHours);

        var header = Base64UrlEncode(JsonSerializer.SerializeToUtf8Bytes(new { alg = "HS256", typ = "JWT" }));
        var payload = Base64UrlEncode(JsonSerializer.SerializeToUtf8Bytes(new
        {
            sub = username,
            iss = Issuer,
            iat = now.ToUnixTimeSeconds(),
            nbf = now.AddSeconds(-5).ToUnixTimeSeconds(),
            exp = expires.ToUnixTimeSeconds(),
            jti = Guid.NewGuid().ToString("N")
        }));

        var signingInput = Encoding.ASCII.GetBytes($"{header}.{payload}");
        var signature = HMACSHA256.HashData(_key, signingInput);
        return ($"{header}.{payload}.{Base64UrlEncode(signature)}", expires);
    }

    public bool TryValidate(string? token, out string username, out string error)
    {
        username = "";
        error = "";

        if (string.IsNullOrWhiteSpace(token))
        {
            error = "缺少令牌";
            return false;
        }

        var parts = token.Split('.');
        if (parts.Length != 3)
        {
            error = "令牌格式不正确";
            return false;
        }

        try
        {
            var signingInput = Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}");
            var expected = HMACSHA256.HashData(_key, signingInput);
            var actual = Base64UrlDecode(parts[2]);
            if (!CryptographicOperations.FixedTimeEquals(expected, actual))
            {
                error = "令牌签名无效";
                return false;
            }

            using var doc = JsonDocument.Parse(Base64UrlDecode(parts[1]));
            var root = doc.RootElement;

            if (!root.TryGetProperty("iss", out var iss) || iss.GetString() != Issuer)
            {
                error = "令牌签发者无效";
                return false;
            }

            if (!root.TryGetProperty("sub", out var sub) || string.IsNullOrWhiteSpace(sub.GetString()))
            {
                error = "令牌缺少用户";
                return false;
            }

            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            if (!root.TryGetProperty("exp", out var exp) || exp.GetInt64() <= now)
            {
                error = "令牌已过期";
                return false;
            }

            if (root.TryGetProperty("nbf", out var nbf) && nbf.GetInt64() > now + 30)
            {
                error = "令牌尚未生效";
                return false;
            }

            username = sub.GetString()!;
            return true;
        }
        catch
        {
            error = "令牌无法解析";
            return false;
        }
    }

    private static string Base64UrlEncode(byte[] data)
        => Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] Base64UrlDecode(string value)
    {
        var s = value.Replace('-', '+').Replace('_', '/');
        s = (s.Length % 4) switch
        {
            2 => s + "==",
            3 => s + "=",
            _ => s
        };
        return Convert.FromBase64String(s);
    }
}
