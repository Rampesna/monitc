import type { PoolClient } from 'pg'
import { db } from './pool.js'

interface Migration {
  id: number
  name: string
  sql: string
}

const migrations: Migration[] = [
  {
    id: 1,
    name: 'platform-foundation',
    sql: `
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE EXTENSION IF NOT EXISTS vector;

      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email_ciphertext TEXT NOT NULL,
        email_lookup_hash TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name_ciphertext TEXT NOT NULL,
        global_role TEXT NOT NULL DEFAULT 'user' CHECK (global_role IN ('user', 'super_admin')),
        must_change_password BOOLEAN NOT NULL DEFAULT false,
        email_verified_at TIMESTAMPTZ,
        disabled_at TIMESTAMPTZ,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_lookup_unique ON users (email_lookup_hash);

      CREATE TABLE IF NOT EXISTS workspaces (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name_ciphertext TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS workspace_members (
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'viewer')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS plans (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        monthly_price_cents INTEGER,
        entitlements JSONB NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
        plan_code TEXT NOT NULL REFERENCES plans(code),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trialing', 'past_due', 'cancelled')),
        source TEXT NOT NULL DEFAULT 'manual',
        current_period_ends_at TIMESTAMPTZ,
        assigned_by UUID REFERENCES users(id),
        notes_ciphertext TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS refresh_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        family_id UUID NOT NULL,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        user_agent_hash TEXT,
        ip_hash TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        rotated_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        replaced_by UUID REFERENCES refresh_sessions(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS refresh_sessions_family_idx ON refresh_sessions (family_id);
      CREATE INDEX IF NOT EXISTS refresh_sessions_expiry_idx ON refresh_sessions (expires_at);

      CREATE TABLE IF NOT EXISTS server_connections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name_ciphertext TEXT NOT NULL,
        connection_mode TEXT NOT NULL DEFAULT 'ssh' CHECK (connection_mode IN ('ssh', 'agent')),
        secret_ciphertext TEXT NOT NULL,
        secret_key_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'degraded', 'offline')),
        last_seen_at TIMESTAMPTZ,
        last_error_code TEXT,
        last_error_at TIMESTAMPTZ,
        created_by UUID NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS server_connections_workspace_idx ON server_connections (workspace_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS system_metric_samples (
        id BIGSERIAL PRIMARY KEY,
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        server_id UUID NOT NULL REFERENCES server_connections(id) ON DELETE CASCADE,
        sampled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        cpu_percent DOUBLE PRECISION NOT NULL,
        memory_percent DOUBLE PRECISION NOT NULL,
        disk_percent DOUBLE PRECISION NOT NULL,
        network_rx_total BIGINT NOT NULL DEFAULT 0,
        network_tx_total BIGINT NOT NULL DEFAULT 0,
        network_rx_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
        network_tx_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
        uptime_seconds BIGINT NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS metric_samples_lookup_idx ON system_metric_samples (workspace_id, server_id, sampled_at DESC);

      CREATE TABLE IF NOT EXISTS kubernetes_pod_samples (
        id BIGSERIAL PRIMARY KEY,
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        server_id UUID NOT NULL REFERENCES server_connections(id) ON DELETE CASCADE,
        namespace TEXT NOT NULL,
        pod_name TEXT NOT NULL,
        node_name TEXT NOT NULL DEFAULT '',
        phase TEXT NOT NULL,
        ready TEXT NOT NULL,
        restarts INTEGER NOT NULL DEFAULT 0,
        cpu_usage_millicores DOUBLE PRECISION NOT NULL DEFAULT 0,
        cpu_request_millicores DOUBLE PRECISION NOT NULL DEFAULT 0,
        cpu_limit_millicores DOUBLE PRECISION NOT NULL DEFAULT 0,
        memory_usage_bytes BIGINT NOT NULL DEFAULT 0,
        memory_request_bytes BIGINT NOT NULL DEFAULT 0,
        memory_limit_bytes BIGINT NOT NULL DEFAULT 0,
        network_rx_total BIGINT NOT NULL DEFAULT 0,
        network_tx_total BIGINT NOT NULL DEFAULT 0,
        network_rx_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
        network_tx_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
        sampled_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS pod_samples_lookup_idx ON kubernetes_pod_samples
        (workspace_id, server_id, namespace, pod_name, sampled_at DESC);

      CREATE TABLE IF NOT EXISTS alert_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        server_id UUID REFERENCES server_connections(id) ON DELETE CASCADE,
        name_ciphertext TEXT NOT NULL,
        metric TEXT NOT NULL,
        operator TEXT NOT NULL CHECK (operator IN ('gt', 'gte', 'lt', 'lte', 'eq')),
        threshold DOUBLE PRECISION NOT NULL,
        duration_seconds INTEGER NOT NULL DEFAULT 60,
        cooldown_seconds INTEGER NOT NULL DEFAULT 900,
        channels JSONB NOT NULL DEFAULT '[]'::jsonb,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS alert_rules_workspace_idx ON alert_rules (workspace_id, enabled);

      CREATE TABLE IF NOT EXISTS alert_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
        server_id UUID NOT NULL REFERENCES server_connections(id) ON DELETE CASCADE,
        value DOUBLE PRECISION NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
        triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        resolved_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS alert_events_lookup_idx ON alert_events
        (workspace_id, status, triggered_at DESC);

      CREATE TABLE IF NOT EXISTS contact_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        requested_plan_code TEXT NOT NULL REFERENCES plans(code),
        message_ciphertext TEXT,
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'approved', 'rejected')),
        handled_by UUID REFERENCES users(id),
        handled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS contact_requests_status_idx ON contact_requests (status, created_at DESC);

      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
        actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        ip_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS audit_logs_workspace_idx ON audit_logs (workspace_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS incident_knowledge (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        title_ciphertext TEXT NOT NULL,
        summary_ciphertext TEXT NOT NULL,
        embedding vector(1536),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS incident_knowledge_workspace_idx ON incident_knowledge (workspace_id, created_at DESC);
    `
  },
  {
    id: 2,
    name: 'native-agent-foundation',
    sql: `
      ALTER TABLE server_connections ALTER COLUMN secret_ciphertext DROP NOT NULL;
      ALTER TABLE server_connections ALTER COLUMN secret_key_id DROP NOT NULL;

      CREATE TABLE IF NOT EXISTS agent_pairing_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        server_id UUID NOT NULL REFERENCES server_connections(id) ON DELETE CASCADE,
        token_hash BYTEA NOT NULL UNIQUE,
        token_hint TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS agent_pairing_tokens_server_idx
        ON agent_pairing_tokens (server_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS agent_pairing_tokens_expiry_idx
        ON agent_pairing_tokens (expires_at) WHERE used_at IS NULL AND revoked_at IS NULL;

      CREATE TABLE IF NOT EXISTS agent_identities (
        id UUID PRIMARY KEY,
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        server_id UUID NOT NULL UNIQUE REFERENCES server_connections(id) ON DELETE CASCADE,
        instance_id UUID NOT NULL UNIQUE,
        certificate_serial TEXT NOT NULL,
        certificate_expires_at TIMESTAMPTZ NOT NULL,
        agent_version TEXT NOT NULL DEFAULT '',
        operating_system TEXT NOT NULL DEFAULT 'linux',
        architecture TEXT NOT NULL DEFAULT '',
        kernel_version TEXT NOT NULL DEFAULT '',
        capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
        enabled_capabilities JSONB NOT NULL DEFAULT '["CAPABILITY_HOST_METRICS"]'::jsonb,
        ebpf_active BOOLEAN NOT NULL DEFAULT false,
        boot_id TEXT,
        last_acknowledged_sequence BIGINT NOT NULL DEFAULT 0,
        last_seen_at TIMESTAMPTZ,
        last_heartbeat_at TIMESTAMPTZ,
        spool_bytes BIGINT NOT NULL DEFAULT 0,
        spool_batches INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'paired' CHECK (status IN ('paired', 'connected', 'degraded', 'offline', 'revoked')),
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS agent_identities_workspace_idx ON agent_identities (workspace_id, status);
      CREATE INDEX IF NOT EXISTS agent_identities_seen_idx ON agent_identities (last_seen_at DESC);

      ALTER TABLE system_metric_samples ADD COLUMN IF NOT EXISTS sample_source TEXT NOT NULL DEFAULT 'ssh';
      ALTER TABLE system_metric_samples ADD COLUMN IF NOT EXISTS agent_sequence BIGINT;
      ALTER TABLE system_metric_samples ADD COLUMN IF NOT EXISTS boot_id TEXT;
      ALTER TABLE system_metric_samples ADD COLUMN IF NOT EXISTS monotonic_nanos NUMERIC(20, 0);
      ALTER TABLE system_metric_samples ADD COLUMN IF NOT EXISTS sample_interval_nanos BIGINT;
      ALTER TABLE system_metric_samples ADD COLUMN IF NOT EXISTS collection_duration_nanos BIGINT;
      ALTER TABLE system_metric_samples ADD COLUMN IF NOT EXISTS load_average_1 DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE system_metric_samples ADD COLUMN IF NOT EXISTS load_average_5 DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE system_metric_samples ADD COLUMN IF NOT EXISTS load_average_15 DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE system_metric_samples ADD COLUMN IF NOT EXISTS ebpf_active BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE system_metric_samples ADD COLUMN IF NOT EXISTS scheduler_switches BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE system_metric_samples ADD COLUMN IF NOT EXISTS tcp_retransmits BIGINT NOT NULL DEFAULT 0;
      CREATE UNIQUE INDEX IF NOT EXISTS metric_samples_agent_sequence_unique
        ON system_metric_samples (server_id, boot_id, agent_sequence)
        WHERE sample_source = 'agent' AND boot_id IS NOT NULL AND agent_sequence IS NOT NULL;

      CREATE TABLE IF NOT EXISTS system_metric_rollups_1m (
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        server_id UUID NOT NULL REFERENCES server_connections(id) ON DELETE CASCADE,
        bucket_at TIMESTAMPTZ NOT NULL,
        sample_count INTEGER NOT NULL,
        cpu_average DOUBLE PRECISION NOT NULL,
        cpu_minimum DOUBLE PRECISION NOT NULL,
        cpu_maximum DOUBLE PRECISION NOT NULL,
        memory_average DOUBLE PRECISION NOT NULL,
        memory_minimum DOUBLE PRECISION NOT NULL,
        memory_maximum DOUBLE PRECISION NOT NULL,
        disk_average DOUBLE PRECISION NOT NULL,
        network_rx_rate_average DOUBLE PRECISION NOT NULL,
        network_tx_rate_average DOUBLE PRECISION NOT NULL,
        scheduler_switches_total BIGINT NOT NULL DEFAULT 0,
        tcp_retransmits_total BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (workspace_id, server_id, bucket_at)
      );
      CREATE INDEX IF NOT EXISTS metric_rollups_lookup_idx
        ON system_metric_rollups_1m (workspace_id, server_id, bucket_at DESC);

      ALTER TABLE kubernetes_pod_samples ADD COLUMN IF NOT EXISTS sample_source TEXT NOT NULL DEFAULT 'ssh';
      ALTER TABLE kubernetes_pod_samples ADD COLUMN IF NOT EXISTS agent_sequence BIGINT;
      ALTER TABLE kubernetes_pod_samples ADD COLUMN IF NOT EXISTS boot_id TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS pod_samples_agent_sequence_unique
        ON kubernetes_pod_samples (server_id, boot_id, agent_sequence, namespace, pod_name)
        WHERE sample_source = 'agent' AND boot_id IS NOT NULL AND agent_sequence IS NOT NULL;

      CREATE TABLE IF NOT EXISTS docker_container_samples (
        id BIGSERIAL PRIMARY KEY,
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        server_id UUID NOT NULL REFERENCES server_connections(id) ON DELETE CASCADE,
        container_id TEXT NOT NULL,
        container_name TEXT NOT NULL,
        image TEXT NOT NULL,
        state TEXT NOT NULL,
        status TEXT NOT NULL,
        cpu_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
        memory_usage_bytes BIGINT NOT NULL DEFAULT 0,
        memory_limit_bytes BIGINT NOT NULL DEFAULT 0,
        network_rx_total BIGINT NOT NULL DEFAULT 0,
        network_tx_total BIGINT NOT NULL DEFAULT 0,
        network_rx_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
        network_tx_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
        agent_sequence BIGINT NOT NULL,
        boot_id TEXT NOT NULL,
        sampled_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS docker_samples_agent_sequence_unique
        ON docker_container_samples (server_id, boot_id, agent_sequence, container_id);
      CREATE INDEX IF NOT EXISTS docker_samples_lookup_idx
        ON docker_container_samples (workspace_id, server_id, container_id, sampled_at DESC);
    `
  },
  {
    id: 3,
    name: 'native-agent-connection-lease',
    sql: `
      ALTER TABLE agent_identities ADD COLUMN IF NOT EXISTS connection_id UUID;
    `
  }
]

async function applyMigration(client: PoolClient, migration: Migration): Promise<void> {
  const existing = await client.query<{ id: number }>('SELECT id FROM schema_migrations WHERE id = $1', [migration.id])
  if (existing.rowCount) return

  await client.query('BEGIN')
  try {
    await client.query(migration.sql)
    await client.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [migration.id, migration.name])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

export async function migrateDatabase(): Promise<void> {
  const client = await db.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [1_304_202_6])
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    for (const migration of migrations) await applyMigration(client, migration)
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [1_304_202_6]).catch(() => undefined)
    client.release()
  }
}
