export type NavRoute =
  | 'dashboard'
  | 'live-monitoring'
  | 'devices-hardware'
  | 'alert-history'
  | 'settings';

/** `esp32-cam` is retained only so older stored events remain readable. */
export type CameraSource = 'this-device' | 'esp32-cam' | null;

export type StatusTone = 'neutral' | 'teal' | 'amber' | 'red';

export interface SystemStatusRow {
  id: string;
  label: string;
  value: string;
  tone: StatusTone;
  icon: 'camera' | 'model' | 'calibration' | 'esp32';
}

export interface AlertItem {
  id: string;
  severity: 'warning' | 'critical';
  title: string;
  timestamp: string;
  durationMs: number;
}
