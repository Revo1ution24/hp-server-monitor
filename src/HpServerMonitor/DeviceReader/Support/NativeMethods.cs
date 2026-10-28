using System.Runtime.InteropServices;

namespace HpServerMonitor.DeviceReader.Support;

/// <summary>
/// 少量必要的 Win32 调用：精确内存、提交内存、进程/线程数、电池电源状态。
/// 这些调用都比每秒枚举 Process 或查询 WMI 便宜得多。
/// </summary>
public static class NativeMethods
{
    [StructLayout(LayoutKind.Sequential)]
    private struct MEMORYSTATUSEX
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PERFORMANCE_INFORMATION
    {
        public uint cb;
        public nuint CommitTotal;
        public nuint CommitLimit;
        public nuint CommitPeak;
        public nuint PhysicalTotal;
        public nuint PhysicalAvailable;
        public nuint SystemCache;
        public nuint KernelTotal;
        public nuint KernelPaged;
        public nuint KernelNonpaged;
        public nuint PageSize;
        public uint HandleCount;
        public uint ProcessCount;
        public uint ThreadCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SYSTEM_POWER_STATUS
    {
        public byte ACLineStatus;
        public byte BatteryFlag;
        public byte BatteryLifePercent;
        public byte SystemStatusFlag;
        public uint BatteryLifeTime;
        public uint BatteryFullLifeTime;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SERVICE_STATUS
    {
        public uint ServiceType;
        public uint CurrentState;
        public uint ControlsAccepted;
        public uint Win32ExitCode;
        public uint ServiceSpecificExitCode;
        public uint CheckPoint;
        public uint WaitHint;
    }

    private const uint ScManagerConnect = 0x0001;
    private const uint ServiceQueryStatus = 0x0004;
    private const uint ServiceRunning = 0x00000004;

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);

    [DllImport("psapi.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetPerformanceInfo(out PERFORMANCE_INFORMATION pPerformanceInformation, uint cb);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS lpSystemPowerStatus);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr OpenSCManagerW(string? machineName, string? databaseName, uint desiredAccess);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr OpenServiceW(IntPtr scManager, string serviceName, uint desiredAccess);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryServiceStatus(IntPtr service, ref SERVICE_STATUS status);

    [DllImport("advapi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseServiceHandle(IntPtr handle);

    public readonly record struct MemoryStatus(bool Ok, long TotalBytes, long AvailableBytes, double LoadPercent);

    public readonly record struct PerformanceStatus(
        bool Ok,
        long CommitTotalBytes,
        long CommitLimitBytes,
        int ProcessCount,
        int ThreadCount);

    public readonly record struct PowerStatus(
        bool Ok,
        bool OnAc,
        bool BatteryPresent,
        bool Charging,
        double? ChargePercent,
        double? SecondsRemaining);

    public static MemoryStatus GetMemoryStatus()
    {
        try
        {
            var status = new MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>() };
            if (!GlobalMemoryStatusEx(ref status))
                return new MemoryStatus(false, 0, 0, 0);

            return new MemoryStatus(
                true,
                checked((long)status.ullTotalPhys),
                checked((long)status.ullAvailPhys),
                status.dwMemoryLoad);
        }
        catch
        {
            return new MemoryStatus(false, 0, 0, 0);
        }
    }

    public static PerformanceStatus GetPerformanceStatus()
    {
        try
        {
            var size = (uint)Marshal.SizeOf<PERFORMANCE_INFORMATION>();
            if (!GetPerformanceInfo(out var info, size))
                return new PerformanceStatus(false, 0, 0, 0, 0);

            var pageSize = info.PageSize == 0 ? 4096UL : (ulong)info.PageSize;
            return new PerformanceStatus(
                true,
                checked((long)((ulong)info.CommitTotal * pageSize)),
                checked((long)((ulong)info.CommitLimit * pageSize)),
                (int)info.ProcessCount,
                (int)info.ThreadCount);
        }
        catch
        {
            return new PerformanceStatus(false, 0, 0, 0, 0);
        }
    }

    /// <summary>查询服务是否正在运行；服务不存在或无权查询时返回 null。</summary>
    public static bool? IsServiceRunning(string serviceName)
    {
        var scm = IntPtr.Zero;
        var service = IntPtr.Zero;
        try
        {
            scm = OpenSCManagerW(null, null, ScManagerConnect);
            if (scm == IntPtr.Zero)
                return null;

            service = OpenServiceW(scm, serviceName, ServiceQueryStatus);
            if (service == IntPtr.Zero)
                return null;

            var status = new SERVICE_STATUS();
            return QueryServiceStatus(service, ref status) ? status.CurrentState == ServiceRunning : null;
        }
        catch
        {
            return null;
        }
        finally
        {
            if (service != IntPtr.Zero)
                CloseServiceHandle(service);
            if (scm != IntPtr.Zero)
                CloseServiceHandle(scm);
        }
    }

    public static PowerStatus GetPowerStatus()
    {
        try
        {
            if (!GetSystemPowerStatus(out var status))
                return new PowerStatus(false, false, false, false, null, null);

            var noBattery = status.BatteryFlag == 128 || status.BatteryFlag == 255;
            var present = !noBattery;
            var percent = status.BatteryLifePercent <= 100 ? status.BatteryLifePercent : (byte?)null;
            double? seconds = status.BatteryLifeTime == uint.MaxValue ? null : status.BatteryLifeTime;
            var charging = (status.BatteryFlag & 8) != 0;

            return new PowerStatus(
                true,
                status.ACLineStatus == 1,
                present,
                charging,
                percent,
                seconds);
        }
        catch
        {
            return new PowerStatus(false, false, false, false, null, null);
        }
    }
}
