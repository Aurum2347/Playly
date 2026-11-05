param([switch]$Release, [switch]$Install)
$ErrorActionPreference = 'Stop'
Set-Location "$PSScriptRoot/.."
$sdk = $env:ANDROID_HOME
if (!$sdk) { $sdk = "$env:LOCALAPPDATA/Android/Sdk" }
$bt = "$sdk/build-tools/36.0.0"
$platform = "$sdk/platforms/android-36.1/android.jar"
$jdk = $env:JAVA_HOME
$candidates = @($jdk) + @(Get-ChildItem "$env:ProgramFiles/Java/jdk-*" -Directory -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -ExpandProperty FullName)
$jdk = $candidates | Where-Object {
  $_ -and (Test-Path "$_/bin/javac.exe") -and
  (Select-String -Path "$_/release" -Pattern '^JAVA_VERSION="(\d+)' -ErrorAction SilentlyContinue).Matches.Groups[1].Value -as [int] -ge 17
} | Select-Object -First 1
if (!$jdk) { throw 'Set JAVA_HOME to a JDK 17 or later installation.' }
$env:JAVA_HOME = $jdk
$env:Path = "$jdk/bin;$env:Path"
function Run($exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) { throw "$exe exited with $LASTEXITCODE" }
}
$version = (Get-Content -Raw package.json | ConvertFrom-Json).version
$v = [Version]$version
if ($v.Minor -gt 99 -or $v.Build -gt 99) { throw 'Version components must fit two digits' }
$code = $v.Major * 10000 + $v.Minor * 100 + $v.Build
$out = [IO.Path]::GetFullPath((Join-Path (Get-Location) 'android/build'))
# A fresh staging directory keeps deleted classes out of incremental builds.
$stage = "$out/$([Guid]::NewGuid())"
New-Item -Type Directory "$stage/classes","$stage/dex" -Force | Out-Null
try {
  Run "$bt/aapt2.exe" @('compile','--dir','src-tauri/icons/android','-o',"$stage/resources.zip")
  $linkFlags = if ($Release) { @() } else { @('--debug-mode') }
  Run "$bt/aapt2.exe" (@('link','-o',"$stage/base.apk",'-I',$platform,'--manifest','android/AndroidManifest.xml','--min-sdk-version','28','--target-sdk-version','36','--version-code',$code,'--version-name',$version,'-A','android/assets',"$stage/resources.zip") + $linkFlags)
  $sources = (Get-ChildItem android/src/*.java).FullName
  Run "$jdk/bin/javac.exe" (@('-encoding','UTF-8','-source','8','-target','8',"-bootclasspath","$platform;$bt/core-lambda-stubs.jar",'-d',"$stage/classes") + $sources)
  Run "$jdk/bin/jar.exe" @('cf',"$stage/code.jar",'-C',"$stage/classes",'.')
  Run "$bt/d8.bat" @('--min-api','28','--lib',$platform,'--output',"$stage/dex","$stage/code.jar")
  Run "$jdk/bin/jar.exe" @('uf',"$stage/base.apk",'-C',"$stage/dex",'classes.dex')
  Run "$bt/zipalign.exe" @('-f','4',"$stage/base.apk","$stage/aligned.apk")
  if ($Release) {
    $key = $env:PLAYLY_KEYSTORE
    if (!$key -or !$env:PLAYLY_KEY_ALIAS -or !$env:PLAYLY_STORE_PASS -or !$env:PLAYLY_KEY_PASS) { throw 'Set PLAYLY_KEYSTORE, PLAYLY_KEY_ALIAS, PLAYLY_STORE_PASS and PLAYLY_KEY_PASS for release signing.' }
    $sign = @('--ks',$key,'--ks-key-alias',$env:PLAYLY_KEY_ALIAS,'--ks-pass','env:PLAYLY_STORE_PASS','--key-pass','env:PLAYLY_KEY_PASS')
    $apk = "$out/Playly-android-$code.apk"
  } else {
    $key = "$out/debug.jks"
    if (!(Test-Path $key)) { Run "$jdk/bin/keytool.exe" @('-genkeypair','-keystore',$key,'-storepass','android','-keypass','android','-alias','androiddebugkey','-dname','CN=Android Debug','-keyalg','RSA','-validity','10000') }
    $sign = @('--ks',$key,'--ks-pass','pass:android')
    $apk = "$out/Playly-debug.apk"
  }
  Run "$bt/apksigner.bat" (@('sign') + $sign + @('--out',"$stage/signed.apk","$stage/aligned.apk"))
  Run "$bt/apksigner.bat" @('verify','--verbose',"$stage/signed.apk")
  Copy-Item "$stage/signed.apk" $apk -Force
  if ($Install) {
    Run "$sdk/platform-tools/adb.exe" @('install','-r',$apk)
    Run "$sdk/platform-tools/adb.exe" @('shell','am','start','-n','com.playly.player/.Main')
  }
  Write-Output $apk
} finally {
  if ((Split-Path (Resolve-Path $stage).Path -Parent) -eq $out) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
