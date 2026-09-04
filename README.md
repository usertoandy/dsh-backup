# dsh-backup

DeepSeek Harness plugin that adds three slash commands to the harness dialog for
backing up, listing and restoring the DSH home directory (`$DSH_HOME`, default
`~/.dsh`). The logic is ported from the standalone `backup.ts` tool; the output
follows the harness's built-in command conventions, and the restore
selection/confirmation prompts use the harness's user-questions UI.

Archives are written to `~/.dsh-backup`. Paths are not configurable: the source
is `$DSH_HOME` or `~/.dsh`, and the backup directory is always `~/.dsh-backup`.

## Commands

| Command | Function |
| --- | --- |
| `/backup` | Archive the DSH home to `~/.dsh-backup/dsh-backup-<timestamp>.tar.gz` and report the archive path and size. |
| `/backup-list` | List the existing archives in `~/.dsh-backup` (number, filename, size, date). |
| `/backup-restore` | Ask (via the harness question UI) which backup to restore and how, then extract it into the DSH home. |

### Restore modes

The confirm question offers the original tool's three answers:

- `yes` — extract over the current files; files not in the backup are kept.
- `clean` — empty the DSH home first, then extract (exact restore of the backup).
  Refused when the target resolves to `/` or the user's home directory.
- `no` — cancel the restore.

After a restore you may need to restart any running `dsh` processes.

## Install

The host loads `src/index.ts` directly (no build step). Register the plugin
with a profile (the bundles list is updated automatically by `dsh plugin add`):

```sh
dsh plugin --profile web add /Users/andy/harness/dsh-backup
```

Restart `dsh web` afterwards; `/backup`, `/backup-list` and `/backup-restore`
then appear in the command palette.

At runtime the plugin uses the host-provided `commands` and `userQuestions`
services plus `tar` on the PATH.

## Files

- `src/index.ts` — plugin entry: `name` / `inject` / `apply`.
- `src/commands.ts` — the three command handlers and their output text.
- `src/backup-core.ts` — timestamped tar.gz creation, listing and guarded
  restore, ported from `backup.ts` (asynchronous, abort-aware).
- `backup.ts` — the original standalone CLI tool kept for reference.
