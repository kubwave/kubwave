#!/usr/bin/env bash
# Dev entrypoint: tear down any running cluster, recreate it fresh, hand off to Tilt.
set -euo pipefail

CLUSTER="kubwave"
NAMESPACE="kubwave"
POSTGRES_SECRET="postgres-creds"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Usage:
  scripts/dev.sh         Recreate the dev cluster and start Tilt
  scripts/dev.sh reset   Delete rows from the dev database, keeping tables/migrations
EOF
}

# Load a local, gitignored .env from the project root so values like GITHUB_TOKEN are
# exported into the environment Tilt inherits. Tilt reads os.getenv() when it launches, so
# the var must exist BEFORE `tilt up` (the exec at the end of this script). `set -a` auto-
# exports every assignment; the file is sourced as shell, so use plain KEY=value lines.
if [ -f "$ROOT/.env" ]; then
  echo "↑ Loading .env from project root"
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "✗ missing required tool: $1" >&2
    exit 1
  }
}

secret_value() {
  local key="$1"
  kubectl -n "$NAMESPACE" get secret "$POSTGRES_SECRET" -o "go-template={{ index .data \"$key\" | base64decode }}"
}

postgres_target() {
  local pod

  pod="$(kubectl -n "$NAMESPACE" get pod -l cnpg.io/cluster=postgres,role=primary -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [ -n "$pod" ]; then
    printf '%s %s' "$pod" "postgres-rw"
    return
  fi

  pod="$(kubectl -n "$NAMESPACE" get pod -l cnpg.io/cluster=postgres -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [ -n "$pod" ]; then
    printf '%s %s' "$pod" "postgres-rw"
    return
  fi

  pod="$(kubectl -n "$NAMESPACE" get pod -l app.kubernetes.io/name=postgres -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [ -n "$pod" ]; then
    printf '%s %s' "$pod" "postgres"
  fi
}

reset_database() {
  require kubectl

  if ! kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
    echo "✗ namespace '$NAMESPACE' not found. Start the dev stack first with scripts/dev.sh." >&2
    exit 1
  fi

  if ! kubectl -n "$NAMESPACE" get secret "$POSTGRES_SECRET" >/dev/null 2>&1; then
    echo "✗ secret '$POSTGRES_SECRET' not found in namespace '$NAMESPACE'." >&2
    exit 1
  fi

  echo "↑ Waiting for Postgres pod to be Ready..."
  kubectl -n "$NAMESPACE" wait --for=condition=Ready pod -l cnpg.io/cluster=postgres --timeout=60s >/dev/null 2>&1 || true

  local target pod db_host
  target="$(postgres_target)"
  if [ -z "$target" ]; then
    echo "✗ no Postgres pod found in namespace '$NAMESPACE'." >&2
    exit 1
  fi
  pod="${target%% *}"
  db_host="${target##* }"

  local user password database reset_sql
  user="$(secret_value POSTGRES_USER)"
  password="$(secret_value POSTGRES_PASSWORD)"
  database="$(secret_value POSTGRES_DB)"

  reset_sql="$(
    cat <<'SQL'
DO $$
DECLARE
  tables text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
    INTO tables
    FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename <> '__drizzle_migrations';

  IF tables IS NULL THEN
    RAISE NOTICE 'No public tables to truncate.';
  ELSE
    EXECUTE 'TRUNCATE TABLE ' || tables || ' RESTART IDENTITY CASCADE';
  END IF;
END $$;
SQL
  )"

  echo "↑ Clearing database rows in '$database' (tables stay intact)..."
  kubectl -n "$NAMESPACE" exec "$pod" -- env PGPASSWORD="$password" psql -h "$db_host" -U "$user" -d "$database" -v ON_ERROR_STOP=1 -c "$reset_sql"
  echo "✓ Database data reset complete."
}

command="${1:-up}"
case "$command" in
  up | start)
    ;;
  reset)
    reset_database
    exit 0
    ;;
  -h | --help | help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac

require k3d
require kubectl
require helm
require tilt

if k3d cluster list -o json 2>/dev/null | grep -q "\"name\":\"${CLUSTER}\""; then
  echo "↻ Tearing down existing cluster '${CLUSTER}'..."
  k3d cluster delete "${CLUSTER}"
fi

echo "↑ Creating cluster '${CLUSTER}'..."
k3d cluster create --config infra/k3d/cluster.yaml

# k3d writes the context as 'k3d-kubwave' on every (re)create. Re-apply the
# short 'dev' alias via kubectx so `kubectx dev` keeps working across restarts.
if command -v kubectx >/dev/null 2>&1; then
  kubectx "dev=k3d-${CLUSTER}" >/dev/null 2>&1 || true
fi

echo "↑ Waiting for nodes to be Ready..."
kubectl wait --for=condition=Ready nodes --all --timeout=120s

echo "↑ Waiting for k3d-bundled Traefik install job to register the deployment..."
# k3d installs Traefik via the helm-controller's HelmChart CR; the deployment
# and CRDs appear asynchronously after the cluster starts. We MUST wait for
# both before letting Tilt apply, or the chart's Middleware resource gets
# silently dropped (`no matches for kind "Middleware"`, race seen 2026-05-25).
deadline=$((SECONDS + 180))
until kubectl -n kube-system get deployment traefik >/dev/null 2>&1; do
  if (( SECONDS > deadline )); then
    echo "✗ traefik deployment never appeared in kube-system" >&2
    exit 1
  fi
  sleep 2
done

echo "↑ Waiting for Traefik deployment to be Available..."
kubectl -n kube-system wait --for=condition=Available deployment/traefik --timeout=180s

echo "↑ Waiting for Traefik CRDs to be Established..."
for crd in middlewares.traefik.io ingressroutes.traefik.io; do
  deadline=$((SECONDS + 60))
  until kubectl get crd "$crd" >/dev/null 2>&1; do
    if (( SECONDS > deadline )); then
      echo "✗ CRD $crd never appeared" >&2
      exit 1
    fi
    sleep 1
  done
  kubectl wait --for=condition=Established "crd/$crd" --timeout=60s
done

echo "↑ Installing CloudNativePG operator (cnpg-system)..."
# The chart's Postgres `Cluster` CR needs the CNPG operator + its CRDs to exist before
# Tilt applies, or Tilt silently drops the CR (same class of race as the Traefik Middleware
# above). The CLI installs this as a managed dependency on prod; dev does it here.
helm repo add cnpg https://cloudnative-pg.github.io/charts >/dev/null 2>&1 || true
helm repo update cnpg >/dev/null 2>&1 || true
helm upgrade --install cnpg cnpg/cloudnative-pg --namespace cnpg-system --create-namespace --wait --timeout 180s

echo "↑ Waiting for CloudNativePG CRD to be Established..."
deadline=$((SECONDS + 120))
until kubectl get crd clusters.postgresql.cnpg.io >/dev/null 2>&1; do
  if (( SECONDS > deadline )); then
    echo "✗ CloudNativePG CRD never appeared" >&2
    exit 1
  fi
  sleep 2
done
kubectl wait --for=condition=Established crd/clusters.postgresql.cnpg.io --timeout=60s

echo "↑ Ensuring namespace '$NAMESPACE' exists..."
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

echo "↑ Starting Tilt (Ctrl+C to stop)..."
exec tilt up
