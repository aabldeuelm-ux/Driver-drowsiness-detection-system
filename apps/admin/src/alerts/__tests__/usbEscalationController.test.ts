import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {HardwareAlertOutcome} from '../esp32HardwareAlerts';
import {
  ESCALATION_AFTER_MS,
  USB_ESCALATION_RELEASE_ENABLED,
  UsbEscalationController,
  hasFreshEscalationClosure,
  type EscalationCommand,
  type UsbEscalationSnapshot,
} from '../usbEscalationController';

const RENEW_MS = 100;
const FRESHNESS_MS = 500;

function ok(): HardwareAlertOutcome {
  return {
    ok: true,
    aborted: false,
    message: 'acknowledged',
  };
}

function rejected(): HardwareAlertOutcome {
  return {
    ok: false,
    aborted: false,
    message: 'USB alert device rejected the command (NOT_ACTIVE).',
  };
}

function makeSnapshot(
  nowMs: number,
  change?: (snapshot: UsbEscalationSnapshot) => void,
): UsbEscalationSnapshot {
  const snapshot: UsbEscalationSnapshot = {
    usbConnected: true,
    escalationSupported: true,
    hardwareAlertsEnabled: true,
    hardwareTransport: 'usb',
    cameraLive: true,
    selectedCamera: 'this-device',
    cameraKey: 'camera-a',
    monitoring: {
      status: 'prolonged-closure',
      active: true,
      reason: null,
      closureMs: ESCALATION_AFTER_MS,
    },
    tracking: {
      phase: 'running',
      facePresence: 'single',
      staleReason: null,
      lastInferenceCompletedAtMs: nowMs,
      calibrationStep: 'idle',
    },
  };
  change?.(snapshot);
  return snapshot;
}

interface Harness {
  controller: UsbEscalationController;
  sent: EscalationCommand[];
  statuses: {active: boolean; message: string | null}[];
  snapshot: UsbEscalationSnapshot;
  nowMs: number;
}

function makeHarness(
  sendOverride?: (command: EscalationCommand) => Promise<HardwareAlertOutcome>,
): Harness {
  const sent: EscalationCommand[] = [];
  const statuses: {active: boolean; message: string | null}[] = [];
  let nowMs = 10_000;
  let snapshot = makeSnapshot(nowMs);

  const controller = new UsbEscalationController({
    send: async (command) => {
      sent.push(command);
      return sendOverride ? sendOverride(command) : ok();
    },
    now: () => nowMs,
    renewMs: RENEW_MS,
    freshnessMs: FRESHNESS_MS,
    onStatus: (status) => statuses.push(status),
  });

  return {
    controller,
    sent,
    statuses,
    get snapshot() {
      return snapshot;
    },
    set snapshot(value: UsbEscalationSnapshot) {
      snapshot = value;
    },
    get nowMs() {
      return nowMs;
    },
    set nowMs(value: number) {
      nowMs = value;
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** Advances timers and simulates fresh inference frames arriving each step. */
async function advanceWithFrames(harness: Harness, ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    const delta = Math.min(50, ms - elapsed);
    vi.advanceTimersByTime(delta);
    harness.nowMs += delta;
    const current = harness.snapshot;
    harness.snapshot = {
      ...current,
      tracking: {
        ...current.tracking,
        lastInferenceCompletedAtMs: harness.nowMs,
      },
    };
    harness.controller.update(harness.snapshot);
    await flush();
  }
}

describe('USB escalation controller', () => {
  it('keeps the unverified five-second escalation disabled in this release', () => {
    expect(USB_ESCALATION_RELEASE_ENABLED).toBe(false);
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not escalate before five seconds of continuous closure', async () => {
    const harness = makeHarness();
    const snapshot = makeSnapshot(harness.nowMs, (value) => {
      value.monitoring.closureMs = ESCALATION_AFTER_MS - 1;
      value.monitoring.status = 'eyes-closed';
    });
    harness.snapshot = snapshot;
    harness.controller.update(snapshot);

    expect(harness.sent).toEqual([]);
    await advanceWithFrames(harness, 600);
    expect(harness.sent).toEqual([]);
  });

  it('starts at five seconds and renews only while the lease is valid', async () => {
    const harness = makeHarness();
    harness.snapshot = makeSnapshot(harness.nowMs);
    harness.controller.update(harness.snapshot);

    expect(harness.sent).toEqual(['START']);
    expect(harness.statuses.at(-1)).toMatchObject({active: true});

    await advanceWithFrames(harness, 350);
    expect(harness.sent).toEqual(['START', 'RENEW', 'RENEW', 'RENEW']);
    expect(harness.controller.isActive()).toBe(true);
  });

  it.each([
    ['eyes reopen', (snapshot: UsbEscalationSnapshot) => {
      snapshot.monitoring.status = 'eyes-open';
    }],
    ['monitoring stops', (snapshot: UsbEscalationSnapshot) => {
      snapshot.monitoring.active = false;
    }],
    ['tracking stops', (snapshot: UsbEscalationSnapshot) => {
      snapshot.tracking.phase = 'paused';
    }],
    ['calibration starts', (snapshot: UsbEscalationSnapshot) => {
      snapshot.tracking.calibrationStep = 'collecting';
    }],
    ['camera changes', (snapshot: UsbEscalationSnapshot) => {
      snapshot.cameraKey = 'camera-b';
    }],
    ['frames become stale', (snapshot: UsbEscalationSnapshot) => {
      snapshot.tracking.staleReason = 'camera-frames-stopped';
    }],
    ['face tracking is lost', (snapshot: UsbEscalationSnapshot) => {
      snapshot.tracking.facePresence = 'none';
    }],
    ['USB disconnects', (snapshot: UsbEscalationSnapshot) => {
      snapshot.usbConnected = false;
    }],
    ['the toggle is disabled', (snapshot: UsbEscalationSnapshot) => {
      snapshot.hardwareAlertsEnabled = false;
    }],
    ['old firmware is connected', (snapshot: UsbEscalationSnapshot) => {
      snapshot.escalationSupported = false;
    }],
  ])('stops immediately when %s', async (_label, change) => {
    const harness = makeHarness();
    harness.snapshot = makeSnapshot(harness.nowMs);
    harness.controller.update(harness.snapshot);
    expect(harness.sent).toEqual(['START']);

    harness.snapshot = makeSnapshot(harness.nowMs, change);
    harness.controller.update(harness.snapshot);

    expect(harness.sent).toEqual(['START', 'STOP']);
    expect(harness.controller.isActive()).toBe(false);
    expect(harness.statuses.at(-1)?.active).toBe(false);
    const sentAtStop = harness.sent.length;
    await advanceWithFrames(harness, 500);
    expect(harness.sent).toHaveLength(sentAtStop);
  });

  it('never treats missing frames as closed eyes', async () => {
    const noFrame = makeSnapshot(10_000, (snapshot) => {
      snapshot.tracking.lastInferenceCompletedAtMs = null;
    });
    expect(hasFreshEscalationClosure(noFrame, 10_000, FRESHNESS_MS)).toBe(false);

    const harness = makeHarness();
    harness.snapshot = makeSnapshot(harness.nowMs);
    harness.controller.update(harness.snapshot);
    expect(harness.sent).toEqual(['START']);

    // Timers advance but no new inference frame arrives. Once the freshness
    // window is exceeded, the browser stops renewing and requests a stop.
    for (let elapsed = 0; elapsed < FRESHNESS_MS + 100; elapsed += 50) {
      const delta = Math.min(50, FRESHNESS_MS + 100 - elapsed);
      vi.advanceTimersByTime(delta);
      harness.nowMs += delta;
      await flush();
    }

    expect(harness.sent).toContain('STOP');
    expect(harness.controller.isActive()).toBe(false);
    const sentAfterStop = harness.sent.length;
    await advanceWithFrames(harness, 400);
    expect(harness.sent).toHaveLength(sentAfterStop);
  });

  it('stops on a rejected renewal without retrying the same closure', async () => {
    const harness = makeHarness((command) =>
      command === 'RENEW' ? Promise.resolve(rejected()) : Promise.resolve(ok()),
    );
    harness.snapshot = makeSnapshot(harness.nowMs);
    harness.controller.update(harness.snapshot);

    await advanceWithFrames(harness, 200);
    expect(harness.sent).toEqual(['START', 'RENEW', 'STOP']);
    expect(harness.controller.isActive()).toBe(false);
  });

  it('does not replay escalation after a USB reconnect', async () => {
    const harness = makeHarness();
    harness.snapshot = makeSnapshot(harness.nowMs);
    harness.controller.update(harness.snapshot);
    harness.snapshot = makeSnapshot(harness.nowMs, (snapshot) => {
      snapshot.usbConnected = false;
    });
    harness.controller.update(harness.snapshot);
    expect(harness.sent).toEqual(['START', 'STOP']);

    harness.snapshot = makeSnapshot(harness.nowMs);
    harness.controller.update(harness.snapshot);
    expect(harness.sent).toEqual(['START', 'STOP']);

    // Only a new closure episode can arm escalation again.
    harness.snapshot = makeSnapshot(harness.nowMs, (snapshot) => {
      snapshot.monitoring.status = 'eyes-open';
      snapshot.monitoring.closureMs = 0;
    });
    harness.controller.update(harness.snapshot);
    harness.snapshot = makeSnapshot(harness.nowMs);
    harness.controller.update(harness.snapshot);
    expect(harness.sent).toEqual(['START', 'STOP', 'START']);
  });
});
