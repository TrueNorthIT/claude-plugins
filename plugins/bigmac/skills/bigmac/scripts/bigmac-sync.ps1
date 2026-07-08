#!/usr/bin/env pwsh
# bigmac-sync [workspace-name] — sync the current git repo's working tree to
# bigmac for delegated exploration. USER-TRIGGERED by design: you are shipping
# source code to the office box (LAN/tailnet-readable) — run it deliberately.
#
# Sends tracked + untracked-unignored files (so .env, node_modules etc. are
# excluded via .gitignore), minus a hard deny-list of secret-shaped files.
# Wipe-and-replace on the box; stamps .bigmac-synced (7-day auto-purge).
param(
    [string]$Name,
    [string]$BoxHost = 'bigmac@bigmac',
    [string]$KeyFile = "$HOME\.ssh\bigmac_ed25519"
)

$root = git rev-parse --show-toplevel 2>$null
if (-not $root) { Write-Error 'not inside a git repository'; exit 1 }
Set-Location $root
if (-not $Name) { $Name = (Split-Path $root -Leaf) }
# Sanitize UNCONDITIONALLY — the name is interpolated into a remote shell command,
# so a crafted value (e.g. ../../.ssh) would write outside the workspace jail.
$Name = $Name.ToLower() -replace '[^a-z0-9._-]', '-'
if ($Name -notmatch '^[a-z0-9][a-z0-9._-]*$' -or $Name -match '\.\.') {
    Write-Error "invalid workspace name after sanitizing: '$Name'"; exit 1
}

$deny = '(?i)(^|/)\.env|\.pem$|\.key$|\.pfx$|\.p12$|\.p8$|\.jks$|\.keystore$|(^|/)id_[a-z0-9]+$|(^|/)\.git/|(^|/)\.npmrc$|(^|/)\.netrc$|(^|/)\.git-credentials$|(^|/)credentials$'
# -co lists tracked + untracked-unignored; drop deny-listed and symlinks (a symlink
# could point outside the jail once recreated on the box).
$files = git ls-files -co --exclude-standard | Where-Object {
    $_ -notmatch $deny -and -not ((Get-Item -LiteralPath $_ -Force -ErrorAction SilentlyContinue).LinkType)
}
if (-not $files) { Write-Error 'nothing to sync'; exit 1 }

$listFile = New-TemporaryFile
$files | Set-Content $listFile -Encoding utf8
Write-Host "Syncing $($files.Count) files from $root -> ${BoxHost}:~/delegate/workspaces/$Name"

tar -cf - -T $listFile.FullName | ssh -i $KeyFile -o BatchMode=yes $BoxHost `
    "rm -rf ~/delegate/workspaces/$Name && mkdir -p ~/delegate/workspaces/$Name && tar -xf - -C ~/delegate/workspaces/$Name && date -u +%Y-%m-%dT%H:%M:%SZ > ~/delegate/workspaces/$Name/.bigmac-synced && echo SYNCED: `$(find ~/delegate/workspaces/$Name -type f | wc -l | tr -d ' ') files"
Remove-Item $listFile -Force
Write-Host "Workspace name for explore_start: $Name"
