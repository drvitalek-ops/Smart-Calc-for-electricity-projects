param(
    [Parameter(Mandatory = $true)]
    [string]$BackupName
)

$ErrorActionPreference = "Stop"
function Invoke-Compose {
    param([string[]]$ComposeArguments)
    & docker compose @ComposeArguments
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose command failed" }
}
if ($BackupName -notmatch '^20[0-9]{6}T[0-9]{6}Z$') {
    throw "Invalid backup name"
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BackupDir = Join-Path $ProjectRoot "backups/$BackupName"
foreach ($File in @("database.dump", "project-files.tar.gz", "SHA256SUMS", "backup.meta")) {
    if (-not (Test-Path (Join-Path $BackupDir $File))) {
        throw "Missing backup file: $File"
    }
}

Set-Location $ProjectRoot
Invoke-Compose -ComposeArguments @("run", "--rm", "--no-deps", "--entrypoint", "sh", "restore", "-c", "cd '/backups/$BackupName' && sha256sum -c SHA256SUMS")

Write-Host "This will replace the current database and every uploaded project file."
$Confirmation = Read-Host "Type RESTORE to continue"
if ($Confirmation -cne "RESTORE") { throw "Restore cancelled" }

Invoke-Compose -ComposeArguments @("up", "-d", "db")
Invoke-Compose -ComposeArguments @("stop", "frontend", "backend", "backup")
Invoke-Compose -ComposeArguments @("cp", "$BackupDir/database.dump", "db:/tmp/smart-calc-restore.dump")
Invoke-Compose -ComposeArguments @("exec", "-T", "db", "dropdb", "--force", "-U", "smart_calc", "smart_home_calc_dev")
Invoke-Compose -ComposeArguments @("exec", "-T", "db", "createdb", "-U", "smart_calc", "smart_home_calc_dev")
Invoke-Compose -ComposeArguments @("exec", "-T", "db", "pg_restore", "-U", "smart_calc", "-d", "smart_home_calc_dev", "--no-owner", "--no-privileges", "/tmp/smart-calc-restore.dump")
Invoke-Compose -ComposeArguments @("exec", "-T", "db", "rm", "-f", "/tmp/smart-calc-restore.dump")
Invoke-Compose -ComposeArguments @("run", "--rm", "--no-deps", "--entrypoint", "sh", "restore", "-c", "find /data/storage -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf '/backups/$BackupName/project-files.tar.gz' -C /data/storage")
Invoke-Compose -ComposeArguments @("up", "-d")
Write-Host "Backup $BackupName restored"
