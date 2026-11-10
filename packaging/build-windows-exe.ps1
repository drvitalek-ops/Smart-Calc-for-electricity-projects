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
    & $DotnetBinary run --project (Join-Path $scriptDirectory "tests\local-server-connection\LocalServerConnection.Tests.csproj") --configuration Release

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
        # Exercise the actual frozen backend: quotation modules and Word's package
        # data must work inside the delivered EXE, not only in source tests.
        $smokeProject = Invoke-RestMethod -Uri "http://127.0.0.1:5173/api/projects" -Method Post -ContentType "application/json" -Body '{"name":"Native quotation smoke"}'
        $quoteUrl = "http://127.0.0.1:5173/api/projects/$($smokeProject.id)/quotation"
        $smokeQuote = Invoke-RestMethod -Uri $quoteUrl -TimeoutSec 10
        $smokeQuote.global_discount = "10"
        $smokeQuote.lines = @(@{id="native";name="Native lamp";quantity="2";unit="шт";unit_price="100";currency="RUB"})
        $smokeQuote = Invoke-RestMethod -Uri $quoteUrl -Method Put -ContentType "application/json; charset=utf-8" -Body ($smokeQuote | ConvertTo-Json -Depth 20) -TimeoutSec 10
        if ($smokeQuote.client.totals.RUB.total -ne "200.00" -or $smokeQuote.partner.totals.RUB.total -ne "180.00") {
            throw "Packaged quotation discounts are incorrect"
        }
        $quotePdf = Join-Path $workDirectory "quotation-smoke.pdf"
        Invoke-WebRequest -Uri "$quoteUrl/export.pdf?mode=client" -OutFile $quotePdf -TimeoutSec 20
        $pdfBytes = [IO.File]::ReadAllBytes($quotePdf)
        if ($pdfBytes.Length -lt 1000 -or [Text.Encoding]::ASCII.GetString($pdfBytes,0,4) -ne "%PDF") {
            throw "Packaged quotation PDF is invalid"
        }
        $wordPath = Join-Path $workDirectory "quotation-smoke.docx"
        & $PythonBinary -c 'import sys; from docx import Document; d=Document(); t=d.add_table(rows=1,cols=3); [setattr(c,"text",v) for c,v in zip(t.rows[0].cells,["Name","Price","Quantity"])]; [setattr(c,"text",v) for c,v in zip(t.add_row().cells,["Imported lamp","25.00","3"])]; d.save(sys.argv[1])' $wordPath
        $wordResult = Invoke-RestMethod -Uri "$quoteUrl/import-file" -Method Post -Form @{file=(Get-Item $wordPath)} -TimeoutSec 20
        if ($wordResult.lines.Count -ne 1 -or $wordResult.lines[0].name -ne "Imported lamp" -or $wordResult.lines[0].unit_price -ne "25.00") {
            throw "Packaged Word quotation import failed"
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
