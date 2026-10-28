using HpServerMonitor.DeviceReader.Models;
using HpServerMonitor.DeviceReader.Support;
using LibreHardwareMonitor.Hardware;
using SensorValue = HpServerMonitor.DeviceReader.Models.SensorValue;

namespace HpServerMonitor.DeviceReader.Collectors;

public sealed class EnvironmentCollector
{
    private readonly HardwareSession _session;
    private readonly SlowInfoCache _slow;
    private readonly SafeLog _safe;

    public EnvironmentCollector(HardwareSession session, SlowInfoCache slow, SafeLog safe)
    {
        _session = session;
        _slow = slow;
        _safe = safe;
    }

    public EnvironmentSnapshot Collect()
    {
        var result = new EnvironmentSnapshot();
        try
        {
            var all = new List<(string Hardware, string Name, double Value)>();

            foreach (var hardware in _session.AllHardware())
            {
                if (hardware.HardwareType is HardwareType.Cpu
                    or HardwareType.GpuNvidia
                    or HardwareType.GpuAmd
                    or HardwareType.GpuIntel
                    or HardwareType.Storage
                    or HardwareType.Network
                    or HardwareType.Battery)
                    continue;

                try
                {
                    foreach (var sensor in SensorQuery.OfType(hardware, SensorType.Temperature))
                    {
                        var value = SensorQuery.Temperature(SensorQuery.ValueOf(sensor));
                        if (value is not null)
                            all.Add((hardware.Name, sensor.Name, value.Value));
                    }
                }
                catch (Exception ex)
                {
                    _safe.Error($"env-{hardware.Identifier}", ex, $"环境温度 {hardware.Name} 读取失败");
                }
            }

            var extras = new List<(string Hardware, string Name, double Value)>();
            foreach (var item in all)
            {
                var name = item.Name.ToLowerInvariant();
                if (result.ChipsetTemp is null && (name.Contains("chipset") || name.Contains("pch")))
                {
                    result.ChipsetTemp = item.Value;
                }
                else if (result.VrmTemp is null && name.Contains("vrm"))
                {
                    result.VrmTemp = item.Value;
                }
                else if (result.CaseTemp is null &&
                         (name.Contains("ambient") || name.Contains("case") ||
                          name.Contains("chassis") || name.Contains("room")))
                {
                    result.CaseTemp = item.Value;
                }
                else if (result.BoardTemp is null &&
                         (name.Contains("system") || name.Contains("motherboard") ||
                          name.Contains("mainboard") || name.Contains("board")))
                {
                    result.BoardTemp = item.Value;
                }
                else
                {
                    extras.Add(item);
                }
            }

            // 没有可识别的名字时，取主板/EC 下第一个有效温度作为主板温度
            if (result.BoardTemp is null && all.Count > 0)
            {
                result.BoardTemp = all[0].Value;
                extras.RemoveAll(x => x.Hardware == all[0].Hardware && x.Name == all[0].Name);
            }

            var duplicateNames = all.GroupBy(x => x.Name, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.Count(), StringComparer.OrdinalIgnoreCase);

            result.Extras = extras
                .GroupBy(item => $"{item.Hardware}/{item.Name}", StringComparer.OrdinalIgnoreCase)
                .Select(g => g.First())
                .OrderBy(item => item.Name)
                .Take(8)
                .Select(item => new SensorValue
                {
                    Name = duplicateNames[item.Name] > 1 ? $"{item.Hardware} · {item.Name}" : item.Name,
                    Value = item.Value
                })
                .ToList();

            // 第 2 层温度兜底：ACPI 热区（不是核心温度，UI 单独标注）
            result.ThermalZones = _slow.ThermalZones
                .Select(zone => new SensorValue
                {
                    Name = zone.Name,
                    Value = zone.TempC
                })
                .ToList();
        }
        catch (Exception ex)
        {
            _safe.Error("env-collect", ex, "环境温度采集失败");
        }

        return result;
    }
}
