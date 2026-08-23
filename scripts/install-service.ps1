# Installs the WorkPulse agent as a Windows Service.
#
# This is the production auto-start path: it starts before any user logs in,
# survives logout, and Windows Service Recovery restarts it if it dies.
#
# REQUIRES ADMINISTRATOR. For a per-user install with no elevation, use:
#     WorkPulseAgent.exe --install-user
#
# Usage (from an elevated PowerShell):
#     .\scripts\install-service.ps1
#     .\scripts\install-service.ps1 -AgentPath 'C:\Program Files\WorkPulse\WorkPulseAgent.exe'
#     .\scripts\install-service.ps1 -Uninstall

[CmdletBinding()]
param(
    [string]$AgentPath,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$ServiceName = 'WorkPulseAgent'

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
    Write-Error @'
This script needs Administrator rights to register a Windows Service.

Either re-run it from an elevated PowerShell, or install the per-user
logon task instead, which needs no elevation:

    WorkPulseAgent.exe --install-user
'@
    exit 1
}

# --- uninstall -------------------------------------------------------------

if ($Uninstall) {
    $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $existing) {
        Write-Output "The '$ServiceName' service is not installed."
        exit 0
    }

    if ($existing.Status -ne 'Stopped') {
        Write-Output 'Stopping the service...'
        Stop-Service -Name $ServiceName -Force
    }

    sc.exe delete $ServiceName | Out-Null
    Write-Output "Removed the '$ServiceName' service."
    exit 0
}

# --- locate the agent ------------------------------------------------------

if (-not $AgentPath) {
    $candidates = @(
        (Join-Path $PSScriptRoot '..\agent\target\release\WorkPulseAgent.exe'),
        'C:\Program Files\WorkPulse\WorkPulseAgent.exe'
    )
    $AgentPath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not $AgentPath -or -not (Test-Path $AgentPath)) {
    Write-Error @"
Could not find WorkPulseAgent.exe.

Build it first:
    npm run agent:build

Or pass the path explicitly:
    .\scripts\install-service.ps1 -AgentPath 'C:\path\to\WorkPulseAgent.exe'
"@
    exit 1
}

$AgentPath = (Resolve-Path $AgentPath).Path
Write-Output "Agent: $AgentPath"

# The device must be enrolled before the service can report anything.
$identityPath = Join-Path $env:ProgramData 'WorkPulse\identity.bin'
if (-not (Test-Path $identityPath)) {
    Write-Warning @"
This device is not enrolled yet, so the service will start and immediately
have nothing to report. Enrol it first:

    "$AgentPath" --enroll --server <URL> --user-id <ID> --password <PW>
"@
}

# --- install ---------------------------------------------------------------

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Output "Replacing the existing '$ServiceName' service..."
    if ($existing.Status -ne 'Stopped') { Stop-Service -Name $ServiceName -Force }
    sc.exe delete $ServiceName | Out-Null
    # The SCM needs a moment before the name can be reused.
    Start-Sleep -Seconds 2
}

# binPath must be a single argument; the inner quotes protect a path that
# contains spaces, such as "C:\Program Files\".
$binPath = '"{0}" --service' -f $AgentPath

sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= 'WorkPulse Activity Agent' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "sc.exe create failed with exit code $LASTEXITCODE" }

sc.exe description $ServiceName 'Reports application activity, idle state and attendance to WorkPulse. Does not record keystrokes, screen contents, microphone or webcam.' | Out-Null

# Recovery (spec section 4): restart after 5s, then 10s, then every 30s,
# with the failure counter resetting daily.
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null

Write-Output 'Starting the service...'
Start-Service -Name $ServiceName

$service = Get-Service -Name $ServiceName
Write-Output ''
Write-Output "Installed '$ServiceName'."
Write-Output "  Status      : $($service.Status)"
Write-Output "  Startup     : Automatic"
Write-Output "  Recovery    : restart after 5s / 10s / 30s"
Write-Output "  Logs        : $env:ProgramData\WorkPulse\logs"
Write-Output ''
Write-Output 'To remove it:'
Write-Output '    .\scripts\install-service.ps1 -Uninstall'
