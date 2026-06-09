import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { assertSnapshotIntegrity, createBackup } from './backup.js'
import { migrate } from './sqlite.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('SQLite backups', () => {
  it('creates an integrity-checked snapshot and retains exactly 12 sets', async () => {
    const directory = temporaryDirectory()
    const db = new Database(join(directory, 'source.sqlite'))
    migrate(db)

    for (let index = 0; index < 13; index += 1) {
      await createBackup(db, {
        backupDir: join(directory, 'backups'),
        now: new Date(Date.UTC(2026, 0, index + 1))
      })
    }
    db.close()

    const files = readdirSync(join(directory, 'backups')).sort()
    expect(files.filter(file => file.endsWith('.sqlite'))).toHaveLength(12)
    expect(files.filter(file => file.endsWith('.json'))).toHaveLength(12)
    expect(files.filter(file => file.endsWith('.sha256'))).toHaveLength(12)
    expect(files.some(file => file.includes('20260101'))).toBe(false)
    assertSnapshotIntegrity(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      join(directory, 'backups', files.find(file => file.endsWith('.sqlite'))!)
    )
  })

  it('rejects a corrupt snapshot', () => {
    const directory = temporaryDirectory()
    const corrupt = join(directory, 'corrupt.sqlite')
    writeFileSync(corrupt, 'not a sqlite database')
    expect(() => assertSnapshotIntegrity(corrupt)).toThrow()
  })
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'diy-nav-backup-'))
  directories.push(directory)
  return directory
}
