import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const signingRefused = text => /STATUS\s*=\s*94\b|TSS server responded with non-success status|This device isn't eligible for the requested build/i.test(text);

export async function ddiRecovery(ios) {
  const xcode = await execute('xcodebuild', ['-version'], { timeout: 8000 })
    .then(({ stdout }) => stdout.match(/^Xcode\s+(\S+)/m)?.[1] ?? 'unknown', () => 'unavailable');
  return `Apple's signing server declined to personalize the developer disk image. Detected Xcode ${xcode}; iOS ${ios || 'unknown'}. The developer disk image may be too old for this iOS version. Update Xcode to a release that supports this iOS version (iOS 27 requires Xcode 27). Open Xcode once and wait for its components to finish installing, then rerun the same command. Poki does not need to be reinstalled. If you supplied --image, replace it with the updated Xcode image before retrying.`;
}
