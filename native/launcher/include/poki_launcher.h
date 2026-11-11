// PokiLauncher: gets the WebDriverAgent runner up on this phone and keeps it up; pairs the phone with
// itself (iOS 27). docs/ios-core.md §3. Every string passed in is UTF-8 and only read during the call;
// event strings are valid only during the callback, which runs on a launcher thread.
#ifndef POKI_LAUNCHER_H
#define POKI_LAUNCHER_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct PokiLauncher PokiLauncher;
typedef struct PokiPairing PokiPairing;
typedef struct PokiNativeClient PokiNativeClient;
typedef void (*poki_event_cb)(void *context, const char *event_json);

// config_json: {"device_address": "10.7.0.1", "pairing_file": "...", "host_name": "Poki",
//   "ddi_dir": "...", "runner_bundle": null, "wda_host": "127.0.0.1", "wda_port": 8100}
// Events: {"state": "idle|connecting|pairing|mounting_ddi|launching|running|waiting_network|failed",
//   "attempt": n, "since_ms": n, "pairing": "remote|lockdown", "ios": "...", "runner": "...",
//   "detail": "...", "fix": "..."}
PokiLauncher *poki_launcher_new(const char *config_json, poki_event_cb cb, void *context);
int32_t poki_launcher_start(PokiLauncher *launcher);
void poki_launcher_restart(PokiLauncher *launcher);
void poki_launcher_stop(PokiLauncher *launcher);
char *poki_launcher_status(PokiLauncher *launcher);
void poki_launcher_free(PokiLauncher *launcher);
void poki_string_free(char *text);

// config_json: {"host_name": "Poki", "out_path": "...", "identity_path": "..."}
// Events: {"event": "advertise", "service_type": "_remotepairing-pairable-host._tcp", "instance": "...",
//   "port": n, "txt": {...}} (publish it with Bonjour), {"event": "pin", "pin": "123456"},
//   {"event": "paired", "path": "..."}, {"event": "failed", "detail": "..."}
PokiPairing *poki_pair_start(const char *config_json, poki_event_cb cb, void *context);
void poki_pair_cancel(PokiPairing *pairing);

// Experimental banner-free device services. One client keeps its paired tunnel and HID media
// session warm. Calls run in order and each callback receives one JSON result.
PokiNativeClient *poki_native_client_new(const char *config_json);
int32_t poki_native_client_call(PokiNativeClient *client, const char *request_json, poki_event_cb cb, void *context);
void poki_native_client_free(PokiNativeClient *client);

// Poki keeps its own signing (native/launcher/src/signer.rs, Poki Setup's core). The vault is the
// app's Keychain: get returns a malloc'd base64 string (freed by the library) or NULL; set and
// delete return 0 on success. Install it once at launch, before the first call.
typedef char *(*poki_vault_get_cb)(void *context, const char *name);
typedef int32_t (*poki_vault_set_cb)(void *context, const char *name, const char *value_base64);
typedef int32_t (*poki_vault_delete_cb)(void *context, const char *name);
int32_t poki_signer_set_vault(poki_vault_get_cb get, poki_vault_set_cb set, poki_vault_delete_cb del, void *context);

// request_json: {"op": "configure|status|sign_in|finish_sign_in|sign_out|teams|choose_team|
//   set_anisette|set_channel|import_identity|check_update|udid|prepare|install", ...}.
// Events: {"event": "progress", "progress": {...}} while it runs, then one
// {"event": "result", "ok": true, "value": ...} or {"event": "result", "ok": false, "error": "...", "code": "..."}.
// Returns -1 when the request is unreadable (no events follow), else 0.
int32_t poki_signer_call(const char *request_json, poki_event_cb cb, void *context);

#ifdef __cplusplus
}
#endif

#endif
