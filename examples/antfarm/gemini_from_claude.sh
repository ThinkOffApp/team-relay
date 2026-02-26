#!/usr/bin/env bash
# gemini_from_claude.sh
# Non-interactive Gemini wrapper for Claude/Codex-style automation scripts.
# Enforces a hard timeout so polling bots do not hang indefinitely.

set -euo pipefail

MODEL="${GEMINI_MODEL:-gemini-3.1-pro}"
TIMEOUT_SEC="${GEMINI_TIMEOUT_SEC:-45}"
PROMPT=""
FALLBACK_MODEL="${GEMINI_FALLBACK_MODEL:-}"
GEMINI_BIN="${GEMINI_BIN:-/opt/homebrew/bin/gemini}"

usage() {
  cat <<'EOF'
Usage: gemini_from_claude.sh [options] [prompt words...]

Options:
  -m, --model <model>       Gemini model (default: GEMINI_MODEL or gemini-3.1-pro)
  -t, --timeout <seconds>   Hard timeout in seconds (default: GEMINI_TIMEOUT_SEC or 45)
  -p, --prompt <text>       Prompt text. If omitted, stdin is used.
  --fallback-model <model>  Optional fallback model if primary returns non-zero.
  -h, --help                Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--model)
      MODEL="${2:-}"
      shift 2
      ;;
    -t|--timeout)
      TIMEOUT_SEC="${2:-}"
      shift 2
      ;;
    -p|--prompt)
      PROMPT="${2:-}"
      shift 2
      ;;
    --fallback-model)
      FALLBACK_MODEL="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      PROMPT="$*"
      break
      ;;
    *)
      if [[ -z "$PROMPT" ]]; then
        PROMPT="$1"
      else
        PROMPT="$PROMPT $1"
      fi
      shift
      ;;
  esac
done

if [[ -z "$PROMPT" ]]; then
  if [[ ! -t 0 ]]; then
    PROMPT="$(cat)"
  fi
fi

if [[ -z "$PROMPT" ]]; then
  echo "No prompt provided." >&2
  exit 2
fi

if [[ ! "$TIMEOUT_SEC" =~ ^[0-9]+$ ]] || [[ "$TIMEOUT_SEC" -lt 1 ]]; then
  echo "Invalid timeout: $TIMEOUT_SEC" >&2
  exit 2
fi

if [[ ! -x "$GEMINI_BIN" ]]; then
  if command -v gemini >/dev/null 2>&1; then
    GEMINI_BIN="$(command -v gemini)"
  else
    echo "Gemini CLI not found." >&2
    exit 127
  fi
fi

if [[ "${GEMINI_SKIP_CREDENTIAL_CHECK:-0}" != "1" ]]; then
  if [[ -z "${GEMINI_API_KEY:-}" && -z "${GOOGLE_API_KEY:-}" && "${GOOGLE_GENAI_USE_VERTEXAI:-}" != "true" ]]; then
    echo "Missing Gemini credentials. Set GEMINI_API_KEY (or GOOGLE_API_KEY / Vertex AI env)." >&2
    exit 2
  fi
fi

python3 - "$TIMEOUT_SEC" "$GEMINI_BIN" "$MODEL" "$PROMPT" "$FALLBACK_MODEL" <<'PY'
import subprocess
import sys

timeout_s = int(sys.argv[1])
gemini_bin = sys.argv[2]
model = sys.argv[3]
prompt = sys.argv[4]
fallback_model = sys.argv[5]

def run_once(selected_model: str):
    cmd = [gemini_bin, "-y", "-m", selected_model, "-p", prompt, "-o", "text"]
    return subprocess.run(
        cmd,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=timeout_s,
    )

try:
    cp = run_once(model)
except subprocess.TimeoutExpired:
    print(f"Gemini timed out after {timeout_s}s (model={model}).", file=sys.stderr)
    sys.exit(124)
except Exception as exc:
    print(f"Gemini launch failed: {exc}", file=sys.stderr)
    sys.exit(1)

if cp.returncode != 0 and fallback_model and fallback_model != model:
    try:
        cp = run_once(fallback_model)
    except subprocess.TimeoutExpired:
        print(f"Gemini timed out after {timeout_s}s (fallback model={fallback_model}).", file=sys.stderr)
        sys.exit(124)
    except Exception as exc:
        print(f"Gemini fallback launch failed: {exc}", file=sys.stderr)
        sys.exit(1)

if cp.returncode != 0:
    err = (cp.stderr or "").strip()
    if err:
        print(err, file=sys.stderr)
    else:
        print(f"Gemini failed with exit code {cp.returncode}.", file=sys.stderr)
    sys.exit(cp.returncode)

out = (cp.stdout or "").strip()
if not out:
    sys.exit(3)

print(out)
PY
