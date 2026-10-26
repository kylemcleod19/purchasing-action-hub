// Explicit, confirmed demo reset. Shared data affects every visitor; nothing resets automatically.
import { useState } from 'react';
import { api, ApiRequestError } from '../api';
import { useDemo } from '../demo';
import { Modal } from './Modal';

export function ResetDemoButton({ className = 'link-button' }: { className?: string }) {
  const { refreshAll } = useDemo();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    setSaving(true);
    setError(null);
    try {
      await api('/demo/reset', { method: 'POST', body: { confirm: 'RESET' } });
      setConfirming(false);
      refreshAll();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Reset failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setConfirming(true)}>
        Reset demo data
      </button>
      {confirming && (
        <Modal title="Reset demo data?" onClose={() => !saving && setConfirming(false)}>
          <p>
            This replaces every change made by anyone using this demo with the original synthetic baseline, clears simulated
            messages, tasks, and carrier events, and sets the demo date and clock to today. It cannot be undone.
          </p>
          {error && <div className="form-error">{error}</div>}
          <div className="form-actions">
            <button type="button" onClick={() => setConfirming(false)} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="danger" onClick={reset} disabled={saving}>
              {saving ? 'Resetting…' : 'Reset demo data'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
