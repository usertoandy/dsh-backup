// dsh-backup core test, run with tsx: `pnpm test`.
// Exercises the backup/list/restore round-trip in a temp DSH home and the
// plugin entry's command registrations, without touching the real ~/.dsh.
import assert from 'assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  BackupCancelledError,
  BackupError,
  createBackupArchive,
  listBackups,
  restoreBackupArchive,
} from '../src/backup-core.ts'
import * as plugin from '../src/index.ts'

const noopSignal = new AbortController().signal
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-backup-test-'))
const paths = {
  dshHome: path.join(root, 'home'),
  backupDir: path.join(root, 'backups'),
}

try {
  // --- backup creates a timestamped archive ---------------------------------
  fs.mkdirSync(path.join(paths.dshHome, 'profiles', 'web'), { recursive: true })
  fs.writeFileSync(path.join(paths.dshHome, 'profiles', 'package.json'), '{}')
  fs.writeFileSync(path.join(paths.dshHome, 'profiles', 'web', 'config.json'), '{"a":1}')

  const entry = await createBackupArchive(paths, noopSignal)
  assert.match(entry.file, /^dsh-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.tar\.gz$/)
  assert.ok(fs.existsSync(entry.path), 'archive file exists')
  assert.ok(Number(entry.sizeMB) >= 0, `size reported (${entry.sizeMB} MB)`)

  // --- list shows the archive newest-first ----------------------------------
  const backups = await listBackups(paths.backupDir)
  assert.equal(backups.length, 1)
  assert.equal(backups[0].file, entry.file)
  assert.match(backups[0].date, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  assert.equal((await listBackups(path.join(root, 'missing'))).length, 0, 'missing dir lists empty')

  // --- restore 'yes' keeps files not in the backup --------------------------
  fs.writeFileSync(path.join(paths.dshHome, 'extra.txt'), 'extra')
  fs.rmSync(path.join(paths.dshHome, 'profiles', 'web', 'config.json'))
  await restoreBackupArchive(entry.path, paths, 'yes', noopSignal)
  assert.ok(fs.existsSync(path.join(paths.dshHome, 'profiles', 'web', 'config.json')),
    'yes-mode restores archived files')
  assert.ok(fs.existsSync(path.join(paths.dshHome, 'extra.txt')),
    'yes-mode keeps files not in the backup')

  // --- restore 'clean' wipes files absent from the archive ------------------
  await restoreBackupArchive(entry.path, paths, 'clean', noopSignal)
  assert.ok(!fs.existsSync(path.join(paths.dshHome, 'extra.txt')),
    'clean-mode removes files not in the backup')
  assert.ok(fs.existsSync(path.join(paths.dshHome, 'profiles', 'package.json')),
    'clean-mode restores archived files')

  // --- clean-mode safety refusals -------------------------------------------
  await assert.rejects(
    restoreBackupArchive(entry.path, { ...paths, dshHome: os.homedir() }, 'clean', noopSignal),
    error => error instanceof BackupError && /Refusing to clean/.test(error.message),
    'clean-mode refuses the user home')
  await assert.rejects(
    restoreBackupArchive(entry.path, { ...paths, dshHome: '/' }, 'clean', noopSignal),
    error => error instanceof BackupError && /Refusing to clean/.test(error.message),
    'clean-mode refuses /')

  // --- error paths -----------------------------------------------------------
  await assert.rejects(
    createBackupArchive({ ...paths, dshHome: path.join(root, 'nope') }, noopSignal),
    error => error instanceof BackupError && /does not exist/.test(error.message),
    'backup errors on missing DSH_HOME')
  await assert.rejects(
    restoreBackupArchive(path.join(paths.backupDir, 'nope.tar.gz'), paths, 'yes', noopSignal),
    error => error instanceof BackupError && /does not exist/.test(error.message),
    'restore errors on missing archive')

  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(
    createBackupArchive(paths, aborted.signal),
    error => error instanceof BackupCancelledError,
    'pre-aborted signal cancels the backup')

  const badArchive = path.join(paths.backupDir, 'dsh-backup-bad.tar.gz')
  fs.writeFileSync(badArchive, 'not a tarball')
  await assert.rejects(
    restoreBackupArchive(badArchive, paths, 'yes', noopSignal),
    error => error instanceof BackupError && /tar exited/.test(error.message),
    'tar failure surfaces stderr')

  // --- plugin entry registers the three commands -----------------------------
  assert.equal(plugin.name, 'dsh-backup')
  assert.deepEqual(plugin.inject, ['commands', 'userQuestions'])
  const registered = []
  plugin.apply({
    effect: establish => establish(),
    commands: { register: definition => { registered.push(definition); return () => {} } },
    logger: { info: () => {}, error: () => {} },
  })
  assert.deepEqual(registered.map(definition => definition.name),
    ['backup', 'backup-list', 'backup-restore'])
  for (const definition of registered) {
    assert.equal(typeof definition.description, 'string')
    assert.equal(typeof definition.handler, 'function')
  }

  console.log('ALL TESTS PASSED')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
