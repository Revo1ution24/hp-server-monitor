using System.Text.RegularExpressions;
using LibreHardwareMonitor.Hardware;

namespace HpServerMonitor.DeviceReader.Support;

/// <summary>
/// 传感器查找与数值清洗。任何异常都在调用方或这里被吞掉，
/// 读不到就返回 null，让 UI 做降级展示。
/// </summary>
public static class SensorQuery
{
    private static readonly Regex CoreNumberRegex = new(@"#\s*(\d+)", RegexOptions.Compiled);

    public static IEnumerable<ISensor> OfType(IHardware hardware, SensorType type)
        => hardware.Sensors.Where(s => s.SensorType == type);

    public static ISensor? Find(IHardware hardware, SensorType type, params string[] names)
    {
        foreach (var name in names)
        {
            var sensor = hardware.Sensors.FirstOrDefault(s =>
                s.SensorType == type &&
                string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase));
            if (sensor is not null)
                return sensor;
        }
        return null;
    }

    public static ISensor? FindContains(IHardware hardware, SensorType type, params string[] fragments)
    {
        foreach (var fragment in fragments)
        {
            var sensor = hardware.Sensors.FirstOrDefault(s =>
                s.SensorType == type &&
                s.Name.Contains(fragment, StringComparison.OrdinalIgnoreCase));
            if (sensor is not null)
                return sensor;
        }
        return null;
    }

    public static float? Value(IHardware hardware, SensorType type, params string[] names)
        => ValueOf(Find(hardware, type, names));

    public static float? ValueContains(IHardware hardware, SensorType type, params string[] fragments)
        => ValueOf(FindContains(hardware, type, fragments));

    /// <summary>单个传感器的 Value getter 也要防御，坏驱动可能在这里抛异常。</summary>
    public static float? ValueOf(ISensor? sensor)
    {
        if (sensor is null)
            return null;
        try
        {
            return Finite(sensor.Value);
        }
        catch
        {
            return null;
        }
    }

    public static float? Sum(IEnumerable<ISensor> sensors)
    {
        var total = 0f;
        var any = false;
        foreach (var sensor in sensors)
        {
            var value = ValueOf(sensor);
            if (value is null)
                continue;
            total += value.Value;
            any = true;
        }
        return any ? total : null;
    }

    public static float? Average(IEnumerable<ISensor> sensors)
    {
        var total = 0f;
        var count = 0;
        foreach (var sensor in sensors)
        {
            var value = ValueOf(sensor);
            if (value is null)
                continue;
            total += value.Value;
            count++;
        }
        return count > 0 ? total / count : null;
    }

    public static float? Max(IEnumerable<ISensor> sensors)
    {
        float? max = null;
        foreach (var sensor in sensors)
        {
            var value = ValueOf(sensor);
            if (value is null)
                continue;
            if (max is null || value > max)
                max = value;
        }
        return max;
    }

    public static float? Finite(float? value)
        => value is { } v && float.IsFinite(v) ? v : null;

    /// <summary>温度只接受 0~150°C，过滤掉驱动返回的 0 / NaN / 异常大值。</summary>
    public static double? Temperature(float? value)
        => value is { } v && float.IsFinite(v) && v > 0 && v < 150 ? v : null;

    public static double? Percent(float? value)
        => value is { } v && float.IsFinite(v) ? Math.Clamp(v, 0, 100) : null;

    public static double? Positive(float? value)
        => value is { } v && float.IsFinite(v) && v > 0 ? v : null;

    public static double? NonNegative(float? value)
        => value is { } v && float.IsFinite(v) && v >= 0 ? v : null;

    public static long? MegabytesToBytes(float? value)
        => value is { } v && float.IsFinite(v) && v >= 0 ? (long)Math.Round(v * 1024d * 1024d) : null;

    public static int CoreNumber(string name)
    {
        var match = CoreNumberRegex.Match(name);
        return match.Success && int.TryParse(match.Groups[1].Value, out var number) ? number : 0;
    }

    public static bool IsCoreSensor(string name)
        => name.Contains("Core", StringComparison.OrdinalIgnoreCase) && CoreNumber(name) > 0;

    public static string VendorName(HardwareType type) => type switch
    {
        HardwareType.GpuNvidia => "NVIDIA",
        HardwareType.GpuAmd => "AMD",
        HardwareType.GpuIntel => "Intel",
        HardwareType.Cpu => "CPU",
        _ => "Unknown"
    };
}
