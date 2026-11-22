import {useState} from 'react';
import {HardDrive} from 'lucide-react';
import {AlertHistoryScreen} from './components/AlertHistoryScreen';
import {CameraPreviewCard} from './components/CameraPreviewCard';
import {DevicesHardwareScreen} from './components/DevicesHardwareScreen';
import {LiveMonitoringScreen} from './components/LiveMonitoringScreen';
import {RecentAlertsPanel} from './components/RecentAlertsPanel';
import {SettingsCalibrationScreen} from './components/SettingsCalibrationScreen';
import {SetupMonitoringModal} from './components/SetupMonitoringModal';
import {NAV_ITEMS, Sidebar} from './components/Sidebar';
import {SummaryCards} from './components/SummaryCards';
import {SystemStatusPanel} from './components/SystemStatusPanel';
import {TopBar} from './components/TopBar';
import type {CameraSource, NavRoute} from './types/dashboard';

export default function App() {
  const [activeRoute, setActiveRoute] = useState<NavRoute>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState<CameraSource>(null);
  const [setupModalOpen, setSetupModalOpen] = useState(false);

  const currentNavItem =
    NAV_ITEMS.find((item) => item.id === activeRoute) ?? NAV_ITEMS[0];

  return (
    <div className="flex min-h-screen w-full overflow-x-hidden bg-[#080E1A] text-slate-100">
      <Sidebar
        activeRoute={activeRoute}
        onSelectRoute={setActiveRoute}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={currentNavItem.label}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        <main className="mx-auto flex w-full max-w-[1360px] flex-1 flex-col justify-between gap-6 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
          {activeRoute === 'dashboard' && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:gap-6">
              <div className="order-2 lg:order-1 lg:col-span-12">
                <SummaryCards selectedCamera={selectedCamera} />
              </div>

              <div className="order-1 flex flex-col lg:order-2 lg:col-span-8">
                <CameraPreviewCard
                  selectedCamera={selectedCamera}
                  onSelectCamera={setSelectedCamera}
                  onSetupMonitoring={() => setSetupModalOpen(true)}
                />
              </div>

              <div className="order-3 flex flex-col gap-5 lg:col-span-4 lg:gap-6">
                <SystemStatusPanel selectedCamera={selectedCamera} />
                <RecentAlertsPanel />
              </div>
            </div>
          )}

          {activeRoute === 'live-monitoring' && (
            <LiveMonitoringScreen
              selectedCamera={selectedCamera}
              onSelectCamera={setSelectedCamera}
            />
          )}

          {activeRoute === 'devices-hardware' && (
            <DevicesHardwareScreen selectedCamera={selectedCamera} />
          )}

          {activeRoute === 'alert-history' && <AlertHistoryScreen />}

          {activeRoute === 'settings' && <SettingsCalibrationScreen />}

          <footer className="flex items-center gap-2 border-t border-slate-800/80 pt-4 text-xs text-slate-400">
            <HardDrive
              className="h-3.5 w-3.5 shrink-0 text-slate-500"
              aria-hidden="true"
            />
            <span>Settings and event history are saved in this browser.</span>
          </footer>
        </main>
      </div>

      <SetupMonitoringModal
        open={setupModalOpen}
        selectedCamera={selectedCamera}
        onSelectCamera={setSelectedCamera}
        onOpenLiveMonitoring={() => setActiveRoute('live-monitoring')}
        onClose={() => setSetupModalOpen(false)}
      />
    </div>
  );
}
