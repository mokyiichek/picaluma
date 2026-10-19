# Publish the landing page to https://ahmok.com/picaluma/ (TO server, nginx webroot /var/www/ahmok).
# Needs the deploy key (~/.ssh/picaluma_deploy) authorised for root on the server.
param(
  [string]$ServerHost = $(if ($env:PICALUMA_DEPLOY_HOST) { $env:PICALUMA_DEPLOY_HOST } else { 'ahmok.com' }),
  [string]$Key = "$env:USERPROFILE\.ssh\picaluma_deploy",
  [string]$Remote = '/var/www/ahmok/picaluma'
)
$ErrorActionPreference = 'Stop'
$site = $PSScriptRoot
$files = Get-ChildItem $site -File | Where-Object { $_.Extension -in '.html', '.png', '.jpg', '.css', '.js', '.svg', '.ico' }
ssh -i $Key -o BatchMode=yes "root@$ServerHost" "mkdir -p $Remote"
scp -i $Key -o BatchMode=yes @($files.FullName) "root@${ServerHost}:$Remote/"
# One-line Mac installer: curl -fsSL https://ahmok.com/picaluma/install.sh | bash
scp -i $Key -o BatchMode=yes "$site\..\scripts\install-mac.sh" "root@${ServerHost}:$Remote/install.sh"
# Match the ownership/permissions of the rest of the webroot so nginx can serve it.
ssh -i $Key -o BatchMode=yes "root@$ServerHost" "chown -R --reference=/var/www/ahmok $Remote; chmod 755 $Remote; chmod 644 $Remote/*"
Write-Host "Deployed $($files.Count) files to https://ahmok.com/picaluma/"
