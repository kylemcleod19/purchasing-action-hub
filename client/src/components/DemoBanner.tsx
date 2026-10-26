import { useState } from 'react';
import { api, ApiRequestError } from '../api';
import { useDemo } from '../demo';
import { formatDate } from '../../../shared/dates';
import { Modal } from './Modal';

export function DemoBanner() {
  const { meta, afterReset } = useDemo();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    setSaving(true);
    setError(null);
    try {
      await api('/demo/reset', { method: 'POST', body: { confirm: 'RESET' } });
      setConfirming(false);
      afterReset();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Reset failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="demo-banner">
      <span>
        <strong>Demo date: {meta ? formatDate(meta.demoDate) : '…'}</strong> · Synthetic data only. All visitors share this
        dataset; no emails, orders, or supplier messages are sent.
      </span>
      {meta?.demoMode && (
        <button type="button" className="link-button" onClick={() => setConfirming(true)}>
          Reset demo data
        </button>
      )}
      {confirming && (
        <Modal title="Reset demo data?" onClose={() => !saving && setConfirming(false)}>
          <p>
            This replaces every change made by anyone using this demo with the original synthetic baseline, and sets the
            demo date to today. It cannot be undone.
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
    </div>
  );
}
