# Oracle of the Third Eye — one-step Windows setup & launch.
# Installs Node.js if needed, installs packages, asks for your keys once, starts the Oracle.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Say($text, $color = 'Green') { Write-Host "  $text" -ForegroundColor $color }
Write-Host ''
Write-Host '   ORACLE  of the Third Eye' -ForegroundColor Yellow
Write-Host ''

# 1. Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Say 'Node.js not found - installing it with winget (you may see a Windows prompt)...' 'Yellow'
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Say 'Node.js was installed but this window cannot see it yet. Close this window and double-click Start-Oracle.bat again.' 'Red'
    exit 1
  }
}
Say "Node.js $(node --version) ready"

# 2. Packages
if (-not (Test-Path 'node_modules')) {
  Say 'Installing packages (first run only, about a minute)...'
  npm install --no-audit --no-fund
}

# 3. Keys (asked once, saved to .env)
if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Say 'First run: let''s connect the Oracle''s mind and voice. Press Enter to skip any.' 'Cyan'
  $claude = Read-Host '  Anthropic API key (console.anthropic.com)'
  $eleven = Read-Host '  ElevenLabs API key (optional)'
  $db     = Read-Host '  Supabase DATABASE_URL (optional - shares memory with your phone)'
  $env_ = Get-Content '.env'
  if ($claude) { $env_ = $env_ -replace '^ANTHROPIC_API_KEY=.*', "ANTHROPIC_API_KEY=$claude" }
  if ($eleven) { $env_ = $env_ -replace '^ELEVENLABS_API_KEY=.*', "ELEVENLABS_API_KEY=$eleven" }
  if ($db)     { $env_ = $env_ -replace '^# DATABASE_URL=.*', "DATABASE_URL=$db" }
  $env_ | Set-Content '.env' -Encoding UTF8
  Say 'Saved to .env (edit it any time with Notepad).'
}

# 4. Launch
Say 'Waking the Oracle... your browser will open in a moment. Keep this window open.'
Start-Job { Start-Sleep 4; Start-Process 'http://localhost:3333' } | Out-Null
npm start
