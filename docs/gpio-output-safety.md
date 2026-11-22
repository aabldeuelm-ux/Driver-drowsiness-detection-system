# GPIO output safety and wiring handoff

Last updated: 2026-11-22

This document records only output work that is prepared for physical testing. No
upload has been performed by the assistant, and no physical LED or buzzer result
is claimed here.

## Camera-pin exclusion list

The tested camera mapping uses the following GPIOs. None of them may be reused
for the external LED, buzzer, or motor:

| Function | GPIO |
| --- | ---: |
| PWDN | 32 |
| XCLK | 0 |
| SIOD | 26 |
| SIOC | 27 |
| D0 | 5 |
| D1 | 18 |
| D2 | 19 |
| D3 | 21 |
| D4 | 36 |
| D5 | 39 |
| D6 | 34 |
| D7 | 35 |
| VSYNC | 25 |
| HREF | 23 |
| PCLK | 22 |

GPIO34-39 are input-only on the classic ESP32 and are unsuitable as driven
outputs; they are also occupied by the camera.
GPIO6-11 must not be used because they are reserved for flash/PSRAM.
GPIO16/17 are avoided because PSRAM is enabled on this board.

Espressif's GPIO reference states that GPIO6-11 and GPIO16-17 are normally
connected to flash/PSRAM, and that GPIO34-39 are input-only. Espressif's hardware
design checklist lists GPIO0, GPIO2, GPIO5, MTDI, and MTDO as strapping pins;
Arduino-ESP32 maps those to GPIO0, GPIO2, GPIO5, GPIO12, and GPIO15.
UART0 is fixed to GPIO1/GPIO3 for download and log output.

Sources:

- [ESP-IDF GPIO & RTC GPIO](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/gpio.html)
- [Espressif Hardware Design Guidelines — schematic checklist](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32/schematic-checklist.html)
- [Arduino-ESP32 ESP32-DevKitC-1 board documentation](https://documentation.espressif.com/projects/arduino-esp32/en/latest/boards/ESP32-DevKitC-1.html)
- [Espressif FAQ — GPIO voltage tolerance](https://docs.espressif.com/projects/esp-faq/en/latest/hardware-related/hardware-design.html)

## External red LED

Selected output: **GPIO13**.

Why GPIO13:

- It is not in the tested camera pin map.
- It is not a UART pin (UART0 uses GPIO1/GPIO3).
- It is not a flash/PSRAM pin.
- It is not GPIO34-39 input-only territory.
- It is not a boot-strapping pin that must be held at a specific level at reset.
- It is output-capable and is documented as JTAG **MTCK**; JTAG is not used in
  this project's current FQBN, so that alternate function is free.

GPIO14 is also acceptable (JTAG **MTMS**), but GPIO13 is the selected pin. If
JTAG debugging is added later, move the LED to GPIO4 or GPIO33 rather than
moving between GPIO13 and GPIO14.

### Exact wiring

Use the existing red LED and the known **1 kΩ** series resistor.

| From | To | Notes |
| --- | --- | --- |
| ESP32 3V3 | 1 kΩ resistor, either end | Current limiting; no polarity |
| 1 kΩ resistor, other end | LED anode | Longer lead; no flat side |
| LED cathode | ESP32 GPIO13 | Shorter lead and/or flat side on LED body |

No separate GND wire is needed for this LED circuit because current flows from
3V3 through the resistor and LED into GPIO13. The board must, of course, share
GND with the USB programmer/serial adapter.

This is a current-sinking connection:

- `GPIO13 HIGH` = LED **OFF**
- `GPIO13 LOW` = LED **ON**

With this orientation the LED is off while GPIO13 is floating during boot.
The test sketch writes the OFF level before switching the pin to `OUTPUT`.
At 3.3 V, a red LED and 1 kΩ resistor give roughly 1-2 mA, well inside a
GPIO's normal drive capability.

### Test sketch

`firmware/external_led_test/external_led_test.ino`

It initializes only Serial and GPIO13. It does not initialize Wi-Fi, camera,
WebServer, SD, onboard flash LED, buzzer, or motor. Blink timing uses
`millis()`; there is no `delay()` in `loop()`.

## Buzzer

Status: **control remains disabled**.

Observed module markings:

- Blue PCB marked `FMD`.
- Connector: `GND`, `I/O`, `VCC`.
- Back label: `Buzzer module / Low level trigger`.
- Onboard three-pin component and a resistor marked `102`.

### What supplier documentation supports

No manufacturer datasheet or schematic was found. Several distributor/supplier
pages for the matching **MH-FMD** family make these claims:

- Operating/supply voltage: **3.3-5 V** at VCC.
- Control logic: **3.3-5 V** on I/O, described as suitable for MCU control/PWM.
- The buzzer is switched by a transistor, so the MCU output does not carry the
  buzzer current.
- Approximate module consumption on one listing: **30 mA**.
- Matching listings describe the board as blue, with `GND / I/O / VCC` and
  `Low level trigger` labeling, and one indexed PDF shows `MH-FMD`, `102`, and
  the same pin labels.

Sources:

- [Bastelgarage: MH-FMD, low level trigger, 3.3-5 V supply and logic, transistor-switched](https://www.bastelgarage.ch/components/audio-1-95/piezo-buzzer-module-with-transistor)
- [VK4PK: blue MH-FMD module, 3.3-5 V](https://www.lyonscomputer.com.au/Electronic-Modules/Pizo-Buzzer-MH-FMD-Module/Pizo-Buzzer-MH-FMD-Module.html)
- [SsDielect: MH-FMD, 3.3-5 V, ~30 mA, S8050](https://ssdielect.com/buzzer/5294-mh-fmd.html)
- [Digilog: low-level-trigger module, 3.3-5 V, transistor variant](https://digilog.pk/products/active-low-level-trigger-buzzer-alarm-module-for-diy-mcu-scm-in-pakistan)
- [Tecsho indexed PDF: MH-FMD / 102 / GND-I/O-VCC / low-level trigger](https://tecsho.com/Download/Download/126366/f)

### Verified vs assumed

Verified from documentation: the supplier family is described as 3.3-5 V
supply/control, transistor-switched, and low-level-trigger. Verified from
observation: the user's board has the FMD marking, three-pin header, `102`
resistor, and low-level-trigger label.

Assumptions, not verified for this exact unit:

- That `FMD` means this board is an `MH-FMD` revision.
- That `102` is a 1 kΩ resistor in the input path and that its function is known.
- That the three-pin component is a specific transistor. Supplier listings
  conflict (`S8050`, `8550`, `S8550`).
- That a 3.3 V HIGH from ESP32 reliably turns the module off if VCC is 5 V.
- Active versus passive buzzer type, exact LOW threshold, I/O leakage current,
  protection circuitry, and maximum allowed I/O voltage.

Espressif states that classic ESP32 GPIO voltage tolerance is 3.6 V; above that,
a level shifter/divider is required. A module powered from 5 V is therefore not
automatically ESP32-safe on its I/O pin.

### Decision

Do not connect buzzer `I/O` to an ESP32 GPIO as part of the project firmware.
Buzzer control stays disabled in the camera/admin firmware. Powering VCC from
the ESP32 3.3 V rail, as the user has done, reduces supply/logic mismatch risk
but is not proof of exact input safety. With no multimeter or manufacturer
datasheet available, the input circuit remains unverified.

### Isolated bench test

`firmware/buzzer_test/buzzer_test.ino` is a separate identification test only.
It uses GPIO14 for buzzer I/O and GPIO13 for the active-low external LED. The
revised sketch calls `pinMode(OUTPUT)` first on both pins and then writes the
HIGH/off level, blinks GPIO13 LOW/HIGH three times at 500 ms per state while
logging each state, holds GPIO13 HIGH/off, waits 2 seconds, then repeats the
buzzer test three times: LOW for 500 ms, HIGH for 1 s, and a manually toggled
2 kHz square wave for 500 ms. It finishes with both pins HIGH and never touches
the camera, Wi-Fi, SD, flash LED, motor, or other outputs.

The steady LOW step tests a self-oscillating active module. The 2 kHz step tests
a passive piezo element driven through the module's transistor input. The user
later reported that **both phases sounded** with this board and wiring. That
shows both signals are audible here, but does not prove the module's exact
circuit. For the project firmware, steady LOW was chosen as the simpler alert
signal; no PWM or tone generator is needed.

### GPIO13 startup bug found in the first uploaded revision

The first uploaded revision wrote `digitalWrite(GPIO13, HIGH)` before
`pinMode(GPIO13, OUTPUT)`. In Arduino-ESP32 3.3.12, `__digitalWrite()` only calls
`gpio_set_level()` when the pin is already registered on the GPIO bus; otherwise
it logs an error and returns. `pinMode()` then configured the pin as an output
without setting the level, so the output latch stayed LOW. With the active-low
LED wiring, that made GPIO13 steadily light the LED. The startup log was only a
printed message and did not prove the physical output level.

The earlier `external_led_test` had the same unsafe write-before-`pinMode()`
order, but its loop wrote both LOW and HIGH after `pinMode()` had run, so the
ignored startup write was masked and the LED appeared to blink correctly. The
first buzzer test never wrote GPIO13 again, exposing the bug after reset.

No PWM/timer peripheral is involved. The revised sketch uses no `analogWrite()`,
`ledcWrite()`, `tone()`, Servo, or timer ISR. Its 2 kHz signal is made only with
`digitalWrite()` on GPIO14 timed by `micros()`.

The user then uploaded the revised sketch and reported a **passed physical
test**: the GPIO13 LED blinked three times and stayed off, both buzzer phases
ran, and both outputs finished off. This is a hardware result for the isolated
sketch only. The revised sketch compiled for Arduino-ESP32 3.3.12 with the
existing ESP32 Dev Module settings: `286436` bytes flash (`21%`) and `22180`
bytes RAM (`6%`).

### camera_preview output integration

The working camera firmware now uses the same pin assignments and the corrected
`pinMode(OUTPUT)`-before-`digitalWrite()` initialization for GPIO13 and GPIO14.
Both outputs are HIGH/off at startup with no automatic sound or LED pulse. The
preview page has manual LED and buzzer buttons; the firmware also exposes
`GET /led_test` and `GET /buzzer_test` with CORS/OPTIONS support for the local
admin. Each request starts one bounded active-low pulse with automatic HIGH
shutoff tracked by `millis()`. The shutoff is also serviced inside the long
image body-write loop so a slow capture cannot extend a pulse or block camera
capture. No `delay()` is used in the alert path, no PWM/tone API is used, and
SD, flash LED, and motor remain disabled. The buzzer stays powered at 3.3 V.

**Physical result passed** for the 500 ms pulse / 2 FPS build: the user reported
that JPEG preview works, the LED test works, and the buzzer gives a quiet short
beep and stops correctly. The current revision changes both pulses to 1 second
and the preview default to 5 FPS. It compiles for Arduino-ESP32 3.3.12 with the
existing settings: `1070953` bytes flash (`81%`) and `70456` bytes RAM (`21%`).
It also exposes a visible build identifier,
`camera_preview-2026-11-22-1s-5fps-v4`, on the preview page, in serial output,
through `GET /version`, and in `X-Firmware-Build` headers. The user confirmed
that build was uploaded. A later diagnostics-only build,
`camera_preview-2026-11-22-1s-5fps-v5-diagnostics`, adds phase timing fields and
Wi-Fi sleep status but does not change any output behavior; it is compiled only
and has not been uploaded. Upload still requires explicit authorization because
it replaces board firmware.

### Standalone `alert_controller` firmware

A separate camera-free sketch now exists at
`firmware/alert_controller/alert_controller.ino` with build ID
`alert_controller-2026-11-22-1s-v1`. It has no camera initialization, JPEG
conversion, PSRAM allocation, SD, recording, or frame transfer. It keeps the
same GPIO13 active-low LED and GPIO14 active-low buzzer wiring, calls
`pinMode(OUTPUT)` before `digitalWrite()`, starts both pins HIGH/off with no
startup pulse, and exposes `GET /led_test`, `GET /buzzer_test`, `GET /version`,
and OPTIONS handlers with the same CORS headers. Each test starts one
nonblocking 1000 ms LOW pulse with automatic HIGH/off shutoff serviced in
`loop()`; there is no `delay()` in the alert path and no PWM/tone API.
Wi-Fi credentials are reused from a local `secrets.h` beside the sketch and are
not printed or committed. This build compiled at `1011105` bytes flash (`77%`)
and `50392` bytes RAM (`15%`) with the existing ESP32 Dev Module settings and
has **not** been uploaded.

The admin now submits both endpoints once per new closure episode when the
session-only toggle is enabled and ESP32 is the live source, plus a manual
**Test hardware alert** button for connectivity checks. Snapshot polling is
quiesced before submission and the two one-shot commands are sent sequentially
with a bounded handoff, so they cannot race an image body write on the ESP32's
single-threaded web server. Stale sessions are rejected after reconnect/source
change, and no retry is queued. Command submission is verified by automated
tests, but physical activation from the admin has not been confirmed.

## Vibration motor

The vibration motor remains disconnected and disabled. There is no suitable
driver transistor/MOSFET in the listed components; never drive the motor
directly from a GPIO.
