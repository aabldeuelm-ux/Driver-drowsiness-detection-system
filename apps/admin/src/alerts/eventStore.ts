import {
  DEFAULT_PROLONGED_CLOSURE_MS,
  validateProlongedClosureMs,
} from '../vision/eyeClosureMonitor';

export type CameraSourceLabel = 'this-device' | 'esp32-cam' | 'unknown';
export type ClosureEndReason =
  | 'eyes-opened'
  | 'monitoring-stopped'
  | 'tracking-interrupted';

export interface ClosureEvent {
  id: string;
  sessionId: string;
  /** ISO timestamp of the start of the prolonged-closure episode. */
  timestamp: string;
  type: 'prolonged-eye-closure';
  severity: 'warning';
  cameraSource: CameraSourceLabel;
  configuredDurationMs: number;
  observedDurationMs: number;
  endedAt: string | null;
  endReason: ClosureEndReason | null;
  schemaVersion: 1;
}

export interface SoundSettings {
  /** User opt-in. Audio still needs a browser gesture after every reload. */
  enabled: boolean;
  muted: boolean;
  /** 0–100. */
  volume: number;
}

export interface AppSettings {
  schemaVersion: 1;
  prolongedClosureMs: number;
  sound: SoundSettings;
}

export interface EventUpdate {
  observedDurationMs?: number;
  endedAt?: string | null;
  endReason?: ClosureEndReason | null;
}

export interface EventStore {
  listEvents(): Promise<ClosureEvent[]>;
  createEvent(event: ClosureEvent): Promise<void>;
  updateEvent(id: string, update: EventUpdate): Promise<void>;
  clearEvents(): Promise<void>;
  getSettings(): Promise<AppSettings | null>;
  saveSettings(settings: AppSettings): Promise<void>;
  clearAll(): Promise<void>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  prolongedClosureMs: DEFAULT_PROLONGED_CLOSURE_MS,
  sound: {enabled: false, muted: false, volume: 70},
};

export function createId(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] ?? 0) & 0x0f | 0x40;
      bytes[8] = (bytes[8] ?? 0) & 0x3f | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
      return [
        hex.slice(0, 4).join(''),
        hex.slice(4, 6).join(''),
        hex.slice(6, 8).join(''),
        hex.slice(8, 10).join(''),
        hex.slice(10, 16).join(''),
      ].join('-');
    }
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clampVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.sound.volume;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Rejects unknown or partially written records without trusting their shape. */
export function sanitizeSettings(value: unknown): AppSettings | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<AppSettings>;
  if (candidate.schemaVersion !== 1) return null;
  const duration = validateProlongedClosureMs(candidate.prolongedClosureMs);
  if (!duration.ok) return null;
  const sound = candidate.sound as Partial<SoundSettings> | undefined;
  if (!sound || typeof sound !== 'object') return null;

  return {
    schemaVersion: 1,
    prolongedClosureMs: duration.value,
    sound: {
      enabled: sound.enabled === true,
      muted: sound.muted === true,
      volume: clampVolume(sound.volume),
    },
  };
}

export function sortEvents(events: readonly ClosureEvent[]): ClosureEvent[] {
  return [...events].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export class MemoryEventStore implements EventStore {
  private events: ClosureEvent[];
  private settings: AppSettings | null;

  constructor(
    options: {events?: readonly ClosureEvent[]; settings?: AppSettings | null} = {},
  ) {
    this.events = sortEvents(options.events ?? []);
    this.settings = options.settings ?? null;
  }

  async listEvents(): Promise<ClosureEvent[]> {
    return sortEvents(this.events);
  }

  async createEvent(event: ClosureEvent): Promise<void> {
    this.events = sortEvents([...this.events.filter((item) => item.id !== event.id), event]);
  }

  async updateEvent(id: string, update: EventUpdate): Promise<void> {
    this.events = this.events.map((event) =>
      event.id === id ? {...event, ...update} : event,
    );
  }

  async clearEvents(): Promise<void> {
    this.events = [];
  }

  async getSettings(): Promise<AppSettings | null> {
    return this.settings
      ? {
          ...this.settings,
          sound: {...this.settings.sound},
        }
      : null;
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    this.settings = {...settings, sound: {...settings.sound}};
  }

  async clearAll(): Promise<void> {
    this.events = [];
    this.settings = null;
  }
}

const CSV_COLUMNS = [
  'id',
  'sessionId',
  'timestamp',
  'type',
  'severity',
  'cameraSource',
  'configuredDurationMs',
  'observedDurationMs',
  'endReason',
  'endedAt',
  'schemaVersion',
] as const;

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function formatEventsCSV(events: readonly ClosureEvent[]): string {
  const header = CSV_COLUMNS.join(',');
  const rows = events.map((event) =>
    [
      event.id,
      event.sessionId,
      event.timestamp,
      event.type,
      event.severity,
      event.cameraSource,
      event.configuredDurationMs,
      event.observedDurationMs,
      event.endReason,
      event.endedAt,
      event.schemaVersion,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header, ...rows].join('\r\n');
}

export function formatEventsJSON(
  events: readonly ClosureEvent[],
  exportedAt: string,
): string {
  return JSON.stringify(
    {
      schemaVersion: 1 as const,
      exportedAt,
      note: 'Metadata only. No images, video, landmarks, or calibration samples are exported.',
      events: sortEvents(events),
    },
    null,
    2,
  );
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function cameraSourceLabel(source: CameraSourceLabel): string {
  if (source === 'this-device') return 'This device';
  // Kept only for events recorded by older firmware/admin builds.
  if (source === 'esp32-cam') return 'ESP32-CAM (legacy)';
  return 'Unknown';
}

export function endReasonLabel(reason: ClosureEndReason | null): string {
  if (reason === 'eyes-opened') return 'Eyes reopened';
  if (reason === 'monitoring-stopped') return 'Monitoring stopped';
  if (reason === 'tracking-interrupted') return 'Tracking interrupted';
  return 'Ongoing';
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], {type: mimeType});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
