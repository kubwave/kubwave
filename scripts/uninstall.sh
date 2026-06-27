#!/usr/bin/env bash
# uninstall.sh — Bootstrap uninstaller for the kubwave CLI.
#
# Resolves an kubwave binary (uses one already on PATH or in
# $KUBWAVE_INSTALL_DIR; otherwise downloads the platform-matching binary
# for the chosen release channel) and runs `kubwave uninstall` with any
# extra arguments forwarded.
#
# Usage:
#   curl -fsSL .../uninstall.sh | bash
#   curl -fsSL .../uninstall.sh | bash -s -- --yes
#   curl -fsSL .../uninstall.sh | bash -s -- --channel preview
#   GITHUB_TOKEN=xxx curl -fsSL .../uninstall.sh | bash
#
# Env vars:
#   KUBWAVE_CHANNEL      stable | preview (default: stable) — only used when downloading
#   KUBWAVE_INSTALL_DIR  default: $HOME/.local/bin
#   KUBWAVE_REMOVE_BIN   1 to delete the binary after a successful uninstall (default: 0)
#   GITHUB_TOKEN             optional GitHub token to raise API rate limits (not required).
set -euo pipefail

REPO="kubwave/kubwave"
BINARY_NAME="kubwave"
INSTALL_DIR="${KUBWAVE_INSTALL_DIR:-${HOME}/.local/bin}"
REMOVE_BIN="${KUBWAVE_REMOVE_BIN:-0}"

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
		--remove-bin)
			REMOVE_BIN=1
			shift
			;;
		--help|-h)
			cat <<EOF
Usage: uninstall.sh [--channel <stable|preview>] [--version <tag>] [--remove-bin] [-- <uninstall args>]

Examples:
  curl -fsSL .../uninstall.sh | bash
  curl -fsSL .../uninstall.sh | bash -s -- --yes
  curl -fsSL .../uninstall.sh | bash -s -- --channel preview --remove-bin

Environment:
  KUBWAVE_CHANNEL      stable | preview (default: stable, only used when downloading)
  KUBWAVE_INSTALL_DIR  install directory (default: \$HOME/.local/bin)
  KUBWAVE_REMOVE_BIN   1 to delete the binary after uninstall (default: 0)
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

# ── Locate or download the binary ───────────────────────────
BIN_PATH=""
if [[ -x "${INSTALL_DIR}/${BINARY_NAME}" ]]; then
	BIN_PATH="${INSTALL_DIR}/${BINARY_NAME}"
elif command -v "${BINARY_NAME}" >/dev/null 2>&1; then
	BIN_PATH="$(command -v "${BINARY_NAME}")"
fi

if [[ -z "$BIN_PATH" ]]; then
	echo "No existing ${BINARY_NAME} binary found — downloading one to run uninstall."

	CHANNEL="${CHANNEL_ARG:-${KUBWAVE_CHANNEL:-stable}}"
	case "$CHANNEL" in
		stable|preview) ;;
		*)
			echo "Error: --channel must be 'stable' or 'preview' (got '$CHANNEL')" >&2
			exit 1
			;;
	esac

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

	GH_AUTH="${GITHUB_TOKEN:-}"

	AUTH_HEADER=()
	if [[ -n "$GH_AUTH" ]]; then
		AUTH_HEADER=(-H "Authorization: Bearer ${GH_AUTH}")
	fi

	auth_hint() {
		echo "Optionally set GITHUB_TOKEN to raise GitHub API rate limits." >&2
	}

	command -v curl >/dev/null 2>&1 || { echo "Error: 'curl' is required." >&2; exit 1; }
	command -v python3 >/dev/null 2>&1 || { echo "Error: python3 is required (used to parse the GitHub API response)." >&2; exit 1; }

	api_get() {
		local url="$1" status body
		body="$(mktemp)"
		status="$(curl -sS -o "$body" -w '%{http_code}' \
			-H "Accept: application/json" \
			-H "User-Agent: kubwave-uninstall.sh" \
			"${AUTH_HEADER[@]}" \
			"$url" || true)"
		if [[ "$status" == "404" ]]; then
			rm -f "$body"
			if [[ "$url" == *"/releases/latest" ]]; then return 2; fi
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

	if [[ -n "$VERSION_ARG" ]]; then
		TAG="$VERSION_ARG"
	elif [[ "$CHANNEL" == "stable" ]]; then
		STABLE_BODY="$(api_get "https://api.github.com/repos/${REPO}/releases/latest")" || STABLE_RC=$?
		if [[ "${STABLE_RC:-0}" == "2" ]]; then
			echo "Error: No stable release published yet. Use '--channel preview' or pin '--version <tag>'." >&2
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
		[[ -n "$TAG" ]] || { echo "Error: Could not parse latest stable release." >&2; exit 1; }
	else
		TAG="$(api_get "https://api.github.com/repos/${REPO}/releases?per_page=20" | python3 -c '
import json, sys
try:
    lst = json.load(sys.stdin)
except json.JSONDecodeError:
    sys.exit(0)
for r in (lst or []):
    if not r.get("draft", False):
        print(r.get("tag_name", ""))
        break
')"
		[[ -n "$TAG" ]] || { echo "Error: No releases found in preview channel." >&2; exit 1; }
	fi

	echo "Channel:  ${CHANNEL}"
	echo "Platform: ${OS}-${ARCH}"
	echo "Tag:      ${TAG}"
	echo "Asset:    ${ASSET}"

	# Read the matching GitHub asset API URL and download it with Accept: application/octet-stream.
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
	[[ -n "$ASSET_URL" ]] || { echo "Error: Release '${TAG}' has no asset named '${ASSET}'." >&2; [[ -z "$GH_AUTH" ]] && auth_hint; exit 1; }

	mkdir -p "${INSTALL_DIR}"
	TMP="$(mktemp)"
	HTTP_CODE="$(curl -sSL -o "${TMP}" -w '%{http_code}' \
		-H "Accept: application/octet-stream" \
		-H "User-Agent: kubwave-uninstall.sh" \
		"${AUTH_HEADER[@]}" \
		"${ASSET_URL}" || true)"
	if [[ ! "$HTTP_CODE" =~ ^2 ]]; then
		rm -f "${TMP}"
		echo "Error: Asset download failed (${HTTP_CODE}) at ${ASSET_URL}" >&2
		exit 1
	fi

	install -m 0755 "${TMP}" "${INSTALL_DIR}/${BINARY_NAME}"
	rm -f "${TMP}"
	BIN_PATH="${INSTALL_DIR}/${BINARY_NAME}"
	echo "Downloaded ${BINARY_NAME} to ${BIN_PATH}"
fi

# ── Hand off to `kubwave uninstall` ─────────────────────
# Reattach stdin to the controlling terminal so interactive confirmations work
# under `curl ... | bash`.
if [[ -t 0 ]]; then
	STDIN_REDIRECT=""
elif [[ -r /dev/tty ]]; then
	STDIN_REDIRECT="/dev/tty"
else
	STDIN_REDIRECT=""
fi

if [[ ${#PASSTHROUGH[@]} -gt 0 ]]; then
	echo "Running: ${BIN_PATH} uninstall ${PASSTHROUGH[*]}"
	if [[ -n "$STDIN_REDIRECT" ]]; then
		<"$STDIN_REDIRECT" "${BIN_PATH}" uninstall "${PASSTHROUGH[@]}"
	else
		"${BIN_PATH}" uninstall "${PASSTHROUGH[@]}"
	fi
else
	echo "Running: ${BIN_PATH} uninstall"
	if [[ -n "$STDIN_REDIRECT" ]]; then
		<"$STDIN_REDIRECT" "${BIN_PATH}" uninstall
	else
		"${BIN_PATH}" uninstall
	fi
fi

if [[ "$REMOVE_BIN" == "1" ]]; then
	if [[ -f "$BIN_PATH" ]]; then
		rm -f "$BIN_PATH"
		echo "Removed ${BIN_PATH}"
	fi
fi
