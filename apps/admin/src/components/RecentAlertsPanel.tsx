import {AlertTriangle, BellOff, Clock, ShieldAlert} from 'lucide-react';
import {useAlerts} from '../alerts/AlertsContext';
import {
  cameraSourceLabel,
  endReasonLabel,
  formatDuration,
  formatTimestamp,
} from '../alerts/eventStore';

export function RecentAlertsPanel() {
  const {
    events,
    sessionAlertCount,
    historicalAlertCount,
    storageError,
    storageStatus,
  } = useAlerts();
  const recent = events.slice(0, 5);

  return (
    <section
      aria-labelledby="recent-alerts-heading"
      className="flex flex-1 flex-col rounded-xl border border-slate-800/90 bg-[#10192D] p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="recent-alerts-heading"
          className="text-base font-semibold tracking-tight text-slate-100"
        >
          Recent Alerts
        </h2>

        <span className="inline-flex items-center gap-1 text-xs text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
          <span>Warning</span>
        </span>
      </div>

      {recent.length === 0 ? (
        <div className="mt-4 flex flex-1 flex-col items-center justify-center border-t border-slate-800/80 px-4 py-8 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-800/50 text-slate-400">
            <BellOff className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="mt-3 text-sm font-medium text-slate-200">
            {storageStatus === 'loading'
              ? 'Reading local history…'
              : 'No alerts recorded yet.'}
          </p>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-400">
            Prolonged eye-closure episodes are recorded here after monitoring runs.
            Ordinary blinks and tracking interruptions do not create alerts.
          </p>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-slate-800/80 border-t border-slate-800/80">
          {recent.map((event) => (
            <li key={event.id} className="flex flex-col gap-1 py-3 first:pt-1 last:pb-1">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="flex items-center gap-2 text-sm font-medium text-amber-200">
                  <AlertTriangle
                    className="h-3.5 w-3.5 shrink-0 text-amber-400"
                    aria-hidden="true"
                  />
                  Prolonged eye closure
                </span>
                <span className="font-mono text-[11px] text-slate-400">
                  {formatTimestamp(event.timestamp)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-5 text-[11px] text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  {formatDuration(event.observedDurationMs)}
                </span>
                <span>{cameraSourceLabel(event.cameraSource)}</span>
                <span>{endReasonLabel(event.endReason)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {storageError && (
        <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] leading-relaxed text-amber-200" role="status">
          Local storage error: {storageError}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3 text-[11px] text-slate-400">
        <span>{sessionAlertCount} this session</span>
        <span>{historicalAlertCount} total stored</span>
      </div>
      <p className="mt-1.5 flex items-center gap-1.5 text-[10px] leading-snug text-slate-500">
        <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
        Metadata only; records stay in this browser and never include images or video.
      </p>
    </section>
  );
}
