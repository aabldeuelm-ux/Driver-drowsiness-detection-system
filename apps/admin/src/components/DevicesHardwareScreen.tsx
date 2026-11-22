import {
  AlertCircle,
  Bell,
  CheckCircle2,
  CircleSlash,
  HelpCircle,
  Info,
  Lightbulb,
  Minus,
  PowerOff,
  WifiOff,
} from 'lucide-react';
import {useAlerts} from '../alerts/AlertsContext';
import {HardwareAlertPanel} from './HardwareAlertPanel';
import {StatusBadge} from './StatusBadge';

export function DevicesHardwareScreen() {
  const alerts = useAlerts();
  const alertConfigured = alerts.hardwareAlertReady;

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-500/30 bg-teal-500/10 px-4 py-3.5 text-sm text-teal-100 sm:px-5">
        <div className="flex items-start gap-2.5">
          <Info
            className="mt-0.5 h-4 w-4 shrink-0 text-teal-400"
            aria-hidden="true"
          />
          <p className="leading-relaxed">
            <span className="font-medium">This device</span> is the camera source.
            Configure the ESP32 separately as an alert-only LED/buzzer device;
            no camera frames are fetched from it.
          </p>
        </div>

        <StatusBadge
          icon={<Minus className="h-3.5 w-3.5" />}
          label="Camera: This device"
          tone="teal"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:gap-6">
        {/* ESP32 alert-only connection */}
        <section
          aria-labelledby="alert-device-connection-heading"
          className="rounded-xl border border-slate-800/90 bg-[#10192D] p-4 sm:p-6 lg:col-span-7"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2
                id="alert-device-connection-heading"
                className="text-base font-semibold tracking-tight text-slate-100 sm:text-lg"
              >
                ESP32 Alert Device
              </h2>
              <p className="mt-0.5 text-xs text-slate-400 sm:text-sm">
                Separate from the camera source. Runs the camera-free alert
                controller and drives LED/buzzer only.
              </p>
            </div>

            <StatusBadge
              icon={<WifiOff className="h-3.5 w-3.5" />}
              label={alertConfigured ? 'Configured' : 'Not configured'}
              tone={alertConfigured ? 'teal' : 'neutral'}
            />
          </div>

          <div className="mt-5">
            <HardwareAlertPanel idPrefix="devices" />
          </div>

          <dl className="mt-6 divide-y divide-slate-800/80 border-t border-slate-800/80">
            <div className="flex flex-wrap items-center justify-between gap-2 py-3">
              <dt className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <WifiOff className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Connection status</span>
              </dt>
              <dd>
                <StatusBadge
                  icon={<WifiOff className="h-3.5 w-3.5" />}
                  label={
                    alerts.hardwareTransport === 'usb'
                      ? alerts.usbSerialStatus.device
                        ? alertConfigured
                          ? 'USB verified'
                          : 'USB failed'
                        : 'USB not connected'
                      : alertConfigured
                        ? 'Wi-Fi configured'
                        : 'Wi-Fi not configured'
                  }
                  tone={alertConfigured ? 'teal' : 'neutral'}
                />
              </dd>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 py-3">
              <dt className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <Minus className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Device role</span>
              </dt>
              <dd>
                <StatusBadge
                  icon={<Minus className="h-3.5 w-3.5" />}
                  label="Alerts only — no camera"
                  tone="teal"
                />
              </dd>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 py-3">
              <dt className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <HelpCircle className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Command endpoints</span>
              </dt>
              <dd>
                <StatusBadge
                  icon={<HelpCircle className="h-3.5 w-3.5" />}
                  label={
                    alerts.hardwareTransport === 'usb'
                      ? 'DDD1 serial protocol'
                      : '/led_test · /buzzer_test'
                  }
                />
              </dd>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 py-3 pb-1">
              <dt className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <HelpCircle className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Session toggle</span>
              </dt>
              <dd>
                <StatusBadge
                  icon={<HelpCircle className="h-3.5 w-3.5" />}
                  label={alerts.hardwareAlertsEnabled ? 'Enabled' : 'Disabled'}
                  tone={alerts.hardwareAlertsEnabled ? 'teal' : 'neutral'}
                />
              </dd>
            </div>
          </dl>
        </section>

        {/* Reported by firmware vs Manually verified */}
        <section
          aria-labelledby="verification-split-heading"
          className="rounded-xl border border-slate-800/90 bg-[#10192D] p-4 sm:p-6 lg:col-span-5"
        >
          <h2
            id="verification-split-heading"
            className="text-base font-semibold tracking-tight text-slate-100 sm:text-lg"
          >
            Hardware Verification
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400 sm:text-sm">
            Distinguishes data reported by the microcontroller from manual bench checks.
          </p>

          <div className="mt-5 space-y-5">
            <div>
              <h3 className="text-xs font-semibold tracking-wide text-slate-300">
                Reported by firmware
              </h3>
              <ul className="mt-2 divide-y divide-slate-800/80 border-t border-slate-800/80">
                <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="text-sm text-slate-300">Camera role</span>
                  <StatusBadge
                    icon={<HelpCircle className="h-3.5 w-3.5" />}
                    label="Not used on alert device"
                  />
                </li>
                <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="text-sm text-slate-300">Firmware version</span>
                  <StatusBadge
                    icon={<HelpCircle className="h-3.5 w-3.5" />}
                    label={
                      alerts.hardwareTransport === 'usb' && alerts.usbSerialStatus.build
                        ? alerts.usbSerialStatus.build
                        : 'Unknown'
                    }
                  />
                </li>
                <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="text-sm text-slate-300">Snapshot polling</span>
                  <StatusBadge
                    icon={<HelpCircle className="h-3.5 w-3.5" />}
                    label="None"
                  />
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-semibold tracking-wide text-slate-300">
                Manually verified
              </h3>
              <ul className="mt-2 divide-y divide-slate-800/80 border-t border-slate-800/80">
                <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="text-sm text-slate-300">Buzzer wiring &amp; polarity</span>
                  <StatusBadge
                    icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                    label="Isolated bench test passed"
                    tone="teal"
                  />
                </li>
                <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="text-sm text-slate-300">Status LED resistor &amp; pin</span>
                  <StatusBadge
                    icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                    label="Isolated bench test passed"
                    tone="teal"
                  />
                </li>
              </ul>
            </div>

            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/8 p-3.5 text-xs leading-relaxed text-amber-200/90">
              <AlertCircle
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"
                aria-hidden="true"
              />
              <p>
                Physical LED and buzzer behavior was verified end to end on the tested setup. This panel reports command submission or device acknowledgment only; the app cannot confirm physical activation on another laptop.
              </p>
            </div>
          </div>
        </section>

        {/* Peripheral Configuration Placeholders */}
        <section
          aria-labelledby="peripherals-heading"
          className="rounded-xl border border-slate-800/90 bg-[#10192D] p-4 sm:p-6 lg:col-span-12"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2
                id="peripherals-heading"
                className="text-base font-semibold tracking-tight text-slate-100 sm:text-lg"
              >
                Alert Outputs &amp; Peripherals
              </h2>
              <p className="mt-0.5 text-xs text-slate-400 sm:text-sm">
                Session-only ESP32 alert commands triggered by webcam closure
                episodes, plus the disabled motor output.
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-slate-800 bg-[#0B1221] p-3.5 text-xs leading-relaxed text-slate-400">
            Transport selection, USB verification, the session-only toggle, and the
            manual hardware test are in the <span className="font-medium text-slate-200">ESP32 Alert Device</span> panel above. Each closure episode uses the selected transport once; no retry is queued. The firmware's five-second escalation capability exists, but this release keeps it disabled; only the original one-shot LED/buzzer alert is active.
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-3">
            {/* Buzzer placeholder */}
            <div className="space-y-3 border-t border-slate-800/80 pt-4 md:border-t-0 md:pt-0">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium text-slate-100">
                  <Bell className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  <span>Buzzer</span>
                </span>
                <StatusBadge
                  icon={<Bell className="h-3.5 w-3.5" />}
                  label="GPIO14 · active-low"
                  tone={alerts.hardwareAlertsEnabled ? 'teal' : 'neutral'}
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="buzzer-pin-input"
                  className="block text-xs font-medium text-slate-400"
                >
                  GPIO pin placeholder
                </label>
                <input
                  id="buzzer-pin-input"
                  type="text"
                  disabled
                  value="GPIO14"
                  placeholder="GPIO14"
                  className="min-h-[40px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3 py-2 font-mono text-xs text-slate-400 placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-75"
                />
                <label
                  htmlFor="buzzer-mode-select"
                  className="block text-xs font-medium text-slate-400"
                >
                  Trigger pattern
                </label>
                <select
                  id="buzzer-mode-select"
                  disabled
                  defaultValue="2khz"
                  className="min-h-[40px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3 py-2 text-xs text-slate-400 disabled:cursor-not-allowed disabled:opacity-75"
                >
                  <option value="2khz">1-second 2 kHz square wave</option>
                </select>
              </div>
            </div>

            {/* LED placeholder */}
            <div className="space-y-3 border-t border-slate-800/80 pt-4 md:border-t-0 md:border-l md:border-slate-800/80 md:pl-5 md:pt-0">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium text-slate-100">
                  <Lightbulb className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  <span>Status LED</span>
                </span>
                <StatusBadge
                  icon={<Lightbulb className="h-3.5 w-3.5" />}
                  label="GPIO13 · active-low"
                  tone={alerts.hardwareAlertsEnabled ? 'teal' : 'neutral'}
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="led-pin-input"
                  className="block text-xs font-medium text-slate-400"
                >
                  GPIO pin placeholder
                </label>
                <input
                  id="led-pin-input"
                  type="text"
                  disabled
                  value="GPIO13"
                  placeholder="GPIO13"
                  className="min-h-[40px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3 py-2 font-mono text-xs text-slate-400 placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-75"
                />
                <label
                  htmlFor="led-behavior-select"
                  className="block text-xs font-medium text-slate-400"
                >
                  Indicator behavior
                </label>
                <select
                  id="led-behavior-select"
                  disabled
                  defaultValue="low-pulse"
                  className="min-h-[40px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3 py-2 text-xs text-slate-400 disabled:cursor-not-allowed disabled:opacity-75"
                >
                  <option value="low-pulse">Bounded 1-second LOW pulse</option>
                </select>
              </div>
            </div>

            {/* Motor disabled */}
            <div className="space-y-3 border-t border-slate-800/80 pt-4 md:border-t-0 md:border-l md:border-slate-800/80 md:pl-5 md:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium text-slate-100">
                  <PowerOff className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  <span>Motor output</span>
                </span>
                <StatusBadge
                  icon={<CircleSlash className="h-3.5 w-3.5" />}
                  label="Disabled"
                />
              </div>

              <div className="rounded-lg border border-slate-800 bg-[#0B1221] p-3.5">
                <p className="text-sm font-medium text-slate-200">
                  Motor driver hardware unavailable
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  Haptic or actuator motor controls remain locked until compatible motor driver hardware is attached and verified.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
