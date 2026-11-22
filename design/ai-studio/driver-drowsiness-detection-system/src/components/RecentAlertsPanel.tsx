import {AlertTriangle, BellOff, OctagonAlert} from 'lucide-react';

export function RecentAlertsPanel() {
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

        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1 text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
            <span>Warning</span>
          </span>
          <span className="inline-flex items-center gap-1 text-red-300">
            <OctagonAlert className="h-3.5 w-3.5 text-red-400" aria-hidden="true" />
            <span>Critical</span>
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-1 flex-col items-center justify-center border-t border-slate-800/80 px-4 py-8 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-800/50 text-slate-400">
          <BellOff className="h-5 w-5" aria-hidden="true" />
        </div>
        <p className="mt-3 text-sm font-medium text-slate-200">
          No alerts recorded yet.
        </p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-400">
          Prolonged eye-closure warnings and critical drowsiness alerts will appear here during an active session.
        </p>
      </div>
    </section>
  );
}
