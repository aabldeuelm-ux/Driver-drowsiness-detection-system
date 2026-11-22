import {describe, expect, it} from 'vitest';
import {
  encodeSerialCommand,
  isWebSerialSupported,
  parseSerialResponse,
  SerialAlertConnection,
  SERIAL_EXPECTED_DEVICE,
  usbSupportsEscalation,
  verifyDeviceHandshake,
  type SerialPortLike,
} from '../usbSerialAlert';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Exact field order and tokens emitted by firmware build ...-v3. */
const FIRMWARE_BUILD_ID = 'usb-serial-alert-controller-2026-11-22-v3';
const FIRMWARE_HELLO_ID = 'web-1-550e8400-e29b-41d4-a716';
const FIRMWARE_HELLO_ACK = [
  'DDD1',
  'ACK',
  FIRMWARE_HELLO_ID,
  'HELLO',
  `device=${SERIAL_EXPECTED_DEVICE}`,
  `build=${FIRMWARE_BUILD_ID}`,
  'protocol=1',
  'outputs=led,buzzer',
  'features=escalation',
].join('|');

/**
 * v2 used a 128-byte scratch buffer for these 132 bytes of fields, so devices
 * reported `features=escal` instead of the full capability token.
 */
const TRUNCATED_V2_HELLO_ACK = FIRMWARE_HELLO_ACK.replace(
  FIRMWARE_BUILD_ID,
  'usb-serial-alert-controller-2026-11-22-v2',
).replace('features=escalation', 'features=escal');

function helloAck(
  id: string,
  device = SERIAL_EXPECTED_DEVICE,
  features = 'escalation',
): string {
  const fields = [
    `device=${device}`,
    'build=usb-serial-alert-controller-test-v1',
    'protocol=1',
    'outputs=led,buzzer',
  ];
  if (features) fields.push(`features=${features}`);
  return ['DDD1', 'ACK', id, 'HELLO', ...fields].join('|');
}

interface FakePortOptions {
  autoHello?: boolean;
  helloDevice?: string;
  helloFeatures?: string;
  testResponse?: (id: string) => string | null;
  escalateResponse?: (id: string, action: string) => string | null;
}

function createFakePort(options: FakePortOptions = {}) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const readable = new ReadableStream<Uint8Array>({
    start(startController) {
      controller = startController;
    },
  });
  const written: string[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      const frame = decoder.decode(chunk).trim();
      written.push(frame);
      const parts = frame.split('|');
      const kind = parts[1];
      const id = parts[2] ?? '';
      if (kind === 'HELLO' && options.autoHello !== false) {
        controller.enqueue(
          encoder.encode(
            `${helloAck(id, options.helloDevice, options.helloFeatures ?? 'escalation')}\n`,
          ),
        );
      }
      if (kind === 'TEST' && options.testResponse) {
        const response = options.testResponse(id);
        if (response) controller.enqueue(encoder.encode(`${response}\n`));
      }
      if (kind === 'ESCALATE' && options.escalateResponse) {
        const response = options.escalateResponse(id, parts[3] ?? '');
        if (response) controller.enqueue(encoder.encode(`${response}\n`));
      }
    },
  });
  const listeners = new Set<() => void>();
  let baudRate: number | null = null;

  const port: SerialPortLike = {
    readable,
    writable,
    async open(settings) {
      baudRate = settings.baudRate;
    },
    async close() {},
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
  };

  return {
    port,
    written,
    get baudRate() {
      return baudRate;
    },
    pushLine(line: string) {
      controller.enqueue(encoder.encode(`${line}\n`));
    },
    emitDisconnect() {
      for (const listener of listeners) listener();
    },
  };
}

describe('serial protocol framing', () => {
  it('encodes bounded newline-delimited commands', () => {
    const frame = decoder.decode(encodeSerialCommand('TEST', 'id-1', ['ALL']));
    expect(frame).toBe('DDD1|TEST|id-1|ALL\n');
    expect(() => encodeSerialCommand('TEST', 'id 1', ['ALL'])).toThrow();
    expect(() => encodeSerialCommand('TEST', 'id-1', ['DROP TABLE'])).toThrow();
  });

  it('parses acknowledgments and rejects malformed frames', () => {
    const parsed = parseSerialResponse('DDD1|ACK|id-1|TEST|target=ALL');
    expect(parsed).toMatchObject({
      version: 'DDD1',
      kind: 'ACK',
      id: 'id-1',
      command: 'TEST',
      fields: {target: 'ALL'},
    });
    expect(parseSerialResponse('DDD2|ACK|id-1|HELLO')).toBeNull();
    expect(parseSerialResponse('DDD1|ACK|bad id|HELLO')).toBeNull();
    expect(parseSerialResponse('DDD1|MAYBE|id-1|HELLO')).toBeNull();
    expect(parseSerialResponse('DDD1|ACK|id-1|HELLO|broken')).toBeNull();
  });

  it('encodes leased escalation commands with the versioned framing', () => {
    expect(decoder.decode(encodeSerialCommand('ESCALATE', 'id-1', ['START']))).toBe(
      'DDD1|ESCALATE|id-1|START\n',
    );
    expect(decoder.decode(encodeSerialCommand('ESCALATE', 'id-2', ['RENEW']))).toBe(
      'DDD1|ESCALATE|id-2|RENEW\n',
    );
    expect(decoder.decode(encodeSerialCommand('ESCALATE', 'id-3', ['STOP']))).toBe(
      'DDD1|ESCALATE|id-3|STOP\n',
    );
    expect(() => encodeSerialCommand('ESCALATE', 'id-1', ['start'])).toThrow();
  });

  it('verifies the expected device, protocol, outputs, and advertised features', () => {
    const parsed = parseSerialResponse(helloAck('id-1'));
    expect(parsed && verifyDeviceHandshake(parsed)).toMatchObject({
      device: SERIAL_EXPECTED_DEVICE,
      protocol: '1',
      features: ['escalation'],
    });
    const legacy = parseSerialResponse(helloAck('id-2', SERIAL_EXPECTED_DEVICE, ''));
    expect(legacy && verifyDeviceHandshake(legacy)).toMatchObject({features: []});
    const wrong = parseSerialResponse(helloAck('id-3', 'some-other-device'));
    expect(wrong && verifyDeviceHandshake(wrong)).toBeNull();
  });

  it('parses and stores the exact firmware v3 HELLO ACK', () => {
    const parsed = parseSerialResponse(FIRMWARE_HELLO_ACK);

    expect(parsed?.raw).toBe(FIRMWARE_HELLO_ACK);
    const info = parsed && verifyDeviceHandshake(parsed);
    expect(info).toMatchObject({
      device: SERIAL_EXPECTED_DEVICE,
      build: FIRMWARE_BUILD_ID,
      protocol: '1',
      outputs: ['led', 'buzzer'],
      features: ['escalation'],
    });
    expect(info && usbSupportsEscalation(info)).toBe(true);
  });

  it('keeps the capability check strict for the truncated v2 HELLO ACK', () => {
    const parsed = parseSerialResponse(TRUNCATED_V2_HELLO_ACK);

    expect(parsed).not.toBeNull();
    const info = parsed && verifyDeviceHandshake(parsed);
    expect(info).toMatchObject({
      build: 'usb-serial-alert-controller-2026-11-22-v2',
      features: ['escal'],
    });
    expect(info && usbSupportsEscalation(info)).toBe(false);
  });

  it('does not assume Web Serial exists in non-browser test environments', () => {
    expect(typeof isWebSerialSupported()).toBe('boolean');
  });
});

describe('SerialAlertConnection', () => {
  it('opens at 115200 baud and connects only after a verified handshake', async () => {
    const fake = createFakePort();
    const connection = new SerialAlertConnection();
    const info = await connection.connectPort(fake.port);

    expect(fake.baudRate).toBe(115200);
    expect(fake.written).toHaveLength(1);
    expect(fake.written[0]).toMatch(/^DDD1\|HELLO\|/);
    expect(info.device).toBe(SERIAL_EXPECTED_DEVICE);
    expect(connection.isConnected()).toBe(true);
    expect(connection.getStatus().state).toBe('connected');

    await connection.disconnect();
  });

  it('rejects a wrong device and leaves alerts disconnected', async () => {
    const fake = createFakePort({helloDevice: 'unexpected-device'});
    const connection = new SerialAlertConnection();

    await expect(connection.connectPort(fake.port)).rejects.toThrow();
    expect(connection.isConnected()).toBe(false);
    expect(connection.getStatus().state).toBe('error');
  });

  it('acknowledges one test command without claiming physical activation', async () => {
    const fake = createFakePort({
      testResponse: (id) => `DDD1|ACK|${id}|TEST|target=ALL`,
    });
    const connection = new SerialAlertConnection();
    await connection.connectPort(fake.port);

    const outcome = await connection.sendTest();

    expect(fake.written).toHaveLength(2);
    expect(fake.written[1]).toMatch(/^DDD1\|TEST\|[^|]+\|ALL$/);
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('acknowledged');
    expect(outcome.message).toContain('physical activation not confirmed');

    await connection.disconnect();
  });

  it('reports NACK reasons without retrying', async () => {
    const fake = createFakePort({
      testResponse: (id) => `DDD1|NACK|${id}|DUPLICATE`,
    });
    const connection = new SerialAlertConnection();
    await connection.connectPort(fake.port);

    const outcome = await connection.sendTest();

    expect(fake.written).toHaveLength(2);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('DUPLICATE');
    expect(outcome.message).toContain('no retry queued');

    await connection.disconnect();
  });

  it('sends one-shot escalation commands and reports their acknowledgments', async () => {
    const fake = createFakePort({
      escalateResponse: (id, action) => `DDD1|ACK|${id}|ESCALATE|mode=${action}`,
    });
    const connection = new SerialAlertConnection();
    await connection.connectPort(fake.port);
    expect(connection.getStatus().features).toContain('escalation');

    const started = await connection.sendEscalation('START');
    const renewed = await connection.sendEscalation('RENEW');
    const stopped = await connection.sendEscalation('STOP');

    expect(fake.written).toHaveLength(4);
    expect(fake.written[1]).toMatch(/^DDD1\|ESCALATE\|[^|]+\|START$/);
    expect(fake.written[2]).toMatch(/^DDD1\|ESCALATE\|[^|]+\|RENEW$/);
    expect(fake.written[3]).toMatch(/^DDD1\|ESCALATE\|[^|]+\|STOP$/);
    expect(started.ok).toBe(true);
    expect(renewed.ok).toBe(true);
    expect(stopped.ok).toBe(true);
    expect(started.message).toContain('physical activation not confirmed');
    expect(new Set(fake.written.slice(1).map((frame) => frame.split('|')[2])).size).toBe(3);

    await connection.disconnect();
  });

  it('rejects escalation commands when RENEW has no active lease', async () => {
    const fake = createFakePort({
      escalateResponse: (id) => `DDD1|NACK|${id}|NOT_ACTIVE`,
    });
    const connection = new SerialAlertConnection();
    await connection.connectPort(fake.port);

    const outcome = await connection.sendEscalation('RENEW');

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('NOT_ACTIVE');
    expect(outcome.message).toContain('No retry queued');
    expect(fake.written).toHaveLength(2);

    await connection.disconnect();
  });

  it('cancels in-flight commands on disconnect and never replays them on reconnect', async () => {
    const first = createFakePort();
    const connection = new SerialAlertConnection();
    await connection.connectPort(first.port);

    const pending = connection.sendTest();
    await connection.disconnect('USB unplugged.');
    const canceled = await pending;

    expect(canceled.aborted).toBe(true);
    // HELLO + the single canceled TEST. No second/replayed TEST was written.
    expect(first.written).toHaveLength(2);

    const second = createFakePort({
      testResponse: (id) => `DDD1|ACK|${id}|TEST|target=ALL`,
    });
    await connection.connectPort(second.port);
    const outcome = await connection.sendTest();

    expect(outcome.ok).toBe(true);
    expect(second.written).toHaveLength(2);
    const firstId = first.written[0]?.split('|')[2];
    const secondId = second.written[1]?.split('|')[2];
    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe(firstId);

    await connection.disconnect();
  });
});
