import Database from 'better-sqlite3'
import { copyFileSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { config } from '@nav/config'

const sourcePath = process.argv[2] ? resolve(process.argv[2]) : ''
if (!sourcePath) throw new Error('Usage: restore.js /backups/diy-nav-<timestamp>.sqlite')

const source = new Database(sourcePath, { readonly: true })
const sourceCheck = source.pragma('integrity_check') as Array<{ integrity_check: string }>
if (sourceCheck[0]?.integrity_check !== 'ok') {
  source.close()
  throw new Error(`Snapshot integrity check failed: ${JSON.stringify(sourceCheck)}`)
}
source.close()

const targetPath = resolve(config.localDatabase.path)
const temporaryPath = `${targetPath}.restore`
mkdirSync(dirname(targetPath), { recursive: true })
copyFileSync(sourcePath, temporaryPath)
rmSync(`${targetPath}-wal`, { force: true })
rmSync(`${targetPath}-shm`, { force: true })
renameSync(temporaryPath, targetPath)

const restored = new Database(targetPath, { readonly: true })
const restoredCheck = restored.pragma('integrity_check') as Array<{ integrity_check: string }>
const counts = {
  bookmarks: (
    restored.prepare('SELECT COUNT(*) AS value FROM bookmarks').get() as { value: number }
  ).value,
  categories: (
    restored.prepare('SELECT COUNT(*) AS value FROM categories').get() as { value: number }
  ).value,
  tags: (restored.prepare('SELECT COUNT(*) AS value FROM tags').get() as { value: number }).value
}
restored.close()
if (restoredCheck[0]?.integrity_check !== 'ok') {
  throw new Error(`Restored database integrity check failed: ${JSON.stringify(restoredCheck)}`)
}
console.log(JSON.stringify({ restoredFrom: sourcePath, targetPath, counts }))
