import {AlertTriangle, X} from 'lucide-react';
import {useAlerts} from '../alerts/AlertsContext';
import {formatPopupDuration} from '../alerts/alertPopup';

/** Non-blocking notifications: detection and camera continue while visible. */
export function AlertPopupStack() {
  const {alertPopups, dismissAlertPopup} = useAlerts();
  if (alertPopups.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-3 top-3 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:items-end"
      aria-live="polite"
      aria-label="Recent alerts"
    >
      {alertPopups.map((popup) => (
        <div
          key={popup.id}
          role="status"
          className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-amber-500/40 bg-[#1B253A] p-3.5 shadow-2xl shadow-black/40"
        >
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-300"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-100">
              {popup.message}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-amber-200/80">
              {popup.type === 'possible-yawn' ? 'Open for' : 'Closed for'}{' '}
              <span className="font-mono text-amber-100">
                {formatPopupDuration(popup.durationMs)}
              </span>
              . Detection is still running; dismiss when read.
            </p>
          </div>
          <button
            type="button"
            onClick={() => dismissAlertPopup(popup.id)}
            aria-label={`Dismiss alert: ${popup.message}`}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-600/70 text-slate-300 transition-colors hover:bg-slate-700/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
