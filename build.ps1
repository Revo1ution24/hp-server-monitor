#requires -Version 5.1
<#
.SYNOPSIS
    Build HpServerMonitor as a self-contained single-file Windows executable.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\build.ps1
    powershell -ExecutionPolicy Bypass -File .\build.ps1 -Output D:\dist
#>
[CmdletBinding()]
param(
    [string]$Configuration = 'Release',
    [string]$Output = 'dist',
    [string]$Runtime = 'win-x64'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = Join-Path $root 'src\HpServerMonitor\HpServerMonitor.csproj'
$outputPath = if ([System.IO.Path]::IsPathRooted($Output)) { $Output } else { Join-Path $root $Output }

if (-not (Test-Path $project)) {
    throw "Project not found: $project"
}

$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if ($null -eq $dotnet) {
    throw 'dotnet SDK not found. Install .NET 8 SDK or newer.'
}

Write-Host "Publishing HpServerMonitor ($Configuration / $Runtime)..." -ForegroundColor Cyan

& dotnet publish $project `
    -c $Configuration `
    -r $Runtime `
    --self-contained true `
    -o $outputPath `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:EnableCompressionInSingleFile=false `
    -p:DebugType=None `
    -p:DebugSymbols=false `
    --nologo

if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE"
}

# Create runtime folders / config without overwriting an existing config
New-Item -ItemType Directory -Force -Path (Join-Path $outputPath 'logs') | Out-Null

$example = Join-Path $root 'config.example.json'
$targetConfig = Join-Path $outputPath 'config.json'
if ((Test-Path $example) -and -not (Test-Path $targetConfig)) {
    Copy-Item $example $targetConfig -Force
    Write-Host "Created config.json from config.example.json" -ForegroundColor Yellow
}

$readme = Join-Path $root 'README.md'
if (Test-Path $readme) {
    Copy-Item $readme (Join-Path $outputPath 'README.md') -Force
}

$installer = Join-Path $root 'install-service.ps1'
if (Test-Path $installer) {
    Copy-Item $installer (Join-Path $outputPath 'install-service.ps1') -Force
}

$caddyfile = Join-Path $root 'Caddyfile'
if (Test-Path $caddyfile) {
    Copy-Item $caddyfile (Join-Path $outputPath 'Caddyfile') -Force
}

$exe = Join-Path $outputPath 'HpServerMonitor.exe'
if (-not (Test-Path $exe)) {
    throw "Publish completed but exe was not found: $exe"
}

$sizeMb = [Math]::Round((Get-Item $exe).Length / 1MB, 1)
Write-Host ''
Write-Host 'App build complete.' -ForegroundColor Green
Write-Host "  Exe : $exe ($sizeMb MB)"

# 图形安装器：把主程序作为载荷内嵌，产出单个 HpServerMonitorSetup.exe
$installerProject = Join-Path $root 'src\HpServerMonitor.Installer\HpServerMonitorSetup.csproj'
if (Test-Path $installerProject) {
    Write-Host ''
    Write-Host 'Publishing setup wizard...' -ForegroundColor Cyan

    $installerStage = Join-Path $outputPath '_setup'
    & dotnet publish $installerProject `
        -c $Configuration `
        -r $Runtime `
        --self-contained true `
        -o $installerStage `
        -p:PublishSingleFile=true `
        -p:IncludeNativeLibrariesForSelfExtract=true `
        -p:EnableCompressionInSingleFile=true `
        -p:DebugType=None `
        -p:DebugSymbols=false `
        -p:PayloadExe="$exe" `
        --nologo

    if ($LASTEXITCODE -ne 0) {
        throw "Setup wizard publish failed with exit code $LASTEXITCODE"
    }

    $setup = Join-Path $installerStage 'HpServerMonitorSetup.exe'
    if (-not (Test-Path $setup)) {
        throw "Setup wizard exe was not found: $setup"
    }

    Copy-Item $setup (Join-Path $outputPath 'HpServerMonitorSetup.exe') -Force
    Remove-Item $installerStage -Recurse -Force

    $setupMb = [Math]::Round((Get-Item (Join-Path $outputPath 'HpServerMonitorSetup.exe')).Length / 1MB, 1)
    Write-Host "  Setup : $(Join-Path $outputPath 'HpServerMonitorSetup.exe') ($setupMb MB)" -ForegroundColor Green
}

Write-Host ''
Write-Host 'Build complete.' -ForegroundColor Green
Write-Host "  Dir : $outputPath"
Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Cyan
Write-Host '  1. Copy HpServerMonitorSetup.exe to the target machine and run it as Administrator.'
Write-Host '  2. Follow the wizard: install dir, bind/port, account, service, optional Caddy install/takeover.'
Write-Host '  3. For manual deployment run HpServerMonitor.exe once and use install-service.ps1.'
