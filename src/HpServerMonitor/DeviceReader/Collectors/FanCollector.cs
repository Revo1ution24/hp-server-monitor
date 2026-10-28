using HpServerMonitor.DeviceReader.Models;
using HpServerMonitor.DeviceReader.Support;
using LibreHardwareMonitor.Hardware;

namespace HpServerMonitor.DeviceReader.Collectors;

public sealed class FanCollector
{
    private readonly HardwareSession _session;
    private readonly SlowInfoCache _slow;
    private readonly SafeLog _safe;

    public FanCollector(HardwareSession session, SlowInfoCache slow, SafeLog safe)
    {
        _session = session;
        _slow = slow;
        _safe = safe;
    }

    public List<FanSnapshot> Collect()
    {
        var result = new List<FanSnapshot>();
        try
        {
            foreach (var hardware in _session.AllHardware())
            {
                try
                {
                    var fans = SensorQuery.OfType(hardware, SensorType.Fan).ToArray();
                    var controls = SensorQuery.OfType(hardware, SensorType.Control).ToArray();
                    if (fans.Length == 0 && controls.Length == 0)
                        continue;

                    var usedControls = new HashSet<ISensor>();

                    foreach (var fan in fans)
                    {
                        var rpm = SensorQuery.NonNegative(SensorQuery.ValueOf(fan));
                        if (rpm is null)
                            continue;

                        var number = SensorQuery.CoreNumber(fan.Name);
                        var control = FindControl(controls, fan, number);
                        if (control is not null)
                            usedControls.Add(control);

                        result.Add(new FanSnapshot
                        {
                            Id = $"{hardware.Identifier}/{fan.Identifier}",
                            Name = fan.Name,
                            Hardware = hardware.Name,
                            Rpm = rpm,
                            Percent = control is null ? null : SensorQuery.Percent(SensorQuery.ValueOf(control)),
                            Source = "lhm"
                        });
                    }

                    // 只有占空比、没有转速的 EC 也展示出来
                    foreach (var control in controls)
                    {
                        if (usedControls.Contains(control))
                            continue;
                        var percent = SensorQuery.Percent(SensorQuery.ValueOf(control));
                        if (percent is null)
                            continue;

                        result.Add(new FanSnapshot
                        {
                            Id = $"{hardware.Identifier}/{control.Identifier}",
                            Name = control.Name,
                            Hardware = hardware.Name,
                            Percent = percent,
                            Source = "lhm"
                        });
                    }
                }
                catch (Exception ex)
                {
                    _safe.Error($"fan-{hardware.Identifier}", ex, $"风扇 {hardware.Name} 采集失败");
                }
            }
        }
        catch (Exception ex)
        {
            _safe.Error("fan-collect", ex, "风扇采集失败");
        }

        // 第 2 层降级：LHM 没有 Fan/Control 传感器时，使用缓存的 WMI Win32_Fan。
        if (result.Count == 0)
        {
            try
            {
                var index = 0;
                foreach (var fan in _slow.WmiFans)
                {
                    index++;
                    result.Add(new FanSnapshot
                    {
                        Id = $"wmi-fan-{index}",
                        Name = fan.Name,
                        Hardware = "WMI Win32_Fan",
                        Rpm = fan.Rpm,
                        Source = "wmi"
                    });
                }
            }
            catch (Exception ex)
            {
                _safe.Error("fan-wmi", ex, "WMI 风扇降级失败");
            }
        }

        return result;
    }

    private static ISensor? FindControl(ISensor[] controls, ISensor fan, int number)
    {
        if (number > 0)
        {
            var byNumber = controls.FirstOrDefault(c => SensorQuery.CoreNumber(c.Name) == number);
            if (byNumber is not null)
                return byNumber;
        }

        var fanName = fan.Name.Replace("Control", "", StringComparison.OrdinalIgnoreCase).Trim();
        return controls.FirstOrDefault(c =>
            string.Equals(c.Name, fanName, StringComparison.OrdinalIgnoreCase) ||
            c.Name.Contains(fanName, StringComparison.OrdinalIgnoreCase) ||
            fanName.Contains(c.Name, StringComparison.OrdinalIgnoreCase));
    }
}
