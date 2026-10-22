param(
    [string]$GoBinary = "go",
    [string]$DotnetBinary = "dotnet",
    [string]$PythonBinary = "python",
    [string]$NpmBinary = "npm"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDirectory
$launcherDirectory = Join-Path $scriptDirectory "windows-launcher"
$desktopProject = Join-Path $scriptDirectory "windows-desktop\SmartHomeCalc.Desktop.csproj"
$outputDirectory = Join-Path $projectRoot "release"
$workDirectory = Join-Path ([IO.Path]::GetTempPath()) ("smart-home-calc-" + [guid]::NewGuid())
$backendOutput = Join-Path $workDirectory "backend"
$desktopOutput = Join-Path $workDirectory "desktop"
$embeddedBackend = Join-Path $launcherDirectory "SmartHomeCalc.Backend.exe"
$embeddedDesktop = Join-Path $launcherDirectory "SmartHomeCalc.Desktop.exe"

New-Item -ItemType Directory -Force -Path $outputDirectory, $workDirectory | Out-Null

try {
    Push-Location (Join-Path $projectRoot "frontend")
    & $NpmBinary ci
    & $NpmBinary run build
    Pop-Location

    & $PythonBinary -m pip install --disable-pip-version-check -r (Join-Path $projectRoot "backend\requirements-desktop.txt")

    Push-Location $projectRoot
    & $PythonBinary -m PyInstaller --noconfirm --clean `
        --distpath $backendOutput `
        --workpath (Join-Path $workDirectory "pyinstaller") `
        (Join-Path $scriptDirectory "windows-backend.spec")
    Pop-Location

    $backendExecutable = Join-Path $backendOutput "SmartHomeCalc.Backend.exe"
    $smokeToken = [guid]::NewGuid().ToString("N")
    $smokeStart = [Diagnostics.ProcessStartInfo]::new($backendExecutable)
    $smokeStart.UseShellExecute = $false
    $smokeStart.CreateNoWindow = $true
    $smokeStart.Environment["LOCALAPPDATA"] = $workDirectory
    $smokeStart.Environment["SMART_HOME_CALC_INSTANCE_TOKEN"] = $smokeToken
    $backendProcess = [Diagnostics.Process]::Start($smokeStart)
    $backendReady = $false
    try {
        for ($attempt = 0; $attempt -lt 90; $attempt++) {
            if ($backendProcess.HasExited) {
                throw "Packaged backend exited during smoke test"
            }
            try {
                $health = Invoke-RestMethod -Uri "http://127.0.0.1:5173/api/health" -TimeoutSec 2
                if ($health.status -eq "ok" -and $health.instance -eq $smokeToken) {
                    $backendReady = $true
                    break
                }
            }
            catch {
                Start-Sleep -Seconds 1
            }
        }
        if (-not $backendReady) {
            throw "Packaged backend did not become ready"
        }
        $settings = Invoke-RestMethod -Uri "http://127.0.0.1:5173/api/settings" -TimeoutSec 5
        $expectedDataDirectory = Join-Path $workDirectory "SmartHomeCalc\data"
        if (-not $settings.can_open_data_folder -or $settings.instance -ne $smokeToken -or $settings.data_directory -ne $expectedDataDirectory) {
            throw "Packaged desktop data-folder settings are invalid"
        }
    }
    finally {
        if (-not $backendProcess.HasExited) {
            Stop-Process -Id $backendProcess.Id -Force
        }
        $backendProcess.Dispose()
    }

    & $DotnetBinary publish $desktopProject `
        --configuration Release `
        --runtime win-x64 `
        --self-contained true `
        --output $desktopOutput

    Copy-Item $backendExecutable $embeddedBackend
    Copy-Item (Join-Path $desktopOutput "SmartHomeCalc.Desktop.exe") $embeddedDesktop

    Push-Location $launcherDirectory
    $env:CGO_ENABLED = "0"
    $env:GOOS = "windows"
    $env:GOARCH = "amd64"
    & $GoBinary build -trimpath -ldflags '-s -w -H=windowsgui' `
        -o (Join-Path $outputDirectory "SmartHomeCalc-Windows-x64.exe") .
    Pop-Location

    $executable = Join-Path $outputDirectory "SmartHomeCalc-Windows-x64.exe"
    $checksum = (Get-FileHash $executable -Algorithm SHA256).Hash.ToLowerInvariant()
    $checksumFile = Join-Path $outputDirectory "SmartHomeCalc-Windows-x64.exe.sha256"
    [IO.File]::WriteAllText($checksumFile, "$checksum  SmartHomeCalc-Windows-x64.exe`n", [Text.ASCIIEncoding]::new())
    Write-Host "Created $executable"
}
finally {
    Remove-Item -Force -ErrorAction SilentlyContinue $embeddedBackend, $embeddedDesktop
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $workDirectory
}
