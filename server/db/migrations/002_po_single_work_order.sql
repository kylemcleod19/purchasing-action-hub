-- v2 relationship (PRD §3, ARCHITECTURE §4/§12): each purchase order belongs to exactly one work
-- order, and items and deliveries inherit it. The v1 allocation tables (work_order_links,
-- delivery_links) cannot be mapped to one work order without arbitrary choices. This migration is a
-- one-time synthetic-data reset: it drops all demo data, recreates the schema, and clears the seed
-- marker so startup seeds the v2 baseline. It runs once per database, like any migration.

DROP TABLE IF EXISTS change_history;
DROP TABLE IF EXISTS follow_ups;
DROP TABLE IF EXISTS delivery_links;
DROP TABLE IF EXISTS deliveries;
DROP TABLE IF EXISTS work_order_links;
DROP TABLE IF EXISTS po_lines;
DROP TABLE IF EXISTS purchase_orders;
DROP TABLE IF EXISTS work_orders;
DROP TABLE IF EXISTS warehouses;
DROP TABLE IF EXISTS suppliers;
DELETE FROM app_metadata;

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
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
  buyer TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX purchase_orders_work_order ON purchase_orders(work_order_id);

CREATE TRIGGER purchase_orders_warehouse_matches_work_order
BEFORE INSERT ON purchase_orders
WHEN (SELECT warehouse_id FROM work_orders WHERE id = NEW.work_order_id) IS NOT NEW.warehouse_id
BEGIN
  SELECT RAISE(ABORT, 'PO destination must match its work order warehouse');
END;

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

CREATE TABLE deliveries (
  id INTEGER PRIMARY KEY,
  po_line_id INTEGER NOT NULL REFERENCES po_lines(id),
  parent_delivery_id INTEGER REFERENCES deliveries(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  state TEXT NOT NULL CHECK (state IN ('planned', 'in_transit', 'received')),
  expected_arrival TEXT,
  received_date TEXT,
  -- Provenance and time of the latest arrival-information update ("Last update").
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  superseded_at TEXT
);
CREATE INDEX deliveries_po_line ON deliveries(po_line_id);

CREATE TABLE follow_ups (
  id INTEGER PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  delivery_id INTEGER REFERENCES deliveries(id),
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
