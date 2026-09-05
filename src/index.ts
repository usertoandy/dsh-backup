/**
 * dsh-backup: /backup, /backup-list and /backup-restore slash commands that
 * back up, list and restore the DSH home directory. Ported from the standalone
 * `backup.ts` tool; output follows the harness's built-in command conventions
 * and the restore prompts use the user-questions UI.
 *
 * @module @wildusk/dsh-backup
 */

import * as os from 'os'
import * as path from 'path'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandRuntime } from '@deepseek-ai/dsh-commands'
import type { UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import type { BackupPaths } from './backup-core.ts'
import { registerBackupCommands } from './commands.ts'

export const name = '@wildusk/dsh-backup'

export const inject = ['commands', 'userQuestions']

/**
 * The harness runtime augments this interface against its own vendored cordis,
 * which is a different module instance from the npm cordis this plugin
 * typechecks against — so re-declare the services this plugin injects here.
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    commands: CommandRuntime
    userQuestions: UserQuestionService
  }
}

export function apply(ctx: Context): void {
  const paths: BackupPaths = {
    dshHome: firstNonEmpty(process.env.DSH_HOME, path.join(os.homedir(), '.dsh')),
    backupDir: path.join(os.homedir(), '.dsh-backup'),
  }
  registerBackupCommands(ctx, paths)
}

function firstNonEmpty(...values: readonly (string | undefined)[]): string {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed !== undefined && trimmed !== '') return trimmed
  }
  return path.join(os.homedir(), '.dsh')
}
