// Incoming items views and filters (PRD §6A). Multi-select values combine with OR within a dimension
// and AND across dimensions, alongside supplier, state, search, and the view. View counts apply the
// other filters but not the view itself. State, including the column sort, round-trips through URL
// query parameters.
import { DELIVERY_STATES, type DeliveryRow, type DeliveryState, type FilterOptions } from './types.js';

export type View = 'action' | 'outstanding' | 'late' | 'unknown' | 'received';

export const VIEWS: { key: View; label: string; test: (r: DeliveryRow) => boolean }[] = [
  { key: 'action', label: 'Needs action', test: (r) => r.issue !== null },
  { key: 'outstanding', label: 'All outstanding', test: (r) => r.state !== 'received' },
  // Late includes accepted/resolved delays: physical risk is independent of disposition.
  { key: 'late', label: 'Late', test: (r) => r.risk.reasons.includes('late') },
  { key: 'unknown', label: 'Date unknown', test: (r) => r.risk.reasons.includes('unknown') },
  { key: 'received', label: 'Received', test: (r) => r.state === 'received' },
];

export interface IncomingFilters {
  search: string;
  supplier: string;
  state: DeliveryState | '';
  /** Warehouse ids; empty means all destinations. */
  destinations: number[];
  /** Work-order program values ("Program line"); empty means all. */
  programs: string[];
}

export const EMPTY_FILTERS: IncomingFilters = { search: '', supplier: '', state: '', destinations: [], programs: [] };

export function matchesFilters(r: DeliveryRow, f: IncomingFilters): boolean {
  const term = f.search.trim().toLowerCase();
  return (
    (!f.supplier || r.supplierName === f.supplier) &&
    (!f.state || r.state === f.state) &&
    (f.destinations.length === 0 || f.destinations.includes(r.warehouseId)) &&
    (f.programs.length === 0 || f.programs.includes(r.program)) &&
    (!term || [r.poNumber, r.partNumber, r.description, r.supplierName].some((v) => v.toLowerCase().includes(term)))
  );
}

export function viewCounts(rows: DeliveryRow[], f: IncomingFilters): Record<View, number> {
  const filtered = rows.filter((r) => matchesFilters(r, f));
  return Object.fromEntries(VIEWS.map((v) => [v.key, filtered.filter(v.test).length])) as Record<View, number>;
}

/**
 * Reads view and filters from the URL. Values that are not current options are dropped rather than
 * mapped to something else, so a stale link never selects a different program or destination.
 */
export function parseIncomingQuery(params: URLSearchParams, options: FilterOptions | null): { view: View; filters: IncomingFilters } {
  const view = VIEWS.some((v) => v.key === params.get('view')) ? (params.get('view') as View) : 'action';
  const state = params.get('state');
  const destinations = params
    .getAll('destination')
    .map(Number)
    .filter((id) => Number.isInteger(id) && (!options || options.destinations.some((d) => d.id === id)));
  const programs = params.getAll('program').filter((p) => !options || options.programs.includes(p));
  return {
    view,
    filters: {
      search: params.get('q') ?? '',
      supplier: params.get('supplier') ?? '',
      state: DELIVERY_STATES.includes(state as DeliveryState) ? (state as DeliveryState) : '',
      destinations: [...new Set(destinations)],
      programs: [...new Set(programs)],
    },
  };
}

export function serializeIncomingQuery(view: View, f: IncomingFilters, sort: SortState | null = null): URLSearchParams {
  const params = new URLSearchParams();
  if (view !== 'action') params.set('view', view);
  if (f.search) params.set('q', f.search);
  if (f.supplier) params.set('supplier', f.supplier);
  if (f.state) params.set('state', f.state);
  for (const id of f.destinations) params.append('destination', String(id));
  for (const p of f.programs) params.append('program', p);
  if (sort) {
    params.set('sort', sort.key);
    params.set('dir', sort.dir);
  }
  return params;
}

// ---- Column sorting ----

export type SortKey = 'po' | 'supplier' | 'part' | 'qty' | 'state' | 'dock' | 'arrival' | 'start' | 'updated';
export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

const SORT_KEYS: SortKey[] = ['po', 'supplier', 'part', 'qty', 'state', 'dock', 'arrival', 'start', 'updated'];
const STATE_ORDER = { planned: 0, in_transit: 1, received: 2 } as const;

/** The value a column displays: received rows show their receipt date in Expected arrival. */
function sortValue(r: DeliveryRow, key: SortKey): string | number | null {
  switch (key) {
    case 'po':
      return `${r.poNumber}\u0000${String(r.lineNo).padStart(4, '0')}`;
    case 'supplier':
      return r.supplierName.toLowerCase();
    case 'part':
      return r.partNumber;
    case 'qty':
      return r.quantity;
    case 'state':
      return STATE_ORDER[r.state];
    case 'dock':
      return r.requiredDock;
    case 'arrival':
      return r.state === 'received' ? r.receivedAt : r.expectedArrival;
    case 'start':
      return r.productionStart;
    case 'updated':
      return r.arrivalUpdatedAt;
  }
}

/**
 * Comparator for a chosen column. Empty values (unknown dates) sort last in either direction; ties
 * fall back to `tiebreak` (the default demo ordering) so the order is stable.
 */
export function compareBySort(sort: SortState, tiebreak: (a: DeliveryRow, b: DeliveryRow) => number) {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return (a: DeliveryRow, b: DeliveryRow): number => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    if (va !== vb) {
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va < vb ? -1 : 1) * sign;
    }
    return tiebreak(a, b);
  };
}

/** Null means the default demo ordering. Unknown values fall back to it. */
export function parseSort(params: URLSearchParams): SortState | null {
  const key = params.get('sort') as SortKey | null;
  if (!key || !SORT_KEYS.includes(key)) return null;
  return { key, dir: params.get('dir') === 'desc' ? 'desc' : 'asc' };
}

/** Header click cycle: ascending, descending, then back to the default ordering. */
export function nextSort(current: SortState | null, key: SortKey): SortState | null {
  if (current?.key !== key) return { key, dir: 'asc' };
  return current.dir === 'asc' ? { key, dir: 'desc' } : null;
}
