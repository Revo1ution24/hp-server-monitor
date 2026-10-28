#requires -Version 5.1
<#
.SYNOPSIS
    Install, uninstall, start or stop HpServerMonitor.

.DESCRIPTION
    Default mode is a Windows service running as LocalSystem (has administrator
    rights for sensor access). -Mode Task registers an AtStartup scheduled task
    with highest privileges instead.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install-service.ps1 -Action Install -Mode Service
    powershell -ExecutionPolicy Bypass -File .\install-service.ps1 -Action Install -Mode Task -OpenFirewall
    powershell -ExecutionPolicy Bypass -File .\install-service.ps1 -Action Status
#>
[CmdletBinding()]
param(
    [ValidateSet('Install', 'Uninstall', 'Start', 'Stop', 'Status')]
    [string]$Action = 'Install',

    [ValidateSet('Service', 'Task')]
    [string]$Mode = 'Service',

    [string]$Source = $PSScriptRoot,
    [string]$InstallDir = 'C:\HpServerMonitor',
    [switch]$OpenFirewall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$serviceName = 'HpServerMonitor'
$taskName = 'HpServerMonitor'
$scriptVersion = '1.0.6'

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'This script must run in an elevated PowerShell (Run as Administrator).'
    }
}

<#
    config.json 保存 JWT 密钥与密码哈希，默认继承安装目录权限时普通用户可读。
    这里把安装目录收紧到 SYSTEM / Administrators，新写入的 config.json 也会继承该权限。
#>
function Set-RestrictedPermissions {
    param([string]$Path)

    if (-not (Test-Path $Path)) { return }

    $full = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
    $root = [System.IO.Path]::GetPathRoot($full).TrimEnd('\')
    $protected = @(
        [Environment]::GetFolderPath([System.Environment+SpecialFolder]::Windows),
        [Environment]::GetFolderPath([System.Environment+SpecialFolder]::ProgramFiles),
        [Environment]::GetFolderPath([System.Environment+SpecialFolder]::ProgramFilesX86),
        [Environment]::GetFolderPath([System.Environment+SpecialFolder]::CommonApplicationData),
        [Environment]::GetFolderPath([System.Environment+SpecialFolder]::UserProfile)
    ) | Where-Object { $_ } | ForEach-Object { [System.IO.Path]::GetFullPath($_).TrimEnd('\') }

    if ($full -eq $root -or $protected -contains $full) {
        Write-Host "Skip ACL hardening for protected path: $full" -ForegroundColor Yellow
        return
    }

    # 先接管目录：即使旧 ACL 被清空、当前管理员不是所有者，也能继续改 DACL
    & takeown.exe /f $full /r /d y | Out-Null

    # 先把目录和子项重置为继承默认值：修复历史遗留的显式 ACL / 空 DACL
    & icacls.exe $full /reset /T /C | Out-Null

    # 再给目录加显式权限。注意不要对 /grant 使用 /T：
    # (OI)(CI) 是目录专用标志，直接套到文件上会把文件 ACL 清空。
    & icacls.exe $full /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /C | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Warning: failed to grant ACL on $full (icacls exit $LASTEXITCODE); keep inherited permissions" -ForegroundColor Yellow
        return
    }

    # 最后只去掉目录本身的继承；子项保留从显式 ACE 继承来的 F
    & icacls.exe $full /inheritance:r /C | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Warning: failed to remove inheritance on $full (icacls exit $LASTEXITCODE)" -ForegroundColor Yellow
    }
    else {
        Write-Host "Restricted ACL to SYSTEM/Administrators: $full" -ForegroundColor Cyan
    }
}

function Get-ExePath {
    return (Join-Path $InstallDir 'HpServerMonitor.exe')
}

function Get-HttpPort {
    $configPath = Join-Path $InstallDir 'config.json'
    try {
        if (Test-Path -LiteralPath $configPath -ErrorAction Stop) {
            $config = Get-Content -LiteralPath $configPath -Raw -ErrorAction Stop | ConvertFrom-Json
            if ($null -ne $config.server -and $config.server.httpPort) {
                return [int]$config.server.httpPort
            }
        }
    }
    catch {
        # 配置暂时不可读时不要中断安装，回退默认端口即可
        Write-Host "Warning: cannot read $configPath, fallback to 8080: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    return 8080
}

function Stop-Existing {
    & sc.exe stop $serviceName 2>$null | Out-Null
    for ($i = 0; $i -lt 10; $i++) {
        $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
        if ($null -eq $service -or $service.Status -eq 'Stopped') { break }
        Start-Sleep -Seconds 1
    }
    & sc.exe delete $serviceName 2>$null | Out-Null
    Start-Sleep -Seconds 2

    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($null -ne $task) {
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}

function Install-Files {
    if (-not (Test-Path $Source)) {
        throw "Source directory not found: $Source"
    }

    $sourceExe = Join-Path $Source 'HpServerMonitor.exe'
    $sourceResolved = (Resolve-Path $Source).Path
    $targetFull = [System.IO.Path]::GetFullPath($InstallDir)

    if ($sourceResolved -ne $targetFull) {
        if (-not (Test-Path $sourceExe)) {
            throw "HpServerMonitor.exe not found in $Source. Run build.ps1 first."
        }
        New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
        Copy-Item $sourceExe (Join-Path $InstallDir 'HpServerMonitor.exe') -Force

        $sourceConfig = Join-Path $Source 'config.json'
        $targetConfig = Join-Path $InstallDir 'config.json'
        if ((Test-Path $sourceConfig) -and -not (Test-Path $targetConfig)) {
            Copy-Item $sourceConfig $targetConfig -Force
            Write-Host 'Copied config.json (initial password will be generated on first run).' -ForegroundColor Yellow
        }
        $sourceReadme = Join-Path $Source 'README.md'
        if (Test-Path $sourceReadme) {
            Copy-Item $sourceReadme (Join-Path $InstallDir 'README.md') -Force
        }
    }

    if (-not (Test-Path (Get-ExePath))) {
        throw "HpServerMonitor.exe not found in $InstallDir"
    }

    New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'logs') | Out-Null
    Set-RestrictedPermissions $InstallDir
}

function Install-Service {
    $exe = Get-ExePath
    $binPath = '"' + $exe + '"'

    & sc.exe create $serviceName binPath= $binPath start= auto DisplayName= 'HP Server Monitor' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "sc.exe create failed with exit code $LASTEXITCODE"
    }

    & sc.exe description $serviceName 'Home server health monitor (HTTP API + WebSocket + embedded UI).' | Out-Null
    & sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
    & sc.exe start $serviceName | Out-Null
    Start-Sleep -Seconds 2

    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -eq $service) {
        throw 'Service was created but cannot be queried.'
    }
    Write-Host "Service status: $($service.Status)" -ForegroundColor Cyan
}

function Install-Task {
    $exe = Get-ExePath
    $action = New-ScheduledTaskAction -Execute $exe -WorkingDirectory $InstallDir
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -MultipleInstances IgnoreNew

    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger $trigger `
        -Principal $principal `
        -Settings $settings `
        -Description 'Home server health monitor (runs at startup with highest privileges).' | Out-Null

    Start-ScheduledTask -TaskName $taskName
    Write-Host 'Scheduled task registered and started.' -ForegroundColor Cyan
}

function Add-FirewallRule {
    $port = Get-HttpPort
    $displayName = "HpServerMonitor LAN $port"
    $existing = Get-NetFirewallRule -DisplayName $displayName -ErrorAction SilentlyContinue
    if ($null -eq $existing) {
        New-NetFirewallRule `
            -DisplayName $displayName `
            -Direction Inbound `
            -Protocol TCP `
            -LocalPort $port `
            -Action Allow `
            -Profile Private | Out-Null
    }
    Write-Host "Firewall rule ready for TCP $port (Private profile)." -ForegroundColor Cyan
}

function Show-Status {
    Write-Host '--- Service ---' -ForegroundColor Cyan
    & sc.exe query $serviceName
    Write-Host ''
    Write-Host '--- Scheduled task ---' -ForegroundColor Cyan
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($null -eq $task) {
        Write-Host 'Not registered.'
    }
    else {
        $task | Select-Object TaskName, State | Format-Table -AutoSize
    }
}

Assert-Administrator
Write-Host "install-service.ps1 v$scriptVersion" -ForegroundColor DarkGray

switch ($Action) {
    'Install' {
        # Stop and remove the old service/task first so the exe is not locked.
        Stop-Existing
        Install-Files

        if ($Mode -eq 'Service') {
            Install-Service
        }
        else {
            Install-Task
        }

        if ($OpenFirewall) {
            Add-FirewallRule
        }

        $port = Get-HttpPort
        Write-Host ''
        Write-Host 'Install complete.' -ForegroundColor Green
        Write-Host "  Mode      : $Mode"
        Write-Host "  Directory : $InstallDir"
        Write-Host "  Config    : $(Join-Path $InstallDir 'config.json')"
        Write-Host "  Logs      : $(Join-Path $InstallDir 'logs')"
        Write-Host "  URL       : http://127.0.0.1:$port"
        Write-Host ''
        Write-Host 'Initial password: see logs\hpmonitor.log or run the exe once in a console.' -ForegroundColor Yellow
    }
    'Uninstall' {
        Stop-Existing
        Write-Host 'Service/task removed. Files in the install directory were kept.' -ForegroundColor Green
    }
    'Start' {
        if ($Mode -eq 'Service') {
            & sc.exe start $serviceName | Out-Null
        }
        else {
            Start-ScheduledTask -TaskName $taskName
        }
        Write-Host 'Start requested.' -ForegroundColor Green
    }
    'Stop' {
        if ($Mode -eq 'Service') {
            & sc.exe stop $serviceName | Out-Null
        }
        else {
            Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        }
        Write-Host 'Stop requested.' -ForegroundColor Green
    }
    'Status' {
        Show-Status
    }
}
