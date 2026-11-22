import type {ReactNode} from 'react';
import type {StatusTone} from '../types/dashboard';

interface StatusBadgeProps {
  icon: ReactNode;
  label: string;
  tone?: StatusTone;
  className?: string;
}

const TONE_STYLES: Record<StatusTone, string> = {
  neutral: 'text-slate-300 bg-slate-800/70 border-slate-700/80',
  teal: 'text-teal-200 bg-teal-500/12 border-teal-500/30',
  amber: 'text-amber-200 bg-amber-500/12 border-amber-500/30',
  red: 'text-red-200 bg-red-500/12 border-red-500/30',
};

const ICON_TONE_STYLES: Record<StatusTone, string> = {
  neutral: 'text-slate-400',
  teal: 'text-teal-400',
  amber: 'text-amber-400',
  red: 'text-red-400',
};

export function StatusBadge({
  icon,
  label,
  tone = 'neutral',
  className = '',
}: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 ${TONE_STYLES[tone]} ${className}`}
    >
      <span className={`shrink-0 ${ICON_TONE_STYLES[tone]}`} aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </span>
  );
}
