using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using HpServerMonitor.DeviceReader.Models;
using HpServerMonitor.DeviceReader.Support;
using LibreHardwareMonitor.Hardware;

namespace HpServerMonitor.DeviceReader.Collectors;

public sealed class NetworkCollector
{
    private readonly HardwareSession _session;
    private readonly SafeLog _safe;
    private long _lastSent = -1;
    private long _lastReceived = -1;
    private long _lastTicks;

    public NetworkCollector(HardwareSession session, SafeLog safe)
    {
        _session = session;
        _safe = safe;
    }

    public NetworkSnapshot Collect()
    {
        var result = new NetworkSnapshot();
        try
        {
            long totalSent = 0;
            long totalReceived = 0;
            var anyStats = false;
            var ipv6Globals = new List<string>();

            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel)
                    continue;
                if (nic.OperationalStatus != OperationalStatus.Up)
                    continue;
                if (IsVirtualFilter(nic.Description))
                    continue;

                try
                {
                    var adapter = new AdapterSnapshot
                    {
                        Name = nic.Name,
                        Description = nic.Description,
                        Status = nic.OperationalStatus.ToString(),
                        Mac = FormatMac(nic.GetPhysicalAddress()),
                        SpeedBps = nic.Speed > 0 ? nic.Speed : null
                    };

                    IPInterfaceProperties properties;
                    try { properties = nic.GetIPProperties(); }
                    catch { properties = null!; }

                    if (properties is not null)
                    {
                        foreach (var address in properties.UnicastAddresses)
                        {
                            var ip = address.Address;
                            if (ip.AddressFamily == AddressFamily.InterNetwork)
                            {
                                if (!ip.ToString().StartsWith("169.254.", StringComparison.Ordinal))
                                    adapter.Ipv4.Add(ip.ToString());
                            }
                            else if (ip.AddressFamily == AddressFamily.InterNetworkV6)
                            {
                                if (IPAddress.IsLoopback(ip) || ip.IsIPv6LinkLocal)
                                    continue;
                                var text = ip.ToString();
                                adapter.Ipv6.Add(text);
                                if (IsPublicIpv6(ip))
                                    ipv6Globals.Add(text);
                            }
                        }
                    }

                    // 没有地址的虚拟网卡（WAN Miniport、过滤驱动等）不展示
                    if (adapter.Ipv4.Count == 0 && adapter.Ipv6.Count == 0)
                        continue;

                    long sent = 0;
                    long received = 0;
                    try
                    {
                        // .NET 的 NetworkInterface 只提供 IPv4 接口计数器；
                        // 家庭网络绝大多数流量走 IPv4，IPv6 实时速率仍由 LHM 提供。
                        var v4 = nic.GetIPv4Statistics();
                        sent += v4.BytesSent;
                        received += v4.BytesReceived;
                    }
                    catch { }

                    totalSent += sent;
                    totalReceived += received;
                    anyStats = true;
                    result.Adapters.Add(adapter);
                }
                catch (Exception ex)
                {
                    _safe.Warn($"nic-{nic.Id}", $"网卡 {nic.Name} 读取失败：{ex.Message}");
                }
            }

            result.Adapters = result.Adapters.OrderBy(a => a.Name).ToList();
            if (anyStats)
            {
                result.TotalUploadedBytes = totalSent;
                result.TotalDownloadedBytes = totalReceived;
            }

            result.Ipv6Addresses = ipv6Globals.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            result.PublicIpv6 = result.Ipv6Addresses.FirstOrDefault();

            var displayedNames = result.Adapters
                .Select(a => a.Name)
                .Where(n => !string.IsNullOrWhiteSpace(n))
                .Cast<string>()
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var (lhmUp, lhmDown) = ReadLhmRates(displayedNames);
            var (deltaUp, deltaDown) = ComputeDelta(anyStats ? totalSent : null, anyStats ? totalReceived : null);

            result.UploadBytesPerSec = PickRate(lhmUp, deltaUp);
            result.DownloadBytesPerSec = PickRate(lhmDown, deltaDown);
        }
        catch (Exception ex)
        {
            _safe.Error("network-collect", ex, "网络采集失败");
        }

        return result;
    }

    private (double? Up, double? Down) ReadLhmRates(HashSet<string> displayedNames)
    {
        double? up = null;
        double? down = null;
        try
        {
            var hardware = _session.AllHardware()
                .Where(h => h.HardwareType == HardwareType.Network)
                .ToArray();
            // LHM 会把 QoS/WFP 虚拟层也当成网卡，优先只统计 UI 展示的物理网卡
            var matched = hardware.Where(h => displayedNames.Contains(h.Name)).ToArray();
            if (matched.Length > 0)
                hardware = matched;

            foreach (var nic in hardware)
            {
                var u = SensorQuery.Value(nic, SensorType.Throughput, "Upload Speed");
                var d = SensorQuery.Value(nic, SensorType.Throughput, "Download Speed");
                if (u is not null)
                    up = (up ?? 0) + u;
                if (d is not null)
                    down = (down ?? 0) + d;
            }
        }
        catch
        {
            // LHM 网络传感器不可用时使用网卡计数器差值
        }
        return (up, down);
    }

    private (double? Up, double? Down) ComputeDelta(long? sent, long? received)
    {
        var now = Environment.TickCount64;
        double? up = null;
        double? down = null;

        if (sent is not null && received is not null && _lastTicks > 0 && _lastSent >= 0 && _lastReceived >= 0)
        {
            var seconds = (now - _lastTicks) / 1000d;
            if (seconds > 0.05 && sent >= _lastSent && received >= _lastReceived)
            {
                up = (sent.Value - _lastSent) / seconds;
                down = (received.Value - _lastReceived) / seconds;
            }
        }

        if (sent is not null)
            _lastSent = sent.Value;
        if (received is not null)
            _lastReceived = received.Value;
        _lastTicks = now;
        return (up, down);
    }

    private static double? PickRate(double? lhm, double? delta)
    {
        if (lhm is > 0)
            return lhm;
        if (delta is >= 0)
            return delta;
        return lhm ?? delta;
    }

    private static bool IsPublicIpv6(IPAddress ip)
    {
        if (ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6Teredo || ip.IsIPv6Multicast)
            return false;

        var bytes = ip.GetAddressBytes();
        // fc00::/7 是唯一本地地址，不属于公网
        if ((bytes[0] & 0xFE) == 0xFC)
            return false;
        return true;
    }

    private static bool IsVirtualFilter(string? description)
    {
        if (string.IsNullOrWhiteSpace(description))
            return false;

        string[] markers =
        {
            "WAN Miniport", "QoS Packet Scheduler", "Filter Driver",
            "Native WiFi Filter", "Virtual WiFi Filter", "Kernel Debug",
            "WFP ", "Packet Scheduler"
        };
        return markers.Any(marker => description.Contains(marker, StringComparison.OrdinalIgnoreCase));
    }

    private static string? FormatMac(PhysicalAddress? address)
    {
        if (address is null)
            return null;
        var bytes = address.GetAddressBytes();
        return bytes.Length == 0 ? null : string.Join(":", bytes.Select(b => b.ToString("X2")));
    }
}
