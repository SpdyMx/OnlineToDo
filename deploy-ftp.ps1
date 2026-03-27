[CmdletBinding()]
param(
    [Parameter()]
    [string]$Host,

    [Parameter()]
    [string]$Username,

    [Parameter()]
    [string]$Password,

    [string]$RemotePath = '/',

    [string]$LocalPath = '.\api',

    [string]$ConfigFile = '.\deploy-ftp.config.json',

    [switch]$EnableSsl,

    [switch]$SkipBuild,

    [switch]$SkipComposer,

    [switch]$SkipNpmInstall
)

$ErrorActionPreference = 'Stop'

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

function Validate-FtpConnection {
    param(
        [Parameter(Mandatory = $true)][string]$FtpHost,
        [Parameter(Mandatory = $true)][string]$RemoteBasePath
    )

    # Validate credentials by requesting working directory.
    $rootUri = New-FtpUri -FtpHost $FtpHost -Path '/'
    Invoke-FtpRequest -Uri $rootUri -Method ([System.Net.WebRequestMethods+Ftp]::PrintWorkingDirectory) | Out-Null

    # Validate access to destination path (and create path if needed).
    Ensure-FtpDirectory -FtpHost $FtpHost -AbsoluteRemotePath $RemoteBasePath
    $targetUri = New-FtpUri -FtpHost $FtpHost -Path $RemoteBasePath
    Invoke-FtpRequest -Uri $targetUri -Method ([System.Net.WebRequestMethods+Ftp]::ListDirectory) | Out-Null
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

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Resolve-InputPath -Root $repoRoot -Path $ConfigFile
$config = Load-DeployConfig -Path $configPath

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
    elseif ($config.Password) {
        $Password = [string]$config.Password
    }
}
if (-not $remotePathProvided -and $config -and $config.RemotePath) { $RemotePath = [string]$config.RemotePath }
if (-not $localPathProvided -and $config -and $config.LocalPath) { $LocalPath = [string]$config.LocalPath }
if (-not $sslProvided -and $config -and $config.EnableSsl -eq $true) { $EnableSsl = $true }

if ([string]::IsNullOrWhiteSpace($Host) -or [string]::IsNullOrWhiteSpace($Username) -or [string]::IsNullOrWhiteSpace($Password)) {
    throw 'Missing FTP credentials. Provide -Host, -Username, -Password once, then they will be loaded from config for next runs.'
}

$remoteBase = $RemotePath.Replace('\\', '/').Trim()
if ([string]::IsNullOrWhiteSpace($remoteBase)) {
    $remoteBase = '/'
}
if (-not $remoteBase.StartsWith('/')) {
    $remoteBase = '/' + $remoteBase
}

Write-Host "==> FTP host: $Host" -ForegroundColor Cyan
Write-Host "==> Remote base: $remoteBase" -ForegroundColor Cyan
if ($EnableSsl) {
    Write-Host '==> FTP SSL/TLS: enabled' -ForegroundColor Cyan
}
else {
    Write-Host '==> FTP SSL/TLS: disabled (plain FTP)' -ForegroundColor Yellow
}

Write-Host '==> Validating FTP connection and destination access' -ForegroundColor Cyan
Validate-FtpConnection -FtpHost $Host -RemoteBasePath $remoteBase

$configToSave = @{
    Host = $Host
    Username = $Username
    PasswordEncrypted = (Protect-Password -PlainPassword $Password)
    RemotePath = $remoteBase
    LocalPath = $LocalPath
    EnableSsl = [bool]$EnableSsl
    UpdatedAt = (Get-Date).ToString('o')
}
Save-DeployConfig -Path $configPath -Data $configToSave
Write-Host "==> Config saved: $configPath" -ForegroundColor Green

if ($SkipBuild) {
    Write-Host '==> Skipping build (-SkipBuild specified)' -ForegroundColor Yellow
}
else {
    Write-Host '==> Building release before upload' -ForegroundColor Cyan
    $buildScript = Join-Path $repoRoot 'build-release.ps1'

    $buildArgs = @{}
    if ($SkipComposer) { $buildArgs.SkipComposer = $true }
    if ($SkipNpmInstall) { $buildArgs.SkipNpmInstall = $true }

    & $buildScript @buildArgs
}

$localInputPath = Resolve-InputPath -Root $repoRoot -Path $LocalPath
$resolvedLocalPath = Resolve-Path -Path $localInputPath
$localRoot = $resolvedLocalPath.Path

Write-Host "==> Upload source: $localRoot" -ForegroundColor Cyan

$allFiles = Get-ChildItem -Path $localRoot -Recurse -File
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

Write-Host '==> FTP deployment completed successfully.' -ForegroundColor Green
