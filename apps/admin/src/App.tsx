import {useEffect, useState} from 'react';
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
import {AlertsProvider} from './alerts/AlertsContext';
import {CameraProvider, useCamera} from './camera/CameraContext';
import {TrackingProvider, useTracking} from './vision/TrackingContext';
import type {NavRoute} from './types/dashboard';

export default function App() {
  return (
    <CameraProvider>
      <TrackingProvider>
        <AlertsProvider>
          <AdminApp />
        </AlertsProvider>
      </TrackingProvider>
    </CameraProvider>
  );
}

function AdminApp() {
  const [activeRoute, setActiveRoute] = useState<NavRoute>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const camera = useCamera();
  const tracking = useTracking();

  useEffect(() => {
    if (activeRoute !== 'live-monitoring') {
      tracking.stopTracking();
      camera.stopCamera();
    }
  }, [activeRoute, camera.stopCamera, tracking.stopTracking]);

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
                <SummaryCards />
              </div>

              <div className="order-1 flex flex-col lg:order-2 lg:col-span-8">
                <CameraPreviewCard
                  onSetupMonitoring={() => setSetupModalOpen(true)}
                />
              </div>

              <div className="order-3 flex flex-col gap-5 lg:col-span-4 lg:gap-6">
                <SystemStatusPanel />
                <RecentAlertsPanel />
              </div>
            </div>
          )}

          {activeRoute === 'live-monitoring' && <LiveMonitoringScreen />}

          {activeRoute === 'devices-hardware' && <DevicesHardwareScreen />}

          {activeRoute === 'alert-history' && <AlertHistoryScreen />}

          {activeRoute === 'settings' && <SettingsCalibrationScreen />}

          <footer className="flex items-center gap-2 border-t border-slate-800/80 pt-4 text-xs text-slate-400">
            <HardDrive
              className="h-3.5 w-3.5 shrink-0 text-slate-500"
              aria-hidden="true"
            />
            <span>
              Local USB/webcam monitoring, local eye tracking, guided calibration,
              experimental closure measurement, browser sound alerts, and local
              event history work in this browser. The ESP32 is an optional,
              separately configured LED/buzzer alert device over USB serial or
              Wi-Fi. Drowsiness classification and yawning detection remain
              unimplemented.
            </span>
          </footer>
        </main>
      </div>

      <SetupMonitoringModal
        open={setupModalOpen}
        onOpenLiveMonitoring={() => setActiveRoute('live-monitoring')}
        onClose={() => setSetupModalOpen(false)}
      />
    </div>
  );
}
