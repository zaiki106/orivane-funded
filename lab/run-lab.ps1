param(
  [ValidateSet('bootstrap','download','normalize','train','api','status','test','verify','collect','replay','qlib','research')]
  [string]$Mode = 'status',
  [string]$InputFile,
  [string]$Instrument = 'BTC/USD',
  [string]$Since = '2024-09-30',
  [int]$Port = 8765,
  [int]$Seconds = 120
)
$ErrorActionPreference = 'Stop'
$taskLabRoot = $PSScriptRoot
$taskDataRoot = [System.IO.Path]::GetFullPath((Join-Path $taskLabRoot '../orivane-data'))
$taskVenvPython = Join-Path $taskLabRoot '.venv/Scripts/python.exe'
Push-Location $taskLabRoot
try {
  if ($Mode -eq 'bootstrap') {
    $taskBundledPython = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
    if (!(Test-Path -LiteralPath $taskBundledPython)) {
      throw 'Python 3.12 requis. Installe Python 3.12 ou cree .venv avec Python 3.12, puis relance.'
    }
    if (!(Test-Path -LiteralPath $taskVenvPython)) {
      & $taskBundledPython -m venv .venv
      if ($LASTEXITCODE -ne 0) { throw 'Creation .venv echouee' }
    }
    & $taskVenvPython -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Installation scientifique echouee' }
    $taskQlibPython = Join-Path $taskLabRoot '.qlib-venv/Scripts/python.exe'
    if (!(Test-Path -LiteralPath $taskQlibPython)) {
      & $taskBundledPython -m venv .qlib-venv
      if ($LASTEXITCODE -ne 0) { throw 'Creation .qlib-venv echouee' }
    }
    & $taskQlibPython -m pip install -r requirements-qlib-core.txt
    if ($LASTEXITCODE -ne 0) { throw 'Installation Qlib scientifique echouee' }
    & $taskQlibPython -m orivane_lab.setup_qlib --install
    if ($LASTEXITCODE -ne 0) { throw 'Installation Qlib adaptee echouee' }
    if (Test-Path -LiteralPath requirements-lock.txt) {
      & $taskVenvPython -m pip install -r requirements-lock.txt
      if ($LASTEXITCODE -ne 0) { throw 'Verrouillage dependances echoue' }
    }
    if (Test-Path -LiteralPath requirements-qlib-lock.txt) {
      & $taskQlibPython -m pip install -r requirements-qlib-lock.txt
      if ($LASTEXITCODE -ne 0) { throw 'Verrouillage dependances Qlib echoue' }
    }
    & $taskVenvPython -m pip check
    if ($LASTEXITCODE -ne 0) { throw 'Dependances incompatibles' }
    & $taskQlibPython -m pip check
    if ($LASTEXITCODE -ne 0) { throw 'Dependances Qlib incompatibles' }
    exit 0
  }
  if (!(Test-Path -LiteralPath $taskVenvPython)) { throw 'Lance run-lab.ps1 -Mode bootstrap avant cette commande.' }
  switch ($Mode) {
    'download' { & $taskVenvPython -m orivane_lab.download --root $taskDataRoot --workers 4 }
    'normalize' { & $taskVenvPython -m orivane_lab.normalize --root $taskDataRoot --instrument $Instrument --since $Since }
    'train' {
      if (!$InputFile) { throw '-InputFile requis : export JSON des configurations reelles' }
      & $taskVenvPython -m orivane_lab.train --root $taskDataRoot --input $InputFile
    }
    'research' {
      if (!$InputFile) { throw '-InputFile requis : jeu reel 15m ou evenements NDJSON' }
      if ($InputFile.EndsWith('.ndjson')) { & $taskVenvPython -m orivane_lab.strategy_lab --root $taskDataRoot --events $InputFile }
      else { & $taskVenvPython -m orivane_lab.strategy_lab --root $taskDataRoot --dataset $InputFile }
    }
    'api' { & $taskVenvPython -m orivane_lab.api --root $taskDataRoot --port $Port }
    'status' { & $taskVenvPython -m orivane_lab.status --root $taskDataRoot }
    'verify' { & $taskVenvPython -m orivane_lab.verify --root $taskDataRoot }
    'collect' { & $taskVenvPython -m orivane_lab.collector --root $taskDataRoot --seconds $Seconds }
    'replay' { & $taskVenvPython -m orivane_lab.replay --root $taskDataRoot --live-capture }
    'qlib' {
      if (!$InputFile) { throw '-InputFile requis pour les facteurs Qlib' }
      $taskQlibPython = Join-Path $taskLabRoot '.qlib-venv/Scripts/python.exe'
      & $taskQlibPython -m orivane_lab.qlib_factors --root $taskDataRoot --input $InputFile
    }
    'test' { & $taskVenvPython -m pytest -q }
  }
  if ($LASTEXITCODE -ne 0) { throw "Commande $Mode echouee; sources preservees" }
} finally { Pop-Location }
