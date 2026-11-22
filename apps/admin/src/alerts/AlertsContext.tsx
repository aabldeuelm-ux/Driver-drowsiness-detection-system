import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {useCamera} from '../camera/CameraContext';
import {useTracking} from '../vision/TrackingContext';
import {CLOSURE_MAX_SAMPLE_GAP_MS} from '../vision/eyeClosureMonitor';
import {AudioManager, type AudioSnapshot} from './audioManager';
import {hardwareAlertTargets, sendHardwareAlerts} from './esp32HardwareAlerts';
import {
  isWebSerialSupported,
  SerialAlertConnection,
  SERIAL_ESCALATION_RENEW_MS,
  usbSupportsEscalation,
  type UsbSerialStatus,
} from './usbSerialAlert';
import {
  USB_ESCALATION_RELEASE_ENABLED,
  UsbEscalationController,
  type EscalationCommand,
  type UsbEscalationStatus,
} from './usbEscalationController';
import {createDexieEventStore} from './dexieEventStore';
import {EpisodeRecorder} from './episodeRecorder';
import {
  createId,
  DEFAULT_SETTINGS,
  downloadTextFile,
  formatEventsCSV,
  formatEventsJSON,
  MemoryEventStore,
  sanitizeSettings,
  sortEvents,
  type AppSettings,
  type ClosureEvent,
} from './eventStore';

export type StorageStatus = 'loading' | 'available' | 'error';
export type HardwareAlertTransport = 'wifi' | 'usb';

export interface HardwareAlertStatus {
  tone: 'neutral' | 'amber' | 'red';
  message: string | null;
  at: number | null;
}

export interface AlertsApi {
  events: ClosureEvent[];
  sessionId: string;
  sessionAlertCount: number;
  historicalAlertCount: number;
  storageStatus: StorageStatus;
  storageError: string | null;
  settings: AppSettings;
  settingsHydrated: boolean;
  audio: AudioSnapshot;
  /** Session-only; never read from or written to persisted settings. */
  hardwareAlertsEnabled: boolean;
  setHardwareAlertsEnabled: (enabled: boolean) => void;
  /** Selected command transport. Wi-Fi remains the fallback. */
  hardwareTransport: HardwareAlertTransport;
  setHardwareTransport: (transport: HardwareAlertTransport) => void;
  /** Session-only alert device base URL, independent of the camera source. */
  hardwareAlertUrl: string;
  setHardwareAlertUrl: (value: string) => void;
  /** True only when the selected transport is configured and verified. */
  hardwareAlertReady: boolean;
  hardwareAlertStatus: HardwareAlertStatus;
  usbSerialSupported: boolean;
  usbSerialStatus: UsbSerialStatus;
  /** Browser-side state of the leased 5-second escalation pattern. */
  usbEscalationStatus: UsbEscalationStatus;
  connectUsbSerial: () => Promise<void>;
  disconnectUsbSerial: () => Promise<void>;
  /** Manual connectivity check; submits both one-shot commands once. */
  testHardwareAlert: () => Promise<void>;
  setProlongedClosureMs: (value: number) => void;
  enableSound: () => Promise<AudioSnapshot>;
  testSound: () => Promise<AudioSnapshot>;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  clearHistory: () => Promise<void>;
  clearAllData: () => Promise<void>;
  /** Exports all events by default; history views pass their filtered subset. */
  exportJSON: (events?: readonly ClosureEvent[]) => void;
  exportCSV: (events?: readonly ClosureEvent[]) => void;
}

const SETTINGS_SAVE_ERROR =
  'Sound and duration preferences could not be saved in this browser.';
const EVENTS_CLEAR_ERROR = 'The local event history could not be cleared.';
const ALL_CLEAR_ERROR = 'Local settings and event history could not be cleared.';
const IDLE_HARDWARE_ALERT_STATUS: HardwareAlertStatus = {
  tone: 'neutral',
  message: null,
  at: null,
};

/** Never keep pasted credentials in React state or visible UI labels. */
function stripUrlCredentials(value: string): string {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.username !== '' || parsed.password !== '') {
      parsed.username = '';
      parsed.password = '';
      return parsed.toString();
    }
  } catch {
    // The submit path reports an invalid URL visibly; keep the raw text here.
  }
  return trimmed;
}

const AlertsContext = createContext<AlertsApi | null>(null);

function createStore(): {store: ReturnType<typeof createDexieEventStore>; error: string | null} {
  try {
    return {store: createDexieEventStore(), error: null};
  } catch {
    return {
      store: new MemoryEventStore(),
      error: 'IndexedDB could not be opened. Alerts are shown for this tab only.',
    };
  }
}

export function AlertsProvider({children}: {children: ReactNode}) {
  const storeRef = useRef<ReturnType<typeof createStore> | null>(null);
  if (!storeRef.current) storeRef.current = createStore();
  const store = storeRef.current.store;

  const audioRef = useRef<AudioManager | null>(null);
  if (!audioRef.current) audioRef.current = new AudioManager();
  const audio = audioRef.current;

  const serialRef = useRef<SerialAlertConnection | null>(null);
  if (!serialRef.current) serialRef.current = new SerialAlertConnection();
  const serial = serialRef.current;

  const sessionIdRef = useRef<string | null>(null);
  if (!sessionIdRef.current) sessionIdRef.current = createId();
  const sessionId = sessionIdRef.current;

  const camera = useCamera();
  const tracking = useTracking();
  const {
    setProlongedClosureMs: setTrackingDuration,
  } = tracking;

  const selectedCamera = camera.selectedCamera;
  const cameraLive = camera.activeStatus === 'live';
  const activeCameraKey = camera.activeCameraKey;

  const [events, setEvents] = useState<ClosureEvent[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [audioState, setAudioState] = useState<AudioSnapshot>(() => audio.getState());
  const [storageError, setStorageError] = useState<string | null>(
    storeRef.current.error,
  );
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [hardwareAlertsEnabled, setHardwareAlertsEnabledState] = useState(false);
  const [hardwareTransport, setHardwareTransportState] =
    useState<HardwareAlertTransport>('wifi');
  const [hardwareAlertUrl, setHardwareAlertUrlState] = useState('');
  const [usbSerialStatus, setUsbSerialStatus] = useState<UsbSerialStatus>(() =>
    serial.getStatus(),
  );
  const [usbEscalationStatus, setUsbEscalationStatus] =
    useState<UsbEscalationStatus>({active: false, message: null});
  const [hardwareAlertStatus, setHardwareAlertStatus] =
    useState<HardwareAlertStatus>(IDLE_HARDWARE_ALERT_STATUS);

  const usbSerialSupported = isWebSerialSupported();
  const usbConnected = usbSerialStatus.state === 'connected' && serial.isConnected();
  const hardwareAlertReady =
    hardwareTransport === 'wifi'
      ? hardwareAlertTargets(hardwareAlertUrl) !== null
      : usbConnected;

  const hardwareGateRef = useRef({
    enabled: false,
    transport: hardwareTransport as HardwareAlertTransport,
    selectedCamera,
    cameraLive,
    cameraKey: activeCameraKey,
    alertUrl: hardwareAlertUrl,
    usbConnected,
  });
  hardwareGateRef.current = {
    enabled: hardwareAlertsEnabled,
    transport: hardwareTransport,
    selectedCamera,
    cameraLive,
    cameraKey: activeCameraKey,
    alertUrl: hardwareAlertUrl,
    usbConnected,
  };
  const hardwareControllersRef = useRef<Set<AbortController>>(new Set());
  const hardwareEpochRef = useRef(0);
  const onEpisodeStartRef = useRef<(event: ClosureEvent) => void>(() => {});

  const sendEscalationCommand = useCallback(
    async (command: EscalationCommand) => {
      const gate = hardwareGateRef.current;
      if (gate.transport !== 'usb' || !gate.usbConnected || !serial.isConnected()) {
        return {
          ok: false,
          aborted: false,
          message: 'Escalation skipped: the USB alert device is not connected.',
        };
      }
      return serial.sendEscalation(command);
    },
    [serial],
  );

  const escalationRef = useRef<UsbEscalationController | null>(null);
  if (!escalationRef.current) {
    escalationRef.current = new UsbEscalationController({
      send: (command) => sendEscalationCommand(command),
      now: () => performance.now(),
      renewMs: SERIAL_ESCALATION_RENEW_MS,
      freshnessMs: CLOSURE_MAX_SAMPLE_GAP_MS,
      onStatus: setUsbEscalationStatus,
    });
  }
  const escalation = escalationRef.current;

  const abortPendingHardwareAlerts = useCallback(() => {
    // Invalidation is explicit: an aborted fetch or serial write alone is not
    // a reliable sign that a reconnect has made the old source safe to command.
    hardwareEpochRef.current += 1;
    const controllers = hardwareControllersRef.current;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    serial.invalidatePending();
    // Send STOP after invalidation so it is not canceled by this same sweep.
    escalation.stop('Hardware alerts were disabled or invalidated; escalation stopped.');
  }, [escalation, serial]);

  const recorderRef = useRef<EpisodeRecorder | null>(null);
  if (!recorderRef.current) {
    recorderRef.current = new EpisodeRecorder({
      store,
      audio,
      sessionId,
      onEvent: (event) => setEvents((current) => sortEvents([event, ...current])),
      onEventUpdate: (id, update) =>
        setEvents((current) =>
          current.map((event) => (event.id === id ? {...event, ...update} : event)),
        ),
      onError: (message) => setStorageError(message),
      onEpisodeStart: (event) => onEpisodeStartRef.current(event),
    });
  }
  const recorder = recorderRef.current;

  const setHardwareAlertsEnabled = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        const gate = hardwareGateRef.current;
        const ready =
          gate.transport === 'wifi'
            ? hardwareAlertTargets(gate.alertUrl) !== null
            : gate.usbConnected && serial.isConnected();
        if (!ready) {
          setHardwareAlertStatus({
            tone: 'red',
            message:
              gate.transport === 'usb'
                ? 'Connect and verify the USB alert device before enabling hardware alerts.'
                : 'Enter a valid absolute HTTP(S) alert device URL before enabling hardware alerts.',
            at: Date.now(),
          });
          return;
        }
      } else {
        abortPendingHardwareAlerts();
        setHardwareAlertStatus(IDLE_HARDWARE_ALERT_STATUS);
      }
      setHardwareAlertsEnabledState(enabled);
    },
    [abortPendingHardwareAlerts, serial],
  );

  const setHardwareTransport = useCallback(
    (transport: HardwareAlertTransport) => {
      if (transport === hardwareGateRef.current.transport) return;
      abortPendingHardwareAlerts();
      setHardwareAlertsEnabledState(false);
      setHardwareTransportState(transport);
      setHardwareAlertStatus({
        tone: 'neutral',
        message:
          transport === 'usb'
            ? 'USB selected. Connect and verify the alert device, then enable this session toggle.'
            : 'Wi-Fi selected. Enter the alert device URL, then enable this session toggle.',
        at: Date.now(),
      });
    },
    [abortPendingHardwareAlerts],
  );

  const connectUsbSerial = useCallback(async () => {
    if (!usbSerialSupported) {
      setHardwareAlertStatus({
        tone: 'red',
        message: 'Web Serial is unavailable. Use desktop Chrome or Edge over HTTPS.',
        at: Date.now(),
      });
      return;
    }
    abortPendingHardwareAlerts();
    setHardwareAlertsEnabledState(false);
    setHardwareTransportState('usb');
    try {
      await serial.connect();
      setHardwareAlertStatus({
        tone: 'amber',
        message:
          'USB alert device handshake verified. Hardware alerts stay off until you enable the session toggle.',
        at: Date.now(),
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'unknown serial error';
      setHardwareAlertStatus({
        tone: 'red',
        message: `USB alert device could not be verified: ${detail.slice(0, 120)}`,
        at: Date.now(),
      });
    }
  }, [abortPendingHardwareAlerts, serial, usbSerialSupported]);

  const disconnectUsbSerial = useCallback(async () => {
    abortPendingHardwareAlerts();
    setHardwareAlertsEnabledState(false);
    await serial.disconnect();
    setHardwareAlertStatus({
      tone: 'red',
      message: 'USB alert device disconnected. No commands are queued or replayed.',
      at: Date.now(),
    });
  }, [abortPendingHardwareAlerts, serial]);

  const setHardwareAlertUrl = useCallback(
    (value: string) => {
      const sanitized = stripUrlCredentials(value);
      if (
        sanitized !== hardwareGateRef.current.alertUrl &&
        hardwareGateRef.current.transport === 'wifi'
      ) {
        abortPendingHardwareAlerts();
        setHardwareAlertStatus(IDLE_HARDWARE_ALERT_STATUS);
      }
      setHardwareAlertUrlState(sanitized);
    },
    [abortPendingHardwareAlerts],
  );

  const submitHardwareAlert = useCallback(
    async (
      requireToggle: boolean,
      requireCameraLive: boolean,
      reportSkip: boolean,
    ) => {
      const gate = hardwareGateRef.current;
      if (
        (requireToggle && !gate.enabled) ||
        (requireCameraLive &&
          (!gate.cameraLive || gate.selectedCamera !== 'this-device'))
      ) {
        if (reportSkip) {
          setHardwareAlertStatus({
            tone: 'red',
            message:
              'Hardware test skipped: monitoring must be live on "This device".',
            at: Date.now(),
          });
        }
        return;
      }

      const transport = gate.transport;
      const targets = transport === 'wifi' ? hardwareAlertTargets(gate.alertUrl) : null;
      if (transport === 'wifi' && targets === null) {
        setHardwareAlertStatus({
          tone: 'red',
          message:
            'Hardware alert skipped: enter a valid absolute HTTP(S) alert device URL. Monitoring continues.',
          at: Date.now(),
        });
        return;
      }
      if (transport === 'usb' && (!gate.usbConnected || !serial.isConnected())) {
        setHardwareAlertStatus({
          tone: 'red',
          message:
            'Hardware alert skipped: connect and verify the USB alert device. Monitoring continues.',
          at: Date.now(),
        });
        return;
      }

      // An explicit test or a new episode supersedes any in-flight command.
      abortPendingHardwareAlerts();
      const sessionEpoch = hardwareEpochRef.current;

      const controller = new AbortController();
      hardwareControllersRef.current.add(controller);
      setHardwareAlertStatus({
        tone: 'amber',
        message:
          transport === 'wifi'
            ? 'Sending LED and buzzer commands to the configured ESP32 alert device; physical activation not confirmed.'
            : 'Sending one LED and buzzer command over USB to the verified alert device; physical activation not confirmed.',
        at: Date.now(),
      });

      const isCurrent = () => {
        const current = hardwareGateRef.current;
        return (
          sessionEpoch === hardwareEpochRef.current &&
          current.transport === transport &&
          (transport !== 'wifi' || current.alertUrl === gate.alertUrl) &&
          (transport !== 'usb' || (current.usbConnected && serial.isConnected())) &&
          (!requireToggle || current.enabled === gate.enabled) &&
          (!requireCameraLive ||
            (current.cameraLive &&
              current.selectedCamera === 'this-device' &&
              current.cameraKey !== null &&
              current.cameraKey === gate.cameraKey))
        );
      };

      try {
        if (!isCurrent() || controller.signal.aborted) return;
        const outcome =
          transport === 'wifi' && targets
            ? await sendHardwareAlerts(targets, {signal: controller.signal})
            : await serial.sendTest({signal: controller.signal});
        if (outcome.aborted || !isCurrent()) return;
        setHardwareAlertStatus({
          tone: outcome.ok ? 'amber' : 'red',
          message: outcome.message,
          at: Date.now(),
        });
      } finally {
        hardwareControllersRef.current.delete(controller);
      }
    },
    [abortPendingHardwareAlerts, serial],
  );

  const sendHardwareAlertForEpisode = useCallback(
    async (event: ClosureEvent) => {
      if (event.cameraSource !== 'this-device') return;
      await submitHardwareAlert(true, true, false);
    },
    [submitHardwareAlert],
  );
  onEpisodeStartRef.current = sendHardwareAlertForEpisode;

  const testHardwareAlert = useCallback(async () => {
    await submitHardwareAlert(false, false, true);
  }, [submitHardwareAlert]);

  useEffect(() => serial.subscribe(setUsbSerialStatus), [serial]);

  useEffect(() => {
    // A disconnected USB device, failed handshake, or cleared Wi-Fi URL makes
    // the selected transport unusable. Disable the toggle and drop in-flight
    // commands; nothing is retained for replay after reconnection.
    if (!hardwareAlertsEnabled || hardwareAlertReady) return;
    abortPendingHardwareAlerts();
    setHardwareAlertsEnabledState(false);
    setHardwareAlertStatus({
      tone: 'red',
      message:
        usbSerialStatus.message ??
        (hardwareTransport === 'usb'
          ? 'The USB alert device is no longer verified.'
          : 'The configured alert device URL is no longer valid.'),
      at: Date.now(),
    });
  }, [
    abortPendingHardwareAlerts,
    hardwareAlertReady,
    hardwareAlertsEnabled,
    hardwareTransport,
    usbSerialStatus.message,
  ]);

  const previousCameraKeyRef = useRef(activeCameraKey);
  useEffect(() => {
    const previousCameraKey = previousCameraKeyRef.current;
    previousCameraKeyRef.current = activeCameraKey;
    // A different webcam is a new episode source. Never let a command started
    // for the previous device be reported after the switch.
    if (hardwareAlertsEnabled && previousCameraKey !== activeCameraKey) {
      abortPendingHardwareAlerts();
    }
  }, [abortPendingHardwareAlerts, activeCameraKey, hardwareAlertsEnabled]);

  useEffect(() => () => abortPendingHardwareAlerts(), [abortPendingHardwareAlerts]);

  useEffect(() => audio.subscribe(setAudioState), [audio]);

  // Hidden tabs and page exits must silence an in-flight alert even if React
  // defers a state-driven effect until the page becomes visible again.
  useEffect(() => {
    const interrupt = () => {
      audio.stop();
      recorder.finishActive('tracking-interrupted');
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') interrupt();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', interrupt);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', interrupt);
    };
  }, [audio, recorder]);

  const applySettings = useCallback(
    (next: AppSettings) => {
      const sanitized = sanitizeSettings(next) ?? DEFAULT_SETTINGS;
      setTrackingDuration(sanitized.prolongedClosureMs);
      audio.setPreferences(sanitized.sound);
      setSettings(sanitized);
    },
    [audio, setTrackingDuration],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([store.getSettings(), store.listEvents()]).then(
      ([settingsResult, eventsResult]) => {
        if (cancelled) return;
        if (settingsResult.status === 'fulfilled' && settingsResult.value) {
          applySettings(settingsResult.value);
        } else if (settingsResult.status === 'fulfilled') {
          applySettings(DEFAULT_SETTINGS);
        } else {
          setStorageError(SETTINGS_SAVE_ERROR);
          applySettings(DEFAULT_SETTINGS);
        }
        if (eventsResult.status === 'fulfilled') {
          setEvents(sortEvents(eventsResult.value));
        } else {
          setStorageError('The local event history could not be read.');
        }
        setSettingsHydrated(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [applySettings, store]);

  useEffect(() => {
    if (!settingsHydrated) return;
    void store.saveSettings(settings).catch(() => setStorageError(SETTINGS_SAVE_ERROR));
  }, [settings, settingsHydrated, store]);

  const monitoring = tracking.state.monitoring;
  const trackingPhase = tracking.state.phase;
  const configuredDurationMs = tracking.prolongedClosureMs;

  useEffect(() => {
    if (!settingsHydrated) return;
    recorder.handle({
      monitoring,
      trackingRunning: trackingPhase === 'running',
      cameraLive,
      cameraSource: selectedCamera,
      configuredDurationMs,
    });
  }, [
    cameraLive,
    configuredDurationMs,
    monitoring,
    recorder,
    selectedCamera,
    settingsHydrated,
    trackingPhase,
  ]);

  // Escalation is deliberately separate from EpisodeRecorder: it never writes
  // history, plays browser audio, or creates another episode. This release keeps
  // the controller compiled and tested but gates it off at runtime; no START,
  // RENEW, or STOP command is issued while the flag is false. Firmware is not
  // changed by this gate.
  useEffect(() => {
    if (!USB_ESCALATION_RELEASE_ENABLED) {
      escalation.reset();
      return;
    }
    escalation.update({
      usbConnected,
      escalationSupported: usbSupportsEscalation(usbSerialStatus),
      hardwareAlertsEnabled,
      hardwareTransport,
      cameraLive,
      selectedCamera,
      cameraKey: activeCameraKey,
      monitoring: {
        status: monitoring.status,
        active: monitoring.active,
        reason: monitoring.reason,
        closureMs: monitoring.closureMs,
      },
      tracking: {
        phase: trackingPhase,
        facePresence: tracking.state.facePresence,
        staleReason: tracking.state.staleReason,
        lastInferenceCompletedAtMs: tracking.state.lastInferenceCompletedAtMs,
        calibrationStep: tracking.state.calibration.step,
      },
    });
  }, [
    activeCameraKey,
    cameraLive,
    escalation,
    hardwareAlertsEnabled,
    hardwareTransport,
    monitoring,
    selectedCamera,
    tracking.state,
    trackingPhase,
    usbConnected,
    usbSerialStatus,
  ]);

  const setProlongedClosureMs = useCallback(
    (value: number) => {
      setTrackingDuration(value);
      setSettings((current) => ({...current, prolongedClosureMs: value}));
    },
    [setTrackingDuration],
  );

  const enableSound = useCallback(async () => {
    audio.setPreferences({enabled: true});
    setSettings((current) => ({
      ...current,
      sound: {...current.sound, enabled: true},
    }));
    return audio.enable();
  }, [audio]);

  const testSound = useCallback(async () => {
    setSettings((current) => ({
      ...current,
      sound: {...current.sound, enabled: true},
    }));
    return audio.testSound();
  }, [audio]);

  const setMuted = useCallback(
    (muted: boolean) => {
      audio.setPreferences({muted});
      setSettings((current) => ({
        ...current,
        sound: {...current.sound, muted},
      }));
    },
    [audio],
  );

  const setVolume = useCallback(
    (volume: number) => {
      audio.setPreferences({volume});
      setSettings((current) => ({
        ...current,
        sound: {...current.sound, volume},
      }));
    },
    [audio],
  );

  const clearHistory = useCallback(async () => {
    try {
      await store.clearEvents();
      setEvents([]);
      setStorageError(null);
    } catch {
      setStorageError(EVENTS_CLEAR_ERROR);
    }
  }, [store]);

  const clearAllData = useCallback(async () => {
    try {
      await store.clearAll();
      setEvents([]);
      setSettings(DEFAULT_SETTINGS);
      setTrackingDuration(DEFAULT_SETTINGS.prolongedClosureMs);
      audio.setPreferences(DEFAULT_SETTINGS.sound);
      audio.stop();
      setStorageError(null);
    } catch {
      setStorageError(ALL_CLEAR_ERROR);
    }
  }, [audio, setTrackingDuration, store]);

  const exportJSON = useCallback(
    (exportEvents: readonly ClosureEvent[] = events) => {
      downloadTextFile(
        'drowsiness-events.json',
        formatEventsJSON(exportEvents, new Date().toISOString()),
        'application/json',
      );
    },
    [events],
  );

  const exportCSV = useCallback(
    (exportEvents: readonly ClosureEvent[] = events) => {
      downloadTextFile(
        'drowsiness-events.csv',
        formatEventsCSV(exportEvents),
        'text/csv;charset=utf-8',
      );
    },
    [events],
  );

  const value = useMemo<AlertsApi>(
    () => ({
      events,
      sessionId,
      sessionAlertCount: events.filter((event) => event.sessionId === sessionId).length,
      historicalAlertCount: events.length,
      storageStatus: !settingsHydrated
        ? 'loading'
        : storageError
          ? 'error'
          : 'available',
      storageError,
      settings,
      settingsHydrated,
      audio: audioState,
      hardwareAlertsEnabled,
      setHardwareAlertsEnabled,
      hardwareTransport,
      setHardwareTransport,
      hardwareAlertUrl,
      setHardwareAlertUrl,
      hardwareAlertReady,
      hardwareAlertStatus,
      usbSerialSupported,
      usbSerialStatus,
      usbEscalationStatus,
      connectUsbSerial,
      disconnectUsbSerial,
      testHardwareAlert,
      setProlongedClosureMs,
      enableSound,
      testSound,
      setMuted,
      setVolume,
      clearHistory,
      clearAllData,
      exportJSON,
      exportCSV,
    }),
    [
      audioState,
      clearAllData,
      clearHistory,
      enableSound,
      events,
      hardwareAlertStatus,
      hardwareAlertsEnabled,
      hardwareTransport,
      setHardwareTransport,
      hardwareAlertUrl,
      hardwareAlertReady,
      setHardwareAlertsEnabled,
      setHardwareAlertUrl,
      usbSerialStatus,
      usbSerialSupported,
      usbEscalationStatus,
      connectUsbSerial,
      disconnectUsbSerial,
      exportCSV,
      exportJSON,
      sessionId,
      setMuted,
      setProlongedClosureMs,
      setVolume,
      settings,
      settingsHydrated,
      storageError,
      testHardwareAlert,
      testSound,
    ],
  );

  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
}

export function useAlerts(): AlertsApi {
  const value = useContext(AlertsContext);
  if (!value) throw new Error('useAlerts must be used inside AlertsProvider');
  return value;
}
