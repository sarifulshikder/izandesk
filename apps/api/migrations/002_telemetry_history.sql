-- 002: Time-series telemetry history tables (auto-upgrades to TimescaleDB hypertables if available)

CREATE TABLE IF NOT EXISTS router_telemetry_history (
  id BIGSERIAL,
  router_id UUID NOT NULL REFERENCES network_routers(id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT,
  cpu_load NUMERIC(5,2),
  memory_used_mb NUMERIC(12,2),
  memory_total_mb NUMERIC(12,2),
  rx_bps BIGINT DEFAULT 0,
  tx_bps BIGINT DEFAULT 0,
  active_sessions INT DEFAULT 0,
  PRIMARY KEY (id, recorded_at)
);

CREATE INDEX IF NOT EXISTS idx_router_telemetry_hist_router_time
  ON router_telemetry_history (router_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS subscriber_session_history (
  id BIGSERIAL,
  subscriber_id UUID REFERENCES subscribers(id) ON DELETE CASCADE,
  router_id UUID REFERENCES network_routers(id) ON DELETE SET NULL,
  username TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT,
  rx_bps BIGINT DEFAULT 0,
  tx_bps BIGINT DEFAULT 0,
  rx_bytes BIGINT DEFAULT 0,
  tx_bytes BIGINT DEFAULT 0,
  PRIMARY KEY (id, recorded_at)
);

CREATE INDEX IF NOT EXISTS idx_sub_session_hist_sub_time
  ON subscriber_session_history (subscriber_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_session_hist_user_time
  ON subscriber_session_history (username, recorded_at DESC);

CREATE TABLE IF NOT EXISTS onu_optical_history (
  id BIGSERIAL,
  onu_id UUID NOT NULL REFERENCES onus(id) ON DELETE CASCADE,
  olt_id UUID NOT NULL REFERENCES olts(id) ON DELETE CASCADE,
  subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT,
  rx_power_dbm NUMERIC(6,2),
  tx_power_dbm NUMERIC(6,2),
  temperature_c NUMERIC(6,2),
  distance_m INT,
  PRIMARY KEY (id, recorded_at)
);

CREATE INDEX IF NOT EXISTS idx_onu_optical_hist_onu_time
  ON onu_optical_history (onu_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_onu_optical_hist_sub_time
  ON onu_optical_history (subscriber_id, recorded_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('router_telemetry_history', 'recorded_at', if_not_exists => TRUE, migrate_data => TRUE);
    PERFORM create_hypertable('subscriber_session_history', 'recorded_at', if_not_exists => TRUE, migrate_data => TRUE);
    PERFORM create_hypertable('onu_optical_history', 'recorded_at', if_not_exists => TRUE, migrate_data => TRUE);
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
