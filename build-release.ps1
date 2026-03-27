param(
    [switch]$SkipComposer,
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "==> Building OnlineToDo for shared hosting" -ForegroundColor Cyan

if (-not $SkipComposer) {
    Write-Host "==> Installing PHP production dependencies" -ForegroundColor Yellow
    Push-Location (Join-Path $root 'api')
    try {
        composer install --no-dev --optimize-autoloader
    }
    finally {
        Pop-Location
    }
}

Push-Location (Join-Path $root 'frontend')
try {
    if (-not $SkipNpmInstall) {
        Write-Host "==> Installing frontend dependencies" -ForegroundColor Yellow
        npm install
    }

    Write-Host "==> Building frontend into api/public" -ForegroundColor Yellow
    npm run build
}
finally {
    Pop-Location
}

Write-Host "==> Done. Upload api/ to hosting and point domain to api/public" -ForegroundColor Green
