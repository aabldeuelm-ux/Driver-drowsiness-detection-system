import {describe, expect, it, vi} from 'vitest';
import {
  hardwareAlertTargets,
  sendCoordinatedHardwareAlerts,
  sendHardwareAlerts,
  type HardwareAlertTargets,
  type HardwareAlertSession,
} from '../esp32HardwareAlerts';

function response(ok: boolean, status: number): Pick<Response, 'ok' | 'status'> {
  return {ok, status};
}

describe('hardwareAlertTargets', () => {
  it('derives both bounded endpoints from an explicit alert device URL', () => {
    expect(
      hardwareAlertTargets('http://192.168.1.50:80/?token=ignored#ignored'),
    ).toEqual({
      led: 'http://192.168.1.50/led_test',
      buzzer: 'http://192.168.1.50/buzzer_test',
    });
  });

  it('rejects empty, credential-bearing, and non-HTTP URLs', () => {
    expect(hardwareAlertTargets(null)).toBeNull();
    expect(hardwareAlertTargets('')).toBeNull();
    expect(hardwareAlertTargets('http://user:pass@192.168.1.50/')).toBeNull();
    expect(hardwareAlertTargets('ftp://192.168.1.50/')).toBeNull();
    expect(hardwareAlertTargets('not a url')).toBeNull();
  });
});

describe('sendHardwareAlerts', () => {
  const targets: HardwareAlertTargets = {
    led: 'http://192.168.1.50/led_test',
    buzzer: 'http://192.168.1.50/buzzer_test',
  };

  it('submits both commands once with CORS-safe GET options', async () => {
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => response(true, 200));

    const outcome = await sendHardwareAlerts(targets, {fetchFn});

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls.map((call) => call[0])).toEqual([
      targets.led,
      targets.buzzer,
    ]);
    for (const [, init] of fetchFn.mock.calls) {
      expect(init).toMatchObject({
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(outcome.ok).toBe(true);
    expect(outcome.aborted).toBe(false);
    expect(outcome.message).toContain('accepted by the alert device');
    expect(outcome.message).toContain('physical activation not confirmed');
  });

  it('reports failures visibly without retrying or claiming activation', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(response(true, 200))
      .mockResolvedValueOnce(response(false, 503));

    const outcome = await sendHardwareAlerts(targets, {fetchFn});

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(outcome.ok).toBe(false);
    expect(outcome.aborted).toBe(false);
    expect(outcome.message).toContain('buzzer failed (HTTP 503)');
    expect(outcome.message).toContain('Monitoring continues');
    expect(outcome.message).toContain('no retry queued');
    expect(outcome.message).not.toContain('activated');
  });

  it('treats an aborted in-flight command as canceled, not a failure to replay', async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      controller.abort();
      const signal = init.signal;
      if (signal?.aborted) throw new Error('aborted');
      return response(true, 200);
    });

    const outcome = await sendHardwareAlerts(targets, {
      fetchFn,
      signal: controller.signal,
    });

    expect(outcome.aborted).toBe(true);
    expect(outcome.message).toContain('no retry was queued');
    // The canceled LED command supersedes the buzzer command; no stale retry.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('runs a bounded command handoff and resumes host work', async () => {
    const events: string[] = [];
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => {
      events.push('command');
      return response(true, 200);
    });
    const session: HardwareAlertSession = {
      quiesce: async () => {
        events.push('quiesce');
      },
      resume: () => events.push('resume'),
      isCurrent: () => true,
    };

    const outcome = await sendCoordinatedHardwareAlerts(targets, session, {
      fetchFn,
      settleMs: 0,
    });

    expect(outcome.ok).toBe(true);
    expect(events).toEqual(['quiesce', 'command', 'command', 'resume']);
  });

  it('never sends commands from a stale session and still resumes polling', async () => {
    const events: string[] = [];
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => response(true, 200));
    const session: HardwareAlertSession = {
      quiesce: async () => {
        events.push('quiesce');
      },
      resume: () => events.push('resume'),
      isCurrent: () => false,
    };

    const outcome = await sendCoordinatedHardwareAlerts(targets, session, {fetchFn});

    expect(outcome.aborted).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});
