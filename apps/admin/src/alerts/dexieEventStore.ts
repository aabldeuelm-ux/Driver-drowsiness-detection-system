import Dexie, {type Table} from 'dexie';
import {
  sanitizeSettings,
  sortEvents,
  type AppSettings,
  type ClosureEvent,
  type EventStore,
  type EventUpdate,
} from './eventStore';

interface SettingsRecord {
  key: 'app';
  value: AppSettings;
}

class AdminDatabase extends Dexie {
  events!: Table<ClosureEvent, string>;
  settings!: Table<SettingsRecord, 'app'>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      events: 'id, sessionId, timestamp, cameraSource, endReason',
      settings: 'key',
    });
  }
}

/** Dexie/IndexedDB adapter. Callers own error handling and UI messaging. */
export function createDexieEventStore(
  databaseName = 'driver-drowsiness-admin',
): EventStore {
  const db = new AdminDatabase(databaseName);

  return {
    async listEvents() {
      const events = await db.events.toArray();
      return sortEvents(events);
    },
    async createEvent(event) {
      await db.events.put(event);
    },
    async updateEvent(id, update: EventUpdate) {
      await db.events.update(id, update);
    },
    async clearEvents() {
      await db.events.clear();
    },
    async getSettings() {
      const record = await db.settings.get('app');
      return record ? sanitizeSettings(record.value) : null;
    },
    async saveSettings(settings) {
      await db.settings.put({key: 'app', value: settings});
    },
    async clearAll() {
      await db.transaction('rw', db.events, db.settings, async () => {
        await db.events.clear();
        await db.settings.clear();
      });
    },
  };
}
