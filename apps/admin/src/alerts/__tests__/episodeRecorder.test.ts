import {beforeEach, describe, expect, it, vi} from 'vitest';
import {EYE_CLOSURE_POPUP_MESSAGE, type AlertPopup} from '../alertPopup';
import type {AudioManager} from '../audioManager';
import {EpisodeRecorder, type EpisodeSnapshot} from '../episodeRecorder';
import {
  MemoryEventStore,
  type ClosureEvent,
  type EventStore,
} from '../eventStore';
import type {MonitoringInterruption, MonitoringStatus} from '../../vision/eyeClosureMonitor';

interface SnapshotOptions {
  active?: boolean;
  closureMs?: number;
  reason?: MonitoringInterruption | null;
  trackingRunning?: boolean;
  cameraLive?: boolean;
  cameraSource?: EpisodeSnapshot['cameraSource'];
}

function snapshot(
  status: MonitoringStatus,
  options: SnapshotOptions = {},
): EpisodeSnapshot {
  return {
    monitoring: {
      status,
      active: options.active ?? true,
      closureMs: options.closureMs ?? 0,
      reason: options.reason ?? null,
    },
    trackingRunning: options.trackingRunning ?? true,
    cameraLive: options.cameraLive ?? true,
    cameraSource: options.cameraSource ?? 'this-device',
    configuredDurationMs: 800,
  };
}

function createHarness(store: EventStore = new MemoryEventStore()) {
  let nowMs = Date.parse('2026-01-01T00:00:00.000Z');
  let idNumber = 0;
  const playAlert = vi.fn();
  const stop = vi.fn();
  const audio = {
    playAlert,
    stop,
  } as unknown as AudioManager;
  const onError = vi.fn();
  const onEpisodeStart = vi.fn<(event: ClosureEvent) => void>();
  const onPopup = vi.fn<(popup: AlertPopup) => void>();
  const recorder = new EpisodeRecorder({
    store,
    audio,
    sessionId: 'session-1',
    now: () => nowMs,
    createId: () => `event-${++idNumber}`,
    onError,
    onEpisodeStart,
    onPopup,
  });

  return {
    store,
    audio,
    playAlert,
    stop,
    onError,
    onEpisodeStart,
    onPopup,
    recorder,
    advance: (ms: number) => {
      nowMs += ms;
    },
    setNow: (ms: number) => {
      nowMs = ms;
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
}

async function eventsFrom(store: EventStore): Promise<ClosureEvent[]> {
  return store.listEvents();
}

describe('EpisodeRecorder', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it('creates one event and one sound per episode, then rearms after reopening', async () => {
    const {recorder, audio, store, advance} = harness;

    recorder.handle(snapshot('eyes-open'));
    recorder.handle(snapshot('eyes-closed', {closureMs: 400}));
    expect(await eventsFrom(store)).toHaveLength(0);
    expect(audio.playAlert).not.toHaveBeenCalled();

    advance(800);
    recorder.handle(snapshot('prolonged-closure', {closureMs: 800}));
    for (const closureMs of [900, 1000, 1100, 1200]) {
      advance(100);
      recorder.handle(snapshot('prolonged-closure', {closureMs}));
    }
    await flush();

    expect(await eventsFrom(store)).toHaveLength(1);
    expect(audio.playAlert).toHaveBeenCalledTimes(1);
    expect((await eventsFrom(store))[0]).toMatchObject({
      id: 'event-1',
      sessionId: 'session-1',
      cameraSource: 'this-device',
      configuredDurationMs: 800,
      observedDurationMs: 800,
      endedAt: null,
      endReason: null,
    });

    advance(50);
    recorder.handle(snapshot('eyes-open'));
    await flush();
    expect((await eventsFrom(store))[0]).toMatchObject({
      endReason: 'eyes-opened',
      observedDurationMs: 1200,
    });
    expect(audio.playAlert).toHaveBeenCalledTimes(1);

    advance(800);
    recorder.handle(snapshot('prolonged-closure', {closureMs: 800}));
    await flush();
    expect(await eventsFrom(store)).toHaveLength(2);
    expect(audio.playAlert).toHaveBeenCalledTimes(2);
    expect(harness.onError).not.toHaveBeenCalled();
  });

  it('fires onEpisodeStart once per new episode after browser audio', async () => {
    const {recorder, playAlert, onEpisodeStart, advance} = harness;

    recorder.handle(snapshot('eyes-open'));
    recorder.handle(snapshot('eyes-closed', {closureMs: 400}));
    expect(onEpisodeStart).not.toHaveBeenCalled();

    advance(800);
    recorder.handle(snapshot('prolonged-closure', {closureMs: 800}));
    recorder.handle(snapshot('prolonged-closure', {closureMs: 900}));
    expect(onEpisodeStart).toHaveBeenCalledTimes(1);
    expect(onEpisodeStart).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'event-1',
        cameraSource: 'this-device',
        type: 'prolonged-eye-closure',
      }),
    );
    expect(playAlert).toHaveBeenCalledTimes(1);
    expect(playAlert.mock.invocationCallOrder[0]).toBeLessThan(
      onEpisodeStart.mock.invocationCallOrder[0],
    );

    // A tracking gap must not re-fire the callback for the same physical closure.
    advance(5000);
    recorder.handle(snapshot('unavailable', {trackingRunning: false}));
    recorder.handle(snapshot('prolonged-closure', {closureMs: 900}));
    expect(onEpisodeStart).toHaveBeenCalledTimes(1);

    recorder.handle(snapshot('eyes-open'));
    advance(800);
    recorder.handle(snapshot('prolonged-closure', {closureMs: 800}));
    expect(onEpisodeStart).toHaveBeenCalledTimes(2);
  });

  it('emits one dismissible eye pop-up per episode without replaying the sound', async () => {
    const {recorder, onPopup, playAlert, advance} = harness;

    recorder.handle(snapshot('eyes-open'));
    advance(800);
    recorder.handle(snapshot('prolonged-closure', {closureMs: 800}));
    recorder.handle(snapshot('prolonged-closure', {closureMs: 900}));
    recorder.handle(snapshot('eyes-open'));

    expect(onPopup).toHaveBeenCalledTimes(1);
    expect(onPopup).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'popup-event-1',
        type: 'prolonged-eye-closure',
        message: EYE_CLOSURE_POPUP_MESSAGE,
        durationMs: 800,
      }),
    );
    expect(playAlert).toHaveBeenCalledTimes(1);
    expect(onPopup.mock.invocationCallOrder[0]).toBeGreaterThan(
      playAlert.mock.invocationCallOrder[0]!,
    );
  });

  it('updates the same event once when tracking interrupts, without counting gap time', async () => {
    const {recorder, audio, store, advance} = harness;

    recorder.handle(snapshot('eyes-open'));
    recorder.handle(snapshot('prolonged-closure', {closureMs: 800}));
    await flush();

    advance(5000);
    recorder.handle(
      snapshot('unavailable', {
        closureMs: 0,
        reason: 'page-hidden',
        trackingRunning: false,
      }),
    );
    await flush();

    let events = await eventsFrom(store);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'event-1',
      observedDurationMs: 800,
      endReason: 'tracking-interrupted',
    });
    expect(audio.stop).toHaveBeenCalledTimes(1);

    // A resumed prolonged state without an observed reopen must not re-alert.
    recorder.handle(snapshot('prolonged-closure', {closureMs: 900}));
    await flush();
    expect(await eventsFrom(store)).toHaveLength(1);
    expect(audio.playAlert).toHaveBeenCalledTimes(1);

    recorder.handle(snapshot('eyes-open'));
    advance(800);
    recorder.handle(snapshot('prolonged-closure', {closureMs: 800}));
    await flush();
    events = await eventsFrom(store);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.id)).toEqual(['event-2', 'event-1']);
  });

  it('ends an active episode as monitoring-stopped and silences the alert', async () => {
    const {recorder, audio, store} = harness;

    recorder.handle(snapshot('prolonged-closure', {closureMs: 800}));
    recorder.handle(snapshot('ready', {active: false, closureMs: 0}));
    await flush();

    expect((await eventsFrom(store))[0]?.endReason).toBe('monitoring-stopped');
    expect(audio.stop).toHaveBeenCalledTimes(1);
  });

  it('ends an active episode as tracking-interrupted when the camera stops', async () => {
    const {recorder, store} = harness;

    recorder.handle(snapshot('prolonged-closure', {closureMs: 800}));
    recorder.handle(snapshot('unavailable', {cameraLive: false, reason: 'camera-changed'}));
    await flush();

    expect((await eventsFrom(store))[0]?.endReason).toBe('tracking-interrupted');
  });

  it('treats a camera-source switch as an interruption even if prolonged state persists', async () => {
    const {recorder, store} = harness;

    recorder.handle(snapshot('prolonged-closure', {closureMs: 800}));
    recorder.handle(
      snapshot('prolonged-closure', {closureMs: 900, cameraSource: 'esp32-cam'}),
    );
    await flush();

    expect((await eventsFrom(store))[0]).toMatchObject({
      endReason: 'tracking-interrupted',
      observedDurationMs: 900,
    });
  });

  it('reports storage failures honestly while still playing the sound', async () => {
    const store = {
      createEvent: vi.fn().mockRejectedValue(new Error('QuotaExceededError')),
      updateEvent: vi.fn().mockRejectedValue(new Error('QuotaExceededError')),
      listEvents: vi.fn().mockResolvedValue([]),
      clearEvents: vi.fn().mockResolvedValue(undefined),
      getSettings: vi.fn().mockResolvedValue(null),
      saveSettings: vi.fn().mockResolvedValue(undefined),
      clearAll: vi.fn().mockResolvedValue(undefined),
    } satisfies EventStore;
    const failing = createHarness(store);

    failing.recorder.handle(snapshot('prolonged-closure', {closureMs: 800}));
    failing.recorder.handle(snapshot('eyes-open'));
    await flush();

    expect(failing.audio.playAlert).toHaveBeenCalledTimes(1);
    expect(failing.onError).toHaveBeenCalledWith(
      'The alert could not be saved in this browser.',
    );
    expect(failing.onError).toHaveBeenCalledWith(
      'A saved alert could not be updated when the episode ended.',
    );
  });

  it('closes an in-flight episode on a page-level interruption', async () => {
    const {recorder, audio, store} = harness;

    recorder.handle(snapshot('prolonged-closure', {closureMs: 800}));
    recorder.finishActive('tracking-interrupted');
    await flush();

    expect((await eventsFrom(store))[0]).toMatchObject({
      endReason: 'tracking-interrupted',
      observedDurationMs: 800,
    });
    expect(audio.stop).toHaveBeenCalledTimes(1);
    expect(audio.playAlert).toHaveBeenCalledTimes(1);
  });

  it('never starts a new event before an eye-open state is observed', async () => {
    const {recorder, store, audio} = harness;

    recorder.handle(snapshot('prolonged-closure', {closureMs: 800}));
    recorder.handle(snapshot('eyes-closed', {closureMs: 900}));
    recorder.handle(snapshot('prolonged-closure', {closureMs: 1000}));
    await flush();

    expect(await eventsFrom(store)).toHaveLength(1);
    expect(audio.playAlert).toHaveBeenCalledTimes(1);
  });
});
