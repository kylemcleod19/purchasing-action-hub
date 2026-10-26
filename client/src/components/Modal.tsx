import { useEffect, useRef, type ReactNode } from 'react';

/** Dialog with Escape-to-close. Focus returns to the element that opened it when it closes. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const opener = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    dialog.current?.focus();
    const origin = opener.current;
    return () => {
      // The opener may have re-rendered after a save; fall back to its replacement by data attribute.
      if (origin?.isConnected) origin.focus();
      else if (origin?.dataset.focusKey) document.querySelector<HTMLElement>(`[data-focus-key="${origin.dataset.focusKey}"]`)?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} tabIndex={-1} className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="link-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
