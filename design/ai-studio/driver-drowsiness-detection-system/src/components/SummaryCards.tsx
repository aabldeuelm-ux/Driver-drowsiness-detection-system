import type {ReactNode} from 'react';
import {
  Camera,
  CameraOff,
  CirclePause,
  Clock,
  ShieldAlert,
} from 'lucide-react';
import type {CameraSource} from '../types/dashboard';

interface SummaryCardProps {
  label: string;
  value: string;
  detail?: string;
  icon: ReactNode;
  monoValue?: boolean;
  tone?: 'neutral' | 'teal' | 'amber' | 'red';
}

export function SummaryCard({
  label,
  value,
  detail,
  icon,
  monoValue = false,
  tone = 'neutral',
}: SummaryCardProps) {
  const iconToneClass =
    tone === 'teal'
      ? 'border-teal-500/30 bg-teal-500/10 text-teal-400'
      : tone === 'amber'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
        : tone === 'red'
          ? 'border-red-500/30 bg-red-500/10 text-red-400'
          : 'border-slate-700/80 bg-slate-800/70 text-slate-400';

  return (
    <div className="rounded-xl border border-slate-800/90 bg-[#10192D] px-4 py-3.5 sm:p-5">
      <div className="flex items-center justify-between gap-3 sm:items-start">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-400 sm:text-sm">{label}</p>
          <p
            className={`mt-1 text-base font-semibold tracking-tight text-slate-100 sm:mt-2 sm:text-xl ${
              monoValue ? 'font-mono tabular-nums' : ''
            }`}
          >
            {value}
          </p>
          {detail && (
            <p className="mt-1 text-xs text-slate-400">{detail}</p>
          )}
        </div>

        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${iconToneClass}`}
          aria-hidden="true"
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

interface SummaryCardsProps {
  selectedCamera: CameraSource;
}

export function SummaryCards({selectedCamera}: SummaryCardsProps) {
  const cameraLabel =
    selectedCamera === 'this-device'
      ? 'This device'
      : selectedCamera === 'esp32-cam'
        ? 'ESP32-CAM'
        : 'Not selected';

  const cameraDetail = selectedCamera ? 'Selected · Not connected' : undefined;

  return (
    <section aria-label="Session summary">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <SummaryCard
          label="Monitoring"
          value="Not started"
          icon={<CirclePause className="h-4 w-4" />}
        />
        <SummaryCard
          label="Camera"
          value={cameraLabel}
          detail={cameraDetail}
          tone={selectedCamera ? 'teal' : 'neutral'}
          icon={
            selectedCamera ? (
              <Camera className="h-4 w-4" />
            ) : (
              <CameraOff className="h-4 w-4" />
            )
          }
        />
        <SummaryCard
          label="Session duration"
          value="—"
          monoValue
          icon={<Clock className="h-4 w-4" />}
        />
        <SummaryCard
          label="Alerts this session"
          value="0"
          monoValue
          icon={<ShieldAlert className="h-4 w-4" />}
        />
      </div>
    </section>
  );
}
