namespace HpServerMonitor.DeviceReader.Models;

public sealed class Snapshot
{
    public DateTimeOffset Ts { get; set; }
    public long Seq { get; set; }
    public SystemSnapshot System { get; set; } = new();
    public CpuSnapshot Cpu { get; set; } = new();
    public MemorySnapshot Memory { get; set; } = new();
    public List<GpuSnapshot> Gpus { get; set; } = new();
    public List<DiskSnapshot> Disks { get; set; } = new();
    public List<FanSnapshot> Fans { get; set; } = new();
    public NetworkSnapshot Network { get; set; } = new();
    public BatterySnapshot Battery { get; set; } = new();
    public EnvironmentSnapshot Env { get; set; } = new();
    public StatusSnapshot Status { get; set; } = new();
}

public sealed class SystemSnapshot
{
    public string? Hostname { get; set; }
    public string? OsName { get; set; }
    public string? OsVersion { get; set; }
    public double? UptimeSeconds { get; set; }
    public DateTimeOffset? BootTime { get; set; }
    public string? CpuModel { get; set; }
    public string? Board { get; set; }
    public string? Bios { get; set; }
    public string? AppVersion { get; set; }
}

public sealed class CpuSnapshot
{
    public string? Model { get; set; }
    public int? PhysicalCores { get; set; }
    public int? LogicalCores { get; set; }
    public double? Load { get; set; }
    /// <summary>PDH % Processor Utility 口径，可能超过 100%；与 Load（时间占用）并列展示。</summary>
    public double? LoadUtility { get; set; }
    public List<CoreValue> CoreLoads { get; set; } = new();
    public double? FreqMhz { get; set; }
    public double? FreqMinMhz { get; set; }
    public double? FreqMaxMhz { get; set; }
    public double? FreqEffectiveMhz { get; set; }
    public double? Multiplier { get; set; }
    public double? BusClockMhz { get; set; }
    public double? TempPackage { get; set; }
    public double? TempMax { get; set; }
    public List<CoreValue> TempCores { get; set; } = new();
    public double? PowerPackage { get; set; }
    public double? Voltage { get; set; }
    public int? ProcessCount { get; set; }
    public int? ThreadCount { get; set; }
}

public sealed class CoreValue
{
    public int Index { get; set; }
    public double? Value { get; set; }
}

public sealed class MemorySnapshot
{
    public long? TotalBytes { get; set; }
    public long? UsedBytes { get; set; }
    public long? FreeBytes { get; set; }
    public double? Load { get; set; }
    public double? SpeedMhz { get; set; }
    public int? SlotsUsed { get; set; }
    public int? SlotCount { get; set; }
    public string? ModuleType { get; set; }
    public long? CommitTotalBytes { get; set; }
    public long? CommitLimitBytes { get; set; }
    public long? PageFileUsedBytes { get; set; }
}

public sealed class GpuSnapshot
{
    public string? Name { get; set; }
    public string? Vendor { get; set; }
    public double? Load { get; set; }
    public double? Temp { get; set; }
    public double? ClockMhz { get; set; }
    public long? MemUsedBytes { get; set; }
    public long? MemTotalBytes { get; set; }
    public double? FanRpm { get; set; }
    public double? PowerW { get; set; }
}

public sealed class DiskSnapshot
{
    public string Id { get; set; } = "";
    public string? Name { get; set; }
    public string? Model { get; set; }
    public string? MediaType { get; set; }
    public double? Temperature { get; set; }
    public double? HealthPercent { get; set; }
    public string? HealthStatus { get; set; }
    public long? TotalBytes { get; set; }
    public long? FreeBytes { get; set; }
    public double? ReadBytesPerSec { get; set; }
    public double? WriteBytesPerSec { get; set; }
    public List<string> DriveLetters { get; set; } = new();
}

public sealed class FanSnapshot
{
    public string Id { get; set; } = "";
    public string? Name { get; set; }
    public string? Hardware { get; set; }
    public double? Rpm { get; set; }
    public double? Percent { get; set; }
    /// <summary>lhm / wmi；用于 UI 标识降级来源。</summary>
    public string? Source { get; set; }
}

public sealed class NetworkSnapshot
{
    public double? UploadBytesPerSec { get; set; }
    public double? DownloadBytesPerSec { get; set; }
    public long? TotalUploadedBytes { get; set; }
    public long? TotalDownloadedBytes { get; set; }
    public string? PublicIpv6 { get; set; }
    public List<string> Ipv6Addresses { get; set; } = new();
    public List<AdapterSnapshot> Adapters { get; set; } = new();
}

public sealed class AdapterSnapshot
{
    public string? Name { get; set; }
    public string? Description { get; set; }
    public string? Status { get; set; }
    public string? Mac { get; set; }
    public long? SpeedBps { get; set; }
    public List<string> Ipv4 { get; set; } = new();
    public List<string> Ipv6 { get; set; } = new();
}

public sealed class BatterySnapshot
{
    public bool Present { get; set; }
    public double? ChargePercent { get; set; }
    public bool? Charging { get; set; }
    public bool? OnAc { get; set; }
    public double? DesignCapacityMwh { get; set; }
    public double? FullChargeCapacityMwh { get; set; }
    public double? HealthPercent { get; set; }
    public double? Voltage { get; set; }
    public double? PowerW { get; set; }
    public double? TimeRemainingSeconds { get; set; }
}

public sealed class EnvironmentSnapshot
{
    public double? BoardTemp { get; set; }
    public double? ChipsetTemp { get; set; }
    public double? CaseTemp { get; set; }
    public double? VrmTemp { get; set; }
    public List<SensorValue> Extras { get; set; } = new();
    /// <summary>MSAcpi_ThermalZoneTemperature 热区温度，作为 ACPI 兜底。</summary>
    public List<SensorValue> ThermalZones { get; set; } = new();
}

public sealed class SensorValue
{
    public string? Name { get; set; }
    public double? Value { get; set; }
}

public sealed class StatusSnapshot
{
    public bool Admin { get; set; }
    public bool ReadOnly { get; set; }
    public bool PawnIo { get; set; }
    public bool? PawnIoRunning { get; set; }
    public bool LhmAvailable { get; set; }
    public string? LhmError { get; set; }
    public int ReadErrors { get; set; }
    public long TotalReadErrors { get; set; }
    public List<string> SensorsMissing { get; set; } = new();
    /// <summary>启动至今从未读到过的字段，通常表示该机型/驱动不提供此传感器。</summary>
    public List<string> SensorsUnsupported { get; set; } = new();
    public long SamplingMs { get; set; }
    public int Clients { get; set; }
    public string? FanSource { get; set; }
    public int WmiFanCount { get; set; }
    public int AcpiThermalZoneCount { get; set; }
}
