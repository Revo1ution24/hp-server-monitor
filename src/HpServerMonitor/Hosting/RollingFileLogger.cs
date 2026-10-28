using System.Collections.Concurrent;
using System.Text;
using System.Threading.Channels;

namespace HpServerMonitor.Hosting;

/// <summary>
/// 轻量滚动文件日志：异步队列写入，单文件达到上限后轮转，
/// 保留 maxFiles 个文件（当前文件 + 备份）。
/// </summary>
public sealed class RollingFileLoggerProvider : ILoggerProvider
{
    private readonly LogWriter _writer;
    private readonly LogLevel _minimumLevel;

    public RollingFileLoggerProvider(AppPaths paths, LoggingConfig config)
    {
        _minimumLevel = ParseLevel(config.MinimumLevel);
        var directory = paths.Resolve(config.Directory);
        Directory.CreateDirectory(directory);
        var file = Path.Combine(directory, "hpmonitor.log");
        _writer = new LogWriter(file, Math.Max(1, config.MaxFileSizeMb) * 1024L * 1024L, Math.Max(2, config.MaxFiles));
    }

    public ILogger CreateLogger(string categoryName) => new FileLogger(categoryName, _writer, _minimumLevel);

    public void Dispose() => _writer.Dispose();

    private static LogLevel ParseLevel(string? value)
        => Enum.TryParse<LogLevel>(value, true, out var level) ? level : LogLevel.Information;

    private sealed class FileLogger : ILogger
    {
        private readonly string _category;
        private readonly LogWriter _writer;
        private readonly LogLevel _minimumLevel;

        public FileLogger(string category, LogWriter writer, LogLevel minimumLevel)
        {
            _category = category;
            _writer = writer;
            _minimumLevel = minimumLevel;
        }

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;

        public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None && logLevel >= _minimumLevel;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel))
                return;

            var message = formatter(state, exception);
            var sb = new StringBuilder(160);
            sb.Append(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff"))
              .Append(" [")
              .Append(LevelText(logLevel))
              .Append("] ")
              .Append(_category)
              .Append(": ")
              .Append(message);

            if (exception is not null)
            {
                sb.AppendLine();
                sb.Append(exception);
            }

            _writer.Enqueue(sb.ToString());
        }

        private static string LevelText(LogLevel level) => level switch
        {
            LogLevel.Trace => "TRACE",
            LogLevel.Debug => "DEBUG",
            LogLevel.Information => "INFO ",
            LogLevel.Warning => "WARN ",
            LogLevel.Error => "ERROR",
            LogLevel.Critical => "FATAL",
            _ => "NONE "
        };
    }

    private sealed class NullScope : IDisposable
    {
        public static readonly NullScope Instance = new();
        public void Dispose() { }
    }

    private sealed class LogWriter : IDisposable
    {
        private readonly string _path;
        private readonly long _maxBytes;
        private readonly int _maxFiles;
        private readonly Channel<string> _channel;
        private readonly Task _worker;
        private readonly CancellationTokenSource _cts = new();
        private StreamWriter? _stream;
        private long _length;

        public LogWriter(string path, long maxBytes, int maxFiles)
        {
            _path = path;
            _maxBytes = maxBytes;
            _maxFiles = maxFiles;
            _channel = Channel.CreateBounded<string>(new BoundedChannelOptions(4096)
            {
                SingleReader = true,
                SingleWriter = false,
                FullMode = BoundedChannelFullMode.DropOldest
            });
            _worker = Task.Run(WriteLoopAsync);
        }

        public void Enqueue(string line) => _channel.Writer.TryWrite(line);

        private async Task WriteLoopAsync()
        {
            try
            {
                Open();
                await foreach (var line in _channel.Reader.ReadAllAsync(_cts.Token))
                {
                    try
                    {
                        var bytes = Encoding.UTF8.GetByteCount(line) + Environment.NewLine.Length;
                        if (_length > 0 && _length + bytes > _maxBytes)
                            Rotate();

                        await _stream!.WriteLineAsync(line);
                        _length += bytes;
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine($"[HpServerMonitor] 写日志失败: {ex.Message}");
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // 正常停止
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[HpServerMonitor] 日志线程异常退出: {ex}");
            }
            finally
            {
                try { _stream?.Dispose(); } catch { }
                _stream = null;
            }
        }

        private void Open()
        {
            _stream?.Dispose();
            var exists = File.Exists(_path);
            _length = exists ? new FileInfo(_path).Length : 0;
            var stream = new FileStream(_path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite, 16 * 1024);
            _stream = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true };
        }

        private void Rotate()
        {
            _stream?.Dispose();
            _stream = null;

            for (var i = _maxFiles - 1; i >= 1; i--)
            {
                var destination = $"{_path}.{i}";
                var source = i == 1 ? _path : $"{_path}.{i - 1}";

                if (i == _maxFiles - 1 && File.Exists(destination))
                    File.Delete(destination);

                if (File.Exists(source))
                    File.Move(source, destination, overwrite: true);
            }

            _length = 0;
            var stream = new FileStream(_path, FileMode.Create, FileAccess.Write, FileShare.ReadWrite, 16 * 1024);
            _stream = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true };
        }

        public void Dispose()
        {
            _channel.Writer.TryComplete();
            try { _worker.Wait(TimeSpan.FromSeconds(3)); } catch { }
            _cts.Cancel();
            _cts.Dispose();
            try { _stream?.Dispose(); } catch { }
        }
    }
}
