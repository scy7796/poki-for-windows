import { execute } from './work.mjs';
import { isWin } from './os.mjs';

// A real dialog is the acknowledgment. A successful notification alone is not.
// macOS answers through osascript; Windows answers through the same WScript.Shell
// dialog box that scripts have used for decades, with the buttons and timeout
// meaning what they mean on the Mac.
const macScript = `on run argv
      set promptText to item 1 of argv
      set waitSeconds to (item 2 of argv) as integer
      try
        set response to display dialog promptText with title "Poki MCP" buttons {"取消", "确认"} default button "确认" cancel button "取消" giving up after waitSeconds
        if gave up of response then return "timeout"
        if button returned of response is "确认" then return "done"
        return "cancelled"
      on error number -128
        return "cancelled"
      end try
    end run`;

// The message travels base64-encoded so no quoting rule of either shell can change it.
// The verdict is printed rather than carried in the exit code: execute() reports stdout and
// stderr, and an exit code it does not carry cannot be read back by the caller.
const windowsScript = `
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:POKI_PROMPT))
$shell = New-Object -ComObject WScript.Shell
$answer = $shell.Popup($text, [int]$env:POKI_PROMPT_SECONDS, 'Poki MCP', 4 + 32 + 4096)
if ($answer -eq 6) { Write-Output 'done' } elseif ($answer -eq -1) { Write-Output 'timeout' } else { Write-Output 'cancelled' }
exit 0
`;

export async function askHuman(message, seconds = 120) {
  let status;
  if (isWin) {
    const [file, ...prefix] = [process.env.POKI_POWERSHELL ?? 'powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', windowsScript];
    const result = await execute(file, prefix, {
      timeout: (seconds + 10) * 1000,
      env: { ...process.env, POKI_PROMPT: Buffer.from(message, 'utf8').toString('base64'), POKI_PROMPT_SECONDS: String(Math.ceil(seconds)) },
    }).then(result => result, error => ({ stdout: '', stderr: error.message }));
    // Same reading as the macOS branch. A dialog that could not be shown at all answers
    // nothing, which is not a confirmation.
    status = String(result.stdout ?? '').trim() || 'cancelled';
  } else {
    const { stdout } = await execute('osascript', ['-e', macScript, '--', message, String(Math.ceil(seconds))], { timeout: (seconds + 10) * 1000 });
    status = stdout.trim();
  }
  return { status, completed: status === 'done', message: status === 'done' ? 'The user confirmed the dialog. Inspect the device before continuing.' : 'The user did not confirm completion.' };
}
