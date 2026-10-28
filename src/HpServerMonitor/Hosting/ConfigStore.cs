using System.Security.Cryptography;
using System.Text.Json;
using HpServerMonitor.Auth;

namespace HpServerMonitor.Hosting;

public sealed record ConfigLoadResult(AppConfig Config, string? GeneratedPassword, bool CreatedNew, bool PasswordUpgraded);

/// <summary>
/// config.json 的读写与首次启动初始化。
/// 首次启动会生成随机密码和 JWT 密钥，并立即写回文件。
/// </summary>
public sealed class ConfigStore
{
    private readonly AppPaths _paths;
    private readonly PasswordHasher _hasher;
    private readonly object _gate = new();

    public ConfigStore(AppPaths paths, PasswordHasher hasher)
    {
        _paths = paths;
        _hasher = hasher;
    }

    public ConfigLoadResult LoadOrCreate()
    {
        lock (_gate)
        {
            var created = !File.Exists(_paths.ConfigPath);
            AppConfig config;

            if (created)
            {
                config = new AppConfig();
            }
            else
            {
                var text = File.ReadAllText(_paths.ConfigPath);
                try
                {
                    config = JsonSerializer.Deserialize<AppConfig>(text, JsonDefaults.Config)
                             ?? throw new InvalidOperationException("config.json 内容为空。");
                }
                catch (JsonException ex)
                {
                    throw new InvalidOperationException($"config.json 解析失败：{ex.Message}", ex);
                }
            }

            config.Normalize();

            var changed = created;
            var passwordUpgraded = false;
            string? generatedPassword = null;

            // 明文初始密码 → PBKDF2 哈希，随后清空明文
            if (!string.IsNullOrWhiteSpace(config.Auth.Password))
            {
                config.Auth.PasswordHash = _hasher.Hash(config.Auth.Password);
                config.Auth.Password = "";
                changed = true;
                passwordUpgraded = true;
            }

            // 首次启动且没有提供任何密码：生成 16 位随机密码
            if (string.IsNullOrWhiteSpace(config.Auth.PasswordHash))
            {
                generatedPassword = GeneratePassword(16);
                config.Auth.PasswordHash = _hasher.Hash(generatedPassword);
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(config.Auth.JwtSecret))
            {
                config.Auth.JwtSecret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
                changed = true;
            }

            // 兜底校验，避免用户手改出非法 Base64
            try
            {
                var key = Convert.FromBase64String(config.Auth.JwtSecret);
                if (key.Length < 32)
                    throw new FormatException();
            }
            catch
            {
                config.Auth.JwtSecret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
                changed = true;
            }

            if (changed)
                Save(config);

            return new ConfigLoadResult(config, generatedPassword, created, passwordUpgraded);
        }
    }

    public void Save(AppConfig config)
    {
        lock (_gate)
        {
            var json = JsonSerializer.Serialize(config, JsonDefaults.Config);
            var temp = _paths.ConfigPath + ".tmp";
            File.WriteAllText(temp, json);
            try
            {
                ClearReadOnly(_paths.ConfigPath);
                File.Move(temp, _paths.ConfigPath, overwrite: true);
            }
            catch (Exception ex) when (ex is UnauthorizedAccessException or IOException)
            {
                // 旧版文档建议过只读/仅 R,W 的 ACL，Move 覆盖会因缺少 DELETE 失败
                try { File.Delete(temp); } catch { }
                ClearReadOnly(_paths.ConfigPath);
                File.WriteAllText(_paths.ConfigPath, json);
            }
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

    private static string GeneratePassword(int length)
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
        var chars = new char[length];
        for (var i = 0; i < length; i++)
            chars[i] = alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)];
        return new string(chars);
    }
}
