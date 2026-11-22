import {useState} from 'react';
import {
  AlertTriangle,
  BellOff,
  Download,
  OctagonAlert,
  Search,
  Trash2,
} from 'lucide-react';

type SeverityFilter = 'all' | 'warning' | 'critical';
type SourceFilter = 'all' | 'this-device' | 'esp32-cam';

export function AlertHistoryScreen() {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const hasFiltersActive =
    severityFilter !== 'all' ||
    sourceFilter !== 'all' ||
    searchQuery.trim().length > 0;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Filters & History Actions */}
      <section
        aria-labelledby="alert-filters-heading"
        className="rounded-xl border border-slate-800/90 bg-[#10192D] p-4 sm:p-5"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label
                htmlFor="alert-search-input"
                className="block text-xs font-medium text-slate-300"
              >
                Search events
              </label>
              <div className="relative mt-1.5">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500"
                  aria-hidden="true"
                />
                <input
                  id="alert-search-input"
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Filter by event or source"
                  className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#0B1221] pr-3 pl-9 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="alert-type-filter"
                className="block text-xs font-medium text-slate-300"
              >
                Event type
              </label>
              <select
                id="alert-type-filter"
                value={severityFilter}
                onChange={(event) =>
                  setSeverityFilter(event.target.value as SeverityFilter)
                }
                className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              >
                <option value="all">All event types</option>
                <option value="warning">Warning (prolonged closure)</option>
                <option value="critical">Critical drowsiness alert</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="alert-source-filter"
                className="block text-xs font-medium text-slate-300"
              >
                Camera source
              </label>
              <select
                id="alert-source-filter"
                value={sourceFilter}
                onChange={(event) =>
                  setSourceFilter(event.target.value as SourceFilter)
                }
                className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              >
                <option value="all">All camera sources</option>
                <option value="this-device">This device</option>
                <option value="esp32-cam">ESP32-CAM</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border border-slate-800 bg-[#0B1221] px-4 py-2 text-sm font-medium text-slate-400 disabled:cursor-not-allowed disabled:opacity-65 whitespace-nowrap sm:flex-initial"
            >
              <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Export</span>
            </button>

            <button
              type="button"
              disabled
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border border-slate-800 bg-[#0B1221] px-4 py-2 text-sm font-medium text-slate-400 disabled:cursor-not-allowed disabled:opacity-65 whitespace-nowrap sm:flex-initial"
            >
              <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Clear history</span>
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3 text-xs text-slate-400">
          <span id="alert-filters-heading">
            Export and clear-history controls are disabled while alert history is empty.
          </span>

          {hasFiltersActive && (
            <button
              type="button"
              onClick={() => {
                setSeverityFilter('all');
                setSourceFilter('all');
                setSearchQuery('');
              }}
              className="font-medium text-teal-300 hover:text-teal-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
            >
              Reset filters
            </button>
          )}
        </div>
      </section>

      {/* Event Table (Desktop) & Mobile Cards */}
      <section
        aria-labelledby="alert-log-heading"
        className="rounded-xl border border-slate-800/90 bg-[#10192D] p-4 sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="alert-log-heading"
            className="text-base font-semibold tracking-tight text-slate-100 sm:text-lg"
          >
            Recorded Events
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

        {/* Desktop table headers */}
        <div className="mt-4 hidden overflow-x-auto md:block">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs font-medium text-slate-400">
                <th scope="col" className="py-3 pr-4">
                  Timestamp
                </th>
                <th scope="col" className="px-4 py-3">
                  Event type
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Duration
                </th>
                <th scope="col" className="py-3 pl-4">
                  Camera source
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={4} className="py-12 text-center">
                  <div className="mx-auto flex max-w-sm flex-col items-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-800/50 text-slate-400">
                      <BellOff className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <p className="mt-3 text-sm font-medium text-slate-200">
                      No alerts recorded yet
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">
                      Prolonged eye-closure events will appear here with their timestamp, event type, duration, and camera source once monitoring runs.
                    </p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Mobile-friendly card container */}
        <div className="mt-4 md:hidden">
          <div className="flex flex-col items-center justify-center border-t border-slate-800/80 px-3 py-8 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-800/50 text-slate-400">
              <BellOff className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="mt-3 text-sm font-medium text-slate-200">
              No alerts recorded yet
            </p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-400">
              Mobile event cards will display timestamp, event type, duration, and camera source once alerts are recorded.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
