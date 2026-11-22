import {useState} from 'react';
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  CircleSlash,
  Cpu,
  HelpCircle,
  Info,
  Lightbulb,
  Minus,
  PlugZap,
  PowerOff,
  Radio,
  WifiOff,
} from 'lucide-react';
import type {CameraSource} from '../types/dashboard';
import {StatusBadge} from './StatusBadge';

interface DevicesHardwareScreenProps {
  selectedCamera: CameraSource;
}

export function DevicesHardwareScreen({
  selectedCamera,
}: DevicesHardwareScreenProps) {
  const [espAddress, setEspAddress] = useState('');
  const isThisDevice = selectedCamera === 'this-device';

  return (
    <div className="space-y-5 sm:space-y-6">
      {isThisDevice && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-500/30 bg-teal-500/10 px-4 py-3.5 text-sm text-teal-100 sm:px-5">
          <div className="flex items-start gap-2.5">
            <Info
              className="mt-0.5 h-4 w-4 shrink-0 text-teal-400"
              aria-hidden="true"
            />
            <p className="leading-relaxed">
              <span className="font-medium">This device</span> is selected as your camera source. ESP32 hardware is optional when using this device&apos;s built-in camera or connected webcam.
            </p>
          </div>

          <StatusBadge
            icon={<Minus className="h-3.5 w-3.5" />}
            label="ESP32: Not required"
            tone="teal"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:gap-6">
        {/* ESP32-CAM Connection & Telemetry */}
        <section
          aria-labelledby="esp32-connection-heading"
          className="rounded-xl border border-slate-800/90 bg-[#10192D] p-4 sm:p-6 lg:col-span-7"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2
                id="esp32-connection-heading"
                className="text-base font-semibold tracking-tight text-slate-100 sm:text-lg"
              >
                ESP32-CAM Connection
              </h2>
              <p className="mt-0.5 text-xs text-slate-400 sm:text-sm">
                Optional Wi-Fi camera and alert module on your local network.
              </p>
            </div>

            <StatusBadge
              icon={
                isThisDevice ? (
                  <Minus className="h-3.5 w-3.5" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5" />
                )
              }
              label={isThisDevice ? 'Not required' : 'Not connected'}
            />
          </div>

          <div className="mt-5 space-y-2">
            <label
              htmlFor="esp32-address-input"
              className="block text-xs font-medium text-slate-300 sm:text-sm"
            >
              ESP32 stream or device address
            </label>
            <div className="flex flex-col gap-2.5 sm:flex-row">
              <input
                id="esp32-address-input"
                type="text"
                value={espAddress}
                onChange={(event) => setEspAddress(event.target.value)}
                placeholder="http://192.168.4.1"
                className="min-h-[44px] flex-1 rounded-lg border border-slate-800 bg-[#0B1221] px-3.5 py-2.5 font-mono text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              />
              <button
                type="button"
                disabled
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-teal-500/30 px-5 py-2.5 text-sm font-semibold text-teal-200/70 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
              >
                <PlugZap className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Connect</span>
              </button>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Connection requests are disabled in this interface prototype. ESP32 is optional when using this device&apos;s camera.
            </p>
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
                  label="Not connected"
                />
              </dd>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 py-3">
              <dt className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <Cpu className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>ESP32 requirement</span>
              </dt>
              <dd>
                <StatusBadge
                  icon={
                    isThisDevice ? (
                      <Minus className="h-3.5 w-3.5" />
                    ) : (
                      <CircleSlash className="h-3.5 w-3.5" />
                    )
                  }
                  label={isThisDevice ? 'Not required' : 'Optional / Not connected'}
                />
              </dd>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 py-3">
              <dt className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <HelpCircle className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Sensor</span>
              </dt>
              <dd>
                <StatusBadge
                  icon={<HelpCircle className="h-3.5 w-3.5" />}
                  label="Unknown"
                />
              </dd>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 py-3 pb-1">
              <dt className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <Radio className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Last heartbeat</span>
              </dt>
              <dd>
                <StatusBadge
                  icon={<HelpCircle className="h-3.5 w-3.5" />}
                  label="Unknown"
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
                  <span className="text-sm text-slate-300">Camera sensor</span>
                  <StatusBadge
                    icon={<HelpCircle className="h-3.5 w-3.5" />}
                    label="Unknown"
                  />
                </li>
                <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="text-sm text-slate-300">Firmware version</span>
                  <StatusBadge
                    icon={<HelpCircle className="h-3.5 w-3.5" />}
                    label="Unknown"
                  />
                </li>
                <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="text-sm text-slate-300">Last heartbeat</span>
                  <StatusBadge
                    icon={<HelpCircle className="h-3.5 w-3.5" />}
                    label="Unknown"
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
                    label="Not verified"
                  />
                </li>
                <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="text-sm text-slate-300">Status LED resistor &amp; pin</span>
                  <StatusBadge
                    icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                    label="Not verified"
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
                Passive components such as piezo buzzers and indicator LEDs cannot be automatically identified by the firmware and require manual verification.
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
                Configuration placeholders for local buzzer, indicator LED, and disabled motor output.
              </p>
            </div>
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
                  icon={<CircleSlash className="h-3.5 w-3.5" />}
                  label="Not configured"
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
                  value=""
                  placeholder="Not assigned"
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
                  defaultValue=""
                  className="min-h-[40px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3 py-2 text-xs text-slate-400 disabled:cursor-not-allowed disabled:opacity-75"
                >
                  <option value="">Prototype placeholder (disabled)</option>
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
                  icon={<CircleSlash className="h-3.5 w-3.5" />}
                  label="Not configured"
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
                  value=""
                  placeholder="Not assigned"
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
                  defaultValue=""
                  className="min-h-[40px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3 py-2 text-xs text-slate-400 disabled:cursor-not-allowed disabled:opacity-75"
                >
                  <option value="">Prototype placeholder (disabled)</option>
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
