import { config } from '@nav/config'
import { createBackup } from '../lib/backup.js'
import { closeDatabase, getDatabase } from '../lib/sqlite.js'

try {
  const result = await createBackup(getDatabase(), {
    backupDir: config.localDatabase.backupDir
  })
  console.log(JSON.stringify(result))
} finally {
  closeDatabase()
}
