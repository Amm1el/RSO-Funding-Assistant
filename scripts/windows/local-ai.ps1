# Sets up free local AI (Ollama) on Windows and scores it with the eval suite.
# Run with scripts/windows/local-ai.bat (or: powershell -ExecutionPolicy Bypass -File scripts\windows\local-ai.ps1)
# Everything is logged to local-ai.log in the project folder.
#   1. updates the code (git pull), installs packages
#   2. installs Ollama with winget if it's missing, downloads the models
#   3. pulls the latest crawl and indexes it twice: offline embeddings and local (nomic) embeddings
#   4. runs the evals: offline retrieval + local answers, then local retrieval + local answers
#   5. sets .env so the app uses local AI (set USE_AI=false to switch back)
param([string]$Model = "qwen2.5:7b", [string]$EmbedModel = "nomic-embed-text")
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot $(if (Test-Path (Join-Path $PSScriptRoot "package.json")) { "." } else { "..\.." }))
Set-Location $root
Start-Transcript -Path (Join-Path $root "local-ai.log") -Force | Out-Null
function Step($m) { Write-Host "`n=== $(Get-Date -Format HH:mm:ss) $m" -ForegroundColor Yellow }

try {
  Step "This computer"
  "RAM GB: " + [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
  "GPU: " + ((Get-CimInstance Win32_VideoController).Name -join ", ")
  "Free disk on C: GB: " + [math]::Round((Get-PSDrive C).Free / 1GB, 1)

  Step "Update the code"
  if (Get-Command git -ErrorAction SilentlyContinue) {
    git stash push -m "before local-ai update" -- package-lock.json 2>$null
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw "git pull failed; see above." }
    git log --oneline -1
  } else { Write-Host "git isn't installed; using the code as it is." }
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install failed." }

  Step "Install Ollama"
  $ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
  if (-not $ollama) { $ollama = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe" }
  if (-not (Test-Path $ollama)) {
    winget install --id Ollama.Ollama -e --accept-package-agreements --accept-source-agreements
    if (-not (Test-Path $ollama)) { throw "Ollama didn't install. Install it from https://ollama.com/download and run this again." }
  }
  & $ollama --version
  try { Invoke-RestMethod http://localhost:11434/api/version -TimeoutSec 3 | Out-Null }
  catch { Start-Process $ollama -ArgumentList "serve" -WindowStyle Hidden; Start-Sleep 5 }

  Step "Download the models ($Model, $EmbedModel)"
  & $ollama pull $Model; if ($LASTEXITCODE -ne 0) { throw "Couldn't download $Model." }
  & $ollama pull $EmbedModel; if ($LASTEXITCODE -ne 0) { throw "Couldn't download $EmbedModel." }

  Step "Latest crawl"
  npm run corpus:pull

  $env:DATABASE_URL = "pglite://data/pglite"
  $env:USE_AI = "true"
  $env:LOCAL_MODEL = $Model
  $env:ANTHROPIC_API_KEY = ""
  $env:OPENAI_API_KEY = ""

  Step "Index with offline embeddings"
  $env:LOCAL_EMBEDDING_MODEL = ""
  npx tsx src/cli/ingest-corpus.ts --offline
  if ($LASTEXITCODE -ne 0) { throw "Offline indexing failed." }

  Step "Eval: offline retrieval + $Model answers"
  npx tsx src/cli/eval.ts --generator ollama --collection funding --record "local $Model answers, offline retrieval (Windows)"
  npx tsx src/cli/eval.ts --generator ollama --collection all --record "local $Model answers, offline retrieval, all sources (Windows)"

  Step "Index with $EmbedModel embeddings (the slow part)"
  $env:LOCAL_EMBEDDING_MODEL = $EmbedModel
  npx tsx src/cli/ingest-corpus.ts
  if ($LASTEXITCODE -ne 0) { throw "Local-embedding indexing failed." }

  Step "Eval: $EmbedModel retrieval + $Model answers"
  npx tsx src/cli/eval.ts --generator ollama --collection funding --record "local $Model answers, $EmbedModel retrieval (Windows)"
  npx tsx src/cli/eval.ts --generator ollama --collection all --record "local $Model answers, $EmbedModel retrieval, all sources (Windows)"

  Step "Use local AI by default (.env)"
  $envFile = Join-Path $root ".env"
  if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $root ".env.example") $envFile }
  $lines = Get-Content $envFile | Where-Object { $_ -notmatch '^(USE_AI|LOCAL_MODEL|LOCAL_EMBEDDING_MODEL|DATABASE_URL)=' }
  $lines + @("USE_AI=true", "LOCAL_MODEL=$Model", "LOCAL_EMBEDDING_MODEL=$EmbedModel", "DATABASE_URL=pglite://data/pglite") | Set-Content $envFile
  Step "DONE. Start the app with start-windows.bat. To go back to no-AI mode, set USE_AI=false in .env."
} catch {
  Write-Host "`nFAILED: $_" -ForegroundColor Red
} finally {
  Stop-Transcript | Out-Null
}
