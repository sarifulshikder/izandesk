import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'izandesk',
  user: process.env.DB_USER || 'izandesk_user',
  password: process.env.DB_PASSWORD || 'izandesk_secret_password',
});

// A dropped idle connection is routine during DB restarts/failover. Without a
// listener, pg emits an unhandled 'error' event and takes down the whole API.
pool.on('error', (err) => {
  console.error('[DB] idle connection error:', err.message);
});

export async function query<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }> {
  return pool.query(text, params) as any;
}

export async function initDb() {
  await pool.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS areas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS zones (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      area_id UUID NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(area_id, name)
    );

    CREATE TABLE IF NOT EXISTS distribution_boxes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      code TEXT UNIQUE,
      box_type TEXT NOT NULL DEFAULT 'TJ',
      capacity_ports INT NOT NULL DEFAULT 8,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      location GEOGRAPHY(Point, 4326),
      address TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS fiber_routes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      route_type TEXT NOT NULL DEFAULT 'FIBER',
      from_box_id UUID REFERENCES distribution_boxes(id) ON DELETE SET NULL,
      to_box_id UUID REFERENCES distribution_boxes(id) ON DELETE SET NULL,
      path GEOGRAPHY(LineString, 4326),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS subscribers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_code TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      subscriber_type TEXT NOT NULL DEFAULT 'HOME',
      connection_type TEXT NOT NULL DEFAULT 'PPPOE',
      username TEXT UNIQUE,
      password TEXT,
      phone TEXT,
      email TEXT,
      nid_number TEXT,
      package_name TEXT,
      bandwidth_mbps INT,
      monthly_bill NUMERIC(12,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING',
      area_id UUID REFERENCES areas(id) ON DELETE SET NULL,
      zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
      distribution_box_id UUID REFERENCES distribution_boxes(id) ON DELETE SET NULL,
      address TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      location GEOGRAPHY(Point, 4326),
      ip_address TEXT,
      mac_address TEXT,
      installation_date DATE,
      district TEXT,
      thana TEXT,
      upazila TEXT,
      post_office TEXT,
      village TEXT,
      area_name TEXT,
      ward_no TEXT,
      road_no TEXT,
      house_no TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS kyc_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
      doc_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      status TEXT NOT NULL DEFAULT 'PENDING'
    );
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING';

    -- KYC compliance extension. Only masked identity numbers are stored; scans
    -- stay in an ownership-checked, AES-256-GCM encrypted local file store with
    -- a SHA-256 checksum of the plaintext.
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS document_number_masked TEXT;
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS issuer TEXT;
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS issue_date DATE;
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS expires_at DATE;
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS checksum TEXT;
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS scan_status TEXT NOT NULL DEFAULT 'PENDING';
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS storage_key TEXT;
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'STAFF';
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS verification_method TEXT;
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS verification_reference TEXT;
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS privacy_notice_version TEXT;
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS reviewed_by_name TEXT;
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS reupload_of UUID REFERENCES kyc_documents(id) ON DELETE SET NULL;
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS retention_until DATE;
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS legal_hold_until DATE;
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ;
    -- AES-256-GCM file encryption. NULL metadata means a legacy plaintext file;
    -- the maintenance sweep migrates it on startup.
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS encryption_alg TEXT;
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS encryption_iv TEXT;
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS encryption_auth_tag TEXT;
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS encryption_key_id TEXT;
    ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

    CREATE INDEX IF NOT EXISTS idx_kyc_documents_subscriber ON kyc_documents(subscriber_id);
    CREATE INDEX IF NOT EXISTS idx_kyc_documents_status ON kyc_documents(status);
    CREATE INDEX IF NOT EXISTS idx_kyc_documents_expires ON kyc_documents(expires_at) WHERE expires_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_kyc_documents_reupload ON kyc_documents(reupload_of) WHERE reupload_of IS NOT NULL;

    DO $$ BEGIN
      ALTER TABLE kyc_documents ADD CONSTRAINT kyc_documents_status_check
        CHECK (status IN ('PENDING','UNDER_REVIEW','APPROVED','REJECTED','RESUBMISSION_REQUIRED','EXPIRED','NOT_APPLICABLE'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      ALTER TABLE kyc_documents ADD CONSTRAINT kyc_documents_scan_status_check
        CHECK (scan_status IN ('PENDING','CLEAN','FLAGGED','NOT_SCANNED'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      ALTER TABLE kyc_documents ADD CONSTRAINT kyc_documents_source_check
        CHECK (source IN ('STAFF','PORTAL','MCP','IMPORT'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    -- Append-only review history. Kept separate from audit_logs so reviewer
    -- notes/evidence can be queried without parsing JSON details.
    CREATE TABLE IF NOT EXISTS kyc_review_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID NOT NULL REFERENCES kyc_documents(id) ON DELETE CASCADE,
      subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
      actor_id TEXT,
      actor_name TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      reason TEXT,
      evidence_ref TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_kyc_review_events_document ON kyc_review_events(document_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_kyc_review_events_subscriber ON kyc_review_events(subscriber_id, created_at DESC);

    -- One KYC profile per subscriber: identity class, consent/lawful basis and
    -- overall completion state (derived from the mandatory document set).
    CREATE TABLE IF NOT EXISTS subscriber_kyc_profiles (
      subscriber_id UUID PRIMARY KEY REFERENCES subscribers(id) ON DELETE CASCADE,
      service_type TEXT NOT NULL DEFAULT 'FIXED_BROADBAND',
      identity_type TEXT NOT NULL DEFAULT 'INDIVIDUAL',
      legal_name TEXT,
      date_of_birth DATE,
      occupation TEXT,
      business_registration_number TEXT,
      tax_id TEXT,
      nid_number_masked TEXT,
      present_address TEXT,
      permanent_address TEXT,
      verified_mobile TEXT,
      email TEXT,
      privacy_notice_version TEXT,
      lawful_basis TEXT NOT NULL DEFAULT 'CONTRACT',
      consent_at TIMESTAMPTZ,
      consent_withdrawn_at TIMESTAMPTZ,
      overall_status TEXT NOT NULL DEFAULT 'INCOMPLETE',
      last_reviewed_at TIMESTAMPTZ,
      last_reviewed_by TEXT,
      risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_kyc_profiles_status ON subscriber_kyc_profiles(overall_status);
    CREATE INDEX IF NOT EXISTS idx_kyc_profiles_service ON subscriber_kyc_profiles(service_type);

    -- Authority/LEA preservation requests override automatic retention sweeps.
    CREATE TABLE IF NOT EXISTS kyc_legal_holds (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subscriber_id UUID REFERENCES subscribers(id) ON DELETE CASCADE,
      document_id UUID REFERENCES kyc_documents(id) ON DELETE CASCADE,
      case_reference TEXT NOT NULL,
      authority TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      start_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      end_at TIMESTAMPTZ NOT NULL,
      released_at TIMESTAMPTZ,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_kyc_legal_holds_active ON kyc_legal_holds(end_at) WHERE released_at IS NULL;

    -- Evidence of what was filed in BTRC DIS/ISPMS, including acknowledgement.
    CREATE TABLE IF NOT EXISTS compliance_submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      portal TEXT NOT NULL DEFAULT 'DIS',
      report_type TEXT NOT NULL DEFAULT 'MONTHLY',
      period_label TEXT NOT NULL,
      period_start DATE,
      period_end DATE,
      file_name TEXT,
      file_path TEXT,
      checksum TEXT,
      submitted_at TIMESTAMPTZ,
      acknowledgement_ref TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      rejection_reason TEXT,
      submitted_by TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_compliance_submissions_period ON compliance_submissions(period_label, portal);

    CREATE TABLE IF NOT EXISTS inventory_warehouses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      location TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      brand TEXT,
      model TEXT,
      unit TEXT NOT NULL DEFAULT 'pcs',
      reorder_level INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(name, brand, model)
    );

    CREATE TABLE IF NOT EXISTS inventory_serials (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      warehouse_id UUID REFERENCES inventory_warehouses(id) ON DELETE SET NULL,
      serial_number TEXT NOT NULL UNIQUE,
      mac_address TEXT,
      status TEXT NOT NULL DEFAULT 'IN_STOCK',
      assigned_subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_subscribers_client_code ON subscribers(client_code);
    CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);
    CREATE INDEX IF NOT EXISTS idx_subscribers_zone ON subscribers(zone_id);
    CREATE INDEX IF NOT EXISTS idx_boxes_location ON distribution_boxes USING GIST(location);
    CREATE INDEX IF NOT EXISTS idx_subscribers_location ON subscribers USING GIST(location);
    CREATE INDEX IF NOT EXISTS idx_fiber_routes_path ON fiber_routes USING GIST(path);
  `);

  // Phase 2.1: address/location detail columns (idempotent)
  await pool.query(`
    ALTER TABLE subscribers
      ADD COLUMN IF NOT EXISTS district TEXT,
      ADD COLUMN IF NOT EXISTS thana TEXT,
      ADD COLUMN IF NOT EXISTS upazila TEXT,
      ADD COLUMN IF NOT EXISTS post_office TEXT,
      ADD COLUMN IF NOT EXISTS village TEXT,
      ADD COLUMN IF NOT EXISTS area_name TEXT,
      ADD COLUMN IF NOT EXISTS ward_no TEXT,
      ADD COLUMN IF NOT EXISTS road_no TEXT,
      ADD COLUMN IF NOT EXISTS house_no TEXT,
      ADD COLUMN IF NOT EXISTS notes TEXT;
  `);

  // FreeRADIUS SQL schema (integrated in IzanDesk DB) for real AAA
  await pool.query(`
    CREATE TABLE IF NOT EXISTS radcheck (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL DEFAULT '',
      attribute TEXT NOT NULL DEFAULT '',
      op VARCHAR(2) NOT NULL DEFAULT '==',
      value TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_radcheck_username ON radcheck(username);

    CREATE TABLE IF NOT EXISTS radreply (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL DEFAULT '',
      attribute TEXT NOT NULL DEFAULT '',
      op VARCHAR(2) NOT NULL DEFAULT '=',
      value TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_radreply_username ON radreply(username);

    CREATE TABLE IF NOT EXISTS radgroupcheck (
      id SERIAL PRIMARY KEY,
      groupname TEXT NOT NULL DEFAULT '',
      attribute TEXT NOT NULL DEFAULT '',
      op VARCHAR(2) NOT NULL DEFAULT '==',
      value TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_radgroupcheck_groupname ON radgroupcheck(groupname);

    CREATE TABLE IF NOT EXISTS radgroupreply (
      id SERIAL PRIMARY KEY,
      groupname TEXT NOT NULL DEFAULT '',
      attribute TEXT NOT NULL DEFAULT '',
      op VARCHAR(2) NOT NULL DEFAULT '=',
      value TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_radgroupreply_groupname ON radgroupreply(groupname);

    CREATE TABLE IF NOT EXISTS radusergroup (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL DEFAULT '',
      groupname TEXT NOT NULL DEFAULT '',
      priority INT NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_radusergroup_username ON radusergroup(username);

    CREATE TABLE IF NOT EXISTS radacct (
      radacctid BIGSERIAL PRIMARY KEY,
      acctsessionid TEXT NOT NULL DEFAULT '',
      acctuniqueid TEXT NOT NULL DEFAULT '',
      username TEXT,
      realm TEXT,
      nasipaddress INET,
      nasportid TEXT,
      nasporttype TEXT,
      acctstarttime TIMESTAMPTZ,
      acctupdatetime TIMESTAMPTZ,
      acctstoptime TIMESTAMPTZ,
      acctinterval BIGINT,
      acctsessiontime BIGINT,
      acctauthentic TEXT,
      connectinfo_start TEXT,
      connectinfo_stop TEXT,
      acctinputoctets BIGINT,
      acctoutputoctets BIGINT,
      calledstationid TEXT,
      callingstationid TEXT,
      acctterminatecause TEXT,
      servicetype TEXT,
      framedprotocol TEXT,
      framedipaddress INET
    );
    CREATE INDEX IF NOT EXISTS idx_radacct_username ON radacct(username);

    CREATE TABLE IF NOT EXISTS nas (
      id SERIAL PRIMARY KEY,
      nasname TEXT NOT NULL,
      shortname TEXT,
      type TEXT DEFAULT 'other',
      ports INT,
      secret TEXT NOT NULL,
      server TEXT,
      community TEXT,
      description TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_nas_nasname ON nas(nasname);

    CREATE TABLE IF NOT EXISTS radpostauth (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      pass TEXT,
      reply TEXT,
      authdate TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Phase 3: Network OSS, MikroTik, OLT, AAA
  await pool.query(`
    CREATE TABLE IF NOT EXISTS network_routers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      api_port INT NOT NULL DEFAULT 8728,
      rest_port INT,
      username TEXT NOT NULL DEFAULT 'admin',
      password TEXT,
      router_type TEXT NOT NULL DEFAULT 'MIKROTIK',
      ros_version TEXT NOT NULL DEFAULT 'v7',
      use_ssl BOOLEAN NOT NULL DEFAULT false,
      site TEXT,
      is_enabled BOOLEAN NOT NULL DEFAULT true,
      last_seen_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'UNKNOWN',
      last_error TEXT,
      cpu_load NUMERIC(5,2),
      memory_used_mb NUMERIC(12,2),
      memory_total_mb NUMERIC(12,2),
      uptime_seconds BIGINT,
      rx_bps BIGINT DEFAULT 0,
      tx_bps BIGINT DEFAULT 0,
      identity TEXT,
      board_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS bandwidth_packages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      profile_name TEXT,
      download_mbps INT NOT NULL,
      upload_mbps INT NOT NULL,
      burst_download_mbps INT,
      burst_upload_mbps INT,
      burst_threshold_download_mbps INT,
      burst_threshold_upload_mbps INT,
      burst_time_sec INT,
      priority INT DEFAULT 8,
      queue_type TEXT DEFAULT 'SIMPLE',
      price NUMERIC(12,2) DEFAULT 0,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS router_package_sync (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      router_id UUID NOT NULL REFERENCES network_routers(id) ON DELETE CASCADE,
      package_id UUID NOT NULL REFERENCES bandwidth_packages(id) ON DELETE CASCADE,
      sync_status TEXT NOT NULL DEFAULT 'PENDING',
      last_synced_at TIMESTAMPTZ,
      last_error TEXT,
      remote_ref TEXT,
      UNIQUE(router_id, package_id)
    );

    CREATE TABLE IF NOT EXISTS subscriber_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      router_id UUID REFERENCES network_routers(id) ON DELETE SET NULL,
      username TEXT NOT NULL,
      session_id TEXT,
      ip_address TEXT,
      mac_address TEXT,
      uptime_sec BIGINT DEFAULT 0,
      rx_bps BIGINT DEFAULT 0,
      tx_bps BIGINT DEFAULT 0,
      rx_bytes BIGINT DEFAULT 0,
      tx_bytes BIGINT DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'OFFLINE',
      nas_port TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(username, router_id)
    );

    CREATE TABLE IF NOT EXISTS olts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      vendor TEXT NOT NULL DEFAULT 'HUAWEI',
      model TEXT,
      host TEXT NOT NULL,
      ssh_port INT DEFAULT 23,
      snmp_port INT DEFAULT 161,
      username TEXT NOT NULL DEFAULT 'admin',
      password TEXT,
      snmp_community TEXT DEFAULT 'public',
      site TEXT,
      is_enabled BOOLEAN NOT NULL DEFAULT true,
      status TEXT NOT NULL DEFAULT 'UNKNOWN',
      last_seen_at TIMESTAMPTZ,
      temperature_c NUMERIC(6,2),
      uptime_seconds BIGINT,
      total_ports INT DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS onus (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      olt_id UUID NOT NULL REFERENCES olts(id) ON DELETE CASCADE,
      pon_port TEXT NOT NULL,
      onu_id TEXT,
      serial_number TEXT,
      name TEXT,
      subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'DISCOVERED',
      rx_power_dbm NUMERIC(6,2),
      tx_power_dbm NUMERIC(6,2),
      temperature_c NUMERIC(6,2),
      voltage_v NUMERIC(6,2),
      tx_bias_ma NUMERIC(8,2),
      distance_m INT,
      last_down_cause TEXT,
      authorized_at TIMESTAMPTZ,
      last_seen_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(olt_id, pon_port, serial_number)
    );

    CREATE TABLE IF NOT EXISTS radius_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subscriber_id UUID REFERENCES subscribers(id) ON DELETE CASCADE,
      username TEXT NOT NULL UNIQUE,
      password TEXT,
      profile TEXT,
      framed_ip_address TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      last_synced_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS coa_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      username TEXT NOT NULL,
      router_id UUID REFERENCES network_routers(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      attributes JSONB,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      response_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      executed_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_username ON subscriber_sessions(username);
    CREATE INDEX IF NOT EXISTS idx_onus_olt ON onus(olt_id);
    CREATE INDEX IF NOT EXISTS idx_onus_status ON onus(status);
  `);

  // Phase 3.3: ONU MAC/identity enrichment (VSOL/V1600D and other OLTs)
  await pool.query(`
    ALTER TABLE onus ADD COLUMN IF NOT EXISTS mac_address TEXT;
    ALTER TABLE onus ADD COLUMN IF NOT EXISTS temperature_c NUMERIC(6,2);
    ALTER TABLE onus ADD COLUMN IF NOT EXISTS voltage_v NUMERIC(6,2);
    ALTER TABLE onus ADD COLUMN IF NOT EXISTS tx_bias_ma NUMERIC(8,2);
  `);

  // ONU → Inventory auto-import ("the trick"): back-reference on ONU + source tag on serials
  await pool.query(`
    ALTER TABLE onus ADD COLUMN IF NOT EXISTS inventory_serial_id UUID REFERENCES inventory_serials(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_onus_inventory_serial ON onus(inventory_serial_id);
    ALTER TABLE inventory_serials ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'MANUAL';
    CREATE INDEX IF NOT EXISTS idx_inventory_serials_source ON inventory_serials(source);
  `);

  // Phase 3.2: WireGuard hub-and-spoke overlay (for NAT/CGNAT sites and OLTs behind routers)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wg_hub_config (
      id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      enabled BOOLEAN NOT NULL DEFAULT false,
      interface_name TEXT NOT NULL DEFAULT 'wg0',
      listen_port INT NOT NULL DEFAULT 51820,
      endpoint_host TEXT,
      endpoint_port INT NOT NULL DEFAULT 51820,
      hub_address TEXT NOT NULL DEFAULT '10.77.0.1/16',
      overlay_cidr TEXT NOT NULL DEFAULT '10.77.0.0/16',
      private_key TEXT,
      public_key TEXT,
      dns_servers TEXT,
      mtu INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS wg_peers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      router_id UUID REFERENCES network_routers(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      site_name TEXT,
      tunnel_ip TEXT NOT NULL,
      allowed_ips TEXT[] NOT NULL DEFAULT '{}',
      public_key TEXT,
      private_key TEXT,
      preshared_key TEXT,
      keepalive_sec INT NOT NULL DEFAULT 25,
      status TEXT NOT NULL DEFAULT 'PENDING',
      provision_mode TEXT NOT NULL DEFAULT 'AUTO',
      last_handshake_at TIMESTAMPTZ,
      rx_bytes BIGINT DEFAULT 0,
      tx_bytes BIGINT DEFAULT 0,
      remote_endpoint TEXT,
      last_error TEXT,
      notes TEXT,
      olt_mgmt_cidrs TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_wg_peers_router_id ON wg_peers(router_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wg_peers_tunnel_ip ON wg_peers(tunnel_ip);
  `);

  // Cross-table columns are added after both tables exist so a fresh database
  // can bootstrap without depending on a pre-existing schema snapshot.
  await pool.query(`ALTER TABLE network_routers ADD COLUMN IF NOT EXISTS wg_peer_id UUID REFERENCES wg_peers(id) ON DELETE SET NULL;`);
  await pool.query(`ALTER TABLE olts ADD COLUMN IF NOT EXISTS wg_peer_id UUID REFERENCES wg_peers(id) ON DELETE SET NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_olts_wg_peer_id ON olts(wg_peer_id);`);

  // Phase 3.1: dual-mode provisioning (API/REST direct router vs RADIUS pool)
  await pool.query(`
    ALTER TABLE network_routers
      ADD COLUMN IF NOT EXISTS integration_mode TEXT NOT NULL DEFAULT 'API',
      ADD COLUMN IF NOT EXISTS radius_secret TEXT,
      ADD COLUMN IF NOT EXISTS coa_port INT DEFAULT 3799,
      ADD COLUMN IF NOT EXISTS nas_identifier TEXT;
  `);
  await pool.query(`ALTER TABLE network_routers ALTER COLUMN api_port DROP NOT NULL;`).catch(() => {});
  await pool.query(`ALTER TABLE network_routers ADD COLUMN IF NOT EXISTS last_error TEXT;`);
  await pool.query(`
    ALTER TABLE subscribers
      ADD COLUMN IF NOT EXISTS provisioning_mode TEXT NOT NULL DEFAULT 'RADIUS',
      ADD COLUMN IF NOT EXISTS router_id UUID REFERENCES network_routers(id) ON DELETE SET NULL;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_subscribers_router_id ON subscribers(router_id);`);

  await pool.query(`INSERT INTO wg_hub_config(id) VALUES(1) ON CONFLICT (id) DO NOTHING`);

  // seed Phase 3 sample data
  const rcount = await pool.query('SELECT COUNT(*)::int AS c FROM network_routers');
  if (rcount.rows[0].c === 0) {
    await pool.query(`INSERT INTO network_routers(name,host,api_port,rest_port,username,password,router_type,ros_version,site,status,cpu_load,memory_used_mb,memory_total_mb,uptime_seconds,rx_bps,tx_bps,identity,board_name,last_seen_at,integration_mode,radius_secret,coa_port,nas_identifier)
      VALUES
      ('Core-Router-Mirpur','103.150.24.1',8728,443,'admin','changeme','MIKROTIK','v7','Mirpur POP','ONLINE',18.5,512,2048,864000,520000000,180000000,'MIRPUR-CCR2004','CCR2004-1G-12S+2XS',now(),'API',NULL,3799,NULL),
      ('Edge-Router-Dhanmondi','103.150.24.2',8728,443,'admin','changeme','MIKROTIK','v7','Dhanmondi POP','ONLINE',32.0,768,2048,432000,340000000,120000000,'DHANMONDI-CCR1009','CCR1009-7G-1C-1S+',now(),'REST',NULL,3799,NULL),
      ('RADIUS-NAS-Mirpur','103.150.24.10',NULL,NULL,'','','MIKROTIK','v7','Mirpur POP','ONLINE',12.0,256,2048,864000,220000000,90000000,'NAS-MIRPUR-01','CCR1009',now(),'RADIUS','radiusSecret@mirpur',3799,'nas-mirpur-01')`);
  } else {
    // backfill existing routers as API mode if null/empty
    await pool.query(`UPDATE network_routers SET integration_mode='API' WHERE integration_mode IS NULL OR integration_mode=''`);
  }
  const pcount = await pool.query('SELECT COUNT(*)::int AS c FROM bandwidth_packages');
  if (pcount.rows[0].c === 0) {
    await pool.query(`INSERT INTO bandwidth_packages(name,profile_name,download_mbps,upload_mbps,burst_download_mbps,burst_upload_mbps,burst_threshold_download_mbps,burst_threshold_upload_mbps,burst_time_sec,priority,queue_type,price,description)
      VALUES
      ('Home 20 Mbps','pppoe-20m',20,20,25,25,15,15,10,8,'SIMPLE',500,'Starter home package'),
      ('Home 50 Mbps','pppoe-50m',50,50,60,60,35,35,12,8,'SIMPLE',800,'Popular home package'),
      ('Corporate 100 Mbps CIR','cir-100m',100,100,NULL,NULL,NULL,NULL,NULL,1,'QUEUE_TREE',5000,'Dedicated corporate CIR')`);
  }
  const ocount = await pool.query('SELECT COUNT(*)::int AS c FROM olts');
  if (ocount.rows[0].c === 0) {
    await pool.query(`INSERT INTO olts(name,vendor,model,host,ssh_port,snmp_port,username,password,snmp_community,site,status,temperature_c,uptime_seconds,total_ports,last_seen_at)
      VALUES
      ('OLT-Mirpur-01','HUAWEI','MA5800-X2','10.10.10.2',23,161,'admin','changeme','public','Mirpur Exchange','ONLINE',42.5,1728000,16,now()),
      ('OLT-Dhanmondi-01','BDCOM','GP3600-08B','10.10.20.2',23,161,'admin','changeme','public','Dhanmondi Exchange','ONLINE',39.0,950400,8,now())`);
  }

  // seed minimal data if empty
  const areas = await pool.query('SELECT COUNT(*)::int AS c FROM areas');
  if (areas.rows[0].c === 0) {
    const a1 = await pool.query("INSERT INTO areas(name) VALUES('Mirpur') RETURNING id");
    const a2 = await pool.query("INSERT INTO areas(name) VALUES('Dhanmondi') RETURNING id");
    const z1 = await pool.query('INSERT INTO zones(area_id,name) VALUES($1,$2) RETURNING id', [a1.rows[0].id, 'Section 10']);
    const z2 = await pool.query('INSERT INTO zones(area_id,name) VALUES($1,$2) RETURNING id', [a1.rows[0].id, 'Section 11']);
    const z3 = await pool.query('INSERT INTO zones(area_id,name) VALUES($1,$2) RETURNING id', [a2.rows[0].id, 'Road 27']);
    await pool.query(`INSERT INTO distribution_boxes(zone_id,name,code,box_type,capacity_ports,latitude,longitude,location,address)
      VALUES ($1,'TJ-MIR-01','TJ-MIR-01','TJ',8,23.8069,90.3687,ST_SetSRID(ST_MakePoint(90.3687,23.8069),4326)::geography,'Mirpur Section 10'),
             ($2,'TJ-MIR-02','TJ-MIR-02','Splitter',16,23.8121,90.3655,ST_SetSRID(ST_MakePoint(90.3655,23.8121),4326)::geography,'Mirpur Section 11'),
             ($3,'TJ-DHN-01','TJ-DHN-01','TJ',8,23.7465,90.3760,ST_SetSRID(ST_MakePoint(90.3760,23.7465),4326)::geography,'Dhanmondi Road 27')`, [z1.rows[0].id, z2.rows[0].id, z3.rows[0].id]);
    await pool.query("INSERT INTO inventory_warehouses(name,location) VALUES('Main Warehouse','Dhaka HQ'),('Field Store - Mirpur','Mirpur')");
    await pool.query("INSERT INTO inventory_items(name,category,brand,model,unit,reorder_level) VALUES('XPON ONU','ONT','VSOL','V2801SE','pcs',10),('Fiber Patch Cord','Fiber','Generic','SC-UPC 3m','pcs',50),('Router','Router','MikroTik','hAP ax2','pcs',5)");
  }

  // Phase 4: Billing, Due Policies, Payment Gateways, Wallets, Walled Garden
  await pool.query(`
    ALTER TABLE subscribers
      ADD COLUMN IF NOT EXISTS billing_cycle_day INT DEFAULT 1,
      ADD COLUMN IF NOT EXISTS billing_anchor DATE,
      ADD COLUMN IF NOT EXISTS next_bill_date DATE,
      ADD COLUMN IF NOT EXISTS expiry_date DATE,
      ADD COLUMN IF NOT EXISTS due_date DATE,
      ADD COLUMN IF NOT EXISTS grace_until TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS suspension_stage TEXT DEFAULT 'NONE',
      ADD COLUMN IF NOT EXISTS walled_garden BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS auto_suspend_enabled BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS last_billed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS current_due NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS balance NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS reseller_id UUID,
      ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
      ADD COLUMN IF NOT EXISTS suspension_source TEXT NOT NULL DEFAULT 'POLICY';
    UPDATE subscribers SET suspension_source='MANUAL' WHERE suspension_reason ILIKE 'Manual%';

    CREATE TABLE IF NOT EXISTS billing_policies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      grace_days INT NOT NULL DEFAULT 7,
      warning_days INT NOT NULL DEFAULT 3,
      auto_suspend BOOLEAN NOT NULL DEFAULT true,
      isolate_on_suspend BOOLEAN NOT NULL DEFAULT true,
      enable_walled_garden BOOLEAN NOT NULL DEFAULT true,
      walled_garden_profile TEXT,
      late_fee_enabled BOOLEAN NOT NULL DEFAULT false,
      late_fee_amount NUMERIC(12,2) DEFAULT 0,
      late_fee_percent NUMERIC(6,2) DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'BDT',
      is_default BOOLEAN NOT NULL DEFAULT false,
      config JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_number TEXT NOT NULL UNIQUE,
      subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      client_code TEXT,
      subscriber_name TEXT,
      username TEXT,
      billing_cycle TEXT,
      bill_month TEXT,
      period_start DATE,
      period_end DATE,
      issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
      due_date DATE,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      discount NUMERIC(12,2) NOT NULL DEFAULT 0,
      tax NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      due_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'UNPAID',
      notes TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      prorated BOOLEAN NOT NULL DEFAULT false,
      prorate_ratio NUMERIC(8,6),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      item_type TEXT NOT NULL DEFAULT 'PACKAGE',
      quantity INT NOT NULL DEFAULT 1,
      unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      metadata JSONB DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      payment_ref TEXT NOT NULL UNIQUE,
      invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
      subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      gateway TEXT NOT NULL,
      method TEXT,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'BDT',
      status TEXT NOT NULL DEFAULT 'PENDING',
      trx_id TEXT,
      payer_number TEXT,
      payer_info JSONB DEFAULT '{}'::jsonb,
      gateway_response JSONB DEFAULT '{}'::jsonb,
      checkout_url TEXT,
      client_secret TEXT,
      idempotency_key TEXT,
      verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      reseller_id UUID,
      type TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      balance_after NUMERIC(12,2) DEFAULT 0,
      reference_id TEXT,
      reference_type TEXT,
      description TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS payment_gateway_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      gateway TEXT NOT NULL UNIQUE,
      enabled BOOLEAN NOT NULL DEFAULT false,
      mode TEXT NOT NULL DEFAULT 'SANDBOX',
      config JSONB DEFAULT '{}'::jsonb,
      credentials JSONB DEFAULT '{}'::jsonb,
      webhook_secret TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS payment_webhook_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      gateway TEXT NOT NULL,
      event_id TEXT,
      dedupe_key TEXT,
      payload JSONB,
      processed BOOLEAN NOT NULL DEFAULT false,
      processed_at TIMESTAMPTZ,
      result JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE payment_webhook_events ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_type TEXT;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS collector_name TEXT;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'APPROVED';
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS approval_note TEXT;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'INVOICE_PAYMENT';
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES bandwidth_packages(id) ON DELETE SET NULL;

    CREATE TABLE IF NOT EXISTS payment_sms_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      gateway TEXT NOT NULL DEFAULT 'bkash',
      sender TEXT,
      message TEXT,
      trx_id TEXT,
      amount NUMERIC(12,2),
      payer_number TEXT,
      matched_payment_ref TEXT,
      matched_invoice_id UUID,
      status TEXT NOT NULL DEFAULT 'RECEIVED',
      payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      processed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS billing_scheduler_locks (
      name TEXT PRIMARY KEY,
      locked_until TIMESTAMPTZ NOT NULL,
      holder TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS scheduler_job_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'RUNNING',
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ,
      duration_ms INTEGER,
      details JSONB DEFAULT '{}'::jsonb,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scheduler_job_runs_name_started ON scheduler_job_runs(job_name, started_at DESC);

    CREATE TABLE IF NOT EXISTS billing_suspension_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      stage TEXT,
      reason TEXT,
      details JSONB DEFAULT '{}'::jsonb,
      triggered_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_invoices_subscriber_id ON invoices(subscriber_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
    CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
    CREATE INDEX IF NOT EXISTS idx_payments_subscriber_id ON payments(subscriber_id);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
    CREATE INDEX IF NOT EXISTS idx_payments_payment_ref ON payments(payment_ref);
    CREATE INDEX IF NOT EXISTS idx_payments_trx_id ON payments(trx_id);
    CREATE INDEX IF NOT EXISTS idx_wallet_tx_subscriber_id ON wallet_transactions(subscriber_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_webhook_gateway_event ON payment_webhook_events(gateway, event_id) WHERE event_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_webhook_dedupe ON payment_webhook_events(dedupe_key) WHERE dedupe_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_payment_sms_trx ON payment_sms_events(trx_id);

    INSERT INTO billing_policies(name, grace_days, warning_days, auto_suspend, isolate_on_suspend, enable_walled_garden, is_default)
      VALUES('Default ISP Policy', 7, 3, true, true, true, true)
      ON CONFLICT (name) DO NOTHING;

    INSERT INTO payment_gateway_configs(gateway, enabled, mode, config)
      VALUES
        ('bkash', false, 'SANDBOX', '{"supports":"tokenized_checkout,personal_mfs_sms"}'::jsonb),
        ('nagad', false, 'SANDBOX', '{"type":"merchant_pgw"}'::jsonb),
        ('rocket', false, 'SANDBOX', '{"type":"merchant_pgw"}'::jsonb),
        ('stripe', false, 'SANDBOX', '{"supports":"cards,apple_pay,google_pay,elements"}'::jsonb),
        ('paypal', false, 'SANDBOX', '{"supports":"smart_buttons"}'::jsonb)
      ON CONFLICT (gateway) DO NOTHING;
  `).catch(e => console.error('[DB] Phase 4 schema extension error', e.message));

  // Uniqueness is applied separately so legacy duplicate rows cannot abort the
  // rest of the migration. Existing deployments with duplicates retain the old
  // non-unique indexes and a warning; new rows are still guarded in application code.
  for (const statement of [
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_gateway_trx ON payments(gateway, trx_id) WHERE trx_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_idempotency ON payments(idempotency_key) WHERE idempotency_key IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_sms_gateway_trx ON payment_sms_events(gateway, trx_id) WHERE trx_id IS NOT NULL`,
  ]) {
    await pool.query(statement).catch((e: any) => console.warn('[DB] payment idempotency index skipped:', e.message));
  }

  // Durable enforcement outbox: entitlement changes and the work required to
  // project them to RADIUS/MikroTik commit together. A worker retries failures
  // so a router/CoA outage cannot leave the database ACTIVE but the network blocked.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS enforcement_outbox (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'PENDING',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_enforcement_outbox_due ON enforcement_outbox(status, next_attempt_at);
  `).catch((e: any) => console.warn('[DB] enforcement outbox skipped:', e.message));

  await pool.query(`ALTER TABLE bandwidth_packages ADD COLUMN IF NOT EXISTS data_cap_gb NUMERIC(12,2)`).catch(()=>{});
  await pool.query(`ALTER TABLE bandwidth_packages ADD COLUMN IF NOT EXISTS fup_speed_mbps INTEGER`).catch(()=>{});
  await pool.query(`ALTER TABLE bandwidth_packages ADD COLUMN IF NOT EXISTS validity_value INTEGER`).catch(()=>{});
  await pool.query(`ALTER TABLE bandwidth_packages ADD COLUMN IF NOT EXISTS validity_unit TEXT`).catch(()=>{});
  await pool.query(`ALTER TABLE bandwidth_packages ALTER COLUMN download_mbps DROP NOT NULL`).catch(()=>{});
  await pool.query(`ALTER TABLE bandwidth_packages ALTER COLUMN upload_mbps DROP NOT NULL`).catch(()=>{});

  await pool.query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS fup_exceeded BOOLEAN NOT NULL DEFAULT false`).catch(()=>{});
  await pool.query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS fup_applied_at TIMESTAMPTZ`).catch(()=>{});
  await pool.query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS fup_exempt BOOLEAN NOT NULL DEFAULT false`).catch(()=>{});
  await pool.query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS price_override NUMERIC(12,2)`).catch(()=>{});
  await pool.query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS custom_package_note TEXT`).catch(()=>{});
  await pool.query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS extended_expiry BOOLEAN NOT NULL DEFAULT false`).catch(()=>{});
  await pool.query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS branch_name TEXT`).catch(()=>{});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fup_enforcement_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      over_cap BOOLEAN,
      used_bytes BIGINT,
      cap_gb NUMERIC(12,2),
      fup_speed_mbps INTEGER,
      details JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fup_logs_sub ON fup_enforcement_logs(subscriber_id, created_at DESC)`).catch(()=>{});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS saved_payment_methods (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
      gateway TEXT NOT NULL,
      label TEXT,
      token_ref TEXT,
      masked_identifier TEXT,
      is_default BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_saved_pm_sub ON saved_payment_methods(subscriber_id, created_at DESC)`).catch(()=>{});

  // Portal self-care preferences
  await pool.query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS auto_pay_enabled BOOLEAN NOT NULL DEFAULT false`).catch(()=>{});
  await pool.query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS preferred_gateway TEXT`).catch(()=>{});

  // Phase 5: Resellers, Wallet, CRM/Tickets, Messaging
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resellers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      company_name TEXT,
      tier TEXT NOT NULL DEFAULT 'STANDARD',
      parent_reseller_id UUID REFERENCES resellers(id) ON DELETE SET NULL,
      email TEXT,
      phone TEXT,
      subdomain TEXT UNIQUE,
      custom_domain TEXT,
      brand_name TEXT,
      logo_url TEXT,
      primary_color TEXT,
      secondary_color TEXT,
      portal_title TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      wallet_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
      credit_limit NUMERIC(12,2) NOT NULL DEFAULT 0,
      commission_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
      buying_margin_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
      address TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS reseller_wallet_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reseller_id UUID NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'CREDIT',
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      balance_after NUMERIC(12,2) NOT NULL DEFAULT 0,
      reference_type TEXT,
      reference_id TEXT,
      subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      description TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_no TEXT UNIQUE,
      subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      reseller_id UUID REFERENCES resellers(id) ON DELETE SET NULL,
      subject TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'SUPPORT',
      priority TEXT NOT NULL DEFAULT 'MEDIUM',
      status TEXT NOT NULL DEFAULT 'OPEN',
      sla_policy TEXT,
      sla_due_at TIMESTAMPTZ,
      sla_breached BOOLEAN NOT NULL DEFAULT false,
      assigned_technician_id TEXT,
      assigned_technician_name TEXT,
      assigned_technician_phone TEXT,
      dispatch_status TEXT DEFAULT 'UNASSIGNED',
      site_latitude DOUBLE PRECISION,
      site_longitude DOUBLE PRECISION,
      site_address TEXT,
      gps_nav_url TEXT,
      resolution_notes TEXT,
      source TEXT DEFAULT 'PORTAL',
      opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_at TIMESTAMPTZ,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ticket_comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      author_name TEXT,
      author_role TEXT,
      body TEXT NOT NULL,
      is_internal BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS messaging_channels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      channel_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT false,
      is_default BOOLEAN NOT NULL DEFAULT false,
      config JSONB DEFAULT '{}'::jsonb,
      credentials JSONB DEFAULT '{}'::jsonb,
      webhook_secret TEXT,
      sender_id TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(channel_type, provider, name)
    );

    CREATE TABLE IF NOT EXISTS message_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      channel_type TEXT NOT NULL,
      purpose TEXT,
      subject TEXT,
      body TEXT NOT NULL,
      variables JSONB DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(name, channel_type)
    );

    CREATE TABLE IF NOT EXISTS message_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel_type TEXT NOT NULL,
      provider TEXT,
      channel_id UUID REFERENCES messaging_channels(id) ON DELETE SET NULL,
      direction TEXT NOT NULL DEFAULT 'OUTBOUND',
      recipient TEXT,
      subject TEXT,
      body TEXT,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      provider_message_id TEXT,
      related_type TEXT,
      related_id TEXT,
      payload JSONB DEFAULT '{}'::jsonb,
      error_message TEXT,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS reseller_id UUID REFERENCES resellers(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_resellers_subdomain ON resellers(subdomain);
    CREATE INDEX IF NOT EXISTS idx_resellers_parent ON resellers(parent_reseller_id);
    CREATE INDEX IF NOT EXISTS idx_reseller_wallet_tx_reseller ON reseller_wallet_transactions(reseller_id);
    CREATE INDEX IF NOT EXISTS idx_subscribers_reseller ON subscribers(reseller_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON tickets(assigned_technician_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_reseller ON tickets(reseller_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_subscriber ON tickets(subscriber_id);
    CREATE INDEX IF NOT EXISTS idx_message_logs_status ON message_logs(status);
    CREATE INDEX IF NOT EXISTS idx_message_logs_channel ON message_logs(channel_type, provider);

    INSERT INTO resellers(code, name, company_name, tier, subdomain, brand_name, portal_title, status, wallet_balance, commission_percent, buying_margin_percent, email, phone)
      VALUES
        ('RES-CYBERNET', 'CyberNet Reseller', 'CyberNet Broadband', 'GOLD', 'cybernet', 'CyberNet ISP', 'CyberNet Reseller Portal', 'ACTIVE', 50000, 10, 15, 'reseller@cybernet.bd', '+8801700000005'),
        ('RES-DHAKA-NET', 'Dhaka Net Partner', 'Dhaka Net Services', 'SILVER', 'dhakanet', 'Dhaka Net', 'Dhaka Net Partner Portal', 'ACTIVE', 15000, 8, 12, 'partner@dhakanet.bd', '+8801700000099')
      ON CONFLICT (code) DO NOTHING;

    INSERT INTO messaging_channels(name, channel_type, provider, enabled, is_default, config)
      VALUES
        ('BD Local SMS (GreenWeb)', 'SMS', 'GREENWEB', false, true, '{"country":"BD","mode":"LOCAL"}'::jsonb),
        ('Twilio SMS (International)', 'SMS', 'TWILIO', false, false, '{"mode":"INTERNATIONAL"}'::jsonb),
        ('WhatsApp Business API', 'WHATSAPP', 'META_CLOUD', false, true, '{"supports":"invoice_pdf,templates"}'::jsonb),
        ('Telegram Bot', 'TELEGRAM', 'TELEGRAM_BOT', false, true, '{"supports":"noc_alerts,daily_revenue_summary"}'::jsonb)
      ON CONFLICT DO NOTHING;

    INSERT INTO message_templates(name, channel_type, purpose, subject, body, variables)
      VALUES
        ('invoice_due_reminder_sms', 'SMS', 'INVOICE_REMINDER', NULL, 'Dear {{name}}, your invoice {{invoice_no}} amount {{amount}} is due on {{due_date}}. Please pay to avoid service interruption. - {{brand}}', '["name","invoice_no","amount","due_date","brand"]'::jsonb),
        ('payment_received_sms', 'SMS', 'PAYMENT_RECEIVED', NULL, 'Payment received: {{amount}} for {{invoice_no}} ({{trx_id}}). Thank you. - {{brand}}', '["amount","invoice_no","trx_id","brand"]'::jsonb),
        ('invoice_delivery_whatsapp', 'WHATSAPP', 'INVOICE_DELIVERY', 'Invoice {{invoice_no}}', 'Hello {{name}}, your invoice {{invoice_no}} ({{amount}}) is ready. Due date: {{due_date}}. Invoice PDF: {{pdf_url}}', '["name","invoice_no","amount","due_date","pdf_url"]'::jsonb),
        ('noc_alert_telegram', 'TELEGRAM', 'NOC_ALERT', NULL, '🚨 {{severity}} · {{source}}\n{{title}}\n{{details}}\nTime: {{time}}', '["severity","source","title","details","time"]'::jsonb),
        ('daily_revenue_summary_telegram', 'TELEGRAM', 'DAILY_REVENUE_SUMMARY', NULL, '📊 Daily Revenue Summary ({{date}})\nCollections: {{collections}}\nInvoices: {{invoices}}\nDue Outstanding: {{outstanding}}', '["date","collections","invoices","outstanding"]'::jsonb)
      ON CONFLICT DO NOTHING;
  `).catch(e => console.error('[DB] Phase 5 schema extension error', e.message));

  // subscribers.reseller_id was introduced in an earlier block without a
  // foreign key, so the later ADD COLUMN IF NOT EXISTS ... REFERENCES was a
  // no-op. Add the constraint explicitly, but skip it if legacy orphan rows
  // exist so a fresh migration never wipes a working deployment.
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_subscribers_reseller_id')
         AND NOT EXISTS (
           SELECT 1 FROM subscribers s
           WHERE s.reseller_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM resellers r WHERE r.id = s.reseller_id)
         ) THEN
        ALTER TABLE subscribers ADD CONSTRAINT fk_subscribers_reseller_id
          FOREIGN KEY (reseller_id) REFERENCES resellers(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `).catch((e: any) => console.warn('[DB] subscribers.reseller_id FK skipped:', e.message));

  // Depends on resellers, so it is created after the Phase 5 block above.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reseller_share_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reseller_id UUID NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
      subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      payment_ref TEXT,
      wallet_transaction_id UUID,
      retail_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      partner_share NUMERIC(12,2) NOT NULL DEFAULT 0,
      isp_share NUMERIC(12,2) NOT NULL DEFAULT 0,
      margin_percent NUMERIC(8,2) NOT NULL DEFAULT 0,
      package_name TEXT,
      period_month DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      metadata JSONB DEFAULT '{}'::jsonb
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_reseller_share_entries_reseller ON reseller_share_entries(reseller_id, created_at DESC)`);

  // Phase 7: Finance, HRM, Procurement/Assets, Hotspot, Reporting & Audit foundations
  await pool.query(`
    -- Accounts & Finance
    CREATE TABLE IF NOT EXISTS finance_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'ASSET', -- ASSET, LIABILITY, EQUITY, INCOME, EXPENSE
      parent_id UUID REFERENCES finance_accounts(id) ON DELETE SET NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS finance_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      txn_date DATE NOT NULL DEFAULT CURRENT_DATE,
      txn_type TEXT NOT NULL, -- INCOME, EXPENSE, TRANSFER, COLLECTION, PAYMENT, ADJUSTMENT
      account_id UUID REFERENCES finance_accounts(id) ON DELETE SET NULL,
      counter_account_id UUID REFERENCES finance_accounts(id) ON DELETE SET NULL,
      method TEXT, -- CASH, BANK, BKASH, NAGAD, ROCKET, CARD, OTHER
      amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'BDT',
      reference_type TEXT, -- INVOICE, PAYMENT, PURCHASE, PAYROLL, VOUCHER, MANUAL
      reference_id TEXT,
      subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      reseller_id UUID REFERENCES resellers(id) ON DELETE SET NULL,
      vendor_id UUID,
      employee_id UUID,
      description TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS finance_vouchers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      voucher_no TEXT UNIQUE,
      voucher_type TEXT NOT NULL, -- RECEIPT, PAYMENT, JOURNAL
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      party_type TEXT,
      party_id TEXT,
      amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      method TEXT,
      narration TEXT,
      status TEXT NOT NULL DEFAULT 'POSTED',
      lines JSONB DEFAULT '[]'::jsonb,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- HRM & Payroll
    CREATE TABLE IF NOT EXISTS hr_employees (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_code TEXT UNIQUE,
      full_name TEXT NOT NULL,
      designation TEXT,
      department TEXT,
      role TEXT,
      phone TEXT,
      email TEXT,
      nid_number TEXT,
      address TEXT,
      joining_date DATE,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      base_salary NUMERIC(14,2) NOT NULL DEFAULT 0,
      commission_percent NUMERIC(8,2) NOT NULL DEFAULT 0,
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS hr_attendance (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id UUID NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
      att_date DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'PRESENT', -- PRESENT, ABSENT, LEAVE, HALF_DAY
      check_in TIMESTAMPTZ,
      check_out TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(employee_id, att_date)
    );

    CREATE TABLE IF NOT EXISTS hr_payroll_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      period_month TEXT NOT NULL, -- YYYY-MM
      status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT, POSTED, PAID
      total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      notes TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      posted_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS hr_payroll_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      payroll_run_id UUID NOT NULL REFERENCES hr_payroll_runs(id) ON DELETE CASCADE,
      employee_id UUID NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
      base_salary NUMERIC(14,2) NOT NULL DEFAULT 0,
      commission NUMERIC(14,2) NOT NULL DEFAULT 0,
      bonus NUMERIC(14,2) NOT NULL DEFAULT 0,
      deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
      net_pay NUMERIC(14,2) NOT NULL DEFAULT 0,
      notes TEXT
    );

    -- Procurement & Assets
    CREATE TABLE IF NOT EXISTS vendors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      company_name TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      category TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      purchase_no TEXT UNIQUE,
      vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
      warehouse_id UUID REFERENCES inventory_warehouses(id) ON DELETE SET NULL,
      purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
      status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT, RECEIVED, BILLED, PAID, CANCELLED
      subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
      tax NUMERIC(14,2) NOT NULL DEFAULT 0,
      total NUMERIC(14,2) NOT NULL DEFAULT 0,
      notes TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      item_name TEXT NOT NULL,
      category TEXT,
      sku TEXT,
      qty NUMERIC(12,2) NOT NULL DEFAULT 1,
      unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
      total_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
      inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      asset_tag TEXT UNIQUE,
      name TEXT NOT NULL,
      category TEXT,
      vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
      purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
      purchase_date DATE,
      cost NUMERIC(14,2) NOT NULL DEFAULT 0,
      current_value NUMERIC(14,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, MAINTENANCE, RETIRED, DISPOSED
      location TEXT,
      assigned_to_employee_id UUID REFERENCES hr_employees(id) ON DELETE SET NULL,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Hotspot / Vouchers
    CREATE TABLE IF NOT EXISTS hotspot_vouchers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      batch_no TEXT,
      code TEXT NOT NULL UNIQUE,
      plan_name TEXT,
      package_name TEXT,
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      duration_hours INT,
      data_limit_mb INT,
      status TEXT NOT NULL DEFAULT 'AVAILABLE', -- AVAILABLE, SOLD, ACTIVE, USED, EXPIRED, CANCELLED
      subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      reseller_id UUID REFERENCES resellers(id) ON DELETE SET NULL,
      sold_at TIMESTAMPTZ,
      activated_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Field / Agent workflows
    CREATE TABLE IF NOT EXISTS field_activities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      activity_type TEXT NOT NULL, -- COLLECTION, VISIT, INSTALLATION, SUPPORT, TICKET
      employee_id UUID REFERENCES hr_employees(id) ON DELETE SET NULL,
      subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
      reseller_id UUID REFERENCES resellers(id) ON DELETE SET NULL,
      scheduled_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'PLANNED', -- PLANNED, IN_PROGRESS, DONE, CANCELLED
      amount NUMERIC(14,2),
      proof_ref TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Audit logs
    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_id TEXT,
      actor_name TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details JSONB DEFAULT '{}'::jsonb,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Settings & Security: schema-driven key/value store (key = "<category>.<field>")
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);

    CREATE INDEX IF NOT EXISTS idx_fin_txn_date ON finance_transactions(txn_date DESC);
    CREATE INDEX IF NOT EXISTS idx_fin_txn_type ON finance_transactions(txn_type);
    CREATE INDEX IF NOT EXISTS idx_fin_txn_account ON finance_transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_hr_att_date ON hr_attendance(att_date);
    CREATE INDEX IF NOT EXISTS idx_hr_att_emp ON hr_attendance(employee_id);
    CREATE INDEX IF NOT EXISTS idx_purchases_vendor ON purchases(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
    CREATE INDEX IF NOT EXISTS idx_vouchers_status ON hotspot_vouchers(status);
    CREATE INDEX IF NOT EXISTS idx_vouchers_code ON hotspot_vouchers(code);
    CREATE INDEX IF NOT EXISTS idx_field_activities_status ON field_activities(status);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

    INSERT INTO finance_accounts(code,name,type) VALUES
      ('1000','Cash','ASSET'),
      ('1010','Bank','ASSET'),
      ('1020','bKash/MFS','ASSET'),
      ('4000','Service Revenue','INCOME'),
      ('4010','Installation/Other Income','INCOME'),
      ('5000','Operating Expense','EXPENSE'),
      ('5010','Salary Expense','EXPENSE'),
      ('5020','Network/Utility Expense','EXPENSE')
    ON CONFLICT (code) DO NOTHING;
  `).catch(e => console.error('[DB] Phase 7 schema extension error', e.message));

  // Phase 7+ completeness extensions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hr_leaves (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id UUID NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
      leave_type TEXT NOT NULL DEFAULT 'CASUAL',
      from_date DATE NOT NULL,
      to_date DATE NOT NULL,
      days NUMERIC(6,2) NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED, CANCELLED
      reason TEXT,
      approved_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS finance_journal_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entry_no TEXT UNIQUE,
      entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
      description TEXT,
      source_type TEXT,
      source_id TEXT,
      posted BOOLEAN NOT NULL DEFAULT true,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS finance_journal_lines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entry_id UUID NOT NULL REFERENCES finance_journal_entries(id) ON DELETE CASCADE,
      account_id UUID REFERENCES finance_accounts(id) ON DELETE SET NULL,
      debit NUMERIC(14,2) NOT NULL DEFAULT 0,
      credit NUMERIC(14,2) NOT NULL DEFAULT 0,
      memo TEXT
    );

    CREATE TABLE IF NOT EXISTS report_schedules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      report_key TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'CSV',
      schedule_cron TEXT,
      interval_minutes INTEGER,
      recipients JSONB DEFAULT '[]'::jsonb,
      enabled BOOLEAN NOT NULL DEFAULT true,
      last_run_at TIMESTAMPTZ,
      last_status TEXT,
      config JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE report_schedules ADD COLUMN IF NOT EXISTS interval_minutes INTEGER;

    CREATE TABLE IF NOT EXISTS noc_alerts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      severity TEXT NOT NULL DEFAULT 'WARNING',
      source TEXT NOT NULL DEFAULT 'SYSTEM',
      title TEXT NOT NULL,
      message TEXT,
      details JSONB DEFAULT '{}'::jsonb,
      acknowledged BOOLEAN NOT NULL DEFAULT false,
      acknowledged_at TIMESTAMPTZ,
      acknowledged_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_noc_alerts_created ON noc_alerts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_noc_alerts_ack ON noc_alerts(acknowledged, created_at DESC);

    CREATE TABLE IF NOT EXISTS backup_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trigger TEXT NOT NULL DEFAULT 'manual',
      ok BOOLEAN NOT NULL DEFAULT false,
      file_name TEXT,
      file_size_bytes BIGINT,
      message TEXT,
      detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_backup_runs_created ON backup_runs(created_at DESC);

    ALTER TABLE assets ADD COLUMN IF NOT EXISTS depreciation_rate NUMERIC(8,4) DEFAULT 0;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS accumulated_depreciation NUMERIC(14,2) DEFAULT 0;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS last_depreciated_at TIMESTAMPTZ;
    ALTER TABLE hotspot_vouchers ADD COLUMN IF NOT EXISTS radius_synced BOOLEAN DEFAULT false;
    ALTER TABLE hotspot_vouchers ADD COLUMN IF NOT EXISTS used_bytes BIGINT DEFAULT 0;
    ALTER TABLE hotspot_vouchers ADD COLUMN IF NOT EXISTS mac_address TEXT;
    ALTER TABLE hr_payroll_items ADD COLUMN IF NOT EXISTS components JSONB DEFAULT '{}'::jsonb;

    CREATE INDEX IF NOT EXISTS idx_hr_leaves_emp ON hr_leaves(employee_id, from_date DESC);
    CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON finance_journal_lines(entry_id);
    CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON finance_journal_lines(account_id);
  `).catch(e => console.error('[DB] Phase 7+ schema extension error', e.message));

  // Phase 8: Subscriber Enhancement - Leads, Installation Orders, Equipment, Communication
  await pool.query(`
    -- Lead/Prospect Pipeline
    CREATE TABLE IF NOT EXISTS leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_no TEXT UNIQUE,
      full_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      area_id UUID REFERENCES areas(id) ON DELETE SET NULL,
      zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
      interested_package TEXT,
      source TEXT, -- WALK_IN, CALL, WEBSITE, REFERRAL, SOCIAL_MEDIA, CAMPAIGN
      status TEXT NOT NULL DEFAULT 'NEW', -- NEW, CONTACTED, QUALIFIED, PROPOSAL, WON, LOST
      priority TEXT NOT NULL DEFAULT 'MEDIUM', -- LOW, MEDIUM, HIGH
      assigned_to TEXT,
      notes TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      converted_subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS lead_activities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      activity_type TEXT NOT NULL, -- CALL, EMAIL, MEETING, WHATSAPP, SITE_VISIT, NOTE
      subject TEXT,
      description TEXT,
      outcome TEXT, -- POSITIVE, NEUTRAL, NEGATIVE, SCHEDULED
      scheduled_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Installation/Service Orders
    CREATE TABLE IF NOT EXISTS installation_orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_no TEXT UNIQUE,
      subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
      order_type TEXT NOT NULL DEFAULT 'INSTALLATION', -- INSTALLATION, REPAIR, RELOCATION, UPGRADE, DISCONNECTION, EQUIPMENT_SWAP
      status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, SCHEDULED, ASSIGNED, IN_PROGRESS, COMPLETED, CANCELLED, ON_HOLD
      priority TEXT NOT NULL DEFAULT 'NORMAL', -- LOW, NORMAL, HIGH, URGENT
      scheduled_date DATE,
      scheduled_time_start TIME,
      scheduled_time_end TIME,
      assigned_technician_id UUID REFERENCES hr_employees(id) ON DELETE SET NULL,
      assigned_technician_name TEXT,
      site_address TEXT,
      site_latitude DOUBLE PRECISION,
      site_longitude DOUBLE PRECISION,
      site_contact_name TEXT,
      site_contact_phone TEXT,
      required_equipment JSONB DEFAULT '[]'::jsonb,
      checklist JSONB DEFAULT '[]'::jsonb,
      completion_notes TEXT,
      completion_photos JSONB DEFAULT '[]'::jsonb,
      actual_start_at TIMESTAMPTZ,
      actual_end_at TIMESTAMPTZ,
      sla_due_at TIMESTAMPTZ,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS installation_checklist_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES installation_orders(id) ON DELETE CASCADE,
      item_text TEXT NOT NULL,
      is_required BOOLEAN NOT NULL DEFAULT true,
      is_completed BOOLEAN NOT NULL DEFAULT false,
      completed_at TIMESTAMPTZ,
      completed_by TEXT,
      notes TEXT,
      sort_order INT NOT NULL DEFAULT 0
    );

    -- Equipment/CPE Assignment
    CREATE TABLE IF NOT EXISTS subscriber_equipment (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
      equipment_type TEXT NOT NULL, -- ONU, ROUTER, SWITCH, AP, CPE, MODEM, SPLITTER, OTHER
      serial_number TEXT NOT NULL,
      mac_address TEXT,
      inventory_serial_id UUID REFERENCES inventory_serials(id) ON DELETE SET NULL,
      onu_id UUID REFERENCES onus(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'ASSIGNED', -- ASSIGNED, INSTALLED, FAULTY, RMA, RETURNED, RETIRED
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      installed_at TIMESTAMPTZ,
      installed_by TEXT,
      location_details TEXT, -- e.g., "Living room, wall mount"
      firmware_version TEXT,
      config_backup JSONB,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Subscriber Communication Log
    CREATE TABLE IF NOT EXISTS subscriber_communications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
      direction TEXT NOT NULL, -- INBOUND, OUTBOUND
      channel TEXT NOT NULL, -- CALL, EMAIL, SMS, WHATSAPP, TELEGRAM, IN_PERSON, PORTAL, NOTE
      subject TEXT,
      body TEXT,
      contact_person TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      related_type TEXT, -- INVOICE, PAYMENT, TICKET, ORDER, LEAD, COMPLAINT
      related_id TEXT,
      status TEXT NOT NULL DEFAULT 'COMPLETED', -- PENDING, SENT, DELIVERED, READ, FAILED, COMPLETED
      provider_message_id TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_leads_area ON leads(area_id);
    CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lead_activities_lead ON lead_activities(lead_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_installation_orders_subscriber ON installation_orders(subscriber_id);
    CREATE INDEX IF NOT EXISTS idx_installation_orders_technician ON installation_orders(assigned_technician_id);
    CREATE INDEX IF NOT EXISTS idx_installation_orders_status ON installation_orders(status);
    CREATE INDEX IF NOT EXISTS idx_installation_orders_scheduled ON installation_orders(scheduled_date);
    CREATE INDEX IF NOT EXISTS idx_installation_checklist_order ON installation_checklist_items(order_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_subscriber_equipment_sub ON subscriber_equipment(subscriber_id);
    CREATE INDEX IF NOT EXISTS idx_subscriber_equipment_serial ON subscriber_equipment(serial_number);
    CREATE INDEX IF NOT EXISTS idx_subscriber_comms_sub ON subscriber_communications(subscriber_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_subscriber_comms_channel ON subscriber_communications(channel);
  `).catch(e => console.error('[DB] Phase 8 subscriber enhancement error', e.message));

  // Phase 9: ACS / GenieACS (TR-069) device management
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acs_devices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      genieacs_id TEXT NOT NULL UNIQUE,
      subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      serial_number TEXT,
      oui TEXT,
      product_class TEXT,
      manufacturer TEXT,
      model_name TEXT,
      software_version TEXT,
      hardware_version TEXT,
      connection_request_url TEXT,
      ip_address TEXT,
      status TEXT NOT NULL DEFAULT 'UNKNOWN',
      last_inform_at TIMESTAMPTZ,
      tags JSONB DEFAULT '[]'::jsonb,
      raw_summary JSONB DEFAULT '{}'::jsonb,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_acs_devices_subscriber ON acs_devices(subscriber_id);
    CREATE INDEX IF NOT EXISTS idx_acs_devices_status ON acs_devices(status);
    CREATE INDEX IF NOT EXISTS idx_acs_devices_last_inform ON acs_devices(last_inform_at DESC NULLS LAST);

    CREATE TABLE IF NOT EXISTS acs_device_actions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      acs_device_id UUID REFERENCES acs_devices(id) ON DELETE SET NULL,
      device_id TEXT NOT NULL,
      action TEXT NOT NULL,
      task_name TEXT,
      task_id TEXT,
      payload JSONB DEFAULT '{}'::jsonb,
      result JSONB DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      error_message TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_acs_device_actions_device ON acs_device_actions(device_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_acs_device_actions_action ON acs_device_actions(action);
  `).catch(e => console.error('[DB] ACS schema error', e.message));

  // GIS governance: an append-only audit trail plus a trash bin that stores the
  // full deleted row (and its relationships) so topology deletes can be undone.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS topology_audit (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      action TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      actor_id TEXT,
      actor_email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_topology_audit_created ON topology_audit(created_at DESC);

    CREATE TABLE IF NOT EXISTS topology_trash (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      deleted_by TEXT,
      deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_topology_trash_deleted ON topology_trash(deleted_at DESC);
  `).catch(e => console.error('[DB] topology governance schema error', e.message));

  // Collision-safe ticket numbering. Both the admin ticket route and the
  // reseller complaint route use this shared sequence instead of COUNT(*)+1.
  await pool.query(`
    CREATE SEQUENCE IF NOT EXISTS ticket_no_seq START 1;
    SELECT setval('ticket_no_seq',
      COALESCE((SELECT MAX(substring(ticket_no from 5)::int) FROM tickets
                WHERE ticket_no ~ '^TKT-[0-9]+$'), 0) + 1, false);
  `).catch(e => console.error('[DB] ticket sequence error', e.message));

  // SRZone parity: richer subscriber/ONU/partner fields, branches, persisted notifications,
  // column/dashboard layouts and gateway wallet top-up requests (all idempotent).
  await pool.query(`
    ALTER TABLE subscribers
      ADD COLUMN IF NOT EXISTS external_customer_id TEXT,
      ADD COLUMN IF NOT EXISTS company_name TEXT,
      ADD COLUMN IF NOT EXISTS alt_email TEXT,
      ADD COLUMN IF NOT EXISTS alt_phone TEXT,
      ADD COLUMN IF NOT EXISTS nid_info TEXT,
      ADD COLUMN IF NOT EXISTS gps_location TEXT,
      ADD COLUMN IF NOT EXISTS division TEXT,
      ADD COLUMN IF NOT EXISTS block_no TEXT,
      ADD COLUMN IF NOT EXISTS cable_serial_no TEXT,
      ADD COLUMN IF NOT EXISTS cable_length TEXT,
      ADD COLUMN IF NOT EXISTS cable_info TEXT,
      ADD COLUMN IF NOT EXISTS onu_info TEXT,
      ADD COLUMN IF NOT EXISTS onu_owner TEXT,
      ADD COLUMN IF NOT EXISTS connection_established_by TEXT,
      ADD COLUMN IF NOT EXISTS static_ip BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS mac_lock BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS multi_session BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS bill_cycle_enabled BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS ipv6_address TEXT,
      ADD COLUMN IF NOT EXISTS ipv6_prefix TEXT,
      ADD COLUMN IF NOT EXISTS old_expiry_date DATE,
      ADD COLUMN IF NOT EXISTS excess_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS branch_id UUID,
      ADD COLUMN IF NOT EXISTS parental_control_enabled BOOLEAN NOT NULL DEFAULT false;

    ALTER TABLE onus
      ADD COLUMN IF NOT EXISTS vendor TEXT,
      ADD COLUMN IF NOT EXISTS model TEXT,
      ADD COLUMN IF NOT EXISTS slot_no TEXT,
      ADD COLUMN IF NOT EXISTS speed TEXT,
      ADD COLUMN IF NOT EXISTS optical_dbm_temp NUMERIC(8,2),
      ADD COLUMN IF NOT EXISTS user_id_match TEXT;

    ALTER TABLE resellers
      ADD COLUMN IF NOT EXISTS avatar_url TEXT,
      ADD COLUMN IF NOT EXISTS notify_expiry BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS notify_payment BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS notify_system BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS dashboard_layout JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS column_layout JSONB NOT NULL DEFAULT '{}'::jsonb;

    CREATE TABLE IF NOT EXISTS branches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reseller_id UUID REFERENCES resellers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT,
      address TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_branches_reseller ON branches(reseller_id);

    CREATE TABLE IF NOT EXISTS reseller_notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reseller_id UUID NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'SYSTEM',
      title TEXT NOT NULL,
      message TEXT,
      severity TEXT NOT NULL DEFAULT 'info',
      is_read BOOLEAN NOT NULL DEFAULT false,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      read_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_reseller_notifications ON reseller_notifications(reseller_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS wallet_topup_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reseller_id UUID NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL,
      gateway TEXT NOT NULL,
      method TEXT,
      trx_id TEXT,
      payer_number TEXT,
      notes TEXT,
      terms_accepted BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'PENDING',
      rejection_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      verified_at TIMESTAMPTZ,
      verified_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_wallet_topup_reseller ON wallet_topup_requests(reseller_id, created_at DESC);
  `).catch(e => console.error('[DB] SRZone parity schema error', e.message));

  // Portal credential is separate from the cleartext PPPoE/RADIUS secret.
  // Backfill legacy bcrypt values (which were never valid NAS passwords) and
  // clear them from the provisioning field.
  await pool.query('ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS portal_password TEXT').catch(() => {});
  await pool.query("UPDATE subscribers SET portal_password=password WHERE portal_password IS NULL AND password ~ '^\\$2[aby]\\$'").catch(() => {});
  await pool.query("UPDATE subscribers SET password=NULL WHERE password ~ '^\\$2[aby]\\$'").catch(() => {});

  // Collision-safe numbering for leads (same pattern as ticket_no_seq).
  await pool.query('CREATE SEQUENCE IF NOT EXISTS lead_no_seq').catch(() => {});
  await pool.query(`SELECT setval('lead_no_seq', GREATEST(COALESCE((SELECT MAX((substring(lead_no from '-([0-9]+)$'))::int) FROM leads), 0), 1), true)`).catch(() => {});

  // Stable client-code sequence (UUID primary keys have no serial sequence).
  // Seed it from the highest numeric suffix already present so new codes never collide.
  await pool.query('CREATE SEQUENCE IF NOT EXISTS subscriber_client_code_seq').catch(() => {});
  await pool.query(`SELECT setval('subscriber_client_code_seq', GREATEST(COALESCE((SELECT MAX((substring(client_code from '-([0-9]+)$'))::int) FROM subscribers), 0), 1), true)`).catch(() => {});

  // Staff session revocation and TOTP enrollment (security hardening).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id UUID PRIMARY KEY,
      user_id TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS user_mfa (
      user_id TEXT PRIMARY KEY,
      secret_enc TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT false,
      recovery_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
      enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      verified_at TIMESTAMPTZ,
      disabled_at TIMESTAMPTZ
    );
  `).catch(e => console.error('[DB] security schema error', e.message));
}

export { pool };


