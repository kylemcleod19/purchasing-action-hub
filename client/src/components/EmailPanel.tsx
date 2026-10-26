// Read-only simulated email (PRD §13). Opening one never changes state. Samples are labeled so the
// presenter never implies a seeded reply has already arrived or a request has been sent.
import { formatClock } from '../../../shared/clock';
import type { EmailView } from '../../../shared/types';
import { Icon } from './Icons';
import { Modal } from './Modal';

/** Envelope plus text: visually a read-only view control, distinct from simulation buttons. */
export function EmailButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="email-button small" onClick={onClick} disabled={disabled}>
      <Icon name="email" label="" /> {label}
    </button>
  );
}

export function EmailModal({ email, title, onClose }: { email: EmailView; title: string; onClose: () => void }) {
  const notice = email.sample
    ? email.at === null && email.subject.startsWith('RE:')
      ? 'Sample reply: a seeded fixture, shown before processing. It has not arrived.'
      : 'Preview: this request has not been sent.'
    : 'Simulated email. Nothing was sent or received.';
  return (
    <Modal title={title} onClose={onClose} wide>
      <p className="email-notice" role="note">
        {notice}
      </p>
      <table className="compact context-table email-headers">
        <tbody>
          <tr>
            <th scope="row">From</th>
            <td>{email.from}</td>
          </tr>
          <tr>
            <th scope="row">To</th>
            <td>{email.to}</td>
          </tr>
          <tr>
            <th scope="row">Subject</th>
            <td>{email.subject}</td>
          </tr>
          <tr>
            <th scope="row">{email.sample ? 'Time' : email.from.includes('demo-buyer') ? 'Sent' : 'Received'}</th>
            <td>{email.at ? formatClock(email.at) : 'Not yet'}</td>
          </tr>
        </tbody>
      </table>
      <pre className="message-body">{email.body}</pre>
      <div className="form-actions">
        <button type="button" className="primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
