-- v3 (PRD §5/§7, ARCHITECTURE §4/§13): required dock dates, receipt dates, separate arrival-update
-- timestamps, buyer-action history, and delivery issues. Existing data and edits are preserved.

-- Required dock date per PO item. SQLite cannot add a NOT NULL column without a default, so the
-- column defaults to '' and is backfilled here. One-time fallback for legacy synthetic rows that have
-- no dock baseline: use the work order's production start (documented in README). New seeds set it
-- explicitly, and seed integrity checks reject blanks.
ALTER TABLE po_lines ADD COLUMN required_dock_date TEXT NOT NULL DEFAULT '';
UPDATE po_lines SET required_dock_date = (
  SELECT wo.production_start FROM purchase_orders p JOIN work_orders wo ON wo.id = p.work_order_id
  WHERE p.id = po_lines.po_id
);

-- v2's updated_at was only ever written by arrival updates and splits (follow-ups never touched it),
-- so it carries over as the arrival-information timestamp. received_date was seeded explicitly.
ALTER TABLE deliveries RENAME COLUMN updated_at TO arrival_updated_at;
ALTER TABLE deliveries RENAME COLUMN received_date TO received_at;

ALTER TABLE change_history ADD COLUMN actor TEXT;

CREATE TABLE delivery_issues (
  id INTEGER PRIMARY KEY,
  delivery_id INTEGER NOT NULL REFERENCES deliveries(id),
  state TEXT NOT NULL CHECK (state IN ('open', 'resolved', 'superseded')),
  reasons_json TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  outcome TEXT CHECK (outcome IN ('accepted_delay', 'date_restored', 'split_agreed', 'reviewed')),
  note TEXT,
  reviewed_facts_json TEXT,
  -- Earlier issue on the same delivery that this one reopens.
  previous_issue_id INTEGER REFERENCES delivery_issues(id),
  -- Issue on a split parent that this child issue continues.
  parent_issue_id INTEGER REFERENCES delivery_issues(id),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX delivery_issues_delivery ON delivery_issues(delivery_id);
CREATE UNIQUE INDEX delivery_issues_one_open ON delivery_issues(delivery_id) WHERE state = 'open';
