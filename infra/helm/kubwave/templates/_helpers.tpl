{{/*
Common labels for all chart resources.

Usage:
  metadata:
    labels:
      {{- include "kubwave.labels" (dict "root" $ "component" "api") | nindent 6 }}
*/}}
{{- define "kubwave.labels" -}}
{{- $component := .component | default "" -}}
app.kubernetes.io/part-of: kubwave
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
helm.sh/chart: {{ printf "%s-%s" .root.Chart.Name .root.Chart.Version | replace "+" "_" }}
{{- if $component }}
app.kubernetes.io/name: {{ $component }}
app.kubernetes.io/component: {{ $component }}
{{- end }}
{{- end }}

{{/*
Selector labels — kept minimal so Service/Deployment selectors stay stable
across chart-version upgrades (matchLabels is immutable on Deployment).
*/}}
{{- define "kubwave.selectorLabels" -}}
app.kubernetes.io/name: {{ .component }}
{{- end }}

{{/*
Resolve the Secret name a workload should consume:
  - if .existingSecret is set, use it
  - else use .name
Pass dict "secret" .Values.api.secret
*/}}
{{- define "kubwave.secretName" -}}
{{- if .secret.existingSecret -}}
{{- .secret.existingSecret -}}
{{- else -}}
{{- .secret.name -}}
{{- end -}}
{{- end }}

{{/*
kubwave.replicas — effective replica/instance count for a workload, HA-aware.
When ha.enabled every HA workload runs ha.replicas; otherwise the workload's own
default (api/console/worker .replicas, postgres .instances), passed as `fallback`.

Usage: {{ include "kubwave.replicas" (dict "root" $ "fallback" .Values.api.replicas) }}
*/}}
{{- define "kubwave.replicas" -}}
{{- $ha := .root.Values.ha | default dict -}}
{{- if $ha.enabled -}}{{ $ha.replicas | default 3 }}{{- else -}}{{ .fallback }}{{- end -}}
{{- end }}

{{/*
kubwave.haSpread — soft podAntiAffinity + topologySpread for a component. Both
constraints are soft (preferred / ScheduleAnyway) so a cluster with fewer than ha.replicas
nodes still schedules every replica (just not spread). The CALLER gates on ha.enabled (so
the empty case adds no whitespace); this helper assumes it should render.

Usage: {{- if .Values.ha.enabled }}{{- include "kubwave.haSpread" (dict "root" $ "component" "api") | nindent 6 }}{{- end }}
*/}}
{{- define "kubwave.haSpread" -}}
{{- $topologyKey := (.root.Values.ha | default dict).topologyKey | default "kubernetes.io/hostname" -}}
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          topologyKey: {{ $topologyKey }}
          labelSelector:
            matchLabels:
              {{- include "kubwave.selectorLabels" (dict "component" .component) | nindent 14 }}
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: {{ $topologyKey }}
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        {{- include "kubwave.selectorLabels" (dict "component" .component) | nindent 8 }}
{{- end -}}

{{/*
kubwave.haPDB — a PodDisruptionBudget(maxUnavailable: 1) for a component, only when
ha.enabled. Rendered from templates/{api,console,worker}/pdb.yaml. CNPG manages its own
database PDB, so there is no postgres PDB here.

maxUnavailable (not minAvailable): at 3 replicas it keeps ≥2 up during a voluntary
disruption (stronger than minAvailable:1, which only guarantees 1). And it does NOT deadlock
if the workload is ever scaled to 1 (e.g. HA toggled off live before the next helm upgrade
removes this PDB) — minAvailable:1 over a single replica blocks every node drain, whereas
maxUnavailable:1 still permits evicting that lone pod.

Usage (whole file): {{- include "kubwave.haPDB" (dict "root" $ "component" "api") }}
*/}}
{{- define "kubwave.haPDB" -}}
{{- if (.root.Values.ha | default dict).enabled }}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ .component }}
  labels:
    {{- include "kubwave.labels" (dict "root" .root "component" .component) | nindent 4 }}
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      {{- include "kubwave.selectorLabels" (dict "component" .component) | nindent 6 }}
{{- end }}
{{- end }}
