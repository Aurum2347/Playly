$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('playly-recovery-' + [Guid]::NewGuid())
[void](New-Item -ItemType Directory -Path $testRoot)
$fixture = Join-Path $testRoot 'fixture.exe'
$source = @'
using System;
using System.IO;
public class PlaylyRecoveryFixture {
  public static void Main() {
    string mode = Environment.GetEnvironmentVariable("PLAYLY_QA_MODE");
    if (mode == "healthy") File.Delete(Environment.GetEnvironmentVariable("PLAYLY_UPDATE_BACKUP"));
    File.WriteAllText(Environment.GetEnvironmentVariable("PLAYLY_UPDATE_MARKER"), mode);
  }
}
'@
Add-Type -TypeDefinition $source -OutputAssembly $fixture -OutputType WindowsApplication
$helper = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../src-tauri/src/portable-restart.ps1'))
try {
    foreach ($mode in @('restored', 'healthy')) {
        $case = Join-Path $testRoot $mode
        [void](New-Item -ItemType Directory -Path $case)
        $exe = Join-Path $case 'Playly.exe'
        $backup = [IO.Path]::ChangeExtension($exe, 'old.exe')
        Copy-Item -LiteralPath $fixture -Destination $backup
        if ($mode -eq 'healthy') { Copy-Item -LiteralPath $fixture -Destination $exe }
        else { [IO.File]::WriteAllText($exe, 'not an executable') }
        $env:PLAYLY_UPDATE_EXE = $exe
        $env:PLAYLY_UPDATE_BACKUP = $backup
        $env:PLAYLY_UPDATE_PID = '2147483647'
        $env:PLAYLY_UPDATE_MARKER = Join-Path $case 'started.txt'
        $env:PLAYLY_QA_MODE = $mode
        $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $helper) -WindowStyle Hidden -PassThru
        if (!$process.WaitForExit(30000)) { Stop-Process -Id $process.Id -Force; throw "Recovery helper timed out: $mode" }
        $process.Refresh()
        if ($process.ExitCode -ne 0) { throw "Recovery helper failed: $mode" }
        $deadline = [DateTime]::UtcNow.AddSeconds(5)
        while (!(Test-Path -LiteralPath $env:PLAYLY_UPDATE_MARKER) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 50 }
        if (!(Test-Path -LiteralPath $env:PLAYLY_UPDATE_MARKER)) { throw "App was not restarted: $mode" }
        if ([IO.File]::ReadAllText($env:PLAYLY_UPDATE_MARKER) -ne $mode) { throw "Unexpected app was started: $mode" }
        if ((Get-FileHash -LiteralPath $exe).Hash -ne (Get-FileHash -LiteralPath $fixture).Hash) { throw 'The restored executable differs from the backup' }
        if (Test-Path -LiteralPath $backup) { throw 'Backup was not consumed or confirmed' }
        Write-Output "Portable update: $mode passed"
    }
} finally {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (!$resolved.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -or !(Split-Path -Leaf $resolved).StartsWith('playly-recovery-')) { throw 'Refusing to remove an unexpected test directory' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
