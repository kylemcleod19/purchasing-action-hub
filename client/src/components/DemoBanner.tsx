import { useState } from 'react';
import { api, ApiRequestError } from '../api';
import { useDemo } from '../demo';
import { formatClock } from '../../../shared/clock';
import { formatDate } from '../../../shared/dates';
import { Modal } from './Modal';

export function DemoBanner() {
  const { meta, refreshAll } = useDemo();
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
    <div className="demo-banner">
      <span>
        <strong>Demo date: {meta ? formatDate(meta.demoDate) : '…'}</strong>
        {meta && <span className="hint"> (clock {formatClock(meta.demoClock)})</span>} · Synthetic data only. All visitors share this dataset; no
        emails, orders, or supplier messages are sent.
      </span>
      {meta && ((meta.seedVersion && meta.seedVersion !== meta.currentSeedVersion) || !meta.fixturesInstalled) && (
        <span className="seed-notice">This data predates the current demo seed. Reset to load the current scenarios.</span>
      )}
      {meta?.demoMode && (
        <button type="button" className="link-button" onClick={() => setConfirming(true)}>
          Reset demo data
        </button>
      )}
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
    </div>
  );
}
