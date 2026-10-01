{{/*
Resolve Gateway API gatewayClassName.
Priority: explicit .Values.gateway.gatewayClassName > cluster autodetection.
Returns empty string when no class is available.
*/}}
{{- define "mcp.resolvedGatewayClass" -}}
{{- $gw := default dict .Values.gateway -}}
{{- if $gw.gatewayClassName -}}
  {{- $gw.gatewayClassName -}}
{{- else -}}
  {{- $classes := lookup "gateway.networking.k8s.io/v1" "GatewayClass" "" "" -}}
  {{- if and $classes $classes.items -}}
    {{- $names := list -}}
    {{- range $classes.items -}}
      {{- $names = append $names .metadata.name -}}
    {{- end -}}
    {{- index (sortAlpha $names) 0 -}}
  {{- end -}}
{{- end -}}
{{- end -}}

{{/*
Resolve effective gateway name for parentRefs.
Uses existingGatewayName when set, otherwise chart-managed gatewayName.
*/}}
{{- define "mcp.resolvedGatewayName" -}}
{{- $gw := default dict .Values.gateway -}}
{{- default ($gw.gatewayName | default "kairos-gateway") $gw.existingGatewayName -}}
{{- end -}}

{{/*
Determine ingress mode: "gateway" | "ingress" | "none".
Explicit .Values.gateway.mode wins; "auto" picks based on:
  1. gatewayClassName (explicit or autodetected from cluster) -> gateway
  2. ingressClassName -> ingress
  3. nothing available -> none
*/}}
{{- define "mcp.ingressMode" -}}
{{- $gw := default dict .Values.gateway -}}
{{- $mode := default "auto" $gw.mode -}}
{{- if eq $mode "auto" -}}
  {{- $gwClass := include "mcp.resolvedGatewayClass" . | trim -}}
  {{- if $gwClass -}}gateway{{- else if $gw.ingressClassName -}}ingress{{- else -}}none{{- end -}}
{{- else -}}
  {{- $mode -}}
{{- end -}}
{{- end -}}

{{- define "mcp.adminHostname" -}}
{{- $gw := default dict .Values.gateway -}}
{{- $routes := default dict $gw.routes -}}
{{- $kc := default dict $routes.keycloak -}}
{{- $lock := default dict $kc.adminLockdown -}}
{{- $enabled := ternary $lock.enabled true (hasKey $lock "enabled") -}}
{{- if and $enabled $gw.hostname -}}
  {{- default (printf "admin.%s" $gw.hostname) $lock.adminHostname -}}
{{- end -}}
{{- end -}}

{{/*
Legacy credentials Secret name. MUST remain "kairos-mcp-credentials":
existing installations created this Secret and the lookup-based resolution
below depends on the exact name to preserve bindings on upgrade.
*/}}
{{- define "mcp.credentialsLegacySecretName" -}}
{{- printf "kairos-mcp-credentials" -}}
{{- end -}}

{{- define "mcp.credentialsPreferredSecretName" -}}
{{- $name := default "" .Values.credentials.name | trim -}}
{{- if $name -}}
{{- $name -}}
{{- else -}}
{{- printf "%s-credentials" .Release.Name -}}
{{- end -}}
{{- end -}}

{{- define "mcp.credentialsSecretName" -}}
{{- $existing := default "" .Values.credentials.existingSecret | trim -}}
{{- if $existing -}}
{{- $existing -}}
{{- else -}}
{{- $preferred := include "mcp.credentialsPreferredSecretName" . -}}
{{- $legacy := include "mcp.credentialsLegacySecretName" . -}}
{{- $preferredObj := lookup "v1" "Secret" .Release.Namespace $preferred -}}
{{- if $preferredObj -}}
{{- $preferred -}}
{{- else -}}
{{- $legacyObj := lookup "v1" "Secret" .Release.Namespace $legacy -}}
{{- if $legacyObj -}}
{{- $legacy -}}
{{- else -}}
{{- $preferred -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}
