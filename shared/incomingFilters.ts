// Incoming items views and filters (PRD §6A). Multi-select values combine with OR within a dimension
// and AND across dimensions, alongside supplier, state, search, and the view. View counts apply the
// other filters but not the view itself. State round-trips through URL query parameters.
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

export function serializeIncomingQuery(view: View, f: IncomingFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (view !== 'action') params.set('view', view);
  if (f.search) params.set('q', f.search);
  if (f.supplier) params.set('supplier', f.supplier);
  if (f.state) params.set('state', f.state);
  for (const id of f.destinations) params.append('destination', String(id));
  for (const p of f.programs) params.append('program', p);
  return params;
}
