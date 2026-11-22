import {FlaskConical, Menu} from 'lucide-react';

interface TopBarProps {
  title: string;
  onOpenMobileMenu: () => void;
}

export function TopBar({title, onOpenMobileMenu}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#080E1A]/95 backdrop-blur-sm">
      <div className="mx-auto flex min-h-14 max-w-[1360px] flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2 sm:min-h-16 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onOpenMobileMenu}
            aria-label="Open navigation menu"
            className="-ml-1.5 inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800/70 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
            <span>Menu</span>
          </button>

          <span
            className="h-4 w-px bg-slate-800 lg:hidden"
            aria-hidden="true"
          />

          <h1 className="text-base font-semibold tracking-tight text-slate-100 sm:text-xl">
            {title}
          </h1>
        </div>

        <div className="flex shrink-0 items-center">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200 whitespace-nowrap shrink-0">
            <FlaskConical
              className="h-3.5 w-3.5 shrink-0 text-amber-400"
              aria-hidden="true"
            />
            <span>Experimental prototype</span>
          </span>
        </div>
      </div>
    </header>
  );
}
