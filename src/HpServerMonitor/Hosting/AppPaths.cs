namespace HpServerMonitor.Hosting;

/// <summary>
/// 程序运行目录。单文件发布时 BaseDirectory 就是 exe 所在目录，
/// 配置文件、日志、证书都相对它解析。
/// </summary>
public sealed class AppPaths
{
    public string BaseDirectory { get; }
    public string ConfigPath => Path.Combine(BaseDirectory, "config.json");
    public string LogsDirectory { get; }

    public AppPaths(string baseDirectory)
    {
        BaseDirectory = Path.GetFullPath(baseDirectory);
        LogsDirectory = Path.Combine(BaseDirectory, "logs");
        Directory.CreateDirectory(LogsDirectory);
    }

    public string Resolve(string path)
        => Path.IsPathRooted(path) ? path : Path.Combine(BaseDirectory, path);
}
