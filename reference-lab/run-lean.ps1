param(
    [string]$InputFile = (Join-Path $PSScriptRoot '../orivane-data/experiments/BTC_USD-15m.json'),
    [string]$OutputFile = (Join-Path $PSScriptRoot 'lean-output.json'),
    [ValidateRange(60, 720)][int]$Limit = 720
)
$ErrorActionPreference = 'Stop'
$referenceRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$runtimeDirectory = Join-Path $referenceRoot 'runtime'
[System.IO.Directory]::CreateDirectory($runtimeDirectory) | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$libraries = @()
foreach ($package in Get-ChildItem -LiteralPath (Join-Path $referenceRoot 'packages') -Recurse -Filter '*.nupkg') {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($package.FullName)
    try {
        $candidates = @($zip.Entries | Where-Object { $_.FullName -match '^lib/([^/]+)/[^/]+\.dll$' })
        $target = @('net10.0', 'net8.0', 'net6.0', 'netstandard2.0', 'netstandard1.3', 'net45') | Where-Object { $candidate = $_; $candidates.FullName -match ('^lib/' + [regex]::Escape($candidate) + '/') } | Select-Object -First 1
        if (-not $target) { continue }
        foreach ($entry in $candidates | Where-Object { $_.FullName.StartsWith('lib/' + $target + '/') }) {
            $destination = [System.IO.Path]::GetFullPath((Join-Path $runtimeDirectory $entry.Name))
            if (-not $destination.StartsWith($referenceRoot + [System.IO.Path]::DirectorySeparatorChar)) { throw 'Unsafe assembly destination' }
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
            $libraries += $destination
        }
    } finally { $zip.Dispose() }
}
foreach ($library in $libraries) { [System.Reflection.Assembly]::LoadFrom($library) | Out-Null }
$inputFile = [System.IO.Path]::GetFullPath($InputFile)
$datasets = Get-Content -LiteralPath $inputFile -Raw | ConvertFrom-Json -DateKind String
$dataset = @($datasets) | Where-Object { $_.symbol -eq 'BTC/USD' } | Select-Object -First 1
if (-not $dataset -or $dataset.source -ne 'Kraken public · spot' -or $dataset.timeframe -ne 15) { throw 'Real Kraken BTC 15m dataset required' }
$bars = @($dataset.bars | Select-Object -Last $Limit)
if ($bars.Count -lt 60) { throw 'At least 60 real bars required' }
$sma = [QuantConnect.Indicators.SimpleMovingAverage]::new(20)
$sd = [QuantConnect.Indicators.StandardDeviation]::new(20)
$rows = @()
$previousTime = [DateTime]::MinValue
foreach ($bar in $bars) {
    $time = [DateTimeOffset]::Parse($bar.time).UtcDateTime
    if (-not ([double]$bar.close -gt 0) -or -not [double]::IsFinite([double]$bar.close) -or $time -le $previousTime -or $bar.closed -eq $false) { throw 'Invalid or unordered real close' }
    $previousTime = $time
    $sma.Update($time, [decimal]$bar.close) | Out-Null
    $sd.Update($time, [decimal]$bar.close) | Out-Null
    if ($sma.IsReady -and $sd.IsReady) { $rows += [ordered]@{time=$bar.time; close=[double]$bar.close; sma20=[double]$sma.Current.Value; sd20=[double]$sd.Current.Value} }
}
$report = [ordered]@{schemaVersion=1; generatedAt=[DateTimeOffset]::UtcNow.ToString('o'); runtime=[System.Runtime.InteropServices.RuntimeInformation]::FrameworkDescription; powershell=$PSVersionTable.PSVersion.ToString(); sdkRequired=$false; engine='QuantConnect.Indicators'; packageVersion='2.5.18164'; commit='ea3d5159152530d58f3afe2feced990a0bf64b96'; source=$dataset.source; symbol=$dataset.symbol; synthetic=$false; orderExecution=$false; inputSha256=(Get-FileHash -LiteralPath $inputFile -Algorithm SHA256).Hash.ToLowerInvariant(); limit=$Limit; bars=$bars.Count; sample=$rows.Count; rows=$rows}
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath ([System.IO.Path]::GetFullPath($OutputFile)) -Encoding utf8
Write-Output ('LEAN runtime succeeded: ' + $rows.Count + ' real observations, SMA20 and population SD20')
