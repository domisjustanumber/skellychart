#Requires -Version 5.1
<#
.SYNOPSIS
  Create/update .venv with uv, export OpenCV DICT_4X4_250 to src/skelly-charuco/dict4x4_250_rot0.ts, verify raster, remove temp files.

.NOTES
  Run from anywhere: pwsh -File tests/opencv-dict-sync.ps1
  Requires: uv, Node.js (npm), repo dependencies (npm install).
#>
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$TmpBin = Join-Path $RepoRoot '.tmp_ts_charuco_gray.bin'
$VenvPy = Join-Path $RepoRoot '.venv\Scripts\python.exe'

function Remove-TmpBin {
    if (Test-Path -LiteralPath $TmpBin) {
        Remove-Item -LiteralPath $TmpBin -Force
    }
}

try {
    Set-Location $RepoRoot

    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
        throw 'uv not found on PATH. Install: https://docs.astral.sh/uv/getting-started/installation/'
    }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw 'npm not found on PATH. Install Node.js.'
    }

    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'node_modules'))) {
        npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)." }
    }

    if (-not (Test-Path -LiteralPath $VenvPy)) {
        uv venv (Join-Path $RepoRoot '.venv')
        if ($LASTEXITCODE -ne 0) { throw "uv venv failed (exit $LASTEXITCODE)." }
    }
    uv pip install --python $VenvPy -r (Join-Path $PSScriptRoot 'opencv-qr-test\requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw "uv pip install failed (exit $LASTEXITCODE)." }

    & $VenvPy (Join-Path $PSScriptRoot 'opencv-qr-test\export_dict4x4_250_ts.py')
    if ($LASTEXITCODE -ne 0) { throw "export_dict4x4_250_ts.py failed (exit $LASTEXITCODE)." }
    & $VenvPy (Join-Path $PSScriptRoot 'opencv-qr-test\verify_charuco_raster.py')
    if ($LASTEXITCODE -ne 0) { throw "verify_charuco_raster.py failed (exit $LASTEXITCODE)." }

    Write-Host "OK: OpenCV dict -> TypeScript export and raster check completed." -ForegroundColor Green
}
finally {
    Remove-TmpBin
}
