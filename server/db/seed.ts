// Deterministic synthetic dataset (PRD §9). All business dates are offsets from the demo date,
// so scenarios stay valid whenever the database is reset. Fictional suppliers, parts, and programs.
// Each PO belongs to exactly one work order; its items and deliveries inherit it.
import type { DB } from './db.js';
import { addDays } from '../../shared/dates.js';

export const SEED_VERSION = '2';

export const DEMO = {
  poNumber: 'PO-DEMO-01',
  partNumber: 'HX-2210',
  workOrder: 'WO-DEMO-A',
} as const;

const SUPPLIERS = [
  'Kestrel Precision Machining',
  'Bluewater Fasteners',
  'Ironridge Castings',
  'Cobalt Harness Works',
  'Northgate Composites',
  'Summit Seal & Gasket',
  'Redline Electronics Assembly',
  'Granite Bearing Co.',
  'Fieldstone Metal Finishing',
  'Ashford Cable Systems',
  'Pinecrest Plastics',
  'Tidewater Valve',
  'Halcyon Optics',
  'Ridgeback Sheet Metal',
  'Larkspur Thermal Products',
  'Meridian Springs',
  'Quarry Point Forge',
  'Silverleaf PCB',
  'Westbrook Hydraulics',
  'Copperline Connectors',
];

const WAREHOUSES = [
  { code: 'NAW', name: 'North Warehouse' },
  { code: 'SIW', name: 'South Warehouse' },
];

const PROGRAMS = ['Program Atlas', 'Program Borealis', 'Program Cinder', 'Program Dune', 'Program Ember'];
const BUYERS = ['A. Rivera', 'J. Chen', 'S. Okafor'];

const PARTS: [string, string][] = [
  ['BR-1042', 'Mounting bracket, machined aluminum'],
  ['BR-1077', 'Hinge bracket, stainless'],
  ['FS-0310', 'Captive fastener kit, M5'],
  ['FS-0322', 'Shoulder bolt set, titanium'],
  ['HX-2104', 'Wire harness, power distribution'],
  ['HX-2188', 'Wire harness, avionics bay'],
  ['CS-4410', 'Housing casting, gearbox'],
  ['CS-4425', 'End cap casting, motor'],
  ['CP-5120', 'Composite fairing, upper'],
  ['CP-5133', 'Composite panel, access door'],
  ['SL-0601', 'O-ring kit, fluorosilicone'],
  ['SL-0615', 'Environmental gasket, enclosure'],
  ['PC-7701', 'Controller PCB assembly'],
  ['PC-7745', 'Power regulator board'],
  ['BG-0911', 'Angular contact bearing pair'],
  ['BG-0930', 'Needle bearing, sealed'],
  ['MF-3302', 'Anodized cover plate'],
  ['CB-6604', 'Coax cable assembly, 1 m'],
  ['CB-6619', 'Shielded data cable, 2 m'],
  ['PL-2205', 'Molded cable clamp'],
  ['VL-8810', 'Check valve, hydraulic'],
  ['VL-8826', 'Pressure relief valve'],
  ['OP-9101', 'Sensor window, coated'],
  ['OP-9118', 'Lens assembly, wide field'],
  ['SM-1550', 'Sheet metal chassis'],
  ['SM-1562', 'Enclosure lid, formed'],
  ['TH-4301', 'Thermal pad set'],
  ['TH-4319', 'Heat sink, extruded'],
  ['SP-0207', 'Compression spring set'],
  ['FG-7302', 'Forged clevis'],
  ['HY-5501', 'Hydraulic fitting kit'],
  ['CN-8402', 'Circular connector, 19-pin'],
  ['CN-8417', 'Panel-mount connector, RF'],
];

/** Small deterministic PRNG (mulberry32) so every seed produces the same dataset. */
function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)];
  const shuffle = <T>(items: T[]) => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  };
  return { next, int, pick, shuffle };
}

type Rng = ReturnType<typeof createRng>;
type Category = 'healthy' | 'received' | 'late' | 'unknown' | 'overdue' | 'carrier';

interface WorkOrderSpec {
  number: string;
  program: string;
  warehouse: number;
  start: string;
}
interface DeliverySpec {
  qty: number;
  category: Category;
}
interface LineSpec {
  partNumber: string;
  description: string;
  qty: number;
  deliveries: DeliverySpec[];
}
interface PoSpec {
  number: string;
  supplier: number;
  workOrder: number;
  buyer: string;
  lines: LineSpec[];
  anchor?: Category | 'demo';
}

// Single-line POs that pin the PRD's required examples to known records.
const ANCHORS: Record<number, Category | 'demo'> = {
  5: 'demo',
  6: 'healthy', // timely arrival with a follow-up due
  7: 'late',
  8: 'unknown',
  9: 'overdue',
  10: 'carrier',
  11: 'received',
};

export function seedDatabase(db: DB, demoDate: string): void {
  const rng = createRng(20261026);
  const D = (days: number) => addDays(demoDate, days);
  const ts = (days: number, hour = 15) => `${D(days)}T${String(hour).padStart(2, '0')}:00:00.000Z`;

  // 20 work orders: 19 generated plus the primary-demo work order.
  const workOrders: WorkOrderSpec[] = [];
  for (let i = 0; i < 19; i++) {
    workOrders.push({ number: `WO-${30101 + i}`, program: rng.pick(PROGRAMS), warehouse: i % 2, start: D(rng.int(3, 45)) });
  }
  const demoWo = workOrders.push({ number: DEMO.workOrder, program: 'Program Atlas', warehouse: 0, start: D(7) }) - 1;

  // 25 POs: 5 with 10 lines, 10 with 1 line, 10 with 2 lines (80 lines).
  // Suppliers 0-4 have two POs and work orders 0-4 have two POs; the rest one each.
  const supplierSlots = rng.shuffle([...SUPPLIERS.keys(), 0, 1, 2, 3, 4]);
  const workOrderSlots = rng.shuffle([...Array(19).keys(), 0, 1, 2, 3, 4]);
  const pos: PoSpec[] = [];
  for (let i = 0; i < 25; i++) {
    const lineCount = i < 5 ? 10 : i < 15 ? 1 : 2;
    const anchor = ANCHORS[i];
    pos.push({
      number: anchor === 'demo' ? DEMO.poNumber : `PO-${24101 + i}`,
      supplier: supplierSlots[i],
      workOrder: anchor === 'demo' ? demoWo : workOrderSlots.pop()!,
      buyer: BUYERS[i % BUYERS.length],
      anchor,
      lines: Array.from({ length: lineCount }, () => {
        const [partNumber, description] = rng.pick(PARTS);
        return { partNumber, description, qty: rng.int(2, 40) * 2, deliveries: [] };
      }),
    });
  }

  // Primary demo line: 100 units for WO-DEMO-A, one planned delivery arriving D+5.
  const demoPo = pos.find((p) => p.anchor === 'demo')!;
  demoPo.lines[0] = {
    partNumber: DEMO.partNumber,
    description: 'Wire harness, sensor mast',
    qty: 100,
    deliveries: [{ qty: 100, category: 'healthy' }],
  };

  const randomCategory = (): Category => {
    const r = rng.next();
    if (r < 0.55) return 'healthy';
    if (r < 0.7) return 'received';
    if (r < 0.83) return 'late';
    if (r < 0.91) return 'unknown';
    return 'overdue';
  };
  for (const po of pos) {
    if (po.anchor === 'demo') continue;
    for (const line of po.lines) {
      if (po.anchor) {
        line.deliveries = [{ qty: line.qty, category: po.anchor }];
      } else if (line.qty >= 12 && rng.next() < 0.2) {
        // Two scheduled deliveries for the same work order: the first already moving or received.
        const firstQty = Math.round(line.qty * (0.3 + rng.next() * 0.3));
        line.deliveries = [
          { qty: firstQty, category: rng.next() < 0.5 ? 'received' : 'carrier' },
          { qty: line.qty - firstQty, category: randomCategory() },
        ];
      } else {
        line.deliveries = [{ qty: line.qty, category: randomCategory() }];
      }
    }
  }

  // ---- Insert ----
  const insertSupplier = db.prepare('INSERT INTO suppliers (name) VALUES (?)');
  const supplierIds = SUPPLIERS.map((name) => Number(insertSupplier.run(name).lastInsertRowid));
  const insertWarehouse = db.prepare('INSERT INTO warehouses (code, name) VALUES (?, ?)');
  const warehouseIds = WAREHOUSES.map((w) => Number(insertWarehouse.run(w.code, w.name).lastInsertRowid));
  const insertWo = db.prepare('INSERT INTO work_orders (number, program, warehouse_id, production_start) VALUES (?, ?, ?, ?)');
  const woIds = workOrders.map((wo) => Number(insertWo.run(wo.number, wo.program, warehouseIds[wo.warehouse], wo.start).lastInsertRowid));

  const insertPo = db.prepare(
    'INSERT INTO purchase_orders (number, supplier_id, warehouse_id, work_order_id, buyer, status) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertLine = db.prepare(
    'INSERT INTO po_lines (po_id, line_no, part_number, description, unit, ordered_qty) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertDelivery = db.prepare(
    `INSERT INTO deliveries (po_line_id, quantity, state, expected_arrival, received_date, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertFollowUp = db.prepare(
    `INSERT INTO follow_ups (po_id, delivery_id, due_date, note, state, completion_note, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertHistory = db.prepare(
    `INSERT INTO change_history (po_id, delivery_id, event_type, before_json, after_json, source, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const anchorRecords = new Map<Category | 'demo', { poId: number; deliveryId: number }>();
  const lateDeliveries: { poId: number; deliveryId: number }[] = [];

  for (const po of pos) {
    const wo = workOrders[po.workOrder];
    const categories = po.lines.flatMap((l) => l.deliveries.map((d) => d.category));
    const status = categories.every((c) => c === 'received')
      ? 'Received'
      : categories.some((c) => c === 'received')
        ? 'Partially received'
        : 'Open';
    const poId = Number(
      insertPo.run(po.number, supplierIds[po.supplier], warehouseIds[wo.warehouse], woIds[po.workOrder], po.buyer, status)
        .lastInsertRowid,
    );
    // The initial PO schedule was recorded when the PO was placed.
    const scheduledAt = ts(-rng.int(14, 40), rng.int(13, 22));
    po.lines.forEach((line, lineIndex) => {
      const lineId = Number(
        insertLine.run(poId, lineIndex + 1, line.partNumber, line.description, 'EA', line.qty).lastInsertRowid,
      );
      for (const delivery of line.deliveries) {
        const { state, arrival } =
          po.anchor === 'demo' ? { state: 'planned' as const, arrival: D(5) } : schedule(delivery.category, wo.start, demoDate, rng);
        const carrierUpdate = delivery.category === 'carrier' && po.anchor === 'carrier';
        const deliveryId = Number(
          insertDelivery.run(
            lineId,
            delivery.qty,
            state,
            arrival,
            state === 'received' ? arrival : null,
            carrierUpdate ? 'carrier_update' : 'po_schedule',
            carrierUpdate ? ts(-1, 9) : scheduledAt,
          ).lastInsertRowid,
        );
        if (po.anchor) anchorRecords.set(po.anchor, { poId, deliveryId });
        if (delivery.category === 'late' && !po.anchor) lateDeliveries.push({ poId, deliveryId });
        if (carrierUpdate) {
          insertHistory.run(
            poId,
            deliveryId,
            'arrival_updated',
            JSON.stringify({ expectedArrival: addDays(arrival!, -1), source: 'po_schedule' }),
            JSON.stringify({ expectedArrival: arrival, source: 'carrier_update' }),
            'carrier_update',
            'Carrier tracking shows a hold at the regional hub; ETA moved one day.',
            ts(-1, 9),
          );
        }
      }
    });
  }

  // Follow-ups: a mix of due, upcoming, PO-level, and completed tasks.
  const timely = anchorRecords.get('healthy')!;
  insertFollowUp.run(timely.poId, timely.deliveryId, D(-1), 'Confirm material certs will ship with the delivery.', 'open', null, null, ts(-6), ts(-6));
  const late = anchorRecords.get('late')!;
  insertFollowUp.run(late.poId, late.deliveryId, D(2), 'Ask supplier for a recovery date or partial shipment option.', 'open', null, null, ts(-3), ts(-3));
  const unknown = anchorRecords.get('unknown')!;
  insertFollowUp.run(unknown.poId, unknown.deliveryId, D(0), 'Request a committed ship date from supplier.', 'open', null, null, ts(-4), ts(-4));
  const overdue = anchorRecords.get('overdue')!;
  insertFollowUp.run(overdue.poId, overdue.deliveryId, D(-3), 'Check whether the delivery shipped.', 'completed', 'Supplier says it shipped; tracking number not yet provided.', ts(-2, 17), ts(-5), ts(-2, 17));
  insertFollowUp.run(overdue.poId, overdue.deliveryId, D(1), 'Get tracking number and revised arrival.', 'open', null, null, ts(-2, 17), ts(-2, 17));
  for (const [i, record] of lateDeliveries.slice(0, 3).entries()) {
    insertFollowUp.run(record.poId, record.deliveryId, D(i - 1), 'Confirm revised date with supplier.', 'open', null, null, ts(-5), ts(-5));
  }
  const twoLinePo = db.prepare('SELECT id FROM purchase_orders WHERE number = ?').get(pos[16].number) as { id: number };
  insertFollowUp.run(twoLinePo.id, null, D(4), 'Confirm remaining schedule for both lines.', 'open', null, null, ts(-1), ts(-1));

  const setMeta = db.prepare('INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)');
  setMeta.run('demo_date', demoDate);
  setMeta.run('seed_version', SEED_VERSION);
  setMeta.run('seeded_at', new Date().toISOString());

  assertIntegrity(db);
}

function schedule(
  category: Category,
  productionStart: string,
  demoDate: string,
  rng: Rng,
): { state: 'planned' | 'in_transit' | 'received'; arrival: string | null } {
  const D = (days: number) => addDays(demoDate, days);
  const beforeStart = (maxLead: number) => {
    const candidate = addDays(productionStart, -rng.int(1, maxLead));
    return candidate < D(1) ? D(1) : candidate;
  };
  switch (category) {
    case 'healthy': {
      const arrival = beforeStart(10);
      return { state: arrival <= D(6) && rng.next() < 0.5 ? 'in_transit' : 'planned', arrival };
    }
    case 'carrier': {
      const arrival = beforeStart(4);
      return { state: 'in_transit', arrival: arrival > D(4) ? D(4) : arrival };
    }
    case 'received':
      return { state: 'received', arrival: D(-rng.int(2, 25)) };
    case 'late':
      return { state: rng.next() < 0.2 ? 'in_transit' : 'planned', arrival: addDays(productionStart, rng.int(2, 12)) };
    case 'unknown':
      return { state: 'planned', arrival: null };
    case 'overdue':
      return { state: rng.next() < 0.5 ? 'in_transit' : 'planned', arrival: D(-rng.int(1, 5)) };
  }
}

/** Throws if the dataset breaks a quantity or relationship rule. Used after seeding and in tests. */
export function assertIntegrity(db: DB): void {
  const fail = (message: string, rows: unknown[]) => {
    if (rows.length) throw new Error(`Seed integrity: ${message}: ${JSON.stringify(rows.slice(0, 3))}`);
  };
  fail(
    'PO line ordered quantity differs from active deliveries',
    db
      .prepare(
        `SELECT l.id, l.ordered_qty, COALESCE(SUM(d.quantity), 0) AS scheduled
         FROM po_lines l LEFT JOIN deliveries d ON d.po_line_id = l.id AND d.superseded_at IS NULL
         GROUP BY l.id HAVING scheduled <> l.ordered_qty`,
      )
      .all(),
  );
  fail(
    'work order warehouse differs from PO destination',
    db
      .prepare(
        `SELECT p.id FROM purchase_orders p JOIN work_orders w ON w.id = p.work_order_id
         WHERE w.warehouse_id <> p.warehouse_id`,
      )
      .all(),
  );
  fail(
    'work order without a PO',
    db.prepare('SELECT w.id FROM work_orders w WHERE NOT EXISTS (SELECT 1 FROM purchase_orders p WHERE p.work_order_id = w.id)').all(),
  );
  fail(
    'supplier without PO',
    db.prepare('SELECT s.id FROM suppliers s WHERE NOT EXISTS (SELECT 1 FROM purchase_orders p WHERE p.supplier_id = s.id)').all(),
  );
}
