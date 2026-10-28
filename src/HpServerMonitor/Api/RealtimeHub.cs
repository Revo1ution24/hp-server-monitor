using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using HpServerMonitor.Auth;
using HpServerMonitor.Hosting;
using Microsoft.AspNetCore.Http;

namespace HpServerMonitor.Api;

/// <summary>
/// WebSocket 连接管理。每 tick 只生成一份 JSON，所有客户端复用；
/// 每个连接有独立的小容量发送队列，慢客户端只丢旧帧，不阻塞采样线程。
/// </summary>
public sealed class RealtimeHub
{
    private const string SubProtocol = "hpmon";
    private static readonly byte[] PongMessage = Encoding.UTF8.GetBytes("{\"type\":\"pong\"}");
    private static readonly string AppVersion =
        typeof(RealtimeHub).Assembly.GetName().Version?.ToString(3) ?? "1.0.0";

    private readonly ConcurrentDictionary<Guid, Client> _clients = new();

    public int ClientCount => _clients.Count;

    public void Broadcast(ReadOnlyMemory<byte> message)
    {
        foreach (var client in _clients.Values)
            client.Enqueue(message);
    }

    public async Task HandleAsync(HttpContext context, JwtService jwt, ILogger<RealtimeHub> logger)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        var token = ExtractToken(context);
        if (!jwt.TryValidate(token, out var username, out var error))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.Headers.CacheControl = "no-store";
            await context.Response.WriteAsync(
                $"{{\"error\":\"未登录或登录已过期\",\"detail\":\"{error}\"}}",
                context.RequestAborted);
            return;
        }

        var protocols = context.WebSockets.WebSocketRequestedProtocols;
        var selected = protocols.Contains(SubProtocol, StringComparer.OrdinalIgnoreCase) ? SubProtocol : null;

        using var socket = selected is null
            ? await context.WebSockets.AcceptWebSocketAsync()
            : await context.WebSockets.AcceptWebSocketAsync(selected);

        var id = Guid.NewGuid();
        var client = new Client(socket);
        _clients[id] = client;
        client.Enqueue(HelloMessage());
        logger.LogInformation("WebSocket 已连接：{User}（{Count} 个客户端）", username, _clients.Count);

        var sendTask = client.SendLoopAsync(context.RequestAborted);
        try
        {
            await ReceiveLoopAsync(socket, client, context.RequestAborted);
        }
        catch (OperationCanceledException)
        {
            // 客户端关闭或服务停止
        }
        catch (WebSocketException ex)
        {
            logger.LogDebug(ex, "WebSocket 接收循环结束");
        }
        finally
        {
            _clients.TryRemove(id, out _);
            client.Complete();
            try { await sendTask.WaitAsync(TimeSpan.FromSeconds(2)); } catch { }
            try
            {
                if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
                    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None);
            }
            catch { }
            logger.LogInformation("WebSocket 已断开：{User}（剩余 {Count} 个）", username, _clients.Count);
        }
    }

    private static async Task ReceiveLoopAsync(WebSocket socket, Client client, CancellationToken cancellationToken)
    {
        var buffer = new byte[4096];
        while (socket.State == WebSocketState.Open)
        {
            var result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close)
                break;

            if (result.MessageType == WebSocketMessageType.Text && result.Count > 0 && result.EndOfMessage)
            {
                var text = Encoding.UTF8.GetString(buffer, 0, result.Count);
                if (text.Contains("\"ping\"", StringComparison.Ordinal))
                    client.Enqueue(PongMessage);
            }
        }
    }

    private static string? ExtractToken(HttpContext context)
    {
        var query = context.Request.Query["token"].ToString();
        if (!string.IsNullOrWhiteSpace(query))
            return query;

        // 浏览器 WebSocket 不能自定义 Header，用 subprotocol 列表携带 token
        return context.WebSockets.WebSocketRequestedProtocols
            .FirstOrDefault(p => !string.Equals(p, SubProtocol, StringComparison.OrdinalIgnoreCase));
    }

    private static byte[] HelloMessage()
        => JsonSerializer.SerializeToUtf8Bytes(new
        {
            type = "hello",
            server = "HpServerMonitor",
            version = AppVersion,
            time = DateTimeOffset.Now
        }, JsonDefaults.Api);

    private sealed class Client
    {
        private readonly WebSocket _socket;
        private readonly Channel<ReadOnlyMemory<byte>> _queue;

        public Client(WebSocket socket)
        {
            _socket = socket;
            _queue = Channel.CreateBounded<ReadOnlyMemory<byte>>(new BoundedChannelOptions(2)
            {
                SingleReader = true,
                SingleWriter = false,
                FullMode = BoundedChannelFullMode.DropOldest
            });
        }

        public void Enqueue(ReadOnlyMemory<byte> message)
            => _queue.Writer.TryWrite(message);

        public void Complete()
            => _queue.Writer.TryComplete();

        public async Task SendLoopAsync(CancellationToken cancellationToken)
        {
            try
            {
                await foreach (var message in _queue.Reader.ReadAllAsync(cancellationToken))
                {
                    if (_socket.State != WebSocketState.Open)
                        break;
                    await _socket.SendAsync(message, WebSocketMessageType.Text, true, cancellationToken);
                }
            }
            catch (OperationCanceledException)
            {
            }
            catch (WebSocketException)
            {
            }
        }
    }
}
