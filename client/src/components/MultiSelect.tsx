// Labeled, searchable multi-select dropdown with checkboxes (PRD §6 "Incoming destination and program
// filters"). Empty selection means all. Options come from the full dataset.
import { useEffect, useId, useRef, useState } from 'react';

export interface MultiSelectOption {
  value: string;
  label: string;
}

export function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const term = query.trim().toLowerCase();
  const shown = options.filter((o) => !term || o.label.toLowerCase().includes(term));
  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  const summary = selected.length === 0 ? 'All' : `${selected.length} selected`;

  return (
    <div className="multi-select" ref={root}>
      <button
        type="button"
        className={`multi-select-trigger${selected.length ? ' has-selection' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        aria-label={`${label}: ${summary}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="multi-select-label">{label}</span> <span>{summary}</span> ▾
      </button>
      {open && (
        <div className="multi-select-panel" id={`${id}-panel`} role="group" aria-label={label}>
          <input
            type="search"
            placeholder={`Search ${label.toLowerCase()}`}
            aria-label={`Search ${label.toLowerCase()}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <ul>
            {shown.map((o) => (
              <li key={o.value}>
                <label className="checkbox">
                  <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} /> {o.label}
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className="hint">No matches.</li>}
          </ul>
          <button type="button" className="link-button small" onClick={() => onChange([])} disabled={selected.length === 0}>
            Clear {label.toLowerCase()}
          </button>
        </div>
      )}
    </div>
  );
}
