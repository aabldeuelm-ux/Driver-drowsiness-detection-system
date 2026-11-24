import type {StatusTone} from '../types/dashboard';
import type {SoundSettings} from './eventStore';

export type AudioStatus = 'off' | 'locked' | 'ready' | 'blocked' | 'unsupported';
export type AlertSoundKind = 'eye-closure' | 'possible-yawn';

export interface AudioSnapshot {
  status: AudioStatus;
  enabled: boolean;
  muted: boolean;
  /** 0–100. */
  volume: number;
  playing: boolean;
  message: string | null;
}

export type AudioContextFactory = () => AudioContext;

function browserAudioContextFactory(): AudioContext {
  const audioWindow = window as Window & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextConstructor =
    audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error('Web Audio is not supported in this browser.');
  }
  return new AudioContextConstructor();
}

export function audioStatusLabel(snapshot: AudioSnapshot): string {
  if (snapshot.muted) return 'Sound muted';
  switch (snapshot.status) {
    case 'ready':
      return 'Sound enabled';
    case 'locked':
      return 'Enable sound';
    case 'blocked':
      return 'Audio blocked';
    case 'unsupported':
      return 'Audio unsupported';
    case 'off':
      return 'Sound off';
  }
}

export function audioStatusTone(snapshot: AudioSnapshot): StatusTone {
  if (snapshot.muted) return 'neutral';
  switch (snapshot.status) {
    case 'ready':
      return 'teal';
    case 'locked':
      return 'amber';
    case 'blocked':
    case 'unsupported':
      return 'red';
    case 'off':
      return 'neutral';
  }
}

const BLOCKED_MESSAGE =
  'The browser blocked audio. Visual monitoring continues; select Enable sound after interacting with the page.';
const LOCKED_MESSAGE =
  'Sound is configured, but this browser requires another click before audio can play.';

interface ActiveNode {
  oscillator: OscillatorNode;
  gain: GainNode;
}

/**
 * Web Audio alert output. AudioContext creation/resume only happens from an
 * explicit `enable`/`testSound` call so Safari autoplay rules are respected.
 * Visual monitoring never depends on this manager succeeding.
 */
export class AudioManager {
  private readonly factory: AudioContextFactory;
  private readonly listeners = new Set<(state: AudioSnapshot) => void>();
  private context: AudioContext | null = null;
  private activeNodes: ActiveNode[] = [];
  private disposed = false;
  private state: AudioSnapshot = {
    status: 'off',
    enabled: false,
    muted: false,
    volume: 70,
    playing: false,
    message: 'Sound alerts are off.',
  };

  constructor(factory: AudioContextFactory = browserAudioContextFactory) {
    this.factory = factory;
  }

  getState(): AudioSnapshot {
    return {...this.state};
  }

  subscribe(listener: (state: AudioSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Applies persisted preferences without attempting to unlock audio. */
  setPreferences(preferences: Partial<SoundSettings>): void {
    const wasMuted = this.state.muted;
    this.state = {
      ...this.state,
      enabled: preferences.enabled ?? this.state.enabled,
      muted: preferences.muted ?? this.state.muted,
      volume:
        preferences.volume === undefined
          ? this.state.volume
          : Math.max(0, Math.min(100, Math.round(preferences.volume))),
    };

    if (this.state.muted && !wasMuted) this.stop();

    if (!this.state.enabled) {
      this.state = {
        ...this.state,
        status: 'off',
        message: 'Sound alerts are off.',
      };
    } else if (this.state.muted) {
      this.state = {
        ...this.state,
        message: 'Sound is muted; visual monitoring continues.',
      };
    } else if (this.context?.state === 'running') {
      this.state = {...this.state, status: 'ready', message: null};
    } else if (this.state.status !== 'blocked') {
      this.state = {...this.state, status: 'locked', message: LOCKED_MESSAGE};
    }
    this.emit();
  }

  /** Must be called from a user gesture for Safari/iOS unlock behaviour. */
  async enable(): Promise<AudioSnapshot> {
    if (this.disposed) return this.getState();

    try {
      if (!this.context || this.context.state === 'closed') {
        this.context = this.factory();
      }
      if (this.context.state !== 'running') {
        await this.context.resume();
      }
      if (this.context.state === 'running') {
        this.state = {
          ...this.state,
          enabled: true,
          status: 'ready',
          message: this.state.muted
            ? 'Sound is muted; visual monitoring continues.'
            : null,
        };
      } else {
        this.state = {...this.state, status: 'blocked', message: BLOCKED_MESSAGE};
      }
    } catch (error) {
      const unsupported =
        error instanceof Error && /not supported|unsupported/i.test(error.message);
      this.state = {
        ...this.state,
        status: unsupported ? 'unsupported' : 'blocked',
        message: unsupported
          ? 'This browser does not support Web Audio. Visual monitoring continues.'
          : BLOCKED_MESSAGE,
      };
    }
    this.emit();
    return this.getState();
  }

  /** Existing eye-closure pattern; repeated calls never layer sounds. */
  playAlert(): void {
    this.playPattern([
      {frequency: 880, offset: 0, duration: 0.12},
      {frequency: 660, offset: 0.2, duration: 0.16},
    ]);
  }

  /** Distinct, non-overlapping pattern for a possible-yawn alert. */
  playYawnAlert(): void {
    this.playPattern([
      {frequency: 620, offset: 0, duration: 0.14},
      {frequency: 920, offset: 0.2, duration: 0.18},
    ]);
  }

  private playPattern(
    pattern: readonly {frequency: number; offset: number; duration: number}[],
  ): void {
    if (this.disposed || this.state.muted || !this.state.enabled) return;
    if (!this.context || this.context.state !== 'running') {
      this.state = {
        ...this.state,
        status: this.context ? 'blocked' : 'locked',
        message: this.context ? BLOCKED_MESSAGE : LOCKED_MESSAGE,
      };
      this.emit();
      return;
    }

    // Single owner of active nodes: a new alert always stops the previous one.
    this.stopNodes();
    const context = this.context;
    const start = context.currentTime;
    const peak = Math.pow(this.state.volume / 100, 2) * 0.18;

    this.state = {...this.state, playing: true, status: 'ready', message: null};
    try {
      for (const tone of pattern) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const beginsAt = start + tone.offset;
        const endsAt = beginsAt + tone.duration;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(tone.frequency, beginsAt);
        gain.gain.setValueAtTime(0, beginsAt);
        gain.gain.linearRampToValueAtTime(peak, beginsAt + 0.012);
        gain.gain.setValueAtTime(peak, Math.max(beginsAt + 0.012, endsAt - 0.02));
        gain.gain.linearRampToValueAtTime(0, endsAt);
        oscillator.connect(gain);
        gain.connect(context.destination);
        this.activeNodes.push({oscillator, gain});
        oscillator.onended = () => this.handleNodeEnded(oscillator);
        oscillator.start(beginsAt);
        oscillator.stop(endsAt);
      }
    } catch {
      this.stopNodes();
      this.state = {
        ...this.state,
        playing: false,
        status: 'blocked',
        message: BLOCKED_MESSAGE,
      };
    }
    this.emit();
  }

  async testSound(kind: AlertSoundKind = 'eye-closure'): Promise<AudioSnapshot> {
    if (this.disposed || this.state.muted) return this.getState();
    this.setPreferences({enabled: true});
    const state = await this.enable();
    if (state.status === 'ready') {
      if (kind === 'possible-yawn') this.playYawnAlert();
      else this.playAlert();
    }
    return this.getState();
  }

  /** Stops any active sound; safe to call on every monitoring interruption. */
  stop(): void {
    this.stopNodes();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopNodes();
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.listeners.clear();
  }

  private handleNodeEnded(oscillator: OscillatorNode): void {
    this.activeNodes = this.activeNodes.filter(
      (node) => node.oscillator !== oscillator,
    );
    if (this.activeNodes.length === 0 && this.state.playing) {
      this.state = {...this.state, playing: false};
      this.emit();
    }
  }

  private stopNodes(): void {
    const nodes = this.activeNodes;
    this.activeNodes = [];
    for (const {oscillator, gain} of nodes) {
      oscillator.onended = null;
      try {
        oscillator.stop();
      } catch {
        // A node that has already ended cannot be stopped again.
      }
      try {
        oscillator.disconnect();
        gain.disconnect();
      } catch {
        // Disconnect is best-effort; the context owns the graph.
      }
    }
    if (this.state.playing) {
      this.state = {...this.state, playing: false};
      this.emit();
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.getState());
  }
}
