# Windows PowerShell 5.1+; no administrator privileges, Git, or Docker required.
$ErrorActionPreference = 'Stop'
$hoverManagedRoot = Join-Path $env:LOCALAPPDATA 'HoverCV'
$hoverStatePath = Join-Path $hoverManagedRoot 'current.json'
$hoverSourceBase = 'https://raw.githubusercontent.com/Roy-Loong/HoverCV-resume/main'
$hoverAddress = 'http://localhost:3000'

function Get-HoverHealth {
    try { return Invoke-RestMethod -Uri "$hoverAddress/api/health" -TimeoutSec 3 }
    catch { return $null }
}

function Stop-PreviousHoverCV {
    $listeners = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
    $owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($owner in $owners) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $owner"
        # Stop only a Node/Next process whose command line identifies HoverCV.
        if ($process.Name -ne 'node.exe' -or $process.CommandLine -notmatch '(?i)HoverCV.*[\\/]node_modules[\\/]next[\\/]') {
            throw 'Port 3000 is occupied by an unrecognized process. Close the old HoverCV terminal window and try again. No unrelated process was stopped.'
        }
        $hoverProcessId = [int]$process.ProcessId
        while ($process.ParentProcessId -gt 0) {
            $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.ParentProcessId)" -ErrorAction SilentlyContinue
            if (!$parent -or $parent.Name -ne 'node.exe' -or $parent.CommandLine -notmatch '(?i)(HoverCV.*[\\/]node_modules[\\/]next[\\/]|scripts[\\/]local-preview\.mjs)') { break }
            $hoverProcessId = [int]$parent.ProcessId
            $process = $parent
        }
        # /T includes this server's child processes; it never targets every node.exe.
        & taskkill.exe /PID $hoverProcessId /T /F | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not stop the previous HoverCV process. Close its terminal window and retry.' }
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (@(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue).Count) {
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Port 3000 is still busy. Close the old HoverCV terminal window and retry.' }
        Start-Sleep -Milliseconds 250
    }
}

try {
    $nodeVersion = & node --version
    if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw 'Node.js 24 or newer is required.' }
    New-Item -ItemType Directory -Path $hoverManagedRoot -Force | Out-Null

    # Install a persistent updater and a Desktop shortcut for subsequent tests.
    $hoverBatch = Join-Path $hoverManagedRoot 'Update-HoverCV.bat'
    $batchText = '@echo off' + "`r`n" + 'powershell.exe -NoProfile -Command "$ErrorActionPreference=''Stop''; try { Invoke-RestMethod -Uri ''https://raw.githubusercontent.com/Roy-Loong/HoverCV-resume/main/scripts/windows-update.ps1'' | Invoke-Expression } catch { Write-Host $_ -ForegroundColor Red; exit 1 }"' + "`r`n" + 'if errorlevel 1 pause' + "`r`n"
    [IO.File]::WriteAllText($hoverBatch, $batchText, [Text.Encoding]::ASCII)
    $desktop = [Environment]::GetFolderPath('Desktop')
    if ($desktop) {
        # Use Unicode escapes so this file also works when Windows reads it as ANSI.
        $shortcutName = 'HoverCV ' + [char]0x66F4 + [char]0x65B0 + [char]0x5E76 + [char]0x542F + [char]0x52A8 + '.lnk'
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut((Join-Path $desktop $shortcutName))
        $shortcut.TargetPath = $hoverBatch
        $shortcut.WorkingDirectory = $hoverManagedRoot
        $shortcut.Description = 'Update and open HoverCV. Existing browser projects stay at localhost:3000.'
        $shortcut.Save()
    }

    Write-Host '[1/4] Checking latest HoverCV version...'
    $manifest = Invoke-RestMethod -Uri "$hoverSourceBase/package.json" -TimeoutSec 30
    if ($manifest.name -ne 'hovercv' -or $manifest.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Unexpected source manifest.' }
    $state = $null
    if (Test-Path -LiteralPath $hoverStatePath) {
        try { $state = Get-Content -LiteralPath $hoverStatePath -Raw | ConvertFrom-Json } catch { $state = $null }
    }
    $project = $null
    if ($state -and $state.version -eq $manifest.version -and $state.project) {
        $resolved = [IO.Path]::GetFullPath([string]$state.project)
        $allowedRoot = [IO.Path]::GetFullPath((Join-Path $hoverManagedRoot 'versions')) + [IO.Path]::DirectorySeparatorChar
        if ($resolved.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath (Join-Path $resolved 'scripts\local-preview.mjs'))) { $project = $resolved }
    }
    if (!$project) {
        $folder = Join-Path (Join-Path $hoverManagedRoot 'versions') ($manifest.version + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
        $zip = Join-Path $folder 'source.zip'
        Write-Host '[2/4] Downloading and extracting automatically...'
        Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/Roy-Loong/HoverCV-resume/archive/refs/heads/main.zip' -OutFile $zip -TimeoutSec 180
        Expand-Archive -LiteralPath $zip -DestinationPath $folder
        $project = Join-Path $folder 'HoverCV-resume-main'
        $downloaded = Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json
        if ($downloaded.name -ne 'hovercv' -or $downloaded.version -ne $manifest.version) { throw 'Source version changed during download. Please retry.' }
    } else { Write-Host '[2/4] This version is already downloaded.' }

    Write-Host '[3/4] Preparing components. Keep this window open...'
    & node (Join-Path $project 'scripts\local-preview.mjs') --install-only
    if ($LASTEXITCODE -ne 0) { throw 'Component installation failed. Your previous installation and browser project are unchanged.' }
    $health = Get-HoverHealth
    if ($health -and $health.version -eq $manifest.version) {
        Write-Host '[4/4] HoverCV is already running. Opening the browser...'
        Start-Process $hoverAddress
    } else {
        Write-Host '[4/4] Replacing the old server and starting HoverCV...'
        Stop-PreviousHoverCV
        Start-Process -FilePath (Join-Path $project 'Start-HoverCV-Windows.bat') -WorkingDirectory $project
    }
    @{ version = $manifest.version; project = $project } | ConvertTo-Json | Set-Content -LiteralPath $hoverStatePath -Encoding UTF8
    Write-Host ('Ready: HoverCV v' + $manifest.version + '. The new window will open ' + $hoverAddress)
    Write-Host 'Next time, double-click the HoverCV update shortcut on your Desktop.'
    Write-Host 'Old source folders and browser projects were kept. Use the same browser and localhost:3000.'
} catch {
    Write-Host ('Update failed: ' + $_.Exception.Message) -ForegroundColor Red
    throw
}
