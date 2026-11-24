import type {
  MonitoringInterruption,
  MonitoringStatus,
} from '../vision/eyeClosureMonitor';
import type {AudioManager} from './audioManager';
import {popupMessageFor, type AlertPopup} from './alertPopup';
import {
  createId,
  type CameraSourceLabel,
  type ClosureEndReason,
  type ClosureEvent,
  type EventStore,
  type EventUpdate,
} from './eventStore';

export interface EpisodeMonitoringSnapshot {
  status: MonitoringStatus;
  active: boolean;
  closureMs: number;
  reason: MonitoringInterruption | null;
}

export interface EpisodeSnapshot {
  monitoring: EpisodeMonitoringSnapshot;
  /** False while tracking is loading, paused, or in an error state. */
  trackingRunning: boolean;
  cameraLive: boolean;
  cameraSource: CameraSourceLabel;
  configuredDurationMs: number;
}

export interface EpisodeRecorderOptions {
  store: EventStore;
  audio: AudioManager;
  sessionId: string;
  now?: () => number;
  createId?: () => string;
  onEvent?: (event: ClosureEvent) => void;
  onEventUpdate?: (id: string, update: EventUpdate) => void;
  onError?: (message: string) => void;
  /** Called once per new episode, beside the browser audio alert. */
  onEpisodeStart?: (event: ClosureEvent) => void;
  /** Visual-only popup; never routes to hardware. */
  onPopup?: (popup: AlertPopup) => void;
}

interface ActiveEpisode {
  id: string;
  observedDurationMs: number;
}

const SAVE_ERROR = 'The alert could not be saved in this browser.';
const UPDATE_ERROR = 'A saved alert could not be updated when the episode ended.';

/**
 * Converts repeated monitoring-state snapshots into at most one event and one
 * sound per prolonged-closure episode. A new episode is only armed after an
 * observed `eyes-open` state, so a tracking gap cannot re-trigger the same
 * physical closure.
 */
export class EpisodeRecorder {
  private readonly store: EventStore;
  private readonly audio: AudioManager;
  private readonly sessionId: string;
  private readonly now: () => number;
  private readonly makeId: () => string;
  private readonly onEvent?: (event: ClosureEvent) => void;
  private readonly onEventUpdate?: (id: string, update: EventUpdate) => void;
  private readonly onError?: (message: string) => void;
  private readonly onEpisodeStart?: (event: ClosureEvent) => void;
  private readonly onPopup?: (popup: AlertPopup) => void;

  private previousProlonged = false;
  private previousSourceActive = false;
  private previousCameraSource: CameraSourceLabel | null = null;
  private armed = true;
  private active: ActiveEpisode | null = null;

  constructor(options: EpisodeRecorderOptions) {
    this.store = options.store;
    this.audio = options.audio;
    this.sessionId = options.sessionId;
    this.now = options.now ?? Date.now;
    this.makeId = options.createId ?? createId;
    this.onEvent = options.onEvent;
    this.onEventUpdate = options.onEventUpdate;
    this.onError = options.onError;
    this.onEpisodeStart = options.onEpisodeStart;
    this.onPopup = options.onPopup;
  }

  /** Ends an in-flight episode from a page-level interruption such as pagehide. */
  finishActive(reason: ClosureEndReason): void {
    if (!this.active) return;
    this.completeActive(reason);
    this.audio.stop();
    this.previousProlonged = false;
    this.previousSourceActive = false;
  }

  handle(snapshot: EpisodeSnapshot): void {
    const cameraSourceChanged =
      this.previousCameraSource !== null &&
      this.previousCameraSource !== snapshot.cameraSource;
    const sourceActive =
      !cameraSourceChanged &&
      snapshot.cameraLive &&
      snapshot.trackingRunning &&
      snapshot.monitoring.active &&
      snapshot.monitoring.status !== 'unavailable';

    // A sound in progress must not continue into a stopped or unusable session.
    if (this.previousSourceActive && !sourceActive) this.audio.stop();
    this.previousSourceActive = sourceActive;
    this.previousCameraSource = snapshot.cameraSource;

    if (sourceActive && snapshot.monitoring.status === 'eyes-open') {
      this.armed = true;
    }

    const prolonged =
      sourceActive && snapshot.monitoring.status === 'prolonged-closure';

    if (prolonged && !this.previousProlonged) {
      if (this.armed) this.startEpisode(snapshot);
    } else if (prolonged && this.active) {
      this.active.observedDurationMs = Math.max(
        this.active.observedDurationMs,
        snapshot.monitoring.closureMs,
      );
    }

    if (this.previousProlonged && !prolonged && this.active) {
      this.finishEpisode(snapshot, cameraSourceChanged);
    }

    this.previousProlonged = prolonged;
  }

  private startEpisode(snapshot: EpisodeSnapshot): void {
    const id = this.makeId();
    const event: ClosureEvent = {
      id,
      sessionId: this.sessionId,
      timestamp: new Date(this.now()).toISOString(),
      type: 'prolonged-eye-closure',
      severity: 'warning',
      cameraSource: snapshot.cameraSource,
      configuredDurationMs: snapshot.configuredDurationMs,
      observedDurationMs: Math.max(0, snapshot.monitoring.closureMs),
      endedAt: null,
      endReason: null,
      schemaVersion: 1,
    };

    this.active = {
      id,
      observedDurationMs: event.observedDurationMs,
    };
    this.armed = false;
    this.onEvent?.(event);

    void this.store.createEvent(event).catch(() => this.onError?.(SAVE_ERROR));
    // One sound and one popup per episode. `onEpisodeStart` is the eye-only
    // hardware hook and remains separate from browser notification state.
    this.audio.playAlert();
    this.onPopup?.({
      id: `popup-${id}`,
      type: 'prolonged-eye-closure',
      message: popupMessageFor('prolonged-eye-closure'),
      timestamp: event.timestamp,
      durationMs: event.observedDurationMs,
    });
    this.onEpisodeStart?.(event);
  }

  private finishEpisode(
    snapshot: EpisodeSnapshot,
    cameraSourceChanged: boolean,
  ): void {
    const episode = this.active;
    if (!episode) return;

    const endReason = this.endReasonFor(snapshot, cameraSourceChanged);
    episode.observedDurationMs = Math.max(
      episode.observedDurationMs,
      Math.max(0, snapshot.monitoring.closureMs),
    );
    this.completeActive(endReason);
  }

  private completeActive(endReason: ClosureEndReason): void {
    const episode = this.active;
    if (!episode) return;

    const update: EventUpdate = {
      observedDurationMs: episode.observedDurationMs,
      endedAt: new Date(this.now()).toISOString(),
      endReason,
    };

    this.onEventUpdate?.(episode.id, update);
    void this.store
      .updateEvent(episode.id, update)
      .catch(() => this.onError?.(UPDATE_ERROR));

    this.active = null;
    if (endReason === 'eyes-opened') this.armed = true;
  }

  private endReasonFor(
    snapshot: EpisodeSnapshot,
    cameraSourceChanged: boolean,
  ): ClosureEndReason {
    if (
      cameraSourceChanged ||
      !snapshot.cameraLive ||
      !snapshot.trackingRunning ||
      snapshot.monitoring.reason !== null ||
      snapshot.monitoring.status === 'unavailable'
    ) {
      return 'tracking-interrupted';
    }
    if (snapshot.monitoring.status === 'eyes-open') return 'eyes-opened';
    // `ready` / `not-calibrated` after an explicit stop or invalidation.
    return 'monitoring-stopped';
  }
}
