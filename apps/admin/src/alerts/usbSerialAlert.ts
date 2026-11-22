import type {HardwareAlertOutcome} from './esp32HardwareAlerts';

export const SERIAL_PROTOCOL_VERSION = 'DDD1';
export const SERIAL_EXPECTED_DEVICE = 'usb-serial-alert-controller';
export const SERIAL_BAUD_RATE = 115200;
export const SERIAL_COMMAND_TIMEOUT_MS = 2500;
export const SERIAL_HANDSHAKE_TIMEOUT_MS = 3000;
/** Shorter than the firmware's 1200 ms watchdog lease. */
export const SERIAL_ESCALATION_RENEW_MS = 300;
export const SERIAL_ESCALATION_ACK_TIMEOUT_MS = 700;

export type UsbSerialConnectionState =
  | 'unsupported'
  | 'disconnected'
  | 'connecting'
  | 'verifying'
  | 'connected'
  | 'error';

export interface UsbSerialStatus {
  state: UsbSerialConnectionState;
  message: string | null;
  device: string | null;
  build: string | null;
  features: readonly string[];
}

export interface SerialDeviceInfo {
  device: string;
  build: string;
  protocol: string;
  outputs: readonly string[];
  features: readonly string[];
}

export interface SerialResponse {
  version: string;
  kind: 'ACK' | 'NACK';
  id: string;
  command: string;
  fields: Readonly<Record<string, string>>;
  raw: string;
}

export interface SerialPortLike {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: {baudRate: number}): Promise<void>;
  close(): Promise<void>;
  addEventListener(type: 'disconnect', listener: () => void): void;
  removeEventListener(type: 'disconnect', listener: () => void): void;
}

interface SerialApiLike {
  requestPort(): Promise<SerialPortLike>;
}

interface SendOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface PendingCommand {
  resolve: (response: SerialResponse) => void;
  reject: (cause: unknown) => void;
  cleanup: () => void;
}

export class SerialCommandError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`USB alert device rejected the command (${reason}).`);
    this.name = 'SerialCommandError';
    this.reason = reason;
  }
}

export class SerialCommandCanceledError extends Error {
  constructor(message = 'USB alert command canceled; no retry was queued.') {
    super(message);
    this.name = 'SerialCommandCanceledError';
  }
}

function getWebSerialApi(): SerialApiLike | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as unknown as {serial?: SerialApiLike}).serial ?? null;
}

export function isWebSerialSupported(): boolean {
  return getWebSerialApi() !== null;
}

let commandCounter = 0;

export function createCommandId(): string {
  commandCounter += 1;
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `web-${commandCounter.toString(36)}-${random}`
    .replace(/[^A-Za-z0-9._:-]/g, '-')
    .slice(0, 40);
}

export function encodeSerialCommand(command: string, id: string, args: string[] = []): Uint8Array {
  if (!/^[A-Z][A-Z0-9_]{0,23}$/.test(command)) {
    throw new Error('Invalid serial command name.');
  }
  if (!/^[A-Za-z0-9._:-]{1,40}$/.test(id)) {
    throw new Error('Invalid serial command ID.');
  }
  for (const arg of args) {
    if (!/^[A-Z0-9][A-Z0-9,_=-]*$/.test(arg)) {
      throw new Error('Invalid serial command argument.');
    }
  }
  return new TextEncoder().encode(`${[SERIAL_PROTOCOL_VERSION, command, id, ...args].join('|')}\n`);
}

export function parseSerialResponse(line: string): SerialResponse | null {
  const raw = line.replace(/\r$/, '');
  if (raw.length === 0 || raw.length > 256) return null;

  const parts = raw.split('|');
  if (parts.length < 4 || parts[0] !== SERIAL_PROTOCOL_VERSION) return null;

  const kind = parts[1];
  if (kind !== 'ACK' && kind !== 'NACK') return null;

  const id = parts[2] ?? '';
  if (!/^[A-Za-z0-9._:-]{0,40}$/.test(id)) return null;

  const command = parts[3] ?? '';
  if (!/^[A-Z][A-Z0-9_]{0,23}$/.test(command)) return null;

  const fields: Record<string, string> = {};
  for (let index = 4; index < parts.length; index += 1) {
    const field = parts[index] ?? '';
    const separator = field.indexOf('=');
    if (separator <= 0) return null;
    const key = field.slice(0, separator);
    const value = field.slice(separator + 1);
    if (!/^[a-z][a-z0-9_]*$/.test(key) || !/^[A-Za-z0-9._:,-]{1,64}$/.test(value)) {
      return null;
    }
    fields[key] = value;
  }

  return {version: parts[0], kind, id, command, fields, raw};
}

export function verifyDeviceHandshake(response: SerialResponse): SerialDeviceInfo | null {
  if (response.kind !== 'ACK' || response.command !== 'HELLO') return null;
  if (response.fields.device !== SERIAL_EXPECTED_DEVICE) return null;
  if (response.fields.protocol !== '1') return null;

  const outputs = (response.fields.outputs ?? '')
    .split(',')
    .map((output) => output.trim().toLowerCase())
    .filter((output) => output.length > 0);
  if (!outputs.includes('led') || !outputs.includes('buzzer')) return null;

  const features = (response.fields.features ?? '')
    .split(',')
    .map((feature) => feature.trim().toLowerCase())
    .filter((feature) => feature.length > 0);

  return {
    device: response.fields.device,
    build: response.fields.build ?? '',
    protocol: response.fields.protocol,
    outputs,
    features,
  };
}

export function usbSupportsEscalation(
  status: Pick<UsbSerialStatus, 'features'>,
): boolean {
  return status.features.includes('escalation');
}

function describeError(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim() !== '') {
    return cause.message.trim().slice(0, 120);
  }
  return 'unknown serial error';
}

const initialStatus = (): UsbSerialStatus =>
  isWebSerialSupported()
    ? {
        state: 'disconnected',
        message: null,
        device: null,
        build: null,
        features: [],
      }
    : {
        state: 'unsupported',
        message: 'Web Serial is unavailable. Use desktop Chrome or Edge over HTTPS.',
        device: null,
        build: null,
        features: [],
      };

/**
 * Owns one explicit Web Serial permission and one alert-controller connection.
 * It never reopens a port by itself and never retains a command for replay.
 */
export class SerialAlertConnection {
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private disconnectListener: (() => void) | null = null;
  private readonly pending = new Map<string, PendingCommand>();
  private readonly listeners = new Set<(status: UsbSerialStatus) => void>();
  private epoch = 0;
  private status: UsbSerialStatus = initialStatus();

  getStatus(): UsbSerialStatus {
    return this.status;
  }

  isConnected(): boolean {
    return this.status.state === 'connected' && this.port !== null && this.writer !== null;
  }

  subscribe(listener: (status: UsbSerialStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  /** Requests the port from the user, then verifies the device identity. */
  async connect(): Promise<SerialDeviceInfo> {
    const api = getWebSerialApi();
    if (!api) {
      const error = new Error('Web Serial is unavailable in this browser.');
      this.setStatus({
        state: 'unsupported',
        message: 'Web Serial is unavailable. Use desktop Chrome or Edge over HTTPS.',
        device: null,
        build: null,
        features: [],
      });
      throw error;
    }
    const port = await api.requestPort();
    return this.connectPort(port);
  }

  /** Injectable for tests; production callers use connect(). */
  async connectPort(port: SerialPortLike): Promise<SerialDeviceInfo> {
    if (this.port || this.reader || this.writer) {
      throw new Error('The USB alert device is already connected.');
    }

    this.setStatus({
      state: 'connecting',
      message: 'Opening the selected USB serial port...',
      device: null,
      build: null,
      features: [],
    });

    try {
      await port.open({baudRate: SERIAL_BAUD_RATE});
      this.port = port;
      this.disconnectListener = () => {
        void this.detach('USB alert device disconnected unexpectedly.', 'disconnected');
      };
      port.addEventListener('disconnect', this.disconnectListener);

      if (!port.readable || !port.writable) {
        throw new Error('The selected port did not expose readable and writable streams.');
      }

      this.writer = port.writable.getWriter();
      const reader = port.readable.getReader();
      this.reader = reader;
      const epoch = this.epoch;
      void this.runReadLoop(reader, epoch);

      this.setStatus({
        state: 'verifying',
        message: 'Verifying the USB alert device handshake...',
        device: null,
        build: null,
        features: [],
      });

      const response = await this.request('HELLO', [], {
        timeoutMs: SERIAL_HANDSHAKE_TIMEOUT_MS,
      });
      const info = verifyDeviceHandshake(response);
      if (!info) throw new SerialCommandError('UNEXPECTED_HANDSHAKE');

      this.setStatus({
        state: 'connected',
        message: `USB alert device verified: ${info.device}${info.build ? ` (${info.build})` : ''}.`,
        device: info.device,
        build: info.build,
        features: info.features,
      });
      return info;
    } catch (cause) {
      const message = `USB connection failed: ${describeError(cause)}`;
      await this.detach(message, 'error');
      throw cause instanceof Error ? cause : new Error(message);
    }
  }

  async disconnect(message = 'USB alert device disconnected.'): Promise<void> {
    await this.detach(message, 'disconnected');
  }

  /** Rejects in-flight commands without closing a healthy port. */
  invalidatePending(message = 'Alert command canceled; no retry was queued.'): void {
    for (const [, pending] of this.pending) {
      pending.cleanup();
      pending.reject(new SerialCommandCanceledError(message));
    }
    this.pending.clear();
  }

  async sendTest(options: SendOptions = {}): Promise<HardwareAlertOutcome> {
    if (!this.isConnected()) {
      return {
        ok: false,
        aborted: false,
        message: 'Hardware alert skipped: the USB alert device is not connected.',
      };
    }

    try {
      await this.request('TEST', ['ALL'], options);
      return {
        ok: true,
        aborted: false,
        message:
          'LED and buzzer test command acknowledged by the USB alert device; physical activation not confirmed.',
      };
    } catch (cause) {
      if (cause instanceof SerialCommandCanceledError || options.signal?.aborted) {
        return {
          ok: false,
          aborted: true,
          message: 'USB alert command canceled; no retry was queued.',
        };
      }
      return {
        ok: false,
        aborted: false,
        message: `USB alert command failed (${describeError(cause)}). Monitoring continues; no retry queued.`,
      };
    }
  }

  /**
   * One-shot escalation control. START is only sent once per closure; RENEW is
   * sent by the browser only while a fresh valid closure still exists. STOP is
   * best effort: the firmware watchdog is the final safety net.
   */
  async sendEscalation(
    command: 'START' | 'RENEW' | 'STOP',
    options: SendOptions = {},
  ): Promise<HardwareAlertOutcome> {
    if (!this.isConnected()) {
      return {
        ok: false,
        aborted: false,
        message: 'Escalation skipped: the USB alert device is not connected.',
      };
    }

    try {
      await this.request('ESCALATE', [command], {
        timeoutMs: SERIAL_ESCALATION_ACK_TIMEOUT_MS,
        ...options,
      });
      return {
        ok: true,
        aborted: false,
        message: `Escalation ${command.toLowerCase()} acknowledged by the USB alert device; physical activation not confirmed.`,
      };
    } catch (cause) {
      if (cause instanceof SerialCommandCanceledError || options.signal?.aborted) {
        return {
          ok: false,
          aborted: true,
          message: 'Escalation command canceled; no retry was queued.',
        };
      }
      return {
        ok: false,
        aborted: false,
        message: `Escalation ${command.toLowerCase()} failed (${describeError(cause)}). No retry queued.`,
      };
    }
  }

  private setStatus(status: UsbSerialStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }

  private async runReadLoop(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    epoch: number,
  ): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = '';
    let reason = 'USB alert device serial stream closed.';

    try {
      while (true) {
        const {value, done} = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, {stream: true});

        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          this.handleLine(line);
          newline = buffer.indexOf('\n');
        }
        if (buffer.length > 512) buffer = buffer.slice(-256);
      }
    } catch (cause) {
      reason = `USB serial read error: ${describeError(cause)}`;
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Another cleanup path may already own the lock.
      }
      if (this.reader === reader && epoch === this.epoch) {
        await this.detach(reason, 'disconnected');
      }
    }
  }

  private handleLine(line: string): void {
    const response = parseSerialResponse(line);
    if (!response) return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    pending.cleanup();
    pending.resolve(response);
  }

  private request(command: string, args: string[], options: SendOptions): Promise<SerialResponse> {
    if (!this.writer || !this.port) {
      return Promise.reject(new SerialCommandError('NOT_CONNECTED'));
    }
    if (options.signal?.aborted) {
      return Promise.reject(new SerialCommandCanceledError());
    }

    const writer = this.writer;
    const id = createCommandId();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort = () => {};
    let pending: PendingCommand | null = null;

    const result = new Promise<SerialResponse>((resolve, reject) => {
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        if (this.pending.get(id) === pending) this.pending.delete(id);
      };
      pending = {
        resolve: (response) => {
          cleanup();
          resolve(response);
        },
        reject: (cause) => {
          cleanup();
          reject(cause);
        },
        cleanup,
      };
      timer = setTimeout(() => {
        pending?.reject(new SerialCommandError('TIMEOUT'));
      }, Math.max(1, options.timeoutMs ?? SERIAL_COMMAND_TIMEOUT_MS));
      onAbort = () => pending?.reject(new SerialCommandCanceledError());
      options.signal?.addEventListener('abort', onAbort, {once: true});
      this.pending.set(id, pending);
    });

    void writer
      .write(encodeSerialCommand(command, id, args))
      .catch((cause: unknown) => pending?.reject(new SerialCommandError(describeError(cause))));

    return result.then((response) => {
      if (response.kind === 'NACK') {
        throw new SerialCommandError(response.command || 'REJECTED');
      }
      return response;
    });
  }

  private async detach(reason: string, nextState: 'disconnected' | 'error'): Promise<void> {
    this.epoch += 1;
    this.invalidatePending(`${reason} No retry was queued.`);

    const port = this.port;
    const reader = this.reader;
    const writer = this.writer;
    const listener = this.disconnectListener;
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.disconnectListener = null;

    if (port && listener) {
      try {
        port.removeEventListener('disconnect', listener);
      } catch {
        // Ignore cleanup failures from an already-removed device.
      }
    }
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // A closed stream is already in the desired state.
      }
    }
    if (writer) {
      try {
        writer.releaseLock();
      } catch {
        // Ignore locks already released by a concurrent close.
      }
    }
    if (port) {
      try {
        await port.close();
      } catch {
        // The browser may have already closed the port after physical removal.
      }
    }

    this.setStatus({
      state: nextState,
      message: reason,
      device: null,
      build: null,
      features: [],
    });
  }
}
