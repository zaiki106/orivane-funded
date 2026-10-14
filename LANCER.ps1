$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskUrl = 'http://127.0.0.1:4328'
try {
  $taskState = Invoke-RestMethod -Uri ($taskUrl + '/health') -TimeoutSec 2
  if ($taskState.application -eq 'orivane-terminal') { Start-Process $taskUrl; exit }
  throw 'Le port 4328 est utilisé par une autre application.'
} catch {
  if ($_.Exception.Message -like '*autre application*') { throw }
}
$taskNode = (Get-Command node -ErrorAction Stop).Source
$taskLogDir = Join-Path $taskRoot 'runtime'
New-Item -ItemType Directory -Path $taskLogDir -Force | Out-Null
$taskServer = Join-Path $taskRoot 'src/terminal-server.mjs'
Start-Process -FilePath $taskNode -ArgumentList @('--env-file-if-exists=.env', ('"' + $taskServer + '"')) -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskLogDir 'server.log') -RedirectStandardError (Join-Path $taskLogDir 'server-error.log')
for ($taskAttempt = 0; $taskAttempt -lt 20; $taskAttempt++) {
  try { $null = Invoke-RestMethod -Uri ($taskUrl + '/health') -TimeoutSec 1; Start-Process $taskUrl; exit } catch { Start-Sleep -Milliseconds 250 }
}
throw 'Le terminal ne démarre pas. Consulter runtime/server-error.log.'
