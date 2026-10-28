using HpServerMonitor.DeviceReader.Models;
using HpServerMonitor.DeviceReader.Support;
using LibreHardwareMonitor.Hardware;

namespace HpServerMonitor.DeviceReader.Collectors;

public sealed class BatteryCollector
{
    private readonly SlowInfoCache _slow;
    private readonly HardwareSession _session;
    private readonly SafeLog _safe;

    public BatteryCollector(SlowInfoCache slow, HardwareSession session, SafeLog safe)
    {
        _slow = slow;
        _session = session;
        _safe = safe;
    }

    public BatterySnapshot Collect()
    {
        var result = new BatterySnapshot();
        try
        {
            var power = NativeMethods.GetPowerStatus();
            var capacity = _slow.Battery;
            var battery = _session.Find(HardwareType.Battery);

            var charge = power.ChargePercent;
            if (charge is null && battery is not null)
            {
                charge = SensorQuery.Percent(
                    SensorQuery.Value(battery, SensorType.Load, "Charge Level", "Charge")
                    ?? SensorQuery.Value(battery, SensorType.Level, "Charge Level"));
            }

            var design = capacity.DesignMwh;
            var full = capacity.FullChargeMwh;

            result.Present = (power.Ok && power.BatteryPresent) || design is > 0 || full is > 0 || battery is not null;
            result.ChargePercent = charge;
            result.Charging = power.Ok ? power.Charging : null;
            result.OnAc = power.Ok ? power.OnAc : null;
            result.DesignCapacityMwh = design;
            result.FullChargeCapacityMwh = full;
            result.TimeRemainingSeconds = power.SecondsRemaining;

            if (design is > 0 && full is > 0)
                result.HealthPercent = Math.Clamp(Math.Round(full.Value / design.Value * 100, 1), 0, 150);

            if (battery is not null)
            {
                result.Voltage = SensorQuery.Positive(
                    SensorQuery.Value(battery, SensorType.Voltage, "Voltage", "Battery Voltage"));
                var powerValue = SensorQuery.Value(battery, SensorType.Power, "Power", "Battery Power");
                if (powerValue is not null && float.IsFinite(powerValue.Value))
                    result.PowerW = Math.Abs(powerValue.Value);
            }

            if (!result.Present)
            {
                result.ChargePercent = null;
                result.Charging = null;
                result.OnAc = null;
            }
        }
        catch (Exception ex)
        {
            _safe.Error("battery-collect", ex, "电池采集失败");
        }

        return result;
    }
}
