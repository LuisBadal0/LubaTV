<#
.SYNOPSIS
Starts LubaTV for a check: an isolated library, a made-up playlist and a scriptable window.

.DESCRIPTION
- LUBATV_HOME points the database, cache, logs and player files at -DataDir, so your own library,
  sources and credentials are never read or changed. It also lets this run start while the
  installed LubaTV is open.
- scripts/verify/fixtures.mjs serves a made-up playlist at http://127.0.0.1:<FixturesPort>/playlist.m3u.
- The WebView listens for the Chrome DevTools Protocol on -CdpPort; scripts/verify/drive.mjs uses it.

Runs `npm run tauri dev` in the foreground and stops the playlist server when the app exits.
Windows only: the DevTools port is a WebView2 feature.

.PARAMETER DataDir
The folder for this run's data. Defaults to lubatv-verify in the temp folder.

.PARAMETER Fresh
Delete -DataDir first, so the app starts at "Add your first source". Only a folder this script
created (it has a .lubatv-verify file) is ever deleted.
#>
param(
  [string]$DataDir = (Join-Path ([IO.Path]::GetTempPath()) "lubatv-verify"),
  [switch]$Fresh,
  [int]$FixturesPort = 8765,
  [int]$CdpPort = 9222
)

$ErrorActionPreference = "Stop"
if (-not $IsWindows -and $PSVersionTable.PSEdition -eq "Core") {
  throw "scripts/verify/start.ps1 needs Windows: the DevTools port is a WebView2 feature."
}

$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$DataDir = [IO.Path]::GetFullPath($DataDir)
$marker = Join-Path $DataDir ".lubatv-verify"

if ($Fresh -and (Test-Path $DataDir)) {
  if (-not (Test-Path $marker)) {
    throw "$DataDir was not made by this script (no .lubatv-verify file), so it is left alone."
  }
  Remove-Item -Recurse -Force $DataDir
}
New-Item -ItemType Directory -Force $DataDir | Out-Null
Set-Content -Path $marker -Value "Made by scripts/verify/start.ps1. Safe to delete."

foreach ($port in 4200, $FixturesPort, $CdpPort) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $port is in use. Close the other dev server or LubaTV check first."
  }
}

$env:LUBATV_HOME = $DataDir
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$CdpPort"
# Keep the WebView's own storage (localStorage) in this run's folder too.
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $DataDir "webview"

$fixtures = Start-Process node -PassThru -NoNewWindow `
  -ArgumentList @("`"$repo\scripts\verify\fixtures.mjs`"", "`"$(Join-Path $DataDir 'fixtures')`"", $FixturesPort)

Write-Host "LubaTV check run"
Write-Host "  data:     $DataDir"
Write-Host "  playlist: http://127.0.0.1:$FixturesPort/playlist.m3u"
Write-Host "  devtools: http://127.0.0.1:$CdpPort"

Push-Location $repo
try {
  npm run tauri dev
}
finally {
  Pop-Location
  if (-not $fixtures.HasExited) { Stop-Process -Id $fixtures.Id -Force }
}
