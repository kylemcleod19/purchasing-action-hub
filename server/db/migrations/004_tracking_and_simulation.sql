-- v4 (PRD §13/§14, ARCHITECTURE §14/§15): PO creation dates, substantive supplier confirmations,
-- shipments with tracking, and the deterministic supplier-outreach and carrier-event simulation.
-- Additive only: existing deliveries, edits, issues, and history are preserved. Legacy POs keep a NULL
-- created_date and are excluded from automatic outreach. Scenario fixtures are installed only by an
-- explicit demo reset (the banner shows a reset-required notice until then).

ALTER TABLE purchase_orders ADD COLUMN created_date TEXT;
ALTER TABLE deliveries ADD COLUMN last_supplier_confirmation_at TEXT;

-- Automated changes are attributed to simulated automation, with a link to the message/result or
-- carrier event that caused them, rather than to the PO buyer.
ALTER TABLE change_history ADD COLUMN actor_type TEXT;
ALTER TABLE change_history ADD COLUMN source_ref TEXT;

CREATE TABLE shipments (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  carrier TEXT,
  tracking_number TEXT,
  tracking_usable INTEGER NOT NULL DEFAULT 0 CHECK (tracking_usable IN (0, 1)),
  carrier_status TEXT NOT NULL CHECK (carrier_status IN ('in_transit', 'delayed', 'delivered')),
  expected_arrival TEXT,
  dispatched_at TEXT,
  carrier_delivered_at TEXT,
  latest_event_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX shipments_tracking ON shipments(carrier, tracking_number) WHERE tracking_number IS NOT NULL;

-- Each linked delivery row is its entire shipped quantity; a delivery belongs to at most one shipment.
CREATE TABLE shipment_deliveries (
  shipment_id INTEGER NOT NULL REFERENCES shipments(id),
  delivery_id INTEGER NOT NULL UNIQUE REFERENCES deliveries(id)
);
CREATE INDEX shipment_deliveries_shipment ON shipment_deliveries(shipment_id);

CREATE TABLE outreach_requests (
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  -- Local (America/Chicago) send date; one request per supplier per demo date.
  local_date TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  response_due_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
  demo_run_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (supplier_id, local_date)
);

CREATE TABLE outreach_items (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES outreach_requests(id),
  delivery_id INTEGER NOT NULL REFERENCES deliveries(id),
  po_line_id INTEGER NOT NULL REFERENCES po_lines(id),
  requested_qty INTEGER NOT NULL,
  expected_arrival_snapshot TEXT,
  -- Delivery version the next reply must match; refreshed when automation applies a result.
  delivery_version_snapshot INTEGER NOT NULL,
  response_state TEXT NOT NULL CHECK (response_state IN ('awaiting', 'answered', 'needs_review')),
  answered_at TEXT,
  UNIQUE (request_id, delivery_id)
);
CREATE INDEX outreach_items_delivery ON outreach_items(delivery_id);

CREATE TABLE supplier_messages (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES outreach_requests(id),
  external_message_id TEXT NOT NULL UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  recipient TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_or_received_at TEXT NOT NULL,
  processing_state TEXT NOT NULL,
  fixture_key TEXT
);

CREATE TABLE message_results (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES supplier_messages(id),
  outreach_item_id INTEGER REFERENCES outreach_items(id),
  classification TEXT NOT NULL
    CHECK (classification IN ('confirmed_arrival', 'revised_arrival', 'ambiguous', 'unmatched', 'proposed_split', 'missing')),
  date_type TEXT NOT NULL CHECK (date_type IN ('arrival', 'ship', 'unknown')),
  proposed_date TEXT,
  proposed_qty INTEGER,
  evidence_text TEXT,
  expected_delivery_version INTEGER,
  applied_at TEXT,
  review_reason TEXT
);

CREATE TABLE call_tasks (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL UNIQUE REFERENCES outreach_requests(id),
  buyer TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'in_progress', 'completed', 'answered')),
  created_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  completed_at TEXT,
  completion_note TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE call_task_items (
  task_id INTEGER NOT NULL REFERENCES call_tasks(id),
  outreach_item_id INTEGER NOT NULL UNIQUE REFERENCES outreach_items(id),
  response_state TEXT NOT NULL CHECK (response_state IN ('awaiting', 'answered', 'needs_review'))
);

CREATE TABLE carrier_events (
  id INTEGER PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id),
  external_event_id TEXT NOT NULL UNIQUE,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  applied_state TEXT NOT NULL CHECK (applied_state IN ('applied', 'partially_applied', 'ignored', 'held_for_review')),
  ignored_reason TEXT
);
CREATE INDEX carrier_events_shipment ON carrier_events(shipment_id);
