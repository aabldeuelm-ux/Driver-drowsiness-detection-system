import {AlertCircle, Cable, CheckCircle2, Usb} from 'lucide-react';
import {useAlerts} from '../alerts/AlertsContext';
import {USB_ESCALATION_RELEASE_ENABLED} from '../alerts/usbEscalationController';
import type {UsbSerialConnectionState, UsbSerialStatus} from '../alerts/usbSerialAlert';
import {StatusBadge} from './StatusBadge';

interface HardwareAlertPanelProps {
  idPrefix: string;
}

const USB_STATE_LABEL: Record<UsbSerialConnectionState, string> = {
  unsupported: 'Unsupported browser',
  disconnected: 'Not connected',
  connecting: 'Awaiting permission',
  verifying: 'Verifying',
  connected: 'Verified',
  error: 'Connection error',
};

const USB_STATE_TONE: Record<
  UsbSerialConnectionState,
  'neutral' | 'teal' | 'amber' | 'red'
> = {
  unsupported: 'red',
  disconnected: 'neutral',
  connecting: 'amber',
  verifying: 'amber',
  connected: 'teal',
  error: 'red',
};

function getUsbNextAction(supported: boolean, status: UsbSerialStatus): string | null {
  if (!supported || status.state === 'connected') return null;

  if (status.state === 'error') {
    const detail = status.message?.toLowerCase() ?? '';
    if (detail.includes('handshake') || detail.includes('unexpected')) {
      return 'Confirm the ESP32 is running build usb-serial-alert-controller-2026-11-22-v3, then click Connect USB alert device again and select the same serial port.';
    }
    return 'Check the USB data cable, close other serial monitors, then click Connect USB alert device again and select the ESP32 serial port.';
  }
  if (status.state === 'unsupported') {
    return 'Use desktop Chrome or Edge from an HTTPS address, then reload the page.';
  }
  if (status.state === 'disconnected') {
    return 'Connect the ESP32 by USB data cable, then click Connect USB alert device and choose its serial port.';
  }
  if (status.state === 'connecting') {
    return 'Approve the browser serial-port prompt for the ESP32 device.';
  }
  return 'Wait for the handshake to finish; keep the ESP32 connected and its serial port free.';
}

export function HardwareAlertPanel({idPrefix}: HardwareAlertPanelProps) {
  const alerts = useAlerts();
  const usb = alerts.usbSerialStatus;
  const isUsb = alerts.hardwareTransport === 'usb';
  const usbBusy = usb.state === 'connecting' || usb.state === 'verifying';
  const usbNextAction = getUsbNextAction(alerts.usbSerialSupported, usb);
  const escalationSupported = usb.features.includes('escalation');
  const transportLabel = isUsb ? 'USB serial' : 'Wi-Fi';

  return (
    <div className="space-y-3.5 rounded-lg border border-slate-800 bg-[#0B1221] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          htmlFor={`${idPrefix}-hardware-transport`}
          className="text-xs font-medium text-slate-300 sm:text-sm"
        >
          Alert transport
        </label>
        <StatusBadge
          icon={<Cable className="h-3.5 w-3.5" />}
          label={transportLabel}
          tone={isUsb ? 'teal' : 'neutral'}
        />
      </div>

      <select
        id={`${idPrefix}-hardware-transport`}
        value={alerts.hardwareTransport}
        onChange={(event) =>
          alerts.setHardwareTransport(event.target.value as 'wifi' | 'usb')
        }
        className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#10192D] px-3.5 py-2.5 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
      >
        <option value="wifi">Wi-Fi alert controller (fallback)</option>
        <option value="usb">USB serial alert controller (portable)</option>
      </select>
      <p className="text-xs leading-relaxed text-slate-400">
        Wi-Fi needs the controller address on each laptop. USB needs one firmware
        upload, then only browser permission and the cable on any second laptop.
      </p>

      {isUsb ? (
        <div className="space-y-2.5 border-t border-slate-800/80 pt-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs font-medium text-slate-300 sm:text-sm">
              <Usb className="h-4 w-4 text-slate-400" aria-hidden="true" />
              USB alert device
            </span>
            <StatusBadge
              icon={<Usb className="h-3.5 w-3.5" />}
              label={USB_STATE_LABEL[usb.state]}
              tone={USB_STATE_TONE[usb.state]}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span>Web Serial</span>
            <StatusBadge
              icon={
                alerts.usbSerialSupported ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5" />
                )
              }
              label={alerts.usbSerialSupported ? 'Available' : 'Unavailable'}
              tone={alerts.usbSerialSupported ? 'teal' : 'red'}
            />
          </div>

          {!alerts.usbSerialSupported ? (
            <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs leading-relaxed text-red-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
              <span>
                Web Serial is unavailable in this browser. Use desktop Chrome or
                Edge from an HTTPS address. Wi-Fi remains available as a fallback.
              </span>
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  id={`${idPrefix}-connect-usb-alert`}
                  type="button"
                  onClick={() => void alerts.connectUsbSerial()}
                  disabled={usbBusy || usb.state === 'connected'}
                  className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-teal-500/40 bg-teal-500/10 px-3.5 py-2 text-sm font-medium text-teal-200 transition-colors hover:bg-teal-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {usbBusy ? 'Verifying device...' : 'Connect USB alert device'}
                </button>
                {usb.state === 'connected' && (
                  <button
                    id={`${idPrefix}-disconnect-usb-alert`}
                    type="button"
                    onClick={() => void alerts.disconnectUsbSerial()}
                    className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-slate-700 bg-slate-800/70 px-3.5 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700"
                  >
                    Disconnect
                  </button>
                )}
              </div>
              <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed text-slate-400">
                <li>Use desktop Chrome or Edge from an HTTPS address.</li>
                <li>
                  Connect the ESP32 running build{' '}
                  <code className="font-mono text-slate-300">...2026-11-22-v3</code> by
                  USB data cable.
                </li>
                <li>
                  Choose the serial port in the browser prompt; the app verifies
                  the device identity before allowing hardware alerts.
                </li>
              </ol>
              {usb.message && (
                <p
                  role="status"
                  aria-live="polite"
                  className={`flex items-start gap-2 text-xs leading-relaxed ${
                    usb.state === 'connected'
                      ? 'text-teal-200'
                      : usb.state === 'error' || usb.state === 'unsupported'
                        ? 'text-red-300'
                        : 'text-amber-200'
                  }`}
                >
                  {usb.state === 'connected' && (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                  <span>{usb.message}</span>
                </p>
              )}
              {usbNextAction && (
                <div
                  className={`flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed ${
                    usb.state === 'error'
                      ? 'border-red-500/30 bg-red-500/10 text-red-200'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                  }`}
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <div className="space-y-0.5">
                    <p className="font-medium">What to do next</p>
                    <p>{usbNextAction}</p>
                  </div>
                </div>
              )}
              {usb.state === 'connected' && (
                <p className="text-xs leading-relaxed text-teal-200">
                  Connected and verified. The HELLO handshake was acknowledged;
                  hardware alerts stay off until you enable the session toggle.
                </p>
              )}
              {usb.state === 'connected' && (
                <dl className="grid grid-cols-1 gap-1 rounded-lg border border-slate-800 bg-[#10192D] p-3 text-xs sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="text-slate-500">Device</dt>
                    <dd className="truncate font-mono text-slate-200">{usb.device}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-slate-500">Firmware build</dt>
                    <dd className="truncate font-mono text-slate-200">
                      {usb.build || 'not reported'}
                    </dd>
                  </div>
                  <div className="min-w-0 sm:col-span-2">
                    <dt className="text-slate-500">Features</dt>
                    <dd className="truncate font-mono text-slate-200">
                      {usb.features.length > 0 ? usb.features.join(', ') : 'none reported'}
                    </dd>
                  </div>
                </dl>
              )}
              {usb.state === 'connected' && (
                <div className="space-y-1.5 rounded-lg border border-slate-800 bg-[#10192D] p-3">
                  <p className="text-xs leading-relaxed text-slate-400">
                    {!USB_ESCALATION_RELEASE_ENABLED
                      ? `Five-second escalation is disabled in this release. ${escalationSupported ? 'The connected firmware supports it, but the app will not start it.' : 'Basic one-shot alerts remain active.'}`
                      : escalationSupported
                        ? 'After 5 seconds of continuous bilateral closure, the 2 kHz tone repeats 500 ms ON / 500 ms OFF. It stops as soon as closure evidence becomes invalid.'
                        : 'This firmware does not advertise escalation. Basic one-shot alerts still work; update the USB sketch to enable escalation.'}
                  </p>
                  {alerts.usbEscalationStatus.message && (
                    <p
                      role="status"
                      aria-live="polite"
                      className={`text-xs leading-relaxed ${
                        alerts.usbEscalationStatus.active
                          ? 'text-amber-200'
                          : 'text-teal-200'
                      }`}
                    >
                      {alerts.usbEscalationStatus.message}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2 border-t border-slate-800/80 pt-3.5">
          <label
            htmlFor={`${idPrefix}-alert-device-url`}
            className="block text-xs font-medium text-slate-300 sm:text-sm"
          >
            ESP32 alert device URL
          </label>
          <input
            id={`${idPrefix}-alert-device-url`}
            type="text"
            inputMode="url"
            autoComplete="off"
            value={alerts.hardwareAlertUrl}
            onChange={(event) => alerts.setHardwareAlertUrl(event.target.value)}
            placeholder="http://192.168.1.50/"
            className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#10192D] px-3.5 py-2.5 font-mono text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          />
          <p className="text-xs leading-relaxed text-slate-400">
            The app derives <code className="font-mono text-slate-300">/led_test</code> and{' '}
            <code className="font-mono text-slate-300">/buzzer_test</code>. Never put Wi-Fi
            credentials in this URL. Deployed HTTPS pages cannot fetch a plain-HTTP
            device; use USB serial there.
          </p>
        </div>
      )}

      <div className="space-y-2 border-t border-slate-800/80 pt-3.5">
        <label className="flex items-start gap-2.5 text-xs font-medium text-slate-200 sm:text-sm">
          <input
            id={`${idPrefix}-hardware-alerts-toggle`}
            type="checkbox"
            checked={alerts.hardwareAlertsEnabled}
            onChange={(event) =>
              alerts.setHardwareAlertsEnabled(event.target.checked)
            }
            disabled={!alerts.hardwareAlertReady}
            className="mt-0.5 h-4 w-4 shrink-0 accent-teal-400 disabled:cursor-not-allowed"
          />
          <span>Enable ESP32 hardware alerts (this session only)</span>
        </label>
        <p className="text-xs leading-relaxed text-slate-400">
          With a live webcam and this toggle enabled, each new closure episode
          submits one bounded LED command and one 1-second 2 kHz buzzer command
          over {transportLabel}. Five-second escalation is disabled in this
          release even when the firmware advertises it. Browser audio still
          plays. Physical activation is not confirmed by the app.
        </p>
        <button
          id={`${idPrefix}-test-hardware-alert`}
          type="button"
          onClick={() => void alerts.testHardwareAlert()}
          disabled={!alerts.hardwareAlertReady}
          className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Test hardware alert
        </button>
        <p className="text-xs leading-relaxed text-slate-400">
          Manual test needs a configured or verified transport, but not the toggle
          or a running camera. It submits one test command and queues no retry.
        </p>
        {alerts.hardwareAlertStatus.message && (
          <p
            role="status"
            aria-live="polite"
            className={`text-xs leading-relaxed ${
              alerts.hardwareAlertStatus.tone === 'red'
                ? 'text-red-300'
                : 'text-amber-200'
            }`}
          >
            {alerts.hardwareAlertStatus.message}
          </p>
        )}
        {alerts.manualHardwareTestStatus.message && (
          <div className="space-y-1 rounded-lg border border-slate-800 bg-[#10192D] p-3">
            <p className="text-xs font-medium text-slate-300">Latest manual test response</p>
            <p
              role="status"
              aria-live="polite"
              className={`text-xs leading-relaxed ${
                alerts.manualHardwareTestStatus.tone === 'red'
                  ? 'text-red-300'
                  : 'text-amber-200'
              }`}
            >
              {alerts.manualHardwareTestStatus.acknowledged
                ? 'Device acknowledged the command.'
                : alerts.manualHardwareTestStatus.message}
            </p>
            <p className="text-xs leading-relaxed text-slate-400">
              This reports command submission only. Confirm the LED and buzzer
              physically during the bench test.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
