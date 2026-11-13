import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'izandesk',
  user: process.env.DB_USER || 'izandesk_user',
  password: process.env.DB_PASSWORD || 'izandesk_secret_password',
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
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

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
      ADD COLUMN IF NOT EXISTS house_no TEXT;
  `);

  // Phase 3.1: dual-mode provisioning (API/REST direct router vs RADIUS pool)
  await pool.query(`
    ALTER TABLE network_routers
      ADD COLUMN IF NOT EXISTS integration_mode TEXT NOT NULL DEFAULT 'API',
      ADD COLUMN IF NOT EXISTS radius_secret TEXT,
      ADD COLUMN IF NOT EXISTS coa_port INT DEFAULT 3799,
      ADD COLUMN IF NOT EXISTS nas_identifier TEXT;
  `);
  await pool.query(`ALTER TABLE network_routers ALTER COLUMN api_port DROP NOT NULL;`).catch(() => {});
  await pool.query(`
    ALTER TABLE subscribers
      ADD COLUMN IF NOT EXISTS provisioning_mode TEXT NOT NULL DEFAULT 'RADIUS',
      ADD COLUMN IF NOT EXISTS router_id UUID REFERENCES network_routers(id) ON DELETE SET NULL;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_subscribers_router_id ON subscribers(router_id);`);

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
      wg_peer_id UUID REFERENCES wg_peers(id) ON DELETE SET NULL,
      is_enabled BOOLEAN NOT NULL DEFAULT true,
      last_seen_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'UNKNOWN',
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
      wg_peer_id UUID REFERENCES wg_peers(id) ON DELETE SET NULL,
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
  `);

  // Phase 3.3: bind OLT to WireGuard peer for tunnel-aware management/routing
  await pool.query(`
    ALTER TABLE olts ADD COLUMN IF NOT EXISTS wg_peer_id UUID REFERENCES wg_peers(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_olts_wg_peer_id ON olts(wg_peer_id);
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
}

export { pool };
