# OnlineToDo (Unified PHP + React App)

This repository is now configured to run as a single website on shared hosting with PHP 8.3+.

- Backend API: Slim (PHP) in `api/`
- Frontend app: React/Vite source in `frontend/`
- Final deployable web root: `api/public/`

## How It Works

- Frontend production build is generated directly into `api/public/`.
- API calls use `./api/*`, so frontend and API run from the same host/path.
- Apache rewrite sends unknown routes to `api/public/index.php`.
- Slim serves `index.html` for unknown non-API routes (SPA fallback).

## Local Build

Fastest option (Windows, one command from repository root):

```powershell
./build-release.ps1
```

Or double-click / run:

```bat
build-release.bat
```

1. Install PHP dependencies:

```bash
cd api
composer install --no-dev --optimize-autoloader
```

2. Install frontend dependencies and build:

```bash
cd ../frontend
npm install
npm run build
```

3. Configure your web server document root to `api/public`.

## Shared Hosting Deployment

1. Build locally using the steps above.
2. Upload at least these folders/files:
   - `api/public`
   - `api/src`
   - `api/app`
   - `api/vendor`
   - `api/var`
   - `api/.env` (if used)
   - `api/composer.json`
3. On hosting control panel, set document root to the uploaded `public` folder.
4. Ensure PHP version is `8.3` or newer.
5. Ensure write permissions for logs/cache if needed:
   - `api/var`
   - `api/logs`

## Notes

- If your host does not run `composer install`, upload the local `vendor` directory.
- If your app is in a subdirectory, this setup keeps API calls on the same base path.

## FileZilla Deployment (Green / Infomaniak)

Use this workflow for both Green and Infomaniak.

1. Build locally from repository root:

```powershell
./build-release.ps1
```

2. In your hosting panel, set your domain document root to a `public` folder (for example `online-todo/public`).
3. In FileZilla, connect with your FTP credentials.
4. Upload the full `api` project content into the parent folder (for example upload local `api/*` into remote `online-todo/`).
5. Confirm these folders exist remotely:
   - `online-todo/public`
   - `online-todo/src`
   - `online-todo/app`
   - `online-todo/vendor`
   - `online-todo/var`
6. In hosting panel, set PHP version to `8.3` or newer.
7. Ensure write permissions on:
   - `online-todo/var`
   - `online-todo/logs`

### Green Hosting Notes

- In Green hosting manager, check the domain/web root setting and point it to your deployment `public` folder.
- If FTP root is fixed, create a subfolder (example `online-todo`) and point the domain to `online-todo/public`.

### Infomaniak Notes

- In Infomaniak Manager, set site path/document root to your deployment `public` folder.
- If the domain currently points to a default folder, change it to your app `public` path before testing.

### Verify After Upload

1. Open your domain and test frontend navigation (`/login`, `/register`, `/profile`).
2. Verify API calls work from browser devtools (`/api/login`, `/api/me`).
3. If login fails with auth errors, check that `.htaccess` is uploaded in `public` and Apache rewrite is enabled.

## Windows FTP Script Deployment

You can deploy using built-in Windows FTP support with the provided script:

- Script: `deploy-ftp.ps1`
- Wrapper: `deploy-ftp.bat`
- Config file (auto created/updated after successful validation): `deploy-ftp.config.json`

The script always builds the frontend before uploading. Use `-SkipBuild` to skip the build step if you already built manually.

### First run (save connection settings)

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-ftp.ps1 `
   -Host "ftp.your-host.com" `
   -Username "your-ftp-user" `
   -Password "your-ftp-password" `
   -RemotePath "/online-todo" `
   -LocalPath ".\api" `
   -EnableSsl
```

### Next runs (reuse saved config)

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-ftp.ps1
```

The build runs automatically every time. You can still override any value on the command line. If validation succeeds, the config is refreshed with the latest working values.

### Deploy without rebuilding

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-ftp.ps1 -SkipBuild
```

### Example (plain FTP)

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-ftp.ps1 `
   -Host "ftp.your-host.com" `
   -Username "your-ftp-user" `
   -Password "your-ftp-password" `
   -RemotePath "/online-todo" `
   -LocalPath ".\api"
```

### Example (FTPS / FTP over TLS)

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-ftp.ps1 `
   -Host "ftp.your-host.com" `
   -Username "your-ftp-user" `
   -Password "your-ftp-password" `
   -RemotePath "/online-todo" `
   -LocalPath ".\api" `
   -EnableSsl
```

### Build + deploy in one command

The build is now always included. Simply run:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-ftp.ps1
```

This uploads the full content of local `api/` to your remote path (for example to `online-todo/`), so your web root must point to `online-todo/public`.

Security note: plain FTP sends credentials in clear text. Prefer `-EnableSsl` when your host supports FTPS.

Security note: the script stores the password encrypted with Windows DPAPI for the current user account on the current machine.

## Beta And Production FTP Scripts

Two profile-specific scripts are available:

- Beta: `deploy-ftp-beta.ps1` (wrapper: `deploy-ftp-beta.bat`)
- Production: `deploy-ftp-prod.ps1` (wrapper: `deploy-ftp-prod.bat`)

Behavior:

- Beta build output is prepared in `beta/` with no minification and no obfuscation.
- Production build output is prepared in `prod/` with minification, JS obfuscation, and PHP obfuscation (token/whitespace compaction via `php -w`).
- Each script uses its own saved config file:
   - Beta: `deploy-ftp-beta.config.json`
   - Production: `deploy-ftp-prod.config.json`
- If no parameters are provided and no saved config exists, script help is displayed.

### First run beta

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-ftp-beta.ps1 `
   -Host "ftp.your-host.com" `
   -Username "your-ftp-user" `
   -Password "your-ftp-password" `
   -RemotePath "/online-todo-beta" `
   -EnableSsl
```

### First run production

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-ftp-prod.ps1 `
   -Host "ftp.your-host.com" `
   -Username "your-ftp-user" `
   -Password "your-ftp-password" `
   -RemotePath "/online-todo-prod" `
   -EnableSsl
```

### Next runs (reuse saved settings)

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-ftp-beta.ps1
powershell -ExecutionPolicy Bypass -File .\deploy-ftp-prod.ps1
```
