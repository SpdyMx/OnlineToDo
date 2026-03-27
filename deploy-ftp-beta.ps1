[CmdletBinding()]
param(
    [Parameter()]
    [string]$Host,

    [Parameter()]
    [string]$Username,

    [Parameter()]
    [string]$Password,

    [string]$RemotePath = '/',

    [string]$LocalPath,

    [string]$ConfigFile,

    [switch]$EnableSsl,

    [switch]$SkipBuild,

    [switch]$SkipComposer,

    [switch]$SkipNpmInstall,

    [switch]$DeleteOrphans
)

$ErrorActionPreference = 'Stop'
$ProfileName = 'beta'
$DefaultLocalPath = '.\\beta'
$DefaultConfigFile = '.\\deploy-ftp-beta.config.json'
$UseMinify = $false
$UseObfuscation = $false

function Convert-SecureStringToPlainText {
    param([Parameter(Mandatory = $true)][Security.SecureString]$SecureString)

    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function Protect-Password {
    param([Parameter(Mandatory = $true)][string]$PlainPassword)

    $secure = ConvertTo-SecureString -String $PlainPassword -AsPlainText -Force
    return ConvertFrom-SecureString -SecureString $secure
}

function Unprotect-Password {
    param([Parameter(Mandatory = $true)][string]$EncryptedPassword)

    try {
        $secure = ConvertTo-SecureString -String $EncryptedPassword
        return Convert-SecureStringToPlainText -SecureString $secure
    }
    catch {
        return $null
    }
}

function Resolve-InputPath {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Path
    )

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return $Path
    }

    return (Join-Path $Root $Path)
}

function Load-DeployConfig {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -Path $Path -PathType Leaf)) {
        return $null
    }

    $raw = Get-Content -Path $Path -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return $null
    }

    return ($raw | ConvertFrom-Json)
}

function Save-DeployConfig {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][hashtable]$Data
    )

    $configDir = Split-Path -Parent $Path
    if ($configDir -and -not (Test-Path -Path $configDir -PathType Container)) {
        New-Item -ItemType Directory -Path $configDir | Out-Null
    }

    $json = $Data | ConvertTo-Json -Depth 10
    Set-Content -Path $Path -Value $json -Encoding UTF8
}

function New-FtpUri {
    param(
        [Parameter(Mandatory = $true)][string]$FtpHost,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $trimmedHost = $FtpHost.TrimEnd('/')
    $normalizedPath = $Path.Replace('\\', '/').Trim()

    if ([string]::IsNullOrWhiteSpace($normalizedPath)) {
        $normalizedPath = '/'
    }

    if (-not $normalizedPath.StartsWith('/')) {
        $normalizedPath = '/' + $normalizedPath
    }

    return "ftp://$trimmedHost$normalizedPath"
}

function Invoke-FtpRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$Method,
        [System.IO.Stream]$InputStream,
        [switch]$IgnoreErrors
    )

    $request = [System.Net.FtpWebRequest]::Create($Uri)
    $request.Method = $Method
    $request.Credentials = New-Object System.Net.NetworkCredential($Username, $Password)
    $request.UseBinary = $true
    $request.UsePassive = $true
    $request.KeepAlive = $false
    $request.EnableSsl = [bool]$EnableSsl

    if ($InputStream) {
        $request.ContentLength = $InputStream.Length
        $requestStream = $request.GetRequestStream()
        try {
            $InputStream.CopyTo($requestStream)
        }
        finally {
            $requestStream.Dispose()
        }
    }

    try {
        $response = $request.GetResponse()
        try {
            return $response.StatusDescription
        }
        finally {
            $response.Dispose()
        }
    }
    catch {
        if ($IgnoreErrors) {
            return $null
        }

        throw
    }
}

function Get-FtpDirectoryListing {
    param(
        [Parameter(Mandatory = $true)][string]$FtpHost,
        [Parameter(Mandatory = $true)][string]$RemotePath
    )

    $uri = New-FtpUri -FtpHost $FtpHost -Path $RemotePath
    $request = [System.Net.FtpWebRequest]::Create($uri)
    $request.Method = [System.Net.WebRequestMethods+Ftp]::ListDirectoryDetails
    $request.Credentials = New-Object System.Net.NetworkCredential($Username, $Password)
    $request.UseBinary = $true
    $request.UsePassive = $true
    $request.KeepAlive = $false
    $request.EnableSsl = [bool]$EnableSsl

    try {
        $response = $request.GetResponse()
        try {
            $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
            $content = $reader.ReadToEnd()
            $reader.Dispose()
            return ($content -split "`r?`n") | Where-Object { $_ -match '\S' }
        }
        finally {
            $response.Dispose()
        }
    }
    catch {
        return @()
    }
}

function Get-RemoteFileTree {
    param(
        [Parameter(Mandatory = $true)][string]$FtpHost,
        [Parameter(Mandatory = $true)][string]$RemotePath
    )

    $result = [System.Collections.Generic.List[string]]::new()
    $lines = Get-FtpDirectoryListing -FtpHost $FtpHost -RemotePath $RemotePath

    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }

        # Unix-style: permissions links owner group size month day time/year name
        $parts = $trimmed -split '\s+', 9
        if ($parts.Count -lt 9) { continue }

        $name = $parts[8].Trim()
        if ($name -eq '.' -or $name -eq '..') { continue }

        $itemPath = ($RemotePath.TrimEnd('/') + '/' + $name)

        if ($trimmed.StartsWith('d')) {
            $subItems = Get-RemoteFileTree -FtpHost $FtpHost -RemotePath $itemPath
            foreach ($item in $subItems) { $result.Add($item) }
        }
        else {
            $result.Add($itemPath)
        }
    }

    return , $result
}

function Remove-FtpFile {
    param(
        [Parameter(Mandatory = $true)][string]$FtpHost,
        [Parameter(Mandatory = $true)][string]$RemoteFilePath
    )

    $uri = New-FtpUri -FtpHost $FtpHost -Path $RemoteFilePath
    Invoke-FtpRequest -Uri $uri -Method ([System.Net.WebRequestMethods+Ftp]::DeleteFile) -IgnoreErrors | Out-Null
}

function Ensure-FtpDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$FtpHost,
        [Parameter(Mandatory = $true)][string]$AbsoluteRemotePath
    )

    $segments = $AbsoluteRemotePath.Trim('/').Split('/', [System.StringSplitOptions]::RemoveEmptyEntries)
    if ($segments.Count -eq 0) {
        return
    }

    $current = ''
    foreach ($segment in $segments) {
        if ([string]::IsNullOrWhiteSpace($current)) {
            $current = '/' + $segment
        }
        else {
            $current = "$current/$segment"
        }

        $uri = New-FtpUri -FtpHost $FtpHost -Path $current
        Invoke-FtpRequest -Uri $uri -Method ([System.Net.WebRequestMethods+Ftp]::MakeDirectory) -IgnoreErrors | Out-Null
    }
}

function Validate-FtpConnection {
    param(
        [Parameter(Mandatory = $true)][string]$FtpHost,
        [Parameter(Mandatory = $true)][string]$RemoteBasePath
    )

    $rootUri = New-FtpUri -FtpHost $FtpHost -Path '/'
    Invoke-FtpRequest -Uri $rootUri -Method ([System.Net.WebRequestMethods+Ftp]::PrintWorkingDirectory) | Out-Null

    Ensure-FtpDirectory -FtpHost $FtpHost -AbsoluteRemotePath $RemoteBasePath
    $targetUri = New-FtpUri -FtpHost $FtpHost -Path $RemoteBasePath
    Invoke-FtpRequest -Uri $targetUri -Method ([System.Net.WebRequestMethods+Ftp]::ListDirectory) | Out-Null
}

function Upload-FtpFile {
    param(
        [Parameter(Mandatory = $true)][string]$FtpHost,
        [Parameter(Mandatory = $true)][string]$LocalFile,
        [Parameter(Mandatory = $true)][string]$RemoteFilePath
    )

    $remoteDir = [System.IO.Path]::GetDirectoryName($RemoteFilePath.Replace('/', '\\'))
    if ($remoteDir) {
        Ensure-FtpDirectory -FtpHost $FtpHost -AbsoluteRemotePath ($remoteDir.Replace('\\', '/'))
    }

    $uri = New-FtpUri -FtpHost $FtpHost -Path $RemoteFilePath

    $fileStream = [System.IO.File]::OpenRead($LocalFile)
    try {
        Invoke-FtpRequest -Uri $uri -Method ([System.Net.WebRequestMethods+Ftp]::UploadFile) -InputStream $fileStream | Out-Null
    }
    finally {
        $fileStream.Dispose()
    }
}

function Prepare-DeploymentPackage {
    param([Parameter(Mandatory = $true)][string]$Root)

    $sourceApiDir = Join-Path $Root 'api'
    $targetDir = Join-Path $Root $ProfileName

    if (Test-Path -Path $targetDir) {
        Remove-Item -Path $targetDir -Recurse -Force
    }

    New-Item -Path $targetDir -ItemType Directory | Out-Null

    Get-ChildItem -Path $sourceApiDir -Force | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination $targetDir -Recurse -Force
    }

    $testsDir = Join-Path $targetDir 'tests'
    if (Test-Path -Path $testsDir) {
        Remove-Item -Path $testsDir -Recurse -Force
    }

    $vendorDir = Join-Path $targetDir 'vendor'
    if (Test-Path -Path $vendorDir) {
        Remove-Item -Path $vendorDir -Recurse -Force
    }

    if (-not $SkipComposer) {
        Write-Host "==> [$ProfileName] Installing PHP dependencies" -ForegroundColor Yellow
        Push-Location $targetDir
        try {
            composer install --no-dev --optimize-autoloader
        }
        finally {
            Pop-Location
        }
    }

    Write-Host "==> [$ProfileName] Building frontend (no minification/obfuscation)" -ForegroundColor Yellow
    Push-Location (Join-Path $Root 'frontend')
    try {
        if (-not $SkipNpmInstall) {
            npm install
        }

        $env:VITE_OUT_DIR = "../$ProfileName/public"
        $env:VITE_MINIFY = if ($UseMinify) { 'true' } else { 'false' }
        $env:VITE_SOURCEMAP = 'true'

        npm run build
    }
    finally {
        Remove-Item Env:VITE_OUT_DIR -ErrorAction SilentlyContinue
        Remove-Item Env:VITE_MINIFY -ErrorAction SilentlyContinue
        Remove-Item Env:VITE_SOURCEMAP -ErrorAction SilentlyContinue
        Pop-Location
    }
}

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

if ([string]::IsNullOrWhiteSpace($LocalPath)) {
    $LocalPath = $DefaultLocalPath
}
if ([string]::IsNullOrWhiteSpace($ConfigFile)) {
    $ConfigFile = $DefaultConfigFile
}

$configPath = Resolve-InputPath -Root $repoRoot -Path $ConfigFile
$config = Load-DeployConfig -Path $configPath

if (-not $config -and $PSBoundParameters.Count -eq 0) {
    Get-Help -Name $MyInvocation.MyCommand.Path -Detailed
    return
}

$hostProvided = $PSBoundParameters.ContainsKey('Host')
$usernameProvided = $PSBoundParameters.ContainsKey('Username')
$passwordProvided = $PSBoundParameters.ContainsKey('Password')
$remotePathProvided = $PSBoundParameters.ContainsKey('RemotePath')
$localPathProvided = $PSBoundParameters.ContainsKey('LocalPath')
$sslProvided = $PSBoundParameters.ContainsKey('EnableSsl')

if (-not $hostProvided -and $config -and $config.Host) { $Host = [string]$config.Host }
if (-not $usernameProvided -and $config -and $config.Username) { $Username = [string]$config.Username }
if (-not $passwordProvided -and $config) {
    if ($config.PasswordEncrypted) {
        $unprotected = Unprotect-Password -EncryptedPassword ([string]$config.PasswordEncrypted)
        if ($unprotected) {
            $Password = $unprotected
        }
    }
}
if (-not $remotePathProvided -and $config -and $config.RemotePath) { $RemotePath = [string]$config.RemotePath }
if (-not $localPathProvided -and $config -and $config.LocalPath) { $LocalPath = [string]$config.LocalPath }
if (-not $sslProvided -and $config -and $config.EnableSsl -eq $true) { $EnableSsl = $true }

if ([string]::IsNullOrWhiteSpace($Host) -or [string]::IsNullOrWhiteSpace($Username) -or [string]::IsNullOrWhiteSpace($Password)) {
    Get-Help -Name $MyInvocation.MyCommand.Path -Detailed
    throw 'Missing FTP credentials. Provide -Host, -Username, -Password once, then they will be loaded from config.'
}

$remoteBase = $RemotePath.Replace('\\', '/').Trim()
if ([string]::IsNullOrWhiteSpace($remoteBase)) {
    $remoteBase = '/'
}
if (-not $remoteBase.StartsWith('/')) {
    $remoteBase = '/' + $remoteBase
}

Write-Host "==> Profile: $ProfileName" -ForegroundColor Cyan
Write-Host "==> FTP host: $Host" -ForegroundColor Cyan
Write-Host "==> Remote base: $remoteBase" -ForegroundColor Cyan

Write-Host '==> Validating FTP connection and destination access' -ForegroundColor Cyan
Validate-FtpConnection -FtpHost $Host -RemoteBasePath $remoteBase

$configToSave = @{
    Host = $Host
    Username = $Username
    PasswordEncrypted = (Protect-Password -PlainPassword $Password)
    RemotePath = $remoteBase
    LocalPath = $LocalPath
    EnableSsl = [bool]$EnableSsl
    Profile = $ProfileName
    UpdatedAt = (Get-Date).ToString('o')
}
Save-DeployConfig -Path $configPath -Data $configToSave
Write-Host "==> Config saved: $configPath" -ForegroundColor Green

if ($SkipBuild) {
    Write-Host '==> Skipping build (-SkipBuild specified)' -ForegroundColor Yellow
}
else {
    Prepare-DeploymentPackage -Root $repoRoot
}

$localInputPath = Resolve-InputPath -Root $repoRoot -Path $LocalPath
$resolvedLocalPath = Resolve-Path -Path $localInputPath
$localRoot = $resolvedLocalPath.Path

Write-Host "==> Upload source: $localRoot" -ForegroundColor Cyan

$allFiles = Get-ChildItem -Path $localRoot -Recurse -File | Where-Object {
    $_.FullName -notmatch '\\tests\\' -and
    $_.FullName -notmatch '\\vendor\\'
}
$total = $allFiles.Count
$index = 0

foreach ($file in $allFiles) {
    $index++
    $relative = $file.FullName.Substring($localRoot.Length).TrimStart('\\', '/')
    $relative = $relative.Replace('\\', '/')
    $remoteFile = ($remoteBase.TrimEnd('/') + '/' + $relative).Replace('//', '/')

    Write-Host ("[{0}/{1}] Uploading {2}" -f $index, $total, $relative)
    Upload-FtpFile -FtpHost $Host -LocalFile $file.FullName -RemoteFilePath $remoteFile
}

if ($DeleteOrphans) {
    Write-Host '==> Scanning remote for orphaned files...' -ForegroundColor Cyan
    $remoteFiles = Get-RemoteFileTree -FtpHost $Host -RemotePath $remoteBase

    $localRelSet = @{}
    foreach ($file in $allFiles) {
        $rel = $file.FullName.Substring($localRoot.Length).TrimStart('\', '/')
        $rel = $rel.Replace('\', '/')
        $remoteEquiv = ($remoteBase.TrimEnd('/') + '/' + $rel).Replace('//', '/')
        $localRelSet[$remoteEquiv] = $true
    }

    $orphans = $remoteFiles | Where-Object { -not $localRelSet.ContainsKey($_) }
    if ($orphans.Count -eq 0) {
        Write-Host '==> No orphaned files found on remote.' -ForegroundColor Green
    }
    else {
        Write-Host "==> Deleting $($orphans.Count) orphaned remote file(s):" -ForegroundColor Yellow
        foreach ($orphan in $orphans) {
            Write-Host "    DELETE $orphan"
            Remove-FtpFile -FtpHost $Host -RemoteFilePath $orphan
        }
        Write-Host '==> Orphan cleanup complete.' -ForegroundColor Green
    }
}

Write-Host '==> FTP deployment completed successfully.' -ForegroundColor Green
