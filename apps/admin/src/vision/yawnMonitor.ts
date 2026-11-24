export type YawnMonitorPhase = 'idle' | 'candidate' | 'active';

export const DEFAULT_YAWN_MIN_DURATION_MS = 800;

export interface YawnMonitorConfig {
  /** Normalized mouth opening that starts a yawn candidate. */
  openThreshold: number;
  /** Lower reopening threshold; only below this does a new yawn become armed. */
  closeThreshold: number;
  /** Continuous open-ish time required before one alert is emitted. */
  minDurationMs: number;
  /** A gap longer than this is treated as interrupted evidence. */
  maxGapMs: number;
}

export interface YawnSample {
  now: number;
  opening: number | null;
  valid?: boolean;
}

export interface YawnEpisodeStarted {
  kind: 'yawn';
  startedAt: number;
  durationMs: number;
}

export interface YawnMonitorSnapshot {
  phase: YawnMonitorPhase;
  candidateSince: number | null;
  activeSince: number | null;
}

export function createYawnConfig(relaxedOpening: number): YawnMonitorConfig {
  const safeRelaxed = Number.isFinite(relaxedOpening) && relaxedOpening > 0 ? relaxedOpening : 0.15;
  const openThreshold = Math.max(0.32, Math.min(1.2, safeRelaxed * 2.2));
  return {
    openThreshold,
    closeThreshold: Math.max(0.1, openThreshold * 0.55),
    minDurationMs: DEFAULT_YAWN_MIN_DURATION_MS,
    maxGapMs: 500,
  };
}

/**
 * One alert per sustained mouth-opening episode. Opening above the high
 * threshold arms a candidate; dropping below the lower threshold re-arms.
 * Invalid samples and calls to reset() clear in-progress timing.
 */
export class YawnMonitor {
  private config: YawnMonitorConfig;
  private phase: YawnMonitorPhase = 'idle';
  private candidateSince: number | null = null;
  private activeSince: number | null = null;
  private lastValidAt: number | null = null;

  constructor(config: YawnMonitorConfig) {
    this.config = config;
  }

  getSnapshot(): YawnMonitorSnapshot {
    return {
      phase: this.phase,
      candidateSince: this.candidateSince,
      activeSince: this.activeSince,
    };
  }

  reset(): void {
    this.phase = 'idle';
    this.candidateSince = null;
    this.activeSince = null;
    this.lastValidAt = null;
  }

  setConfig(config: YawnMonitorConfig): void {
    this.config = config;
    this.reset();
  }

  handle(sample: YawnSample): YawnEpisodeStarted | null {
    const {now, opening} = sample;
    if (
      sample.valid === false ||
      !Number.isFinite(now) ||
      opening === null ||
      !Number.isFinite(opening) ||
      opening < 0
    ) {
      this.reset();
      return null;
    }

    if (
      this.lastValidAt !== null &&
      now >= this.lastValidAt &&
      now - this.lastValidAt > this.config.maxGapMs
    ) {
      this.reset();
    }
    this.lastValidAt = now;

    if (opening >= this.config.openThreshold) {
      if (this.phase === 'idle') {
        this.phase = 'candidate';
        this.candidateSince = now;
        return null;
      }
      if (
        this.phase === 'candidate' &&
        this.candidateSince !== null &&
        now - this.candidateSince >= this.config.minDurationMs
      ) {
        this.phase = 'active';
        this.activeSince = this.candidateSince;
        return {
          kind: 'yawn',
          startedAt: this.candidateSince,
          durationMs: now - this.candidateSince,
        };
      }
      return null;
    }

    if (opening <= this.config.closeThreshold) {
      this.reset();
    }
    // Between the thresholds, keep the current phase so ordinary landmark
    // jitter does not split one sustained episode into several alerts.
    return null;
  }
}
