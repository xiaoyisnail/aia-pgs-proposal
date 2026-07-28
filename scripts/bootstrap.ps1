param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$OnboardArgs
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$skillRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $skillRoot '.runtime\node'

function Get-NodeMajor([string]$NodePath) {
  try {
    return [int](& $NodePath -p 'process.versions.node.split(".")[0]')
  } catch {
    return 0
  }
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { '' }
$portableNode = Join-Path $runtimeDir 'node.exe'

if (-not $nodePath -or (Get-NodeMajor $nodePath) -lt 20) {
  if ((Test-Path $portableNode) -and (Get-NodeMajor $portableNode) -ge 20) {
    $nodePath = $portableNode
  } else {
    $detectedArchitecture = if ($env:PROCESSOR_ARCHITEW6432) {
      $env:PROCESSOR_ARCHITEW6432
    } else {
      $env:PROCESSOR_ARCHITECTURE
    }
    $architecture = switch ($detectedArchitecture) {
      'ARM64' { 'arm64' }
      'AMD64' { 'x64' }
      default {
        throw "ARCH_UNSUPPORTED: 不支持的 Windows 架构 $detectedArchitecture"
      }
    }

    $installDir = Join-Path ([IO.Path]::GetTempPath()) (
      'aia-pgs-node-' + [Guid]::NewGuid().ToString('N')
    )
    New-Item -ItemType Directory -Path $installDir | Out-Null
    $manifestUri = 'https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt'
    $manifest = (Invoke-WebRequest -UseBasicParsing -Uri $manifestUri).Content
    $pattern = "(?m)^([a-f0-9]{64})\s+(node-v[0-9.]+-win-$architecture\.zip)$"
    $match = [regex]::Match($manifest, $pattern)
    if (-not $match.Success) {
      throw 'NODE_ARCHIVE_NOT_FOUND: 官方清单没有匹配的 Windows Node.js 包'
    }

    $expected = $match.Groups[1].Value
    $archive = $match.Groups[2].Value
    $archivePath = Join-Path $installDir $archive
    Write-Host '📦 正在下载官方 Node.js 22 到 Skill 私有运行目录…'
    Invoke-WebRequest -UseBasicParsing `
      -Uri "https://nodejs.org/dist/latest-v22.x/$archive" `
      -OutFile $archivePath
    $actual = (Get-FileHash -Algorithm SHA256 -Path $archivePath).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
      throw 'NODE_CHECKSUM_MISMATCH: Node.js 下载校验失败'
    }

    $expanded = Join-Path $installDir 'expanded'
    Expand-Archive -LiteralPath $archivePath -DestinationPath $expanded
    $source = Get-ChildItem -LiteralPath $expanded -Directory | Select-Object -First 1
    if (-not $source) {
      throw 'NODE_ARCHIVE_INVALID: Node.js 压缩包内容无效'
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $runtimeDir) | Out-Null
    if (Test-Path $runtimeDir) {
      Remove-Item -LiteralPath $runtimeDir -Recurse -Force
    }
    Move-Item -LiteralPath $source.FullName -Destination $runtimeDir
    $nodePath = $portableNode
  }
}

$env:Path = "$(Split-Path -Parent $nodePath);$env:Path"
Set-Location $skillRoot
Write-Host "✅ Node.js $(& $nodePath --version)"
& npm.cmd run onboard -- @OnboardArgs
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
