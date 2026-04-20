#!/usr/bin/env bash
# Create all four KV namespaces (OAUTH_KV + CACHE_KV for staging and production)
# and print the wrangler.toml blocks to paste in.
#
# Safe to re-run: if a namespace with the same title already exists, wrangler
# will return the existing id rather than creating a duplicate.
#
# Usage:  bash scripts/bootstrap-kv.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

run() {
  # Capture wrangler output, echo to stderr so the user sees progress,
  # extract the id on stdout.
  local env_flag="$1" binding="$2"
  local label="${binding}${env_flag:+ ($env_flag)}"
  echo "→ creating ${label}..." >&2

  local out
  if [[ -n "$env_flag" ]]; then
    out="$(npx wrangler kv namespace create "$binding" --env "$env_flag")"
  else
    out="$(npx wrangler kv namespace create "$binding")"
  fi
  echo "$out" >&2

  # wrangler prints: { binding = "OAUTH_KV", id = "abc123..." }
  local id
  id="$(echo "$out" | grep -oE 'id = "[a-f0-9]+"' | head -1 | sed -E 's/id = "([a-f0-9]+)"/\1/')"
  if [[ -z "$id" ]]; then
    echo "!! could not parse id from wrangler output for ${label}" >&2
    exit 1
  fi
  echo "$id"
}

OAUTH_DEV=$(run ""           "OAUTH_KV")
CACHE_DEV=$(run ""           "CACHE_KV")
OAUTH_STG=$(run "staging"    "OAUTH_KV")
CACHE_STG=$(run "staging"    "CACHE_KV")
OAUTH_PRD=$(run "production" "OAUTH_KV")
CACHE_PRD=$(run "production" "CACHE_KV")

cat <<EOF

=================================================================
Paste these into wrangler.toml (replacing the REPLACE_ME_* values):
=================================================================

[top-level]
kv_namespaces = [
  { binding = "OAUTH_KV", id = "${OAUTH_DEV}" },
  { binding = "CACHE_KV", id = "${CACHE_DEV}" },
]

[env.staging]
kv_namespaces = [
  { binding = "OAUTH_KV", id = "${OAUTH_STG}" },
  { binding = "CACHE_KV", id = "${CACHE_STG}" },
]

[env.production]
kv_namespaces = [
  { binding = "OAUTH_KV", id = "${OAUTH_PRD}" },
  { binding = "CACHE_KV", id = "${CACHE_PRD}" },
]

EOF
