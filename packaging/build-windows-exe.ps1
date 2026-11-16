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
        $pdfImport = Invoke-RestMethod -Uri "$quoteUrl/import-file" -Method Post -Form @{file=(Get-Item $quotePdf)} -TimeoutSec 30
        if ($pdfImport.lines.Count -ne 1 -or $pdfImport.lines[0].unit_price -ne "100.00" -or $pdfImport.lines[0].quantity -ne "2.000" -or -not $pdfImport.checks[0].verified) {
            throw "Packaged PDF quotation import failed price, quantity or arithmetic verification"
        }
        $planPages = Invoke-RestMethod -Uri "http://127.0.0.1:5173/api/projects/$($smokeProject.id)/pdf" -Method Post -Form @{file=(Get-Item $quotePdf)} -TimeoutSec 30
        $planProject = Invoke-RestMethod -Uri "http://127.0.0.1:5173/api/projects/$($smokeProject.id)" -TimeoutSec 10
        $planKinds = Invoke-RestMethod -Uri "http://127.0.0.1:5173/api/types" -TimeoutSec 10
        $planKind = $planKinds | Where-Object {$_.name -eq "Движение"} | Select-Object -First 1
        $planLayer = $planProject.layers | Where-Object {$_.name -eq $planKind.category} | Select-Object -First 1
        $annotationBody = @{page_id=$planPages[0].id;layer_id=$planLayer.id;type_id=$planKind.id;x=0.25;y=0.25;parameters=@{quantity=1;plan_color="#a13d72";plan_shape="diamond";plan_icon="X";plan_rotation=30;display_name="Native manual annotation"}} | ConvertTo-Json -Depth 10
        $annotation = Invoke-RestMethod -Uri "http://127.0.0.1:5173/api/projects/$($smokeProject.id)/elements" -Method Post -ContentType "application/json; charset=utf-8" -Body $annotationBody -TimeoutSec 10
        if ($annotation.parameters.plan_shape -ne "diamond" -or $annotation.parameters.display_name -ne "Native manual annotation") {
            throw "Packaged manual plan appearance did not persist"
        }
        $layerFilter = Invoke-RestMethod -Uri "http://127.0.0.1:5173/api/layers/$($planLayer.id)" -Method Patch -ContentType "application/json; charset=utf-8" -Body (@{hidden_groups=@("type:Движение")} | ConvertTo-Json) -TimeoutSec 10
        if ($layerFilter.hidden_groups.Count -ne 1 -or $layerFilter.hidden_groups[0] -ne "type:Движение") {
            throw "Packaged layer group visibility did not persist"
        }
        $planPdf = Join-Path $workDirectory "manual-plan-smoke.pdf"
        Invoke-WebRequest -Uri "http://127.0.0.1:5173/api/projects/$($smokeProject.id)/pages/$($planPages[0].id)/export.pdf" -OutFile $planPdf -TimeoutSec 20
        if ((Get-Item $planPdf).Length -lt 1000) { throw "Packaged manual plan PDF is invalid" }
        $autoProject = Invoke-RestMethod -Uri "http://127.0.0.1:5173/api/projects" -Method Post -ContentType "application/json" -Body '{"name":"Automatic CP quantities"}'
        $autoPages = Invoke-RestMethod -Uri "http://127.0.0.1:5173/api/projects/$($autoProject.id)/pdf" -Method Post -Form @{file=(Get-Item $quotePdf)} -TimeoutSec 30
        $autoPlan = Invoke-RestMethod -Uri "http://127.0.0.1:5173/api/projects/$($autoProject.id)" -TimeoutSec 10
        $autoLayer = $autoPlan.layers | Where-Object {$_.name -eq $planKind.category} | Select-Object -First 1
        $autoBody = @{page_id=$autoPages[0].id;layer_id=$autoLayer.id;type_id=$planKind.id;x=0.25;y=0.25;parameters=@{quantity=2}}
        $autoElement = Invoke-RestMethod -Uri "http://127.0.0.1:5173/api/projects/$($autoProject.id)/elements" -Method Post -ContentType "application/json" -Body ($autoBody | ConvertTo-Json -Depth 10) -TimeoutSec 10
        $autoQuoteUrl = "http://127.0.0.1:5173/api/projects/$($autoProject.id)/quotation"
        $autoQuote = Invoke-RestMethod -Uri $autoQuoteUrl -TimeoutSec 10
        $autoQuote.lines[0].unit_price = "100"
        $autoQuote = Invoke-RestMethod -Uri $autoQuoteUrl -Method Put -ContentType "application/json; charset=utf-8" -Body ($autoQuote | ConvertTo-Json -Depth 20) -TimeoutSec 10
        $autoBody.parameters.quantity = 4
        $null = Invoke-RestMethod -Uri "http://127.0.0.1:5173/api/elements/$($autoElement.id)" -Method Put -ContentType "application/json" -Body ($autoBody | ConvertTo-Json -Depth 10) -TimeoutSec 10
        $autoUpdated = Invoke-RestMethod -Uri $autoQuoteUrl -TimeoutSec 10
        if ([decimal]$autoUpdated.lines[0].quantity -ne 4 -or $autoUpdated.client.totals.RUB.total -ne "400.00") {
            throw "Packaged CP did not follow plan quantity automatically"
        }
        $badNumbers = @{lines=@(@{id="invalid";quantity="";unit_price="100"})} | ConvertTo-Json -Depth 5
        $numberError = Invoke-WebRequest -Uri "$autoQuoteUrl/calculate" -Method Post -ContentType "application/json" -Body $badNumbers -SkipHttpErrorCheck -TimeoutSec 10
        $numberDetails = ($numberError.Content | ConvertFrom-Json).detail
        if ($numberError.StatusCode -ne 422 -or $numberDetails[0].field -ne "Строка КП № 1 — Количество" -or $numberDetails[0].msg -notlike "Введите число*") {
            throw "Packaged numeric validation is not Russian"
        }
        $ruNumbers = @{global_discount="10,0";lines=@(@{id="localized";quantity="2,5";unit_price="100,00"})} | ConvertTo-Json -Depth 5
        $localizedTotals = Invoke-RestMethod -Uri "$autoQuoteUrl/calculate" -Method Post -ContentType "application/json" -Body $ruNumbers -TimeoutSec 10
        if ($localizedTotals.client.totals.RUB.total -ne "250.00" -or $localizedTotals.partner.totals.RUB.total -ne "225.00") {
            throw "Packaged Russian decimal calculation is incorrect"
        }
        $skuPath = Join-Path $workDirectory "sku-smoke.docx"
        Invoke-WebRequest -Uri "$autoQuoteUrl/sku.docx" -OutFile $skuPath -TimeoutSec 20
        & $PythonBinary -c 'import sys; from docx import Document; d=Document(sys.argv[1]); rows=[[c.text for c in r.cells] for r in d.tables[0].rows]; assert len(rows)==2 and len(rows[0])==5 and rows[0][2]=="Бренд"; assert rows[1][3]=="4"; assert all(s not in " ".join(p.text for p in d.paragraphs)+" ".join(c for row in rows for c in row) for s in ["Цена","Скидка","Сумма","100,00"]), "SKU contains prices"' $skuPath
        if ($LASTEXITCODE -ne 0) { throw "Packaged SKU Word export is invalid or contains financial data" }
        $roomProject = Invoke-RestMethod -Uri "http://127.0.0.1:5173/api/projects" -Method Post -ContentType "application/json" -Body '{"name":"Room layout smoke"}'
        $roomBase = "http://127.0.0.1:5173/api/projects/$($roomProject.id)"
        $roomPages = Invoke-RestMethod -Uri "$roomBase/pdf" -Method Post -Form @{file=(Get-Item $quotePdf)} -TimeoutSec 30
        $roomPlan = Invoke-RestMethod -Uri $roomBase -TimeoutSec 10
        $roomKind = $planKinds | Where-Object {$_.name -eq "Люстра"} | Select-Object -First 1
        $roomLayer = $roomPlan.layers | Where-Object {$_.name -eq $roomKind.category} | Select-Object -First 1
        foreach ($roomNumber in @(2,3)) {
            $room = Invoke-RestMethod -Uri "$roomBase/rooms" -Method Post -ContentType "application/json" -Body (@{name="Room $roomNumber"} | ConvertTo-Json) -TimeoutSec 10
            $roomBody = @{page_id=$roomPages[0].id;layer_id=$roomLayer.id;type_id=$roomKind.id;room_id=$room.id;x=0.1*$roomNumber;y=0.25;parameters=@{quantity=$roomNumber}}
            $null = Invoke-RestMethod -Uri "$roomBase/elements" -Method Post -ContentType "application/json" -Body ($roomBody | ConvertTo-Json -Depth 10) -TimeoutSec 10
        }
        $roomQuote = Invoke-RestMethod -Uri "$roomBase/quotation" -TimeoutSec 10
        if ($roomQuote.room_layout -ne "combined" -or $roomQuote.lines.Count -ne 1 -or [decimal]$roomQuote.lines[0].quantity -ne 5) { throw "Packaged new CP is not combined across rooms" }
        $roomQuote.lines[0].unit_price = "100"
        $roomQuote.lines[0].discount = "10"
        $roomQuote = Invoke-RestMethod -Uri "$roomBase/quotation" -Method Put -ContentType "application/json; charset=utf-8" -Body ($roomQuote | ConvertTo-Json -Depth 20) -TimeoutSec 10
        $roomQuote = Invoke-RestMethod -Uri "$roomBase/quotation/room-layout" -Method Post -ContentType "application/json" -Body (@{revision=$roomQuote.revision;layout="rooms"} | ConvertTo-Json) -TimeoutSec 10
        if ($roomQuote.lines.Count -ne 2 -or $roomQuote.lines[0].room -ne "Room 2" -or [decimal]$roomQuote.lines[0].quantity -ne 2 -or [decimal]$roomQuote.lines[1].quantity -ne 3 -or $roomQuote.partner.totals.RUB.total -ne "450.00") { throw "Packaged room distribution lost quantity, room, price or discount" }
        $roomQuote.lines[1].unit_price = "0"
        $roomQuote = Invoke-RestMethod -Uri "$roomBase/quotation" -Method Put -ContentType "application/json; charset=utf-8" -Body ($roomQuote | ConvertTo-Json -Depth 20) -TimeoutSec 10
        $roomQuote = Invoke-RestMethod -Uri "$roomBase/quotation/room-layout" -Method Post -ContentType "application/json" -Body (@{revision=$roomQuote.revision;layout="combined"} | ConvertTo-Json) -TimeoutSec 10
        if ($roomQuote.lines.Count -ne 1 -or $roomQuote.lines[0].room -ne "" -or [decimal]$roomQuote.lines[0].quantity -ne 5 -or $roomQuote.partner.totals.RUB.total -ne "450.00") { throw "Packaged CP rooms did not combine without changing commercial terms" }
        $roomQuote.lines[0].sku = "LIGHT-53"
        $roomQuote.lines[0].ip = "IP44"
        $roomQuote = Invoke-RestMethod -Uri "$roomBase/quotation" -Method Put -ContentType "application/json; charset=utf-8" -Body ($roomQuote | ConvertTo-Json -Depth 20) -TimeoutSec 10
        $roomPdf = Join-Path $workDirectory "room-metadata.pdf"
        Invoke-WebRequest -Uri "$roomBase/quotation/export.pdf?mode=client" -OutFile $roomPdf -TimeoutSec 20
        & $PythonBinary -c 'import sys,pymupdf; d=pymupdf.open(sys.argv[1]); t=" ".join(p.get_text() for p in d); assert "LIGHT-53 · IP44" in t and "Степень защиты" not in t and "Артикул:" not in t, "Invalid article/IP metadata in packaged PDF"' $roomPdf
        if ($LASTEXITCODE -ne 0) { throw "Packaged quotation article/IP PDF check failed" }
        $wordPath = Join-Path $workDirectory "quotation-smoke.docx"
        & $PythonBinary -c 'import sys; from docx import Document; d=Document(); t=d.add_table(rows=1,cols=3); [setattr(c,"text",v) for c,v in zip(t.rows[0].cells,["Name","Price","Quantity"])]; [setattr(c,"text",v) for c,v in zip(t.add_row().cells,["Imported lamp","25.00","3"])]; d.save(sys.argv[1])' $wordPath
        $wordResult = Invoke-RestMethod -Uri "$quoteUrl/import-file" -Method Post -Form @{file=(Get-Item $wordPath)} -TimeoutSec 20
        if ($wordResult.lines.Count -ne 1 -or $wordResult.lines[0].name -ne "Imported lamp" -or $wordResult.lines[0].unit_price -ne "25.00") {
            throw "Packaged Word quotation import failed"
        }
        $draft = Invoke-RestMethod -Uri "http://127.0.0.1:5173/api/quotations" -Method Post -ContentType "application/json" -Body '{}'
        $draftUrl = "http://127.0.0.1:5173/api/quotations/$($draft.id)"
        $draftDoc = $draft.quotation
        $draftDoc.lines = $smokeQuote.lines
        $draftDoc.global_discount = "5"
        $draftDoc = Invoke-RestMethod -Uri $draftUrl -Method Put -ContentType "application/json; charset=utf-8" -Body ($draftDoc | ConvertTo-Json -Depth 20) -TimeoutSec 10
        $attachment = @{revision=$draftDoc.revision;project_id=$smokeProject.id;project_revision=$smokeQuote.revision} | ConvertTo-Json
        $attached = Invoke-RestMethod -Uri "$draftUrl/attach" -Method Post -ContentType "application/json" -Body $attachment -TimeoutSec 10
        if ($attached.project_id -ne $smokeProject.id -or -not $attached.archived_quotation_id -or $attached.quotation.partner.totals.RUB.total -ne "190.00") {
            throw "Packaged standalone quotation attachment failed"
        }
        $backupResponse = Invoke-RestMethod -Uri "http://127.0.0.1:5173/api/settings/backups" -Method Post -ContentType "application/json" -Headers @{Origin="http://127.0.0.1:5173"} -Body (@{instance=$smokeToken} | ConvertTo-Json) -TimeoutSec 30
        $fullBackup = Join-Path $workDirectory "full-backup.zip"
        Invoke-WebRequest -Uri ("http://127.0.0.1:5173" + $backupResponse.url) -OutFile $fullBackup -TimeoutSec 30
        $restoreSource = Join-Path $workDirectory "backup-extracted"
        Expand-Archive -LiteralPath $fullBackup -DestinationPath $restoreSource
    }
    finally {
        if (-not $backendProcess.HasExited) {
            $backendProcess.Kill($true)
            $backendProcess.WaitForExit(10000) | Out-Null
        }
        $backendProcess.Dispose()
    }

    # Execute the restore script shipped in the actual ZIP in an isolated data
    # directory. The pre-existing target must survive alongside the restored data.
    $restoredAppData = Join-Path $workDirectory "restore-check"
    $previousTarget = Join-Path $restoredAppData "SmartHomeCalc\data"
    New-Item -ItemType Directory -Force -Path $previousTarget | Out-Null
    [IO.File]::WriteAllText((Join-Path $previousTarget "keep.txt"), "old data remains recoverable")
    $originalAppData = $env:LOCALAPPDATA
    try {
        $env:LOCALAPPDATA = $restoredAppData
        function Read-Host { return "ВОССТАНОВИТЬ" }
        & (Join-Path $restoreSource "restore-data.ps1")
    }
    finally {
        Remove-Item Function:Read-Host -ErrorAction SilentlyContinue
        $env:LOCALAPPDATA = $originalAppData
    }
    $kept = Get-ChildItem (Join-Path $restoredAppData "SmartHomeCalc") -Filter "data-before-restore-*"
    if ($kept.Count -ne 1 -or -not (Test-Path (Join-Path $kept[0].FullName "keep.txt"))) {
        throw "Restore did not preserve pre-existing data"
    }
    $smokeStart.Environment["LOCALAPPDATA"] = $restoredAppData
    $restoredProcess = [Diagnostics.Process]::Start($smokeStart)
    try {
        $restoredReady = $false
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            if ($restoredProcess.HasExited) { throw "Restored packaged backend exited" }
            try {
                $restoredHealth = Invoke-RestMethod -Uri "http://127.0.0.1:5173/api/health" -TimeoutSec 2
                if ($restoredHealth.instance -eq $smokeToken) { $restoredReady = $true; break }
            } catch { Start-Sleep -Seconds 1 }
        }
        if (-not $restoredReady) { throw "Restored data did not open in packaged backend" }
        $restoredProject = Invoke-RestMethod -Uri "http://127.0.0.1:5173/api/projects/$($smokeProject.id)" -TimeoutSec 10
        $restoredLayer = $restoredProject.layers | Where-Object {$_.id -eq $planLayer.id} | Select-Object -First 1
        if ($restoredLayer.hidden_groups.Count -ne 1 -or $restoredLayer.hidden_groups[0] -ne "type:Движение") {
            throw "Full backup lost layer group visibility"
        }
        $restoredQuote = Invoke-RestMethod -Uri $quoteUrl -TimeoutSec 10
        if ($restoredProject.elements.Count -ne 1 -or $restoredQuote.partner.totals.RUB.total -ne "190.00") {
            throw "Full backup lost plan objects or quotation prices"
        }
        Invoke-WebRequest -Uri "http://127.0.0.1:5173/api/pages/$($planPages[0].id)/image" -OutFile (Join-Path $workDirectory "restored-plan.png") -TimeoutSec 20
        Invoke-WebRequest -Uri "http://127.0.0.1:5173/api/projects/$($smokeProject.id)/pages/$($planPages[0].id)/export.pdf" -OutFile (Join-Path $workDirectory "restored-plan.pdf") -TimeoutSec 20
    }
    finally {
        if (-not $restoredProcess.HasExited) { $restoredProcess.Kill($true); $restoredProcess.WaitForExit(10000) | Out-Null }
        $restoredProcess.Dispose()
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
    & $GoBinary test upgrade.go upgrade_test.go
    if ($LASTEXITCODE -ne 0) { throw "Launcher upgrade/rollback checks failed" }
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
