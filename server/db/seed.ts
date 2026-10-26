// Deterministic synthetic dataset (PRD §9, §13, §14). All business dates are offsets from the demo
// date, so scenarios stay valid whenever the database is reset. Fictional suppliers, parts, programs,
// carriers, and tracking numbers. Each PO belongs to exactly one work order; items and deliveries
// inherit it. Seeded history, issues, and resolutions are recorded through the same mutation services
// the app uses, with backdated timestamps, so they follow the real issue rules.
//
// The two simulation scenarios (Case A supplier outreach, Case B carrier delay) are embedded in the
// existing 25 POs / 80 items. Their baseline is installed here; their playback effects are not.
import type { DB } from './db.js';
import { addDays } from '../../shared/dates.js';
import { DEFAULT_OUTREACH_SETTINGS } from '../../shared/outreach.js';
import { resolveIssue, splitDelivery, updateArrival } from '../services/deliveries.js';
import { getOpenIssue, reconcileIssues } from '../services/issues.js';
import type { DeliveryState, UpdateSource } from '../../shared/types.js';

export const SEED_VERSION = '4';
/** Version of the simulation fixtures installed by a reset (PRD §13). */
export const FIXTURE_VERSION = '1';

export const DEMO = {
  poNumber: 'PO-DEMO-01',
  partNumber: 'HX-2210',
  workOrder: 'WO-DEMO-A',
} as const;

/** Case A: partial supplier reply across a ten-line PO and a two-line PO from one specialist. */
export const CASE_A = {
  supplier: 'Kestrel Precision Machining',
  poNumbers: ['PO-24105', 'PO-24116'],
  workOrder: 'WO-30101',
} as const;

/** Case B: one carrier delay across three delivery rows on two POs, with an untouched remainder. */
export const CASE_B = {
  supplier: 'Granite Bearing Co.',
  poNumbers: ['PO-24101', 'PO-24117'],
  shipment: 'SH-DEMO-01',
  carrier: 'Demo Freight',
  tracking: 'DEMO-TRACK-001',
} as const;

const CARRIERS = ['Demo Freight', 'Sample Parcel Co.', 'Placeholder Logistics'];

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

/** An explicitly specified scenario delivery (Case A/B). Day values are offsets from the demo date. */
interface FixedDelivery {
  state: DeliveryState;
  arrival: number | null;
  received?: number;
  updated: number;
  source: UpdateSource | 'po_schedule';
  /** Substantive supplier confirmation day, if any. */
  confirmed?: number;
  /** Reserved shipment key; other shipped records are grouped generically. */
  shipment?: string;
}

interface WorkOrderSpec {
  number: string;
  program: string;
  warehouse: number;
  start: string;
}
interface DeliverySpec {
  qty: number;
  category: Category;
  fixed?: FixedDelivery;
}
interface LineSpec {
  part: Part;
  qty: number;
  dock: string;
  deliveries: DeliverySpec[];
  /** Scenario lines are fully specified and skip random generation and events. */
  scenario?: boolean;
}
interface PoSpec {
  number: string;
  supplier: number;
  workOrder: number;
  buyer: string;
  lines: LineSpec[];
  anchor?: Category | 'demo';
  /** PO creation day; generic POs use their initial schedule day. */
  created?: number;
}

// Single-line POs that pin the PRD's required examples to known records.
const ANCHORS: Record<number, Category | 'demo'> = {
  5: 'demo',
  6: 'healthy', // timely arrival with a reminder due
  7: 'late', // after required dock, before production start
  8: 'unknown',
  9: 'overdue', // dispatched without a tracking number
  10: 'carrier',
  11: 'received',
  12: 'restored', // date-restored resolution
  13: 'split', // split agreed with one late child
  14: 'accepted', // accepted late delivery, ready to reopen with a worse date
};

// Scenario POs (PRD §13): suppliers 4 (Case A) and 0 (Case B) each hold a ten-line PO and a small PO.
const CASE_A_PO = 4;
const CASE_A_SMALL_PO = 15;
const CASE_B_PO = 0;
const CASE_B_SMALL_PO = 16;
// Work orders: Case A's two POs share WO 0; Case B's POs use WOs 5 and 7 (both South warehouse).
const CASE_A_WO = 0;
const CASE_B_WO = 5;
const CASE_B_SMALL_WO = 7;

export function seedDatabase(db: DB, demoDate: string): void {
  const rng = createRng(20261026);
  const D = (days: number) => addDays(demoDate, days);
  const ts = (days: number, hour = 15) => `${D(days)}T${String(hour).padStart(2, '0')}:00:00.000Z`;

  // 20 work orders: 19 generated plus the primary-demo work order.
  const workOrders: WorkOrderSpec[] = [];
  for (let i = 0; i < 19; i++) {
    workOrders.push({ number: `WO-${30101 + i}`, program: rng.pick(PROGRAMS), warehouse: i % 2, start: D(rng.int(4, 45)) });
  }
  workOrders[CASE_A_WO].start = D(5);
  workOrders[CASE_B_WO].start = D(4);
  workOrders[CASE_B_SMALL_WO].start = D(7);
  const demoWo = workOrders.push({ number: DEMO.workOrder, program: 'Program Atlas', warehouse: 0, start: D(7) }) - 1;

  // 25 POs: 5 with 10 lines (suppliers 0-4, full catalogs), 10 with 1 line, 10 with 2 lines.
  // Suppliers 0-4 each also have one small PO; five work orders have two POs.
  const pinnedSupplier: Record<number, number> = { [CASE_A_SMALL_PO]: 4, [CASE_B_SMALL_PO]: 0 };
  const pinnedWorkOrder: Record<number, number> = {
    [CASE_A_PO]: CASE_A_WO,
    [CASE_A_SMALL_PO]: CASE_A_WO,
    [CASE_B_PO]: CASE_B_WO,
    [CASE_B_SMALL_PO]: CASE_B_SMALL_WO,
  };
  const smallPoSuppliers = rng.shuffle([1, 3, ...Array.from({ length: 15 }, (_, i) => i + 5)]);
  const freeWorkOrders = [...Array(19).keys()].filter((w) => ![CASE_A_WO, CASE_B_WO, CASE_B_SMALL_WO].includes(w));
  const workOrderSlots = rng.shuffle([...freeWorkOrders, 1, 2, 3, 4]);
  const pos: PoSpec[] = [];
  for (let i = 0; i < 25; i++) {
    const anchor = ANCHORS[i];
    const supplier = i < 5 ? i : anchor === 'demo' ? 2 : (pinnedSupplier[i] ?? smallPoSuppliers.pop()!);
    const workOrder = anchor === 'demo' ? demoWo : (pinnedWorkOrder[i] ?? workOrderSlots.pop()!);
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

  // The late anchor needs a dock date before production start to be late without a production conflict.
  const lateAnchor = pos.find((p) => p.anchor === 'late')!;
  lateAnchor.lines[0].dock = minDate(lateAnchor.lines[0].dock, addDays(workOrders[lateAnchor.workOrder].start, -2));

  // Primary demo: 100 units for WO-DEMO-A, required dock D+5, production start D+7, arrival D+5.
  const demoPo = pos.find((p) => p.anchor === 'demo')!;
  demoPo.lines[0] = { part: [DEMO.partNumber, 'Wire harness, sensor mast'], qty: 100, dock: D(5), deliveries: [{ qty: 100, category: 'healthy' }] };

  const fixed = (qty: number, f: FixedDelivery): DeliverySpec => ({ qty, category: f.state === 'received' ? 'received' : 'healthy', fixed: f });
  const scenarioLine = (line: LineSpec, qty: number, dock: string, deliveries: DeliverySpec[]) =>
    Object.assign(line, { qty, dock, deliveries, scenario: true });

  // Case A (PRD §13): PO creation D-20, required dock D+3, production start D+5 on both POs. Eight
  // queried lines are not shipped, expected D+2, last confirmed D-7. The other four lines are
  // excluded: two recent confirmations, one received, one with usable tracking.
  const queried = (qty: number) => fixed(qty, { state: 'planned', arrival: 2, updated: -7, source: 'supplier_email', confirmed: -7 });
  const caseA = pos[CASE_A_PO];
  caseA.created = -20;
  const caseAQty = [20, 16, 40, 12, 24, 16, 30, 18, 10, 14];
  caseA.lines.forEach((line, i) => {
    let delivery: DeliverySpec;
    if (i < 6) delivery = queried(caseAQty[i]);
    else if (i < 8) delivery = fixed(caseAQty[i], { state: 'planned', arrival: 2, updated: -1, source: 'supplier_email', confirmed: -1 });
    else if (i === 8) delivery = fixed(caseAQty[i], { state: 'received', arrival: -3, received: -3, updated: -9, source: 'po_schedule' });
    else delivery = fixed(caseAQty[i], { state: 'in_transit', arrival: 2, updated: -2, source: 'carrier_update' });
    scenarioLine(line, caseAQty[i], D(3), [delivery]);
  });
  const caseASmall = pos[CASE_A_SMALL_PO];
  caseASmall.created = -20;
  scenarioLine(caseASmall.lines[0], 12, D(3), [queried(12)]);
  scenarioLine(caseASmall.lines[1], 30, D(3), [queried(30)]);

  // Case B (PRD §13): SH-DEMO-01 carries PO-C line 1's dispatched 30 of 50, PO-C line 2, and PO-D
  // line 1. PO-C line 1's other 20 stay a separate not-shipped commitment. PO-C line 3 is shipped in
  // two portions with two tracking numbers.
  const onDemoShipment: FixedDelivery = { state: 'in_transit', arrival: 1, updated: -1, source: 'carrier_update', shipment: CASE_B.shipment };
  const caseB = pos[CASE_B_PO];
  caseB.created = -25;
  scenarioLine(caseB.lines[0], 50, D(2), [
    fixed(30, onDemoShipment),
    fixed(20, { state: 'planned', arrival: 2, updated: -5, source: 'supplier_email', confirmed: -5 }),
  ]);
  scenarioLine(caseB.lines[1], 12, D(2), [fixed(12, onDemoShipment)]);
  scenarioLine(caseB.lines[2], 24, D(3), [
    fixed(10, { state: 'received', arrival: -4, received: -4, updated: -10, source: 'po_schedule' }),
    fixed(14, { state: 'in_transit', arrival: 2, updated: -1, source: 'carrier_update' }),
  ]);
  const caseBSmall = pos[CASE_B_SMALL_PO];
  caseBSmall.created = -25;
  scenarioLine(caseBSmall.lines[0], 8, D(5), [fixed(8, onDemoShipment)]);

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
      if (line.scenario) continue;
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
    'INSERT INTO purchase_orders (number, supplier_id, warehouse_id, work_order_id, buyer, status, created_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const insertLine = db.prepare(
    `INSERT INTO po_lines (po_id, line_no, part_number, description, unit, ordered_qty, required_dock_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertDelivery = db.prepare(
    `INSERT INTO deliveries (po_line_id, quantity, state, expected_arrival, received_at, source, arrival_updated_at, last_supplier_confirmation_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  /** Later arrival-information events, applied through the mutation services. */
  const events: { at: number; run: () => void }[] = [];
  const anchorDeliveries = new Map<Category | 'demo', { poId: number; deliveryId: number }>();
  const lateDeliveries: { poId: number; deliveryId: number }[] = [];
  /** Deliveries reserved for named shipments, in insertion order. */
  const reservedShipments = new Map<string, number[]>();
  const reserve = (key: string, deliveryId: number) => reservedShipments.set(key, [...(reservedShipments.get(key) ?? []), deliveryId]);

  for (const po of pos) {
    const wo = workOrders[po.workOrder];
    const received = po.lines.flatMap((l) => l.deliveries.map((d) => d.category === 'received'));
    const status = received.every(Boolean) ? 'Received' : received.some(Boolean) ? 'Partially received' : 'Open';
    const scheduledDay = po.created ?? -rng.int(18, 40);
    const scheduledAt = ts(scheduledDay, rng.int(13, 22));
    const poId = Number(
      insertPo.run(po.number, supplierIds[po.supplier], warehouseIds[wo.warehouse], woIds[po.workOrder], po.buyer, status, D(scheduledDay))
        .lastInsertRowid,
    );

    po.lines.forEach((line, index) => {
      const lineId = Number(insertLine.run(poId, index + 1, line.part[0], line.part[1], 'EA', line.qty, line.dock).lastInsertRowid);
      const onTime = (maxLead: number) => maxDate(addDays(line.dock, -rng.int(0, maxLead)), D(1));
      for (const delivery of line.deliveries) {
        const f = delivery.fixed;
        if (f) {
          const deliveryId = Number(
            insertDelivery.run(
              lineId,
              delivery.qty,
              f.state,
              f.arrival === null ? null : D(f.arrival),
              f.received === undefined ? null : D(f.received),
              f.source,
              ts(f.updated),
              f.confirmed === undefined ? null : ts(f.confirmed),
            ).lastInsertRowid,
          );
          if (f.shipment) reserve(f.shipment, deliveryId);
          continue;
        }
        const c = delivery.category;
        let state: DeliveryState = 'planned';
        let arrival: string | null = onTime(6);
        if (po.anchor === 'demo') arrival = D(5);
        else if (c === 'received') {
          state = 'received';
          // Received after the PO existed long enough to ship.
          arrival = maxDate(D(-rng.int(2, 25)), D(scheduledDay + 6));
        } else if (c === 'transit') {
          state = 'in_transit';
          arrival = onTime(3);
        } else if (c === 'carrier') {
          state = 'in_transit';
          arrival = minDate(onTime(3), D(3));
        } else if (c === 'overdue') {
          state = rng.next() < 0.5 || po.anchor === 'overdue' ? 'in_transit' : 'planned';
          arrival = D(-rng.int(1, 5));
        } else if (c === 'healthy') {
          state = arrival <= D(6) && rng.next() < 0.4 ? 'in_transit' : 'planned';
        }
        const deliveryId = Number(
          insertDelivery.run(lineId, delivery.qty, state, arrival, state === 'received' ? arrival : null, 'po_schedule', scheduledAt, null)
            .lastInsertRowid,
        );
        // The overdue anchor shipped, but the supplier has not provided a tracking number.
        if (po.anchor === 'overdue') reserve(UNTRACKED, deliveryId);
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

  seedShipments(db, demoDate, reservedShipments);

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
  const twoLinePo = db.prepare('SELECT id FROM purchase_orders WHERE number = ?').get(pos[17].number) as { id: number };
  insertFollowUp.run(twoLinePo.id, null, D(4), 'Confirm remaining schedule for both lines.', 'open', null, null, ts(-1), ts(-1));

  const setMeta = db.prepare('INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)');
  setMeta.run('demo_date', demoDate);
  // Simulated clock: 15:00 UTC is morning in America/Chicago. Scenario dates anchor to the demo date.
  setMeta.run('demo_clock', `${demoDate}T15:00:00.000Z`);
  setMeta.run('scenario_anchor', demoDate);
  setMeta.run('fixture_version', FIXTURE_VERSION);
  setMeta.run('cadence_stale_business_days', String(DEFAULT_OUTREACH_SETTINGS.staleBusinessDays));
  setMeta.run('cadence_response_business_days', String(DEFAULT_OUTREACH_SETTINGS.responseWindowBusinessDays));
  setMeta.run('cadence_elapsed_threshold', String(DEFAULT_OUTREACH_SETTINGS.elapsedThreshold));
  setMeta.run('cadence_item_cap', String(DEFAULT_OUTREACH_SETTINGS.itemCap));
  setMeta.run('seed_version', SEED_VERSION);
  setMeta.run('seeded_at', new Date().toISOString());
  setMeta.run('issues_initialized', new Date().toISOString());

  assertIntegrity(db);
}

const UNTRACKED = 'untracked';

interface ShippedRecord {
  id: number;
  state: 'in_transit' | 'received';
  expectedArrival: string | null;
  receivedAt: string | null;
  source: string;
  arrivalUpdatedAt: string;
  supplierId: number;
  warehouseId: number;
}

/**
 * Links every dispatched or received delivery to exactly one shipment (PRD §14). SH-DEMO-01 and the
 * untracked shipment are reserved first; remaining records group only with compatible
 * supplier/destination records on the same date. Numbers follow stable seed order. Each tracked
 * shipment gets a small coherent event history no later than the demo clock.
 */
function seedShipments(db: DB, demoDate: string, reserved: Map<string, number[]>) {
  const at = (date: string, hour: number) => `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`;
  const records = db
    .prepare(
      `SELECT d.id, d.state, d.expected_arrival AS expectedArrival, d.received_at AS receivedAt, d.source,
              d.arrival_updated_at AS arrivalUpdatedAt, p.supplier_id AS supplierId, p.warehouse_id AS warehouseId
       FROM deliveries d JOIN po_lines l ON l.id = d.po_line_id JOIN purchase_orders p ON p.id = l.po_id
       WHERE d.superseded_at IS NULL AND d.state <> 'planned' ORDER BY d.id`,
    )
    .all() as ShippedRecord[];
  const byId = new Map(records.map((r) => [r.id, r]));
  const groups = new Map<string, ShippedRecord[]>();
  for (const [key, ids] of reserved) groups.set(key, ids.map((id) => byId.get(id)!));
  const reservedIds = new Set([...reserved.values()].flat());
  for (const r of records) {
    if (reservedIds.has(r.id)) continue;
    const key = `${r.state}|${r.supplierId}|${r.warehouseId}|${r.state === 'received' ? r.receivedAt : r.expectedArrival}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  // SH-DEMO-01 first, then stable seed order (first linked delivery).
  const ordered = [...groups].sort(([ka, a], [kb, b]) => Number(kb === CASE_B.shipment) - Number(ka === CASE_B.shipment) || a[0].id - b[0].id);

  const insertShipment = db.prepare(
    `INSERT INTO shipments (number, supplier_id, warehouse_id, carrier, tracking_number, tracking_usable, carrier_status,
                            expected_arrival, dispatched_at, carrier_delivered_at, latest_event_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const link = db.prepare('INSERT INTO shipment_deliveries (shipment_id, delivery_id) VALUES (?, ?)');
  const insertEvent = db.prepare(
    `INSERT INTO carrier_events (shipment_id, external_event_id, occurred_at, received_at, payload_json, applied_state)
     VALUES (?, ?, ?, ?, ?, 'applied')`,
  );

  let tracked = 0;
  ordered.forEach(([key, deliveries], index) => {
    const first = deliveries[0];
    const number = `SH-DEMO-${String(index + 1).padStart(2, '0')}`;
    const untracked = key === UNTRACKED;
    const carrier = key === CASE_B.shipment ? CASE_B.carrier : untracked ? null : CARRIERS[index % CARRIERS.length];
    const tracking = untracked ? null : `DEMO-TRACK-${String(++tracked).padStart(3, '0')}`;
    const received = first.state === 'received';
    const eta = received ? first.receivedAt! : first.expectedArrival!;
    // Dispatched, carrier delivered, and warehouse received in sequence; nothing after the demo clock.
    const dispatched = received ? at(addDays(eta, -4), 14) : at(minDate(addDays(eta, -3), addDays(demoDate, -2)), 14);
    const deliveredAt = received ? at(addDays(eta, -1), 21) : null;
    const carrierUpdate = deliveries.find((d) => d.source === 'carrier_update' && d.arrivalUpdatedAt > dispatched);
    const latest = deliveredAt ?? carrierUpdate?.arrivalUpdatedAt ?? dispatched;
    const shipmentId = Number(
      insertShipment.run(
        number,
        first.supplierId,
        first.warehouseId,
        carrier,
        tracking,
        untracked ? 0 : 1,
        received ? 'delivered' : 'in_transit',
        eta,
        dispatched,
        deliveredAt,
        latest,
      ).lastInsertRowid,
    );
    for (const d of deliveries) link.run(shipmentId, d.id);
    if (untracked) return;
    const history: [string, string, string | null][] = [[dispatched, 'picked_up', eta]];
    if (carrierUpdate) history.push([carrierUpdate.arrivalUpdatedAt, 'eta_updated', eta]);
    if (deliveredAt) history.push([deliveredAt, 'delivered', null]);
    history.forEach(([time, status, value], i) =>
      insertEvent.run(shipmentId, `SEED-${number}-${i + 1}`, time, time, JSON.stringify({ status, eta: value })),
    );
  });
}

const maxDate = (a: string, b: string) => (a > b ? a : b);
const minDate = (a: string, b: string) => (a < b ? a : b);

/** Throws if the dataset breaks a quantity, date, relationship, or tracking rule. Used after seeding and in tests. */
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
  fail(
    'PO creation date on or after a required dock date',
    db.prepare('SELECT p.number FROM purchase_orders p JOIN po_lines l ON l.po_id = p.id WHERE p.created_date >= l.required_dock_date').all(),
  );
  fail(
    'dispatched or received delivery without a shipment, or a not-shipped delivery with one',
    db
      .prepare(
        `SELECT d.id, d.state FROM deliveries d LEFT JOIN shipment_deliveries sd ON sd.delivery_id = d.id
         WHERE d.superseded_at IS NULL AND ((d.state <> 'planned' AND sd.delivery_id IS NULL) OR (d.state = 'planned' AND sd.delivery_id IS NOT NULL))`,
      )
      .all(),
  );
  fail(
    'shipment supplier or destination differs from a linked PO',
    db
      .prepare(
        `SELECT s.number, d.id FROM shipments s JOIN shipment_deliveries sd ON sd.shipment_id = s.id JOIN deliveries d ON d.id = sd.delivery_id
         JOIN po_lines l ON l.id = d.po_line_id JOIN purchase_orders p ON p.id = l.po_id
         WHERE p.supplier_id <> s.supplier_id OR p.warehouse_id <> s.warehouse_id`,
      )
      .all(),
  );
  fail('shipment without a tracking number marked usable', db.prepare('SELECT number FROM shipments WHERE tracking_number IS NULL AND tracking_usable = 1').all());
  const untracked = db.prepare("SELECT number FROM shipments WHERE tracking_number IS NULL AND carrier_status <> 'delivered'").all();
  if (untracked.length !== 1) throw new Error(`Seed integrity: expected exactly one in-transit shipment without tracking, found ${untracked.length}`);
  fail(
    'received timeline out of order (dispatched, carrier delivered, warehouse received)',
    db
      .prepare(
        `SELECT s.number FROM shipments s JOIN shipment_deliveries sd ON sd.shipment_id = s.id JOIN deliveries d ON d.id = sd.delivery_id
         WHERE d.state = 'received' AND (s.dispatched_at IS NULL OR s.carrier_delivered_at IS NULL
           OR s.dispatched_at >= s.carrier_delivered_at OR substr(s.carrier_delivered_at, 1, 10) > d.received_at)`,
      )
      .all(),
  );
}
