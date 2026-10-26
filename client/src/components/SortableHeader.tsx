/**
 * Column header that sorts on click. The caller owns the click cycle; aria-sort announces the
 * current direction and an arrow shows it.
 */
export function SortableHeader({
  label,
  direction,
  numeric = false,
  title,
  onSort,
}: {
  label: string;
  direction: 'asc' | 'desc' | null;
  numeric?: boolean;
  /** Definition tooltip, e.g. for cumulative quantity columns. */
  title?: string;
  onSort: () => void;
}) {
  return (
    <th className={numeric ? 'num' : undefined} title={title} aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}>
      <button type="button" className={`sort-button${direction ? ' active' : ''}`} onClick={onSort}>
        {label}
        <span className="sort-indicator" aria-hidden="true">
          {direction === 'asc' ? ' ▲' : direction === 'desc' ? ' ▼' : ' ↕'}
        </span>
      </button>
    </th>
  );
}
