import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationData, exe, isWin } from './os.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const stateDir = process.env.POKI_MCP_STATE_DIR ?? applicationData('PokiMCP');
export const endpointFile = join(stateDir, 'mcp.json');
// usbmuxd answered with an empty list. The first check is whether the operating system sees the phone at all.
export const noUsbDevice = isWin
  ? 'usbmuxd answered, but no iPhone is attached over USB. Check whether the iPhone appears in the Apple Devices app. If it does not appear there either, Windows has not attached it: connect it directly with a data cable, unlock it, and accept Trust This Computer.'
  : 'usbmuxd answered, but no iPhone is attached over USB. Check whether the iPhone appears in the Finder sidebar. If Finder does not show it either, macOS has not attached it: connect it directly with a data cable, unlock it, and accept Trust This Computer. Poki cannot use an iPhone that devicectl reaches only over the network.';

// Cargo names the binary after the package; only Windows keeps the extension.
export const idevice = process.env.IDEVICE_TOOLS
  ?? join(root, '.deps/idevice/target/release', exe('idevice-tools'));
export const nativeBin = process.env.POKI_NATIVE
  ?? join(root, 'build', exe('poki-native'));
export const simulatorBin = process.env.POKI_SIMULATOR ?? join(root, 'build', exe('simulator'));

// The macOS build compiles native/ocr.swift into build/ocr. Elsewhere the recognizer is a
// Python helper, run through an interpreter that is spawned directly rather than a shell wrapper.
export const ocr = (isWin || process.platform !== 'darwin'
  ? { file: process.env.POKI_PYTHON ?? (isWin ? 'python' : 'python3'), prefix: [join(root, 'native/ocr_win.py')] }
  : { file: join(root, 'build/ocr'), prefix: [] });

export const crashLogDirectory = join(homedir(), 'Library/Logs/DiagnosticReports');
