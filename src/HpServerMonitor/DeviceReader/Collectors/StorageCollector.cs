using System.Text.RegularExpressions;
using HpServerMonitor.DeviceReader.Models;
using HpServerMonitor.DeviceReader.Support;
using LibreHardwareMonitor.Hardware;

namespace HpServerMonitor.DeviceReader.Collectors;

public sealed class StorageCollector
{
    private static readonly Regex TrailingDigits = new(@"(\d+)\s*$", RegexOptions.Compiled);

    private readonly HardwareSession _session;
    private readonly SlowInfoCache _slow;
    private readonly SafeLog _safe;

    public StorageCollector(HardwareSession session, SlowInfoCache slow, SafeLog safe)
    {
        _session = session;
        _slow = slow;
        _safe = safe;
    }

    public List<DiskSnapshot> Collect()
    {
        var result = new List<DiskSnapshot>();
        try
        {
            var volumes = GetVolumes();
            var slowDisks = _slow.Disks.OrderBy(d => d.Index).ToArray();

            var hardware = _session.AllHardware()
                .Where(h => h.HardwareType == HardwareType.Storage)
                .ToArray();

            for (var i = 0; i < hardware.Length; i++)
            {
                var disk = hardware[i];
                try
                {
                    var slow = MatchSlowDisk(disk, slowDisks)
                               ?? (slowDisks.Length == hardware.Length ? slowDisks[i] : null);

                    var item = new DiskSnapshot
                    {
                        Id = disk.Identifier.ToString(),
                        Name = disk.Name,
                        Model = slow?.Model ?? disk.Name,
                        MediaType = slow?.MediaType,
                        HealthStatus = slow?.Status,
                        Temperature = FirstTemperature(disk),
                        HealthPercent = ReadHealth(disk),
                        ReadBytesPerSec = SensorQuery.NonNegative(
                            SensorQuery.Value(disk, SensorType.Throughput, "Read Rate")
                            ?? SensorQuery.ValueContains(disk, SensorType.Throughput, "Read Rate", "Read Speed")),
                        WriteBytesPerSec = SensorQuery.NonNegative(
                            SensorQuery.Value(disk, SensorType.Throughput, "Write Rate")
                            ?? SensorQuery.ValueContains(disk, SensorType.Throughput, "Write Rate", "Write Speed"))
                    };

                    ApplySpace(item, slow, volumes);
                    result.Add(item);
                }
                catch (Exception ex)
                {
                    _safe.Error($"disk-{disk.Identifier}", ex, $"存储 {disk.Name} 采集失败");
                }
            }

            // LHM 读不到 SMART/存储硬件时，用 WMI 物理盘兜底
            if (result.Count == 0)
            {
                foreach (var slow in slowDisks)
                {
                    var item = new DiskSnapshot
                    {
                        Id = $"wmi-{slow.Index}",
                        Name = slow.Model,
                        Model = slow.Model,
                        MediaType = slow.MediaType,
                        HealthStatus = slow.Status
                    };
                    ApplySpace(item, slow, volumes);
                    result.Add(item);
                }
            }

            // WMI 也不可用时，至少展示卷的容量
            if (result.Count == 0)
            {
                foreach (var volume in volumes.Values.OrderBy(v => v.Name))
                {
                    var letter = volume.Name.Length >= 2 ? volume.Name[..2] : volume.Name;
                    result.Add(new DiskSnapshot
                    {
                        Id = $"volume-{letter}",
                        Name = $"{letter} {volume.VolumeLabel}".Trim(),
                        Model = volume.DriveFormat,
                        TotalBytes = SafeTotal(volume),
                        FreeBytes = SafeFree(volume),
                        DriveLetters = { letter }
                    });
                }
            }
        }
        catch (Exception ex)
        {
            _safe.Error("storage-collect", ex, "存储采集失败");
        }

        return result;
    }

    private static void ApplySpace(
        DiskSnapshot item,
        PhysicalDiskInfo? slow,
        IReadOnlyDictionary<string, DriveInfo> volumes)
    {
        var letters = slow?.DriveLetters ?? Array.Empty<string>();
        item.DriveLetters.AddRange(letters);

        foreach (var letter in letters)
        {
            if (!volumes.TryGetValue(letter, out var volume))
                continue;
            var total = SafeTotal(volume);
            var free = SafeFree(volume);
            if (total is not null)
                item.TotalBytes = (item.TotalBytes ?? 0) + total;
            if (free is not null)
                item.FreeBytes = (item.FreeBytes ?? 0) + free;
        }

        if (item.TotalBytes is null && slow?.SizeBytes is > 0)
            item.TotalBytes = slow.SizeBytes;
    }

    private static PhysicalDiskInfo? MatchSlowDisk(IHardware hardware, PhysicalDiskInfo[] slowDisks)
    {
        if (slowDisks.Length == 0)
            return null;

        var identifier = hardware.Identifier.ToString();
        var match = TrailingDigits.Match(identifier);
        if (match.Success && int.TryParse(match.Groups[1].Value, out var index))
        {
            var byIndex = slowDisks.FirstOrDefault(d => d.Index == index);
            if (byIndex is not null)
                return byIndex;
        }

        var name = Normalize(hardware.Name);
        return slowDisks.FirstOrDefault(d =>
        {
            var model = Normalize(d.Model);
            return name.Length >= 3 && model.Length >= 3 &&
                   (name.Contains(model, StringComparison.Ordinal) || model.Contains(name, StringComparison.Ordinal));
        });
    }

    private static string Normalize(string? value)
        => new string((value ?? "").ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());

    private static double? FirstTemperature(IHardware hardware)
    {
        foreach (var sensor in SensorQuery.OfType(hardware, SensorType.Temperature))
        {
            var value = SensorQuery.Temperature(SensorQuery.ValueOf(sensor));
            if (value is not null)
                return value;
        }
        return null;
    }

    private static double? ReadHealth(IHardware hardware)
    {
        string[] names = { "Life", "Remaining Life", "Available Spare", "Wear Level", "Health" };
        foreach (var name in names)
        {
            var value = SensorQuery.Value(hardware, SensorType.Level, name);
            if (value is null)
                continue;
            var level = name.Contains("Wear", StringComparison.OrdinalIgnoreCase)
                ? 100 - value.Value
                : value.Value;
            return Math.Clamp(Math.Round(level, 1), 0, 100);
        }

        var contains = SensorQuery.ValueContains(hardware, SensorType.Level, "Life", "Wear");
        if (contains is null)
            return null;
        return Math.Clamp(Math.Round(contains.Value, 1), 0, 100);
    }

    private Dictionary<string, DriveInfo> GetVolumes()
    {
        var result = new Dictionary<string, DriveInfo>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var drive in DriveInfo.GetDrives())
            {
                try
                {
                    if (drive.DriveType != DriveType.Fixed || !drive.IsReady)
                        continue;
                    var letter = drive.Name.Length >= 2 ? drive.Name[..2] : drive.Name;
                    result[letter] = drive;
                }
                catch
                {
                    // 单个卷读取失败不影响其他卷
                }
            }
        }
        catch (Exception ex)
        {
            _safe.Warn("volumes", $"枚举卷失败：{ex.Message}");
        }
        return result;
    }

    private static long? SafeTotal(DriveInfo drive)
    {
        try { return drive.TotalSize; } catch { return null; }
    }

    private static long? SafeFree(DriveInfo drive)
    {
        try { return drive.TotalFreeSpace; } catch { return null; }
    }
}
