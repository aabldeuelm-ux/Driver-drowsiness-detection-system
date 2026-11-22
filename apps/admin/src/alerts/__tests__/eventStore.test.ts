import 'fake-indexeddb/auto';
import {describe, expect, it} from 'vitest';
import {createDexieEventStore} from '../dexieEventStore';
import {
  DEFAULT_SETTINGS,
  formatEventsCSV,
  formatEventsJSON,
  MemoryEventStore,
  sanitizeSettings,
  sortEvents,
  type ClosureEvent,
} from '../eventStore';

function makeEvent(id: string, timestamp: string): ClosureEvent {
  return {
    id,
    sessionId: 'session-1',
    timestamp,
    type: 'prolonged-eye-closure',
    severity: 'warning',
    cameraSource: 'this-device',
    configuredDurationMs: 800,
    observedDurationMs: 1200,
    endedAt: null,
    endReason: null,
    schemaVersion: 1,
  };
}

describe('settings sanitization', () => {
  it('accepts valid settings and clamps volume', () => {
    expect(
      sanitizeSettings({
        schemaVersion: 1,
        prolongedClosureMs: 1200,
        sound: {enabled: true, muted: false, volume: 140},
      }),
    ).toEqual({
      schemaVersion: 1,
      prolongedClosureMs: 1200,
      sound: {enabled: true, muted: false, volume: 100},
    });
  });

  it('rejects unknown schema versions and invalid durations', () => {
    expect(
      sanitizeSettings({
        schemaVersion: 2,
        prolongedClosureMs: 800,
        sound: DEFAULT_SETTINGS.sound,
      }),
    ).toBeNull();
    expect(
      sanitizeSettings({
        schemaVersion: 1,
        prolongedClosureMs: 1,
        sound: DEFAULT_SETTINGS.sound,
      }),
    ).toBeNull();
    expect(sanitizeSettings({schemaVersion: 1, prolongedClosureMs: 800})).toBeNull();
  });
});

describe('MemoryEventStore', () => {
  it('sorts events newest first and returns defensive settings copies', async () => {
    const store = new MemoryEventStore({
      events: [makeEvent('old', '2026-01-01T00:00:00.000Z')],
      settings: DEFAULT_SETTINGS,
    });
    await store.createEvent(makeEvent('new', '2026-01-02T00:00:00.000Z'));

    expect((await store.listEvents()).map((event) => event.id)).toEqual([
      'new',
      'old',
    ]);

    const settings = await store.getSettings();
    expect(settings).not.toBeNull();
    if (!settings) throw new Error('Expected settings');
    settings.sound.volume = 1;
    expect((await store.getSettings())?.sound.volume).toBe(70);
  });

  it('updates only the matching event with episode end metadata', async () => {
    const store = new MemoryEventStore({events: [makeEvent('a', '2026-01-01')]});
    await store.updateEvent('a', {
      observedDurationMs: 2400,
      endedAt: '2026-01-01T00:00:02.400Z',
      endReason: 'eyes-opened',
    });

    const events = await store.listEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'a',
      observedDurationMs: 2400,
      endedAt: '2026-01-01T00:00:02.400Z',
      endReason: 'eyes-opened',
    });
  });
});

describe('DexieEventStore', () => {
  let databaseNumber = 0;

  it('persists settings and events, then supports clear and delete-all', async () => {
    const store = createDexieEventStore(`alert-store-test-${databaseNumber++}`);
    const settings = {
      schemaVersion: 1 as const,
      prolongedClosureMs: 1500,
      sound: {enabled: true, muted: false, volume: 45},
    };

    await store.saveSettings(settings);
    await store.createEvent(makeEvent('second', '2026-02-02T00:00:00.000Z'));
    await store.createEvent(makeEvent('first', '2026-01-01T00:00:00.000Z'));

    expect(await store.getSettings()).toEqual(settings);
    expect((await store.listEvents()).map((event) => event.id)).toEqual([
      'second',
      'first',
    ]);

    await store.updateEvent('first', {
      observedDurationMs: 1900,
      endReason: 'tracking-interrupted',
    });
    const updated = (await store.listEvents()).find((event) => event.id === 'first');
    expect(updated).toMatchObject({
      observedDurationMs: 1900,
      endReason: 'tracking-interrupted',
    });

    await store.clearEvents();
    expect(await store.listEvents()).toEqual([]);
    expect(await store.getSettings()).toEqual(settings);

    await store.saveSettings(settings);
    await store.clearAll();
    expect(await store.listEvents()).toEqual([]);
    expect(await store.getSettings()).toBeNull();
  });
});

describe('export formatting', () => {
  it('escapes CSV cells containing commas, quotes, and newlines', () => {
    const event = {
      ...makeEvent('id,"quoted"\nline', '2026-01-01T00:00:00.000Z'),
      endReason: 'eyes-opened' as const,
      endedAt: '2026-01-01T00:00:01.200Z',
    };
    const csv = formatEventsCSV([event]);
    const lines = csv.split('\r\n');

    expect(lines[0]).toBe(
      'id,sessionId,timestamp,type,severity,cameraSource,configuredDurationMs,observedDurationMs,endReason,endedAt,schemaVersion',
    );
    expect(lines[1]).toContain('"id,""quoted""\nline"');
    expect(lines[1]).toContain('eyes-opened');
  });

  it('exports sorted metadata with a privacy note and no frame data', () => {
    const events = [
      makeEvent('new', '2026-03-01T00:00:00.000Z'),
      makeEvent('old', '2026-02-01T00:00:00.000Z'),
    ];
    const parsed = JSON.parse(
      formatEventsJSON(events, '2026-04-01T00:00:00.000Z'),
    ) as {
      events: ClosureEvent[];
      exportedAt: string;
      note: string;
    };

    expect(parsed.events.map((event) => event.id)).toEqual(sortEvents(events).map((event) => event.id));
    expect(parsed.exportedAt).toBe('2026-04-01T00:00:00.000Z');
    expect(parsed.note).toContain('No images, video, landmarks');
    expect(JSON.stringify(parsed)).not.toContain('faceLandmarks');
  });
});
