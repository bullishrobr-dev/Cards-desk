import { useState } from 'react';
import { isIos, isStandalone } from './push.ts';

const KEY = 'cdd.coach.dismissed';

function dismissedAlready(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false; // private mode or blocked storage: show it, it can still be closed
  }
}

/**
 * iOS only lets Home Screen web apps receive push, so Safari visitors get a short coach.
 * Dismissal is remembered on this device when storage allows.
 */
export function HomeScreenCoach() {
  const [hidden, setHidden] = useState(() => !isIos() || isStandalone() || dismissedAlready());
  if (hidden) return null;
  const close = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(KEY, '1');
    } catch {
      // Not remembered; it will show again next visit.
    }
  };
  return (
    <div className="coach" role="dialog" aria-label="Add to Home Screen">
      <button type="button" className="coach-close" onClick={close} aria-label="Close">
        ✕
      </button>
      <strong>Get alerts on this device</strong>
      <ol>
        <li>
          Tap the Share button <span aria-hidden="true">(□↑)</span> in Safari's toolbar.
        </li>
        <li>
          Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
        </li>
        <li>Open Card Desk Drops from your Home Screen and turn on notifications in Settings.</li>
      </ol>
      <p className="small muted">iOS only sends push notifications to apps opened from the Home Screen.</p>
    </div>
  );
}
