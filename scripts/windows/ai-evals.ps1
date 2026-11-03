# Re-runs only the AI evals (local Ollama model), after local-ai.ps1 has set everything up.
# Updates the code first, then scores the four configurations. Log: ai-evals.log
param([string]$Model = "qwen2.5:7b", [string]$EmbedModel = "nomic-embed-text", [string]$Note = "")
$ErrorActionPreference = "Continue"
$root = Resolve-Path (Join-Path $PSScriptRoot $(if (Test-Path (Join-Path $PSScriptRoot "package.json")) { "." } else { "..\.." }))
Set-Location $root
Start-Transcript -Path (Join-Path $root "ai-evals.log") -Force | Out-Null
function Step($m) { Write-Host "`n=== $(Get-Date -Format HH:mm:ss) $m" -ForegroundColor Yellow }
try {
  Step "Update the code"
  git pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw "git pull failed; see above." }
  npm install --no-audit --no-fund
  $ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
  if (-not $ollama) { $ollama = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe" }
  try { Invoke-RestMethod http://localhost:11434/api/version -TimeoutSec 3 | Out-Null }
  catch { Start-Process $ollama -ArgumentList "serve" -WindowStyle Hidden; Start-Sleep 8 }

  $env:DATABASE_URL = "pglite://data/pglite"; $env:USE_AI = "true"; $env:LOCAL_MODEL = $Model
  $env:ANTHROPIC_API_KEY = ""; $env:OPENAI_API_KEY = ""
  $suffix = if ($Note) { "; $Note" } else { "" }
  foreach ($embed in @("", $EmbedModel)) {
    $env:LOCAL_EMBEDDING_MODEL = $embed
    $label = if ($embed) { "$embed retrieval" } else { "offline retrieval" }
    foreach ($col in @("funding", "all")) {
      Step "Eval: $Model answers, $label, $col"
      npx tsx src/cli/eval.ts --generator ollama --collection $col --record "local $Model answers, $label, $col (Windows)$suffix"
      if ($LASTEXITCODE -ne 0) { throw "The eval didn't run; see above." }
    }
  }
  Step "DONE"
} catch { Write-Host "`nFAILED: $_" -ForegroundColor Red } finally { Stop-Transcript | Out-Null }
