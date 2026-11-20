--
-- PostgreSQL database dump
--

\restrict RjcM0sXoheTJauez2ZcJOVB5S8clOHuw2pUqyc7E7UheqI4TIKYgS0WJtpfaYYA

-- Dumped from database version 16.4 (Debian 16.4-1.pgdg110+2)
-- Dumped by pg_dump version 18.7

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: tiger; Type: SCHEMA; Schema: -; Owner: izandesk_user
--

CREATE SCHEMA tiger;


ALTER SCHEMA tiger OWNER TO izandesk_user;

--
-- Name: tiger_data; Type: SCHEMA; Schema: -; Owner: izandesk_user
--

CREATE SCHEMA tiger_data;


ALTER SCHEMA tiger_data OWNER TO izandesk_user;

--
-- Name: topology; Type: SCHEMA; Schema: -; Owner: izandesk_user
--

CREATE SCHEMA topology;


ALTER SCHEMA topology OWNER TO izandesk_user;

--
-- Name: SCHEMA topology; Type: COMMENT; Schema: -; Owner: izandesk_user
--

COMMENT ON SCHEMA topology IS 'PostGIS Topology schema';


--
-- Name: fuzzystrmatch; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA public;


--
-- Name: EXTENSION fuzzystrmatch; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION fuzzystrmatch IS 'determine similarities and distance between strings';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: postgis_tiger_geocoder; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder WITH SCHEMA tiger;


--
-- Name: EXTENSION postgis_tiger_geocoder; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION postgis_tiger_geocoder IS 'PostGIS tiger geocoder and reverse geocoder';


--
-- Name: postgis_topology; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_topology WITH SCHEMA topology;


--
-- Name: EXTENSION postgis_topology; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION postgis_topology IS 'PostGIS topology spatial types and functions';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: areas; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.areas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.areas OWNER TO izandesk_user;

--
-- Name: assets; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_tag text,
    name text NOT NULL,
    category text,
    vendor_id uuid,
    purchase_id uuid,
    purchase_date date,
    cost numeric(14,2) DEFAULT 0 NOT NULL,
    current_value numeric(14,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    location text,
    assigned_to_employee_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    depreciation_rate numeric(8,4) DEFAULT 0,
    accumulated_depreciation numeric(14,2) DEFAULT 0,
    last_depreciated_at timestamp with time zone
);


ALTER TABLE public.assets OWNER TO izandesk_user;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id text,
    actor_name text,
    actor_role text,
    action text NOT NULL,
    entity_type text,
    entity_id text,
    details jsonb DEFAULT '{}'::jsonb,
    ip_address text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.audit_logs OWNER TO izandesk_user;

--
-- Name: bandwidth_packages; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.bandwidth_packages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    profile_name text,
    download_mbps integer NOT NULL,
    upload_mbps integer NOT NULL,
    burst_download_mbps integer,
    burst_upload_mbps integer,
    burst_threshold_download_mbps integer,
    burst_threshold_upload_mbps integer,
    burst_time_sec integer,
    priority integer DEFAULT 8,
    queue_type text DEFAULT 'SIMPLE'::text,
    price numeric(12,2) DEFAULT 0,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data_cap_gb numeric(12,2),
    fup_speed_mbps integer
);


ALTER TABLE public.bandwidth_packages OWNER TO izandesk_user;

--
-- Name: billing_policies; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.billing_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    grace_days integer DEFAULT 7 NOT NULL,
    warning_days integer DEFAULT 3 NOT NULL,
    auto_suspend boolean DEFAULT true NOT NULL,
    isolate_on_suspend boolean DEFAULT true NOT NULL,
    enable_walled_garden boolean DEFAULT true NOT NULL,
    walled_garden_profile text,
    late_fee_enabled boolean DEFAULT false NOT NULL,
    late_fee_amount numeric(12,2) DEFAULT 0,
    late_fee_percent numeric(6,2) DEFAULT 0,
    currency text DEFAULT 'BDT'::text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    config jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.billing_policies OWNER TO izandesk_user;

--
-- Name: billing_scheduler_locks; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.billing_scheduler_locks (
    name text NOT NULL,
    locked_until timestamp with time zone NOT NULL,
    holder text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.billing_scheduler_locks OWNER TO izandesk_user;

--
-- Name: billing_suspension_logs; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.billing_suspension_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscriber_id uuid,
    action text NOT NULL,
    stage text,
    reason text,
    details jsonb DEFAULT '{}'::jsonb,
    triggered_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.billing_suspension_logs OWNER TO izandesk_user;

--
-- Name: coa_requests; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.coa_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscriber_id uuid,
    username text NOT NULL,
    router_id uuid,
    action text NOT NULL,
    attributes jsonb,
    status text DEFAULT 'QUEUED'::text NOT NULL,
    response_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    executed_at timestamp with time zone
);


ALTER TABLE public.coa_requests OWNER TO izandesk_user;

--
-- Name: distribution_boxes; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.distribution_boxes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    zone_id uuid,
    name text NOT NULL,
    code text,
    box_type text DEFAULT 'TJ'::text NOT NULL,
    capacity_ports integer DEFAULT 8 NOT NULL,
    latitude double precision,
    longitude double precision,
    location public.geography(Point,4326),
    address text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.distribution_boxes OWNER TO izandesk_user;

--
-- Name: fiber_routes; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.fiber_routes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    route_type text DEFAULT 'FIBER'::text NOT NULL,
    from_box_id uuid,
    to_box_id uuid,
    path public.geography(LineString,4326),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.fiber_routes OWNER TO izandesk_user;

--
-- Name: field_activities; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.field_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    activity_type text NOT NULL,
    employee_id uuid,
    subscriber_id uuid,
    ticket_id uuid,
    reseller_id uuid,
    scheduled_at timestamp with time zone,
    completed_at timestamp with time zone,
    status text DEFAULT 'PLANNED'::text NOT NULL,
    amount numeric(14,2),
    proof_ref text,
    latitude double precision,
    longitude double precision,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.field_activities OWNER TO izandesk_user;

--
-- Name: finance_accounts; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.finance_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text,
    name text NOT NULL,
    type text DEFAULT 'ASSET'::text NOT NULL,
    parent_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.finance_accounts OWNER TO izandesk_user;

--
-- Name: finance_journal_entries; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.finance_journal_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_no text,
    entry_date date DEFAULT CURRENT_DATE NOT NULL,
    description text,
    source_type text,
    source_id text,
    posted boolean DEFAULT true NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.finance_journal_entries OWNER TO izandesk_user;

--
-- Name: finance_journal_lines; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.finance_journal_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_id uuid NOT NULL,
    account_id uuid,
    debit numeric(14,2) DEFAULT 0 NOT NULL,
    credit numeric(14,2) DEFAULT 0 NOT NULL,
    memo text
);


ALTER TABLE public.finance_journal_lines OWNER TO izandesk_user;

--
-- Name: finance_transactions; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.finance_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    txn_date date DEFAULT CURRENT_DATE NOT NULL,
    txn_type text NOT NULL,
    account_id uuid,
    counter_account_id uuid,
    method text,
    amount numeric(14,2) DEFAULT 0 NOT NULL,
    currency text DEFAULT 'BDT'::text NOT NULL,
    reference_type text,
    reference_id text,
    subscriber_id uuid,
    reseller_id uuid,
    vendor_id uuid,
    employee_id uuid,
    description text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.finance_transactions OWNER TO izandesk_user;

--
-- Name: finance_vouchers; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.finance_vouchers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    voucher_no text,
    voucher_type text NOT NULL,
    date date DEFAULT CURRENT_DATE NOT NULL,
    party_type text,
    party_id text,
    amount numeric(14,2) DEFAULT 0 NOT NULL,
    method text,
    narration text,
    status text DEFAULT 'POSTED'::text NOT NULL,
    lines jsonb DEFAULT '[]'::jsonb,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.finance_vouchers OWNER TO izandesk_user;

--
-- Name: fup_enforcement_logs; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.fup_enforcement_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscriber_id uuid,
    action text NOT NULL,
    over_cap boolean,
    used_bytes bigint,
    cap_gb numeric(12,2),
    fup_speed_mbps integer,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.fup_enforcement_logs OWNER TO izandesk_user;

--
-- Name: hotspot_vouchers; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.hotspot_vouchers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_no text,
    code text NOT NULL,
    plan_name text,
    package_name text,
    price numeric(12,2) DEFAULT 0 NOT NULL,
    duration_hours integer,
    data_limit_mb integer,
    status text DEFAULT 'AVAILABLE'::text NOT NULL,
    subscriber_id uuid,
    reseller_id uuid,
    sold_at timestamp with time zone,
    activated_at timestamp with time zone,
    expires_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    radius_synced boolean DEFAULT false,
    used_bytes bigint DEFAULT 0,
    mac_address text
);


ALTER TABLE public.hotspot_vouchers OWNER TO izandesk_user;

--
-- Name: hr_attendance; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.hr_attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    att_date date NOT NULL,
    status text DEFAULT 'PRESENT'::text NOT NULL,
    check_in timestamp with time zone,
    check_out timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.hr_attendance OWNER TO izandesk_user;

--
-- Name: hr_employees; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.hr_employees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_code text,
    full_name text NOT NULL,
    designation text,
    department text,
    role text,
    phone text,
    email text,
    nid_number text,
    address text,
    joining_date date,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    base_salary numeric(14,2) DEFAULT 0 NOT NULL,
    commission_percent numeric(8,2) DEFAULT 0 NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.hr_employees OWNER TO izandesk_user;

--
-- Name: hr_leaves; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.hr_leaves (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    leave_type text DEFAULT 'CASUAL'::text NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    days numeric(6,2) DEFAULT 1 NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    reason text,
    approved_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.hr_leaves OWNER TO izandesk_user;

--
-- Name: hr_payroll_items; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.hr_payroll_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payroll_run_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    base_salary numeric(14,2) DEFAULT 0 NOT NULL,
    commission numeric(14,2) DEFAULT 0 NOT NULL,
    bonus numeric(14,2) DEFAULT 0 NOT NULL,
    deductions numeric(14,2) DEFAULT 0 NOT NULL,
    net_pay numeric(14,2) DEFAULT 0 NOT NULL,
    notes text,
    components jsonb DEFAULT '{}'::jsonb
);


ALTER TABLE public.hr_payroll_items OWNER TO izandesk_user;

--
-- Name: hr_payroll_runs; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.hr_payroll_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    period_month text NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    total_amount numeric(14,2) DEFAULT 0 NOT NULL,
    notes text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    posted_at timestamp with time zone
);


ALTER TABLE public.hr_payroll_runs OWNER TO izandesk_user;

--
-- Name: installation_checklist_items; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.installation_checklist_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    item_text text NOT NULL,
    is_required boolean DEFAULT true NOT NULL,
    is_completed boolean DEFAULT false NOT NULL,
    completed_at timestamp with time zone,
    completed_by text,
    notes text,
    sort_order integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.installation_checklist_items OWNER TO izandesk_user;

--
-- Name: installation_orders; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.installation_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_no text,
    subscriber_id uuid,
    lead_id uuid,
    order_type text DEFAULT 'INSTALLATION'::text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    priority text DEFAULT 'NORMAL'::text NOT NULL,
    scheduled_date date,
    scheduled_time_start time without time zone,
    scheduled_time_end time without time zone,
    assigned_technician_id uuid,
    assigned_technician_name text,
    site_address text,
    site_latitude double precision,
    site_longitude double precision,
    site_contact_name text,
    site_contact_phone text,
    required_equipment jsonb DEFAULT '[]'::jsonb,
    checklist jsonb DEFAULT '[]'::jsonb,
    completion_notes text,
    completion_photos jsonb DEFAULT '[]'::jsonb,
    actual_start_at timestamp with time zone,
    actual_end_at timestamp with time zone,
    sla_due_at timestamp with time zone,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.installation_orders OWNER TO izandesk_user;

--
-- Name: inventory_items; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.inventory_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    brand text,
    model text,
    unit text DEFAULT 'pcs'::text NOT NULL,
    reorder_level integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.inventory_items OWNER TO izandesk_user;

--
-- Name: inventory_serials; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.inventory_serials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    warehouse_id uuid,
    serial_number text NOT NULL,
    mac_address text,
    status text DEFAULT 'IN_STOCK'::text NOT NULL,
    assigned_subscriber_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'MANUAL'::text NOT NULL
);


ALTER TABLE public.inventory_serials OWNER TO izandesk_user;

--
-- Name: inventory_warehouses; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.inventory_warehouses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    location text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.inventory_warehouses OWNER TO izandesk_user;

--
-- Name: invoice_items; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.invoice_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    description text NOT NULL,
    item_type text DEFAULT 'PACKAGE'::text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric(12,2) DEFAULT 0 NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb
);


ALTER TABLE public.invoice_items OWNER TO izandesk_user;

--
-- Name: invoices; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_number text NOT NULL,
    subscriber_id uuid,
    client_code text,
    subscriber_name text,
    username text,
    billing_cycle text,
    bill_month text,
    period_start date,
    period_end date,
    issue_date date DEFAULT CURRENT_DATE NOT NULL,
    due_date date,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    discount numeric(12,2) DEFAULT 0 NOT NULL,
    tax numeric(12,2) DEFAULT 0 NOT NULL,
    total_amount numeric(12,2) DEFAULT 0 NOT NULL,
    paid_amount numeric(12,2) DEFAULT 0 NOT NULL,
    due_amount numeric(12,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'UNPAID'::text NOT NULL,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb,
    prorated boolean DEFAULT false NOT NULL,
    prorate_ratio numeric(8,6),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone
);


ALTER TABLE public.invoices OWNER TO izandesk_user;

--
-- Name: kyc_documents; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.kyc_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscriber_id uuid NOT NULL,
    doc_type text NOT NULL,
    file_name text NOT NULL,
    file_path text NOT NULL,
    mime_type text,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.kyc_documents OWNER TO izandesk_user;

--
-- Name: lead_activities; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.lead_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid NOT NULL,
    activity_type text NOT NULL,
    subject text,
    description text,
    outcome text,
    scheduled_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.lead_activities OWNER TO izandesk_user;

--
-- Name: leads; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_no text,
    full_name text NOT NULL,
    phone text,
    email text,
    address text,
    latitude double precision,
    longitude double precision,
    area_id uuid,
    zone_id uuid,
    interested_package text,
    source text,
    status text DEFAULT 'NEW'::text NOT NULL,
    priority text DEFAULT 'MEDIUM'::text NOT NULL,
    assigned_to text,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb,
    converted_subscriber_id uuid,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.leads OWNER TO izandesk_user;

--
-- Name: message_logs; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.message_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel_type text NOT NULL,
    provider text,
    channel_id uuid,
    direction text DEFAULT 'OUTBOUND'::text NOT NULL,
    recipient text,
    subject text,
    body text,
    status text DEFAULT 'QUEUED'::text NOT NULL,
    provider_message_id text,
    related_type text,
    related_id text,
    payload jsonb DEFAULT '{}'::jsonb,
    error_message text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.message_logs OWNER TO izandesk_user;

--
-- Name: message_templates; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.message_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    channel_type text NOT NULL,
    purpose text,
    subject text,
    body text NOT NULL,
    variables jsonb DEFAULT '[]'::jsonb,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.message_templates OWNER TO izandesk_user;

--
-- Name: messaging_channels; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.messaging_channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    channel_type text NOT NULL,
    provider text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    config jsonb DEFAULT '{}'::jsonb,
    credentials jsonb DEFAULT '{}'::jsonb,
    webhook_secret text,
    sender_id text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.messaging_channels OWNER TO izandesk_user;

--
-- Name: nas; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.nas (
    id integer NOT NULL,
    nasname text NOT NULL,
    shortname text,
    type text DEFAULT 'other'::text,
    ports integer,
    secret text NOT NULL,
    server text,
    community text,
    description text
);


ALTER TABLE public.nas OWNER TO izandesk_user;

--
-- Name: nas_id_seq; Type: SEQUENCE; Schema: public; Owner: izandesk_user
--

CREATE SEQUENCE public.nas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.nas_id_seq OWNER TO izandesk_user;

--
-- Name: nas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: izandesk_user
--

ALTER SEQUENCE public.nas_id_seq OWNED BY public.nas.id;


--
-- Name: network_routers; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.network_routers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    host text NOT NULL,
    api_port integer DEFAULT 8728,
    rest_port integer,
    username text DEFAULT 'admin'::text NOT NULL,
    password text,
    router_type text DEFAULT 'MIKROTIK'::text NOT NULL,
    ros_version text DEFAULT 'v7'::text NOT NULL,
    use_ssl boolean DEFAULT false NOT NULL,
    site text,
    wg_peer_id uuid,
    is_enabled boolean DEFAULT true NOT NULL,
    last_seen_at timestamp with time zone,
    status text DEFAULT 'UNKNOWN'::text NOT NULL,
    cpu_load numeric(5,2),
    memory_used_mb numeric(12,2),
    memory_total_mb numeric(12,2),
    uptime_seconds bigint,
    rx_bps bigint DEFAULT 0,
    tx_bps bigint DEFAULT 0,
    identity text,
    board_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    integration_mode text DEFAULT 'API'::text NOT NULL,
    radius_secret text,
    coa_port integer DEFAULT 3799,
    nas_identifier text
);


ALTER TABLE public.network_routers OWNER TO izandesk_user;

--
-- Name: olts; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.olts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    vendor text DEFAULT 'HUAWEI'::text NOT NULL,
    model text,
    host text NOT NULL,
    ssh_port integer DEFAULT 23,
    snmp_port integer DEFAULT 161,
    username text DEFAULT 'admin'::text NOT NULL,
    password text,
    snmp_community text DEFAULT 'public'::text,
    site text,
    wg_peer_id uuid,
    is_enabled boolean DEFAULT true NOT NULL,
    status text DEFAULT 'UNKNOWN'::text NOT NULL,
    last_seen_at timestamp with time zone,
    temperature_c numeric(6,2),
    uptime_seconds bigint,
    total_ports integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.olts OWNER TO izandesk_user;

--
-- Name: onus; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.onus (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    olt_id uuid NOT NULL,
    pon_port text NOT NULL,
    onu_id text,
    serial_number text,
    name text,
    subscriber_id uuid,
    status text DEFAULT 'DISCOVERED'::text NOT NULL,
    rx_power_dbm numeric(6,2),
    tx_power_dbm numeric(6,2),
    distance_m integer,
    last_down_cause text,
    authorized_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    mac_address text,
    temperature_c numeric(6,2),
    voltage_v numeric(6,2),
    tx_bias_ma numeric(8,2),
    inventory_serial_id uuid
);


ALTER TABLE public.onus OWNER TO izandesk_user;

--
-- Name: payment_gateway_configs; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.payment_gateway_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gateway text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    mode text DEFAULT 'SANDBOX'::text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb,
    credentials jsonb DEFAULT '{}'::jsonb,
    webhook_secret text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.payment_gateway_configs OWNER TO izandesk_user;

--
-- Name: payment_sms_events; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.payment_sms_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gateway text DEFAULT 'bkash'::text NOT NULL,
    sender text,
    message text,
    trx_id text,
    amount numeric(12,2),
    payer_number text,
    matched_payment_ref text,
    matched_invoice_id uuid,
    status text DEFAULT 'RECEIVED'::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone
);


ALTER TABLE public.payment_sms_events OWNER TO izandesk_user;

--
-- Name: payment_webhook_events; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.payment_webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gateway text NOT NULL,
    event_id text,
    dedupe_key text,
    payload jsonb,
    processed boolean DEFAULT false NOT NULL,
    processed_at timestamp with time zone,
    result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.payment_webhook_events OWNER TO izandesk_user;

--
-- Name: payments; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_ref text NOT NULL,
    invoice_id uuid,
    subscriber_id uuid,
    gateway text NOT NULL,
    method text,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    currency text DEFAULT 'BDT'::text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    trx_id text,
    payer_number text,
    payer_info jsonb DEFAULT '{}'::jsonb,
    gateway_response jsonb DEFAULT '{}'::jsonb,
    checkout_url text,
    client_secret text,
    idempotency_key text,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_type text,
    collector_name text,
    approval_status text DEFAULT 'APPROVED'::text,
    approval_note text,
    received_at timestamp with time zone
);


ALTER TABLE public.payments OWNER TO izandesk_user;

--
-- Name: purchase_items; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.purchase_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_id uuid NOT NULL,
    item_name text NOT NULL,
    category text,
    sku text,
    qty numeric(12,2) DEFAULT 1 NOT NULL,
    unit_cost numeric(14,2) DEFAULT 0 NOT NULL,
    total_cost numeric(14,2) DEFAULT 0 NOT NULL,
    inventory_item_id uuid
);


ALTER TABLE public.purchase_items OWNER TO izandesk_user;

--
-- Name: purchases; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_no text,
    vendor_id uuid,
    warehouse_id uuid,
    purchase_date date DEFAULT CURRENT_DATE NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    subtotal numeric(14,2) DEFAULT 0 NOT NULL,
    tax numeric(14,2) DEFAULT 0 NOT NULL,
    total numeric(14,2) DEFAULT 0 NOT NULL,
    notes text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.purchases OWNER TO izandesk_user;

--
-- Name: radacct; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.radacct (
    radacctid bigint NOT NULL,
    acctsessionid text DEFAULT ''::text NOT NULL,
    acctuniqueid text DEFAULT ''::text NOT NULL,
    username text,
    realm text,
    nasipaddress inet,
    nasportid text,
    nasporttype text,
    acctstarttime timestamp with time zone,
    acctupdatetime timestamp with time zone,
    acctstoptime timestamp with time zone,
    acctinterval bigint,
    acctsessiontime bigint,
    acctauthentic text,
    connectinfo_start text,
    connectinfo_stop text,
    acctinputoctets bigint,
    acctoutputoctets bigint,
    calledstationid text,
    callingstationid text,
    acctterminatecause text,
    servicetype text,
    framedprotocol text,
    framedipaddress inet
);


ALTER TABLE public.radacct OWNER TO izandesk_user;

--
-- Name: radacct_radacctid_seq; Type: SEQUENCE; Schema: public; Owner: izandesk_user
--

CREATE SEQUENCE public.radacct_radacctid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.radacct_radacctid_seq OWNER TO izandesk_user;

--
-- Name: radacct_radacctid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: izandesk_user
--

ALTER SEQUENCE public.radacct_radacctid_seq OWNED BY public.radacct.radacctid;


--
-- Name: radcheck; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.radcheck (
    id integer NOT NULL,
    username text DEFAULT ''::text NOT NULL,
    attribute text DEFAULT ''::text NOT NULL,
    op character varying(2) DEFAULT '=='::character varying NOT NULL,
    value text DEFAULT ''::text NOT NULL
);


ALTER TABLE public.radcheck OWNER TO izandesk_user;

--
-- Name: radcheck_id_seq; Type: SEQUENCE; Schema: public; Owner: izandesk_user
--

CREATE SEQUENCE public.radcheck_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.radcheck_id_seq OWNER TO izandesk_user;

--
-- Name: radcheck_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: izandesk_user
--

ALTER SEQUENCE public.radcheck_id_seq OWNED BY public.radcheck.id;


--
-- Name: radgroupcheck; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.radgroupcheck (
    id integer NOT NULL,
    groupname text DEFAULT ''::text NOT NULL,
    attribute text DEFAULT ''::text NOT NULL,
    op character varying(2) DEFAULT '=='::character varying NOT NULL,
    value text DEFAULT ''::text NOT NULL
);


ALTER TABLE public.radgroupcheck OWNER TO izandesk_user;

--
-- Name: radgroupcheck_id_seq; Type: SEQUENCE; Schema: public; Owner: izandesk_user
--

CREATE SEQUENCE public.radgroupcheck_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.radgroupcheck_id_seq OWNER TO izandesk_user;

--
-- Name: radgroupcheck_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: izandesk_user
--

ALTER SEQUENCE public.radgroupcheck_id_seq OWNED BY public.radgroupcheck.id;


--
-- Name: radgroupreply; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.radgroupreply (
    id integer NOT NULL,
    groupname text DEFAULT ''::text NOT NULL,
    attribute text DEFAULT ''::text NOT NULL,
    op character varying(2) DEFAULT '='::character varying NOT NULL,
    value text DEFAULT ''::text NOT NULL
);


ALTER TABLE public.radgroupreply OWNER TO izandesk_user;

--
-- Name: radgroupreply_id_seq; Type: SEQUENCE; Schema: public; Owner: izandesk_user
--

CREATE SEQUENCE public.radgroupreply_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.radgroupreply_id_seq OWNER TO izandesk_user;

--
-- Name: radgroupreply_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: izandesk_user
--

ALTER SEQUENCE public.radgroupreply_id_seq OWNED BY public.radgroupreply.id;


--
-- Name: radius_users; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.radius_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscriber_id uuid,
    username text NOT NULL,
    password text,
    profile text,
    framed_ip_address text,
    status text DEFAULT 'PENDING'::text NOT NULL,
    last_synced_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.radius_users OWNER TO izandesk_user;

--
-- Name: radpostauth; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.radpostauth (
    id bigint NOT NULL,
    username text NOT NULL,
    pass text,
    reply text,
    authdate timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.radpostauth OWNER TO izandesk_user;

--
-- Name: radpostauth_id_seq; Type: SEQUENCE; Schema: public; Owner: izandesk_user
--

CREATE SEQUENCE public.radpostauth_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.radpostauth_id_seq OWNER TO izandesk_user;

--
-- Name: radpostauth_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: izandesk_user
--

ALTER SEQUENCE public.radpostauth_id_seq OWNED BY public.radpostauth.id;


--
-- Name: radreply; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.radreply (
    id integer NOT NULL,
    username text DEFAULT ''::text NOT NULL,
    attribute text DEFAULT ''::text NOT NULL,
    op character varying(2) DEFAULT '='::character varying NOT NULL,
    value text DEFAULT ''::text NOT NULL
);


ALTER TABLE public.radreply OWNER TO izandesk_user;

--
-- Name: radreply_id_seq; Type: SEQUENCE; Schema: public; Owner: izandesk_user
--

CREATE SEQUENCE public.radreply_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.radreply_id_seq OWNER TO izandesk_user;

--
-- Name: radreply_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: izandesk_user
--

ALTER SEQUENCE public.radreply_id_seq OWNED BY public.radreply.id;


--
-- Name: radusergroup; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.radusergroup (
    id integer NOT NULL,
    username text DEFAULT ''::text NOT NULL,
    groupname text DEFAULT ''::text NOT NULL,
    priority integer DEFAULT 1 NOT NULL
);


ALTER TABLE public.radusergroup OWNER TO izandesk_user;

--
-- Name: radusergroup_id_seq; Type: SEQUENCE; Schema: public; Owner: izandesk_user
--

CREATE SEQUENCE public.radusergroup_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.radusergroup_id_seq OWNER TO izandesk_user;

--
-- Name: radusergroup_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: izandesk_user
--

ALTER SEQUENCE public.radusergroup_id_seq OWNED BY public.radusergroup.id;


--
-- Name: report_schedules; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.report_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    report_key text NOT NULL,
    format text DEFAULT 'CSV'::text NOT NULL,
    schedule_cron text,
    recipients jsonb DEFAULT '[]'::jsonb,
    enabled boolean DEFAULT true NOT NULL,
    last_run_at timestamp with time zone,
    last_status text,
    config jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.report_schedules OWNER TO izandesk_user;

--
-- Name: reseller_share_entries; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.reseller_share_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reseller_id uuid NOT NULL,
    subscriber_id uuid,
    payment_ref text,
    wallet_transaction_id uuid,
    retail_amount numeric(12,2) DEFAULT 0 NOT NULL,
    partner_share numeric(12,2) DEFAULT 0 NOT NULL,
    isp_share numeric(12,2) DEFAULT 0 NOT NULL,
    margin_percent numeric(8,2) DEFAULT 0 NOT NULL,
    package_name text,
    period_month date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb
);


ALTER TABLE public.reseller_share_entries OWNER TO izandesk_user;

--
-- Name: reseller_wallet_transactions; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.reseller_wallet_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reseller_id uuid NOT NULL,
    type text NOT NULL,
    direction text DEFAULT 'CREDIT'::text NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    balance_after numeric(12,2) DEFAULT 0 NOT NULL,
    reference_type text,
    reference_id text,
    subscriber_id uuid,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.reseller_wallet_transactions OWNER TO izandesk_user;

--
-- Name: resellers; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.resellers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text,
    name text NOT NULL,
    company_name text,
    tier text DEFAULT 'STANDARD'::text NOT NULL,
    parent_reseller_id uuid,
    email text,
    phone text,
    subdomain text,
    custom_domain text,
    brand_name text,
    logo_url text,
    primary_color text,
    secondary_color text,
    portal_title text,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    wallet_balance numeric(12,2) DEFAULT 0 NOT NULL,
    credit_limit numeric(12,2) DEFAULT 0 NOT NULL,
    commission_percent numeric(6,2) DEFAULT 0 NOT NULL,
    buying_margin_percent numeric(6,2) DEFAULT 0 NOT NULL,
    address text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.resellers OWNER TO izandesk_user;

--
-- Name: router_package_sync; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.router_package_sync (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    router_id uuid NOT NULL,
    package_id uuid NOT NULL,
    sync_status text DEFAULT 'PENDING'::text NOT NULL,
    last_synced_at timestamp with time zone,
    last_error text,
    remote_ref text
);


ALTER TABLE public.router_package_sync OWNER TO izandesk_user;

--
-- Name: saved_payment_methods; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.saved_payment_methods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscriber_id uuid NOT NULL,
    gateway text NOT NULL,
    label text,
    token_ref text,
    masked_identifier text,
    is_default boolean DEFAULT false NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.saved_payment_methods OWNER TO izandesk_user;

--
-- Name: subscriber_client_code_seq; Type: SEQUENCE; Schema: public; Owner: izandesk_user
--

CREATE SEQUENCE public.subscriber_client_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.subscriber_client_code_seq OWNER TO izandesk_user;

--
-- Name: subscriber_communications; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.subscriber_communications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscriber_id uuid NOT NULL,
    direction text NOT NULL,
    channel text NOT NULL,
    subject text,
    body text,
    contact_person text,
    contact_phone text,
    contact_email text,
    related_type text,
    related_id text,
    status text DEFAULT 'COMPLETED'::text NOT NULL,
    provider_message_id text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.subscriber_communications OWNER TO izandesk_user;

--
-- Name: subscriber_equipment; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.subscriber_equipment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscriber_id uuid NOT NULL,
    equipment_type text NOT NULL,
    serial_number text NOT NULL,
    mac_address text,
    inventory_serial_id uuid,
    onu_id uuid,
    status text DEFAULT 'ASSIGNED'::text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    installed_at timestamp with time zone,
    installed_by text,
    location_details text,
    firmware_version text,
    config_backup jsonb,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.subscriber_equipment OWNER TO izandesk_user;

--
-- Name: subscriber_sessions; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.subscriber_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscriber_id uuid,
    router_id uuid,
    username text NOT NULL,
    session_id text,
    ip_address text,
    mac_address text,
    uptime_sec bigint DEFAULT 0,
    rx_bps bigint DEFAULT 0,
    tx_bps bigint DEFAULT 0,
    rx_bytes bigint DEFAULT 0,
    tx_bytes bigint DEFAULT 0,
    status text DEFAULT 'OFFLINE'::text NOT NULL,
    nas_port text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.subscriber_sessions OWNER TO izandesk_user;

--
-- Name: subscribers; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.subscribers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_code text NOT NULL,
    full_name text NOT NULL,
    subscriber_type text DEFAULT 'HOME'::text NOT NULL,
    connection_type text DEFAULT 'PPPOE'::text NOT NULL,
    username text,
    password text,
    phone text,
    email text,
    nid_number text,
    package_name text,
    bandwidth_mbps integer,
    monthly_bill numeric(12,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    area_id uuid,
    zone_id uuid,
    distribution_box_id uuid,
    address text,
    latitude double precision,
    longitude double precision,
    location public.geography(Point,4326),
    ip_address text,
    mac_address text,
    installation_date date,
    district text,
    thana text,
    upazila text,
    post_office text,
    village text,
    area_name text,
    ward_no text,
    road_no text,
    house_no text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    billing_cycle_day integer DEFAULT 1,
    billing_anchor date,
    next_bill_date date,
    expiry_date date,
    due_date date,
    grace_until timestamp with time zone,
    suspension_stage text DEFAULT 'NONE'::text,
    walled_garden boolean DEFAULT false NOT NULL,
    auto_suspend_enabled boolean DEFAULT true NOT NULL,
    last_billed_at timestamp with time zone,
    current_due numeric(12,2) DEFAULT 0 NOT NULL,
    balance numeric(12,2) DEFAULT 0 NOT NULL,
    wallet_balance numeric(12,2) DEFAULT 0 NOT NULL,
    reseller_id uuid,
    suspension_reason text,
    fup_exceeded boolean DEFAULT false NOT NULL,
    fup_applied_at timestamp with time zone,
    fup_exempt boolean DEFAULT false NOT NULL,
    auto_pay_enabled boolean DEFAULT false NOT NULL,
    preferred_gateway text,
    provisioning_mode text DEFAULT 'RADIUS'::text NOT NULL,
    router_id uuid,
    price_override numeric(12,2),
    custom_package_note text,
    extended_expiry boolean DEFAULT false NOT NULL,
    branch_name text
);


ALTER TABLE public.subscribers OWNER TO izandesk_user;

--
-- Name: ticket_comments; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.ticket_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    author_name text,
    author_role text,
    body text NOT NULL,
    is_internal boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.ticket_comments OWNER TO izandesk_user;

--
-- Name: tickets; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_no text,
    subscriber_id uuid,
    reseller_id uuid,
    subject text NOT NULL,
    description text,
    category text DEFAULT 'SUPPORT'::text NOT NULL,
    priority text DEFAULT 'MEDIUM'::text NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    sla_policy text,
    sla_due_at timestamp with time zone,
    sla_breached boolean DEFAULT false NOT NULL,
    assigned_technician_id text,
    assigned_technician_name text,
    assigned_technician_phone text,
    dispatch_status text DEFAULT 'UNASSIGNED'::text,
    site_latitude double precision,
    site_longitude double precision,
    site_address text,
    gps_nav_url text,
    resolution_notes text,
    source text DEFAULT 'PORTAL'::text,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.tickets OWNER TO izandesk_user;

--
-- Name: vendors; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.vendors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    company_name text,
    phone text,
    email text,
    address text,
    category text,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.vendors OWNER TO izandesk_user;

--
-- Name: wallet_transactions; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.wallet_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscriber_id uuid,
    reseller_id uuid,
    type text NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    balance_after numeric(12,2) DEFAULT 0,
    reference_id text,
    reference_type text,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.wallet_transactions OWNER TO izandesk_user;

--
-- Name: wg_hub_config; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.wg_hub_config (
    id integer DEFAULT 1 NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    interface_name text DEFAULT 'wg0'::text NOT NULL,
    listen_port integer DEFAULT 51820 NOT NULL,
    endpoint_host text,
    endpoint_port integer DEFAULT 51820 NOT NULL,
    hub_address text DEFAULT '10.77.0.1/16'::text NOT NULL,
    overlay_cidr text DEFAULT '10.77.0.0/16'::text NOT NULL,
    private_key text,
    public_key text,
    dns_servers text,
    mtu integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wg_hub_config_id_check CHECK ((id = 1))
);


ALTER TABLE public.wg_hub_config OWNER TO izandesk_user;

--
-- Name: wg_peers; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.wg_peers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    router_id uuid,
    name text NOT NULL,
    site_name text,
    tunnel_ip text NOT NULL,
    allowed_ips text[] DEFAULT '{}'::text[] NOT NULL,
    public_key text,
    private_key text,
    preshared_key text,
    keepalive_sec integer DEFAULT 25 NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    provision_mode text DEFAULT 'AUTO'::text NOT NULL,
    last_handshake_at timestamp with time zone,
    rx_bytes bigint DEFAULT 0,
    tx_bytes bigint DEFAULT 0,
    remote_endpoint text,
    last_error text,
    notes text,
    olt_mgmt_cidrs text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.wg_peers OWNER TO izandesk_user;

--
-- Name: zones; Type: TABLE; Schema: public; Owner: izandesk_user
--

CREATE TABLE public.zones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    area_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.zones OWNER TO izandesk_user;

--
-- Name: nas id; Type: DEFAULT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.nas ALTER COLUMN id SET DEFAULT nextval('public.nas_id_seq'::regclass);


--
-- Name: radacct radacctid; Type: DEFAULT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.radacct ALTER COLUMN radacctid SET DEFAULT nextval('public.radacct_radacctid_seq'::regclass);


--
-- Name: radcheck id; Type: DEFAULT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.radcheck ALTER COLUMN id SET DEFAULT nextval('public.radcheck_id_seq'::regclass);


--
-- Name: radgroupcheck id; Type: DEFAULT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.radgroupcheck ALTER COLUMN id SET DEFAULT nextval('public.radgroupcheck_id_seq'::regclass);


--
-- Name: radgroupreply id; Type: DEFAULT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.radgroupreply ALTER COLUMN id SET DEFAULT nextval('public.radgroupreply_id_seq'::regclass);


--
-- Name: radpostauth id; Type: DEFAULT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.radpostauth ALTER COLUMN id SET DEFAULT nextval('public.radpostauth_id_seq'::regclass);


--
-- Name: radreply id; Type: DEFAULT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.radreply ALTER COLUMN id SET DEFAULT nextval('public.radreply_id_seq'::regclass);


--
-- Name: radusergroup id; Type: DEFAULT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.radusergroup ALTER COLUMN id SET DEFAULT nextval('public.radusergroup_id_seq'::regclass);


--
-- Data for Name: areas; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.areas (id, name, created_at) FROM stdin;
dc241b9e-d93d-4e6e-bb68-61e7c9218d61	Mirpur	2026-11-14 03:27:41.505668+00
26f04aee-a366-41c2-ba51-a4052410658c	Dhanmondi	2026-11-14 03:27:41.508567+00
\.


--
-- Data for Name: assets; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.assets (id, asset_tag, name, category, vendor_id, purchase_id, purchase_date, cost, current_value, status, location, assigned_to_employee_id, notes, created_at, depreciation_rate, accumulated_depreciation, last_depreciated_at) FROM stdin;
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.audit_logs (id, actor_id, actor_name, actor_role, action, entity_type, entity_id, details, ip_address, created_at) FROM stdin;
\.


--
-- Data for Name: bandwidth_packages; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.bandwidth_packages (id, name, profile_name, download_mbps, upload_mbps, burst_download_mbps, burst_upload_mbps, burst_threshold_download_mbps, burst_threshold_upload_mbps, burst_time_sec, priority, queue_type, price, description, is_active, created_at, updated_at, data_cap_gb, fup_speed_mbps) FROM stdin;
5960335a-c884-40aa-a143-4800fe5af10e	Home 20 Mbps	pppoe-20m	20	20	25	25	15	15	10	8	SIMPLE	500.00	Starter home package	t	2026-11-14 03:27:41.495605+00	2026-11-14 03:27:41.495605+00	\N	\N
8464359d-4eb9-4fdd-a4ab-bac694c96404	Home 50 Mbps	pppoe-50m	50	50	60	60	35	35	12	8	SIMPLE	800.00	Popular home package	t	2026-11-14 03:27:41.495605+00	2026-11-14 03:27:41.495605+00	\N	\N
1fdb25a8-d813-4404-9c3b-fbcbab047e67	Corporate 100 Mbps CIR	cir-100m	100	100	\N	\N	\N	\N	\N	1	QUEUE_TREE	5000.00	Dedicated corporate CIR	t	2026-11-14 03:27:41.495605+00	2026-11-14 03:27:41.495605+00	\N	\N
1d910191-f7c4-445e-b08c-2f39c243ac7b	6Mbps	6Mbps	1	1	\N	\N	\N	\N	\N	8	SIMPLE	0.00	Imported from MikroTik MikroTik 103.112.150.52	t	2026-11-14 08:13:37.017366+00	2026-11-14 08:13:37.017366+00	\N	\N
d5113463-54a1-4c5a-a5f5-d3f92a6cc3d8	8Mbps	8Mbps	1	1	\N	\N	\N	\N	\N	8	SIMPLE	0.00	Imported from MikroTik MikroTik 103.112.150.52	t	2026-11-14 08:13:37.026262+00	2026-11-14 08:13:37.026262+00	\N	\N
77d02905-14d0-48f0-bf14-29b8f29da0a3	10Mbps	10Mbps	1	1	\N	\N	\N	\N	\N	8	SIMPLE	0.00	Imported from MikroTik MikroTik 103.112.150.52	t	2026-11-14 08:13:37.035046+00	2026-11-14 08:13:37.035046+00	\N	\N
2b4e329b-0d02-42f2-a24d-499dceead65d	Basic	Basic	10	10	\N	\N	\N	\N	\N	8	SIMPLE	0.00	Imported from MikroTik MikroTik 103.112.150.52	t	2026-11-14 08:13:37.044611+00	2026-11-14 08:13:37.044611+00	\N	\N
538ca796-c956-4db2-b491-92fdf4c48cef	default-encryption	default-encryption	1	1	\N	\N	\N	\N	\N	8	SIMPLE	0.00	Imported from MikroTik MikroTik 103.112.150.52	t	2026-11-14 08:13:37.053476+00	2026-11-14 08:13:37.053476+00	\N	\N
\.


--
-- Data for Name: billing_policies; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.billing_policies (id, name, grace_days, warning_days, auto_suspend, isolate_on_suspend, enable_walled_garden, walled_garden_profile, late_fee_enabled, late_fee_amount, late_fee_percent, currency, is_default, config, created_at, updated_at) FROM stdin;
17110ca1-c911-4016-8b5e-11c84751199c	Default ISP Policy	7	3	t	t	t	\N	f	0.00	0.00	BDT	t	{}	2026-11-14 03:25:14.562322+00	2026-11-14 03:25:14.562322+00
\.


--
-- Data for Name: billing_scheduler_locks; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.billing_scheduler_locks (name, locked_until, holder, updated_at) FROM stdin;
fup-enforcement-sweep	2026-11-15 08:08:18.633+00	pid:286	2026-11-15 07:43:18.675112+00
billing-due-policy-sweep	2026-11-15 07:50:22.972+00	pid:455	2026-11-15 07:49:28.017073+00
\.


--
-- Data for Name: billing_suspension_logs; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.billing_suspension_logs (id, subscriber_id, action, stage, reason, details, triggered_by, created_at) FROM stdin;
7e3642dc-9ae1-4ece-95c0-c7d91f2692cb	\N	WALLED_GARDEN_ROUTER_PROVISION	\N	Provisioned walled-garden redirect/profile rules on router	{"result": {"ok": true, "mode": "API", "steps": {"dns": {"ok": true}, "redirect": {"ok": true, "action": "created"}, "dropOther": {"ok": true}, "allowPortal": {"ok": true}}, "portalUrl": "http://api:4000/walled-garden", "portalHost": "api", "portalPort": 4000, "addressList": "izn-walled-garden"}, "router": "MikroTik 103.112.150.52", "router_id": "d0a742a6-7b95-47a7-96a2-e0af96569ed1"}	admin@izandesk.com	2026-11-14 08:09:21.042867+00
\.


--
-- Data for Name: coa_requests; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.coa_requests (id, subscriber_id, username, router_id, action, attributes, status, response_message, created_at, executed_at) FROM stdin;
\.


--
-- Data for Name: distribution_boxes; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.distribution_boxes (id, zone_id, name, code, box_type, capacity_ports, latitude, longitude, location, address, notes, created_at) FROM stdin;
1c1741bb-e26c-4967-b2c6-0578b162750a	47ea243f-5907-449f-8260-edf1603d739a	TJ-MIR-01	TJ-MIR-01	TJ	8	23.8069	90.3687	0101000020E61000004182E2C798975640742497FF90CE3740	Mirpur Section 10	\N	2026-11-14 03:27:41.527782+00
9dd6154a-3b60-46e5-94bd-5565db68752f	9739ef09-51f8-45db-842c-3a906d34e23b	TJ-MIR-02	TJ-MIR-02	Splitter	16	23.8121	90.3655	0101000020E610000008AC1C5A64975640E4141DC9E5CF3740	Mirpur Section 11	\N	2026-11-14 03:27:41.527782+00
ab7c80e0-87f5-4bff-85f0-18f875e7262e	ef1d82db-e311-4e39-bf4a-7f808466c61d	TJ-DHN-01	TJ-DHN-01	TJ	8	23.7465	90.376	0101000020E6100000F2D24D6210985640C976BE9F1ABF3740	Dhanmondi Road 27	\N	2026-11-14 03:27:41.527782+00
\.


--
-- Data for Name: fiber_routes; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.fiber_routes (id, name, route_type, from_box_id, to_box_id, path, notes, created_at) FROM stdin;
\.


--
-- Data for Name: field_activities; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.field_activities (id, activity_type, employee_id, subscriber_id, ticket_id, reseller_id, scheduled_at, completed_at, status, amount, proof_ref, latitude, longitude, notes, created_at) FROM stdin;
\.


--
-- Data for Name: finance_accounts; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.finance_accounts (id, code, name, type, parent_id, is_active, meta, created_at, updated_at) FROM stdin;
5cd10383-7a51-4fa3-8941-aa1b53bc8841	1000	Cash	ASSET	\N	t	{}	2026-11-14 03:26:09.244317+00	2026-11-14 03:26:09.244317+00
432da8c2-64cb-4bc8-a33e-1ca0127edcdd	1010	Bank	ASSET	\N	t	{}	2026-11-14 03:26:09.244317+00	2026-11-14 03:26:09.244317+00
dbfce58f-1c13-4dbc-956f-4ca455ccf8a9	1020	bKash/MFS	ASSET	\N	t	{}	2026-11-14 03:26:09.244317+00	2026-11-14 03:26:09.244317+00
f002ab01-0c07-4067-961c-0d874a4a3545	4000	Service Revenue	INCOME	\N	t	{}	2026-11-14 03:26:09.244317+00	2026-11-14 03:26:09.244317+00
26764edc-321a-449d-a396-25e34b610e0b	4010	Installation/Other Income	INCOME	\N	t	{}	2026-11-14 03:26:09.244317+00	2026-11-14 03:26:09.244317+00
6b52cee0-9697-409e-a4b8-64d262148c89	5000	Operating Expense	EXPENSE	\N	t	{}	2026-11-14 03:26:09.244317+00	2026-11-14 03:26:09.244317+00
7d36d7aa-e446-4c77-947e-1b32e2a015bc	5010	Salary Expense	EXPENSE	\N	t	{}	2026-11-14 03:26:09.244317+00	2026-11-14 03:26:09.244317+00
e6db7a7d-c13b-4332-b6dd-0946dbebdf73	5020	Network/Utility Expense	EXPENSE	\N	t	{}	2026-11-14 03:26:09.244317+00	2026-11-14 03:26:09.244317+00
\.


--
-- Data for Name: finance_journal_entries; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.finance_journal_entries (id, entry_no, entry_date, description, source_type, source_id, posted, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: finance_journal_lines; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.finance_journal_lines (id, entry_id, account_id, debit, credit, memo) FROM stdin;
\.


--
-- Data for Name: finance_transactions; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.finance_transactions (id, txn_date, txn_type, account_id, counter_account_id, method, amount, currency, reference_type, reference_id, subscriber_id, reseller_id, vendor_id, employee_id, description, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: finance_vouchers; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.finance_vouchers (id, voucher_no, voucher_type, date, party_type, party_id, amount, method, narration, status, lines, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: fup_enforcement_logs; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.fup_enforcement_logs (id, subscriber_id, action, over_cap, used_bytes, cap_gb, fup_speed_mbps, details, created_at) FROM stdin;
\.


--
-- Data for Name: hotspot_vouchers; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.hotspot_vouchers (id, batch_no, code, plan_name, package_name, price, duration_hours, data_limit_mb, status, subscriber_id, reseller_id, sold_at, activated_at, expires_at, notes, created_at, radius_synced, used_bytes, mac_address) FROM stdin;
\.


--
-- Data for Name: hr_attendance; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.hr_attendance (id, employee_id, att_date, status, check_in, check_out, notes, created_at) FROM stdin;
\.


--
-- Data for Name: hr_employees; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.hr_employees (id, employee_code, full_name, designation, department, role, phone, email, nid_number, address, joining_date, status, base_salary, commission_percent, meta, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: hr_leaves; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.hr_leaves (id, employee_id, leave_type, from_date, to_date, days, status, reason, approved_by, created_at) FROM stdin;
\.


--
-- Data for Name: hr_payroll_items; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.hr_payroll_items (id, payroll_run_id, employee_id, base_salary, commission, bonus, deductions, net_pay, notes, components) FROM stdin;
\.


--
-- Data for Name: hr_payroll_runs; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.hr_payroll_runs (id, period_month, status, total_amount, notes, created_by, created_at, posted_at) FROM stdin;
\.


--
-- Data for Name: installation_checklist_items; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.installation_checklist_items (id, order_id, item_text, is_required, is_completed, completed_at, completed_by, notes, sort_order) FROM stdin;
\.


--
-- Data for Name: installation_orders; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.installation_orders (id, order_no, subscriber_id, lead_id, order_type, status, priority, scheduled_date, scheduled_time_start, scheduled_time_end, assigned_technician_id, assigned_technician_name, site_address, site_latitude, site_longitude, site_contact_name, site_contact_phone, required_equipment, checklist, completion_notes, completion_photos, actual_start_at, actual_end_at, sla_due_at, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: inventory_items; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.inventory_items (id, name, category, brand, model, unit, reorder_level, created_at) FROM stdin;
08dc8980-41dd-423d-89bb-bc42bb63cf53	XPON ONU	ONT	VSOL	V2801SE	pcs	10	2026-11-14 03:27:41.573656+00
15b68c82-7f54-4bfb-8a3e-04ee08cccb0d	Fiber Patch Cord	Fiber	Generic	SC-UPC 3m	pcs	50	2026-11-14 03:27:41.573656+00
d2a7ebae-f79c-4047-adb6-1fe6459b37d1	Router	Router	MikroTik	hAP ax2	pcs	5	2026-11-14 03:27:41.573656+00
c17c0db2-2cdd-40d6-ae9c-c5d1d3e0fc00	BDCOM ONU/ONT	ONU	BDCOM	Switch	pcs	0	2026-11-15 06:46:56.004573+00
73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	VSOL ONU/ONT	ONU	VSOL	epon-olt	pcs	0	2026-11-15 06:46:56.037492+00
\.


--
-- Data for Name: inventory_serials; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.inventory_serials (id, item_id, warehouse_id, serial_number, mac_address, status, assigned_subscriber_id, notes, created_at, updated_at, source) FROM stdin;
ab96cbb9-3967-4834-8fb5-67c0d4575826	c17c0db2-2cdd-40d6-ae9c-c5d1d3e0fc00	\N	EPON0/1:7	0c:45:ba:81:64:a4	ASSIGNED	bb4ed432-7f51-48ef-b5a4-4e3821bb6e70	Auto-imported from OLT BDCOM P3310C (PON EPON0/1/7)	2026-11-15 06:46:56.009711+00	2026-11-15 06:46:56.009711+00	ONU_IMPORT
6faee7a3-d28a-482a-9ca1-81e0ec1a60f3	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON03ONU10_idc042@shumon	80:76:11:20:52:70	ASSIGNED	3510834a-8d5d-4cc4-915a-115ddbdc210b	Auto-imported from OLT VSOL V1600D (PON EPON0/3/10)	2026-11-15 06:46:56.041345+00	2026-11-15 06:46:56.041345+00	ONU_IMPORT
f56d9804-475d-4f23-8712-cc0b54e5f132	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON02ONU44_01301090060@jolil	4c:d7:c8:de:e1:ce	ASSIGNED	1ad4ce06-b07d-4486-9ec3-b06357b6a495	Auto-imported from OLT VSOL V1600D (PON EPON0/2/44)	2026-11-15 06:46:56.05671+00	2026-11-15 06:46:56.05671+00	ONU_IMPORT
048ced68-de2d-472c-8c32-59da6b34de2f	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON01ONU30_01353318105@rakib	\N	ASSIGNED	5abb8561-a44a-4b87-8502-ad15f3de20e0	Auto-imported from OLT VSOL V1600D (PON EPON0/1/30)	2026-11-15 06:46:56.075773+00	2026-11-15 06:46:56.075773+00	ONU_IMPORT
117fa5eb-817e-4623-b031-8f4d59286252	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON04ONU21_Humayon	a0:7e:02:22:03:50	ASSIGNED	d5aea95a-2500-4e9a-813a-c02a13aacf5a	Auto-imported from OLT VSOL V1600D (PON EPON0/4/21)	2026-11-15 06:46:56.092524+00	2026-11-15 06:46:56.092524+00	ONU_IMPORT
2f14e7df-b77c-4932-bd5d-9f47c0f4d1da	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON04ONU29_Sohag	\N	ASSIGNED	a6db6ec1-f74b-4387-8bde-ad6fa2b44326	Auto-imported from OLT VSOL V1600D (PON EPON0/4/29)	2026-11-15 06:46:56.111872+00	2026-11-15 06:46:56.111872+00	ONU_IMPORT
9f0afb7f-877a-4d7b-808a-bf0210510a98	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON04ONU16_Bellal-Ebadul	4c:ae:1c:34:fd:f0	ASSIGNED	599417ed-a723-4919-b81a-743ef862245f	Auto-imported from OLT VSOL V1600D (PON EPON0/4/16)	2026-11-15 06:46:56.127677+00	2026-11-15 06:46:56.127677+00	ONU_IMPORT
09941424-2189-4ace-b503-97b31100c391	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON04ONU10_Monirul_Belayet_er_More	d0:5f:af:2c:eb:e6	ASSIGNED	6b2c6d18-878f-4aee-927b-52dac43dac9d	Auto-imported from OLT VSOL V1600D (PON EPON0/4/10)	2026-11-15 06:46:56.141544+00	2026-11-15 06:46:56.141544+00	ONU_IMPORT
8374555e-6a0b-4ca1-a52c-7940a93dd586	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON04ONU9_Shujon_Moddhopara	c0:7e:40:62:41:65	ASSIGNED	e5c7e702-e138-4a9e-b7dd-22eca055a1d5	Auto-imported from OLT VSOL V1600D (PON EPON0/4/9)	2026-11-15 06:46:56.156823+00	2026-11-15 06:46:56.156823+00	ONU_IMPORT
ec5fd342-dd23-41a1-9402-7edc09f69e5a	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON04ONU7_Rezaul_Sheikh	00:d5:9e:ed:18:72	ASSIGNED	ec57ab5f-38af-44b3-80f9-d03103016644	Auto-imported from OLT VSOL V1600D (PON EPON0/4/7)	2026-11-15 06:46:56.17432+00	2026-11-15 06:46:56.17432+00	ONU_IMPORT
6b1115ac-9656-440e-9010-911aefd90c25	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON04ONU3_Alomgir_shop_home	6c:68:a4:62:d4:e4	ASSIGNED	6489984b-6f66-4330-86db-06172d6b248b	Auto-imported from OLT VSOL V1600D (PON EPON0/4/3)	2026-11-15 06:46:56.190414+00	2026-11-15 06:46:56.190414+00	ONU_IMPORT
53c2b7c2-2120-44ea-adea-e017f3b55f26	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON04ONU2_Alomgir_Shop	c0:7e:40:64:14:29	ASSIGNED	fd2f32b1-3f2d-4f5a-9c7b-dbcf0727b6f1	Auto-imported from OLT VSOL V1600D (PON EPON0/4/2)	2026-11-15 06:46:56.213259+00	2026-11-15 06:46:56.213259+00	ONU_IMPORT
ae33b263-2806-4206-b640-8603b576d395	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON03ONU9_Nazmul_Home	c4:70:0b:35:94:88	ASSIGNED	cc27c026-12d0-4358-93d8-5da3bc81dd6f	Auto-imported from OLT VSOL V1600D (PON EPON0/3/9)	2026-11-15 06:46:56.227544+00	2026-11-15 06:46:56.227544+00	ONU_IMPORT
6bd75037-ba97-45fc-ac66-1acd0e194963	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON03ONU4_Nazmul_er_ma	\N	ASSIGNED	66a935cb-bfdf-42c7-a3f2-971e17dd6b93	Auto-imported from OLT VSOL V1600D (PON EPON0/3/4)	2026-11-15 06:46:56.242652+00	2026-11-15 06:46:56.242652+00	ONU_IMPORT
6938f0f7-5a46-4a79-b098-b8968f13cd97	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON03ONU2_Salam	00:d3:9f:77:91:66	ASSIGNED	125536ef-b053-4faf-8882-24aebc8b34f1	Auto-imported from OLT VSOL V1600D (PON EPON0/3/2)	2026-11-15 06:46:56.258756+00	2026-11-15 06:46:56.258756+00	ONU_IMPORT
8668491a-845b-4227-a952-1ef49ab0b747	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON02ONU43_Nirapod_Putimari_Dhalipara	00:d3:9e:b7:4b:c0	ASSIGNED	b43ba3a5-d757-4e07-b08e-f22bfad6c4a2	Auto-imported from OLT VSOL V1600D (PON EPON0/2/43)	2026-11-15 06:46:56.272766+00	2026-11-15 06:46:56.272766+00	ONU_IMPORT
58846833-e3d0-4f52-bb15-459fe64aec2f	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON02ONU25_Shofik_poschimpara	\N	ASSIGNED	17bc85cf-503c-413d-9d78-b8a2a0468d39	Auto-imported from OLT VSOL V1600D (PON EPON0/2/25)	2026-11-15 06:46:56.28976+00	2026-11-15 06:46:56.28976+00	ONU_IMPORT
34fac430-47f0-46d9-831e-2f8833486cae	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON02ONU18_idc107@rabeya	00:d5:9f:70:3d:f2	ASSIGNED	80e1ebe9-c6c7-4b79-b52b-2115cb3617e5	Auto-imported from OLT VSOL V1600D (PON EPON0/2/18)	2026-11-15 06:46:56.314576+00	2026-11-15 06:46:56.314576+00	ONU_IMPORT
b7372059-04d6-4980-8214-03b9add58328	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON02ONU16_Masum	98:c7:a4:35:23:e2	ASSIGNED	fe17a6ee-5d04-4333-ad1a-42e4f5f738ac	Auto-imported from OLT VSOL V1600D (PON EPON0/2/16)	2026-11-15 06:46:56.332822+00	2026-11-15 06:46:56.332822+00	ONU_IMPORT
d04c7d59-fa4e-4492-97be-06f0a2b23d18	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON02ONU12_Masum_Putimari_Bazar	1c:ef:03:df:a9:74	ASSIGNED	51386a76-12c4-40dc-9b90-4d706cfcd12d	Auto-imported from OLT VSOL V1600D (PON EPON0/2/12)	2026-11-15 06:46:56.352264+00	2026-11-15 06:46:56.352264+00	ONU_IMPORT
c391e633-d9d5-49b2-b05d-71cefdacbfa2	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON02ONU10_Ridoy_RAB	6c:68:a4:6f:43:b4	ASSIGNED	57e677be-22d6-4438-9092-c072d4078bc0	Auto-imported from OLT VSOL V1600D (PON EPON0/2/10)	2026-11-15 06:46:56.368171+00	2026-11-15 06:46:56.368171+00	ONU_IMPORT
dc2b3bf4-93c1-4c31-a956-889a307c6352	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON02ONU5_Elias	54:93:59:22:88:82	ASSIGNED	7e7ac0af-af6f-4e8a-9a74-afa48529c2c4	Auto-imported from OLT VSOL V1600D (PON EPON0/2/5)	2026-11-15 06:46:56.383463+00	2026-11-15 06:46:56.383463+00	ONU_IMPORT
54849e26-e6e6-40b1-a84c-f4385f9b6ab3	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON02ONU3_idc116@anik	4c:ae:1c:aa:4b:68	ASSIGNED	8588d23b-dccd-4b31-a5e8-d46bf89a2d18	Auto-imported from OLT VSOL V1600D (PON EPON0/2/3)	2026-11-15 06:46:56.396281+00	2026-11-15 06:46:56.396281+00	ONU_IMPORT
57f7c95a-95f8-4b23-8824-de5e4f886cf7	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON02ONU1_Isa_Dhalipara	4c:ae:1c:aa:49:98	ASSIGNED	2ab7a28b-5291-4d43-aa76-c68e93ec5c83	Auto-imported from OLT VSOL V1600D (PON EPON0/2/1)	2026-11-15 06:46:56.412371+00	2026-11-15 06:46:56.412371+00	ONU_IMPORT
b579152b-ea40-4e0b-83dc-a86d58a46c1d	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON01ONU29_Bokkar	\N	ASSIGNED	0c451c5f-976c-422b-97fc-baf19c15b3a3	Auto-imported from OLT VSOL V1600D (PON EPON0/1/29)	2026-11-15 06:46:56.430318+00	2026-11-15 06:46:56.430318+00	ONU_IMPORT
cfb02a42-d3d0-42b1-b22c-ded6cc301519	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON01ONU26_Arif_2NoPolli	a2:3e:06:15:35:80	ASSIGNED	23ef88d9-1994-4b84-80dd-e600dac30c8a	Auto-imported from OLT VSOL V1600D (PON EPON0/1/26)	2026-11-15 06:46:56.453376+00	2026-11-15 06:46:56.453376+00	ONU_IMPORT
fe2e3cf2-7d2d-4c98-a242-bd11fa50ba2f	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON01ONU25_Shayla	a2:4e:12:23:7a:10	ASSIGNED	cafdc77f-60fc-4f52-983f-e55e564a3e57	Auto-imported from OLT VSOL V1600D (PON EPON0/1/25)	2026-11-15 06:46:56.481789+00	2026-11-15 06:46:56.481789+00	ONU_IMPORT
618a00ae-99ea-4fe6-a847-89eecf5bb7fb	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON01ONU23_Rabeya	54:93:59:22:89:a2	ASSIGNED	2be7dc87-3429-4c18-9192-e7b3980d38dc	Auto-imported from OLT VSOL V1600D (PON EPON0/1/23)	2026-11-15 06:46:56.494839+00	2026-11-15 06:46:56.494839+00	ONU_IMPORT
8e8a711a-e1c8-4434-ad4e-2378aab4bfb6	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON01ONU21_Sufi_Khadija	\N	ASSIGNED	af07ad2c-5847-4302-a1ad-f22f738990ed	Auto-imported from OLT VSOL V1600D (PON EPON0/1/21)	2026-11-15 06:46:56.506942+00	2026-11-15 06:46:56.506942+00	ONU_IMPORT
23f404dd-5b71-4560-938e-1e4ea6d68cf6	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON01ONU20_Jolil	\N	ASSIGNED	7ea3a587-1e2c-46bf-9373-493c25838cb9	Auto-imported from OLT VSOL V1600D (PON EPON0/1/20)	2026-11-15 06:46:56.521267+00	2026-11-15 06:46:56.521267+00	ONU_IMPORT
07daaaa2-d430-49d1-b31a-707e96e7c53c	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON01ONU18_Alomgir_2_no_polli	\N	ASSIGNED	0759bf23-4a8a-48e2-a77c-435028988c34	Auto-imported from OLT VSOL V1600D (PON EPON0/1/18)	2026-11-15 06:46:56.53621+00	2026-11-15 06:46:56.53621+00	ONU_IMPORT
e28a65e9-f35d-42a1-b9f4-13d9da814aaf	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON01ONU16_Amanullah_Imam	70:a5:6a:cd:80:b4	ASSIGNED	f8d61e64-1b54-4d00-8c02-2cedd7750306	Auto-imported from OLT VSOL V1600D (PON EPON0/1/16)	2026-11-15 06:46:56.550649+00	2026-11-15 06:46:56.550649+00	ONU_IMPORT
f847be2f-8ed6-4edf-a131-2b306510a950	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON01ONU14_Alif_1no_polli	a2:3e:07:17:3c:00	ASSIGNED	535fbc00-0bd6-48b2-9143-42ce9e5955d5	Auto-imported from OLT VSOL V1600D (PON EPON0/1/14)	2026-11-15 06:46:56.566538+00	2026-11-15 06:46:56.566538+00	ONU_IMPORT
3004a787-7cf3-459a-8894-2e07081e5418	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON01ONU13_Pria	6c:68:a4:6f:c4:f4	ASSIGNED	67dc5e8a-0b28-4900-91c9-8dcfe776b0a2	Auto-imported from OLT VSOL V1600D (PON EPON0/1/13)	2026-11-15 06:46:56.586217+00	2026-11-15 06:46:56.586217+00	ONU_IMPORT
c4e0d124-a816-4255-8429-3f9d86f44245	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON01ONU12_Roshid	d0:5f:af:2c:e9:58	ASSIGNED	1165b6d4-4ab0-43d7-b534-1db9b7400b37	Auto-imported from OLT VSOL V1600D (PON EPON0/1/12)	2026-11-15 06:46:56.599716+00	2026-11-15 06:46:56.599716+00	ONU_IMPORT
b17e41a5-5fc4-4d4a-9522-35eaa8674cc3	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON01ONU11_Hasan-Reseller	\N	ASSIGNED	67cf3639-a816-4e29-a106-784d11312638	Auto-imported from OLT VSOL V1600D (PON EPON0/1/11)	2026-11-15 06:46:56.612849+00	2026-11-15 06:46:56.612849+00	ONU_IMPORT
44bf1055-ed21-4038-af9d-cad7e9c37ab7	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON01ONU5_Manjarul-Noyon	00:d3:9f:76:cd:dc	ASSIGNED	87a16536-1961-45a3-a329-21df14b91b0a	Auto-imported from OLT VSOL V1600D (PON EPON0/1/5)	2026-11-15 06:46:56.625304+00	2026-11-15 06:46:56.625304+00	ONU_IMPORT
8b732b4a-f1e4-45ca-a5c0-0c5e24d3c1a6	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON01ONU4_Jubaer	a0:7d:12:20:65:70	ASSIGNED	e7e4349b-b6c6-445d-8544-3d0a378aeeaf	Auto-imported from OLT VSOL V1600D (PON EPON0/1/4)	2026-11-15 06:46:56.64079+00	2026-11-15 06:46:56.64079+00	ONU_IMPORT
f3700fd4-4100-47af-aa58-2ebc40dcb057	c17c0db2-2cdd-40d6-ae9c-c5d1d3e0fc00	\N	EPON0/3:1	98:c7:a4:34:bb:36	ASSIGNED	a903542e-76a5-4122-a00c-e47ff9d4d057	Auto-imported from OLT BDCOM P3310C (PON EPON0/3/1)	2026-11-15 06:46:56.654964+00	2026-11-15 06:46:56.654964+00	ONU_IMPORT
95e96c2a-d414-4de5-88a2-d54f3de325d2	c17c0db2-2cdd-40d6-ae9c-c5d1d3e0fc00	\N	EPON0/1:15	08:e8:4f:12:48:25	ASSIGNED	ada5f420-e833-4ae9-9c3d-099eecc8203b	Auto-imported from OLT BDCOM P3310C (PON EPON0/1/15)	2026-11-15 06:46:56.666356+00	2026-11-15 06:46:56.666356+00	ONU_IMPORT
0aca34b4-3ad3-4c99-ae8c-c55a5bd78824	c17c0db2-2cdd-40d6-ae9c-c5d1d3e0fc00	\N	EPON0/3:6	00:6d:61:63:8f:18	ASSIGNED	a1b55cd8-e554-457e-98fe-75aafeb2d8f1	Auto-imported from OLT BDCOM P3310C (PON EPON0/3/6)	2026-11-15 06:46:56.679993+00	2026-11-15 06:46:56.679993+00	ONU_IMPORT
46dbdd49-b6b4-4df7-839a-dfae0086556e	c17c0db2-2cdd-40d6-ae9c-c5d1d3e0fc00	\N	EPON0/1:8	a2:3e:07:17:3c:e0	ASSIGNED	b62bc557-4831-4245-90fe-5a97cc8e20dd	Auto-imported from OLT BDCOM P3310C (PON EPON0/1/8)	2026-11-15 06:46:56.692214+00	2026-11-15 06:46:56.692214+00	ONU_IMPORT
78f13242-e5a5-4ea9-9e7b-ad20368e3362	c17c0db2-2cdd-40d6-ae9c-c5d1d3e0fc00	\N	EPON0/1:11	a0:7e:08:18:34:00	ASSIGNED	933406e7-d44d-4dd2-9e64-7d9a5f66e803	Auto-imported from OLT BDCOM P3310C (PON EPON0/1/11)	2026-11-15 06:46:56.705091+00	2026-11-15 06:46:56.705091+00	ONU_IMPORT
27cd3dad-0a17-448e-ba93-1725fe075e10	c17c0db2-2cdd-40d6-ae9c-c5d1d3e0fc00	\N	EPON0/1:10	a2:3e:05:23:18:e0	ASSIGNED	30488228-7d5b-4074-87a8-294d66c0cb3a	Auto-imported from OLT BDCOM P3310C (PON EPON0/1/10)	2026-11-15 06:46:56.718211+00	2026-11-15 06:46:56.718211+00	ONU_IMPORT
8013876f-8c0e-45d2-bc53-586aecdd4040	c17c0db2-2cdd-40d6-ae9c-c5d1d3e0fc00	\N	EPON0/1:9	a2:3e:05:23:03:d0	ASSIGNED	02b97ebf-1a80-4c3d-a87a-305b58e9fa61	Auto-imported from OLT BDCOM P3310C (PON EPON0/1/9)	2026-11-15 06:46:56.734484+00	2026-11-15 06:46:56.734484+00	ONU_IMPORT
6656cb5f-c597-4ab3-b73d-1107ba301266	73e7c1a8-dd60-4e15-8ddf-01da55b62fbb	\N	EPON04ONU24_Raju	\N	ASSIGNED	67da9dc9-facc-4d12-857d-10505ce4d2db	Auto-imported from OLT VSOL V1600D (PON EPON0/4/24)	2026-11-15 06:55:27.359277+00	2026-11-15 06:55:27.359277+00	ONU_IMPORT
\.


--
-- Data for Name: inventory_warehouses; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.inventory_warehouses (id, name, location, created_at) FROM stdin;
03afee2b-c67e-4cb4-ab16-0d22c408c20d	Main Warehouse	Dhaka HQ	2026-11-14 03:27:41.570526+00
b2201443-3ebc-4d55-84f4-a48bd75adb3b	Field Store - Mirpur	Mirpur	2026-11-14 03:27:41.570526+00
\.


--
-- Data for Name: invoice_items; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.invoice_items (id, invoice_id, description, item_type, quantity, unit_price, amount, metadata) FROM stdin;
\.


--
-- Data for Name: invoices; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.invoices (id, invoice_number, subscriber_id, client_code, subscriber_name, username, billing_cycle, bill_month, period_start, period_end, issue_date, due_date, amount, discount, tax, total_amount, paid_amount, due_amount, status, notes, metadata, prorated, prorate_ratio, created_at, updated_at, paid_at) FROM stdin;
\.


--
-- Data for Name: kyc_documents; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.kyc_documents (id, subscriber_id, doc_type, file_name, file_path, mime_type, uploaded_at) FROM stdin;
\.


--
-- Data for Name: lead_activities; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.lead_activities (id, lead_id, activity_type, subject, description, outcome, scheduled_at, completed_at, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: leads; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.leads (id, lead_no, full_name, phone, email, address, latitude, longitude, area_id, zone_id, interested_package, source, status, priority, assigned_to, notes, metadata, converted_subscriber_id, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: message_logs; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.message_logs (id, channel_type, provider, channel_id, direction, recipient, subject, body, status, provider_message_id, related_type, related_id, payload, error_message, sent_at, created_at) FROM stdin;
\.


--
-- Data for Name: message_templates; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.message_templates (id, name, channel_type, purpose, subject, body, variables, is_active, created_at, updated_at) FROM stdin;
257ae270-d23d-4e14-88a9-3e6fad358b9e	invoice_due_reminder_sms	SMS	INVOICE_REMINDER	\N	Dear {{name}}, your invoice {{invoice_no}} amount {{amount}} is due on {{due_date}}. Please pay to avoid service interruption. - {{brand}}	["name", "invoice_no", "amount", "due_date", "brand"]	t	2026-11-14 03:25:38.056161+00	2026-11-14 03:25:38.056161+00
96b8406c-63af-4b38-abdf-beb739a2d1a2	payment_received_sms	SMS	PAYMENT_RECEIVED	\N	Payment received: {{amount}} for {{invoice_no}} ({{trx_id}}). Thank you. - {{brand}}	["amount", "invoice_no", "trx_id", "brand"]	t	2026-11-14 03:25:38.056161+00	2026-11-14 03:25:38.056161+00
f007d3bc-fb6f-4d3b-8546-056525c43d70	invoice_delivery_whatsapp	WHATSAPP	INVOICE_DELIVERY	Invoice {{invoice_no}}	Hello {{name}}, your invoice {{invoice_no}} ({{amount}}) is ready. Due date: {{due_date}}. Invoice PDF: {{pdf_url}}	["name", "invoice_no", "amount", "due_date", "pdf_url"]	t	2026-11-14 03:25:38.056161+00	2026-11-14 03:25:38.056161+00
199dcc27-033e-4715-a931-00e932775299	noc_alert_telegram	TELEGRAM	NOC_ALERT	\N	🚨 NOC Alert: {{title}}\\n{{details}}\\nTime: {{time}}	["title", "details", "time"]	t	2026-11-14 03:25:38.056161+00	2026-11-14 03:25:38.056161+00
bbc91ceb-eafa-437b-92b1-19b551d1f8d2	daily_revenue_summary_telegram	TELEGRAM	DAILY_REVENUE_SUMMARY	\N	📊 Daily Revenue Summary ({{date}})\\nCollections: {{collections}}\\nInvoices: {{invoices}}\\nDue Outstanding: {{outstanding}}	["date", "collections", "invoices", "outstanding"]	t	2026-11-14 03:25:38.056161+00	2026-11-14 03:25:38.056161+00
\.


--
-- Data for Name: messaging_channels; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.messaging_channels (id, name, channel_type, provider, enabled, is_default, config, credentials, webhook_secret, sender_id, notes, created_at, updated_at) FROM stdin;
98898ed6-dde8-408d-8f78-9dba563238b5	BD Local SMS (GreenWeb)	SMS	GREENWEB	f	t	{"mode": "LOCAL", "country": "BD"}	{}	\N	\N	\N	2026-11-14 03:25:38.056161+00	2026-11-14 03:25:38.056161+00
92cde71c-c526-4ccb-98c6-a1a089564188	Twilio SMS (International)	SMS	TWILIO	f	f	{"mode": "INTERNATIONAL"}	{}	\N	\N	\N	2026-11-14 03:25:38.056161+00	2026-11-14 03:25:38.056161+00
0097e0f0-dc9f-4886-8574-84a3ad08d1b3	WhatsApp Business API	WHATSAPP	META_CLOUD	f	t	{"supports": "invoice_pdf,templates"}	{}	\N	\N	\N	2026-11-14 03:25:38.056161+00	2026-11-14 03:25:38.056161+00
62e40d8c-2a29-4cab-9a8a-ad25fe241483	Telegram Bot	TELEGRAM	TELEGRAM_BOT	f	t	{"supports": "noc_alerts,daily_revenue_summary"}	{}	\N	\N	\N	2026-11-14 03:25:38.056161+00	2026-11-14 03:25:38.056161+00
\.


--
-- Data for Name: nas; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.nas (id, nasname, shortname, type, ports, secret, server, community, description) FROM stdin;
\.


--
-- Data for Name: network_routers; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.network_routers (id, name, host, api_port, rest_port, username, password, router_type, ros_version, use_ssl, site, wg_peer_id, is_enabled, last_seen_at, status, cpu_load, memory_used_mb, memory_total_mb, uptime_seconds, rx_bps, tx_bps, identity, board_name, created_at, updated_at, integration_mode, radius_secret, coa_port, nas_identifier) FROM stdin;
d0a742a6-7b95-47a7-96a2-e0af96569ed1	RB1100AHX4 (WG 10.77.0.2)	10.77.0.2	8730	\N	izandesk	Sariful@27091	MIKROTIK	v7	f	\N	\N	t	2026-11-15 07:35:28.298+00	ONLINE	8.00	596.70	1024.00	3583293	0	0	Tenda	RB1100AHx4 Dude Edition	2026-11-14 07:57:29.077342+00	2026-11-15 07:35:28.299114+00	API	\N	3799	\N
\.


--
-- Data for Name: olts; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.olts (id, name, vendor, model, host, ssh_port, snmp_port, username, password, snmp_community, site, wg_peer_id, is_enabled, status, last_seen_at, temperature_c, uptime_seconds, total_ports, created_at, updated_at) FROM stdin;
18b9831d-d60f-4ef0-99c7-b616ac1dde8d	BDCOM P3310C	BDCOM	Switch	10.5.0.101	22	161	Sariful	Sariful27091	public	OLT Site	a12c0ea0-2926-445c-bbec-a2d3ad9cbfb4	t	ONLINE	2026-11-14 13:23:24.01914+00	\N	\N	0	2026-11-14 09:03:56.028947+00	2026-11-14 13:23:24.01914+00
7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	VSOL V1600D	VSOL	epon-olt	10.5.0.100	22	161	Sariful	Sariful27091	public	OLT Site	a12c0ea0-2926-445c-bbec-a2d3ad9cbfb4	t	ONLINE	2026-11-14 13:23:59.930193+00	\N	\N	0	2026-11-14 09:03:55.983468+00	2026-11-14 13:23:59.930193+00
\.


--
-- Data for Name: onus; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.onus (id, olt_id, pon_port, onu_id, serial_number, name, subscriber_id, status, rx_power_dbm, tx_power_dbm, distance_m, last_down_cause, authorized_at, last_seen_at, created_at, updated_at, mac_address, temperature_c, voltage_v, tx_bias_ma, inventory_serial_id) FROM stdin;
a086f95e-7db0-4ce9-85b5-579ee3b47e56	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	1	EPON02ONU1_Isa_Dhalipara	EPON02ONU1 Isa_Dhalipara	2ab7a28b-5291-4d43-aa76-c68e93ec5c83	ONLINE	-26.02	2.58	2764	\N	\N	2026-11-14 13:23:59.617727+00	2026-11-14 09:08:44.362043+00	2026-11-15 06:46:56.414904+00	4c:ae:1c:aa:49:98	41.19	3.21	14.80	57f7c95a-95f8-4b23-8824-de5e4f886cf7
07401107-e9dc-47bf-aecc-0c1d630d5392	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	20	EPON01ONU20_Jolil	EPON01ONU20 Jolil	7ea3a587-1e2c-46bf-9373-493c25838cb9	ONLINE	-26.38	2.27	972	\N	\N	2026-11-14 13:23:59.567278+00	2026-11-14 09:08:44.309984+00	2026-11-15 06:46:56.523442+00	\N	50.36	3.28	8.35	23f404dd-5b71-4560-938e-1e4ea6d68cf6
dfaba31d-7b44-43b3-96e8-38e000c9c49a	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	16	EPON01ONU16_Amanullah_Imam	EPON01ONU16 Amanullah_Imam	f8d61e64-1b54-4d00-8c02-2cedd7750306	ONLINE	-8.65	2.04	861	\N	\N	2026-11-14 13:23:59.552299+00	2026-11-14 09:08:44.290253+00	2026-11-15 06:46:56.552682+00	70:a5:6a:cd:80:b4	49.00	3.23	9.00	e28a65e9-f35d-42a1-b9f4-13d9da814aaf
30225930-89cc-4ceb-9ef1-c8cdc59d6661	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	2	EPON02ONU2_Jannatul	EPON02ONU2 Jannatul	\N	ONLINE	-19.17	2.83	2269	\N	\N	2026-11-14 13:23:59.622434+00	2026-11-14 09:08:44.366344+00	2026-11-14 13:23:59.622434+00	c0:7e:40:69:2f:2d	49.41	3.28	7.68	\N
7da32e9d-e4d2-442e-8897-d1e00d7856dd	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	24	EPON01ONU24_Rubel	EPON01ONU24 Rubel	\N	ONLINE	-26.20	1.90	1056	\N	\N	2026-11-14 13:23:59.583895+00	2026-11-14 09:08:44.325606+00	2026-11-14 13:23:59.583895+00	54:93:59:22:71:06	48.95	3.34	17.50	\N
5ac38277-5e84-409f-affd-2f4448eb2bf3	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	26	EPON01ONU26_Arif_2NoPolli	EPON01ONU26 Arif_2NoPolli	23ef88d9-1994-4b84-80dd-e600dac30c8a	ONLINE	-15.92	1.89	841	\N	\N	2026-11-14 13:23:59.59261+00	2026-11-14 09:08:44.335739+00	2026-11-15 06:46:56.458258+00	a2:3e:06:15:35:80	43.00	3.26	13.00	cfb02a42-d3d0-42b1-b22c-ded6cc301519
b65e0e66-cc8b-4b9a-a1e6-6a61d519d10c	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	1	EPON01ONU1_Joshim_shop	EPON01ONU1 Joshim_shop	\N	ONLINE	-18.51	2.44	788	\N	\N	2026-11-14 13:23:59.502974+00	2026-11-14 09:08:44.219173+00	2026-11-14 13:23:59.502974+00	e0:67:b3:39:90:33	40.00	3.25	18.00	\N
968e1441-54c0-4f63-a830-cddd7bf94a7b	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	21	EPON01ONU21_Sufi_Khadija	EPON01ONU21 Sufi_Khadija	af07ad2c-5847-4302-a1ad-f22f738990ed	ONLINE	-20.60	1.91	931	\N	\N	2026-11-14 13:23:59.571099+00	2026-11-14 09:08:44.313985+00	2026-11-15 06:46:56.510705+00	\N	39.57	3.21	14.05	8e8a711a-e1c8-4434-ad4e-2378aab4bfb6
2c15a965-476d-4b07-a8b2-f9565270ebac	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	23	EPON01ONU23_Rabeya	EPON01ONU23 Rabeya	2be7dc87-3429-4c18-9192-e7b3980d38dc	ONLINE	-14.65	1.72	829	\N	\N	2026-11-14 13:23:59.579514+00	2026-11-14 09:08:44.321947+00	2026-11-15 06:46:56.497028+00	54:93:59:22:89:a2	47.41	3.25	11.41	618a00ae-99ea-4fe6-a847-89eecf5bb7fb
2c5ff284-273a-48a5-8996-4c044c293810	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	18	EPON01ONU18_Alomgir_2_no_polli	EPON01ONU18 Alomgir_2_no_polli	0759bf23-4a8a-48e2-a77c-435028988c34	ONLINE	-12.51	2.73	820	\N	\N	2026-11-14 13:23:59.559787+00	2026-11-14 09:08:44.302477+00	2026-11-15 06:46:56.538312+00	\N	56.88	3.21	20.10	07daaaa2-d430-49d1-b31a-707e96e7c53c
7a576537-1ab9-4288-915f-f9902dd47fab	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	15	EPON01ONU15_Hasan_3No_Polli	EPON01ONU15 Hasan_3No_Polli	\N	OFFLINE	\N	\N	0	\N	\N	2026-11-14 13:23:59.548772+00	2026-11-14 09:08:44.286114+00	2026-11-14 13:23:59.548772+00	a2:3e:05:23:19:d0	\N	\N	\N	\N
156e2beb-1ae5-457c-88ec-ee5bc39c6438	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	7	EPON01ONU7	EPON01ONU7	\N	ONLINE	-15.32	2.40	810	\N	\N	2026-11-14 13:23:59.52012+00	2026-11-14 09:08:44.24986+00	2026-11-14 13:23:59.52012+00	d4:f9:a1:86:13:ed	40.00	3.22	6.00	\N
8a5f1735-4366-4c62-ab2f-b6ebc697dc4f	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	9	EPON02ONU9_Mamun	EPON02ONU9 Mamun	\N	ONLINE	-17.90	1.46	2646	\N	\N	2026-11-14 13:23:59.650966+00	2026-11-14 09:08:44.392394+00	2026-11-14 13:23:59.650966+00	80:76:12:61:1e:00	27.11	3.25	12.45	\N
8362a8c2-c44f-43a9-861f-bea1db234e2e	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	14	EPON02ONU14_Zahid_Kobirazpara	EPON02ONU14 Zahid_Kobirazpara	\N	ONLINE	-21.02	2.13	2216	\N	\N	2026-11-14 13:23:59.671042+00	2026-11-14 09:08:44.414926+00	2026-11-14 13:23:59.671042+00	00:d3:9f:76:b6:e4	40.00	3.28	10.00	\N
b6b63a3c-7f4c-4c2d-8a4c-705cc5694d71	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	8	EPON01ONU8_Hasan3noPolli	EPON01ONU8 Hasan3noPolli	\N	ONLINE	-16.72	1.73	3013	\N	\N	2026-11-14 13:23:59.523625+00	2026-11-14 09:08:44.254927+00	2026-11-14 13:23:59.523625+00	\N	57.52	3.18	15.40	\N
b008d3a2-6458-479e-b9ef-e03e8ab090f4	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	10	EPON01ONU10_Sakib	EPON01ONU10 Sakib	\N	OFFLINE	\N	\N	938	\N	\N	2026-11-14 13:23:59.531215+00	2026-11-14 09:08:44.263215+00	2026-11-14 13:23:59.531215+00	c8:3a:35:78:52:f0	\N	\N	\N	\N
189ab22c-0266-419f-8629-fd86fd62b2e5	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	5	EPON01ONU5_Manjarul-Noyon	EPON01ONU5 Manjarul-Noyon	87a16536-1961-45a3-a329-21df14b91b0a	ONLINE	-22.01	3.10	951	\N	\N	2026-11-14 13:23:59.516726+00	2026-11-14 09:08:44.242929+00	2026-11-15 06:46:56.628662+00	00:d3:9f:76:cd:dc	32.00	3.42	9.75	44bf1055-ed21-4038-af9d-cad7e9c37ab7
1bead4cc-6103-4a37-b782-df1f6aa25bb5	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	13	EPON01ONU13_Pria	EPON01ONU13 Pria	67dc5e8a-0b28-4900-91c9-8dcfe776b0a2	ONLINE	3.16	2.74	872	\N	\N	2026-11-14 13:23:59.541294+00	2026-11-14 09:08:44.277133+00	2026-11-15 06:46:56.589022+00	6c:68:a4:6f:c4:f4	43.63	3.24	13.05	3004a787-7cf3-459a-8894-2e07081e5418
1678966d-2906-486b-9487-66da7cd4c25a	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	6	EPON02ONU6_Shourov	EPON02ONU6 Shourov	\N	ONLINE	-22.68	1.98	2739	\N	\N	2026-11-14 13:23:59.641693+00	2026-11-14 09:08:44.385051+00	2026-11-14 13:23:59.641693+00	\N	42.00	3.22	10.00	\N
05cccce1-d3c1-44d7-9e71-0045de0a7613	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	17	EPON01ONU17_Mridul	EPON01ONU17 Mridul	\N	ONLINE	-19.55	2.45	985	\N	\N	2026-11-14 13:23:59.556155+00	2026-11-14 09:08:44.297642+00	2026-11-14 13:23:59.556155+00	\N	38.00	3.29	7.00	\N
bd7f597a-4588-4779-aca1-16a0e0b91c94	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	11	EPON01ONU11_Hasan-Reseller	EPON01ONU11 Hasan-Reseller	67cf3639-a816-4e29-a106-784d11312638	ONLINE	-21.94	2.26	1080	\N	\N	2026-11-14 13:23:59.534663+00	2026-11-14 09:08:44.268027+00	2026-11-15 06:46:56.615048+00	\N	37.00	3.33	17.00	b17e41a5-5fc4-4d4a-9522-35eaa8674cc3
94a9744d-2b56-4548-9477-54b5378e5662	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	22	EPON01ONU22_Hasantv1	EPON01ONU22 Hasantv1	\N	ONLINE	-18.89	2.05	1056	\N	\N	2026-11-14 13:23:59.575294+00	2026-11-14 09:08:44.318224+00	2026-11-14 13:23:59.575294+00	a2:3e:06:15:35:60	37.00	3.32	16.00	\N
330faf74-283d-46c0-82a2-c43bf115cb0e	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	19	EPON01ONU19	EPON01ONU19	\N	ONLINE	-28.86	2.40	1070	\N	\N	2026-11-14 13:23:59.563514+00	2026-11-14 09:08:44.306299+00	2026-11-14 13:23:59.563514+00	a0:7e:03:21:7e:40	31.62	3.24	12.45	\N
ffc0d56f-cf3a-455d-bb70-0a87c29c3e5d	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	32	EPON01ONU32_01730463437@ballal	EPON01ONU32 01730463437@ballal	\N	ONLINE	-21.94	1.88	1133	\N	\N	2026-11-14 13:23:59.608782+00	2026-11-14 09:08:44.353791+00	2026-11-14 13:23:59.608782+00	80:66:29:0c:1e:5d	37.00	3.24	7.00	\N
5f5b3e78-a349-41c1-98c4-5e9c8234a85c	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	12	EPON02ONU12_Masum_Putimari_Bazar	EPON02ONU12 Masum_Putimari_Bazar	51386a76-12c4-40dc-9b90-4d706cfcd12d	ONLINE	-13.89	2.13	1379	\N	\N	2026-11-14 13:23:59.663095+00	2026-11-14 09:08:44.406317+00	2026-11-15 06:46:56.355564+00	1c:ef:03:df:a9:74	37.00	3.29	18.00	d04c7d59-fa4e-4492-97be-06f0a2b23d18
a9acf6e2-8305-4246-baf9-062dfbde012c	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	28	EPON01ONU28_Hanif	EPON01ONU28 Hanif	\N	ONLINE	-23.67	1.98	1269	\N	\N	2026-11-14 13:23:59.596261+00	2026-11-14 09:08:44.342023+00	2026-11-14 13:23:59.596261+00	a2:3e:05:23:83:f0	29.82	3.27	20.60	\N
f04f8f07-62b5-46d8-8cf7-e9398b98e0a8	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	31	EPON01ONU31_Imran_2no_polli	EPON01ONU31 Imran_2no_polli	\N	OFFLINE	\N	\N	857	\N	\N	2026-11-14 13:23:59.604672+00	2026-11-14 09:08:44.349451+00	2026-11-14 13:23:59.604672+00	\N	\N	\N	\N	\N
353d7737-f565-4927-a669-2cadc63964a3	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	33	EPON01ONU33_01990654114@romjan	EPON01ONU33 01990654114@romjan	\N	ONLINE	-23.57	1.93	882	\N	\N	2026-11-14 13:23:59.613096+00	2026-11-14 09:08:44.35774+00	2026-11-14 13:23:59.613096+00	\N	42.00	3.32	11.00	\N
9930f5d1-6d45-4a44-9a75-ce7c11d9d413	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	29	EPON01ONU29_Bokkar	EPON01ONU29 Bokkar	0c451c5f-976c-422b-97fc-baf19c15b3a3	ONLINE	-16.58	1.41	1213	\N	\N	2026-11-14 13:23:59.60057+00	2026-11-14 09:08:44.345985+00	2026-11-15 06:46:56.437233+00	\N	25.75	3.31	16.50	b579152b-ea40-4e0b-83dc-a86d58a46c1d
d4b777b0-ef7a-4e7e-bc01-40478ea93df5	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	9	EPON01ONU9_Project	EPON01ONU9 Project	\N	ONLINE	-16.84	2.10	1067	\N	\N	2026-11-14 13:23:59.527496+00	2026-11-14 09:08:44.258758+00	2026-11-14 13:23:59.527496+00	70:a5:6a:0b:17:de	41.00	3.28	12.00	\N
adc08f71-45b7-43f7-9ec2-dec339f864f5	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	4	EPON02ONU4_Ac047Sobuz	EPON02ONU4 Ac047Sobuz	\N	ONLINE	-16.02	2.40	2592	\N	\N	2026-11-14 13:23:59.63297+00	2026-11-14 09:08:44.375907+00	2026-11-14 13:23:59.63297+00	80:b5:75:21:87:07	52.54	3.39	19.16	\N
b8cc9987-b88a-4dd4-90d1-68ae2d0edd50	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	13	EPON02ONU13_Lucky	EPON02ONU13 Lucky	\N	ONLINE	-18.07	2.81	1992	\N	\N	2026-11-14 13:23:59.667682+00	2026-11-14 09:08:44.41019+00	2026-11-14 13:23:59.667682+00	\N	42.23	3.24	14.75	\N
166d1961-eb41-435b-8a97-16c4395e3810	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	11	EPON02ONU11	EPON02ONU11	\N	ONLINE	-15.39	2.16	1815	\N	\N	2026-11-14 13:23:59.658911+00	2026-11-14 09:08:44.401499+00	2026-11-14 13:23:59.658911+00	70:a5:6a:e2:bd:fe	42.00	3.30	16.00	\N
f5c1c690-8e78-4363-8eab-c9c78d470b1c	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	5	EPON02ONU5_Elias	EPON02ONU5 Elias	7e7ac0af-af6f-4e8a-9a74-afa48529c2c4	ONLINE	-20.00	2.03	3074	\N	\N	2026-11-14 13:23:59.63748+00	2026-11-14 09:08:44.381436+00	2026-11-15 06:46:56.385543+00	54:93:59:22:88:82	38.75	3.21	6.65	dc2b3bf4-93c1-4c31-a956-889a307c6352
b7f7ec34-0966-40c3-be9f-6f22a062d9d9	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	2	EPON01ONU2_Ismail_1no	EPON01ONU2 Ismail_1no	\N	ONLINE	-23.87	1.89	1169	\N	\N	2026-11-14 13:23:59.506869+00	2026-11-14 09:08:44.226553+00	2026-11-14 13:23:59.506869+00	c0:7e:40:69:07:23	40.48	3.27	13.70	\N
5df35b98-7b56-44d6-b81b-8be8dfdea362	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	45	EPON02ONU45_hs208@sakib	EPON02ONU45 hs208@sakib	\N	OFFLINE	\N	\N	\N	\N	\N	2026-11-14 09:08:44.537913+00	2026-11-14 09:08:44.537913+00	2026-11-14 09:08:44.537913+00	a2:4f:06:14:2b:60	\N	\N	\N	\N
e911ddf7-8638-4bc0-a56b-a4e244695f73	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	48	EPON02ONU48_San_saddam	EPON02ONU48 San_saddam	\N	ONLINE	-21.61	2.10	2275	\N	\N	2026-11-14 13:23:59.781311+00	2026-11-14 09:08:44.545207+00	2026-11-14 13:23:59.781311+00	6c:68:a4:62:b9:20	15.25	\N	12.75	\N
a21d254a-5ed7-4e65-8b8a-d6cee2765214	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/3	2	EPON03ONU2_Salam	EPON03ONU2 Salam	125536ef-b053-4faf-8882-24aebc8b34f1	ONLINE	-18.45	1.98	2654	\N	\N	2026-11-14 13:23:59.792047+00	2026-11-14 09:08:44.560197+00	2026-11-15 06:46:56.26119+00	00:d3:9f:77:91:66	40.00	\N	6.00	6938f0f7-5a46-4a79-b098-b8968f13cd97
036c1352-4cb6-4766-805e-78024393d7b0	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	21	EPON02ONU21_Borhan	EPON02ONU21 Borhan	\N	ONLINE	-19.36	2.29	2860	\N	\N	2026-11-14 13:23:59.694742+00	2026-11-14 09:08:44.447944+00	2026-11-14 13:23:59.694742+00	a0:7e:03:21:87:90	41.00	3.30	12.00	\N
22bd554f-fc35-4a49-9fff-b19320b62a03	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/3	6	EPON03ONU6_Roni_10Gate	EPON03ONU6 Roni_10Gate	\N	OFFLINE	\N	\N	2401	\N	\N	2026-11-14 13:23:59.802555+00	2026-11-14 09:08:44.577263+00	2026-11-14 13:23:59.802555+00	e4:2d:7b:2c:89:cf	\N	\N	\N	\N
e1a97cd7-c144-43f1-81cf-de785cb8dd63	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	27	EPON02ONU27_Shomoresh	EPON02ONU27 Shomoresh	\N	ONLINE	-19.07	2.38	2654	\N	\N	2026-11-14 13:23:59.714488+00	2026-11-14 09:08:44.480517+00	2026-11-14 13:23:59.714488+00	80:07:1b:ad:41:00	41.00	3.31	15.00	\N
64f47f73-a76c-4324-a8fe-5d317ec85406	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/3	9	EPON03ONU9_Nazmul_Home	EPON03ONU9 Nazmul_Home	cc27c026-12d0-4358-93d8-5da3bc81dd6f	ONLINE	-23.28	2.32	2447	\N	\N	2026-11-14 13:23:59.80802+00	2026-11-14 09:08:44.585597+00	2026-11-15 06:46:56.230578+00	c4:70:0b:35:94:88	\N	\N	6.00	ae33b263-2806-4206-b640-8603b576d395
84f5fe7f-03b3-4188-8d8a-285ad884669d	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	19	EPON02ONU19_Pritom	EPON02ONU19 Pritom	\N	ONLINE	-28.24	1.71	4675	\N	\N	2026-11-14 13:23:59.688193+00	2026-11-14 09:08:44.438145+00	2026-11-14 13:23:59.688193+00	00:d3:9e:c0:e0:d0	39.63	3.21	16.35	\N
2530d8de-093f-425d-a394-3a8146fec315	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	22	EPON02ONU22	EPON02ONU22	\N	ONLINE	-24.09	2.02	2174	\N	\N	2026-11-14 13:23:59.697683+00	2026-11-14 09:08:44.453171+00	2026-11-14 13:23:59.697683+00	c0:7e:40:a7:1f:b4	35.97	3.21	13.60	\N
cf6ed22b-59a6-4832-a2db-47981bbf7ff8	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	23	EPON02ONU23_Toofan_Agakhal_Putimari	EPON02ONU23 Toofan_Agakhal_Putimari	\N	ONLINE	-19.21	1.72	2826	\N	\N	2026-11-14 13:23:59.700844+00	2026-11-14 09:08:44.459612+00	2026-11-14 13:23:59.700844+00	\N	41.90	3.23	13.55	\N
f81a5eaf-9344-4914-af9f-0c56266cc8f6	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	24	EPON02ONU24_Ibrahim_Kobirazpara	EPON02ONU24 Ibrahim_Kobirazpara	\N	ONLINE	-19.83	2.79	2085	\N	\N	2026-11-14 13:23:59.703916+00	2026-11-14 09:08:44.464662+00	2026-11-14 13:23:59.703916+00	a0:7e:03:21:a1:40	38.40	3.23	14.15	\N
d7322d92-28c9-4bcb-8d23-ced119670aa2	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	16	EPON02ONU16_Masum	EPON02ONU16 Masum	fe17a6ee-5d04-4333-ad1a-42e4f5f738ac	ONLINE	-16.09	1.45	2921	\N	\N	2026-11-14 13:23:59.677989+00	2026-11-14 09:08:44.424955+00	2026-11-15 06:46:56.337647+00	98:c7:a4:35:23:e2	38.77	3.32	12.40	b7372059-04d6-4980-8214-03b9add58328
f452f6bc-3022-408e-b1f2-a455af62c012	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	26	EPON02ONU26_Salauddin_Shop	EPON02ONU26 Salauddin_Shop	\N	OFFLINE	\N	\N	0	\N	\N	2026-11-14 13:23:59.710717+00	2026-11-14 09:08:44.476556+00	2026-11-14 13:23:59.710717+00	a0:7e:02:20:24:c0	\N	\N	\N	\N
c2ddff9c-c040-4477-8819-76c4b55ebb89	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	28	EPON02ONU28_Project_Staff_House	EPON02ONU28 Project_Staff_House	\N	ONLINE	-16.20	2.07	1947	\N	\N	2026-11-14 13:23:59.718253+00	2026-11-14 09:08:44.484714+00	2026-11-14 13:23:59.718253+00	80:f7:a6:07:76:3d	42.00	3.26	12.00	\N
39ca7d31-eee1-458e-9099-38182cdccb18	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	29	EPON02ONU29_Zahid_Shukumar	EPON02ONU29 Zahid_Shukumar	\N	ONLINE	-27.96	1.94	2118	\N	\N	2026-11-14 13:23:59.722023+00	2026-11-14 09:08:44.489196+00	2026-11-14 13:23:59.722023+00	4c:ae:1c:34:fd:c0	48.00	3.36	12.00	\N
dc139072-6a11-4224-bd0e-6bb0d4907417	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	30	EPON02ONU30_Sohel	EPON02ONU30 Sohel	\N	OFFLINE	\N	\N	2677	\N	\N	2026-11-14 13:23:59.732373+00	2026-11-14 09:08:44.492731+00	2026-11-14 13:23:59.732373+00	a2:4f:02:18:44:30	\N	\N	\N	\N
aae6dc24-f22e-4f34-abd8-3e752412ecbf	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	31	EPON02ONU31_hs210@habib	EPON02ONU31 hs210@habib	\N	ONLINE	-20.41	2.24	2639	\N	\N	2026-11-14 13:23:59.735639+00	2026-11-14 09:08:44.4963+00	2026-11-14 13:23:59.735639+00	\N	42.00	3.25	11.00	\N
e357d81c-1c55-400e-b703-07edcc4ddc97	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	32	EPON02ONU32	EPON02ONU32	\N	ONLINE	-23.47	2.21	2442	\N	\N	2026-11-14 13:23:59.73887+00	2026-11-14 09:08:44.500857+00	2026-11-14 13:23:59.73887+00	80:76:12:60:f3:b0	39.00	\N	6.00	\N
f14622fc-b636-49b8-bcb5-be614864a27a	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	33	EPON02ONU33	EPON02ONU33	\N	ONLINE	-19.91	2.50	3292	\N	\N	2026-11-14 13:23:59.741867+00	2026-11-14 09:08:44.504228+00	2026-11-14 13:23:59.741867+00	\N	44.95	\N	11.85	\N
27bb9a95-b03c-471a-8309-36c7da1d4150	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	34	EPON02ONU34	EPON02ONU34	\N	ONLINE	-15.50	2.59	1539	\N	\N	2026-11-14 13:23:59.744839+00	2026-11-14 09:08:44.507527+00	2026-11-14 13:23:59.744839+00	80:f7:a6:38:7e:c9	54.03	\N	13.75	\N
e40c0859-8503-4a0b-8b2e-64e06ce32a60	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	35	EPON02ONU35_Sabbir	EPON02ONU35 Sabbir	\N	ONLINE	-25.69	2.27	2174	\N	\N	2026-11-14 13:23:59.747746+00	2026-11-14 09:08:44.510493+00	2026-11-14 13:23:59.747746+00	80:f7:a6:c3:11:2a	53.53	\N	16.62	\N
d93e1adc-6fb4-4665-95bc-c544f04e31b2	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	36	EPON02ONU36_01852070631@dulal	EPON02ONU36 01852070631@dulal	\N	ONLINE	-20.56	2.29	2592	\N	\N	2026-11-14 13:23:59.754078+00	2026-11-14 09:08:44.513453+00	2026-11-14 13:23:59.754078+00	00:18:93:f5:2e:62	41.00	\N	12.00	\N
9d845e03-df59-4ba7-9af4-c27dcd657eb5	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	37	EPON02ONU37_salauddin_home	EPON02ONU37 salauddin_home	\N	ONLINE	-21.80	1.99	1792	\N	\N	2026-11-14 13:23:59.760927+00	2026-11-14 09:08:44.516557+00	2026-11-14 13:23:59.760927+00	a2:4f:06:14:26:b0	40.00	\N	11.00	\N
d306ccbb-77e7-4c91-a31f-cc0c495792cf	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	38	EPON02ONU38_Bipul_Lucky	EPON02ONU38 Bipul_Lucky	\N	ONLINE	-24.32	2.28	2064	\N	\N	2026-11-14 13:23:59.76532+00	2026-11-14 09:08:44.519662+00	2026-11-14 13:23:59.76532+00	a2:4f:02:18:d0:d0	41.00	\N	10.00	\N
dc275c02-06ae-4e95-ab89-3711464641a7	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	42	EPON02ONU42_Biplob_Putimari_Shop	EPON02ONU42 Biplob_Putimari_Shop	\N	ONLINE	-21.08	2.21	1606	\N	\N	2026-11-14 13:23:59.773221+00	2026-11-14 09:08:44.529588+00	2026-11-14 13:23:59.773221+00	a2:4f:02:1a:16:50	46.93	\N	17.19	\N
2a4502f0-58f7-4dea-a8d8-c40b1b323322	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	25	EPON02ONU25_Shofik_poschimpara	EPON02ONU25 Shofik_poschimpara	17bc85cf-503c-413d-9d78-b8a2a0468d39	ONLINE	-17.42	1.44	3128	\N	\N	2026-11-14 13:23:59.706962+00	2026-11-14 09:08:44.470726+00	2026-11-15 06:46:56.293932+00	\N	36.40	3.31	12.20	58846833-e3d0-4f52-bb15-459fe64aec2f
d532641b-4383-4b3b-9e06-2c995948c005	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	47	EPON02ONU47	EPON02ONU47	\N	ONLINE	-25.23	1.99	2400	\N	\N	2026-11-14 13:23:59.778611+00	2026-11-14 09:08:44.541597+00	2026-11-14 13:23:59.778611+00	\N	46.00	\N	11.00	\N
51ac919d-e0b8-47a5-ba64-e06d4859ac5e	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	50	EPON02ONU50_Obaidul	EPON02ONU50 Obaidul	\N	ONLINE	-22.15	1.96	1577	\N	\N	2026-11-14 13:23:59.783948+00	2026-11-14 09:08:44.54885+00	2026-11-14 13:23:59.783948+00	c0:7e:40:e8:f0:52	41.00	\N	16.75	\N
dbade769-d980-44bd-954d-ba520a59e124	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	51	EPON02ONU51_idc101@tishan	EPON02ONU51 idc101@tishan	\N	ONLINE	-25.38	2.23	2631	\N	\N	2026-11-14 13:23:59.786698+00	2026-11-14 09:08:44.5524+00	2026-11-14 13:23:59.786698+00	\N	32.35	\N	14.95	\N
5df69389-324d-450d-af56-238aac8e5287	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/3	1	EPON03ONU1_Rian-Arif	EPON03ONU1 Rian-Arif	\N	ONLINE	-23.01	2.79	4377	\N	\N	2026-11-14 13:23:59.789373+00	2026-11-14 09:08:44.555778+00	2026-11-14 13:23:59.789373+00	a0:7e:03:21:c8:e0	44.33	\N	14.20	\N
7cf0b27f-ab04-417b-bb0a-6563551d1bf1	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/3	3	EPON03ONU3_Tafi	EPON03ONU3 Tafi	\N	OFFLINE	\N	\N	2326	\N	\N	2026-11-14 13:23:59.794684+00	2026-11-14 09:08:44.563857+00	2026-11-14 13:23:59.794684+00	a2:4f:02:18:c2:30	\N	\N	\N	\N
09d695bb-8df3-4cf4-abb4-092c41bfb747	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/3	5	EPON03ONU5_Roni_Shop	EPON03ONU5 Roni_Shop	\N	ONLINE	-23.87	2.54	2534	\N	\N	2026-11-14 13:23:59.799937+00	2026-11-14 09:08:44.571603+00	2026-11-14 13:23:59.799937+00	\N	\N	\N	17.20	\N
9784c417-6b8c-475f-b8ad-90971e53111e	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/3	8	EPON03ONU8_Nupur_Hasan	EPON03ONU8 Nupur_Hasan	\N	ONLINE	-22.15	2.45	4380	\N	\N	2026-11-14 13:23:59.805202+00	2026-11-14 09:08:44.581358+00	2026-11-14 13:23:59.805202+00	10:af:8f:75:e8:b5	\N	\N	14.30	\N
c8218d75-c7fa-498a-ae96-e438ace6ce6f	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/3	4	EPON03ONU4_Nazmul_er_ma	EPON03ONU4 Nazmul_er_ma	66a935cb-bfdf-42c7-a3f2-971e17dd6b93	ONLINE	-22.68	1.99	2565	\N	\N	2026-11-14 13:23:59.797344+00	2026-11-14 09:08:44.567694+00	2026-11-15 06:46:56.244791+00	\N	\N	\N	9.00	6bd75037-ba97-45fc-ac66-1acd0e194963
b3fa5781-d8c7-40ab-9940-d7d03a742eeb	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/3	11	EPON03ONU11_Roni_Gucchogram	EPON03ONU11 Roni_Gucchogram	\N	ONLINE	-22.22	1.95	2387	\N	\N	2026-11-14 13:23:59.8107+00	2026-11-14 09:08:44.58972+00	2026-11-14 13:23:59.8107+00	10:af:8f:75:e7:ed	\N	\N	11.00	\N
c7a27fcf-bb30-4647-baab-e29a554ec3ae	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	15	EPON02ONU15_Chomok	EPON02ONU15 Chomok	\N	ONLINE	-16.38	1.34	2231	\N	\N	2026-11-14 13:23:59.674451+00	2026-11-14 09:08:44.419434+00	2026-11-14 13:23:59.674451+00	a0:7e:01:29:5b:c0	27.45	3.31	10.85	\N
0e56dbb1-1222-45c1-b4ff-7c6d6f02398e	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	6	EPON0/1:6	Ridoy	\N	ONLINE	-9.90	2.20	1378	Last down: 2026-11-14 10:26:15	\N	2026-11-14 13:23:23.943506+00	2026-11-14 09:08:56.954141+00	2026-11-14 13:23:23.943506+00	1c:ef:03:c1:99:34	33.66	\N	5.35	\N
92325fd0-1576-4d8d-839d-cc6c57c84287	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	12	EPON04ONU12_Muminul_Bed	EPON04ONU12 Muminul_Bed	\N	ONLINE	-17.33	2.08	1882	\N	\N	2026-11-14 13:23:59.866674+00	2026-11-14 09:08:44.657097+00	2026-11-14 13:23:59.866674+00	4c:ae:1c:a8:ee:20	\N	\N	\N	\N
4539f79a-e07a-4637-bb1e-3d2f224346f1	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	13	EPON04ONU13_Rice_Mill	EPON04ONU13 Rice_Mill	\N	ONLINE	-20.00	2.48	1924	\N	\N	2026-11-14 13:23:59.869782+00	2026-11-14 09:08:44.661073+00	2026-11-14 13:23:59.869782+00	a8:bf:3c:60:d2:6d	\N	\N	\N	\N
7ad6a0cd-0176-4327-9d42-4b9bc7900e95	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/3	10	EPON03ONU10_idc042@shumon	EPON03ONU10 idc042@shumon	3510834a-8d5d-4cc4-915a-115ddbdc210b	ONLINE	-22.84	2.39	2854	\N	\N	2026-11-14 13:23:59.927099+00	2026-11-14 09:08:44.72168+00	2026-11-15 06:46:56.043884+00	80:76:11:20:52:70	\N	\N	14.85	6faee7a3-d28a-482a-9ca1-81e0ec1a60f3
a4835147-35b7-4aad-af29-7e817c0e85a9	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	22	EPON04ONU22_01929618911@mizan	EPON04ONU22 01929618911@mizan	\N	ONLINE	-22.52	2.54	346	\N	\N	2026-11-14 13:23:59.904991+00	2026-11-14 09:08:44.699554+00	2026-11-14 13:23:59.904991+00	4c:ae:1c:9f:bd:30	\N	\N	\N	\N
c9e69e71-aeb9-40ce-968a-ea5bd3a0c4ff	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	4	EPON04ONU4_Ashik_vooter_Adda	EPON04ONU4 Ashik_vooter_Adda	\N	ONLINE	-10.82	1.96	146	\N	\N	2026-11-14 13:23:59.84227+00	2026-11-14 09:08:44.630869+00	2026-11-14 13:23:59.84227+00	00:d3:9f:76:b9:06	\N	\N	13.00	\N
b39bb4db-b009-4c39-8170-16efb70efeb1	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	18	EPON04ONU18_idc102@alomgir	EPON04ONU18 idc102@alomgir	\N	ONLINE	-20.56	1.37	313	\N	\N	2026-11-14 13:23:59.885249+00	2026-11-14 09:08:44.677186+00	2026-11-14 13:23:59.885249+00	98:c7:a4:35:2e:fc	\N	\N	\N	\N
c41dc4df-71d6-4a7b-afa8-2b47ba2e8bdb	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	7	EPON04ONU7_Rezaul_Sheikh	EPON04ONU7 Rezaul_Sheikh	ec57ab5f-38af-44b3-80f9-d03103016644	ONLINE	-19.39	2.26	174	\N	\N	2026-11-14 13:23:59.85138+00	2026-11-14 09:08:44.640333+00	2026-11-15 06:46:56.177208+00	00:d5:9e:ed:18:72	\N	\N	\N	ec5fd342-dd23-41a1-9402-7edc09f69e5a
337ec72d-0a2e-4934-a78e-1be72fde6ae5	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/3	14	EPON03ONU14_Sukanto_Hasan	EPON03ONU14 Sukanto_Hasan	\N	OFFLINE	-24.32	2.40	4549	\N	\N	2026-11-14 13:23:59.816258+00	2026-11-14 09:08:44.598931+00	2026-11-14 13:23:59.816258+00	a2:4f:02:18:42:20	\N	\N	\N	\N
05d7cf44-07a7-4eb6-a348-5dd8fe6984a0	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	5	EPON04ONU5_Rasel_Alomgir	EPON04ONU5 Rasel_Alomgir	\N	ONLINE	-13.47	2.38	183	\N	\N	2026-11-14 13:23:59.845386+00	2026-11-14 09:08:44.634008+00	2026-11-14 13:23:59.845386+00	a2:3f:05:31:13:d0	\N	\N	\N	\N
a7f5d4bc-93fe-4185-9901-0ee15c0b398a	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	29	EPON04ONU29_Sohag	EPON04ONU29 Sohag	a6db6ec1-f74b-4387-8bde-ad6fa2b44326	ONLINE	-9.45	2.71	203	\N	\N	2026-11-14 13:23:59.895247+00	2026-11-14 09:08:44.687365+00	2026-11-15 06:46:56.114389+00	\N	\N	\N	\N	2f14e7df-b77c-4932-bd5d-9f47c0f4d1da
4c0816a2-2f7e-4662-b1da-53844eb7c6ac	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	30	EPON01ONU30_01353318105@rakib	EPON01ONU30 01353318105@rakib	5abb8561-a44a-4b87-8502-ad15f3de20e0	ONLINE	-18.76	2.57	920	\N	\N	2026-11-14 13:23:59.915641+00	2026-11-14 09:08:44.710286+00	2026-11-15 06:46:56.078353+00	\N	56.20	3.28	13.90	048ced68-de2d-472c-8c32-59da6b34de2f
b2a9da39-0dc3-4858-a0e1-b3a49d72084d	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/3	15	EPON03ONU15_Rashed	EPON03ONU15 Rashed	\N	ONLINE	-19.75	1.89	2733	\N	\N	2026-11-14 13:23:59.81904+00	2026-11-14 09:08:44.602328+00	2026-11-14 13:23:59.81904+00	6c:68:a4:e8:b2:63	\N	\N	11.00	\N
a7bf116e-58f6-41fc-8077-ccb6afe67814	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/3	16	EPON03ONU16_hs204@nabi	EPON03ONU16 hs204@nabi	\N	ONLINE	-21.80	2.54	4631	\N	\N	2026-11-14 13:23:59.821845+00	2026-11-14 09:08:44.605677+00	2026-11-14 13:23:59.821845+00	00:18:93:a3:42:48	\N	\N	12.85	\N
3a7358e9-92ae-47f8-9fba-a59a07478ee3	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/3	17	EPON03ONU17_Rajibullah	EPON03ONU17 Rajibullah	\N	ONLINE	-23.10	2.78	2370	\N	\N	2026-11-14 13:23:59.82477+00	2026-11-14 09:08:44.609174+00	2026-11-14 13:23:59.82477+00	\N	\N	\N	13.60	\N
c1258f68-7f3c-4df5-b046-1c9253b3275b	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/3	18	EPON03ONU18_hs205@talukder	EPON03ONU18 hs205@talukder	\N	ONLINE	-25.69	1.84	4521	\N	\N	2026-11-14 13:23:59.827684+00	2026-11-14 09:08:44.612606+00	2026-11-14 13:23:59.827684+00	\N	\N	\N	15.60	\N
f3ac456d-854b-46a4-93bc-582047874686	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/3	20	EPON03ONU20_Shoaib	EPON03ONU20 Shoaib	\N	ONLINE	-22.22	-14.80	2590	\N	\N	2026-11-14 13:23:59.830478+00	2026-11-14 09:08:44.617023+00	2026-11-14 13:23:59.830478+00	\N	\N	\N	57.80	\N
368d23d1-53f5-4da5-911b-793ae44c1e14	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	1	EPON04ONU1_idc082@shohidul	EPON04ONU1 idc082@shohidul	\N	ONLINE	-20.41	2.23	469	\N	\N	2026-11-14 13:23:59.833385+00	2026-11-14 09:08:44.620368+00	2026-11-14 13:23:59.833385+00	80:76:30:61:c1:b0	\N	\N	12.00	\N
05976cf1-90a6-435d-8804-ff861fa8df3e	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	24	EPON04ONU24_Raju	EPON04ONU24 Ac017@Dulal	67da9dc9-facc-4d12-857d-10505ce4d2db	ONLINE	-23.28	2.24	257	\N	\N	2026-11-14 13:23:59.923636+00	2026-11-14 09:08:44.717675+00	2026-11-15 06:55:27.362899+00	\N	\N	\N	\N	6656cb5f-c597-4ab3-b73d-1107ba301266
d2d78802-fe7c-4285-9dc1-dc5601185460	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	2	EPON04ONU2_Alomgir_Shop	EPON04ONU2 Alomgir_Shop	fd2f32b1-3f2d-4f5a-9c7b-dbcf0727b6f1	ONLINE	-18.33	2.57	133	\N	\N	2026-11-14 13:23:59.836372+00	2026-11-14 09:08:44.623303+00	2026-11-15 06:46:56.216473+00	c0:7e:40:64:14:29	\N	\N	15.65	53c2b7c2-2120-44ea-adea-e017f3b55f26
6036b603-9624-48af-8771-87e188c86026	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	6	EPON04ONU6_Faisal	EPON04ONU6 Faisal	\N	ONLINE	-13.05	2.17	739	\N	\N	2026-11-14 13:23:59.848512+00	2026-11-14 09:08:44.637366+00	2026-11-14 13:23:59.848512+00	54:51:1b:d4:d9:ff	\N	\N	\N	\N
d39c1f6e-d1fd-4d74-9c23-356f596bb392	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	3	EPON04ONU3_Alomgir_shop_home	EPON04ONU3 Alomgir_shop_home	6489984b-6f66-4330-86db-06172d6b248b	ONLINE	-10.92	2.29	418	\N	\N	2026-11-14 13:23:59.839174+00	2026-11-14 09:08:44.626138+00	2026-11-15 06:46:56.19323+00	6c:68:a4:62:d4:e4	\N	\N	16.00	6b1115ac-9656-440e-9010-911aefd90c25
b2592b0e-caa0-48ef-b58f-278ed677b632	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	8	EPON04ONU8_arif_ashraful	EPON04ONU8 arif_ashraful	\N	ONLINE	\N	\N	433	\N	\N	2026-11-14 13:23:59.854153+00	2026-11-14 09:08:44.643596+00	2026-11-14 13:23:59.854153+00	70:22:d0:3e:4e:e1	\N	\N	\N	\N
ee4867d9-fb23-47b1-8a20-5cb415510de6	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	11	EPON04ONU11_Said_Bed	EPON04ONU11 Said_Bed	\N	ONLINE	-28.86	2.12	1974	\N	\N	2026-11-14 13:23:59.863613+00	2026-11-14 09:08:44.653066+00	2026-11-14 13:23:59.863613+00	80:f7:a6:07:76:47	\N	\N	\N	\N
0cf3942f-a459-48a4-8a06-4b090c8c4e8d	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	14	EPON04ONU14_idc115@imran	EPON04ONU14 idc115@imran	\N	ONLINE	-20.46	2.53	477	\N	\N	2026-11-14 13:23:59.872643+00	2026-11-14 09:08:44.664307+00	2026-11-14 13:23:59.872643+00	a2:4f:06:14:a1:c0	\N	\N	\N	\N
d17ae8e7-24bb-418d-a825-0accc619fa5c	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	15	EPON04ONU15_Rabbi_Hakim	EPON04ONU15 Rabbi_Hakim	\N	ONLINE	-18.04	1.78	239	\N	\N	2026-11-14 13:23:59.875555+00	2026-11-14 09:08:44.667297+00	2026-11-14 13:23:59.875555+00	a2:4f:02:18:41:40	\N	\N	\N	\N
84e54967-a5f6-44c0-b8c8-68332e21fb9a	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	9	EPON04ONU9_Shujon_Moddhopara	EPON04ONU9 Shujon_Moddhopara	e5c7e702-e138-4a9e-b7dd-22eca055a1d5	ONLINE	-22.01	2.68	456	\N	\N	2026-11-14 13:23:59.85721+00	2026-11-14 09:08:44.64672+00	2026-11-15 06:46:56.15904+00	c0:7e:40:62:41:65	\N	\N	\N	8374555e-6a0b-4ca1-a52c-7940a93dd586
7ff8a556-8cad-46c4-acad-1fc7b3a7b300	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	17	EPON04ONU17_idc096@nahid	EPON04ONU17 idc096@nahid	\N	ONLINE	-8.84	2.53	305	\N	\N	2026-11-14 13:23:59.881907+00	2026-11-14 09:08:44.673764+00	2026-11-14 13:23:59.881907+00	4c:46:d1:8c:93:fd	\N	\N	\N	\N
b51f016f-13a5-40fc-b49d-bf226079fb7a	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	19	EPON04ONU19_Habil_Gaus	EPON04ONU19 Habil_Gaus	\N	ONLINE	\N	\N	120	\N	\N	2026-11-14 13:23:59.888424+00	2026-11-14 09:08:44.680439+00	2026-11-14 13:23:59.888424+00	a2:3e:07:17:3b:40	\N	\N	\N	\N
9634910c-315e-4063-a143-9d35fdb77930	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	20	EPON04ONU20_Abdur_Rahman	EPON04ONU20 Abdur_Rahman	\N	ONLINE	-10.92	2.04	374	\N	\N	2026-11-14 13:23:59.891984+00	2026-11-14 09:08:44.683867+00	2026-11-14 13:23:59.891984+00	\N	\N	\N	\N	\N
31f0dc33-0a79-4352-9698-a4e68de5ff15	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	16	EPON04ONU16_Bellal-Ebadul	EPON04ONU16 Bellal-Ebadul	599417ed-a723-4919-b81a-743ef862245f	ONLINE	-16.31	1.60	67	\N	\N	2026-11-14 13:23:59.878657+00	2026-11-14 09:08:44.670438+00	2026-11-15 06:46:56.129908+00	4c:ae:1c:34:fd:f0	\N	\N	\N	9f0afb7f-877a-4d7b-808a-bf0210510a98
5863be71-7a19-4b82-b87e-9ab8ccd5f994	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	27	EPON01ONU27_Kanchon	EPON01ONU27 Kanchon	\N	ONLINE	-20.60	2.24	895	\N	\N	2026-11-14 13:23:59.908221+00	2026-11-14 09:08:44.70294+00	2026-11-14 13:23:59.908221+00	a2:4f:02:1a:61:10	43.00	3.29	12.00	\N
8f638387-7c2d-4178-9fa9-2ef10588551b	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	44	EPON02ONU44_01301090060@jolil	EPON02ONU44 01301090060@jolil	1ad4ce06-b07d-4486-9ec3-b06357b6a495	ONLINE	-15.13	2.19	1705	\N	\N	2026-11-14 13:23:59.919534+00	2026-11-14 09:08:44.714002+00	2026-11-15 06:46:56.060326+00	4c:d7:c8:de:e1:ce	43.00	\N	14.00	f56d9804-475d-4f23-8712-cc0b54e5f132
4d9cc860-8b87-41e1-aa2c-0665981035a1	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	39	EPON02ONU39_Lutfun_Nahar	EPON02ONU39 Lutfun_Nahar	\N	ONLINE	-19.14	1.98	1618	\N	\N	2026-11-14 13:23:59.901949+00	2026-11-14 09:08:44.696068+00	2026-11-14 13:23:59.901949+00	a2:3f:04:23:13:90	47.00	\N	13.00	\N
5ffa5b97-215e-4f95-98ff-856437965900	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/3	12	EPON03ONU12_Rakib_rashed	EPON03ONU12 Rakib_rashed	\N	ONLINE	-23.19	2.69	3015	\N	\N	2026-11-14 13:23:59.813547+00	2026-11-14 09:08:44.594533+00	2026-11-14 13:23:59.813547+00	a2:3e:05:23:03:20	\N	\N	13.30	\N
78772c07-cfb2-4c6b-8f81-87cbd4b4934c	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	3	EPON0/1:3	Nazmul	\N	ONLINE	-15.70	1.80	1052	Last down: 2026-11-14 10:26:15	\N	2026-11-14 13:23:23.936942+00	2026-11-14 09:08:56.94672+00	2026-11-14 13:23:23.936942+00	a0:7e:07:01:b9:59	32.60	\N	8.10	\N
09482aed-4fba-43a5-9df1-070b0b8d7231	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	4	EPON0/1:4	Amina	\N	ONLINE	-12.80	2.10	1050	Last down: 2026-11-11 09:16:26	\N	2026-11-14 13:23:23.940716+00	2026-11-14 09:08:56.951128+00	2026-11-14 13:23:23.940716+00	68:8f:84:a7:c1:b4	32.95	\N	3.50	\N
a672cd20-be25-4440-8e7e-3bf8e307534b	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/3	5	EPON0/3:5	Rabbi	\N	ONLINE	-22.70	2.20	1050	Last down: 2026-11-14 10:26:15	\N	2026-11-14 13:23:23.959032+00	2026-11-14 09:08:56.972886+00	2026-11-14 13:23:23.959032+00	a2:4f:06:14:5c:00	32.69	\N	7.00	\N
01a29674-02f3-43ad-b603-1599fad3e28e	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	2	EPON0/1:2	Meraz	\N	ONLINE	-15.30	2.30	922	Last down: 2026-11-14 10:26:15	\N	2026-11-14 13:23:23.977076+00	2026-11-14 09:08:56.989323+00	2026-11-14 13:23:23.977076+00	a2:8d:04:20:aa:00	32.90	\N	8.00	\N
c69145de-3fd2-426f-b028-ca8616ee16d2	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	15	EPON0/1:15	Habibullah	ada5f420-e833-4ae9-9c3d-099eecc8203b	ONLINE	-10.50	2.20	1152	Last down: 2026-11-14 10:26:15	\N	2026-11-14 13:23:23.9966+00	2026-11-14 09:08:57.009267+00	2026-11-15 06:46:56.668539+00	08:e8:4f:12:48:25	33.38	\N	6.50	95e96c2a-d414-4de5-88a2-d54f3de325d2
237f7871-c66f-4dc8-b328-40b830a41ce1	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	5	EPON0/1:5	Rashed	\N	ONLINE	-9.90	2.10	1024	Last down: 2026-11-14 12:35:22	\N	2026-11-14 13:23:24.003137+00	2026-11-14 09:08:57.015899+00	2026-11-14 13:23:24.003137+00	a2:4f:09:17:2d:d0	32.59	\N	5.00	\N
915ac5b4-c759-44bf-bb44-4c5416c96ac8	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	18	EPON0/1:18	Reshmi	\N	ONLINE	-10.50	2.20	1101	Last down: 2026-11-14 12:35:24	\N	2026-11-14 13:23:24.013872+00	2026-11-14 09:08:57.028228+00	2026-11-14 13:23:24.013872+00	e4:c2:d1:fc:b4:57	32.53	\N	4.50	\N
0c6a32cd-cfab-40a7-861f-43eca1ac2111	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	16	EPON0/1:16	Mehedi	\N	ONLINE	-11.20	2.40	1584	Last down: 2026-11-14 12:35:23	\N	2026-11-14 13:23:23.999498+00	2026-11-14 09:08:57.012553+00	2026-11-14 13:23:23.999498+00	10:af:8f:75:e8:65	32.45	\N	7.10	\N
c69dc7eb-0171-40aa-937c-61b37c8e2084	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	14	EPON01ONU14_Alif_1no_polli	EPON01ONU14 Alif_1no_polli	535fbc00-0bd6-48b2-9143-42ce9e5955d5	ONLINE	3.65	2.76	961	\N	\N	2026-11-14 13:23:59.544727+00	2026-11-14 09:08:44.281857+00	2026-11-15 06:46:56.568833+00	a2:3e:07:17:3c:00	43.63	3.23	9.70	f847be2f-8ed6-4edf-a131-2b306510a950
81b34efc-42be-4af9-92b9-9093f7950871	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	7	EPON02ONU7_Hasibur	EPON02ONU7 Hasibur	\N	ONLINE	-25.85	2.75	1854	\N	\N	2026-11-14 13:23:59.64704+00	2026-11-14 09:08:44.388913+00	2026-11-14 13:23:59.64704+00	a2:3e:01:11:49:60	43.28	3.21	15.80	\N
215f35bb-9579-41ef-be7f-ef62e0b0110c	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	25	EPON01ONU25_Shayla	EPON01ONU25 Shayla	cafdc77f-60fc-4f52-983f-e55e564a3e57	ONLINE	-24.95	1.89	979	\N	\N	2026-11-14 13:23:59.588254+00	2026-11-14 09:08:44.331034+00	2026-11-15 06:46:56.484214+00	a2:4e:12:23:7a:10	40.00	3.24	10.00	fe2e3cf2-7d2d-4c98-a242-bd11fa50ba2f
efeecb2e-739f-4bb6-9308-167ed27fe089	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	17	EPON02ONU17_Naim_Poschimpara_Ahad	EPON02ONU17 Naim_Poschimpara_Ahad	\N	ONLINE	-17.14	2.27	1867	\N	\N	2026-11-14 13:23:59.681263+00	2026-11-14 09:08:44.428944+00	2026-11-14 13:23:59.681263+00	54:93:59:22:74:a2	35.88	3.22	16.25	\N
bf506e31-f8bc-4502-aff1-1d851c2ee427	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	41	EPON02ONU41_Ahamed_Shukumar	EPON02ONU41 Ahamed_Shukumar	\N	ONLINE	-16.78	2.21	1700	\N	\N	2026-11-14 13:23:59.770636+00	2026-11-14 09:08:44.525946+00	2026-11-14 13:23:59.770636+00	a2:3e:07:17:3b:20	54.00	\N	13.00	\N
d0aa2f2c-aa58-4255-9436-24dc6877af51	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	21	EPON04ONU21_Humayon	EPON04ONU21 Humayon	d5aea95a-2500-4e9a-813a-c02a13aacf5a	ONLINE	-26.38	2.42	421	\N	\N	2026-11-14 13:23:59.898484+00	2026-11-14 09:08:44.690857+00	2026-11-15 06:46:56.096945+00	a0:7e:02:22:03:50	\N	\N	\N	117fa5eb-817e-4623-b031-8f4d59286252
9c1afe2d-4793-4421-8eb7-92676ca39e99	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	4	EPON01ONU4_Jubaer	EPON01ONU4 Jubaer	e7e4349b-b6c6-445d-8544-3d0a378aeeaf	ONLINE	-15.78	2.03	2987	\N	\N	2026-11-14 13:23:59.513525+00	2026-11-14 09:08:44.237089+00	2026-11-15 06:46:56.644037+00	a0:7d:12:20:65:70	30.16	3.34	15.20	8b732b4a-f1e4-45ca-a5c0-0c5e24d3c1a6
2bb54155-c4ad-47e2-afdd-b959787c6e0b	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/3	1	EPON0/3:1	Ali_Mukter7	a903542e-76a5-4122-a00c-e47ff9d4d057	ONLINE	-12.00	2.20	1325	Last down: 2026-11-14 10:39:02	\N	2026-11-14 13:23:24.005783+00	2026-11-14 09:08:57.019135+00	2026-11-15 06:46:56.656922+00	98:c7:a4:34:bb:36	34.04	\N	7.88	f3700fd4-4100-47af-aa58-2ebc40dcb057
71f8fbf0-b137-4e4b-9c92-1af44a54cdd0	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	12	EPON0/1:12	Afroza	\N	ONLINE	-14.20	1.90	1203	Last down: 2026-11-14 12:35:22	\N	2026-11-14 13:23:23.953039+00	2026-11-14 09:08:56.965897+00	2026-11-14 13:23:23.953039+00	a2:3e:05:23:43:80	32.90	\N	5.50	\N
2623befa-f52a-4a5f-9507-1fe1757bf048	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	14	EPON0/1:14	Jwel	\N	OFFLINE	\N	\N	\N	Last down: 2026-10-05 02:17:06	\N	2026-11-14 13:23:23.956241+00	2026-11-14 09:08:56.968905+00	2026-11-14 13:23:23.956241+00	a8:bf:3c:60:d2:6d	\N	\N	\N	\N
b89c92f3-6072-40b5-b501-a0beeb1e362d	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/3	7	EPON0/3:7	Rubel	\N	ONLINE	-21.60	1.40	642	Last down: 2026-11-14 18:45:07	\N	2026-11-14 13:23:23.962911+00	2026-11-14 09:08:56.97701+00	2026-11-14 13:23:23.962911+00	70:a5:6a:91:17:34	32.90	\N	5.13	\N
e5693884-6956-44a2-aad3-027201df6c93	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	10	EPON0/1:10	Dulal	30488228-7d5b-4074-87a8-294d66c0cb3a	ONLINE	-8.50	2.30	1126	Last down: 2026-11-14 10:26:15	\N	2026-11-14 13:23:23.949643+00	2026-11-14 09:08:56.959907+00	2026-11-15 06:46:56.720222+00	a2:3e:05:23:18:e0	32.90	\N	6.00	27cd3dad-0a17-448e-ba93-1725fe075e10
eb4381d1-1bcb-41b8-9098-f5b74b9bb20d	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	19	EPON0/1:19	Jakir	\N	ONLINE	-32.20	1.90	855	Last down: 2026-11-14 10:26:15	\N	2026-11-14 13:23:23.969719+00	2026-11-14 09:08:56.983353+00	2026-11-14 13:23:23.969719+00	80:07:1b:9b:2e:f8	33.78	\N	8.35	\N
c2c4186f-f76a-4f0b-bbe6-4e2efd0422eb	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/3	8	EPON0/3:8	Shamim_7mukter	\N	ONLINE	-14.10	2.50	1430	Last down: 2026-11-14 18:19:13	\N	2026-11-14 13:23:23.973879+00	2026-11-14 09:08:56.986357+00	2026-11-14 13:23:23.973879+00	10:af:78:fd:ab:d5	32.76	\N	7.40	\N
2ff83449-511d-42d2-9995-c84307978982	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	1	EPON0/1:1	Anis	\N	ONLINE	-15.20	2.20	1271	Last down: 2026-11-11 09:16:26	\N	2026-11-14 13:23:23.980103+00	2026-11-14 09:08:56.992267+00	2026-11-14 13:23:23.980103+00	6c:68:a4:6f:6b:18	34.36	\N	8.65	\N
250e16ac-7afa-4373-896a-9876c76c2f22	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	7	EPON0/1:7	Ibrahim	bb4ed432-7f51-48ef-b5a4-4e3821bb6e70	ONLINE	-9.20	2.00	998	Last down: 2026-11-14 10:26:15	\N	2026-11-14 13:23:23.982968+00	2026-11-14 09:08:56.995192+00	2026-11-15 06:46:56.015295+00	0c:45:ba:81:64:a4	32.80	\N	4.50	ab96cbb9-3967-4834-8fb5-67c0d4575826
4a704c0e-ec16-4ff0-b0bd-1d0161a332ab	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	13	EPON0/1:13	Kamrul_er_wife	\N	ONLINE	-6.40	2.10	1075	Last down: 2026-11-12 22:56:34	\N	2026-11-14 13:23:23.986888+00	2026-11-14 09:08:56.998736+00	2026-11-14 13:23:23.986888+00	a2:3e:05:20:c1:60	32.64	\N	6.00	\N
6fa557be-adda-4345-9d2f-df2e98563a38	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	8	EPON0/1:8	Naim	b62bc557-4831-4245-90fe-5a97cc8e20dd	ONLINE	-12.60	2.20	998	Last down: 2026-11-14 17:29:46	\N	2026-11-14 13:23:23.990526+00	2026-11-14 09:08:57.002462+00	2026-11-15 06:46:56.694958+00	a2:3e:07:17:3c:e0	32.74	\N	5.50	46dbdd49-b6b4-4df7-839a-dfae0086556e
39ac4762-8dbb-4562-9ebc-9795d910701b	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	21	EPON0/1:21	hs209@shihab	\N	ONLINE	-3.40	1.40	642	Last down: 2026-11-11 09:16:26	\N	2026-11-14 13:23:24.008453+00	2026-11-14 09:08:57.022043+00	2026-11-14 13:23:24.008453+00	70:a5:6a:77:90:ea	32.82	\N	5.45	\N
d686caf2-8de0-4953-8ab9-11018f0c3196	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	17	EPON0/1:17	Mahadi	\N	OFFLINE	\N	\N	\N	Last down: 2026-10-05 02:17:06	\N	2026-11-14 13:23:24.011212+00	2026-11-14 09:08:57.025291+00	2026-11-14 13:23:24.011212+00	6c:68:a4:6f:43:b4	\N	\N	\N	\N
03f5e1f1-2c95-4544-9485-d605c3d4d923	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	20	EPON0/1:20	Limon	\N	ONLINE	-15.10	2.10	1135	Last down: 2026-11-14 10:26:15	\N	2026-11-14 13:23:24.016545+00	2026-11-14 09:08:57.03149+00	2026-11-14 13:23:24.016545+00	20:57:af:14:fe:58	32.83	\N	6.42	\N
4b19701b-c77a-4160-804e-533aa4ca76a6	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	3	EPON01ONU3_Hom	EPON01ONU3 Hom	\N	ONLINE	-13.63	1.75	818	\N	\N	2026-11-14 13:23:59.510289+00	2026-11-14 09:08:44.23157+00	2026-11-14 13:23:59.510289+00	c0:7e:40:55:00:c5	46.10	3.36	15.17	\N
af38780e-64f1-4594-b096-7ca604944a72	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	9	EPON0/1:9	Mafia	02b97ebf-1a80-4c3d-a87a-305b58e9fa61	ONLINE	-15.20	2.20	1229	Last down: 2026-11-11 09:16:26	\N	2026-11-14 13:23:23.946204+00	2026-11-14 09:08:56.957013+00	2026-11-15 06:46:56.7365+00	a2:3e:05:23:03:d0	32.95	\N	7.00	8013876f-8c0e-45d2-bc53-586aecdd4040
b35302b0-bdfe-466d-a78e-db3bdf980a21	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/3	6	EPON0/3:6	Tarek_Saddam	a1b55cd8-e554-457e-98fe-75aafeb2d8f1	ONLINE	-39.90	2.30	927	Last down: 2026-11-14 10:26:15	\N	2026-11-14 13:23:23.993625+00	2026-11-14 09:08:57.006182+00	2026-11-15 06:46:56.681996+00	00:6d:61:63:8f:18	33.78	\N	6.17	0aca34b4-3ad3-4c99-ae8c-c55a5bd78824
9cb43266-58aa-45d8-97e7-447956704e0d	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/1	12	EPON01ONU12_Roshid	EPON01ONU12 Roshid	1165b6d4-4ab0-43d7-b534-1db9b7400b37	AUTHORIZED	-25.09	2.23	1085	\N	2026-11-14 09:09:09.596487+00	2026-11-14 13:23:59.537905+00	2026-11-14 09:08:44.273111+00	2026-11-15 06:46:56.601699+00	d0:5f:af:2c:e9:58	56.88	3.38	15.82	c4e0d124-a816-4255-8429-3f9d86f44245
d7ad4f98-da16-46c1-9ef7-39581ea67527	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	18	EPON02ONU18_idc107@rabeya	EPON02ONU18 idc107@rabeya	80e1ebe9-c6c7-4b79-b52b-2115cb3617e5	ONLINE	-15.48	2.73	1698	\N	\N	2026-11-14 13:23:59.684819+00	2026-11-14 09:08:44.433463+00	2026-11-15 06:46:56.319416+00	00:d5:9f:70:3d:f2	47.36	3.24	14.90	34fac430-47f0-46d9-831e-2f8833486cae
91248fae-1f47-4ff7-8976-8942d6eccba2	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	10	EPON04ONU10_Monirul_Belayet_er_More	EPON04ONU10 Monirul_Belayet_er_More	6b2c6d18-878f-4aee-927b-52dac43dac9d	ONLINE	-19.28	1.43	428	\N	\N	2026-11-14 13:23:59.860369+00	2026-11-14 09:08:44.649899+00	2026-11-15 06:46:56.144619+00	d0:5f:af:2c:eb:e6	\N	\N	\N	09941424-2189-4ace-b503-97b31100c391
5fb78fae-7500-4ac5-a7d6-b37411850a81	18b9831d-d60f-4ef0-99c7-b616ac1dde8d	EPON0/1	11	EPON0/1:11	Aria_Asad	933406e7-d44d-4dd2-9e64-7d9a5f66e803	ONLINE	-9.10	1.70	1005	Last down: 2026-11-14 10:26:15	\N	2026-11-14 13:23:23.966346+00	2026-11-14 09:08:56.980465+00	2026-11-15 06:46:56.707114+00	a0:7e:08:18:34:00	32.68	\N	9.63	78f13242-e5a5-4ea9-9e7b-ad20368e3362
cfdd060d-d094-4cb5-962c-b36cefe7eb50	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	20	EPON02ONU20_Nozrul_kobirazpara	EPON02ONU20 Nozrul_kobirazpara	\N	ONLINE	-27.21	2.19	2115	\N	\N	2026-11-14 13:23:59.691513+00	2026-11-14 09:08:44.443028+00	2026-11-14 13:23:59.691513+00	4c:ae:1c:9e:f4:80	47.00	3.25	15.00	\N
65d1ab1b-9be4-4c46-b15d-5eec6d4c16ed	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	40	EPON02ONU40_Tarek_shukumar	EPON02ONU40 Tarek_shukumar	\N	ONLINE	-15.70	1.86	1741	\N	\N	2026-11-14 13:23:59.768+00	2026-11-14 09:08:44.522816+00	2026-11-14 13:23:59.768+00	00:11:41:37:a4:54	36.23	\N	10.80	\N
aea8881c-bd38-4654-8068-ac4509a57198	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/4	23	EPON04ONU23_01409249681@rumman	EPON04ONU23 01409249681@rumman	\N	ONLINE	-20.27	2.16	320	\N	\N	2026-11-14 13:23:59.911998+00	2026-11-14 09:08:44.706331+00	2026-11-14 13:23:59.911998+00	c0:7e:40:e9:22:82	\N	\N	\N	\N
07ab4546-d641-4ae9-99b1-417020b15162	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	43	EPON02ONU43_Nirapod_Putimari_Dhalipara	EPON02ONU43 Nirapod_Putimari_Dhalipara	b43ba3a5-d757-4e07-b08e-f22bfad6c4a2	ONLINE	-24.44	2.40	4500	\N	\N	2026-11-14 13:23:59.775889+00	2026-11-14 09:08:44.533063+00	2026-11-15 06:46:56.275707+00	00:d3:9e:b7:4b:c0	34.99	\N	13.70	8668491a-845b-4227-a952-1ef49ab0b747
e60cc66d-af2b-43d5-83aa-a37836a66011	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	10	EPON02ONU10_Ridoy_RAB	EPON02ONU10 Ridoy_RAB	57e677be-22d6-4438-9092-c072d4078bc0	ONLINE	-19.87	2.60	2415	\N	\N	2026-11-14 13:23:59.654953+00	2026-11-14 09:08:44.396872+00	2026-11-15 06:46:56.370669+00	6c:68:a4:6f:43:b4	39.14	3.20	11.60	c391e633-d9d5-49b2-b05d-71cefdacbfa2
4a0afffc-dff5-484d-85b5-5c2560020e5f	7fba5b4b-c2ed-4bd8-a216-b6d32fd132a2	EPON0/2	3	EPON02ONU3_idc116@anik	EPON02ONU3 idc116@anik	8588d23b-dccd-4b31-a5e8-d46bf89a2d18	ONLINE	-20.18	1.43	1600	\N	\N	2026-11-14 13:23:59.627358+00	2026-11-14 09:08:44.370881+00	2026-11-15 06:46:56.398463+00	4c:ae:1c:aa:4b:68	33.21	3.31	11.60	54849e26-e6e6-40b1-a84c-f4385f9b6ab3
\.


--
-- Data for Name: payment_gateway_configs; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.payment_gateway_configs (id, gateway, enabled, mode, config, credentials, webhook_secret, updated_at) FROM stdin;
5a593aaa-dbe7-4d2b-8680-7b8307faaab2	bkash	f	SANDBOX	{"supports": "tokenized_checkout,personal_mfs_sms"}	{}	\N	2026-11-14 03:25:14.562322+00
266b2039-d062-411a-aa05-e7ce99b63b49	nagad	f	SANDBOX	{"type": "merchant_pgw"}	{}	\N	2026-11-14 03:25:14.562322+00
cbb59d41-c0c0-4522-93b7-4f29330b3504	rocket	f	SANDBOX	{"type": "merchant_pgw"}	{}	\N	2026-11-14 03:25:14.562322+00
be206efb-180e-407f-b9e3-c926ebf273e1	stripe	f	SANDBOX	{"supports": "cards,apple_pay,google_pay,elements"}	{}	\N	2026-11-14 03:25:14.562322+00
838803be-b9e7-4e2c-8b00-46131ae07315	paypal	f	SANDBOX	{"supports": "smart_buttons"}	{}	\N	2026-11-14 03:25:14.562322+00
\.


--
-- Data for Name: payment_sms_events; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.payment_sms_events (id, gateway, sender, message, trx_id, amount, payer_number, matched_payment_ref, matched_invoice_id, status, payload, created_at, processed_at) FROM stdin;
\.


--
-- Data for Name: payment_webhook_events; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.payment_webhook_events (id, gateway, event_id, dedupe_key, payload, processed, processed_at, result, created_at) FROM stdin;
\.


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.payments (id, payment_ref, invoice_id, subscriber_id, gateway, method, amount, currency, status, trx_id, payer_number, payer_info, gateway_response, checkout_url, client_secret, idempotency_key, verified_at, created_at, updated_at, payment_type, collector_name, approval_status, approval_note, received_at) FROM stdin;
\.


--
-- Data for Name: purchase_items; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.purchase_items (id, purchase_id, item_name, category, sku, qty, unit_cost, total_cost, inventory_item_id) FROM stdin;
\.


--
-- Data for Name: purchases; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.purchases (id, purchase_no, vendor_id, warehouse_id, purchase_date, status, subtotal, tax, total, notes, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: radacct; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.radacct (radacctid, acctsessionid, acctuniqueid, username, realm, nasipaddress, nasportid, nasporttype, acctstarttime, acctupdatetime, acctstoptime, acctinterval, acctsessiontime, acctauthentic, connectinfo_start, connectinfo_stop, acctinputoctets, acctoutputoctets, calledstationid, callingstationid, acctterminatecause, servicetype, framedprotocol, framedipaddress) FROM stdin;
\.


--
-- Data for Name: radcheck; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.radcheck (id, username, attribute, op, value) FROM stdin;
\.


--
-- Data for Name: radgroupcheck; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.radgroupcheck (id, groupname, attribute, op, value) FROM stdin;
\.


--
-- Data for Name: radgroupreply; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.radgroupreply (id, groupname, attribute, op, value) FROM stdin;
\.


--
-- Data for Name: radius_users; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.radius_users (id, subscriber_id, username, password, profile, framed_ip_address, status, last_synced_at, last_error, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: radpostauth; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.radpostauth (id, username, pass, reply, authdate) FROM stdin;
\.


--
-- Data for Name: radreply; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.radreply (id, username, attribute, op, value) FROM stdin;
\.


--
-- Data for Name: radusergroup; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.radusergroup (id, username, groupname, priority) FROM stdin;
\.


--
-- Data for Name: report_schedules; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.report_schedules (id, name, report_key, format, schedule_cron, recipients, enabled, last_run_at, last_status, config, created_at) FROM stdin;
\.


--
-- Data for Name: reseller_share_entries; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.reseller_share_entries (id, reseller_id, subscriber_id, payment_ref, wallet_transaction_id, retail_amount, partner_share, isp_share, margin_percent, package_name, period_month, created_at, metadata) FROM stdin;
\.


--
-- Data for Name: reseller_wallet_transactions; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.reseller_wallet_transactions (id, reseller_id, type, direction, amount, balance_after, reference_type, reference_id, subscriber_id, description, metadata, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: resellers; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.resellers (id, code, name, company_name, tier, parent_reseller_id, email, phone, subdomain, custom_domain, brand_name, logo_url, primary_color, secondary_color, portal_title, status, wallet_balance, credit_limit, commission_percent, buying_margin_percent, address, notes, created_at, updated_at) FROM stdin;
b0cfd9d6-15fd-4d19-b3b0-2d7792dcac22	RES-CYBERNET	CyberNet Reseller	CyberNet Broadband	GOLD	\N	reseller@cybernet.bd	+8801700000005	cybernet	\N	CyberNet ISP	\N	\N	\N	CyberNet Reseller Portal	ACTIVE	50000.00	0.00	10.00	15.00	\N	\N	2026-11-14 03:25:38.056161+00	2026-11-14 03:25:38.056161+00
3935bc38-b32e-4329-ade0-5910b968ef30	RES-DHAKA-NET	Dhaka Net Partner	Dhaka Net Services	SILVER	\N	partner@dhakanet.bd	+8801700000099	dhakanet	\N	Dhaka Net	\N	\N	\N	Dhaka Net Partner Portal	ACTIVE	15000.00	0.00	8.00	12.00	\N	\N	2026-11-14 03:25:38.056161+00	2026-11-14 03:25:38.056161+00
\.


--
-- Data for Name: router_package_sync; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.router_package_sync (id, router_id, package_id, sync_status, last_synced_at, last_error, remote_ref) FROM stdin;
\.


--
-- Data for Name: saved_payment_methods; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.saved_payment_methods (id, subscriber_id, gateway, label, token_ref, masked_identifier, is_default, status, metadata, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: spatial_ref_sys; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text) FROM stdin;
\.


--
-- Data for Name: subscriber_communications; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.subscriber_communications (id, subscriber_id, direction, channel, subject, body, contact_person, contact_phone, contact_email, related_type, related_id, status, provider_message_id, metadata, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: subscriber_equipment; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.subscriber_equipment (id, subscriber_id, equipment_type, serial_number, mac_address, inventory_serial_id, onu_id, status, assigned_at, installed_at, installed_by, location_details, firmware_version, config_backup, notes, created_at, updated_at) FROM stdin;
eefb9281-6562-4eb0-a4f9-d0acb5ce52bb	bb4ed432-7f51-48ef-b5a4-4e3821bb6e70	ONU	EPON0/1:7	0c:45:ba:81:64:a4	ab96cbb9-3967-4834-8fb5-67c0d4575826	250e16ac-7afa-4373-896a-9876c76c2f22	INSTALLED	2026-11-15 06:46:56.025214+00	2026-11-15 06:46:56.025214+00	\N	\N	\N	\N	Auto-imported from OLT BDCOM P3310C (PON EPON0/1/7)	2026-11-15 06:46:56.025214+00	2026-11-15 06:46:56.025214+00
281027d4-cf1b-40e9-a78c-82bf97117a7c	3510834a-8d5d-4cc4-915a-115ddbdc210b	ONU	EPON03ONU10_idc042@shumon	80:76:11:20:52:70	6faee7a3-d28a-482a-9ca1-81e0ec1a60f3	7ad6a0cd-0176-4327-9d42-4b9bc7900e95	INSTALLED	2026-11-15 06:46:56.047507+00	2026-11-15 06:46:56.047507+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/3/10)	2026-11-15 06:46:56.047507+00	2026-11-15 06:46:56.047507+00
3a25fcb3-9a24-4df3-80b0-eaa8a6c0ee2f	1ad4ce06-b07d-4486-9ec3-b06357b6a495	ONU	EPON02ONU44_01301090060@jolil	4c:d7:c8:de:e1:ce	f56d9804-475d-4f23-8712-cc0b54e5f132	8f638387-7c2d-4178-9fa9-2ef10588551b	INSTALLED	2026-11-15 06:46:56.064328+00	2026-11-15 06:46:56.064328+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/2/44)	2026-11-15 06:46:56.064328+00	2026-11-15 06:46:56.064328+00
07574f51-badd-4ee1-8091-b8c001c48185	5abb8561-a44a-4b87-8502-ad15f3de20e0	ONU	EPON01ONU30_01353318105@rakib	\N	048ced68-de2d-472c-8c32-59da6b34de2f	4c0816a2-2f7e-4662-b1da-53844eb7c6ac	INSTALLED	2026-11-15 06:46:56.08191+00	2026-11-15 06:46:56.08191+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/1/30)	2026-11-15 06:46:56.08191+00	2026-11-15 06:46:56.08191+00
44db27df-f4c3-4140-b042-4810074e97be	d5aea95a-2500-4e9a-813a-c02a13aacf5a	ONU	EPON04ONU21_Humayon	a0:7e:02:22:03:50	117fa5eb-817e-4623-b031-8f4d59286252	d0aa2f2c-aa58-4255-9436-24dc6877af51	INSTALLED	2026-11-15 06:46:56.101707+00	2026-11-15 06:46:56.101707+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/4/21)	2026-11-15 06:46:56.101707+00	2026-11-15 06:46:56.101707+00
9be9dfd0-f866-4313-b427-819141fac1d9	a6db6ec1-f74b-4387-8bde-ad6fa2b44326	ONU	EPON04ONU29_Sohag	\N	2f14e7df-b77c-4932-bd5d-9f47c0f4d1da	a7f5d4bc-93fe-4185-9901-0ee15c0b398a	INSTALLED	2026-11-15 06:46:56.118118+00	2026-11-15 06:46:56.118118+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/4/29)	2026-11-15 06:46:56.118118+00	2026-11-15 06:46:56.118118+00
65ef52be-f6d0-4125-9dea-b555079d7a13	599417ed-a723-4919-b81a-743ef862245f	ONU	EPON04ONU16_Bellal-Ebadul	4c:ae:1c:34:fd:f0	9f0afb7f-877a-4d7b-808a-bf0210510a98	31f0dc33-0a79-4352-9698-a4e68de5ff15	INSTALLED	2026-11-15 06:46:56.133325+00	2026-11-15 06:46:56.133325+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/4/16)	2026-11-15 06:46:56.133325+00	2026-11-15 06:46:56.133325+00
0b2bea17-2bd8-40ba-84ab-d3ef39fbbba3	6b2c6d18-878f-4aee-927b-52dac43dac9d	ONU	EPON04ONU10_Monirul_Belayet_er_More	d0:5f:af:2c:eb:e6	09941424-2189-4ace-b503-97b31100c391	91248fae-1f47-4ff7-8976-8942d6eccba2	INSTALLED	2026-11-15 06:46:56.148286+00	2026-11-15 06:46:56.148286+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/4/10)	2026-11-15 06:46:56.148286+00	2026-11-15 06:46:56.148286+00
5e5e8efa-cdf0-47c0-ae77-a5d395dbbc4c	e5c7e702-e138-4a9e-b7dd-22eca055a1d5	ONU	EPON04ONU9_Shujon_Moddhopara	c0:7e:40:62:41:65	8374555e-6a0b-4ca1-a52c-7940a93dd586	84e54967-a5f6-44c0-b8c8-68332e21fb9a	INSTALLED	2026-11-15 06:46:56.163682+00	2026-11-15 06:46:56.163682+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/4/9)	2026-11-15 06:46:56.163682+00	2026-11-15 06:46:56.163682+00
f34c3616-9cdd-49d4-9010-f2441032c797	ec57ab5f-38af-44b3-80f9-d03103016644	ONU	EPON04ONU7_Rezaul_Sheikh	00:d5:9e:ed:18:72	ec5fd342-dd23-41a1-9402-7edc09f69e5a	c41dc4df-71d6-4a7b-afa8-2b47ba2e8bdb	INSTALLED	2026-11-15 06:46:56.181857+00	2026-11-15 06:46:56.181857+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/4/7)	2026-11-15 06:46:56.181857+00	2026-11-15 06:46:56.181857+00
4ed840d9-ee14-43eb-9c1f-a5dd584dbd37	6489984b-6f66-4330-86db-06172d6b248b	ONU	EPON04ONU3_Alomgir_shop_home	6c:68:a4:62:d4:e4	6b1115ac-9656-440e-9010-911aefd90c25	d39c1f6e-d1fd-4d74-9c23-356f596bb392	INSTALLED	2026-11-15 06:46:56.19988+00	2026-11-15 06:46:56.19988+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/4/3)	2026-11-15 06:46:56.19988+00	2026-11-15 06:46:56.19988+00
3f6f9924-7559-46fa-a76c-416ec5e108aa	fd2f32b1-3f2d-4f5a-9c7b-dbcf0727b6f1	ONU	EPON04ONU2_Alomgir_Shop	c0:7e:40:64:14:29	53c2b7c2-2120-44ea-adea-e017f3b55f26	d2d78802-fe7c-4285-9dc1-dc5601185460	INSTALLED	2026-11-15 06:46:56.219949+00	2026-11-15 06:46:56.219949+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/4/2)	2026-11-15 06:46:56.219949+00	2026-11-15 06:46:56.219949+00
1e8060e4-5b97-41af-9643-9735a0945339	cc27c026-12d0-4358-93d8-5da3bc81dd6f	ONU	EPON03ONU9_Nazmul_Home	c4:70:0b:35:94:88	ae33b263-2806-4206-b640-8603b576d395	64f47f73-a76c-4324-a8fe-5d317ec85406	INSTALLED	2026-11-15 06:46:56.235559+00	2026-11-15 06:46:56.235559+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/3/9)	2026-11-15 06:46:56.235559+00	2026-11-15 06:46:56.235559+00
e8c3e978-7597-470a-8cc7-606e08aaca1e	66a935cb-bfdf-42c7-a3f2-971e17dd6b93	ONU	EPON03ONU4_Nazmul_er_ma	\N	6bd75037-ba97-45fc-ac66-1acd0e194963	c8218d75-c7fa-498a-ae96-e438ace6ce6f	INSTALLED	2026-11-15 06:46:56.249964+00	2026-11-15 06:46:56.249964+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/3/4)	2026-11-15 06:46:56.249964+00	2026-11-15 06:46:56.249964+00
6bca0df0-9b1d-4fd9-a015-c21d792b7557	125536ef-b053-4faf-8882-24aebc8b34f1	ONU	EPON03ONU2_Salam	00:d3:9f:77:91:66	6938f0f7-5a46-4a79-b098-b8968f13cd97	a21d254a-5ed7-4e65-8b8a-d6cee2765214	INSTALLED	2026-11-15 06:46:56.265726+00	2026-11-15 06:46:56.265726+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/3/2)	2026-11-15 06:46:56.265726+00	2026-11-15 06:46:56.265726+00
3814ee3c-945a-4af9-864c-ff6568bb2e19	b43ba3a5-d757-4e07-b08e-f22bfad6c4a2	ONU	EPON02ONU43_Nirapod_Putimari_Dhalipara	00:d3:9e:b7:4b:c0	8668491a-845b-4227-a952-1ef49ab0b747	07ab4546-d641-4ae9-99b1-417020b15162	INSTALLED	2026-11-15 06:46:56.279887+00	2026-11-15 06:46:56.279887+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/2/43)	2026-11-15 06:46:56.279887+00	2026-11-15 06:46:56.279887+00
dda2adbf-a542-425e-a86a-b94f50588122	17bc85cf-503c-413d-9d78-b8a2a0468d39	ONU	EPON02ONU25_Shofik_poschimpara	\N	58846833-e3d0-4f52-bb15-459fe64aec2f	2a4502f0-58f7-4dea-a8d8-c40b1b323322	INSTALLED	2026-11-15 06:46:56.298955+00	2026-11-15 06:46:56.298955+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/2/25)	2026-11-15 06:46:56.298955+00	2026-11-15 06:46:56.298955+00
b56ce6b9-83f5-46b7-ace4-024da28c7dc2	80e1ebe9-c6c7-4b79-b52b-2115cb3617e5	ONU	EPON02ONU18_idc107@rabeya	00:d5:9f:70:3d:f2	34fac430-47f0-46d9-831e-2f8833486cae	d7ad4f98-da16-46c1-9ef7-39581ea67527	INSTALLED	2026-11-15 06:46:56.322856+00	2026-11-15 06:46:56.322856+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/2/18)	2026-11-15 06:46:56.322856+00	2026-11-15 06:46:56.322856+00
05a389f4-e3b8-432f-b742-4c200d2ba688	fe17a6ee-5d04-4333-ad1a-42e4f5f738ac	ONU	EPON02ONU16_Masum	98:c7:a4:35:23:e2	b7372059-04d6-4980-8214-03b9add58328	d7322d92-28c9-4bcb-8d23-ced119670aa2	INSTALLED	2026-11-15 06:46:56.342176+00	2026-11-15 06:46:56.342176+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/2/16)	2026-11-15 06:46:56.342176+00	2026-11-15 06:46:56.342176+00
9b0a0f86-4c2f-4d88-bf87-bb179835078e	51386a76-12c4-40dc-9b90-4d706cfcd12d	ONU	EPON02ONU12_Masum_Putimari_Bazar	1c:ef:03:df:a9:74	d04c7d59-fa4e-4492-97be-06f0a2b23d18	5f5b3e78-a349-41c1-98c4-5e9c8234a85c	INSTALLED	2026-11-15 06:46:56.359475+00	2026-11-15 06:46:56.359475+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/2/12)	2026-11-15 06:46:56.359475+00	2026-11-15 06:46:56.359475+00
f1d84752-8b6f-424b-bb22-b95b6bdf8026	57e677be-22d6-4438-9092-c072d4078bc0	ONU	EPON02ONU10_Ridoy_RAB	6c:68:a4:6f:43:b4	c391e633-d9d5-49b2-b05d-71cefdacbfa2	e60cc66d-af2b-43d5-83aa-a37836a66011	INSTALLED	2026-11-15 06:46:56.37586+00	2026-11-15 06:46:56.37586+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/2/10)	2026-11-15 06:46:56.37586+00	2026-11-15 06:46:56.37586+00
481966ab-1a44-4486-91d9-deba1c996d74	7e7ac0af-af6f-4e8a-9a74-afa48529c2c4	ONU	EPON02ONU5_Elias	54:93:59:22:88:82	dc2b3bf4-93c1-4c31-a956-889a307c6352	f5c1c690-8e78-4363-8eab-c9c78d470b1c	INSTALLED	2026-11-15 06:46:56.389564+00	2026-11-15 06:46:56.389564+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/2/5)	2026-11-15 06:46:56.389564+00	2026-11-15 06:46:56.389564+00
1a595f52-8092-41b5-8282-1438982fd0f2	8588d23b-dccd-4b31-a5e8-d46bf89a2d18	ONU	EPON02ONU3_idc116@anik	4c:ae:1c:aa:4b:68	54849e26-e6e6-40b1-a84c-f4385f9b6ab3	4a0afffc-dff5-484d-85b5-5c2560020e5f	INSTALLED	2026-11-15 06:46:56.404879+00	2026-11-15 06:46:56.404879+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/2/3)	2026-11-15 06:46:56.404879+00	2026-11-15 06:46:56.404879+00
f94d38e7-47d5-42ae-8a75-5c8fefcd40f3	2ab7a28b-5291-4d43-aa76-c68e93ec5c83	ONU	EPON02ONU1_Isa_Dhalipara	4c:ae:1c:aa:49:98	57f7c95a-95f8-4b23-8824-de5e4f886cf7	a086f95e-7db0-4ce9-85b5-579ee3b47e56	INSTALLED	2026-11-15 06:46:56.420393+00	2026-11-15 06:46:56.420393+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/2/1)	2026-11-15 06:46:56.420393+00	2026-11-15 06:46:56.420393+00
3beef1c5-8e38-4363-9f6e-19845d3c8f63	0c451c5f-976c-422b-97fc-baf19c15b3a3	ONU	EPON01ONU29_Bokkar	\N	b579152b-ea40-4e0b-83dc-a86d58a46c1d	9930f5d1-6d45-4a44-9a75-ce7c11d9d413	INSTALLED	2026-11-15 06:46:56.44506+00	2026-11-15 06:46:56.44506+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/1/29)	2026-11-15 06:46:56.44506+00	2026-11-15 06:46:56.44506+00
9e669120-1566-48fe-9a2c-49a553bfcb35	23ef88d9-1994-4b84-80dd-e600dac30c8a	ONU	EPON01ONU26_Arif_2NoPolli	a2:3e:06:15:35:80	cfb02a42-d3d0-42b1-b22c-ded6cc301519	5ac38277-5e84-409f-affd-2f4448eb2bf3	INSTALLED	2026-11-15 06:46:56.466578+00	2026-11-15 06:46:56.466578+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/1/26)	2026-11-15 06:46:56.466578+00	2026-11-15 06:46:56.466578+00
d40975f4-60e2-4332-816b-2d320c74122c	cafdc77f-60fc-4f52-983f-e55e564a3e57	ONU	EPON01ONU25_Shayla	a2:4e:12:23:7a:10	fe2e3cf2-7d2d-4c98-a242-bd11fa50ba2f	215f35bb-9579-41ef-be7f-ef62e0b0110c	INSTALLED	2026-11-15 06:46:56.487511+00	2026-11-15 06:46:56.487511+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/1/25)	2026-11-15 06:46:56.487511+00	2026-11-15 06:46:56.487511+00
a6282ba9-7386-48df-8e3a-230f57deafbc	2be7dc87-3429-4c18-9192-e7b3980d38dc	ONU	EPON01ONU23_Rabeya	54:93:59:22:89:a2	618a00ae-99ea-4fe6-a847-89eecf5bb7fb	2c15a965-476d-4b07-a8b2-f9565270ebac	INSTALLED	2026-11-15 06:46:56.500178+00	2026-11-15 06:46:56.500178+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/1/23)	2026-11-15 06:46:56.500178+00	2026-11-15 06:46:56.500178+00
30343244-e8f8-4004-a260-dd0cc2c1a29c	af07ad2c-5847-4302-a1ad-f22f738990ed	ONU	EPON01ONU21_Sufi_Khadija	\N	8e8a711a-e1c8-4434-ad4e-2378aab4bfb6	968e1441-54c0-4f63-a830-cddd7bf94a7b	INSTALLED	2026-11-15 06:46:56.514696+00	2026-11-15 06:46:56.514696+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/1/21)	2026-11-15 06:46:56.514696+00	2026-11-15 06:46:56.514696+00
128bcbe6-2e34-4a61-b077-1de17b528d91	7ea3a587-1e2c-46bf-9373-493c25838cb9	ONU	EPON01ONU20_Jolil	\N	23f404dd-5b71-4560-938e-1e4ea6d68cf6	07401107-e9dc-47bf-aecc-0c1d630d5392	INSTALLED	2026-11-15 06:46:56.527922+00	2026-11-15 06:46:56.527922+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/1/20)	2026-11-15 06:46:56.527922+00	2026-11-15 06:46:56.527922+00
4d0cc030-2f6d-43f4-a23f-a48b945286c6	0759bf23-4a8a-48e2-a77c-435028988c34	ONU	EPON01ONU18_Alomgir_2_no_polli	\N	07daaaa2-d430-49d1-b31a-707e96e7c53c	2c5ff284-273a-48a5-8996-4c044c293810	INSTALLED	2026-11-15 06:46:56.541768+00	2026-11-15 06:46:56.541768+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/1/18)	2026-11-15 06:46:56.541768+00	2026-11-15 06:46:56.541768+00
6feb7e69-acab-4699-8bc9-d9f44e20bbe3	f8d61e64-1b54-4d00-8c02-2cedd7750306	ONU	EPON01ONU16_Amanullah_Imam	70:a5:6a:cd:80:b4	e28a65e9-f35d-42a1-b9f4-13d9da814aaf	dfaba31d-7b44-43b3-96e8-38e000c9c49a	INSTALLED	2026-11-15 06:46:56.558665+00	2026-11-15 06:46:56.558665+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/1/16)	2026-11-15 06:46:56.558665+00	2026-11-15 06:46:56.558665+00
befb188f-6563-4286-8de2-5556a4add2fa	535fbc00-0bd6-48b2-9143-42ce9e5955d5	ONU	EPON01ONU14_Alif_1no_polli	a2:3e:07:17:3c:00	f847be2f-8ed6-4edf-a131-2b306510a950	c69dc7eb-0171-40aa-937c-61b37c8e2084	INSTALLED	2026-11-15 06:46:56.572469+00	2026-11-15 06:46:56.572469+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/1/14)	2026-11-15 06:46:56.572469+00	2026-11-15 06:46:56.572469+00
52fec959-b1eb-4448-8f60-37455cfc3101	67dc5e8a-0b28-4900-91c9-8dcfe776b0a2	ONU	EPON01ONU13_Pria	6c:68:a4:6f:c4:f4	3004a787-7cf3-459a-8894-2e07081e5418	1bead4cc-6103-4a37-b782-df1f6aa25bb5	INSTALLED	2026-11-15 06:46:56.592896+00	2026-11-15 06:46:56.592896+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/1/13)	2026-11-15 06:46:56.592896+00	2026-11-15 06:46:56.592896+00
d032a12e-6786-4b0b-a8c0-a92271342f1f	1165b6d4-4ab0-43d7-b534-1db9b7400b37	ONU	EPON01ONU12_Roshid	d0:5f:af:2c:e9:58	c4e0d124-a816-4255-8429-3f9d86f44245	9cb43266-58aa-45d8-97e7-447956704e0d	INSTALLED	2026-11-15 06:46:56.604844+00	2026-11-15 06:46:56.604844+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/1/12)	2026-11-15 06:46:56.604844+00	2026-11-15 06:46:56.604844+00
743354d3-d825-4a6d-86ae-793d4364f98a	67cf3639-a816-4e29-a106-784d11312638	ONU	EPON01ONU11_Hasan-Reseller	\N	b17e41a5-5fc4-4d4a-9522-35eaa8674cc3	bd7f597a-4588-4779-aca1-16a0e0b91c94	INSTALLED	2026-11-15 06:46:56.618239+00	2026-11-15 06:46:56.618239+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/1/11)	2026-11-15 06:46:56.618239+00	2026-11-15 06:46:56.618239+00
17594168-1c78-4928-b86c-028db78b3ac9	87a16536-1961-45a3-a329-21df14b91b0a	ONU	EPON01ONU5_Manjarul-Noyon	00:d3:9f:76:cd:dc	44bf1055-ed21-4038-af9d-cad7e9c37ab7	189ab22c-0266-419f-8629-fd86fd62b2e5	INSTALLED	2026-11-15 06:46:56.633022+00	2026-11-15 06:46:56.633022+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/1/5)	2026-11-15 06:46:56.633022+00	2026-11-15 06:46:56.633022+00
b0cf486a-f38e-4538-b8f4-ebbdeee3b9b1	e7e4349b-b6c6-445d-8544-3d0a378aeeaf	ONU	EPON01ONU4_Jubaer	a0:7d:12:20:65:70	8b732b4a-f1e4-45ca-a5c0-0c5e24d3c1a6	9c1afe2d-4793-4421-8eb7-92676ca39e99	INSTALLED	2026-11-15 06:46:56.648361+00	2026-11-15 06:46:56.648361+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/1/4)	2026-11-15 06:46:56.648361+00	2026-11-15 06:46:56.648361+00
920ec4fb-fd56-4be9-b3fa-4078f3f0434d	a903542e-76a5-4122-a00c-e47ff9d4d057	ONU	EPON0/3:1	98:c7:a4:34:bb:36	f3700fd4-4100-47af-aa58-2ebc40dcb057	2bb54155-c4ad-47e2-afdd-b959787c6e0b	INSTALLED	2026-11-15 06:46:56.66+00	2026-11-15 06:46:56.66+00	\N	\N	\N	\N	Auto-imported from OLT BDCOM P3310C (PON EPON0/3/1)	2026-11-15 06:46:56.66+00	2026-11-15 06:46:56.66+00
fb4f6bf9-6c6a-4098-8caf-19c9d528a66a	ada5f420-e833-4ae9-9c3d-099eecc8203b	ONU	EPON0/1:15	08:e8:4f:12:48:25	95e96c2a-d414-4de5-88a2-d54f3de325d2	c69145de-3fd2-426f-b028-ca8616ee16d2	INSTALLED	2026-11-15 06:46:56.672627+00	2026-11-15 06:46:56.672627+00	\N	\N	\N	\N	Auto-imported from OLT BDCOM P3310C (PON EPON0/1/15)	2026-11-15 06:46:56.672627+00	2026-11-15 06:46:56.672627+00
73613d2f-b700-4480-a2cd-cb9c1225d1e9	a1b55cd8-e554-457e-98fe-75aafeb2d8f1	ONU	EPON0/3:6	00:6d:61:63:8f:18	0aca34b4-3ad3-4c99-ae8c-c55a5bd78824	b35302b0-bdfe-466d-a78e-db3bdf980a21	INSTALLED	2026-11-15 06:46:56.685141+00	2026-11-15 06:46:56.685141+00	\N	\N	\N	\N	Auto-imported from OLT BDCOM P3310C (PON EPON0/3/6)	2026-11-15 06:46:56.685141+00	2026-11-15 06:46:56.685141+00
b4859f14-b0f6-4fb3-bdb1-e9912a273aa4	b62bc557-4831-4245-90fe-5a97cc8e20dd	ONU	EPON0/1:8	a2:3e:07:17:3c:e0	46dbdd49-b6b4-4df7-839a-dfae0086556e	6fa557be-adda-4345-9d2f-df2e98563a38	INSTALLED	2026-11-15 06:46:56.698148+00	2026-11-15 06:46:56.698148+00	\N	\N	\N	\N	Auto-imported from OLT BDCOM P3310C (PON EPON0/1/8)	2026-11-15 06:46:56.698148+00	2026-11-15 06:46:56.698148+00
007e7f8a-eede-4f5b-8f6b-6af42918fa8d	933406e7-d44d-4dd2-9e64-7d9a5f66e803	ONU	EPON0/1:11	a0:7e:08:18:34:00	78f13242-e5a5-4ea9-9e7b-ad20368e3362	5fb78fae-7500-4ac5-a7d6-b37411850a81	INSTALLED	2026-11-15 06:46:56.711202+00	2026-11-15 06:46:56.711202+00	\N	\N	\N	\N	Auto-imported from OLT BDCOM P3310C (PON EPON0/1/11)	2026-11-15 06:46:56.711202+00	2026-11-15 06:46:56.711202+00
344f3d2c-eb36-4c22-ba92-3238fe972395	30488228-7d5b-4074-87a8-294d66c0cb3a	ONU	EPON0/1:10	a2:3e:05:23:18:e0	27cd3dad-0a17-448e-ba93-1725fe075e10	e5693884-6956-44a2-aad3-027201df6c93	INSTALLED	2026-11-15 06:46:56.724404+00	2026-11-15 06:46:56.724404+00	\N	\N	\N	\N	Auto-imported from OLT BDCOM P3310C (PON EPON0/1/10)	2026-11-15 06:46:56.724404+00	2026-11-15 06:46:56.724404+00
8c35fe98-9839-44e1-979d-39bbdef35872	02b97ebf-1a80-4c3d-a87a-305b58e9fa61	ONU	EPON0/1:9	a2:3e:05:23:03:d0	8013876f-8c0e-45d2-bc53-586aecdd4040	af38780e-64f1-4594-b096-7ca604944a72	INSTALLED	2026-11-15 06:46:56.739624+00	2026-11-15 06:46:56.739624+00	\N	\N	\N	\N	Auto-imported from OLT BDCOM P3310C (PON EPON0/1/9)	2026-11-15 06:46:56.739624+00	2026-11-15 06:46:56.739624+00
66aa89ec-f86d-42ee-b5c4-e3ff54a264d8	67da9dc9-facc-4d12-857d-10505ce4d2db	ONU	EPON04ONU24_Raju	\N	6656cb5f-c597-4ab3-b73d-1107ba301266	05976cf1-90a6-435d-8804-ff861fa8df3e	INSTALLED	2026-11-15 06:55:27.370223+00	2026-11-15 06:55:27.370223+00	\N	\N	\N	\N	Auto-imported from OLT VSOL V1600D (PON EPON0/4/24)	2026-11-15 06:55:27.370223+00	2026-11-15 06:55:27.370223+00
\.


--
-- Data for Name: subscriber_sessions; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.subscriber_sessions (id, subscriber_id, router_id, username, session_id, ip_address, mac_address, uptime_sec, rx_bps, tx_bps, rx_bytes, tx_bytes, status, nas_port, updated_at) FROM stdin;
fb1715b1-f955-49e6-9db7-b5c4eb8839fa	fe658979-472d-401e-827a-eda63eb6b1ea	d0a742a6-7b95-47a7-96a2-e0af96569ed1	idc055@rubel	\N	\N	\N	0	0	0	0	0	OFFLINE	\N	2026-11-15 07:16:15.258278+00
f61202c8-639d-47f0-9571-39836e66c9c8	535fbc00-0bd6-48b2-9143-42ce9e5955d5	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac043Alif	\N	192.168.88.238	5C:E9:31:BE:F1:7B	95970	0	0	27224040	512117312	ONLINE	\N	2026-11-15 07:16:15.208836+00
081189a9-1203-44d5-8fee-6f4d5736052b	7ea3a587-1e2c-46bf-9373-493c25838cb9	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac045Khokon	\N	192.168.88.158	CC:2D:21:13:9A:F8	0	0	0	0	0	OFFLINE	\N	2026-11-15 07:16:15.326893+00
ef1c5526-a685-4f9e-a41c-97a17911e76b	d3ed7a0e-33c4-43c2-b4bc-35713f861b59	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac135@Monir	\N	\N	\N	0	0	0	0	0	OFFLINE	\N	2026-11-15 07:16:15.262143+00
a2f9bc85-144b-464c-87c0-1a254da61857	8588d23b-dccd-4b31-a5e8-d46bf89a2d18	d0a742a6-7b95-47a7-96a2-e0af96569ed1	idc116@anik	\N	\N	\N	0	0	0	0	0	OFFLINE	\N	2026-11-15 07:16:15.394322+00
bd056777-bdee-4467-b708-d7ee12864407	87a16536-1961-45a3-a329-21df14b91b0a	d0a742a6-7b95-47a7-96a2-e0af96569ed1	01948675924	\N	192.168.88.144	BC:60:6B:46:52:86	1376	0	0	0	0	ONLINE	\N	2026-11-15 07:16:15.399316+00
c5e76235-1435-4ccc-9713-f164b69e9a3d	125536ef-b053-4faf-8882-24aebc8b34f1	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac035Salam	\N	192.168.88.231	7C:10:C9:39:4A:D8	334617	42736	1390144	34000616	276764216	ONLINE	\N	2026-11-15 07:16:15.212981+00
4e784887-a73a-4b3d-9adf-573402b9f57c	1ad4ce06-b07d-4486-9ec3-b06357b6a495	d0a742a6-7b95-47a7-96a2-e0af96569ed1	01301090060@jolil	\N	192.168.88.145	80:9F:E4:98:21:70	91376	0	0	0	0	ONLINE	\N	2026-11-15 07:16:15.339743+00
41df3c5b-2435-4cf8-a6e6-7eddf076cc3b	17bc85cf-503c-413d-9d78-b8a2a0468d39	d0a742a6-7b95-47a7-96a2-e0af96569ed1	idc049@shofik	\N	192.168.88.146	50:0F:F5:75:4E:B0	96724	0	0	0	0	ONLINE	\N	2026-11-15 07:16:15.24014+00
e179b826-d21d-4947-af2c-7e840562ca3e	fe17a6ee-5d04-4333-ad1a-42e4f5f738ac	d0a742a6-7b95-47a7-96a2-e0af96569ed1	idc036@masum	\N	192.168.88.227	B8:3A:08:91:C4:38	35763	0	0	1087232	2706720	ONLINE	\N	2026-11-15 07:16:15.266323+00
07c32faa-028f-42a0-acae-b48305590cbf	67da9dc9-facc-4d12-857d-10505ce4d2db	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac017@Dulal	\N	\N	\N	0	0	0	0	0	OFFLINE	\N	2026-11-15 07:16:15.242247+00
732c1740-343c-4c18-95ae-d5a46340a2ad	6b2c6d18-878f-4aee-927b-52dac43dac9d	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac033@Monir	\N	192.168.88.171	5C:A6:E6:4F:8C:C3	95971	14720	6576	22678104	395066712	ONLINE	\N	2026-11-15 07:16:15.41078+00
e0275de7-66de-43c0-a50c-7343792213c0	0c451c5f-976c-422b-97fc-baf19c15b3a3	d0a742a6-7b95-47a7-96a2-e0af96569ed1	idc110@bakar	\N	192.168.88.176	80:9F:E4:BF:10:49	95942	1152	2752	2304	5504	ONLINE	\N	2026-11-15 07:16:15.423742+00
6528ad8a-661a-498d-b399-03a21b79d7c6	6489984b-6f66-4330-86db-06172d6b248b	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac011@Alomgir	\N	10.4.0.11	CC:2D:21:A7:04:E0	94072	0	0	0	0	ONLINE	\N	2026-11-15 07:16:15.246617+00
36819421-cd9d-46e9-a3e5-e00c17a1d4b1	cc27c026-12d0-4358-93d8-5da3bc81dd6f	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac006Nazmul	\N	192.168.88.251	58:D9:D5:34:37:28	334464	0	0	48387336	1068703440	ONLINE	\N	2026-11-15 07:16:15.220772+00
56e88c41-7e0a-492a-80e4-bfbe30f1b9d2	d5369706-41b0-4462-99fe-565789a40e97	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac102@Alihasan	\N	\N	\N	0	0	0	0	0	OFFLINE	\N	2026-11-15 07:16:15.269689+00
f72626cb-f78f-4b38-9d64-1426dae6a4a8	23ef88d9-1994-4b84-80dd-e600dac30c8a	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac055Arif	\N	192.168.88.166	D8:32:14:69:1D:A8	95786	0	0	0	0	ONLINE	\N	2026-11-15 07:16:15.352464+00
e77769b6-bf9b-4237-8284-c22573a3074d	b62bc557-4831-4245-90fe-5a97cc8e20dd	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac042Naim	\N	192.168.88.219	CC:2D:21:36:A7:8F	277	0	0	0	0	ONLINE	\N	2026-11-15 07:16:15.223576+00
67854726-b5ec-4eae-a7d6-6f8801c49e8d	51386a76-12c4-40dc-9b90-4d706cfcd12d	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac011Masum	\N	192.168.88.178	C0:C9:E3:FD:A0:1D	95968	2504	0	12962296	177790616	ONLINE	\N	2026-11-15 07:16:15.227819+00
c66dfc3f-5f62-438b-92f7-9733909bcf4c	ada5f420-e833-4ae9-9c3d-099eecc8203b	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac008Habibullah	\N	192.168.88.247	9C:53:22:40:8B:AC	95997	0	0	13161456	271124296	ONLINE	\N	2026-11-15 07:16:15.356478+00
5c3eca28-be93-46e6-93a0-537c497d878b	66a935cb-bfdf-42c7-a3f2-971e17dd6b93	d0a742a6-7b95-47a7-96a2-e0af96569ed1	idc043@nazmul	\N	10.5.6.2	54:AF:97:94:99:4C	334613	0	0	138992176	225566880	ONLINE	\N	2026-11-15 07:16:15.250516+00
bbf1ef60-8d57-44ab-bf18-e8d5678b0ba7	2ab7a28b-5291-4d43-aa76-c68e93ec5c83	d0a742a6-7b95-47a7-96a2-e0af96569ed1	idc040@isa	\N	192.168.88.164	D8:32:14:08:FA:90	95976	492776	557808	145259632	674210744	ONLINE	\N	2026-11-15 07:16:15.385376+00
49c7b3c2-65df-455b-a33b-ff783289a9e8	6f1a1dd4-2557-48c0-92d7-4f4ccdfb736b	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Idc051@Rabbi	\N	\N	\N	0	0	0	0	0	OFFLINE	\N	2026-11-15 07:16:15.273526+00
bb5e2668-34b3-4e98-b930-b3a38be5c7cf	a1b55cd8-e554-457e-98fe-75aafeb2d8f1	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac101@Jit	\N	192.168.88.186	80:3F:5D:7A:2D:CF	96000	137192	4927360	17900976	393391680	ONLINE	\N	2026-11-15 07:16:15.199631+00
a5b7dfde-5ff7-466c-bf4e-4010954425ea	a429a857-a2c8-4ef0-83c6-1151f69e506f	d0a742a6-7b95-47a7-96a2-e0af96569ed1	mostafiz9513@speednet	\N	\N	\N	0	0	0	0	0	OFFLINE	\N	2026-11-15 07:16:15.204342+00
6f72e31c-e321-40b4-a589-13bad6525889	02fc9985-834b-42ad-a34b-cc3fcc90db21	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac025Amina	\N	\N	\N	0	0	0	0	0	OFFLINE	\N	2026-11-15 07:16:15.277007+00
a15410b0-ab97-40db-8d73-cb691453f277	7e7ac0af-af6f-4e8a-9a74-afa48529c2c4	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac004Elias	\N	192.168.88.250	24:2F:D0:9F:1D:65	755	0	0	212864	3122504	ONLINE	\N	2026-11-15 07:16:15.233748+00
d3e9eec7-5aaf-4120-ad30-ce4149ac533d	3510834a-8d5d-4cc4-915a-115ddbdc210b	d0a742a6-7b95-47a7-96a2-e0af96569ed1	idc042@shumon	\N	10.5.6.3	00:72:63:DC:8F:70	334594	0	0	27391136	1083998888	ONLINE	\N	2026-11-15 07:16:15.254355+00
177a7122-3bf3-44d3-b67c-b2c0246a23ab	57e677be-22d6-4438-9092-c072d4078bc0	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac048Ridoy	\N	192.168.88.221	80:3F:5D:8F:38:9D	95984	0	0	5150784	92418560	ONLINE	\N	2026-11-15 07:16:15.280875+00
8f6289b8-01ea-4ee1-b0c6-09fe27d0f59d	2da32c77-bdab-4d67-b519-7e2e5740f471	d0a742a6-7b95-47a7-96a2-e0af96569ed1	idc022@nazmul	\N	\N	\N	0	0	0	0	0	OFFLINE	\N	2026-11-15 07:16:15.368049+00
ac6055c8-989d-4cb6-ae77-3addd288cb4e	02b97ebf-1a80-4c3d-a87a-305b58e9fa61	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac020Mafia	\N	192.168.88.245	D8:32:14:86:81:48	34847	0	0	8921032	286382328	ONLINE	\N	2026-11-15 07:16:15.304055+00
05f6b778-c4b3-404c-8ad6-d9ff18f7153c	599417ed-a723-4919-b81a-743ef862245f	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac064Ebadul	\N	192.168.88.190	90:6A:94:AB:79:73	95957	1344	1344	2688	2688	ONLINE	\N	2026-11-15 07:16:15.307884+00
d675eefe-d320-47bd-b95f-9f6cdd24ffa3	80e1ebe9-c6c7-4b79-b52b-2115cb3617e5	d0a742a6-7b95-47a7-96a2-e0af96569ed1	idc107@rabeya	\N	192.168.88.198	60:A4:B7:21:53:0B	92791	0	0	0	0	ONLINE	\N	2026-11-15 07:16:15.372675+00
372f667f-a328-4e1f-bf2f-7fabe2621165	933406e7-d44d-4dd2-9e64-7d9a5f66e803	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac049Aria	\N	192.168.88.233	50:0F:F5:3A:CE:17	95987	0	0	36068472	568810792	ONLINE	\N	2026-11-15 07:16:15.331949+00
5b291217-61a4-43cf-9891-ee2338e9c917	a6db6ec1-f74b-4387-8bde-ad6fa2b44326	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac007Sohag	\N	192.168.88.249	D8:32:14:4E:9E:C9	95978	0	0	9934304	353957168	ONLINE	\N	2026-11-15 07:16:15.335825+00
1351f182-55d8-4172-b242-d6d6a5ed74e0	67dc5e8a-0b28-4900-91c9-8dcfe776b0a2	d0a742a6-7b95-47a7-96a2-e0af96569ed1	idc301@pria	\N	192.168.88.209	80:9F:E4:87:E9:00	6291	0	0	0	0	ONLINE	\N	2026-11-15 07:16:15.376418+00
5c8a7d92-526d-4613-ac68-8a74b6093d11	5abb8561-a44a-4b87-8502-ad15f3de20e0	d0a742a6-7b95-47a7-96a2-e0af96569ed1	01353318105@rakib	\N	192.168.88.173	08:8A:F1:F3:CD:C7	95977	0	0	47141456	239785560	ONLINE	\N	2026-11-15 07:16:15.381589+00
228e0e86-fd8a-4c83-91eb-50149a9d58b5	b43ba3a5-d757-4e07-b08e-f22bfad6c4a2	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac009Nirapod	\N	192.168.88.248	CC:2D:21:01:9D:BF	0	0	0	15172784	238544680	OFFLINE	\N	2026-11-15 07:16:15.218091+00
310ee4fe-db85-4c56-b9b3-67f2bd12e2a1	d5aea95a-2500-4e9a-813a-c02a13aacf5a	d0a742a6-7b95-47a7-96a2-e0af96569ed1	01912654494@humayon	\N	192.168.88.152	80:9F:E4:87:A3:60	34323	0	0	0	0	ONLINE	\N	2026-11-15 07:16:15.343656+00
e86402c6-2181-41c9-91c7-d2641b207940	e5c7e702-e138-4a9e-b7dd-22eca055a1d5	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac012Shujon	\N	192.168.88.191	F0:B4:D2:3F:8A:A7	95964	0	0	2116576	40606776	ONLINE	\N	2026-11-15 07:16:15.403113+00
4cb23892-08e1-42e0-8ca3-1aa1b3e9d11c	0759bf23-4a8a-48e2-a77c-435028988c34	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac031Alomgir	\N	192.168.88.241	B8:3A:08:06:46:A8	88941	0	0	0	0	ONLINE	\N	2026-11-15 07:16:15.237286+00
099896dd-77f9-4019-87c9-a968b326a089	fd2f32b1-3f2d-4f5a-9c7b-dbcf0727b6f1	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac010@Alomgir	\N	10.4.0.10	CC:2D:21:5C:C8:D0	95979	4306848	135936	1596445192	124620456	ONLINE	\N	2026-11-15 07:16:15.348531+00
a41b80f5-679e-4d6f-bc64-0ceda2654c0c	e7e4349b-b6c6-445d-8544-3d0a378aeeaf	d0a742a6-7b95-47a7-96a2-e0af96569ed1	idc012@jubayer	\N	192.168.88.182	D8:32:14:4C:04:48	36439	0	0	0	0	ONLINE	\N	2026-11-15 07:16:15.284748+00
6d68d7f0-c0d1-433b-871f-bb326707d0bb	cafdc77f-60fc-4f52-983f-e55e564a3e57	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac027Shayla	\N	192.168.88.220	1C:5F:2B:DD:52:7D	67208	0	0	0	0	ONLINE	\N	2026-11-15 07:16:15.406862+00
ebdb4436-ac8f-4d1d-8e7c-ad5af4259fc9	30488228-7d5b-4074-87a8-294d66c0cb3a	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac017Dulal	\N	192.168.88.243	40:3F:8C:92:B6:F1	95971	26080	799232	9910032	177498992	ONLINE	\N	2026-11-15 07:16:15.415607+00
23020fde-f2ca-443e-a93f-d141da5e103a	c58cb056-837e-4995-bb62-5ca1ae96aa92	d0a742a6-7b95-47a7-96a2-e0af96569ed1	idc069@mursalin	\N	\N	\N	0	0	0	0	0	OFFLINE	\N	2026-11-15 07:16:15.28866+00
7d3863fb-487d-4237-9984-8d74f51b877e	1165b6d4-4ab0-43d7-b534-1db9b7400b37	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac047Roshid	\N	192.168.88.236	D8:32:14:FF:29:48	78832	0	0	43144160	363580808	ONLINE	\N	2026-11-15 07:16:15.360425+00
8275007f-55c6-4ec7-932f-16ccbec6c773	ec57ab5f-38af-44b3-80f9-d03103016644	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac037Rezaul	\N	192.168.88.239	A8:42:A1:B0:4A:54	95962	0	0	613912	10550400	ONLINE	\N	2026-11-15 07:16:15.292576+00
d13c961d-3277-4ff1-ad12-3fc4eb51c7eb	f8d61e64-1b54-4d00-8c02-2cedd7750306	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac060Imam	\N	192.168.88.213	50:0F:F5:F6:1F:98	88971	0	0	0	0	ONLINE	\N	2026-11-15 07:16:15.364248+00
04e83ebe-70f5-45e7-97fc-4453d211e707	67cf3639-a816-4e29-a106-784d11312638	d0a742a6-7b95-47a7-96a2-e0af96569ed1	ac0036hasan	\N	192.168.88.147	B4:0F:3B:60:E9:50	95968	11392	32272	60714848	1479257704	ONLINE	\N	2026-11-15 07:16:15.296602+00
142fcdd1-39d6-49c8-b7be-9d8ec83001d0	d5f2c064-bfcd-4c5e-8e80-18eb50a7ea41	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac034Tafi	\N	192.168.88.240	9C:53:22:43:2E:AB	0	0	0	4161144	27726560	OFFLINE	\N	2026-11-15 07:16:15.300461+00
150be16c-df57-404e-b2cd-4d04086ce0d5	a903542e-76a5-4122-a00c-e47ff9d4d057	d0a742a6-7b95-47a7-96a2-e0af96569ed1	idc011@salam	\N	192.168.88.228	9C:53:22:B0:1D:81	95964	15752	60592	15149384	416557920	ONLINE	\N	2026-11-15 07:16:15.311225+00
c92109f1-6d42-47ba-aa18-2475ab5fb09e	2be7dc87-3429-4c18-9192-e7b3980d38dc	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac023Rabeya	\N	192.168.88.170	50:0F:F5:A7:06:38	96024	265952	54504	77469784	884557704	ONLINE	\N	2026-11-15 07:16:15.315426+00
78953525-20c1-444c-8f51-409430398f00	af07ad2c-5847-4302-a1ad-f22f738990ed	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac003Sufi	\N	192.168.88.252	D8:32:14:81:6D:D8	95997	1832	1320	47538384	1116896104	ONLINE	\N	2026-11-15 07:16:15.31913+00
0e7c246b-8509-4edf-9381-8ed2db7fd3d4	bb4ed432-7f51-48ef-b5a4-4e3821bb6e70	d0a742a6-7b95-47a7-96a2-e0af96569ed1	Ac060Ibrahim	\N	192.168.88.232	D8:32:14:11:0F:5F	61880	0	0	7240824	181685544	ONLINE	\N	2026-11-15 07:16:15.323062+00
\.


--
-- Data for Name: subscribers; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.subscribers (id, client_code, full_name, subscriber_type, connection_type, username, password, phone, email, nid_number, package_name, bandwidth_mbps, monthly_bill, status, area_id, zone_id, distribution_box_id, address, latitude, longitude, location, ip_address, mac_address, installation_date, district, thana, upazila, post_office, village, area_name, ward_no, road_no, house_no, created_at, updated_at, notes, billing_cycle_day, billing_anchor, next_bill_date, expiry_date, due_date, grace_until, suspension_stage, walled_garden, auto_suspend_enabled, last_billed_at, current_due, balance, wallet_balance, reseller_id, suspension_reason, fup_exceeded, fup_applied_at, fup_exempt, auto_pay_enabled, preferred_gateway, provisioning_mode, router_id, price_override, custom_package_note, extended_expiry, branch_name) FROM stdin;
a903542e-76a5-4122-a00c-e47ff9d4d057	IZN-MT-00023	idc011@salam	HOME	PPPOE	idc011@salam	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	idc011@salam |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.373268+00	2026-11-15 07:49:28.08835+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
2be7dc87-3429-4c18-9192-e7b3980d38dc	IZN-MT-00024	Ac023Rabeya	HOME	PPPOE	Ac023Rabeya	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac023Rabeya |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.37996+00	2026-11-15 07:49:28.093934+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
af07ad2c-5847-4302-a1ad-f22f738990ed	IZN-MT-00025	Ac003Sufi	HOME	PPPOE	Ac003Sufi	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Sufi Khadija | user@email.com | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.38683+00	2026-11-15 07:49:28.100167+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
bb4ed432-7f51-48ef-b5a4-4e3821bb6e70	IZN-MT-00026	Ac060Ibrahim	HOME	PPPOE	Ac060Ibrahim	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ibrahim | user@email.com | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.39528+00	2026-11-15 07:49:28.106782+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
7ea3a587-1e2c-46bf-9373-493c25838cb9	IZN-MT-00027	Ac045Khokon	HOME	PPPOE	Ac045Khokon	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac045Khokon |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.401955+00	2026-11-15 07:49:28.113274+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
a1b55cd8-e554-457e-98fe-75aafeb2d8f1	IZN-MT-00028	Ac101@Jit	HOME	PPPOE	Ac101@Jit	01311079025	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Tarek Saddam |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.408835+00	2026-11-15 07:49:28.119455+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
a429a857-a2c8-4ef0-83c6-1151f69e506f	IZN-MT-00029	mostafiz9513@speednet	HOME	PPPOE	mostafiz9513@speednet	123456	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	SADDAM MIKROTIK	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.417544+00	2026-11-15 07:49:28.124996+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
535fbc00-0bd6-48b2-9143-42ce9e5955d5	IZN-MT-00030	Ac043Alif	HOME	PPPOE	Ac043Alif	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac043Alif |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.424401+00	2026-11-15 07:49:28.130651+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
125536ef-b053-4faf-8882-24aebc8b34f1	IZN-MT-00031	Ac035Salam	HOME	PPPOE	Ac035Salam	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac035Salam |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.431837+00	2026-11-15 07:49:28.136059+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
b43ba3a5-d757-4e07-b08e-f22bfad6c4a2	IZN-MT-00018	Ac009Nirapod	HOME	PPPOE	Ac009Nirapod	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac009Nirapod |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.340731+00	2026-11-15 07:49:28.142542+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
cc27c026-12d0-4358-93d8-5da3bc81dd6f	IZN-MT-00032	Ac006Nazmul	HOME	PPPOE	Ac006Nazmul	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac006Nazmul |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.437634+00	2026-11-15 07:49:28.148502+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
b62bc557-4831-4245-90fe-5a97cc8e20dd	IZN-MT-00033	Ac042Naim	HOME	PPPOE	Ac042Naim	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac042Naim |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.444152+00	2026-11-15 07:49:28.153602+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
51386a76-12c4-40dc-9b90-4d706cfcd12d	IZN-MT-00034	Ac011Masum	HOME	PPPOE	Ac011Masum	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac011Masum |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.45069+00	2026-11-15 07:49:28.160843+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
7e7ac0af-af6f-4e8a-9a74-afa48529c2c4	IZN-MT-00035	Ac004Elias	HOME	PPPOE	Ac004Elias	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac004Elias |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.45806+00	2026-11-15 07:49:28.165939+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
0759bf23-4a8a-48e2-a77c-435028988c34	IZN-MT-00021	Ac031Alomgir	HOME	PPPOE	Ac031Alomgir	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac031Alomgir |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.359756+00	2026-11-15 07:49:28.170974+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
17bc85cf-503c-413d-9d78-b8a2a0468d39	IZN-MT-00036	idc049@shofik	HOME	PPPOE	idc049@shofik	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	idc049@shofik |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.46454+00	2026-11-15 07:49:28.178863+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
67da9dc9-facc-4d12-857d-10505ce4d2db	IZN-MT-00039	Ac017@Dulal	HOME	PPPOE	Ac017@Dulal	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac017@Dulal |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.485897+00	2026-11-15 07:49:28.186362+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
6489984b-6f66-4330-86db-06172d6b248b	IZN-MT-00004	Ac011@Alomgir	HOME	PPPOE	Ac011@Alomgir	1234	\N	\N	\N	Special	\N	0.00	ACTIVE	\N	\N	\N	Alomgir vooter adda Home	\N	\N	\N	10.4.0.11	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.257773+00	2026-11-15 07:49:28.192368+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
66a935cb-bfdf-42c7-a3f2-971e17dd6b93	IZN-MT-00005	idc043@nazmul	HOME	PPPOE	idc043@nazmul	1234	\N	\N	\N	6Mbps	\N	0.00	ACTIVE	\N	\N	\N	Imported from MikroTik MikroTik 103.112.150.52	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.263623+00	2026-11-15 07:49:28.198189+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
3510834a-8d5d-4cc4-915a-115ddbdc210b	IZN-MT-00006	idc042@shumon	HOME	PPPOE	idc042@shumon	1234	\N	\N	\N	6Mbps	\N	0.00	ACTIVE	\N	\N	\N	Imported from MikroTik MikroTik 103.112.150.52	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.269962+00	2026-11-15 07:49:28.203838+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
fe658979-472d-401e-827a-eda63eb6b1ea	IZN-MT-00008	idc055@rubel	HOME	PPPOE	idc055@rubel	1234	\N	\N	\N	6Mbps	\N	0.00	ACTIVE	\N	\N	\N	Rubel 12/10/25	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.280689+00	2026-11-15 07:49:28.208704+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
d3ed7a0e-33c4-43c2-b4bc-35713f861b59	IZN-MT-00009	Ac135@Monir	HOME	PPPOE	Ac135@Monir	01977575175	\N	\N	\N	10Mbps	\N	0.00	ACTIVE	\N	\N	\N	Monir_Saddam  11/01/26	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.286397+00	2026-11-15 07:49:28.213595+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
fe17a6ee-5d04-4333-ad1a-42e4f5f738ac	IZN-MT-00010	idc036@masum	HOME	PPPOE	idc036@masum	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Masum BNP | user@email.com | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.291613+00	2026-11-15 07:49:28.219437+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
d5369706-41b0-4462-99fe-565789a40e97	IZN-MT-00011	Ac102@Alihasan	HOME	PPPOE	Ac102@Alihasan	01917789529	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ali Hasan | user@email.com | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.297003+00	2026-11-15 07:49:28.224749+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
6f1a1dd4-2557-48c0-92d7-4f4ccdfb736b	IZN-MT-00007	Idc051@Rabbi	HOME	PPPOE	Idc051@Rabbi	1234	\N	\N	\N	10Mbps	\N	0.00	ACTIVE	\N	\N	\N	Rabbi Rail Bridge 2/10/25	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.275389+00	2026-11-15 07:49:28.232789+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
02fc9985-834b-42ad-a34b-cc3fcc90db21	IZN-MT-00012	Ac025Amina	HOME	PPPOE	Ac025Amina	1234	\N	\N	\N	Basic	\N	0.00	SUSPENDED	\N	\N	\N	Amina Islam | user@email.com | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.303135+00	2026-11-15 07:49:28.237892+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
57e677be-22d6-4438-9092-c072d4078bc0	IZN-MT-00013	Ac048Ridoy	HOME	PPPOE	Ac048Ridoy	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ridoy | user@email.com | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.308927+00	2026-11-15 07:49:28.242675+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
e7e4349b-b6c6-445d-8544-3d0a378aeeaf	IZN-MT-00014	idc012@jubayer	HOME	PPPOE	idc012@jubayer	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Jubayer | user@email.com | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.316871+00	2026-11-15 07:49:28.248402+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
c58cb056-837e-4995-bb62-5ca1ae96aa92	IZN-MT-00015	idc069@mursalin	HOME	PPPOE	idc069@mursalin	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Korban 3 no polli 20/5/26	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.3231+00	2026-11-15 07:49:28.25345+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
ec57ab5f-38af-44b3-80f9-d03103016644	IZN-MT-00017	Ac037Rezaul	HOME	PPPOE	Ac037Rezaul	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac037Rezaul |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.334858+00	2026-11-15 07:49:28.258456+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
67cf3639-a816-4e29-a106-784d11312638	IZN-MT-00016	ac0036hasan	HOME	PPPOE	ac0036hasan	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Imported from MikroTik MikroTik 103.112.150.52	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.328895+00	2026-11-15 07:49:28.263552+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
d5f2c064-bfcd-4c5e-8e80-18eb50a7ea41	IZN-MT-00019	Ac034Tafi	HOME	PPPOE	Ac034Tafi	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac034Tafi |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.347116+00	2026-11-15 07:49:28.269226+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
02b97ebf-1a80-4c3d-a87a-305b58e9fa61	IZN-MT-00020	Ac020Mafia	HOME	PPPOE	Ac020Mafia	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac020Mafia |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.353187+00	2026-11-15 07:49:28.274554+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
599417ed-a723-4919-b81a-743ef862245f	IZN-MT-00022	Ac064Ebadul	HOME	PPPOE	Ac064Ebadul	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac064Ebadul |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.366428+00	2026-11-15 07:49:28.079172+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
6b2c6d18-878f-4aee-927b-52dac43dac9d	IZN-MT-00043	Ac033@Monir	HOME	PPPOE	Ac033@Monir	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac033@Monir |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.508449+00	2026-11-15 07:49:28.312301+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
ada5f420-e833-4ae9-9c3d-099eecc8203b	IZN-MT-00044	Ac008Habibullah	HOME	PPPOE	Ac008Habibullah	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac008Habibullah |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.513715+00	2026-11-15 07:49:28.317644+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
1165b6d4-4ab0-43d7-b534-1db9b7400b37	IZN-MT-00048	Ac047Roshid	HOME	PPPOE	Ac047Roshid	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac047Roshid |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.537548+00	2026-11-15 07:49:28.323097+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
f8d61e64-1b54-4d00-8c02-2cedd7750306	IZN-MT-00049	Ac060Imam	HOME	PPPOE	Ac060Imam	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac060Imam |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.543318+00	2026-11-15 07:49:28.327739+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
2da32c77-bdab-4d67-b519-7e2e5740f471	IZN-MT-00002	idc022@nazmul	HOME	PPPOE	idc022@nazmul	1234	\N	\N	\N	10Mbps	\N	0.00	SUSPENDED	\N	\N	\N	Jubayer 10/6/25	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.168071+00	2026-11-15 07:49:28.334958+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
80e1ebe9-c6c7-4b79-b52b-2115cb3617e5	IZN-MT-00056	idc107@rabeya	HOME	PPPOE	idc107@rabeya	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Rabeya Begum |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.589067+00	2026-11-15 07:49:28.339926+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
a6db6ec1-f74b-4387-8bde-ad6fa2b44326	IZN-MT-00050	Ac007Sohag	HOME	PPPOE	Ac007Sohag	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac007Sohag |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.549288+00	2026-11-15 07:49:28.388885+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
5abb8561-a44a-4b87-8502-ad15f3de20e0	IZN-MT-00040	01353318105@rakib	HOME	PPPOE	01353318105@rakib	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Rakib Islam	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.491181+00	2026-11-15 07:49:28.279415+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
d5aea95a-2500-4e9a-813a-c02a13aacf5a	IZN-MT-00053	01912654494@humayon	HOME	PPPOE	01912654494@humayon	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Humayon |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.569863+00	2026-11-15 07:49:28.284148+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
8588d23b-dccd-4b31-a5e8-d46bf89a2d18	IZN-MT-00037	idc116@anik	HOME	PPPOE	idc116@anik	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Imported from MikroTik MikroTik 103.112.150.52	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.47405+00	2026-11-15 07:49:28.288974+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
23ef88d9-1994-4b84-80dd-e600dac30c8a	IZN-MT-00042	Ac055Arif	HOME	PPPOE	Ac055Arif	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac055Arif |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.503157+00	2026-11-15 07:49:28.293667+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
e5c7e702-e138-4a9e-b7dd-22eca055a1d5	IZN-MT-00054	Ac012Shujon	HOME	PPPOE	Ac012Shujon	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac012Shujon |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.575938+00	2026-11-15 07:49:28.300864+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
0c451c5f-976c-422b-97fc-baf19c15b3a3	IZN-MT-00038	idc110@bakar	HOME	PPPOE	idc110@bakar	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Abu Bakar |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.480194+00	2026-11-15 07:49:28.3069+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
67dc5e8a-0b28-4900-91c9-8dcfe776b0a2	IZN-MT-00051	idc301@pria	HOME	PPPOE	idc301@pria	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Pria Akter |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.557399+00	2026-11-15 07:49:28.344896+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
87a16536-1961-45a3-a329-21df14b91b0a	IZN-MT-00046	01948675924	HOME	PPPOE	01948675924	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Manjarul Islam Noyon | user@email.com | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.525399+00	2026-11-15 07:49:28.350044+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
933406e7-d44d-4dd2-9e64-7d9a5f66e803	IZN-MT-00047	Ac049Aria	HOME	PPPOE	Ac049Aria	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac049Aria |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.531922+00	2026-11-15 07:49:28.356622+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
cafdc77f-60fc-4f52-983f-e55e564a3e57	IZN-MT-00052	Ac027Shayla	HOME	PPPOE	Ac027Shayla	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac027Shayla |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.563648+00	2026-11-15 07:49:28.363033+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
1ad4ce06-b07d-4486-9ec3-b06357b6a495	IZN-MT-00041	01301090060@jolil	HOME	PPPOE	01301090060@jolil	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Jolil islam |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.497953+00	2026-11-15 07:49:28.368754+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
30488228-7d5b-4074-87a8-294d66c0cb3a	IZN-MT-00055	Ac017Dulal	HOME	PPPOE	Ac017Dulal	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	Ac017Dulal |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.582556+00	2026-11-15 07:49:28.373879+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
fd2f32b1-3f2d-4f5a-9c7b-dbcf0727b6f1	IZN-MT-00003	Ac010@Alomgir	HOME	PPPOE	Ac010@Alomgir	1234	\N	\N	\N	Special	\N	0.00	ACTIVE	\N	\N	\N	Alomgir vooter adda	\N	\N	\N	10.4.0.10	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.249261+00	2026-11-15 07:49:28.378862+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
2ab7a28b-5291-4d43-aa76-c68e93ec5c83	IZN-MT-00045	idc040@isa	HOME	PPPOE	idc040@isa	1234	\N	\N	\N	Basic	\N	0.00	ACTIVE	\N	\N	\N	idc040@isa |  | 	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-11-14 08:13:03.520183+00	2026-11-15 07:49:28.383633+00	\N	1	\N	\N	\N	\N	\N	NONE	f	t	\N	0.00	0.00	0.00	\N	\N	f	\N	f	f	\N	ROUTER	d0a742a6-7b95-47a7-96a2-e0af96569ed1	\N	\N	f	\N
\.


--
-- Data for Name: ticket_comments; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.ticket_comments (id, ticket_id, author_name, author_role, body, is_internal, created_at) FROM stdin;
\.


--
-- Data for Name: tickets; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.tickets (id, ticket_no, subscriber_id, reseller_id, subject, description, category, priority, status, sla_policy, sla_due_at, sla_breached, assigned_technician_id, assigned_technician_name, assigned_technician_phone, dispatch_status, site_latitude, site_longitude, site_address, gps_nav_url, resolution_notes, source, opened_at, closed_at, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: vendors; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.vendors (id, name, company_name, phone, email, address, category, status, created_at) FROM stdin;
\.


--
-- Data for Name: wallet_transactions; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.wallet_transactions (id, subscriber_id, reseller_id, type, amount, balance_after, reference_id, reference_type, description, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: wg_hub_config; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.wg_hub_config (id, enabled, interface_name, listen_port, endpoint_host, endpoint_port, hub_address, overlay_cidr, private_key, public_key, dns_servers, mtu, created_at, updated_at) FROM stdin;
1	t	wg0	51820	103.164.50.8	51820	10.77.0.1/16	10.77.0.0/16	qG0Yl4QQT2kHS3lPpdw7wn5KnIKhnfigT3vy/pferEg=	mfWH7QnumrVC/+BHNGTY4ieSZWJoDHZr1u2u9g3r5mQ=	\N	\N	2026-11-14 03:25:14.562322+00	2026-11-14 08:52:37.293948+00
\.


--
-- Data for Name: wg_peers; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.wg_peers (id, router_id, name, site_name, tunnel_ip, allowed_ips, public_key, private_key, preshared_key, keepalive_sec, status, provision_mode, last_handshake_at, rx_bytes, tx_bytes, remote_endpoint, last_error, notes, olt_mgmt_cidrs, created_at, updated_at) FROM stdin;
a12c0ea0-2926-445c-bbec-a2d3ad9cbfb4	d0a742a6-7b95-47a7-96a2-e0af96569ed1	RB1100AHX4	\N	10.77.0.2/32	{10.5.0.100/32,10.5.0.101/32}	NxNmLVOcqqACl7ECxp2XviC0IIjPkT2VGM46g2CuRF0=	WNV4GL7Izvy/hfoO1DdJQP7WUJJcktVN7LA1smZjk2c=	\N	25	PENDING	AUTO	\N	0	0	\N	\N	\N	{10.5.0.101/32,10.5.0.100/32}	2026-11-14 08:54:43.744172+00	2026-11-14 09:03:56.031023+00
\.


--
-- Data for Name: zones; Type: TABLE DATA; Schema: public; Owner: izandesk_user
--

COPY public.zones (id, area_id, name, created_at) FROM stdin;
47ea243f-5907-449f-8260-edf1603d739a	dc241b9e-d93d-4e6e-bb68-61e7c9218d61	Section 10	2026-11-14 03:27:41.515648+00
9739ef09-51f8-45db-842c-3a906d34e23b	dc241b9e-d93d-4e6e-bb68-61e7c9218d61	Section 11	2026-11-14 03:27:41.520842+00
ef1d82db-e311-4e39-bf4a-7f808466c61d	26f04aee-a366-41c2-ba51-a4052410658c	Road 27	2026-11-14 03:27:41.523586+00
\.


--
-- Data for Name: geocode_settings; Type: TABLE DATA; Schema: tiger; Owner: izandesk_user
--

COPY tiger.geocode_settings (name, setting, unit, category, short_desc) FROM stdin;
\.


--
-- Data for Name: pagc_gaz; Type: TABLE DATA; Schema: tiger; Owner: izandesk_user
--

COPY tiger.pagc_gaz (id, seq, word, stdword, token, is_custom) FROM stdin;
\.


--
-- Data for Name: pagc_lex; Type: TABLE DATA; Schema: tiger; Owner: izandesk_user
--

COPY tiger.pagc_lex (id, seq, word, stdword, token, is_custom) FROM stdin;
\.


--
-- Data for Name: pagc_rules; Type: TABLE DATA; Schema: tiger; Owner: izandesk_user
--

COPY tiger.pagc_rules (id, rule, is_custom) FROM stdin;
\.


--
-- Data for Name: topology; Type: TABLE DATA; Schema: topology; Owner: izandesk_user
--

COPY topology.topology (id, name, srid, "precision", hasz) FROM stdin;
\.


--
-- Data for Name: layer; Type: TABLE DATA; Schema: topology; Owner: izandesk_user
--

COPY topology.layer (topology_id, layer_id, schema_name, table_name, feature_column, feature_type, level, child_id) FROM stdin;
\.


--
-- Name: nas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: izandesk_user
--

SELECT pg_catalog.setval('public.nas_id_seq', 1, false);


--
-- Name: radacct_radacctid_seq; Type: SEQUENCE SET; Schema: public; Owner: izandesk_user
--

SELECT pg_catalog.setval('public.radacct_radacctid_seq', 1, false);


--
-- Name: radcheck_id_seq; Type: SEQUENCE SET; Schema: public; Owner: izandesk_user
--

SELECT pg_catalog.setval('public.radcheck_id_seq', 1, false);


--
-- Name: radgroupcheck_id_seq; Type: SEQUENCE SET; Schema: public; Owner: izandesk_user
--

SELECT pg_catalog.setval('public.radgroupcheck_id_seq', 1, false);


--
-- Name: radgroupreply_id_seq; Type: SEQUENCE SET; Schema: public; Owner: izandesk_user
--

SELECT pg_catalog.setval('public.radgroupreply_id_seq', 1, false);


--
-- Name: radpostauth_id_seq; Type: SEQUENCE SET; Schema: public; Owner: izandesk_user
--

SELECT pg_catalog.setval('public.radpostauth_id_seq', 1, false);


--
-- Name: radreply_id_seq; Type: SEQUENCE SET; Schema: public; Owner: izandesk_user
--

SELECT pg_catalog.setval('public.radreply_id_seq', 1, false);


--
-- Name: radusergroup_id_seq; Type: SEQUENCE SET; Schema: public; Owner: izandesk_user
--

SELECT pg_catalog.setval('public.radusergroup_id_seq', 1, false);


--
-- Name: subscriber_client_code_seq; Type: SEQUENCE SET; Schema: public; Owner: izandesk_user
--

SELECT pg_catalog.setval('public.subscriber_client_code_seq', 56, true);


--
-- Name: topology_id_seq; Type: SEQUENCE SET; Schema: topology; Owner: izandesk_user
--

SELECT pg_catalog.setval('topology.topology_id_seq', 1, false);


--
-- Name: areas areas_name_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.areas
    ADD CONSTRAINT areas_name_key UNIQUE (name);


--
-- Name: areas areas_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.areas
    ADD CONSTRAINT areas_pkey PRIMARY KEY (id);


--
-- Name: assets assets_asset_tag_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_asset_tag_key UNIQUE (asset_tag);


--
-- Name: assets assets_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: bandwidth_packages bandwidth_packages_name_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.bandwidth_packages
    ADD CONSTRAINT bandwidth_packages_name_key UNIQUE (name);


--
-- Name: bandwidth_packages bandwidth_packages_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.bandwidth_packages
    ADD CONSTRAINT bandwidth_packages_pkey PRIMARY KEY (id);


--
-- Name: billing_policies billing_policies_name_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.billing_policies
    ADD CONSTRAINT billing_policies_name_key UNIQUE (name);


--
-- Name: billing_policies billing_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.billing_policies
    ADD CONSTRAINT billing_policies_pkey PRIMARY KEY (id);


--
-- Name: billing_scheduler_locks billing_scheduler_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.billing_scheduler_locks
    ADD CONSTRAINT billing_scheduler_locks_pkey PRIMARY KEY (name);


--
-- Name: billing_suspension_logs billing_suspension_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.billing_suspension_logs
    ADD CONSTRAINT billing_suspension_logs_pkey PRIMARY KEY (id);


--
-- Name: coa_requests coa_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.coa_requests
    ADD CONSTRAINT coa_requests_pkey PRIMARY KEY (id);


--
-- Name: distribution_boxes distribution_boxes_code_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.distribution_boxes
    ADD CONSTRAINT distribution_boxes_code_key UNIQUE (code);


--
-- Name: distribution_boxes distribution_boxes_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.distribution_boxes
    ADD CONSTRAINT distribution_boxes_pkey PRIMARY KEY (id);


--
-- Name: fiber_routes fiber_routes_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.fiber_routes
    ADD CONSTRAINT fiber_routes_pkey PRIMARY KEY (id);


--
-- Name: field_activities field_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.field_activities
    ADD CONSTRAINT field_activities_pkey PRIMARY KEY (id);


--
-- Name: finance_accounts finance_accounts_code_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.finance_accounts
    ADD CONSTRAINT finance_accounts_code_key UNIQUE (code);


--
-- Name: finance_accounts finance_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.finance_accounts
    ADD CONSTRAINT finance_accounts_pkey PRIMARY KEY (id);


--
-- Name: finance_journal_entries finance_journal_entries_entry_no_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.finance_journal_entries
    ADD CONSTRAINT finance_journal_entries_entry_no_key UNIQUE (entry_no);


--
-- Name: finance_journal_entries finance_journal_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.finance_journal_entries
    ADD CONSTRAINT finance_journal_entries_pkey PRIMARY KEY (id);


--
-- Name: finance_journal_lines finance_journal_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.finance_journal_lines
    ADD CONSTRAINT finance_journal_lines_pkey PRIMARY KEY (id);


--
-- Name: finance_transactions finance_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.finance_transactions
    ADD CONSTRAINT finance_transactions_pkey PRIMARY KEY (id);


--
-- Name: finance_vouchers finance_vouchers_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.finance_vouchers
    ADD CONSTRAINT finance_vouchers_pkey PRIMARY KEY (id);


--
-- Name: finance_vouchers finance_vouchers_voucher_no_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.finance_vouchers
    ADD CONSTRAINT finance_vouchers_voucher_no_key UNIQUE (voucher_no);


--
-- Name: fup_enforcement_logs fup_enforcement_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.fup_enforcement_logs
    ADD CONSTRAINT fup_enforcement_logs_pkey PRIMARY KEY (id);


--
-- Name: hotspot_vouchers hotspot_vouchers_code_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.hotspot_vouchers
    ADD CONSTRAINT hotspot_vouchers_code_key UNIQUE (code);


--
-- Name: hotspot_vouchers hotspot_vouchers_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.hotspot_vouchers
    ADD CONSTRAINT hotspot_vouchers_pkey PRIMARY KEY (id);


--
-- Name: hr_attendance hr_attendance_employee_id_att_date_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.hr_attendance
    ADD CONSTRAINT hr_attendance_employee_id_att_date_key UNIQUE (employee_id, att_date);


--
-- Name: hr_attendance hr_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.hr_attendance
    ADD CONSTRAINT hr_attendance_pkey PRIMARY KEY (id);


--
-- Name: hr_employees hr_employees_employee_code_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.hr_employees
    ADD CONSTRAINT hr_employees_employee_code_key UNIQUE (employee_code);


--
-- Name: hr_employees hr_employees_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.hr_employees
    ADD CONSTRAINT hr_employees_pkey PRIMARY KEY (id);


--
-- Name: hr_leaves hr_leaves_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.hr_leaves
    ADD CONSTRAINT hr_leaves_pkey PRIMARY KEY (id);


--
-- Name: hr_payroll_items hr_payroll_items_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.hr_payroll_items
    ADD CONSTRAINT hr_payroll_items_pkey PRIMARY KEY (id);


--
-- Name: hr_payroll_runs hr_payroll_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.hr_payroll_runs
    ADD CONSTRAINT hr_payroll_runs_pkey PRIMARY KEY (id);


--
-- Name: installation_checklist_items installation_checklist_items_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.installation_checklist_items
    ADD CONSTRAINT installation_checklist_items_pkey PRIMARY KEY (id);


--
-- Name: installation_orders installation_orders_order_no_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.installation_orders
    ADD CONSTRAINT installation_orders_order_no_key UNIQUE (order_no);


--
-- Name: installation_orders installation_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.installation_orders
    ADD CONSTRAINT installation_orders_pkey PRIMARY KEY (id);


--
-- Name: inventory_items inventory_items_name_brand_model_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_name_brand_model_key UNIQUE (name, brand, model);


--
-- Name: inventory_items inventory_items_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_pkey PRIMARY KEY (id);


--
-- Name: inventory_serials inventory_serials_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.inventory_serials
    ADD CONSTRAINT inventory_serials_pkey PRIMARY KEY (id);


--
-- Name: inventory_serials inventory_serials_serial_number_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.inventory_serials
    ADD CONSTRAINT inventory_serials_serial_number_key UNIQUE (serial_number);


--
-- Name: inventory_warehouses inventory_warehouses_name_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.inventory_warehouses
    ADD CONSTRAINT inventory_warehouses_name_key UNIQUE (name);


--
-- Name: inventory_warehouses inventory_warehouses_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.inventory_warehouses
    ADD CONSTRAINT inventory_warehouses_pkey PRIMARY KEY (id);


--
-- Name: invoice_items invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: kyc_documents kyc_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.kyc_documents
    ADD CONSTRAINT kyc_documents_pkey PRIMARY KEY (id);


--
-- Name: lead_activities lead_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.lead_activities
    ADD CONSTRAINT lead_activities_pkey PRIMARY KEY (id);


--
-- Name: leads leads_lead_no_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_lead_no_key UNIQUE (lead_no);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: message_logs message_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.message_logs
    ADD CONSTRAINT message_logs_pkey PRIMARY KEY (id);


--
-- Name: message_templates message_templates_name_channel_type_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_name_channel_type_key UNIQUE (name, channel_type);


--
-- Name: message_templates message_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_pkey PRIMARY KEY (id);


--
-- Name: messaging_channels messaging_channels_channel_type_provider_name_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.messaging_channels
    ADD CONSTRAINT messaging_channels_channel_type_provider_name_key UNIQUE (channel_type, provider, name);


--
-- Name: messaging_channels messaging_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.messaging_channels
    ADD CONSTRAINT messaging_channels_pkey PRIMARY KEY (id);


--
-- Name: nas nas_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.nas
    ADD CONSTRAINT nas_pkey PRIMARY KEY (id);


--
-- Name: network_routers network_routers_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.network_routers
    ADD CONSTRAINT network_routers_pkey PRIMARY KEY (id);


--
-- Name: olts olts_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.olts
    ADD CONSTRAINT olts_pkey PRIMARY KEY (id);


--
-- Name: onus onus_olt_id_pon_port_serial_number_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.onus
    ADD CONSTRAINT onus_olt_id_pon_port_serial_number_key UNIQUE (olt_id, pon_port, serial_number);


--
-- Name: onus onus_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.onus
    ADD CONSTRAINT onus_pkey PRIMARY KEY (id);


--
-- Name: payment_gateway_configs payment_gateway_configs_gateway_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.payment_gateway_configs
    ADD CONSTRAINT payment_gateway_configs_gateway_key UNIQUE (gateway);


--
-- Name: payment_gateway_configs payment_gateway_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.payment_gateway_configs
    ADD CONSTRAINT payment_gateway_configs_pkey PRIMARY KEY (id);


--
-- Name: payment_sms_events payment_sms_events_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.payment_sms_events
    ADD CONSTRAINT payment_sms_events_pkey PRIMARY KEY (id);


--
-- Name: payment_webhook_events payment_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.payment_webhook_events
    ADD CONSTRAINT payment_webhook_events_pkey PRIMARY KEY (id);


--
-- Name: payments payments_payment_ref_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_payment_ref_key UNIQUE (payment_ref);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: purchase_items purchase_items_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_purchase_no_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_purchase_no_key UNIQUE (purchase_no);


--
-- Name: radacct radacct_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.radacct
    ADD CONSTRAINT radacct_pkey PRIMARY KEY (radacctid);


--
-- Name: radcheck radcheck_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.radcheck
    ADD CONSTRAINT radcheck_pkey PRIMARY KEY (id);


--
-- Name: radgroupcheck radgroupcheck_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.radgroupcheck
    ADD CONSTRAINT radgroupcheck_pkey PRIMARY KEY (id);


--
-- Name: radgroupreply radgroupreply_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.radgroupreply
    ADD CONSTRAINT radgroupreply_pkey PRIMARY KEY (id);


--
-- Name: radius_users radius_users_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.radius_users
    ADD CONSTRAINT radius_users_pkey PRIMARY KEY (id);


--
-- Name: radius_users radius_users_username_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.radius_users
    ADD CONSTRAINT radius_users_username_key UNIQUE (username);


--
-- Name: radpostauth radpostauth_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.radpostauth
    ADD CONSTRAINT radpostauth_pkey PRIMARY KEY (id);


--
-- Name: radreply radreply_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.radreply
    ADD CONSTRAINT radreply_pkey PRIMARY KEY (id);


--
-- Name: radusergroup radusergroup_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.radusergroup
    ADD CONSTRAINT radusergroup_pkey PRIMARY KEY (id);


--
-- Name: report_schedules report_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.report_schedules
    ADD CONSTRAINT report_schedules_pkey PRIMARY KEY (id);


--
-- Name: reseller_share_entries reseller_share_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.reseller_share_entries
    ADD CONSTRAINT reseller_share_entries_pkey PRIMARY KEY (id);


--
-- Name: reseller_wallet_transactions reseller_wallet_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.reseller_wallet_transactions
    ADD CONSTRAINT reseller_wallet_transactions_pkey PRIMARY KEY (id);


--
-- Name: resellers resellers_code_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.resellers
    ADD CONSTRAINT resellers_code_key UNIQUE (code);


--
-- Name: resellers resellers_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.resellers
    ADD CONSTRAINT resellers_pkey PRIMARY KEY (id);


--
-- Name: resellers resellers_subdomain_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.resellers
    ADD CONSTRAINT resellers_subdomain_key UNIQUE (subdomain);


--
-- Name: router_package_sync router_package_sync_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.router_package_sync
    ADD CONSTRAINT router_package_sync_pkey PRIMARY KEY (id);


--
-- Name: router_package_sync router_package_sync_router_id_package_id_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.router_package_sync
    ADD CONSTRAINT router_package_sync_router_id_package_id_key UNIQUE (router_id, package_id);


--
-- Name: saved_payment_methods saved_payment_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.saved_payment_methods
    ADD CONSTRAINT saved_payment_methods_pkey PRIMARY KEY (id);


--
-- Name: subscriber_communications subscriber_communications_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.subscriber_communications
    ADD CONSTRAINT subscriber_communications_pkey PRIMARY KEY (id);


--
-- Name: subscriber_equipment subscriber_equipment_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.subscriber_equipment
    ADD CONSTRAINT subscriber_equipment_pkey PRIMARY KEY (id);


--
-- Name: subscriber_sessions subscriber_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.subscriber_sessions
    ADD CONSTRAINT subscriber_sessions_pkey PRIMARY KEY (id);


--
-- Name: subscriber_sessions subscriber_sessions_username_router_id_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.subscriber_sessions
    ADD CONSTRAINT subscriber_sessions_username_router_id_key UNIQUE (username, router_id);


--
-- Name: subscribers subscribers_client_code_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.subscribers
    ADD CONSTRAINT subscribers_client_code_key UNIQUE (client_code);


--
-- Name: subscribers subscribers_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.subscribers
    ADD CONSTRAINT subscribers_pkey PRIMARY KEY (id);


--
-- Name: subscribers subscribers_username_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.subscribers
    ADD CONSTRAINT subscribers_username_key UNIQUE (username);


--
-- Name: ticket_comments ticket_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.ticket_comments
    ADD CONSTRAINT ticket_comments_pkey PRIMARY KEY (id);


--
-- Name: tickets tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_pkey PRIMARY KEY (id);


--
-- Name: tickets tickets_ticket_no_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_ticket_no_key UNIQUE (ticket_no);


--
-- Name: vendors vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pkey PRIMARY KEY (id);


--
-- Name: wallet_transactions wallet_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);


--
-- Name: wg_hub_config wg_hub_config_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.wg_hub_config
    ADD CONSTRAINT wg_hub_config_pkey PRIMARY KEY (id);


--
-- Name: wg_peers wg_peers_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.wg_peers
    ADD CONSTRAINT wg_peers_pkey PRIMARY KEY (id);


--
-- Name: zones zones_area_id_name_key; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.zones
    ADD CONSTRAINT zones_area_id_name_key UNIQUE (area_id, name);


--
-- Name: zones zones_pkey; Type: CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.zones
    ADD CONSTRAINT zones_pkey PRIMARY KEY (id);


--
-- Name: idx_assets_status; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_assets_status ON public.assets USING btree (status);


--
-- Name: idx_audit_logs_created; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_audit_logs_created ON public.audit_logs USING btree (created_at DESC);


--
-- Name: idx_audit_logs_entity; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_audit_logs_entity ON public.audit_logs USING btree (entity_type, entity_id);


--
-- Name: idx_boxes_location; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_boxes_location ON public.distribution_boxes USING gist (location);


--
-- Name: idx_fiber_routes_path; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_fiber_routes_path ON public.fiber_routes USING gist (path);


--
-- Name: idx_field_activities_status; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_field_activities_status ON public.field_activities USING btree (status);


--
-- Name: idx_fin_txn_account; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_fin_txn_account ON public.finance_transactions USING btree (account_id);


--
-- Name: idx_fin_txn_date; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_fin_txn_date ON public.finance_transactions USING btree (txn_date DESC);


--
-- Name: idx_fin_txn_type; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_fin_txn_type ON public.finance_transactions USING btree (txn_type);


--
-- Name: idx_fup_logs_sub; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_fup_logs_sub ON public.fup_enforcement_logs USING btree (subscriber_id, created_at DESC);


--
-- Name: idx_hr_att_date; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_hr_att_date ON public.hr_attendance USING btree (att_date);


--
-- Name: idx_hr_att_emp; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_hr_att_emp ON public.hr_attendance USING btree (employee_id);


--
-- Name: idx_hr_leaves_emp; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_hr_leaves_emp ON public.hr_leaves USING btree (employee_id, from_date DESC);


--
-- Name: idx_installation_checklist_order; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_installation_checklist_order ON public.installation_checklist_items USING btree (order_id, sort_order);


--
-- Name: idx_installation_orders_scheduled; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_installation_orders_scheduled ON public.installation_orders USING btree (scheduled_date);


--
-- Name: idx_installation_orders_status; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_installation_orders_status ON public.installation_orders USING btree (status);


--
-- Name: idx_installation_orders_subscriber; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_installation_orders_subscriber ON public.installation_orders USING btree (subscriber_id);


--
-- Name: idx_installation_orders_technician; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_installation_orders_technician ON public.installation_orders USING btree (assigned_technician_id);


--
-- Name: idx_inventory_serials_source; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_inventory_serials_source ON public.inventory_serials USING btree (source);


--
-- Name: idx_invoices_due_date; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_invoices_due_date ON public.invoices USING btree (due_date);


--
-- Name: idx_invoices_status; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_invoices_status ON public.invoices USING btree (status);


--
-- Name: idx_invoices_subscriber_id; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_invoices_subscriber_id ON public.invoices USING btree (subscriber_id);


--
-- Name: idx_journal_lines_account; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_journal_lines_account ON public.finance_journal_lines USING btree (account_id);


--
-- Name: idx_journal_lines_entry; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_journal_lines_entry ON public.finance_journal_lines USING btree (entry_id);


--
-- Name: idx_lead_activities_lead; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_lead_activities_lead ON public.lead_activities USING btree (lead_id, created_at DESC);


--
-- Name: idx_leads_area; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_leads_area ON public.leads USING btree (area_id);


--
-- Name: idx_leads_assigned; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_leads_assigned ON public.leads USING btree (assigned_to);


--
-- Name: idx_leads_created; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_leads_created ON public.leads USING btree (created_at DESC);


--
-- Name: idx_leads_status; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_leads_status ON public.leads USING btree (status);


--
-- Name: idx_message_logs_channel; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_message_logs_channel ON public.message_logs USING btree (channel_type, provider);


--
-- Name: idx_message_logs_status; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_message_logs_status ON public.message_logs USING btree (status);


--
-- Name: idx_nas_nasname; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE UNIQUE INDEX idx_nas_nasname ON public.nas USING btree (nasname);


--
-- Name: idx_olts_wg_peer_id; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_olts_wg_peer_id ON public.olts USING btree (wg_peer_id);


--
-- Name: idx_onus_inventory_serial; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_onus_inventory_serial ON public.onus USING btree (inventory_serial_id);


--
-- Name: idx_onus_olt; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_onus_olt ON public.onus USING btree (olt_id);


--
-- Name: idx_onus_status; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_onus_status ON public.onus USING btree (status);


--
-- Name: idx_payment_sms_trx; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_payment_sms_trx ON public.payment_sms_events USING btree (trx_id);


--
-- Name: idx_payments_payment_ref; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_payments_payment_ref ON public.payments USING btree (payment_ref);


--
-- Name: idx_payments_status; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_payments_status ON public.payments USING btree (status);


--
-- Name: idx_payments_subscriber_id; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_payments_subscriber_id ON public.payments USING btree (subscriber_id);


--
-- Name: idx_payments_trx_id; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_payments_trx_id ON public.payments USING btree (trx_id);


--
-- Name: idx_purchases_vendor; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_purchases_vendor ON public.purchases USING btree (vendor_id);


--
-- Name: idx_radacct_username; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_radacct_username ON public.radacct USING btree (username);


--
-- Name: idx_radcheck_username; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_radcheck_username ON public.radcheck USING btree (username);


--
-- Name: idx_radgroupcheck_groupname; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_radgroupcheck_groupname ON public.radgroupcheck USING btree (groupname);


--
-- Name: idx_radgroupreply_groupname; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_radgroupreply_groupname ON public.radgroupreply USING btree (groupname);


--
-- Name: idx_radreply_username; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_radreply_username ON public.radreply USING btree (username);


--
-- Name: idx_radusergroup_username; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_radusergroup_username ON public.radusergroup USING btree (username);


--
-- Name: idx_reseller_share_entries_reseller; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_reseller_share_entries_reseller ON public.reseller_share_entries USING btree (reseller_id, created_at DESC);


--
-- Name: idx_reseller_wallet_tx_reseller; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_reseller_wallet_tx_reseller ON public.reseller_wallet_transactions USING btree (reseller_id);


--
-- Name: idx_resellers_parent; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_resellers_parent ON public.resellers USING btree (parent_reseller_id);


--
-- Name: idx_resellers_subdomain; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_resellers_subdomain ON public.resellers USING btree (subdomain);


--
-- Name: idx_saved_pm_sub; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_saved_pm_sub ON public.saved_payment_methods USING btree (subscriber_id, created_at DESC);


--
-- Name: idx_sessions_username; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_sessions_username ON public.subscriber_sessions USING btree (username);


--
-- Name: idx_subscriber_comms_channel; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_subscriber_comms_channel ON public.subscriber_communications USING btree (channel);


--
-- Name: idx_subscriber_comms_sub; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_subscriber_comms_sub ON public.subscriber_communications USING btree (subscriber_id, created_at DESC);


--
-- Name: idx_subscriber_equipment_serial; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_subscriber_equipment_serial ON public.subscriber_equipment USING btree (serial_number);


--
-- Name: idx_subscriber_equipment_sub; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_subscriber_equipment_sub ON public.subscriber_equipment USING btree (subscriber_id);


--
-- Name: idx_subscribers_client_code; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_subscribers_client_code ON public.subscribers USING btree (client_code);


--
-- Name: idx_subscribers_location; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_subscribers_location ON public.subscribers USING gist (location);


--
-- Name: idx_subscribers_reseller; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_subscribers_reseller ON public.subscribers USING btree (reseller_id);


--
-- Name: idx_subscribers_router_id; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_subscribers_router_id ON public.subscribers USING btree (router_id);


--
-- Name: idx_subscribers_status; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_subscribers_status ON public.subscribers USING btree (status);


--
-- Name: idx_subscribers_zone; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_subscribers_zone ON public.subscribers USING btree (zone_id);


--
-- Name: idx_tickets_assigned; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_tickets_assigned ON public.tickets USING btree (assigned_technician_id);


--
-- Name: idx_tickets_reseller; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_tickets_reseller ON public.tickets USING btree (reseller_id);


--
-- Name: idx_tickets_status; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_tickets_status ON public.tickets USING btree (status);


--
-- Name: idx_tickets_subscriber; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_tickets_subscriber ON public.tickets USING btree (subscriber_id);


--
-- Name: idx_vouchers_code; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_vouchers_code ON public.hotspot_vouchers USING btree (code);


--
-- Name: idx_vouchers_status; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_vouchers_status ON public.hotspot_vouchers USING btree (status);


--
-- Name: idx_wallet_tx_subscriber_id; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_wallet_tx_subscriber_id ON public.wallet_transactions USING btree (subscriber_id);


--
-- Name: idx_wg_peers_router_id; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE INDEX idx_wg_peers_router_id ON public.wg_peers USING btree (router_id);


--
-- Name: idx_wg_peers_tunnel_ip; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE UNIQUE INDEX idx_wg_peers_tunnel_ip ON public.wg_peers USING btree (tunnel_ip);


--
-- Name: uq_payment_webhook_dedupe; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE UNIQUE INDEX uq_payment_webhook_dedupe ON public.payment_webhook_events USING btree (dedupe_key) WHERE (dedupe_key IS NOT NULL);


--
-- Name: uq_payment_webhook_gateway_event; Type: INDEX; Schema: public; Owner: izandesk_user
--

CREATE UNIQUE INDEX uq_payment_webhook_gateway_event ON public.payment_webhook_events USING btree (gateway, event_id) WHERE (event_id IS NOT NULL);


--
-- Name: assets assets_assigned_to_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_assigned_to_employee_id_fkey FOREIGN KEY (assigned_to_employee_id) REFERENCES public.hr_employees(id) ON DELETE SET NULL;


--
-- Name: assets assets_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.purchases(id) ON DELETE SET NULL;


--
-- Name: assets assets_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;


--
-- Name: billing_suspension_logs billing_suspension_logs_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.billing_suspension_logs
    ADD CONSTRAINT billing_suspension_logs_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;


--
-- Name: coa_requests coa_requests_router_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.coa_requests
    ADD CONSTRAINT coa_requests_router_id_fkey FOREIGN KEY (router_id) REFERENCES public.network_routers(id) ON DELETE SET NULL;


--
-- Name: coa_requests coa_requests_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.coa_requests
    ADD CONSTRAINT coa_requests_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;


--
-- Name: distribution_boxes distribution_boxes_zone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.distribution_boxes
    ADD CONSTRAINT distribution_boxes_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.zones(id) ON DELETE SET NULL;


--
-- Name: fiber_routes fiber_routes_from_box_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.fiber_routes
    ADD CONSTRAINT fiber_routes_from_box_id_fkey FOREIGN KEY (from_box_id) REFERENCES public.distribution_boxes(id) ON DELETE SET NULL;


--
-- Name: fiber_routes fiber_routes_to_box_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.fiber_routes
    ADD CONSTRAINT fiber_routes_to_box_id_fkey FOREIGN KEY (to_box_id) REFERENCES public.distribution_boxes(id) ON DELETE SET NULL;


--
-- Name: field_activities field_activities_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.field_activities
    ADD CONSTRAINT field_activities_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.hr_employees(id) ON DELETE SET NULL;


--
-- Name: field_activities field_activities_reseller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.field_activities
    ADD CONSTRAINT field_activities_reseller_id_fkey FOREIGN KEY (reseller_id) REFERENCES public.resellers(id) ON DELETE SET NULL;


--
-- Name: field_activities field_activities_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.field_activities
    ADD CONSTRAINT field_activities_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;


--
-- Name: field_activities field_activities_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.field_activities
    ADD CONSTRAINT field_activities_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE SET NULL;


--
-- Name: finance_accounts finance_accounts_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.finance_accounts
    ADD CONSTRAINT finance_accounts_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.finance_accounts(id) ON DELETE SET NULL;


--
-- Name: finance_journal_lines finance_journal_lines_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.finance_journal_lines
    ADD CONSTRAINT finance_journal_lines_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.finance_accounts(id) ON DELETE SET NULL;


--
-- Name: finance_journal_lines finance_journal_lines_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.finance_journal_lines
    ADD CONSTRAINT finance_journal_lines_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.finance_journal_entries(id) ON DELETE CASCADE;


--
-- Name: finance_transactions finance_transactions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.finance_transactions
    ADD CONSTRAINT finance_transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.finance_accounts(id) ON DELETE SET NULL;


--
-- Name: finance_transactions finance_transactions_counter_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.finance_transactions
    ADD CONSTRAINT finance_transactions_counter_account_id_fkey FOREIGN KEY (counter_account_id) REFERENCES public.finance_accounts(id) ON DELETE SET NULL;


--
-- Name: finance_transactions finance_transactions_reseller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.finance_transactions
    ADD CONSTRAINT finance_transactions_reseller_id_fkey FOREIGN KEY (reseller_id) REFERENCES public.resellers(id) ON DELETE SET NULL;


--
-- Name: finance_transactions finance_transactions_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.finance_transactions
    ADD CONSTRAINT finance_transactions_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;


--
-- Name: fup_enforcement_logs fup_enforcement_logs_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.fup_enforcement_logs
    ADD CONSTRAINT fup_enforcement_logs_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;


--
-- Name: hotspot_vouchers hotspot_vouchers_reseller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.hotspot_vouchers
    ADD CONSTRAINT hotspot_vouchers_reseller_id_fkey FOREIGN KEY (reseller_id) REFERENCES public.resellers(id) ON DELETE SET NULL;


--
-- Name: hotspot_vouchers hotspot_vouchers_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.hotspot_vouchers
    ADD CONSTRAINT hotspot_vouchers_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;


--
-- Name: hr_attendance hr_attendance_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.hr_attendance
    ADD CONSTRAINT hr_attendance_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.hr_employees(id) ON DELETE CASCADE;


--
-- Name: hr_leaves hr_leaves_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.hr_leaves
    ADD CONSTRAINT hr_leaves_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.hr_employees(id) ON DELETE CASCADE;


--
-- Name: hr_payroll_items hr_payroll_items_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.hr_payroll_items
    ADD CONSTRAINT hr_payroll_items_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.hr_employees(id) ON DELETE CASCADE;


--
-- Name: hr_payroll_items hr_payroll_items_payroll_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.hr_payroll_items
    ADD CONSTRAINT hr_payroll_items_payroll_run_id_fkey FOREIGN KEY (payroll_run_id) REFERENCES public.hr_payroll_runs(id) ON DELETE CASCADE;


--
-- Name: installation_checklist_items installation_checklist_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.installation_checklist_items
    ADD CONSTRAINT installation_checklist_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.installation_orders(id) ON DELETE CASCADE;


--
-- Name: installation_orders installation_orders_assigned_technician_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.installation_orders
    ADD CONSTRAINT installation_orders_assigned_technician_id_fkey FOREIGN KEY (assigned_technician_id) REFERENCES public.hr_employees(id) ON DELETE SET NULL;


--
-- Name: installation_orders installation_orders_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.installation_orders
    ADD CONSTRAINT installation_orders_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: installation_orders installation_orders_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.installation_orders
    ADD CONSTRAINT installation_orders_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;


--
-- Name: inventory_serials inventory_serials_assigned_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.inventory_serials
    ADD CONSTRAINT inventory_serials_assigned_subscriber_id_fkey FOREIGN KEY (assigned_subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;


--
-- Name: inventory_serials inventory_serials_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.inventory_serials
    ADD CONSTRAINT inventory_serials_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.inventory_items(id) ON DELETE CASCADE;


--
-- Name: inventory_serials inventory_serials_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.inventory_serials
    ADD CONSTRAINT inventory_serials_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.inventory_warehouses(id) ON DELETE SET NULL;


--
-- Name: invoice_items invoice_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;


--
-- Name: kyc_documents kyc_documents_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.kyc_documents
    ADD CONSTRAINT kyc_documents_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE CASCADE;


--
-- Name: lead_activities lead_activities_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.lead_activities
    ADD CONSTRAINT lead_activities_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: leads leads_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.areas(id) ON DELETE SET NULL;


--
-- Name: leads leads_converted_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_converted_subscriber_id_fkey FOREIGN KEY (converted_subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;


--
-- Name: leads leads_zone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.zones(id) ON DELETE SET NULL;


--
-- Name: message_logs message_logs_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.message_logs
    ADD CONSTRAINT message_logs_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.messaging_channels(id) ON DELETE SET NULL;


--
-- Name: onus onus_inventory_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.onus
    ADD CONSTRAINT onus_inventory_serial_id_fkey FOREIGN KEY (inventory_serial_id) REFERENCES public.inventory_serials(id) ON DELETE SET NULL;


--
-- Name: onus onus_olt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.onus
    ADD CONSTRAINT onus_olt_id_fkey FOREIGN KEY (olt_id) REFERENCES public.olts(id) ON DELETE CASCADE;


--
-- Name: onus onus_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.onus
    ADD CONSTRAINT onus_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;


--
-- Name: payments payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;


--
-- Name: payments payments_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;


--
-- Name: purchase_items purchase_items_inventory_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_items(id) ON DELETE SET NULL;


--
-- Name: purchase_items purchase_items_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.purchases(id) ON DELETE CASCADE;


--
-- Name: purchases purchases_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;


--
-- Name: purchases purchases_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.inventory_warehouses(id) ON DELETE SET NULL;


--
-- Name: radius_users radius_users_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.radius_users
    ADD CONSTRAINT radius_users_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE CASCADE;


--
-- Name: reseller_share_entries reseller_share_entries_reseller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.reseller_share_entries
    ADD CONSTRAINT reseller_share_entries_reseller_id_fkey FOREIGN KEY (reseller_id) REFERENCES public.resellers(id) ON DELETE CASCADE;


--
-- Name: reseller_share_entries reseller_share_entries_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.reseller_share_entries
    ADD CONSTRAINT reseller_share_entries_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;


--
-- Name: reseller_wallet_transactions reseller_wallet_transactions_reseller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.reseller_wallet_transactions
    ADD CONSTRAINT reseller_wallet_transactions_reseller_id_fkey FOREIGN KEY (reseller_id) REFERENCES public.resellers(id) ON DELETE CASCADE;


--
-- Name: reseller_wallet_transactions reseller_wallet_transactions_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.reseller_wallet_transactions
    ADD CONSTRAINT reseller_wallet_transactions_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;


--
-- Name: resellers resellers_parent_reseller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.resellers
    ADD CONSTRAINT resellers_parent_reseller_id_fkey FOREIGN KEY (parent_reseller_id) REFERENCES public.resellers(id) ON DELETE SET NULL;


--
-- Name: router_package_sync router_package_sync_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.router_package_sync
    ADD CONSTRAINT router_package_sync_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.bandwidth_packages(id) ON DELETE CASCADE;


--
-- Name: router_package_sync router_package_sync_router_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.router_package_sync
    ADD CONSTRAINT router_package_sync_router_id_fkey FOREIGN KEY (router_id) REFERENCES public.network_routers(id) ON DELETE CASCADE;


--
-- Name: saved_payment_methods saved_payment_methods_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.saved_payment_methods
    ADD CONSTRAINT saved_payment_methods_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE CASCADE;


--
-- Name: subscriber_communications subscriber_communications_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.subscriber_communications
    ADD CONSTRAINT subscriber_communications_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE CASCADE;


--
-- Name: subscriber_equipment subscriber_equipment_inventory_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.subscriber_equipment
    ADD CONSTRAINT subscriber_equipment_inventory_serial_id_fkey FOREIGN KEY (inventory_serial_id) REFERENCES public.inventory_serials(id) ON DELETE SET NULL;


--
-- Name: subscriber_equipment subscriber_equipment_onu_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.subscriber_equipment
    ADD CONSTRAINT subscriber_equipment_onu_id_fkey FOREIGN KEY (onu_id) REFERENCES public.onus(id) ON DELETE SET NULL;


--
-- Name: subscriber_equipment subscriber_equipment_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.subscriber_equipment
    ADD CONSTRAINT subscriber_equipment_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE CASCADE;


--
-- Name: subscriber_sessions subscriber_sessions_router_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.subscriber_sessions
    ADD CONSTRAINT subscriber_sessions_router_id_fkey FOREIGN KEY (router_id) REFERENCES public.network_routers(id) ON DELETE SET NULL;


--
-- Name: subscriber_sessions subscriber_sessions_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.subscriber_sessions
    ADD CONSTRAINT subscriber_sessions_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;


--
-- Name: subscribers subscribers_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.subscribers
    ADD CONSTRAINT subscribers_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.areas(id) ON DELETE SET NULL;


--
-- Name: subscribers subscribers_distribution_box_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.subscribers
    ADD CONSTRAINT subscribers_distribution_box_id_fkey FOREIGN KEY (distribution_box_id) REFERENCES public.distribution_boxes(id) ON DELETE SET NULL;


--
-- Name: subscribers subscribers_router_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.subscribers
    ADD CONSTRAINT subscribers_router_id_fkey FOREIGN KEY (router_id) REFERENCES public.network_routers(id) ON DELETE SET NULL;


--
-- Name: subscribers subscribers_zone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.subscribers
    ADD CONSTRAINT subscribers_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.zones(id) ON DELETE SET NULL;


--
-- Name: ticket_comments ticket_comments_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.ticket_comments
    ADD CONSTRAINT ticket_comments_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- Name: tickets tickets_reseller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_reseller_id_fkey FOREIGN KEY (reseller_id) REFERENCES public.resellers(id) ON DELETE SET NULL;


--
-- Name: tickets tickets_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;


--
-- Name: wallet_transactions wallet_transactions_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;


--
-- Name: wg_peers wg_peers_router_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.wg_peers
    ADD CONSTRAINT wg_peers_router_id_fkey FOREIGN KEY (router_id) REFERENCES public.network_routers(id) ON DELETE SET NULL;


--
-- Name: zones zones_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: izandesk_user
--

ALTER TABLE ONLY public.zones
    ADD CONSTRAINT zones_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.areas(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict RjcM0sXoheTJauez2ZcJOVB5S8clOHuw2pUqyc7E7UheqI4TIKYgS0WJtpfaYYA

