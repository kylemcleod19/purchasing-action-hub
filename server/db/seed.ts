// Deterministic synthetic dataset (PRD §9). All business dates are offsets from the demo date, so
// scenarios stay valid whenever the database is reset. Fictional suppliers, parts, and programs.
// Each PO belongs to exactly one work order; items and deliveries inherit it. Seeded history, issues,
// and resolutions are recorded through the same mutation services the app uses, with backdated
// timestamps, so they follow the real issue rules.
import type { DB } from './db.js';
import { addDays } from '../../shared/dates.js';
import { resolveIssue, splitDelivery, updateArrival } from '../services/deliveries.js';
import { getOpenIssue, reconcileIssues } from '../services/issues.js';
import type { UpdateSource } from '../../shared/types.js';

export const SEED_VERSION = '3';

export const DEMO = {
  poNumber: 'PO-DEMO-01',
  partNumber: 'HX-2210',
  workOrder: 'WO-DEMO-A',
} as const;

type Part = [partNumber: string, description: string];

/** Each supplier sells parts from one coherent specialty. Suppliers 0-4 hold the ten-line POs. */
const SUPPLIERS: { name: string; parts: Part[] }[] = [
  {
    name: 'Granite Bearing Co.',
    parts: [
      ['BG-0911', 'Angular contact bearing pair'],
      ['BG-0930', 'Needle bearing, sealed'],
      ['BG-0945', 'Deep groove ball bearing, 6204'],
      ['BG-0952', 'Thin-section bearing, 80 mm'],
      ['BG-0967', 'Tapered roller bearing set'],
      ['BG-0971', 'Flanged sleeve bearing, bronze'],
      ['BG-0984', 'Linear bearing block'],
      ['BG-0990', 'Thrust bearing, needle'],
      ['BG-1003', 'Spherical plain bearing'],
      ['BG-1018', 'Cam follower, stud type'],
    ],
  },
  {
    name: 'Bluewater Fasteners',
    parts: [
      ['FS-0310', 'Captive fastener kit, M5'],
      ['FS-0322', 'Shoulder bolt set, titanium'],
      ['FS-0335', 'Socket head cap screw, M4 x 12'],
      ['FS-0341', 'Self-clinching nut, M3'],
      ['FS-0356', 'Rivet nut, aluminum, M4'],
      ['FS-0362', 'Quarter-turn fastener'],
      ['FS-0377', 'Helical insert kit, M5'],
      ['FS-0383', 'Hex standoff, M3 x 20'],
      ['FS-0398', 'Safety wire, 0.032 in'],
      ['FS-0404', 'Wave washer set'],
    ],
  },
  {
    name: 'Cobalt Harness Works',
    parts: [
      ['HX-2104', 'Wire harness, power distribution'],
      ['HX-2188', 'Wire harness, avionics bay'],
      ['HX-2233', 'Battery interconnect harness'],
      ['HX-2247', 'Motor phase harness'],
      ['HX-2259', 'Lighting harness'],
      ['HX-2266', 'Payload interface harness'],
      ['HX-2271', 'Ground strap assembly'],
      ['HX-2285', 'Servo harness'],
      ['HX-2290', 'Diagnostic port harness'],
      ['HX-2302', 'Antenna feed harness'],
    ],
  },
  {
    name: 'Pinecrest Plastics',
    parts: [
      ['PL-2205', 'Molded cable clamp'],
      ['PL-2212', 'Machined acetal bushing'],
      ['PL-2219', 'Molded connector boot'],
      ['PL-2224', 'Machined PEEK spacer'],
      ['PL-2231', 'Molded grommet strip'],
      ['PL-2238', 'Machined acetal guide rail'],
      ['PL-2244', 'Molded battery tray'],
      ['PL-2250', 'Machined polycarbonate window'],
      ['PL-2257', 'Molded nylon tie mount'],
      ['PL-2263', 'Molded vent cap'],
    ],
  },
  {
    name: 'Kestrel Precision Machining',
    parts: [
      ['MC-1042', 'Mounting bracket, machined aluminum'],
      ['MC-1077', 'Hinge bracket, stainless'],
      ['MC-1105', 'Gimbal yoke, 7075 aluminum'],
      ['MC-1118', 'Drive shaft, stainless'],
      ['MC-1126', 'Sensor mount plate'],
      ['MC-1133', 'Bearing housing, machined'],
      ['MC-1147', 'Actuator clevis, machined'],
      ['MC-1152', 'Motor adapter flange'],
      ['MC-1169', 'Pivot pin, hardened'],
      ['MC-1174', 'Spacer ring, titanium'],
    ],
  },
  { name: 'Ironridge Castings', parts: [['CS-4410', 'Gearbox housing casting'], ['CS-4425', 'Motor end cap casting'], ['CS-4437', 'Pump body casting']] },
  { name: 'Northgate Composites', parts: [['CP-5120', 'Composite fairing, upper'], ['CP-5133', 'Composite access panel'], ['CP-5141', 'Carbon fiber tube, 40 mm']] },
  { name: 'Summit Seal & Gasket', parts: [['SL-0601', 'O-ring kit, fluorosilicone'], ['SL-0615', 'Enclosure gasket'], ['SL-0622', 'Shaft lip seal']] },
  { name: 'Redline Electronics Assembly', parts: [['PC-7701', 'Controller PCB assembly'], ['PC-7745', 'Power regulator board assembly'], ['PC-7758', 'Sensor interface board assembly']] },
  { name: 'Fieldstone Metal Finishing', parts: [['MF-3302', 'Anodized cover plate'], ['MF-3315', 'Passivated fitting set'], ['MF-3321', 'Powder-coated access panel']] },
  { name: 'Ashford Cable Systems', parts: [['CB-6604', 'Coax cable assembly, 1 m'], ['CB-6619', 'Shielded data cable, 2 m'], ['CB-6627', 'Fiber patch cable, 3 m']] },
  { name: 'Tidewater Valve', parts: [['VL-8810', 'Hydraulic check valve'], ['VL-8826', 'Pressure relief valve'], ['VL-8833', 'Solenoid valve, 24 V']] },
  { name: 'Halcyon Optics', parts: [['OP-9101', 'Coated sensor window'], ['OP-9118', 'Wide-field lens assembly'], ['OP-9124', 'Infrared filter']] },
  { name: 'Ridgeback Sheet Metal', parts: [['SM-1550', 'Sheet metal chassis'], ['SM-1562', 'Formed enclosure lid'], ['SM-1571', 'Formed mounting rail']] },
  { name: 'Larkspur Thermal Products', parts: [['TH-4301', 'Thermal pad set'], ['TH-4319', 'Extruded heat sink'], ['TH-4325', 'Heater mat, 28 V']] },
  { name: 'Meridian Springs', parts: [['SP-0207', 'Compression spring set'], ['SP-0214', 'Torsion spring'], ['SP-0228', 'Constant-force spring']] },
  { name: 'Quarry Point Forge', parts: [['FG-7302', 'Forged clevis'], ['FG-7315', 'Forged lifting lug'], ['FG-7321', 'Forged eye bolt']] },
  { name: 'Silverleaf PCB', parts: [['PB-6101', 'Bare PCB, 6-layer controller'], ['PB-6114', 'Bare PCB, power stage'], ['PB-6127', 'Flex circuit, sensor']] },
  { name: 'Westbrook Hydraulics', parts: [['HY-5501', 'Hydraulic fitting kit'], ['HY-5514', 'Hydraulic hose assembly'], ['HY-5520', 'Hydraulic accumulator, 0.5 L']] },
  { name: 'Copperline Connectors', parts: [['CN-8402', 'Circular connector, 19-pin'], ['CN-8417', 'Panel-mount RF connector'], ['CN-8425', 'Rectangular connector, 50-pin']] },
];

const WAREHOUSES = [
  { code: 'NAW', name: 'North Warehouse' },
  { code: 'SIW', name: 'South Warehouse' },
];

const PROGRAMS = ['Program Atlas', 'Program Borealis', 'Program Cinder', 'Program Dune', 'Program Ember'];
const BUYERS = ['A. Rivera', 'J. Chen', 'S. Okafor'];

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

/**
 * Delivery scenarios. `late` arrives after the required dock date but by production start;
 * `conflict` arrives after production start. `transit` is an on-time in-transit delivery.
 */
type Category = 'healthy' | 'transit' | 'received' | 'late' | 'conflict' | 'unknown' | 'overdue' | 'carrier' | 'restored' | 'split' | 'accepted';

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
  part: Part;
  qty: number;
  dock: string;
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
  6: 'healthy', // timely arrival with a reminder due
  7: 'late', // after required dock, before production start
  8: 'unknown',
  9: 'overdue',
  10: 'carrier',
  11: 'received',
  12: 'restored', // date-restored resolution
  13: 'split', // split agreed with one late child
  14: 'accepted', // accepted late delivery, ready to reopen with a worse date
};

export function seedDatabase(db: DB, demoDate: string): void {
  const rng = createRng(20261026);
  const D = (days: number) => addDays(demoDate, days);
  const ts = (days: number, hour = 15) => `${D(days)}T${String(hour).padStart(2, '0')}:00:00.000Z`;

  // 20 work orders: 19 generated plus the primary-demo work order.
  const workOrders: WorkOrderSpec[] = [];
  for (let i = 0; i < 19; i++) {
    workOrders.push({ number: `WO-${30101 + i}`, program: rng.pick(PROGRAMS), warehouse: i % 2, start: D(rng.int(4, 45)) });
  }
  const demoWo = workOrders.push({ number: DEMO.workOrder, program: 'Program Atlas', warehouse: 0, start: D(7) }) - 1;

  // 25 POs: 5 with 10 lines (suppliers 0-4, full catalogs), 10 with 1 line, 10 with 2 lines.
  // Suppliers 0-4 each also have one small PO; work orders 0-4 each have two POs.
  const smallPoSuppliers = rng.shuffle([0, 1, 3, 4, ...Array.from({ length: 15 }, (_, i) => i + 5)]);
  const workOrderSlots = rng.shuffle([...Array(19).keys(), 0, 1, 2, 3, 4]);
  const pos: PoSpec[] = [];
  for (let i = 0; i < 25; i++) {
    const anchor = ANCHORS[i];
    const supplier = i < 5 ? i : anchor === 'demo' ? 2 : smallPoSuppliers.pop()!;
    const workOrder = anchor === 'demo' ? demoWo : workOrderSlots.pop()!;
    const start = workOrders[workOrder].start;
    const catalog = rng.shuffle([...SUPPLIERS[supplier].parts]);
    const lineCount = i < 5 ? 10 : i < 15 ? 1 : 2;
    pos.push({
      number: anchor === 'demo' ? DEMO.poNumber : `PO-${24101 + i}`,
      supplier,
      workOrder,
      buyer: BUYERS[i % BUYERS.length],
      anchor,
      lines: catalog.slice(0, lineCount).map((part) => ({
        part,
        qty: rng.int(2, 40) * 2,
        // Required dock is on or before production start, and at least two days out.
        dock: maxDate(addDays(start, -rng.int(0, 5)), D(2)),
        deliveries: [],
      })),
    });
  }

  // Primary demo: 100 units for WO-DEMO-A, required dock D+5, production start D+7, arrival D+5.
  const demoPo = pos.find((p) => p.anchor === 'demo')!;
  demoPo.lines[0] = { part: [DEMO.partNumber, 'Wire harness, sensor mast'], qty: 100, dock: D(5), deliveries: [{ qty: 100, category: 'healthy' }] };

  const randomCategory = (): Category => {
    const r = rng.next();
    if (r < 0.5) return 'healthy';
    if (r < 0.64) return 'received';
    if (r < 0.74) return 'late';
    if (r < 0.84) return 'conflict';
    if (r < 0.92) return 'unknown';
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
          { qty: firstQty, category: rng.next() < 0.5 ? 'received' : 'transit' },
          { qty: line.qty - firstQty, category: randomCategory() },
        ];
      } else {
        line.deliveries = [{ qty: line.qty, category: randomCategory() }];
      }
    }
  }

  // ---- Insert the original schedule ----
  const supplierIds = SUPPLIERS.map((s) => Number(db.prepare('INSERT INTO suppliers (name) VALUES (?)').run(s.name).lastInsertRowid));
  const warehouseIds = WAREHOUSES.map((w) =>
    Number(db.prepare('INSERT INTO warehouses (code, name) VALUES (?, ?)').run(w.code, w.name).lastInsertRowid),
  );
  const insertWo = db.prepare('INSERT INTO work_orders (number, program, warehouse_id, production_start) VALUES (?, ?, ?, ?)');
  const woIds = workOrders.map((wo) => Number(insertWo.run(wo.number, wo.program, warehouseIds[wo.warehouse], wo.start).lastInsertRowid));
  const insertPo = db.prepare(
    'INSERT INTO purchase_orders (number, supplier_id, warehouse_id, work_order_id, buyer, status) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertLine = db.prepare(
    `INSERT INTO po_lines (po_id, line_no, part_number, description, unit, ordered_qty, required_dock_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertDelivery = db.prepare(
    `INSERT INTO deliveries (po_line_id, quantity, state, expected_arrival, received_at, source, arrival_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  /** Later arrival-information events, applied through the mutation services. */
  const events: { at: number; run: () => void }[] = [];
  const anchorDeliveries = new Map<Category | 'demo', { poId: number; deliveryId: number }>();
  const lateDeliveries: { poId: number; deliveryId: number }[] = [];

  for (const po of pos) {
    const wo = workOrders[po.workOrder];
    const categories = po.lines.flatMap((l) => l.deliveries.map((d) => d.category));
    const status = categories.every((c) => c === 'received') ? 'Received' : categories.includes('received') ? 'Partially received' : 'Open';
    const poId = Number(insertPo.run(po.number, supplierIds[po.supplier], warehouseIds[wo.warehouse], woIds[po.workOrder], po.buyer, status).lastInsertRowid);
    const scheduledAt = ts(-rng.int(18, 40), rng.int(13, 22));

    po.lines.forEach((line, index) => {
      const lineId = Number(insertLine.run(poId, index + 1, line.part[0], line.part[1], 'EA', line.qty, line.dock).lastInsertRowid);
      const onTime = (maxLead: number) => maxDate(addDays(line.dock, -rng.int(0, maxLead)), D(1));
      for (const delivery of line.deliveries) {
        const c = delivery.category;
        let state: 'planned' | 'in_transit' | 'received' = 'planned';
        let arrival: string | null = onTime(6);
        if (po.anchor === 'demo') arrival = D(5);
        else if (c === 'received') {
          state = 'received';
          arrival = D(-rng.int(2, 25));
        } else if (c === 'transit') {
          state = 'in_transit';
          arrival = onTime(3);
        } else if (c === 'carrier') {
          state = 'in_transit';
          arrival = minDate(onTime(3), D(3));
        } else if (c === 'overdue') {
          state = rng.next() < 0.5 ? 'in_transit' : 'planned';
          arrival = D(-rng.int(1, 5));
        } else if (c === 'healthy') {
          state = arrival <= D(6) && rng.next() < 0.4 ? 'in_transit' : 'planned';
        }
        const deliveryId = Number(
          insertDelivery.run(lineId, delivery.qty, state, arrival, state === 'received' ? arrival : null, 'po_schedule', scheduledAt).lastInsertRowid,
        );
        if (po.anchor) anchorDeliveries.set(po.anchor, { poId, deliveryId });
        scheduleEvents(c, { poId, deliveryId, dock: line.dock, start: wo.start, qty: delivery.qty, arrival, generic: !po.anchor });
      }
    });
  }

  function scheduleEvents(
    c: Category,
    d: { poId: number; deliveryId: number; dock: string; start: string; qty: number; arrival: string | null; generic: boolean },
  ) {
    const day = -rng.int(4, 12);
    const source: UpdateSource = rng.next() < 0.6 ? 'supplier_email' : 'supplier_call';
    const update = (at: number, expectedArrival: string | null, src: UpdateSource, note: string, version: number, resolve?: 'date_restored') =>
      events.push({
        at,
        run: () => {
          const issue = getOpenIssue(db, d.deliveryId);
          updateArrival(
            db,
            d.deliveryId,
            {
              expectedArrival,
              source: src,
              note,
              version,
              resolve: resolve && issue ? { issueId: issue.id, expectedIssueVersion: issue.version, outcome: resolve, note: 'Supplier recovered the original date.' } : undefined,
            },
            demoDate,
            ts(at, 10 + (version % 6)),
          );
        },
      });
    const accept = (at: number, version: number, note: string) =>
      events.push({
        at,
        run: () => {
          const issue = getOpenIssue(db, d.deliveryId)!;
          resolveIssue(
            db,
            d.deliveryId,
            { issueId: issue.id, expectedIssueVersion: issue.version, expectedDeliveryVersion: version, outcome: 'accepted_delay', note },
            demoDate,
            ts(at, 16),
          );
        },
      });
    const lateDate = minDate(addDays(d.dock, rng.int(1, 4)), d.start);
    const conflictDate = addDays(d.start, rng.int(2, 10));

    switch (c) {
      case 'late':
        // Late against required dock without a production conflict (needs dock < start).
        update(day, d.dock < d.start ? lateDate : conflictDate, source, 'Supplier revised the ship date.', 1);
        if (d.generic && rng.next() < 0.4) accept(day + 2, 2, 'Still ahead of production start.');
        if (d.generic) lateDeliveries.push(d);
        break;
      case 'conflict':
        update(day, conflictDate, source, 'Supplier reports a material shortage.', 1);
        if (d.generic && rng.next() < 0.4) accept(day + 2, 2, 'No alternate source; delay accepted.');
        if (d.generic) lateDeliveries.push(d);
        break;
      case 'accepted':
        update(day, conflictDate, 'supplier_email', 'Heat-treat backlog at supplier.', 1);
        accept(day + 2, 2, 'No alternate source; production planner informed.');
        break;
      case 'unknown':
        update(day, null, 'supplier_call', 'Supplier could not confirm a date.', 1);
        break;
      case 'carrier':
        // Carrier-sourced update: the ETA moved a day later but still meets the dock date.
        db.prepare('UPDATE deliveries SET expected_arrival = ? WHERE id = ?').run(addDays(d.arrival!, -1), d.deliveryId);
        update(-1, d.arrival, 'carrier_update', 'Carrier tracking shows a hold at the regional hub.', 1);
        break;
      case 'restored':
        update(-6, conflictDate, 'supplier_email', 'Supplier reports a tooling failure.', 1);
        update(-3, d.arrival, 'supplier_call', 'Tooling repaired; original date confirmed.', 2, 'date_restored');
        break;
      case 'split':
        update(-6, conflictDate, 'supplier_email', 'Supplier can only ship part of the quantity on time.', 1);
        events.push({
          at: -3,
          run: () => {
            const issue = getOpenIssue(db, d.deliveryId)!;
            const early = Math.floor(d.qty / 2);
            splitDelivery(
              db,
              d.deliveryId,
              {
                version: 2,
                source: 'supplier_call',
                note: 'Agreed partial shipment on the original date.',
                parts: [
                  { quantity: early, expectedArrival: d.arrival },
                  { quantity: d.qty - early, expectedArrival: conflictDate },
                ],
                resolve: { issueId: issue.id, expectedIssueVersion: issue.version, outcome: 'split_agreed', note: '' },
              },
              demoDate,
              ts(-3, 11),
            );
          },
        });
        break;
    }
  }

  for (const event of events.sort((a, b) => a.at - b.at)) event.run();
  // Exceptions with no recorded update (overdue against the original schedule) open issues once.
  reconcileIssues(db, demoDate, ts(-1, 7));

  // Optional reminders: due, upcoming, PO-level, and completed. They never create or resolve issues.
  const insertFollowUp = db.prepare(
    `INSERT INTO follow_ups (po_id, delivery_id, due_date, note, state, completion_note, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const timely = anchorDeliveries.get('healthy')!;
  insertFollowUp.run(timely.poId, timely.deliveryId, D(-1), 'Confirm material certs will ship with the delivery.', 'open', null, null, ts(-6), ts(-6));
  const late = anchorDeliveries.get('late')!;
  insertFollowUp.run(late.poId, late.deliveryId, D(2), 'Ask supplier for a recovery date or partial shipment option.', 'open', null, null, ts(-3), ts(-3));
  const unknown = anchorDeliveries.get('unknown')!;
  insertFollowUp.run(unknown.poId, unknown.deliveryId, D(0), 'Request a committed ship date from supplier.', 'open', null, null, ts(-4), ts(-4));
  const overdue = anchorDeliveries.get('overdue')!;
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
  setMeta.run('issues_initialized', new Date().toISOString());

  assertIntegrity(db);
}

const maxDate = (a: string, b: string) => (a > b ? a : b);
const minDate = (a: string, b: string) => (a < b ? a : b);

/** Throws if the dataset breaks a quantity, date, or relationship rule. Used after seeding and in tests. */
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
    db.prepare('SELECT p.id FROM purchase_orders p JOIN work_orders w ON w.id = p.work_order_id WHERE w.warehouse_id <> p.warehouse_id').all(),
  );
  fail(
    'required dock date missing or after production start',
    db
      .prepare(
        `SELECT l.id FROM po_lines l JOIN purchase_orders p ON p.id = l.po_id JOIN work_orders w ON w.id = p.work_order_id
         WHERE l.required_dock_date = '' OR l.required_dock_date > w.production_start`,
      )
      .all(),
  );
  fail('received delivery without a receipt date', db.prepare("SELECT id FROM deliveries WHERE state = 'received' AND received_at IS NULL").all());
  fail(
    'work order without a PO',
    db.prepare('SELECT w.id FROM work_orders w WHERE NOT EXISTS (SELECT 1 FROM purchase_orders p WHERE p.work_order_id = w.id)').all(),
  );
  fail(
    'supplier without PO',
    db.prepare('SELECT s.id FROM suppliers s WHERE NOT EXISTS (SELECT 1 FROM purchase_orders p WHERE p.supplier_id = s.id)').all(),
  );
}
