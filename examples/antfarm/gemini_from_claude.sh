#!/usr/bin/env bash
# gemini_from_claude.sh
# Non-interactive Gemini wrapper for Claude/Codex-style automation scripts.
# Uses direct Gemini API calls with hard timeout + retries to avoid stuck loops.

set -euo pipefail

MODEL="${GEMINI_MODEL:-gemini-3.1-pro}"
TIMEOUT_SEC="${GEMINI_TIMEOUT_SEC:-45}"
CONNECT_TIMEOUT_SEC="${GEMINI_CONNECT_TIMEOUT_SEC:-10}"
MAX_RETRIES="${GEMINI_RETRIES:-2}"
RETRY_BASE_SEC="${GEMINI_RETRY_BASE_SEC:-2}"
MAX_OUTPUT_TOKENS="${GEMINI_MAX_OUTPUT_TOKENS:-2048}"
PROMPT=""
FALLBACK_MODEL="${GEMINI_FALLBACK_MODEL:-}"
GEMINI_BIN="${GEMINI_BIN:-/opt/homebrew/bin/gemini}"

usage() {
  cat <<'EOF'
Usage: gemini_from_claude.sh [options] [prompt words...]

Options:
  -m, --model <model>       Gemini model (default: GEMINI_MODEL or gemini-3.1-pro)
  -t, --timeout <seconds>   Hard timeout in seconds (default: GEMINI_TIMEOUT_SEC or 45)
  -r, --retries <count>     Retry count for retryable failures (default: GEMINI_RETRIES or 2)
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
    -r|--retries)
      MAX_RETRIES="${2:-}"
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

if [[ ! "$CONNECT_TIMEOUT_SEC" =~ ^[0-9]+$ ]] || [[ "$CONNECT_TIMEOUT_SEC" -lt 1 ]]; then
  echo "Invalid connect timeout: $CONNECT_TIMEOUT_SEC" >&2
  exit 2
fi

if [[ ! "$MAX_RETRIES" =~ ^[0-9]+$ ]] || [[ "$MAX_RETRIES" -lt 0 ]]; then
  echo "Invalid retries: $MAX_RETRIES" >&2
  exit 2
fi

if [[ "${GEMINI_SKIP_CREDENTIAL_CHECK:-0}" != "1" ]]; then
  if [[ -z "${GEMINI_API_KEY:-}" && -z "${GOOGLE_API_KEY:-}" && "${GOOGLE_GENAI_USE_VERTEXAI:-}" != "true" ]]; then
    echo "Missing Gemini credentials. Set GEMINI_API_KEY (or GOOGLE_API_KEY / Vertex AI env)." >&2
    exit 2
  fi
fi

python3 - "$MODEL" "$PROMPT" "$TIMEOUT_SEC" "$CONNECT_TIMEOUT_SEC" "$MAX_RETRIES" "$RETRY_BASE_SEC" "$MAX_OUTPUT_TOKENS" "$FALLBACK_MODEL" <<'PY'
import json
import os
import sys
import time
import uuid
import urllib.parse
import urllib.request
import urllib.error
import socket

model = sys.argv[1]
prompt = sys.argv[2]
timeout_s = int(sys.argv[3])
connect_timeout_s = int(sys.argv[4])
retries = int(sys.argv[5])
retry_base = int(sys.argv[6])
max_output_tokens = int(sys.argv[7])
fallback_model = sys.argv[8]

api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
use_vertex = (os.environ.get("GOOGLE_GENAI_USE_VERTEXAI") == "true")

if use_vertex:
    print("Vertex AI mode is not supported by this wrapper yet. Use GEMINI_API_KEY or GOOGLE_API_KEY.", file=sys.stderr)
    sys.exit(2)
if not api_key:
    print("Missing Gemini API key.", file=sys.stderr)
    sys.exit(2)

def call_model(selected_model: str):
    safe_model = urllib.parse.quote(selected_model, safe="")
    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{safe_model}:generateContent?key={api_key}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "topP": 0.95,
            "maxOutputTokens": max_output_tokens,
        },
    }
    data = json.dumps(payload).encode("utf-8")

    last_err = ""
    retryable_http = {408, 409, 425, 429, 500, 502, 503, 504}

    for attempt in range(1, retries + 2):
        req_id = uuid.uuid4().hex[:12]
        started = time.time()
        req = urllib.request.Request(
            api_url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        status = 0
        body = b""
        err_msg = ""
        try:
            with urllib.request.urlopen(req, timeout=max(timeout_s, connect_timeout_s)) as resp:
                status = getattr(resp, "status", 200)
                body = resp.read()
        except urllib.error.HTTPError as e:
            status = e.code or 0
            body = e.read() or b""
            err_msg = f"http_error:{status}"
        except (urllib.error.URLError, socket.timeout, TimeoutError) as e:
            status = 0
            err_msg = f"network_error:{e}"
        except Exception as e:
            status = 0
            err_msg = f"request_error:{e}"

        elapsed = time.time() - started

        parsed = {}
        text = ""
        api_err = ""
        if body:
            try:
                parsed = json.loads(body.decode("utf-8", errors="replace"))
                text = ((parsed.get("candidates") or [{}])[0].get("content", {}).get("parts", [{}])[0].get("text") or "").strip()
                api_err = (parsed.get("error", {}) or {}).get("message", "")
            except Exception:
                api_err = "invalid_json_response"

        if status == 200 and text:
            print(f"[gemini-wrapper] req={req_id} model={selected_model} attempt={attempt} status=200 elapsed={elapsed:.2f}s", file=sys.stderr)
            return text, 0

        if not api_err and err_msg:
            api_err = err_msg
        if not api_err:
            api_err = f"http_{status}" if status else "unknown_error"

        print(f"[gemini-wrapper] req={req_id} model={selected_model} attempt={attempt} status={status} elapsed={elapsed:.2f}s err={api_err}", file=sys.stderr)
        last_err = api_err

        if attempt <= retries and (status in retryable_http or status == 0):
            time.sleep(max(1, retry_base * attempt))
            continue
        return "", status or 1

    return "", 1

out, code = call_model(model)
if out:
    print(out)
    sys.exit(0)

if fallback_model and fallback_model != model:
    out, code = call_model(fallback_model)
    if out:
        print(out)
        sys.exit(0)
    print(f"Gemini failed after fallback model {fallback_model}.", file=sys.stderr)
    sys.exit(code if code else 1)

print("Gemini request failed.", file=sys.stderr)
sys.exit(code if code else 1)
PY
