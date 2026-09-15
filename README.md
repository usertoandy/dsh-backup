# @wildusk/dsh-backup

DeepSeek Harness plugin backup. Archives are written to `~/.dsh-backup`.

Repository: https://github.com/usertoandy/dsh-backup.git

## Commands

| Command | Function |
| --- | --- |
| `/backup` | Archive the DSH home to `~/.dsh-backup/dsh-backup-<timestamp>.tar.gz` and report the archive path and size. |
| `/backup-list` | List the existing archives in `~/.dsh-backup` (number, filename, size, date). |
| `/backup-restore` | Ask (via the harness question UI) which backup to restore and how, then extract it into the DSH home. |

### Fresh-session visibility

Command output is log-only (`command/run` + `command/done`), and the harness
deliberately keeps a session with no model turn on its empty hero: a generic
`command` row does not count as conversation content. Without help, a
`/backup-list` result in a brand-new session is logged durably but stays
invisible until some later message activates the transcript.

The plugin therefore ships a small web client face (`src/client.js`). For
`/backup`, `/backup-list` and `/backup-restore` it projects the typed command
line as a right-aligned input bubble anchored just before the durable result
row. That extra node activates the chat view, so the result card renders
immediately in a fresh session. The generic command lifecycle and its result
row are unchanged.

### Restore modes

The confirm question offers the original tool's three answers:

- `yes` — extract over the current files; files not in the backup are kept.
- `clean` — empty the DSH home first, then extract (exact restore of the backup).
  Refused when the target resolves to `/` or the user's home directory.
- `no` — cancel the restore.

After a restore you may need to restart any running `dsh` processes.

## Install

The host loads `src/index.ts` directly and the browser loads `src/client.js`
directly — no build step for either half. Install straight
from the npm registry — `dsh plugin add` forwards the package name to pnpm
inside the profile directory, then activates the bundle automatically
(the bundles list is updated by the reconcile step):

```sh
dsh plugin --profile web add @wildusk/dsh-backup
```

Restart `dsh web` afterwards; `/backup`, `/backup-list` and `/backup-restore`
then appear in the command palette. A restart is required (not just a reload)
when upgrading a version that adds the client face, because the browser module
graph caches each package's `dsh.client` verdict until boot.

At runtime the host half uses the host-provided `commands` and `userQuestions`
services plus `tar` on the PATH; the browser half uses the client-provided
`uiConversation` and `slots` services.

## Files

- `src/index.ts` — plugin entry: `name` / `inject` / `apply`.
- `src/commands.ts` — the three command handlers and their output text.
- `src/backup-core.ts` — timestamped tar.gz creation, listing and guarded
  restore (asynchronous, abort-aware).
- `src/client.js` — browser half: the command-input Conversation Definition
  and its keyed Chat Node renderer (served unbundled).
- `tests/core.test.mjs` — host round-trip and registration tests.
- `tests/client.test.mjs` — browser projection tests (node, no React).
