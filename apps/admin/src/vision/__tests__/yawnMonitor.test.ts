import {describe, expect, it} from 'vitest';
import {createYawnConfig, YawnMonitor, type YawnMonitorConfig} from '../yawnMonitor';

const config: YawnMonitorConfig = {
  openThreshold: 0.6,
  closeThreshold: 0.3,
  minDurationMs: 800,
  maxGapMs: 500,
};

function feed(
  monitor: YawnMonitor,
  samples: readonly {now: number; opening: number | null; valid?: boolean}[],
) {
  const events = [];
  for (const sample of samples) {
    const event = monitor.handle(sample);
    if (event) events.push(event);
  }
  return events;
}

describe('YawnMonitor', () => {
  it('does not alert for a brief mouth opening', () => {
    const monitor = new YawnMonitor(config);
    const events = feed(monitor, [
      {now: 0, opening: 0.8},
      {now: 300, opening: 0.8},
      {now: 600, opening: 0.2},
    ]);
    expect(events).toHaveLength(0);
    expect(monitor.getSnapshot().phase).toBe('idle');
  });

  it('emits one alert for a sustained opening and does not repeat while still open', () => {
    const monitor = new YawnMonitor(config);
    const events = feed(monitor, [
      {now: 0, opening: 0.7},
      {now: 400, opening: 0.75},
      {now: 900, opening: 0.8},
      {now: 1400, opening: 0.8},
      {now: 2000, opening: 0.75},
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({kind: 'yawn', startedAt: 0, durationMs: 900});
  });

  it('rearms only after the mouth returns below the lower threshold', () => {
    const monitor = new YawnMonitor(config);
    const events = feed(monitor, [
      {now: 0, opening: 0.8},
      {now: 400, opening: 0.8},
      {now: 900, opening: 0.8},
      {now: 1000, opening: 0.4},
      {now: 1400, opening: 0.8},
      {now: 1600, opening: 0.2},
      {now: 1700, opening: 0.8},
      {now: 2100, opening: 0.8},
      {now: 2600, opening: 0.8},
    ]);
    expect(events).toHaveLength(2);
    expect(events[1].startedAt).toBe(1700);
  });

  it('does not alert from sustained normal speaking between the thresholds', () => {
    const monitor = new YawnMonitor(config);
    const events = feed(monitor, [
      {now: 0, opening: 0.4},
      {now: 500, opening: 0.45},
      {now: 1000, opening: 0.42},
      {now: 1500, opening: 0.45},
    ]);
    expect(events).toHaveLength(0);
  });

  it('clears in-progress timing on invalid samples and explicit reset', () => {
    const monitor = new YawnMonitor(config);
    expect(
      monitor.handle({now: 0, opening: 0.8}),
    ).toBeNull();
    expect(monitor.handle({now: 300, opening: null})).toBeNull();
    expect(monitor.getSnapshot().phase).toBe('idle');

    monitor.handle({now: 1000, opening: 0.8});
    expect(
      monitor.handle({now: 1900, opening: 0.8, valid: false}),
    ).toBeNull();
    expect(monitor.getSnapshot().phase).toBe('idle');

    monitor.handle({now: 2000, opening: 0.8});
    monitor.reset();
    expect(monitor.getSnapshot()).toEqual({
      phase: 'idle',
      candidateSince: null,
      activeSince: null,
    });
    // A reset means the next sustained opening is a fresh episode.
    monitor.handle({now: 2400, opening: 0.8});
    monitor.handle({now: 2900, opening: 0.8});
    expect(monitor.handle({now: 3300, opening: 0.8})).toMatchObject({
      kind: 'yawn',
      startedAt: 2400,
    });
  });

  it('derives usable thresholds from a relaxed-mouth baseline', () => {
    const derived = createYawnConfig(0.12);
    expect(derived.openThreshold).toBeGreaterThan(derived.closeThreshold);
    expect(derived.openThreshold).toBeGreaterThan(0.12);
    expect(derived.minDurationMs).toBeGreaterThan(0);
  });
});
