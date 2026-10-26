import { useDemo } from '../demo';
import { formatClock } from '../../../shared/clock';
import { formatDate } from '../../../shared/dates';
import { ResetDemoButton } from './ResetDemoButton';

export function DemoBanner() {
  const { meta } = useDemo();
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
      {meta?.demoMode && <ResetDemoButton />}
    </div>
  );
}
