/**
 * env.ts — the Worker's runtime bindings and configuration surface.
 *
 * `DB` is the Cloudflare D1 (SQLite) binding declared in wrangler.toml. The GRAFANA_*
 * values are OPTIONAL secrets; when unset, the Grafana push is simply skipped and the
 * Worker still logs to Cloudflare Workers Logs and serves /metrics for a pull scrape.
 */
export interface Env {
  DB: D1Database;

  // Public, non-secret vars (wrangler.toml [vars]):
  ALLOWED_ORIGINS?: string; // comma-separated, or "*"
  ENVIRONMENT?: string;
  SERVICE_NAME?: string;

  // Optional secrets (wrangler secret put ...). Empty/undefined disables the push.
  GRAFANA_LOKI_URL?: string; // e.g. https://logs-prod-xxx.grafana.net/loki/api/v1/push
  GRAFANA_LOKI_USER?: string; // Loki/basic-auth user id (numeric)
  GRAFANA_LOKI_TOKEN?: string; // Grafana Cloud access policy token
  GRAFANA_OTLP_URL?: string; // e.g. https://otlp-gateway-xxx.grafana.net/otlp
  GRAFANA_OTLP_USER?: string; // OTLP instance id
  GRAFANA_OTLP_TOKEN?: string; // Grafana Cloud access policy token

  // Chaos Mode admin gate. When unset, the /chaos control plane refuses to start chaos
  // (read-only /chaos/status + /chaos/events still work). Set as a Wrangler SECRET.
  CHAOS_ADMIN_TOKEN?: string;
}
