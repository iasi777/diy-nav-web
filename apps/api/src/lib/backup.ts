import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import type { SqliteDatabase } from './sqlite.js'
import { listBookmarks, listCategories, listTags } from './sqlite.js'

export interface BackupOptions {
  backupDir: string
  now?: Date
  maxRetained?: number
}

export interface BackupResult {
  databaseFile: string
  jsonFile: string
  checksumFile: string
  retained: number
}

export async function createBackup(
  db: SqliteDatabase,
  options: BackupOptions
): Promise<BackupResult> {
  const backupDir = resolve(options.backupDir)
  const maxRetained = options.maxRetained ?? 12
  mkdirSync(backupDir, { recursive: true })

  const backupDate = options.now ?? new Date()
  const stamp = backupDate
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
  const base = join(backupDir, `diy-nav-${stamp}`)
  const databaseFile = `${base}.sqlite`
  const jsonFile = `${base}.json`
  const checksumFile = `${base}.sha256`

  try {
    await db.backup(databaseFile)
    finalizeSnapshot(databaseFile)
    writeJsonExport(db, jsonFile, backupDate)
    writeFileSync(
      checksumFile,
      `${sha256(databaseFile)}  ${databaseFile.split('/').pop()}\n` +
        `${sha256(jsonFile)}  ${jsonFile.split('/').pop()}\n`
    )
  } catch (error) {
    removeBackupSet(base)
    throw error
  }

  const retained = rotateBackupSets(backupDir, maxRetained)
  return { databaseFile, jsonFile, checksumFile, retained }
}

export function assertSnapshotIntegrity(databaseFile: string): void {
  const snapshot = new Database(databaseFile, { readonly: true })
  try {
    const check = snapshot.pragma('integrity_check') as Array<{ integrity_check: string }>
    if (check[0]?.integrity_check !== 'ok') {
      throw new Error(`Snapshot integrity check failed: ${JSON.stringify(check)}`)
    }
  } finally {
    snapshot.close()
  }
}

export function rotateBackupSets(backupDir: string, maxRetained = 12): number {
  const snapshots = readdirSync(backupDir)
    .filter(name => /^diy-nav-.*\.sqlite$/.test(name))
    .sort()
    .reverse()

  for (const snapshot of snapshots.slice(maxRetained)) {
    removeBackupSet(join(backupDir, snapshot.replace(/\.sqlite$/, '')))
  }
  return Math.min(snapshots.length, maxRetained)
}

function finalizeSnapshot(databaseFile: string): void {
  assertSnapshotIntegrity(databaseFile)
  const snapshot = new Database(databaseFile)
  snapshot.pragma('journal_mode = DELETE')
  snapshot.close()
  rmSync(`${databaseFile}-wal`, { force: true })
  rmSync(`${databaseFile}-shm`, { force: true })
  assertSnapshotIntegrity(databaseFile)
}

function writeJsonExport(db: SqliteDatabase, jsonFile: string, createdAt: Date): void {
  const payload = {
    meta: { version: '2.0.0', createdAt: createdAt.toISOString(), platform: 'sqlite-backup' },
    data: {
      websites: listBookmarks(db),
      categories: listCategories(db),
      tags: listTags(db)
    }
  }
  writeFileSync(jsonFile, `${JSON.stringify(payload, null, 2)}\n`)
}

function removeBackupSet(base: string): void {
  for (const extension of ['sqlite', 'json', 'sha256']) {
    rmSync(`${base}.${extension}`, { force: true })
  }
  rmSync(`${base}.sqlite-wal`, { force: true })
  rmSync(`${base}.sqlite-shm`, { force: true })
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}
