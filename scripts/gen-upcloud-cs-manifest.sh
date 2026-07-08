#!/usr/bin/env bash
# Re-vendor UpCloud Cluster Autoscaler manifests from UpCloudLtd/autoscaler.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/apps/cli/src/platforms/upcloud"
BRANCH="feat/cluster-autoscaler-cloudprovider-upcloud"
BASE="https://raw.githubusercontent.com/UpCloudLtd/autoscaler/${BRANCH}/cluster-autoscaler/cloudprovider/upcloud/examples"

curl -fsSL "${BASE}/rbac.yaml" -o "${DEST}/cluster-autoscaler-rbac.yaml"
curl -fsSL "${BASE}/cluster-autoscaler.yaml" -o "${DEST}/cluster-autoscaler-deployment.yaml"

echo "Updated UpCloud Cluster Autoscaler manifests in ${DEST}"
