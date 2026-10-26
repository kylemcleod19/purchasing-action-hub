// Small inline icons. Every icon has an accessible label and a tooltip; none is interactive, and the
// received check is not a receipt checkbox.
const PATHS = {
  // Envelope
  email: 'M2 4h12v8H2z M2 4l6 5 6-5',
  // Phone handset
  phone: 'M4.5 2h2l1 3-1.5 1a8 8 0 0 0 4 4l1-1.5 3 1v2a1.5 1.5 0 0 1-1.5 1.5A10.5 10.5 0 0 1 3 3.5 1.5 1.5 0 0 1 4.5 2z',
  // Package
  package: 'M2 5l6-3 6 3v6l-6 3-6-3z M2 5l6 3 6-3 M8 8v6',
  // Document
  document: 'M4 2h5l3 3v9H4z M9 2v3h3 M6 8h4 M6 10.5h4',
  // Warning triangle
  warning: 'M8 2l6.5 11.5h-13z M8 6.5v3.5 M8 12v.01',
  // Check mark
  check: 'M3 8.5l3 3 7-7',
  // Question in a circle
  question: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z M6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4 M8 11.5v.01',
  // Gear (production)
  conflict: 'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M8 1.5v2 M8 12.5v2 M1.5 8h2 M12.5 8h2 M3.4 3.4l1.4 1.4 M11.2 11.2l1.4 1.4 M3.4 12.6l1.4-1.4 M11.2 4.8l1.4-1.4',
  // Flag (open issue)
  flag: 'M3.5 14V2 M3.5 2.5h8l-2 3 2 3h-8',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, label, className }: { name: IconName; label: string; className?: string }) {
  return (
    <svg className={`icon icon-${name}${className ? ` ${className}` : ''}`} viewBox="0 0 16 16" width="14" height="14" role="img" aria-label={label}>
      <title>{label}</title>
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export const SOURCE_ICONS: Record<string, IconName> = {
  supplier_email: 'email',
  supplier_call: 'phone',
  carrier_update: 'package',
};
