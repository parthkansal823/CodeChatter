{{/* Labels on everything the chart makes. */}}
{{- define "cc.labels" -}}
app.kubernetes.io/part-of: codechatter
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}

{{/* One part's selector labels: (dict "root" $ "component" "api"). */}}
{{- define "cc.selector" -}}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/* A part's full labels. */}}
{{- define "cc.componentLabels" -}}
{{ include "cc.labels" .root }}
{{ include "cc.selector" . }}
{{- end }}

{{/* An app image: (dict "root" $ "name" "api"). */}}
{{- define "cc.image" -}}
{{- with .root.Values.images.registry }}{{ . }}/{{ end }}codechatter-{{ .name }}:{{ .root.Values.images.tag }}
{{- end }}

{{/* A service's in-cluster name. */}}
{{- define "cc.host" -}}
{{ .root.Release.Name }}-{{ .name }}
{{- end }}

{{- define "cc.secretName" -}}
{{ .Release.Name }}-secrets
{{- end }}

{{- define "cc.previewOrigin" -}}
{{ .Values.previewOrigin | default (regexReplaceAll "://" .Values.url "://preview.") }}
{{- end }}

{{/* Locked down like the rooms' pods: no root, no capabilities, read-only root. */}}
{{- define "cc.podSecurity" -}}
runAsNonRoot: true
runAsUser: {{ .uid | default 1000 }}
runAsGroup: {{ .gid | default 1000 }}
fsGroup: {{ .gid | default 1000 }}
seccompProfile: { type: RuntimeDefault }
{{- end }}

{{- define "cc.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities: { drop: [ALL] }
{{- end }}

{{/* What the API and collab both need. */}}
{{- define "cc.serverEnv" -}}
- name: NODE_ENV
  value: production
{{ include "cc.serverSettings" . }}
{{- end }}

{{/* The same without NODE_ENV, for the seed, which runs the API's code as development. */}}
{{- define "cc.serverSettings" -}}
- name: APP_URL
  value: {{ .Values.url | quote }}
- name: DATABASE_URL
  valueFrom: { secretKeyRef: { name: {{ include "cc.secretName" . }}, key: DATABASE_URL } }
- name: VALKEY_URL
  value: {{ .Values.valkey.externalUrl | default (printf "redis://%s-valkey:6379" .Release.Name) | quote }}
- name: BETTER_AUTH_SECRET
  valueFrom: { secretKeyRef: { name: {{ include "cc.secretName" . }}, key: BETTER_AUTH_SECRET } }
- name: SERVICE_SECRET
  valueFrom: { secretKeyRef: { name: {{ include "cc.secretName" . }}, key: SERVICE_SECRET } }
{{- end }}

{{/* The API's own settings, on top of cc.serverEnv. */}}
{{- define "cc.apiEnv" -}}
- name: RUNNER_URL
  value: http://{{ .Release.Name }}-runner:4200
- name: PREVIEW_ORIGIN
  value: {{ include "cc.previewOrigin" . | quote }}
- name: MAIL_FROM
  value: {{ .Values.mail.from | quote }}
{{- if .Values.mail.mailpit }}
- name: SMTP_HOST
  value: {{ .Release.Name }}-mailpit
- name: SMTP_PORT
  value: "1025"
{{- else }}
- name: SMTP_HOST
  value: {{ required "mail.smtp.host is needed when mail.mailpit is false" .Values.mail.smtp.host | quote }}
- name: SMTP_PORT
  value: {{ .Values.mail.smtp.port | quote }}
- name: SMTP_USER
  value: {{ .Values.mail.smtp.user | quote }}
- name: SMTP_PASS
  valueFrom: { secretKeyRef: { name: {{ include "cc.secretName" . }}, key: SMTP_PASS } }
{{- end }}
- name: AI_PROVIDER
  value: {{ .Values.ai.provider | quote }}
{{- range $name, $value := .Values.ai.env }}
- name: {{ $name }}
  value: {{ $value | quote }}
{{- end }}
{{- range $name, $value := .Values.ai.secretEnv }}
- name: {{ $name }}
  valueFrom: { secretKeyRef: { name: {{ include "cc.secretName" $ }}, key: {{ $name }} } }
{{- end }}
{{- end }}

{{/* Applies the database's migrations before the API or collab starts (idempotent; retried until Postgres answers). */}}
{{- define "cc.migrate" -}}
- name: migrate
  image: {{ include "cc.image" (dict "root" . "name" "migrate") }}
  imagePullPolicy: {{ .Values.images.pullPolicy }}
  env:
    - name: DATABASE_URL
      valueFrom: { secretKeyRef: { name: {{ include "cc.secretName" . }}, key: DATABASE_URL } }
  securityContext: {{- include "cc.containerSecurity" . | nindent 4 }}
{{- end }}

{{/* An HTTP health check on a port and path. */}}
{{- define "cc.probes" -}}
readinessProbe:
  httpGet: { path: {{ .path }}, port: {{ .port }} }
  periodSeconds: 10
livenessProbe:
  httpGet: { path: {{ .path }}, port: {{ .port }} }
  initialDelaySeconds: 30
  periodSeconds: 20
  failureThreshold: 6
{{- end }}
