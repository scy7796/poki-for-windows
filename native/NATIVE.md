# Native device bridge

The standalone Rust program in `native/bridge/` uses the public protocol interfaces of the pinned `idevice` revision without modifying upstream. Media session initialization adapts MIT-licensed code from `jkcoxson/idevice`. The source files retain provenance, and `LICENSE.idevice` retains the license.

Build with `./bin/build-native`. This remaps build paths before producing `build/poki-native`.

Run `build/poki-native --udid ID` and send one JSON object through standard input. Success returns JSON on standard output. Failure returns JSON on standard error and exits with code 1. The overall command timeout is 90 seconds.

| op | Parameters | Behavior |
| --- | --- | --- |
| `display_info` | None | Read the device's raw display media capabilities. |
| `ax_tree` | `include_offscreen=false` | Read the native accessibility tree, application roots, foreground process, and orientation. Wait up to 20 seconds and renew the subscription every 2 seconds. |
| `list_apps` | None | Stream the advertised AppService application list without host CoreDevice discovery. Report an error when the capability is absent. |
| `launch_app` | `bundle_id` or `name`, `arguments=[]`, `environment={}`, `terminate_existing=false` | Launch through the paired device's RemoteXPC AppService. An explicit bundle ID skips inventory lookup. Names use only the advertised streaming list. Return the PID for the caller's subsequent foreground check. |
| `configuration` | `method`, `value?` | Read increased contrast or read/set larger accessibility sizes. |
| `tap` | `x`, `y`, `duration_ms=50` | Contact, hold, and release one finger. |
| `double_tap` | `x`, `y`, `duration_ms=50` | Tap twice within one session, 80 milliseconds apart. |
| `long_press` | `x`, `y`, `duration_ms=600` | Hold for the requested duration. |
| `drag` | `x1`, `y1`, `x2`, `y2`, `duration_ms=500`, `hold_ms=0`, `end_hold_ms=0` | Contact, move continuously, optionally hold at the endpoint, and release. |
| `pinch` | `x`, `y`, `start_distance`, `end_distance`, `angle=0`, `duration_ms=500` | Move two contacts with stable identities and release both. The angle is in degrees. |
| `draw_strokes` | `strokes` | Draw 1 to 12 strokes. Each stroke is 2 to 8,192 points `{x, y, time_ms}`, with `time_ms` starting at 0 and increasing; `time_ms` may have a fractional part, such as 12.5 for 120 points over 1,500 milliseconds. The strokes together last at most 60,000 milliseconds. Each stroke touches down, moves through its points and releases, and the next one starts 80 milliseconds after that release. The reply adds `strokes` and `elapsed_ms`, measured from the first contact to the last release. |
| `key` | `key`, `modifiers=[]`, `count=1` | Send a keyboard combination with command/control/option/shift modifiers. |
| `button` | `button`, `count=1`, `interval_ms=120` | Send home, lock/power, volume_up, volume_down, mute, or siri. The internal keyboard value toggles the software keyboard. |
| `type_text` | `text`, `clear=false`, `submit=false`, `target` | Paste Unicode through the clipboard and Command-V, optionally clearing first and sending Return afterward. |
| `type_keys` | `text`, `clear=false` | Type `text` as US-layout hardware key presses on one keyboard session, with no pasteboard (`POKI_TYPE_KEY_MS` between reports, default 12). At most 2000 characters; a character with no key is refused before anything is sent, so the caller can fall back to `type_text`. `clear` sends Command-A and Delete first. |
| `pasteboard` | `action`, `text?` | `get` the general pasteboard's text, list its `items` (`index`, `uti`, `state`, `size`), or `set` it to `text` (at most 1 MiB). Used to save and restore the user's clipboard around a paste. Pasteboard data is neither logged nor written to files. |
| `app_for_pid` | `pid` | Name the app running as `pid` through AppService's process list and the installed bundle paths. Returns `{pid, running, executable?, bundle_id, name}`; `bundle_id` is null when no installed bundle contains the executable, such as SpringBoard. |

## Input and timing

Touch coordinates and pinch distances use the normalized HID range `0..65535`. Callers convert screenshot coordinates. Durations must be `1..60000` milliseconds. Initial and final holds must be `0..10000` milliseconds. Invalid coordinates are rejected before connecting to a device.

Drag and pinch schedule each contact against a monotonic start time. Transport time consumes the remaining wait budget. Each contact is sent once, in order, including the final contact when the schedule runs late. Drag starts its movement clock after the first contact and `hold_ms`; pinch starts before the first two-contact send. The final movement target is start plus `duration_ms`, but slow transport can finish later. Drag's `end_hold_ms` begins after that final send completes. `draw_strokes` schedules each point at its stroke's start plus `time_ms` the same way, sends no point twice and adds no point of its own, and releases at the last point it sent, also when a send fails. On the test iPhone over local Wi-Fi, one 500-point stroke with a final `time_ms` of 3000 reported `elapsed_ms` 3000, and a 129-point circle over 1600 ms reported 1601; the call around them took about 8 seconds, mostly the media session warmup, the 300-millisecond hold and the screen read afterwards.

Input establishes a CoreDevice displayservice media session, waits 1000 milliseconds, sends the action, and closes after another 300 milliseconds. Recoverable action errors release contacts and modifier keys. Touch connections remain open throughout the final 300-millisecond wait. Keyboard input registers a mainKeyboard through UniversalHID with a fixed full-key report descriptor. Modifiers precede ordinary keys; release and keyboard removal follow.

`sent=true, screen_change_verified=false` means only that reports were written to the connection. Devices do not acknowledge those reports and may discard them without an error. The caller must check native accessibility or a screenshot for the actual result.

## Text and clipboard

Before `type_text` sends keys, a request with `target` or `clear` requires exactly one editing text field. A target includes `object_id`, `role`, `label`, `placeholder`, and `value`; that field must match the target. Otherwise the bridge returns `outcome=not_sent`.

Before SET and Command-V, the bridge attempts an eight-second clipboard snapshot using `matchSource`. It avoids `allResolved` and considers a snapshot restorable only when every type has inline data. Timeout, parse failure, or deferred data does not prevent pasting, but returns `clipboard_snapshot="unavailable"`, `restore_unavailable=true`, and `clipboard_restored=false`. The snapshot connection is discarded after timeout. SET uses a new connection so a late PULL_REPLY cannot be mistaken for SET_REPLY. Clipboard data is neither logged nor written to files.

After Command-V, the bridge checks native accessibility up to three times at 400-millisecond intervals. Each complete observation, including connection and handshake, has a four-second limit. It first detects paste permission, then checks that the same text field contains the requested text. Only a confirmed value permits snapshot restoration and Return. Restoration uses `matchSource` and requires the clipboard to still contain this operation's text, preserving concurrent user changes. `clipboard_restore_status` distinguishes restored, unavailable snapshot, user modification, restore failure, and text retained for a pending paste.

If this Command-V caused a system paste permission prompt, the bridge accepts Allow Paste in the same request and reads the field again. It reports `paste_permission_answered=true`. Return still requires matching text. A permission prompt that was already present is declined before continuing, because accepting it could paste earlier clipboard content. A prompt that cannot be dismissed or accepted returns `reason=paste_permission`.

An unconfirmed field returns `isError=true`, `stop_reason="error"`, a `reason`, a next-step `instruction`, `text_verified=false`, `submitted=false`, `submit_sent=false`, and `clipboard_restored=false`. After clipboard modification, pending text remains available. The original snapshot exists only in process memory and cannot be recovered by a later request. Confirmed text returns `text_verified=true`. `submit_sent` only reports sending Return; `submission_verified=false` does not claim form submission.

`clear=true` selects all and deletes twice. The first deletion may clear Chinese input composition; the second clears committed text. Accessibility must confirm an empty field or placeholder. Clearing to empty text does not access the clipboard. Unavailable accessibility, ambiguous fields, or password masking that prevents text verification returns an error without submission. Whole-text pasting avoids ASCII reinterpretation by the active input method. NSError and missing clipboard snapshots mean restoration is unavailable, not that the clipboard was empty. Public `delete` and internal `backspace` use HID 42; `forward_delete` uses HID 76.

## Accessibility and configuration

`ax_tree` returns `source="accessibility"`, `elements`, `applications`, `foreground_app`, and `orientation`. Elements include `object_id`, parent index `parent`, `depth`, `role`, `label/value/identifier/hint/placeholder/url`, `frame` in screen logical points, `traits`, and enabled/selected/focused/is_accessibility_element when supplied by the device. Application records contain name, bundle_id, pid, and object_id. Missing bundle IDs remain null. A foreground app requires a single native application root; multiple roots are not resolved by guessing from the last launch. `include_offscreen=true` prefers complete children; otherwise traversal prefers visible children.

The reader uses the RSD-advertised `com.apple.accessibility.axAuditDaemon.remoteAXService`, enables `clientNeedsAccessibility:` through DTX, decodes two NSKeyedArchive layers, reconstructs the object graph, and closes its subscription on exit.

Configuration methods are `get_increase_contrast`, `get_larger_accessibility_sizes`, and `set_larger_accessibility_sizes`. The setter requires a boolean `value` and sends a top-level `{enabled: bool}` parameter. Results retain the device's raw fields. Increased contrast was readable on the tested device. Reading larger accessibility sizes returned `ActionError code 2: not implemented`; changing that setting has not passed physical-device acceptance. Protocol availability does not imply that every action is implemented by iOS.

## Verification boundaries

On 2026-11-05, an iPhone 17,1 running iOS 27.3 over Wi-Fi was used to test a search field at the bottom of a chat application's list. Native accessibility checked whether search opened after each tap. Coordinates and the initial screen were held constant. The device ran out of power during testing; results before and after restarting were separated, and approximately 20 minutes of earlier data were discarded.

| Connection lifetime | Observations |
| --- | --- |
| Close immediately after release | Before restart, 3 misses in 44 standalone taps. After restart, 2 misses in 70 alternating trials. Every call returned `sent=true`. A separate earlier filling flow missed keyboard appearance in 4 of 30 focus taps; this measured a different outcome. |
| Keep open through the final 300 ms | After restart, 0 misses in 70 alternating trials, then 0 in 24 trials of the final build. Median process duration was 1777 ms versus 1756 ms for immediate close. The first group of 30 per variant measured 1776 versus 1748 ms. |
| Keep open for 500 ms after release | 0 misses in 40 trials before restart and 30 afterward. Sending touch on the persistent keyboard-session connection had 0 misses in 27 trials. |
| Immediate close on list rows and Back | 0 misses in 33 recorded trials on the same device. The reason for target-dependent report loss remains unknown. Drag and pinch use the same connection type but were not tested in this comparison. |

These counts only demonstrate improvement for this search-field target. Two earlier ineffective taps at a conversation entry were not reproduced, so their cause remains unconfirmed.

With a stationary screen, native accessibility delivered a complete tree 1106 to 1218 milliseconds after subscription in 15 trials. During keyboard animation immediately after a tap, 10 of 12 subscriptions returned nothing: 4 of 6 with a four-second wait and all 6 with a two-second wait. Resubscribing after two seconds returned a tree in roughly one second in all 6 trials. With one subscription, 14 of 33 native filling trials and none of 6 MCP trials succeeded, usually ending in `accessibility_unavailable_before_input` despite an open keyboard. Resubscribing every two seconds yielded 12 of 12 native and 6 of 6 MCP successes. The initial failed subscription adds two seconds; a full MCP fill took about 15 seconds. The same missing first response also occurred after launching an app.

Earlier implementations verified wireless screenshots, native accessibility, key deletion, Unicode input, clipboard restoration, Return after text confirmation, and recording recovery after input. Installation and protocol checks in a renamed project directory do not replace physical-device regression checks. Automatic paste permission handling was verified in Chrome's address field. Wireless devicectl launch previously returned `CoreDeviceError 4016`. See the [README](../README.md) for supported limits.

Gesture timing was checked with Tokio controlled time and a substitute device transport for send delays, contact order, final points, holds, and release on ordinary send errors. Compilation passed. No physical-device performance or visual comparison was performed, so these checks do not establish end-to-end speed improvements. Signal interruption and action cancellation by an outer timeout were outside that change's scope.

## Launch and installation outcomes

Launch failures preserve the send boundary. Connection or name-resolution failure returns `outcome=not_sent`. An error after invoking launch, or a response without a valid PID, returns `outcome=unknown`. External process failures also preserve uncertainty. If foreground verification fails after a successful launch, the returned PID and `launched=true` remain available, and batches must stop subsequent actions.

Installation and removal use the paired InstallationProxy service. Installation first uploads through AFC into a fresh random staging directory. After Complete, MCP verifies the application inventory. Unknown outcomes, including network interruption, stop the batch without replay. An unknown installation keeps its staged input and reports the exact path for later read-only confirmation and cleanup. iOS still decides signature validity and authorization.

Before sending an installation, the host creates a mode-0600 recovery record at `install/operations/<UUID>.json` beneath its mode-0700 state directory. It records the necessary bundle, device identifier, and `PublicStaging/poki-<UUID>` path. The native program accepts only a canonical version-4 UUID, checks that the directory is absent, and creates it exclusively. Cancellation, lease expiry, or response loss keeps the record. A prepared record does not prove the device directory was created. The record is removed only after confirmed staging deletion; unrelated staging directories are never scanned or automatically deleted. If inventory verification fails after Complete, the result retains `outcome=completed`, `inventory_verified=false`, `verification_outcome=unknown`, and the stop reason.

## Persistent input sessions

The daemon uses `poki-native --local-server ID SOCKET` for USB and local Wi-Fi devices. The helper accepts the same single-request Unix socket protocol as `--remote-server CONFIG SOCKET`. Each accepted connection receives a PID greeting before sending one JSON request. The helper executes requests serially and keeps the device tunnel and input media session between calls. Audio and video packets are consumed and discarded; this path does not cache screenshots or accessibility trees.

The input media session waits for its initial one-second warmup once. Each input still holds its touch connection for 300 milliseconds. `release_input` closes the media session before screen recording starts or resumes. Input errors and cancelled input requests discard that media session. A request is never replayed after its input may have been written.

A kept tunnel can die while the helper idles, for example when the cable is pulled or the phone restarts; its adapter then reports `adapter closed`. A request that fails while connecting or opening a phone service has written no input. A phone that leaves Wi-Fi without resetting the connection keeps the adapter running, so after a socket-level failure the helper also opens the tunnel's RSD port; when that fails too, the tunnel counts as closed. When the tunnel is closed, the helper discards it, builds a new one, and runs that request once more; a read that fails on a closed tunnel is retried the same way. An input that may have been written is never run again: its tunnel is discarded and rebuilt by the next request, and the error says to inspect the screen. A live tunnel is kept, because a cellular replacement may be refused, and the request fails at once. A failure without a retry, or after it, returns `outcome=not_sent` with `stop_reason=error` for an input or launch, and its error for a read. Both transports share this rule. A request the helper refuses before connecting, because it does not parse or fails validation, also returns `outcome=not_sent` with `sent=false` for an input or launch; reads, settings and app installs return the error.

Local helpers belong to one daemon and stop when its stdin pipe closes. The daemon also terminates its local helpers during shutdown. Remote helpers remain detached across daemon restarts and close through `disconnect_device`, preserving the existing remote reconnection behavior. A new local request can recreate a crashed helper; the interrupted request remains failed. A local helper finishes a read before it serves the next request, so when the daemon cancels or times out a local read, it terminates that helper and waits for it to exit, as it used to end a one-shot read process. The next request starts a new helper. A cancelled local input keeps the helper, discards its media session, and reports an unknown outcome without replay. A launch or input whose helper cannot reach the device returns `outcome=not_sent`.

`POKI_MCP_NATIVE_TRACE=1` includes helper startup and native media stages in the isolated daemon's stderr. `node bin/verify-native-session.mjs` checks the compiled helper's PID greeting, unsent launch and tap, owner-exit handling, and socket cleanup without connecting to a phone. `cargo test` in `native/bridge` runs a real tunnel adapter against a simulated phone: a pulled cable, a phone that stops answering, a reset service on a phone that still answers, and a tunnel that dies after a touch reached the phone.

## Screen text recognition

`native/ocr.swift` is a host binary, not part of the bridge: it prints recognized text as JSON boxes, and `src/device.mjs` runs `build/ocr` whenever the accessibility tree cannot describe a screen. It links Vision, so a host without Vision has no recognizer at all, and until now that surfaced as `spawn build/ocr ENOENT` in the middle of a tap.

`native/ocr-linux.py` is the same contract built on tesseract: it prints `text`, `confidence`, `x`, `y`, `width`, `height` in pixels of the image it was given. Nothing above it changes when it replaces the Swift helper. A host with neither keeps working from the accessibility tree: recognition reports itself unavailable once, and that is remembered only for a missing or unexecutable binary - a run that failed once is reported for that frame and retried on the next.

```sh
# Debian/Ubuntu host or image
apt-get install -y tesseract-ocr tesseract-ocr-chi-sim tesseract-ocr-eng python3-pil
install -m 755 native/ocr-linux.py build/ocr
```

It recognizes a doubled copy of the frame when the screenshot is narrow, because a 390-pixel-wide Chinese label is otherwise unreadable. On a 390×844 capture of a home screen that reads 20 confident lines in about 8 seconds on a 4-core ARM board, against about 5 without the doubling; the labels it loses at native size are the small ones. Recognition stays a fallback for that reason: a search still ends at five seconds, no recognition starts after that, and only one that began inside them is allowed to finish and be used.

| Variable | Default | Effect |
| --- | --- | --- |
| `POKI_OCR_LANGS` | `chi_sim+eng` | tesseract language packs |
| `POKI_OCR_PSM` | `11` | tesseract page mode; `11` is sparse text, which is what a screen is |
| `POKI_OCR_UPSCALE` | `2` | recognize a doubled copy and halve the boxes; `1` is faster and blinder |
