# Install the Poki iPhone app (for agents)

The install is an agent skill now: [skills/install-poki/SKILL.md](skills/install-poki/SKILL.md). Read it and follow it. It runs `node bin/install-iphone.mjs run --json` and says what to tell the user at each step only a person can do.

To keep it for later sessions, copy the whole `skills/install-poki` folder into your client's skill folder:

- Claude Code: `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/install-poki`
- Codex: `${CODEX_HOME:-$HOME/.codex}/skills/install-poki`

The skill runs the installer from a Poki checkout; it clones one when there is none.
