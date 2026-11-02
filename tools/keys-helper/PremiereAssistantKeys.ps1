# Premiere Assistant — нажиматель клавиш для автопокраски таймлайна.
# Слушает только этот компьютер (localhost:8766). Принимает от панели Premiere Assistant
# только разрешённые комбинации: Shift+3 (фокус таймлайна) и клавиши меток Ctrl+Alt+Shift+1…9, 0, F1…F6.
# Ничего другого не умеет. Работает, пока открыто окно; закройте окно — выключится.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$Port = 8766
$Version = 2
$Allow = @('shift+3') + (1..9 | ForEach-Object { "ctrl+alt+shift+$_" }) + @('ctrl+alt+shift+0') + (1..6 | ForEach-Object { "ctrl+alt+shift+f$_" })

# Только один экземпляр.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\PremiereAssistantKeys', [ref]$created)
if (-not $created) { exit 0 }

function New-Listener([string[]]$prefixes) {
  $l = New-Object System.Net.HttpListener
  foreach ($p in $prefixes) { $l.Prefixes.Add($p) }
  $l.Start()
  return $l
}

try {
  $listener = New-Listener @("http://localhost:$Port/", "http://127.0.0.1:$Port/")
} catch {
  # 127.0.0.1 может требовать прав администратора — тогда только localhost.
  $listener = New-Listener @("http://localhost:$Port/")
}

Write-Host ''
Write-Host '  Premiere Assistant — клавиши для автопокраски таймлайна' -ForegroundColor Magenta
Write-Host "  Работает на этом компьютере (localhost:$Port). Окно можно свернуть."
Write-Host '  Закройте окно, чтобы выключить.'
Write-Host ''

function To-SendKeys([string]$combo) {
  $parts = $combo.ToLower().Split('+')
  $key = $parts[-1]
  $mods = ''
  if ($parts -contains 'ctrl') { $mods += '^' }
  if ($parts -contains 'alt') { $mods += '%' }
  if ($parts -contains 'shift') { $mods += '+' }
  if ($key -match '^f\d{1,2}$') { $key = '{' + $key.ToUpper() + '}' }
  return $mods + $key
}

function Send-Keys([string[]]$keys) {
  $p = Get-Process | Where-Object { $_.ProcessName -like 'Adobe Premiere Pro*' } | Select-Object -First 1
  if (-not $p) { throw 'Premiere Pro не запущен' }
  $ws = New-Object -ComObject WScript.Shell
  $null = $ws.AppActivate($p.Id)
  Start-Sleep -Milliseconds 120
  foreach ($k in $keys) {
    [System.Windows.Forms.SendKeys]::SendWait((To-SendKeys $k))
    Start-Sleep -Milliseconds 140
  }
}

function Reply($ctx, [int]$code, $obj) {
  $json = $obj | ConvertTo-Json -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $ctx.Response.StatusCode = $code
  $ctx.Response.ContentType = 'application/json; charset=utf-8'
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.OutputStream.Close()
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $req = $ctx.Request
    # Защита от сайтов в браузере: команда /keys принимается только с заголовком X-Premiere-Assistant —
    # браузер не может отправить его на чужой адрес без разрешения CORS, а мы такого разрешения не даём.
    $path = $req.Url.AbsolutePath
    if ($req.HttpMethod -eq 'GET' -and $path -eq '/ping') {
      Write-Host ("  {0}  панель на связи" -f (Get-Date -Format 'HH:mm:ss'))
      Reply $ctx 200 @{ ok = $true; app = 'premiere-assistant-keys'; version = $Version }
    } elseif ($req.HttpMethod -eq 'POST' -and $path -eq '/keys') {
      if ($req.Headers['X-Premiere-Assistant'] -ne '1') { Reply $ctx 403 @{ ok = $false; error = 'forbidden' }; continue }
      $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
      $body = $reader.ReadToEnd() | ConvertFrom-Json
      $keys = @($body.keys | ForEach-Object { "$_".ToLower() })
      if ($keys.Count -lt 1 -or $keys.Count -gt 8) { Reply $ctx 400 @{ ok = $false; error = 'Неверный список клавиш' }; continue }
      $bad = $keys | Where-Object { $Allow -notcontains $_ }
      if ($bad) { Reply $ctx 400 @{ ok = $false; error = "Комбинация не разрешена: $($bad -join ', ')" }; continue }
      Send-Keys $keys
      Write-Host ("  {0}  нажато: {1}" -f (Get-Date -Format 'HH:mm:ss'), ($keys -join ', '))
      Reply $ctx 200 @{ ok = $true }
    } else {
      Reply $ctx 404 @{ ok = $false; error = 'not found' }
    }
  } catch {
    Write-Host ("  ошибка: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
    try { Reply $ctx 500 @{ ok = $false; error = "$($_.Exception.Message)" } } catch {}
  }
}
