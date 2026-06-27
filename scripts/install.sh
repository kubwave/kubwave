#!/usr/bin/env bash
# install.sh — Bootstrap installer for the kubwave CLI.
#
# Downloads the platform-matching CLI binary for the chosen release channel
# (default: stable) and runs `kubwave install` with any extra arguments.
#
# Usage:
#   curl -fsSL .../install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- --channel preview
#   curl -fsSL .../install.sh | bash -s -- --version 0.1.0-alpha.3 --domain ex.com
#   GITHUB_TOKEN=xxx curl -fsSL .../install.sh | bash -s -- --channel preview
#
# Env vars:
#   KUBWAVE_CHANNEL    stable | preview (default: stable)
#   KUBWAVE_INSTALL_DIR  default: $HOME/.local/bin
#   GITHUB_TOKEN             optional GitHub token to raise API rate limits (not required).
set -euo pipefail

REPO="kubwave/kubwave"
BINARY_NAME="kubwave"
INSTALL_DIR="${KUBWAVE_INSTALL_DIR:-${HOME}/.local/bin}"

CHANNEL_ARG=""
VERSION_ARG=""
PASSTHROUGH=()

# ── Argument parsing ────────────────────────────────────────
while [[ $# -gt 0 ]]; do
	case "$1" in
		--channel)
			CHANNEL_ARG="${2:-}"
			shift 2 || { echo "Error: --channel requires a value" >&2; exit 1; }
			;;
		--channel=*)
			CHANNEL_ARG="${1#--channel=}"
			shift
			;;
		--version)
			VERSION_ARG="${2:-}"
			shift 2 || { echo "Error: --version requires a value" >&2; exit 1; }
			;;
		--version=*)
			VERSION_ARG="${1#--version=}"
			shift
			;;
		--help|-h)
			cat <<EOF
Usage: install.sh [--channel <stable|preview>] [--version <X.Y.Z[-...]>] [-- <install args>]

Examples:
  curl -fsSL .../install.sh | bash
  curl -fsSL .../install.sh | bash -s -- --channel preview --domain ex.com
  curl -fsSL .../install.sh | bash -s -- --version 0.1.0-alpha.3

Environment:
  KUBWAVE_CHANNEL      stable | preview (default: stable)
  KUBWAVE_INSTALL_DIR  install directory (default: \$HOME/.local/bin)
  GITHUB_TOKEN         optional token to raise GitHub API rate limits (not required)
EOF
			exit 0
			;;
		--)
			shift
			PASSTHROUGH+=("$@")
			break
			;;
		*)
			PASSTHROUGH+=("$1")
			shift
			;;
	esac
done

CHANNEL="${CHANNEL_ARG:-${KUBWAVE_CHANNEL:-stable}}"
case "$CHANNEL" in
	stable|preview) ;;
	*)
		echo "Error: --channel must be 'stable' or 'preview' (got '$CHANNEL')" >&2
		exit 1
		;;
esac

# ── Detect platform ──────────────────────────────────────────
detect_os() {
	case "$(uname -s)" in
		Linux) echo "linux" ;;
		Darwin) echo "darwin" ;;
		*) echo "Error: Unsupported operating system: $(uname -s)" >&2; exit 1 ;;
	esac
}

detect_arch() {
	case "$(uname -m)" in
		x86_64) echo "x64" ;;
		aarch64|arm64) echo "arm64" ;;
		*) echo "Error: Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
	esac
}

OS="$(detect_os)"
ARCH="$(detect_arch)"
ASSET="${BINARY_NAME}-${OS}-${ARCH}"

# ── Resolve auth token ──────────────────────────────────────
GH_AUTH="${GITHUB_TOKEN:-}"

AUTH_HEADER=()
if [[ -n "$GH_AUTH" ]]; then
	AUTH_HEADER=(-H "Authorization: Bearer ${GH_AUTH}")
fi

auth_hint() {
	echo "Optionally set GITHUB_TOKEN to raise GitHub API rate limits." >&2
}

# ── Tool selection ──────────────────────────────────────────
if ! command -v curl >/dev/null 2>&1; then
	echo "Error: 'curl' is required." >&2
	exit 1
fi

# ── Resolve release tag ─────────────────────────────────────
api_get() {
	local url="$1"
	local status
	local body
	body="$(mktemp)"
	status="$(curl -sS -o "$body" -w '%{http_code}' \
		-H "Accept: application/json" \
		-H "User-Agent: kubwave-install.sh" \
		"${AUTH_HEADER[@]}" \
		"$url" || true)"
	if [[ "$status" == "404" ]]; then
		rm -f "$body"
		# `/releases/latest` returns 404 when there are no non-prerelease releases yet —
		# treat that as a callable signal so the stable-channel branch can emit a clearer hint.
		if [[ "$url" == *"/releases/latest" ]]; then
			return 2
		fi
		if [[ -z "$GH_AUTH" ]]; then
			echo "Error: GitHub API 404 for $url — repository is private." >&2
			auth_hint
		else
			echo "Error: GitHub API 404 for $url. Token may lack scopes." >&2
		fi
		exit 1
	fi
	if [[ "$status" =~ ^(401|403)$ ]]; then
		rm -f "$body"
		echo "Error: GitHub API ${status} for $url. Token rejected or insufficient scopes." >&2
		auth_hint
		exit 1
	fi
	if [[ ! "$status" =~ ^2 ]]; then
		echo "Error: GitHub API ${status} for $url:" >&2
		cat "$body" >&2 || true
		rm -f "$body"
		exit 1
	fi
	cat "$body"
	rm -f "$body"
}

if ! command -v python3 >/dev/null 2>&1; then
	echo "Error: python3 is required (used to parse the GitHub API response)." >&2
	exit 1
fi

if [[ -n "$VERSION_ARG" ]]; then
	TAG="$VERSION_ARG"
elif [[ "$CHANNEL" == "stable" ]]; then
	# api_get returns 2 specifically when /releases/latest is 404 (i.e. no non-prerelease yet).
	STABLE_BODY="$(api_get "https://api.github.com/repos/${REPO}/releases/latest")" || STABLE_RC=$?
	if [[ "${STABLE_RC:-0}" == "2" ]]; then
		echo "Error: No stable release published yet. Use '--channel preview' or pin a specific '--version <tag>'." >&2
		exit 1
	fi
	TAG="$(printf '%s' "$STABLE_BODY" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get("tag_name", ""))
except json.JSONDecodeError:
    pass
')"
	if [[ -z "$TAG" ]]; then
		echo "Error: Could not parse latest stable release. Try '--channel preview' or pin '--version <tag>'." >&2
		exit 1
	fi
else
	# preview: take latest non-draft release. The /releases endpoint's default order is not
	# reliably published_at desc, so sort client-side to be safe.
	TAG="$(api_get "https://api.github.com/repos/${REPO}/releases?per_page=50" | python3 -c '
import json, sys
try:
    lst = json.load(sys.stdin)
except json.JSONDecodeError:
    sys.exit(0)
candidates = [r for r in (lst or []) if not r.get("draft", False) and r.get("published_at")]
candidates.sort(key=lambda r: r["published_at"], reverse=True)
if candidates:
    print(candidates[0].get("tag_name", ""))
')"
	if [[ -z "$TAG" ]]; then
		echo "Error: No releases found in preview channel." >&2
		exit 1
	fi
fi

echo "Channel:  ${CHANNEL}"
echo "Platform: ${OS}-${ARCH}"
echo "Tag:      ${TAG}"
echo "Asset:    ${ASSET}"

# ── Download binary ─────────────────────────────────────────
# Read the matching GitHub asset API URL from `/releases/tags/<tag>` and download it with
# `Accept: application/octet-stream`. GITHUB_TOKEN is optional and only raises API rate limits.
if ! command -v python3 >/dev/null 2>&1; then
	echo "Error: python3 is required to look up the release asset (used for JSON parsing)." >&2
	exit 1
fi

TAG_API_URL="https://api.github.com/repos/${REPO}/releases/tags/${TAG}"
ASSET_URL="$(api_get "${TAG_API_URL}" | ASSET_NAME="${ASSET}" python3 -c '
import json, os, sys
try:
    data = json.load(sys.stdin)
except json.JSONDecodeError:
    sys.exit(0)
target = os.environ.get("ASSET_NAME", "")
for a in data.get("assets", []) or []:
    if a.get("name") == target:
        print(a.get("url", ""))
        break
')"

if [[ -z "$ASSET_URL" ]]; then
	echo "Error: Release '${TAG}' has no asset named '${ASSET}'." >&2
	if [[ -z "$GH_AUTH" ]]; then auth_hint; fi
	exit 1
fi

mkdir -p "${INSTALL_DIR}"
TMP="$(mktemp)"
HTTP_CODE="$(curl -sSL -o "${TMP}" -w '%{http_code}' \
	-H "Accept: application/octet-stream" \
	-H "User-Agent: kubwave-install.sh" \
	"${AUTH_HEADER[@]}" \
	"${ASSET_URL}" || true)"

if [[ "$HTTP_CODE" == "404" ]]; then
	rm -f "${TMP}"
	echo "Error: Asset not found at ${ASSET_URL} (404)." >&2
	if [[ -z "$GH_AUTH" ]]; then
		auth_hint
	else
		echo "Make sure release '${TAG}' has an asset named '${ASSET}'." >&2
	fi
	exit 1
fi
if [[ ! "$HTTP_CODE" =~ ^2 ]]; then
	rm -f "${TMP}"
	echo "Error: Asset download failed (${HTTP_CODE}) at ${ASSET_URL}" >&2
	exit 1
fi

install -m 0755 "${TMP}" "${INSTALL_DIR}/${BINARY_NAME}"
rm -f "${TMP}"
echo "Installed ${BINARY_NAME} to ${INSTALL_DIR}/${BINARY_NAME}"

export PATH="${INSTALL_DIR}:${PATH}"

# ── Sanity check ────────────────────────────────────────────
if ! "${INSTALL_DIR}/${BINARY_NAME}" --version >/dev/null 2>&1; then
	echo "Error: Downloaded binary failed to execute. Your platform may not be supported." >&2
	exit 1
fi

# ── Hand off to `kubwave install` ───────────────────────
# When invoked via `curl ... | bash`, stdin is the (already-closed) curl pipe — that would
# make interactive prompts (@clack/prompts) see EOF and immediately cancel. Reattach stdin
# to the controlling terminal if one exists; in non-TTY contexts (CI), leave stdin alone.
if [[ -t 0 ]]; then
	STDIN_REDIRECT=""
elif [[ -r /dev/tty ]]; then
	STDIN_REDIRECT="/dev/tty"
else
	STDIN_REDIRECT=""
fi

if [[ ${#PASSTHROUGH[@]} -gt 0 ]]; then
	echo "Running: ${BINARY_NAME} install --channel ${CHANNEL} ${PASSTHROUGH[*]}"
	if [[ -n "$STDIN_REDIRECT" ]]; then
		exec <"$STDIN_REDIRECT" "${INSTALL_DIR}/${BINARY_NAME}" install --channel "${CHANNEL}" "${PASSTHROUGH[@]}"
	else
		exec "${INSTALL_DIR}/${BINARY_NAME}" install --channel "${CHANNEL}" "${PASSTHROUGH[@]}"
	fi
else
	echo "Running: ${BINARY_NAME} install --channel ${CHANNEL}"
	if [[ -n "$STDIN_REDIRECT" ]]; then
		exec <"$STDIN_REDIRECT" "${INSTALL_DIR}/${BINARY_NAME}" install --channel "${CHANNEL}"
	else
		exec "${INSTALL_DIR}/${BINARY_NAME}" install --channel "${CHANNEL}"
	fi
fi
