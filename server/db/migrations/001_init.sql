-- Initial schema. Business dates are YYYY-MM-DD text; timestamps are ISO-8601 UTC text.

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE warehouses (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE work_orders (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  program TEXT NOT NULL,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  production_start TEXT NOT NULL
);

CREATE TABLE purchase_orders (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  buyer TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE po_lines (
  id INTEGER PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  line_no INTEGER NOT NULL,
  part_number TEXT NOT NULL,
  description TEXT NOT NULL,
  unit TEXT NOT NULL,
  ordered_qty INTEGER NOT NULL CHECK (ordered_qty > 0),
  UNIQUE (po_id, line_no)
);

-- Upstream commitments of PO line quantity to work orders. Seeded only; no editing API.
CREATE TABLE work_order_links (
  id INTEGER PRIMARY KEY,
  po_line_id INTEGER NOT NULL REFERENCES po_lines(id),
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  UNIQUE (po_line_id, work_order_id)
);

CREATE TABLE deliveries (
  id INTEGER PRIMARY KEY,
  po_line_id INTEGER NOT NULL REFERENCES po_lines(id),
  parent_delivery_id INTEGER REFERENCES deliveries(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  state TEXT NOT NULL CHECK (state IN ('planned', 'in_transit', 'received')),
  expected_arrival TEXT,
  received_date TEXT,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  superseded_at TEXT
);
CREATE INDEX deliveries_po_line ON deliveries(po_line_id);

-- Distribution of fixed work-order link quantities across dated deliveries.
CREATE TABLE delivery_links (
  delivery_id INTEGER NOT NULL REFERENCES deliveries(id),
  work_order_link_id INTEGER NOT NULL REFERENCES work_order_links(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (delivery_id, work_order_link_id)
);

CREATE TRIGGER delivery_links_same_po_line
BEFORE INSERT ON delivery_links
WHEN (SELECT po_line_id FROM deliveries WHERE id = NEW.delivery_id)
  IS NOT (SELECT po_line_id FROM work_order_links WHERE id = NEW.work_order_link_id)
BEGIN
  SELECT RAISE(ABORT, 'delivery link must reference the same PO line');
END;

CREATE TABLE follow_ups (
  id INTEGER PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  delivery_id INTEGER REFERENCES deliveries(id),
  -- Set when a split moves a delivery-level follow-up to the PO level.
  original_delivery_id INTEGER REFERENCES deliveries(id),
  due_date TEXT NOT NULL,
  note TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'completed')),
  completion_note TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX follow_ups_po ON follow_ups(po_id);

CREATE TABLE change_history (
  id INTEGER PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  delivery_id INTEGER REFERENCES deliveries(id),
  event_type TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  source TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX change_history_po ON change_history(po_id);

CREATE TABLE app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
