import {
  CameraOff,
  CircleSlash,
  Cpu,
  Crosshair,
  Minus,
  MinusCircle,
  WifiOff,
} from 'lucide-react';
import type {CameraSource, SystemStatusRow} from '../types/dashboard';
import {StatusBadge} from './StatusBadge';

interface SystemStatusPanelProps {
  selectedCamera: CameraSource;
}

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

export function SystemStatusPanel({selectedCamera}: SystemStatusPanelProps) {
  const isThisDevice = selectedCamera === 'this-device';

  const statusRows: SystemStatusRow[] = [
    {
      id: 'camera',
      label: 'Camera',
      value: 'Not connected',
      tone: 'neutral',
      icon: 'camera',
    },
    {
      id: 'model',
      label: 'Detection model',
      value: 'Not loaded',
      tone: 'neutral',
      icon: 'model',
    },
    {
      id: 'calibration',
      label: 'Calibration',
      value: 'Not completed',
      tone: 'neutral',
      icon: 'calibration',
    },
    {
      id: 'esp32',
      label: 'ESP32',
      value: isThisDevice ? 'Not required' : 'Not connected',
      tone: 'neutral',
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
          const isNotRequired = row.id === 'esp32' && isThisDevice;
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
                icon={getStatusIcon(row.icon, isNotRequired)}
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
