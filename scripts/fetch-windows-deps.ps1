<#
.SYNOPSIS
  Puts mpv, vulkan-1.dll, ffmpeg and yt-dlp in src-tauri/deps for Windows development builds.

.DESCRIPTION
  Installers ship these in a "deps" folder next to the app. Debug builds (npm run tauri dev)
  look in src-tauri/deps instead, which is git-ignored because the binaries are large.

  The files are pinned in src-tauri/player-files.json (SHA-256 and the release that has
  each one). By default, files already in src-tauri/deps that match are kept, matching
  copies from an installed LubaTV are copied, and the rest are downloaded from this
  repository's player-files-* releases. Every file is checked against its checksum.
  The release workflow builds the installers this way.

.PARAMETER From
  Copy from this folder (for example "C:\Program Files\LubaTV\deps") without checking
  checksums.

.PARAMETER Latest
  Download the newest upstream builds instead of the pinned files. Used by the Refresh
  player files workflow to pin new versions.

.PARAMETER Download
  Download the pinned files even if an installed LubaTV has them.

.PARAMETER Force
  Replace files that are already in src-tauri/deps.

.EXAMPLE
  ./scripts/fetch-windows-deps.ps1
.EXAMPLE
  ./scripts/fetch-windows-deps.ps1 -Latest -Force
#>
[CmdletBinding()]
param(
  [string]$From,
  [switch]$Latest,
  [switch]$Download,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$files = @("mpv.exe", "vulkan-1.dll", "ffmpeg.exe", "yt-dlp.exe")
$dest = Join-Path $PSScriptRoot "..\src-tauri\deps"
New-Item -ItemType Directory -Path $dest -Force | Out-Null
$dest = (Resolve-Path $dest).Path

$lockPath = Join-Path $PSScriptRoot "..\src-tauri\player-files.json"
$lock = Get-Content $lockPath -Raw | ConvertFrom-Json

function Get-Sha256([string]$path) {
  (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLowerInvariant()
}

# True when the file exists and matches its pinned checksum.
function Test-Pinned([string]$path, [string]$name) {
  $pinned = $lock.files.$name
  if (-not (Test-Path $path)) { return $false }
  if ((Get-Item $path).Length -ne $pinned.size) { return $false }
  return (Get-Sha256 $path) -eq $pinned.sha256
}

if ($Latest -or $From) {
  $missing = $files | Where-Object { $Force -or -not (Test-Path (Join-Path $dest $_)) }
} else {
  $missing = $files | Where-Object { $Force -or -not (Test-Pinned (Join-Path $dest $_) $_) }
}
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

# Runs a web request up to 3 times, then rethrows the last error.
function Invoke-WithRetry([scriptblock]$action) {
  for ($i = 1; $i -le 3; $i++) {
    try {
      return & $action
    } catch {
      if ($i -eq 3) { throw }
      Write-Host "  attempt $i failed ($($_.Exception.Message)); retrying..."
      Start-Sleep -Seconds (5 * $i)
    }
  }
}

function Get-File([string]$url, [string]$outFile) {
  Invoke-WithRetry { Invoke-WebRequest -UserAgent "Wget" -Uri $url -OutFile $outFile }
}

function Copy-Found([string]$folder, [string[]]$names) {
  foreach ($name in $names) {
    $found = Get-ChildItem -Path $folder -Recurse -Filter $name | Select-Object -First 1
    if (-not $found) { throw "$name not found in $folder" }
    Copy-Item $found.FullName -Destination $dest -Force
    Write-Host "Extracted $name"
  }
}

function Expand-Files([string]$zip, [string[]]$names) {
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("lubatv-deps-" + [guid]::NewGuid())
  Expand-Archive -Path $zip -DestinationPath $tmp
  try {
    Copy-Found $tmp $names
  } finally {
    Remove-Item $tmp -Recurse -Force
  }
}

# mpv has no stable Windows release; use the latest build from its CI. nightly.link mirrors
# the artifacts without sign-in but is sometimes unavailable (for example from GitHub Actions),
# so fall back to downloading the artifact through the GitHub API with the gh CLI.
function Get-Mpv([string]$work) {
  $names = @("mpv.exe", "vulkan-1.dll")
  try {
    $page = Invoke-WithRetry {
      Invoke-WebRequest -Uri "https://nightly.link/mpv-player/mpv/workflows/build/master" -UseBasicParsing
    }
    $url = $page.Links.Href | Where-Object { $_ -match "x86_64-pc-windows-msvc\.zip$" } | Select-Object -First 1
    if (-not $url) { throw "no Windows build listed" }
    $zip = Join-Path $work "mpv.zip"
    Get-File $url $zip
    Expand-Files $zip $names
    return
  } catch {
    Write-Host "nightly.link failed ($($_.Exception.Message)); trying the GitHub API..."
  }
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "Could not download mpv: nightly.link failed and the GitHub CLI (gh) is not installed"
  }
  $run = gh run list -R mpv-player/mpv --workflow build.yml --branch master --status success --limit 1 --json databaseId --jq ".[0].databaseId"
  if ($LASTEXITCODE -ne 0 -or -not $run) { throw "Could not find a successful mpv build" }
  $artifact = gh api "repos/mpv-player/mpv/actions/runs/$run/artifacts?per_page=100" --jq '.artifacts[] | select(.name | test("x86_64-pc-windows-msvc$")) | .name' | Select-Object -First 1
  if ($LASTEXITCODE -ne 0 -or -not $artifact) { throw "Could not find the mpv Windows artifact in run $run" }
  $out = Join-Path $work "mpv-artifact"
  gh run download $run -R mpv-player/mpv -n $artifact -D $out
  if ($LASTEXITCODE -ne 0) { throw "Could not download mpv artifact $artifact" }
  Copy-Found $out $names
}

# Downloads <release>/<name>.gz for each missing file, unpacks it and checks its checksum.
function Get-Pinned([string[]]$names) {
  $repo = "https://github.com/LuisBadal0/LubaTV/releases/download"
  foreach ($name in $names) {
    $pinned = $lock.files.$name
    $gz = Join-Path $dest "$name.gz.part"
    $part = Join-Path $dest "$name.part"
    Write-Host "Downloading $name ($([math]::Round($pinned.download_size / 1MB, 1)) MB, $($pinned.release))..."
    Get-File "$repo/$($pinned.release)/$name.gz" $gz
    $in = [IO.File]::OpenRead($gz)
    try {
      $unzip = New-Object IO.Compression.GZipStream($in, [IO.Compression.CompressionMode]::Decompress)
      $out = [IO.File]::Create($part)
      try { $unzip.CopyTo($out) } finally { $out.Dispose(); $unzip.Dispose() }
    } finally {
      $in.Dispose()
      Remove-Item $gz -Force
    }
    if ((Get-Sha256 $part) -ne $pinned.sha256) {
      Remove-Item $part -Force
      throw "$name doesn't match its checksum in player-files.json"
    }
    Move-Item $part (Join-Path $dest $name) -Force
  }
}

# Copies the files that match their pinned checksum from an installed LubaTV, and returns
# the names it couldn't.
function Copy-PinnedFromInstalled([string[]]$names) {
  $folders = @(
    (Join-Path $env:LOCALAPPDATA "LubaTV\deps"),
    (Join-Path $env:ProgramFiles "LubaTV\deps"),
    (Join-Path $env:LOCALAPPDATA "luisbadalo\lubatv\data\player")
  ) | Where-Object { Test-Path $_ }
  $left = @()
  foreach ($name in $names) {
    $found = $folders | ForEach-Object { Join-Path $_ $name } | Where-Object { Test-Pinned $_ $name } | Select-Object -First 1
    if ($found) {
      Copy-Item $found -Destination $dest -Force
      Write-Host "Copied $name from $(Split-Path $found)"
    } else {
      $left += $name
    }
  }
  return $left
}

function Get-Downloads {
  $work = Join-Path ([IO.Path]::GetTempPath()) ("lubatv-dl-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    if ($missing -contains "mpv.exe" -or $missing -contains "vulkan-1.dll") {
      Write-Host "Downloading mpv (latest CI build)..."
      Get-Mpv $work
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
} elseif ($Latest) {
  Get-Downloads
} else {
  $left = if ($Download) { $missing } else { Copy-PinnedFromInstalled $missing }
  if ($left) { Get-Pinned $left }
}

Write-Host "Player files are in $dest"
