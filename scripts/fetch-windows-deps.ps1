<#
.SYNOPSIS
  Puts mpv, vulkan-1.dll, ffmpeg and yt-dlp in src-tauri/deps for Windows development builds.

.DESCRIPTION
  Installers ship these in a "deps" folder next to the app. Debug builds (npm run tauri dev)
  look in src-tauri/deps instead, which is git-ignored because the binaries are large.

  By default the files are copied from an installed LubaTV or Fred TV, if one is found.
  Otherwise, or with -Download, they are downloaded from the same sources the release
  workflow uses (.github/workflows/buildAndUpload.yml).

.PARAMETER From
  Copy from this folder (for example "C:\Program Files\Fred TV\deps").

.PARAMETER Download
  Download fresh builds even if an installed copy exists.

.PARAMETER Force
  Replace files that are already in src-tauri/deps.

.EXAMPLE
  ./scripts/fetch-windows-deps.ps1
.EXAMPLE
  ./scripts/fetch-windows-deps.ps1 -Download -Force
#>
[CmdletBinding()]
param(
  [string]$From,
  [switch]$Download,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$files = @("mpv.exe", "vulkan-1.dll", "ffmpeg.exe", "yt-dlp.exe")
$dest = Join-Path $PSScriptRoot "..\src-tauri\deps"
New-Item -ItemType Directory -Path $dest -Force | Out-Null
$dest = (Resolve-Path $dest).Path

$missing = $files | Where-Object { $Force -or -not (Test-Path (Join-Path $dest $_)) }
if (-not $missing) {
  Write-Host "All player files are already in $dest (use -Force to replace them)."
  exit 0
}

function Copy-FromFolder([string]$folder) {
  foreach ($name in $missing) {
    $src = Join-Path $folder $name
    if (-not (Test-Path $src)) { throw "$name not found in $folder" }
    Copy-Item $src -Destination $dest -Force
    Write-Host "Copied $name from $folder"
  }
}

function Get-File([string]$url, [string]$outFile) {
  for ($i = 1; $i -le 3; $i++) {
    try {
      Invoke-WebRequest -UserAgent "Wget" -Uri $url -OutFile $outFile
      return
    } catch {
      if ($i -eq 3) { throw }
      Start-Sleep -Seconds 5
    }
  }
}

function Expand-Files([string]$zip, [string[]]$names) {
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("lubatv-deps-" + [guid]::NewGuid())
  Expand-Archive -Path $zip -DestinationPath $tmp
  try {
    foreach ($name in $names) {
      $found = Get-ChildItem -Path $tmp -Recurse -Filter $name | Select-Object -First 1
      if (-not $found) { throw "$name not found in $zip" }
      Copy-Item $found.FullName -Destination $dest -Force
      Write-Host "Extracted $name"
    }
  } finally {
    Remove-Item $tmp -Recurse -Force
  }
}

function Get-Downloads {
  $work = Join-Path ([IO.Path]::GetTempPath()) ("lubatv-dl-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    if ($missing -contains "mpv.exe" -or $missing -contains "vulkan-1.dll") {
      Write-Host "Downloading mpv (latest CI build)..."
      $page = Invoke-WebRequest -Uri "https://nightly.link/mpv-player/mpv/workflows/build/master" -UseBasicParsing
      $url = $page.Links.Href | Where-Object { $_ -match "x86_64-pc-windows-msvc\.zip$" } | Select-Object -First 1
      if (-not $url) { throw "Could not find the mpv Windows build on nightly.link" }
      $zip = Join-Path $work "mpv.zip"
      Get-File $url $zip
      Expand-Files $zip @("mpv.exe", "vulkan-1.dll")
    }
    if ($missing -contains "ffmpeg.exe") {
      Write-Host "Downloading ffmpeg (about 200 MB)..."
      $zip = Join-Path $work "ffmpeg.zip"
      Get-File "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip" $zip
      Expand-Files $zip @("ffmpeg.exe")
    }
    if ($missing -contains "yt-dlp.exe") {
      Write-Host "Downloading yt-dlp..."
      Get-File "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" (Join-Path $dest "yt-dlp.exe")
    }
  } finally {
    Remove-Item $work -Recurse -Force
  }
}

if ($From) {
  Copy-FromFolder $From
} elseif ($Download) {
  Get-Downloads
} else {
  $installed = @(
    (Join-Path $env:ProgramFiles "LubaTV\deps"),
    (Join-Path $env:ProgramFiles "Fred TV\deps")
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($installed) { Copy-FromFolder $installed } else { Get-Downloads }
}

Write-Host "Player files are in $dest"
