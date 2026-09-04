param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Enable", "Restart", "Restore")]
    [string]$Action,

    [Parameter(Mandatory = $true)]
    [string]$BackupDirectory,

    [string]$ExecutablePath,

    [string]$SelectedModelId = "plugin:com.typewhisper.sherpa-onnx:parakeet-tdt-0.6b"
)

$ErrorActionPreference = "Stop"
$settingsPath = Join-Path $env:LOCALAPPDATA "TypeWhisper-DevUserData\settings.json"
$backupPath = Join-Path $BackupDirectory "settings.json"
$executablePathFile = Join-Path $BackupDirectory "executable-path.txt"

function Stop-TypeWhisper {
    $processes = @(Get-Process TypeWhisper -ErrorAction SilentlyContinue)
    foreach ($process in $processes) {
        Stop-Process -Id $process.Id
    }
    foreach ($process in $processes) {
        Wait-Process -Id $process.Id -Timeout 30 -ErrorAction SilentlyContinue
    }
}

function Start-TypeWhisper([string]$ExecutablePath) {
    $taskName = "TypeWhisperBenchmarkStart-$([Guid]::NewGuid().ToString('N'))"
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $action = New-ScheduledTaskAction -Execute $ExecutablePath
    $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive
    try {
        Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Force | Out-Null
        Start-ScheduledTask -TaskName $taskName
    } finally {
        Start-Sleep -Seconds 1
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    do {
        Start-Sleep -Milliseconds 500
        try {
            $status = Invoke-RestMethod -Uri "http://127.0.0.1:8978/v1/status" -TimeoutSec 2
            if ($status.status -in @("ready", "no_model")) {
                return
            }
        } catch {
        }
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "TypeWhisper did not become ready within 90 seconds."
}

if ($Action -eq "Enable") {
    if (Test-Path $backupPath) {
        throw "A benchmark settings backup already exists at $backupPath. Restore it first."
    }
    $process = Get-Process TypeWhisper -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($process) {
        $resolvedExecutablePath = $process.Path
    } elseif (-not [string]::IsNullOrWhiteSpace($ExecutablePath) -and (Test-Path -LiteralPath $ExecutablePath)) {
        $resolvedExecutablePath = (Resolve-Path -LiteralPath $ExecutablePath).Path
    } else {
        throw "TypeWhisper is not running. Pass -ExecutablePath with the exact executable to start."
    }
    New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
    Copy-Item -LiteralPath $settingsPath -Destination $backupPath
    Set-Content -LiteralPath $executablePathFile -Value $resolvedExecutablePath -Encoding UTF8
    Stop-TypeWhisper

    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    $settings.localModelAcceleration = "nvidia-cuda"
    $settings.selectedModelId = $SelectedModelId
    $temporaryPath = "$settingsPath.benchmark.tmp"
    $settings | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $settingsPath -Force
    Start-TypeWhisper $resolvedExecutablePath
    Write-Output "benchmark-mode-enabled"
    exit 0
}

if ($Action -eq "Restart") {
    if (Test-Path $executablePathFile) {
        $resolvedExecutablePath = (Get-Content -LiteralPath $executablePathFile -Raw).Trim()
    } elseif (-not [string]::IsNullOrWhiteSpace($ExecutablePath) -and (Test-Path -LiteralPath $ExecutablePath)) {
        $resolvedExecutablePath = (Resolve-Path -LiteralPath $ExecutablePath).Path
    } else {
        throw "Executable path is unavailable. Pass -ExecutablePath or use an existing backup directory."
    }
    Stop-TypeWhisper
    Start-TypeWhisper $resolvedExecutablePath
    Write-Output "app-restarted"
    exit 0
}

if (-not (Test-Path $backupPath)) {
    throw "Benchmark settings backup not found at $backupPath."
}
$executablePath = (Get-Content -LiteralPath $executablePathFile -Raw).Trim()
Stop-TypeWhisper
Copy-Item -LiteralPath $backupPath -Destination $settingsPath -Force
Start-TypeWhisper $executablePath
Write-Output "settings-restored"
