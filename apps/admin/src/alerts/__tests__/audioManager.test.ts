import {describe, expect, it, vi} from 'vitest';
import {AudioManager} from '../audioManager';

class FakeParam {
  readonly calls: Array<{method: string; value: number; time: number}> = [];

  setValueAtTime(value: number, time: number): this {
    this.calls.push({method: 'set', value, time});
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.calls.push({method: 'ramp', value, time});
    return this;
  }
}

class FakeOscillator {
  type = 'sine';
  readonly frequency = new FakeParam();
  onended: (() => void) | null = null;
  readonly startCalls: number[] = [];
  readonly stopCalls: Array<number | undefined> = [];
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();

  start(at = 0): void {
    this.startCalls.push(at);
  }

  stop(at?: number): void {
    this.stopCalls.push(at);
  }
}

class FakeGain {
  readonly gain = new FakeParam();
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
}

class FakeAudioContext {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = {} as AudioNode;
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  readonly resume = vi.fn(async () => {
    if (this.resumeError) throw this.resumeError;
    this.state = 'running';
  });
  readonly close = vi.fn(async () => {
    this.state = 'closed';
  });
  resumeError: Error | null = null;

  createOscillator(): OscillatorNode {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator as unknown as OscillatorNode;
  }

  createGain(): GainNode {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain as unknown as GainNode;
  }
}

function createHarness() {
  const context = new FakeAudioContext();
  const factory = vi.fn(() => context as unknown as AudioContext);
  const manager = new AudioManager(factory);
  return {context, factory, manager};
}

describe('AudioManager', () => {
  it('does not create an AudioContext until an explicit user action', async () => {
    const {context, factory, manager} = createHarness();

    manager.setPreferences({enabled: true});
    expect(manager.getState().status).toBe('locked');
    expect(factory).not.toHaveBeenCalled();

    await manager.enable();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(manager.getState().status).toBe('ready');
  });

  it('plays a short two-tone pattern and never layers repeated alerts', async () => {
    const {context, manager} = createHarness();
    await manager.enable();

    manager.playAlert();
    expect(context.oscillators).toHaveLength(2);
    expect(context.oscillators.map((oscillator) => oscillator.frequency.calls[0]?.value)).toEqual([
      880, 660,
    ]);
    expect(manager.getState().playing).toBe(true);

    const firstOscillators = [...context.oscillators];
    manager.playAlert();
    expect(context.oscillators).toHaveLength(4);
    expect(firstOscillators.every((oscillator) => oscillator.stopCalls.some((at) => at === undefined))).toBe(
      true,
    );

    manager.stop();
    expect(manager.getState().playing).toBe(false);
    expect(context.oscillators.at(-1)?.stopCalls.some((at) => at === undefined)).toBe(true);
  });

  it('uses a distinct yawn pattern and stops an eye sound before playing it', async () => {
    const {context, manager} = createHarness();
    await manager.enable();

    manager.playAlert();
    const eyeOscillators = [...context.oscillators];
    expect(eyeOscillators.map((oscillator) => oscillator.frequency.calls[0]?.value)).toEqual([
      880, 660,
    ]);

    manager.playYawnAlert();
    expect(context.oscillators).toHaveLength(4);
    expect(eyeOscillators.every((oscillator) => oscillator.stopCalls.some((at) => at === undefined))).toBe(
      true,
    );
    expect(context.oscillators.slice(2).map((oscillator) => oscillator.frequency.calls[0]?.value)).toEqual([
      620, 920,
    ]);

    manager.playAlert();
    const yawnOscillators = context.oscillators.slice(2, 4);
    expect(yawnOscillators.every((oscillator) => oscillator.stopCalls.some((at) => at === undefined))).toBe(
      true,
    );
    expect(manager.getState().playing).toBe(true);
  });

  it('stops active sound when muted and suppresses later alerts', async () => {
    const {context, manager} = createHarness();
    await manager.enable();
    manager.playAlert();

    manager.setPreferences({muted: true});
    expect(manager.getState().playing).toBe(false);
    expect(manager.getState().message).toContain('muted');

    manager.playAlert();
    expect(context.oscillators).toHaveLength(2);
  });

  it('uses the configured volume when building gain ramps', async () => {
    const {context, manager} = createHarness();
    manager.setPreferences({volume: 50});
    await manager.enable();
    manager.playAlert();

    const peaks = context.gains[0]?.gain.calls.filter((call) => call.method === 'ramp') ?? [];
    expect(peaks).toHaveLength(2);
    expect(peaks[0]?.value).toBeCloseTo(Math.pow(0.5, 2) * 0.18);
  });

  it('reports blocked audio without throwing and keeps preferences', async () => {
    const {context, manager} = createHarness();
    context.resumeError = new Error('NotAllowedError');

    const state = await manager.enable();
    expect(state.status).toBe('blocked');
    expect(state.message).toContain('Visual monitoring continues');

    manager.playAlert();
    expect(context.oscillators).toHaveLength(0);
  });

  it('reports unsupported browsers distinctly', async () => {
    const manager = new AudioManager(() => {
      throw new Error('Web Audio is not supported in this browser.');
    });

    const state = await manager.enable();
    expect(state.status).toBe('unsupported');
    expect(state.message).toContain('does not support Web Audio');
  });

  it('lets Test sound unlock and play in one user action', async () => {
    const {context, manager} = createHarness();

    const state = await manager.testSound();
    expect(state.status).toBe('ready');
    expect(state.enabled).toBe(true);
    expect(context.oscillators).toHaveLength(2);
  });

  it('does not unlock or play Test sound while muted', async () => {
    const {context, factory, manager} = createHarness();
    manager.setPreferences({muted: true});

    await manager.testSound();
    expect(factory).not.toHaveBeenCalled();
    expect(context.oscillators).toHaveLength(0);
  });
});
