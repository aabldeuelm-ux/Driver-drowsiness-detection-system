import {
  CameraOff,
  CircleSlash,
  Cpu,
  Crosshair,
  Minus,
  MinusCircle,
  WifiOff,
} from 'lucide-react';
import {useAlerts} from '../alerts/AlertsContext';
import {useCamera} from '../camera/CameraContext';
import {useTracking} from '../vision/TrackingContext';
import type {SystemStatusRow} from '../types/dashboard';
import {StatusBadge} from './StatusBadge';

function getRowIcon(kind: SystemStatusRow['icon']) {
  switch (kind) {
    case 'camera':
      return <CameraOff className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />;
    case 'model':
      return <Cpu className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />;
    case 'calibration':
      return <Crosshair className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />;
    case 'esp32':
      return <WifiOff className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />;
  }
}

function getStatusIcon(kind: SystemStatusRow['icon'], isNotRequired: boolean) {
  if (isNotRequired) {
    return <Minus className="h-3.5 w-3.5" />;
  }
  switch (kind) {
    case 'camera':
    case 'esp32':
      return <MinusCircle className="h-3.5 w-3.5" />;
    case 'model':
    case 'calibration':
      return <CircleSlash className="h-3.5 w-3.5" />;
  }
}

export function SystemStatusPanel() {
  const {activeStatus, activeStatusLabel, activeTone, activeResolution} = useCamera();
  const {
    hardwareAlertReady,
    hardwareAlertsEnabled,
    hardwareTransport,
    usbSerialStatus,
  } = useAlerts();
  const tracking = useTracking();
  const resolution =
    activeResolution && activeStatus === 'live'
      ? `${activeResolution.width} × ${activeResolution.height}`
      : '—';

  const statusRows: SystemStatusRow[] = [
    {
      id: 'camera',
      label: 'Camera',
      value: activeStatusLabel,
      tone: activeStatus === 'live' ? activeTone : 'neutral',
      icon: 'camera',
    },
    {
      id: 'resolution',
      label: 'Camera resolution',
      value: resolution,
      tone: activeStatus === 'live' ? 'teal' : 'neutral',
      icon: 'camera',
    },
    {
      id: 'model',
      label: 'Face-tracking model',
      value: tracking.state.statusLabel,
      tone: tracking.state.tone,
      icon: 'model',
    },
    {
      id: 'tracking',
      label: 'Tracking result',
      value: tracking.state.faceLabel,
      tone: tracking.state.faceTone,
      icon: 'model',
    },
    {
      id: 'calibration',
      label: 'Calibration',
      value: tracking.state.calibrationLabel,
      tone: tracking.state.calibrationTone,
      icon: 'calibration',
    },
    {
      id: 'alert-device',
      label: 'Alert device',
      value: !hardwareAlertReady
        ? hardwareTransport === 'usb' && usbSerialStatus.state === 'error'
          ? 'USB error'
          : 'Not configured'
        : hardwareAlertsEnabled
          ? `${hardwareTransport === 'usb' ? 'USB' : 'Wi-Fi'} · enabled`
          : `${hardwareTransport === 'usb' ? 'USB' : 'Wi-Fi'} · ready`,
      tone: hardwareAlertReady
        ? 'teal'
        : hardwareTransport === 'usb' && usbSerialStatus.state === 'error'
          ? 'red'
          : 'neutral',
      icon: 'esp32',
    },
  ];

  return (
    <section
      aria-labelledby="system-status-heading"
      className="rounded-xl border border-slate-800/90 bg-[#10192D] p-4 sm:p-5"
    >
      <h2
        id="system-status-heading"
        className="text-base font-semibold tracking-tight text-slate-100"
      >
        System Status
      </h2>

      <ul className="mt-4 divide-y divide-slate-800/80">
        {statusRows.map((row) => {
          return (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 first:pt-1 last:pb-1"
            >
              <div className="flex items-center gap-2.5">
                {getRowIcon(row.icon)}
                <span className="text-sm font-medium text-slate-200">
                  {row.label}
                </span>
              </div>

              <StatusBadge
                icon={getStatusIcon(row.icon, false)}
                label={row.value}
                tone={row.tone}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
