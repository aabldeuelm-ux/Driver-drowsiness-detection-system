export type HardwareAlertLabel = 'LED' | 'Buzzer';

export interface HardwareAlertTargets {
  led: string;
  buzzer: string;
}

export interface HardwareAlertOutcome {
  ok: boolean;
  aborted: boolean;
  /** Describes command submission only; never claims physical activation. */
  message: string;
}

/**
 * Optional bounded handoff for hosts that need to pause their own work while
 * commands are submitted. The alert controller itself is camera-free; a session
 * check prevents a stale command from surviving a configuration change.
 */
export interface HardwareAlertSession {
  quiesce: () => Promise<void>;
  resume: () => void;
  isCurrent: () => boolean;
}

type HardwareAlertFetch = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status'>>;

interface SendHardwareAlertsOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  settleMs?: number;
  fetchFn?: HardwareAlertFetch;
}

const DEFAULT_TIMEOUT_MS = 2500;
const DEFAULT_SETTLE_MS = 250;

const ABORTED_OUTCOME: HardwareAlertOutcome = {
  ok: false,
  aborted: true,
  message: 'Hardware alert command canceled; no retry was queued.',
};

/**
 * Derives the bounded test endpoints from an explicitly configured alert
 * device URL. It is independent of the camera source. Credentials, query
 * strings, and fragments are never carried over.
 */
export function hardwareAlertTargets(
  alertDeviceUrl: string | null | undefined,
): HardwareAlertTargets | null {
  if (
    alertDeviceUrl === null ||
    alertDeviceUrl === undefined ||
    alertDeviceUrl.trim() === ''
  ) {
    return null;
  }

  const trimmed = alertDeviceUrl.trim();
  // Only an absolute URL is accepted; a relative value must never resolve
  // against the admin origin and accidentally target the local server.
  if (!/^https?:\/\//i.test(trimmed)) return null;

  try {
    const base = new URL(trimmed);
    if (base.protocol !== 'http:' && base.protocol !== 'https:') return null;
    if (base.username !== '' || base.password !== '') return null;

    const led = new URL(base.toString());
    led.pathname = '/led_test';
    led.search = '';
    led.hash = '';

    const buzzer = new URL(base.toString());
    buzzer.pathname = '/buzzer_test';
    buzzer.search = '';
    buzzer.hash = '';

    return {led: led.toString(), buzzer: buzzer.toString()};
  } catch {
    return null;
  }
}

function shortError(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim() !== '') {
    return cause.message.trim().slice(0, 120);
  }
  return 'network error';
}

interface CommandResult {
  label: HardwareAlertLabel;
  ok: boolean;
  aborted: boolean;
  detail: string;
}

async function sendOne(
  label: HardwareAlertLabel,
  url: string,
  options: SendHardwareAlertsOptions,
): Promise<CommandResult> {
  const externalSignal = options.signal;
  if (externalSignal?.aborted) {
    return {label, ok: false, aborted: true, detail: 'canceled'};
  }

  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', forwardAbort, {once: true});
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));

  try {
    const response = await (options.fetchFn ?? fetch)(url, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
    if (!response.ok) {
      return {label, ok: false, aborted: false, detail: `HTTP ${response.status}`};
    }
    return {label, ok: true, aborted: false, detail: 'accepted'};
  } catch (cause) {
    if (externalSignal?.aborted) {
      return {label, ok: false, aborted: true, detail: 'canceled'};
    }
    if (timedOut || controller.signal.aborted) {
      return {label, ok: false, aborted: false, detail: 'request timed out'};
    }
    return {label, ok: false, aborted: false, detail: shortError(cause)};
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
}

/**
 * Submits both one-shot alert-controller commands one at a time. Sequential
 * delivery keeps the result readable and avoids competing GETs on the device's
 * small web server. No retry is ever queued.
 */
export async function sendHardwareAlerts(
  targets: HardwareAlertTargets,
  options: SendHardwareAlertsOptions = {},
): Promise<HardwareAlertOutcome> {
  const led = await sendOne('LED', targets.led, options);
  if (led.aborted || options.signal?.aborted) return {...ABORTED_OUTCOME};

  const buzzer = await sendOne('Buzzer', targets.buzzer, options);
  if (buzzer.aborted || options.signal?.aborted) return {...ABORTED_OUTCOME};

  if (led.ok && buzzer.ok) {
    return {
      ok: true,
      aborted: false,
      message:
        'LED and buzzer commands accepted by the alert device; physical activation not confirmed.',
    };
  }

  const parts: string[] = [];
  for (const result of [led, buzzer]) {
    parts.push(
      result.ok
        ? `${result.label.toLowerCase()} accepted`
        : `${result.label.toLowerCase()} failed (${result.detail})`,
    );
  }
  return {
    ok: false,
    aborted: false,
    message: `Hardware alert command: ${parts.join(', ')}. Monitoring continues; no retry queued.`,
  };
}

/**
 * Wraps command submission in an optional bounded handoff. The host work is
 * resumed in all cases, including cancellation and failure, and a stale session
 * is never allowed to send commands after reconfiguration.
 */
export async function sendCoordinatedHardwareAlerts(
  targets: HardwareAlertTargets,
  session: HardwareAlertSession,
  options: SendHardwareAlertsOptions = {},
): Promise<HardwareAlertOutcome> {
  if (!session.isCurrent() || options.signal?.aborted) return {...ABORTED_OUTCOME};

  await session.quiesce();
  try {
    if (!session.isCurrent() || options.signal?.aborted) return {...ABORTED_OUTCOME};

    // Let the last image response finish server-side cleanup before the first
    // command. This is a fixed, bounded handoff, not a retry or a longer timeout.
    const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
    if (settleMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, settleMs));
    }
    if (!session.isCurrent() || options.signal?.aborted) return {...ABORTED_OUTCOME};

    return await sendHardwareAlerts(targets, options);
  } finally {
    session.resume();
  }
}
