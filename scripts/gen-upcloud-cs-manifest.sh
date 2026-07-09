#!/usr/bin/env bash
# Re-vendor UpCloud Cluster Autoscaler manifests from UpCloudLtd/autoscaler.
# REF is an immutable commit SHA, not a tag: no released tag carries the upcloud cloudprovider examples.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/apps/cli/src/platforms/upcloud"
REF="eaf81b7a276965e8705496a1f43f27d259cbe787"
BASE="https://raw.githubusercontent.com/UpCloudLtd/autoscaler/${REF}/cluster-autoscaler/cloudprovider/upcloud/examples"

RBAC_SHA256="bc2476c27e2e02e02e483ff08231f5d4694f013ceffefe27c1fd23b37d60fa5f"
DEPLOYMENT_SHA256="1add76d334c5c18c920eb9995a86014ed2b9201a6ab711a661bd571c5528a899"

fetch() {
	local url="$1" out="$2" want="$3"
	curl -fsSL "$url" -o "$out"
	local got
	got="$(shasum -a 256 "$out" | cut -d' ' -f1)"
	if [[ "$got" != "$want" ]]; then
		echo "Checksum mismatch for $url" >&2
		echo "  expected $want" >&2
		echo "  got      $got" >&2
		echo "Upstream content changed — review it, then update REF and the *_SHA256 pins." >&2
		rm -f "$out"
		exit 1
	fi
}

fetch "${BASE}/rbac.yaml" "${DEST}/cluster-autoscaler-rbac.yaml" "$RBAC_SHA256"
fetch "${BASE}/cluster-autoscaler.yaml" "${DEST}/cluster-autoscaler-deployment.yaml" "$DEPLOYMENT_SHA256"

echo "Updated UpCloud Cluster Autoscaler manifests in ${DEST} (ref ${REF})"
echo "Re-apply the kubwave placeholders (\${UPCLOUD_CLUSTER_ID}, \${UPCLOUD_AUTOSCALER_IMAGE_TAG}, nodes-flags) and run prettier."
