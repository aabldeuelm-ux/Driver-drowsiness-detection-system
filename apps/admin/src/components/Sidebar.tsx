import {useEffect} from 'react';
import {
  BellRing,
  Cpu,
  Eye,
  LayoutDashboard,
  SlidersHorizontal,
  Video,
  X,
} from 'lucide-react';
import type {NavRoute} from '../types/dashboard';

export interface NavItem {
  id: NavRoute;
  label: string;
  icon: typeof LayoutDashboard;
}

export const NAV_ITEMS: NavItem[] = [
  {id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard},
  {id: 'live-monitoring', label: 'Live Monitoring', icon: Video},
  {id: 'devices-hardware', label: 'Devices & Hardware', icon: Cpu},
  {id: 'alert-history', label: 'Alert History', icon: BellRing},
  {id: 'settings', label: 'Settings & Calibration', icon: SlidersHorizontal},
];

interface SidebarProps {
  activeRoute: NavRoute;
  onSelectRoute: (route: NavRoute) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  activeRoute,
  onSelectRoute,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  useEffect(() => {
    if (!mobileOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseMobile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen, onCloseMobile]);

  const handleNavigate = (route: NavRoute) => {
    onSelectRoute(route);
    onCloseMobile();
  };

  const navContent = (
    <div className="flex h-full flex-col justify-between bg-[#0B1221] text-slate-100">
      <div>
        <div className="flex items-start justify-between gap-3 border-b border-slate-800/80 px-5 py-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-teal-500/30 bg-teal-500/10 text-teal-400">
              <Eye className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <span className="block text-sm font-semibold leading-snug tracking-tight text-slate-100">
                Driver Drowsiness Detection System
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation menu"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800/70 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 lg:hidden"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Primary" className="space-y-1 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeRoute === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-left text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
                  isActive
                    ? 'bg-[#131F36] text-teal-300'
                    : 'text-slate-300 hover:bg-slate-800/50 hover:text-slate-100'
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? 'text-teal-400' : 'text-slate-400'
                  }`}
                  aria-hidden="true"
                />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-slate-800/80 px-5 py-4">
        <p className="text-xs leading-relaxed text-slate-400">
          Local browser workspace. No cloud account or fleet sync enabled.
        </p>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden w-64 shrink-0 border-r border-slate-800/80 lg:block">
        <div className="sticky top-0 h-screen">{navContent}</div>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          <div
            className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs transition-opacity"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full w-72 max-w-[85vw] border-r border-slate-800 shadow-2xl">
            {navContent}
          </div>
        </div>
      )}
    </>
  );
}
