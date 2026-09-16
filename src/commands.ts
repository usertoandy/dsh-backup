/**
 * Slash-command handlers for /backup, /backup-list and /backup-restore.
 *
 * Output follows the harness's built-in command conventions: handlers return
 * multi-line plain text rendered in the command card, argument errors carry a
 * `Usage:` trailer, operational events go to the cordis logger with a
 * `dsh-backup:` prefix, and the restore selection/confirmation prompts use the
 * user-questions UI — the chat equivalent of the original tool's readline flow.
 * Backing out of the restore dialog is a normal outcome reported as text, not a
 * thrown error: a thrown handler is re-raised to the caller, which fails the
 * command request and leaves the user with no message at all.
 *
 * @module @wildusk/dsh-backup/commands
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {
  AskUserQuestionAnswerItem,
  AskUserQuestionItem,
} from '@deepseek-ai/dsh-user-questions'
import {
  type BackupEntry,
  BackupCancelledError,
  type BackupPaths,
  BackupError,
  RESTORE_CHOICES,
  type RestoreMode,
  createBackupArchive,
  listBackups,
  restoreBackupArchive,
} from './backup-core.ts'

const USAGE_BACKUP = 'Usage: /backup'
const USAGE_LIST = 'Usage: /backup-list'
const USAGE_RESTORE = 'Usage: /backup-restore'

/** Register the three commands for the composed command adapter. */
export function registerBackupCommands(ctx: Context, paths: BackupPaths): void {
  ctx.effect(() => ctx.commands.register({
    name: 'backup',
    description: 'back up the DSH home directory to a timestamped tar.gz archive',
    handler: invocation => runBackupCommand(ctx, paths, invocation),
  }), 'dsh-backup: /backup')
  ctx.effect(() => ctx.commands.register({
    name: 'backup-list',
    description: 'list the existing dsh-backup archives',
    handler: invocation => runBackupListCommand(ctx, paths, invocation),
  }), 'dsh-backup: /backup-list')
  ctx.effect(() => ctx.commands.register({
    name: 'backup-restore',
    description: 'restore the DSH home directory from a backup archive (asks which one and confirms)',
    handler: invocation => runBackupRestoreCommand(ctx, paths, invocation),
  }), 'dsh-backup: /backup-restore')
}

/** `/backup`: archive the DSH home into the backup directory. */
async function runBackupCommand(
  ctx: Context,
  paths: BackupPaths,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') {
    return { kind: 'error', text: `The /backup command takes no arguments. ${USAGE_BACKUP}` }
  }
  try {
    const entry = await createBackupArchive(paths, invocation.signal)
    ctx.logger.info(`dsh-backup: created ${entry.path} (${entry.sizeMB} MB)`)
    return {
      kind: 'success',
      text: [
        'Backup completed.',
        `Source: ${paths.dshHome}`,
        `Archive: ${entry.path}`,
        `Size: ${entry.sizeMB} MB`,
        '',
        'Tip: /backup-list shows all backups; /backup-restore restores one.',
      ].join('\n'),
    }
  } catch (error: unknown) {
    return settleFailure(ctx, 'Backup', error)
  }
}

/** `/backup-list`: render the backup directory as the original tool's table. */
async function runBackupListCommand(
  ctx: Context,
  paths: BackupPaths,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') {
    return { kind: 'error', text: `The /backup-list command takes no arguments. ${USAGE_LIST}` }
  }
  let backups: BackupEntry[]
  try {
    backups = await listBackups(paths.backupDir)
  } catch (error: unknown) {
    return settleFailure(ctx, 'List', error)
  }
  if (backups.length === 0) {
    return {
      kind: 'success',
      text: `No backups found in ${paths.backupDir}.\nCreate one with /backup.`,
    }
  }
  const lines = [
    `Existing backups in ${paths.backupDir}: ${backups.length}`,
    '',
    '  #  Filename                                    Size       Date',
    '  ── ─────────────────────────────────────────── ────────── ────────────────────',
  ]
  backups.forEach((backup, index) => {
    lines.push(`  ${String(index + 1).padStart(2)} ${backup.file.padEnd(43)} ${backup.sizeMB.padStart(6)} MB  ${backup.date}`)
  })
  lines.push('', `  Total: ${backups.length} backup(s)`)
  return { kind: 'success', text: lines.join('\n') }
}

/** `/backup-restore`: pick a backup and confirm through the user-questions UI. */
async function runBackupRestoreCommand(
  ctx: Context,
  paths: BackupPaths,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') {
    return { kind: 'error', text: `The /backup-restore command takes no arguments. ${USAGE_RESTORE}` }
  }
  let backups: BackupEntry[]
  try {
    backups = await listBackups(paths.backupDir)
  } catch (error: unknown) {
    return settleFailure(ctx, 'Restore', error)
  }
  if (backups.length === 0) {
    return {
      kind: 'error',
      text: `No backups found to restore in ${paths.backupDir}.\nCreate one with /backup.`,
    }
  }
  const decision = await askRestoreChoice(ctx, paths, backups, invocation)
  if (decision.kind === 'rejected') {
    // A declined or dismissed dialog is a normal outcome, not a failure. It has
    // to settle as an ordinary result: a thrown handler is re-raised to the
    // caller after the error row is logged, so the command request itself fails
    // and the user sees no transcript message at all.
    ctx.logger.info(`dsh-backup: restore rejected by the user (${decision.reason})`)
    return { kind: 'success', text: rejectText(decision.reason) }
  }
  const { entry, mode } = decision
  try {
    await restoreBackupArchive(entry.path, paths, mode, invocation.signal)
  } catch (error: unknown) {
    return settleFailure(ctx, 'Restore', error)
  }
  ctx.logger.info(`dsh-backup: restored ${entry.path} (${mode}) into ${paths.dshHome}`)
  return {
    kind: 'success',
    text: [
      'Restore completed successfully.',
      `Archive: ${entry.path}`,
      `Target: ${paths.dshHome}`,
      `Mode: ${mode === 'clean'
        ? 'clean — DSH_HOME was emptied first, the backup is restored exactly'
        : 'yes — extracted over the current files; files not in the backup are kept'}`,
      '',
      'You may need to restart any running dsh processes.',
    ].join('\n'),
  }
}

/** Why a restore ended without restoring anything. */
type RejectionReason = 'declined' | 'dismissed'

/** The restore dialog's outcome: proceed, or an explicit user rejection. */
type RestoreDecision =
  | { readonly kind: 'restore'; readonly entry: BackupEntry; readonly mode: RestoreMode }
  | { readonly kind: 'rejected'; readonly reason: RejectionReason }

/**
 * Ask which backup to restore and how, mirroring the original tool's
 * selection prompt and yes/clean/no confirmation in one dialog.
 *
 * @returns The resolved decision. A decline or a dismissed dialog is reported
 *   as an explicit rejection, never as a thrown error.
 * @throws {BackupError} when the dialog fails or the selection is unusable.
 */
async function askRestoreChoice(
  ctx: Context,
  paths: BackupPaths,
  backups: readonly BackupEntry[],
  invocation: CommandInvocation,
): Promise<RestoreDecision> {
  const questions: AskUserQuestionItem[] = [
    {
      id: 'backup',
      header: 'Backup',
      question: `Which backup do you want to restore into ${paths.dshHome}?`,
      options: backups.slice(0, RESTORE_CHOICES).map((backup, index) => ({
        label: `#${index + 1} ${backup.file}`,
        description: `${backup.sizeMB} MB, ${backup.date}`,
      })),
    },
    {
      id: 'confirm',
      header: 'Confirm',
      question: 'Are you sure? This will overwrite the current DSH_HOME directory.',
      detail: [
        `Target: ${paths.dshHome}`,
        '',
        'yes   - extract over current files (files not in the backup are kept)',
        'clean - empty DSH_HOME first, then extract (exact restore of the backup)',
        'no    - cancel the restore',
      ].join('\n'),
      options: [
        { label: 'yes', description: 'extract over current files' },
        { label: 'clean', description: 'empty DSH_HOME first, then extract' },
        { label: 'no', description: 'cancel the restore' },
      ],
    },
  ]
  let answer: { readonly answers: readonly AskUserQuestionAnswerItem[] }
  try {
    answer = await ctx.userQuestions.ask({
      questions,
      agent: invocation.agent,
      signal: invocation.signal,
    })
  } catch (error: unknown) {
    // Closing the dialog rejects the ask with `ASK_CANCELLED`; aborting the
    // owning signal rejects it with `ASK_ABORTED`. Both mean the user backed
    // out, and both must surface as a readable outcome.
    if (isUserRejection(error)) return { kind: 'rejected', reason: 'dismissed' }
    // No answerer accepted the dialog (e.g. a headless context): say why.
    ctx.logger.error(`dsh-backup: restore dialog failed: ${errorMessage(error)}`)
    throw new BackupError(`Restore dialog failed: ${errorMessage(error)}`)
  }
  const mode = normalizeMode(answer.answers.find(item => item.id === 'confirm')?.selected[0])
  if (mode === undefined) return { kind: 'rejected', reason: 'declined' }
  const entry = resolveBackupSelection(backups, answer.answers.find(item => item.id === 'backup'))
  if (entry === undefined) {
    throw new BackupError(`Invalid backup selection. ${USAGE_RESTORE}`)
  }
  return { kind: 'restore', entry, mode }
}

/** Resolve the first question's answer back to a listed archive. */
function resolveBackupSelection(
  backups: readonly BackupEntry[],
  answer: AskUserQuestionAnswerItem | undefined,
): BackupEntry | undefined {
  const custom = answer?.custom?.trim() ?? ''
  if (custom !== '') {
    const numeric = /^(\d+)$/u.exec(custom)
    if (numeric !== null) {
      const index = Number(numeric[1]) - 1
      return index >= 0 && index < backups.length ? backups[index] : undefined
    }
    return backups.find(backup => backup.file === custom || backup.path === custom)
  }
  const label = answer?.selected[0]?.trim() ?? ''
  const numbered = /^#\d+\s+(.+)$/u.exec(label)
  const file = numbered?.[1]?.trim() ?? label
  if (file === '') return undefined
  return backups.find(backup => backup.file === file || backup.path === file)
}

/** Normalize the confirm answer; anything but yes/clean declines the restore. */
function normalizeMode(label: string | undefined): RestoreMode | undefined {
  const mode = label?.trim().toLowerCase()
  return mode === 'yes' || mode === 'clean' ? mode : undefined
}

/**
 * Whether the user-questions dialog ended because the user backed out.
 *
 * Two distinct codes reach here: `ASK_CANCELLED` when the user closes the
 * dialog, and `ASK_ABORTED` when the owning signal is aborted. Neither is a
 * failure, and both must produce a message rather than a thrown error.
 */
function isUserRejection(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code
  return code === 'ASK_CANCELLED' || code === 'ASK_ABORTED'
}

/** Rejection copy: name what the user did, and that nothing was changed. */
function rejectText(reason: RejectionReason): string {
  return reason === 'declined'
    ? 'Restore rejected — you chose "no". Nothing was changed.'
    : 'Restore rejected — you dismissed the dialog. Nothing was changed.'
}

/** Render one settled failure; cancelled work is a normal outcome, not an error. */
function settleFailure(ctx: Context, action: string, error: unknown): CommandResult {
  if (error instanceof BackupCancelledError) {
    return { kind: 'success', text: `${action} cancelled.` }
  }
  const message = errorMessage(error)
  ctx.logger.error(`dsh-backup: ${action.toLowerCase()} failed: ${message}`)
  return { kind: 'error', text: `${action} failed: ${message}` }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
