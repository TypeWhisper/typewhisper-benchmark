param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Enable", "Restore")]
    [string]$Action,

    [Parameter(Mandatory = $true)]
    [string]$BackupDirectory
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
    Start-Process -FilePath $ExecutablePath
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    do {
        Start-Sleep -Milliseconds 500
        try {
            $status = Invoke-RestMethod -Uri "http://127.0.0.1:8978/v1/status" -TimeoutSec 2
            if ($status.status -eq "ready") {
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
    $process = Get-Process TypeWhisper -ErrorAction Stop | Select-Object -First 1
    $executablePath = $process.Path
    New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
    Copy-Item -LiteralPath $settingsPath -Destination $backupPath
    Set-Content -LiteralPath $executablePathFile -Value $executablePath -Encoding UTF8
    Stop-TypeWhisper

    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    $settings.localModelAcceleration = "nvidia-cuda"
    $settings.selectedModelId = "plugin:com.typewhisper.sherpa-onnx:parakeet-tdt-0.6b"
    $temporaryPath = "$settingsPath.benchmark.tmp"
    $settings | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $settingsPath -Force
    Start-TypeWhisper $executablePath
    Write-Output "benchmark-mode-enabled"
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
