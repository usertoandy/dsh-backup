/**
 * Core backup/list/restore logic ported from the standalone `backup.ts` tool:
 * timestamped `tar -czf` archives of the DSH home under the backup directory,
 * a newest-first listing, and guarded extraction back into the DSH home.
 *
 * Unlike the original CLI tool this runs inside the harness host process, so
 * every operation is asynchronous, `tar` output is captured instead of
 * inherited, and long-running work honours an abort signal.
 *
 * @module @wildusk/dsh-backup/backup-core
 */

import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, readdir, rm, stat } from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

/** Filename shape shared by every archive this tool writes. */
export const BACKUP_PATTERN = /^dsh-backup-.+\.tar\.gz$/u

/** Most recent backups offered as selectable options in the restore dialog. */
export const RESTORE_CHOICES = 10

/** One existing backup archive. */
export interface BackupEntry {
  /** Archive file name inside the backup directory. */
  readonly file: string
  /** Absolute archive path. */
  readonly path: string
  /** File size in MB with two decimals. */
  readonly sizeMB: string
  /** Modification time as `YYYY-MM-DD HH:MM:SS`. */
  readonly date: string
}

/** Resolved directories this plugin operates on. */
export interface BackupPaths {
  /** DSH home directory being backed up and restored. */
  readonly dshHome: string
  /** Directory receiving the `dsh-backup-*.tar.gz` archives. */
  readonly backupDir: string
}

/** Domain error whose message is safe to show to the user. */
export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

/** Raised when the invocation signal aborted the pending tar work. */
export class BackupCancelledError extends BackupError {
  constructor() {
    super('Operation cancelled.')
    this.name = 'BackupCancelledError'
  }
}

/** Restore modes mirroring the original tool's yes/clean answer. */
export type RestoreMode = 'yes' | 'clean'

/** Local-time timestamp in the shared `YYYY-MM-DD_HH-MM-SS` format. */
export function getTimestamp(): string {
  const date = new Date()
  const timezoneOffsetMinutes = date.getTimezoneOffset()
  const offsetMs = timezoneOffsetMinutes * 60 * 1000
  const localAsUtc = new Date(date.getTime() - offsetMs)
  return localAsUtc.toISOString()
    .replace(/[:.]/gu, '-')
    .replace('T', '_')
    .slice(0, 19)
}

/** Human-readable MB size with two decimals. */
export function formatSizeMB(size: number): string {
  return (size / 1024 / 1024).toFixed(2)
}

/** List the backup directory, newest archive first; empty when it does not exist. */
export async function listBackups(backupDir: string): Promise<BackupEntry[]> {
  if (!existsSync(backupDir)) return []
  const files = (await readdir(backupDir))
    .filter(file => BACKUP_PATTERN.test(file))
    .sort()
    .reverse()
  const entries: BackupEntry[] = []
  for (const file of files) {
    const filePath = path.join(backupDir, file)
    const stats = await stat(filePath)
    entries.push({
      file,
      path: filePath,
      sizeMB: formatSizeMB(stats.size),
      date: stats.mtime.toISOString().replace('T', ' ').slice(0, 19),
    })
  }
  return entries
}

/** Create a timestamped tar.gz archive of the DSH home inside the backup directory. */
export async function createBackupArchive(paths: BackupPaths, signal: AbortSignal): Promise<BackupEntry> {
  if (!existsSync(paths.dshHome)) {
    throw new BackupError(`DSH_HOME directory does not exist: ${paths.dshHome}`)
  }
  await mkdir(paths.backupDir, { recursive: true })
  const file = `dsh-backup-${getTimestamp()}.tar.gz`
  const archivePath = path.join(paths.backupDir, file)
  await runTar(['-czf', archivePath, '-C', paths.dshHome, '.'], signal)
  const stats = await stat(archivePath)
  return {
    file,
    path: archivePath,
    sizeMB: formatSizeMB(stats.size),
    date: stats.mtime.toISOString().replace('T', ' ').slice(0, 19),
  }
}

/** Extract a backup archive into the DSH home; `clean` empties the target first. */
export async function restoreBackupArchive(
  archivePath: string,
  paths: BackupPaths,
  mode: RestoreMode,
  signal: AbortSignal,
): Promise<void> {
  if (!existsSync(archivePath)) {
    throw new BackupError(`Backup archive does not exist: ${archivePath}`)
  }
  if (mode === 'clean') {
    // Clean mode must remove files absent from the archive, so wipe the target first.
    const target = path.resolve(paths.dshHome)
    if (target === '/' || target === path.resolve(os.homedir())) {
      throw new BackupError(`Refusing to clean unsafe DSH_HOME: ${paths.dshHome}`)
    }
    await rm(paths.dshHome, { recursive: true, force: true })
  }
  await mkdir(paths.dshHome, { recursive: true })
  await runTar(['-xzf', archivePath, '-C', paths.dshHome], signal)
}

/** Run one tar invocation, killing the child when the signal fires. */
function runTar(args: readonly string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new BackupCancelledError())
      return
    }
    const child = spawn('tar', [...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    const onAbort = (): void => {
      child.kill('SIGTERM')
    }
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    child.on('error', error => {
      cleanup()
      reject(new BackupError(`Failed to run tar: ${error.message}`))
    })
    child.on('close', code => {
      cleanup()
      if (signal.aborted) {
        reject(new BackupCancelledError())
      } else if (code === 0) {
        resolve()
      } else {
        const detail = stderr.trim()
        reject(new BackupError(`tar exited with code ${code}${detail === '' ? '' : `: ${detail}`}`))
      }
    })
  })
}
