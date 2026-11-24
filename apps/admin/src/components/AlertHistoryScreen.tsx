import {useMemo, useState} from 'react';
import {
  AlertTriangle,
  BellOff,
  Download,
  HardDrive,
  Search,
  Trash2,
} from 'lucide-react';
import {useAlerts} from '../alerts/AlertsContext';
import {
  cameraSourceLabel,
  endReasonLabel,
  eventTypeLabel,
  formatDuration,
  formatTimestamp,
  type CameraSourceLabel,
  type ClosureEndReason,
  type ClosureEvent,
  type ClosureEventType,
} from '../alerts/eventStore';

type EventTypeFilter = 'all' | ClosureEventType;
type SourceFilter = 'all' | CameraSourceLabel;
type EndReasonFilter = 'all' | ClosureEndReason | 'ongoing';

function matchesFilters(
  event: ClosureEvent,
  eventType: EventTypeFilter,
  source: SourceFilter,
  endReason: EndReasonFilter,
  query: string,
  sessionId: string,
): boolean {
  if (eventType !== 'all' && event.type !== eventType) return false;
  if (source !== 'all' && event.cameraSource !== source) return false;
  if (endReason === 'ongoing' && event.endReason !== null) return false;
  if (endReason !== 'all' && endReason !== 'ongoing' && event.endReason !== endReason) {
    return false;
  }
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    event.id,
    event.sessionId,
    event.type,
    cameraSourceLabel(event.cameraSource),
    endReasonLabel(event.endReason),
    event.endReason ?? '',
    event.sessionId === sessionId ? 'current session' : '',
  ]
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

function EventRow({event, sessionId}: {event: ClosureEvent; sessionId: string}) {
  return (
    <tr className="border-b border-slate-800/70 align-top last:border-0">
      <td className="py-3 pr-4 whitespace-nowrap">
        <span className="block text-sm text-slate-200">
          {formatTimestamp(event.timestamp)}
        </span>
        {event.sessionId === sessionId && (
          <span className="mt-0.5 inline-block font-mono text-[10px] text-teal-300">
            Current session
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
          {eventTypeLabel(event.type)}
        </span>
        <span className="mt-0.5 block font-mono text-[10px] text-slate-500">
          {event.id}
        </span>
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm text-slate-200">
        {formatDuration(event.observedDurationMs)}
        <span className="mt-0.5 block font-sans text-[10px] text-slate-500">
          limit {formatDuration(event.configuredDurationMs)}
        </span>
      </td>
      <td className="py-3 pl-4">
        <span className="block text-sm text-slate-200">
          {cameraSourceLabel(event.cameraSource)}
        </span>
        <span className="mt-0.5 block text-[11px] text-slate-500">
          {endReasonLabel(event.endReason)}
        </span>
      </td>
    </tr>
  );
}

function EventCard({event, sessionId}: {event: ClosureEvent; sessionId: string}) {
  return (
    <li className="rounded-lg border border-slate-800 bg-[#0B1221] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
          {eventTypeLabel(event.type)}
        </span>
        <span className="font-mono text-[11px] text-slate-400">
          {formatDuration(event.observedDurationMs)}
        </span>
      </div>
      <dl className="mt-2 space-y-1 text-[11px]">
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Timestamp</dt>
          <dd className="text-right text-slate-300">{formatTimestamp(event.timestamp)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Camera</dt>
          <dd className="text-right text-slate-300">
            {cameraSourceLabel(event.cameraSource)}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Ended</dt>
          <dd className="text-right text-slate-300">{endReasonLabel(event.endReason)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Configured limit</dt>
          <dd className="text-right font-mono text-slate-300">
            {formatDuration(event.configuredDurationMs)}
          </dd>
        </div>
      </dl>
      <p className="mt-2 font-mono text-[10px] break-all text-slate-600">
        {event.id}
        {event.sessionId === sessionId ? ' · current session' : ''}
      </p>
    </li>
  );
}

export function AlertHistoryScreen() {
  const {
    events,
    sessionId,
    sessionAlertCount,
    historicalAlertCount,
    storageError,
    storageStatus,
    clearHistory,
    exportCSV,
    exportJSON,
  } = useAlerts();
  const [eventTypeFilter, setEventTypeFilter] = useState<EventTypeFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [endReasonFilter, setEndReasonFilter] = useState<EndReasonFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const filteredEvents = useMemo(
    () =>
      events.filter((event) =>
        matchesFilters(
          event,
          eventTypeFilter,
          sourceFilter,
          endReasonFilter,
          searchQuery,
          sessionId,
        ),
      ),
    [endReasonFilter, eventTypeFilter, events, searchQuery, sessionId, sourceFilter],
  );

  const hasFiltersActive =
    eventTypeFilter !== 'all' ||
    sourceFilter !== 'all' ||
    endReasonFilter !== 'all' ||
    searchQuery.trim().length > 0;

  const resetFilters = () => {
    setEventTypeFilter('all');
    setSourceFilter('all');
    setEndReasonFilter('all');
    setSearchQuery('');
  };

  const handleClear = async () => {
    setClearing(true);
    await clearHistory();
    setClearing(false);
    setConfirmingClear(false);
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800/90 bg-[#10192D] px-4 py-3.5 sm:px-5">
        <div className="flex items-start gap-2.5">
          <HardDrive
            className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
            aria-hidden="true"
          />
          <p className="max-w-3xl text-xs leading-relaxed text-slate-400 sm:text-sm">
            Records stay in this browser. They do not automatically sync and may be
            removed by clearing browser data. Only timestamps, camera source,
            thresholds, durations, and event metadata are stored — never images,
            video, landmarks, or calibration samples.
          </p>
        </div>
        <p className="font-mono text-[11px] text-slate-400">
          {sessionAlertCount} this session · {historicalAlertCount} total stored
        </p>
      </div>

      {storageError && (
        <p
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-200 sm:px-5"
          role="status"
        >
          Local storage error: {storageError} Monitoring and visual alerts still work;
          affected records may not survive a reload.
        </p>
      )}

      <section
        aria-labelledby="alert-filters-heading"
        className="rounded-xl border border-slate-800/90 bg-[#10192D] p-4 sm:p-5"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                  placeholder="Event, source, session"
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
                value={eventTypeFilter}
                onChange={(event) =>
                  setEventTypeFilter(event.target.value as EventTypeFilter)
                }
                className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              >
                <option value="all">All event types</option>
                <option value="prolonged-eye-closure">Prolonged eye closure</option>
                <option value="possible-yawn">Possible yawn</option>
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
                onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}
                className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              >
                <option value="all">All sources</option>
                <option value="this-device">This device</option>
                <option value="esp32-cam">ESP32-CAM (legacy records)</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="alert-end-filter"
                className="block text-xs font-medium text-slate-300"
              >
                Episode ended
              </label>
              <select
                id="alert-end-filter"
                value={endReasonFilter}
                onChange={(event) =>
                  setEndReasonFilter(event.target.value as EndReasonFilter)
                }
                className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              >
                <option value="all">Any end state</option>
                <option value="eyes-opened">Eyes reopened</option>
                <option value="monitoring-stopped">Monitoring stopped</option>
                <option value="tracking-interrupted">Tracking interrupted</option>
                <option value="mouth-closed">Mouth returned to relaxed</option>
                <option value="ongoing">Ongoing / not ended</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => exportJSON(filteredEvents)}
              disabled={filteredEvents.length === 0}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border border-slate-800 bg-[#0B1221] px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap sm:flex-initial"
            >
              <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
              JSON
            </button>
            <button
              type="button"
              onClick={() => exportCSV(filteredEvents)}
              disabled={filteredEvents.length === 0}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border border-slate-800 bg-[#0B1221] px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap sm:flex-initial"
            >
              <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
              CSV
            </button>
            <button
              type="button"
              onClick={() => setConfirmingClear(true)}
              disabled={events.length === 0 || confirmingClear}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap sm:flex-initial"
            >
              <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              Clear history
            </button>
          </div>
        </div>

        {confirmingClear && (
          <div
            className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-100"
            role="alertdialog"
            aria-label="Confirm clearing event history"
          >
            <span>
              Delete all {events.length} locally stored events? This cannot be undone.
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmingClear(false)}
                className="min-h-[36px] rounded-md border border-slate-600 px-3 py-1.5 font-medium text-slate-200 hover:bg-slate-700/50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleClear()}
                disabled={clearing}
                className="min-h-[36px] rounded-md bg-red-500 px-3 py-1.5 font-semibold text-white disabled:opacity-60"
              >
                {clearing ? 'Deleting…' : 'Delete all'}
              </button>
            </span>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3 text-xs text-slate-400">
          <span>
            Showing {filteredEvents.length} of {events.length} locally stored events
            {hasFiltersActive ? ' · exports use the filtered rows' : ''}
          </span>
          {hasFiltersActive && (
            <button
              type="button"
              onClick={resetFilters}
              className="font-medium text-teal-300 hover:text-teal-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
            >
              Reset filters
            </button>
          )}
        </div>
      </section>

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
          <span className="inline-flex items-center gap-1 text-xs text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
            Warning
          </span>
        </div>

        {filteredEvents.length === 0 ? (
          <div className="mt-4 flex flex-col items-center justify-center border-t border-slate-800/80 px-3 py-10 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-800/50 text-slate-400">
              <BellOff className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="mt-3 text-sm font-medium text-slate-200">
              {storageStatus === 'loading'
                ? 'Reading local history…'
                : events.length === 0
                  ? 'No alerts recorded yet'
                  : 'No events match these filters'}
            </p>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-400">
              {events.length === 0
                ? 'Prolonged eye-closure episodes will appear here with timestamp, duration, threshold, and camera source. Blinks and tracking problems are not alerts.'
                : 'Reset the filters to see all locally stored events.'}
            </p>
          </div>
        ) : (
          <>
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
                      Camera / end
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((event) => (
                    <EventRow key={event.id} event={event} sessionId={sessionId} />
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-800/80 pt-4 md:hidden">
              {filteredEvents.map((event) => (
                <EventCard key={event.id} event={event} sessionId={sessionId} />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
