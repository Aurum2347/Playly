$ErrorActionPreference = 'Stop'
$exe = $env:PLAYLY_UPDATE_EXE
$backup = $env:PLAYLY_UPDATE_BACKUP
if (![IO.Path]::IsPathRooted($exe) -or $backup -ne [IO.Path]::ChangeExtension($exe, 'old.exe')) { exit 1 }
try {
    $oldProcess = Get-Process -Id ([int]$env:PLAYLY_UPDATE_PID) -ErrorAction SilentlyContinue
    if ($oldProcess) { $oldProcess | Wait-Process -Timeout 30 }
    $next = Start-Process -FilePath $exe -WorkingDirectory ([IO.Path]::GetDirectoryName($exe)) -PassThru
    $deadline = [DateTime]::UtcNow.AddMinutes(3)
    while ((Test-Path -LiteralPath $backup) -and !$next.HasExited -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 200
        $next.Refresh()
    }
    # The main screen confirms a healthy start by deleting the backup.
    if (!(Test-Path -LiteralPath $backup)) { exit 0 }
    if (!$next.HasExited) { Stop-Process -Id $next.Id -Force; $next.WaitForExit() }
} catch {
    # A missing runtime or invalid new executable must also restore the old version.
}
try {
    if (!(Test-Path -LiteralPath $backup)) { exit 0 }
    if (Test-Path -LiteralPath $exe) {
        Move-Item -LiteralPath $exe -Destination ([IO.Path]::ChangeExtension($exe, 'failed.exe')) -Force
    }
    Move-Item -LiteralPath $backup -Destination $exe
    Start-Process -FilePath $exe -WorkingDirectory ([IO.Path]::GetDirectoryName($exe))
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show("Playly: не удалось восстановить приложение. Резервная копия: $backup`n$($_.Exception.Message)", 'Playly')
    exit 1
}
