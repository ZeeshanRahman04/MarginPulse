import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const databasePath = process.env.DATABASE_PATH ?? path.join(root, 'src/db/margin-pulse.sqlite')
const backupPath = process.argv[2]
const secret = process.env.BACKUP_ENCRYPTION_KEY

if (!backupPath) {
  throw new Error('Usage: node backend/restore.js /path/to/backup.sqlite.enc')
}
if (process.env.CONFIRM_DATABASE_RESTORE !== 'RESTORE') {
  throw new Error('Set CONFIRM_DATABASE_RESTORE=RESTORE to replace the database.')
}
if (!secret || secret.length < 32) {
  throw new Error('BACKUP_ENCRYPTION_KEY must contain at least 32 characters.')
}

const payload = await fs.readFile(path.resolve(backupPath))
const separator = payload.indexOf(10)
if (separator < 0) throw new Error('Backup header is invalid.')

const header = JSON.parse(payload.subarray(0, separator).toString('utf8'))
if (header.algorithm !== 'aes-256-gcm') throw new Error('Unsupported backup algorithm.')

const key = crypto.scryptSync(secret, Buffer.from(header.salt, 'base64'), 32)
const decipher = crypto.createDecipheriv(
  'aes-256-gcm',
  key,
  Buffer.from(header.iv, 'base64'),
)
decipher.setAuthTag(Buffer.from(header.tag, 'base64'))
const plaintext = Buffer.concat([
  decipher.update(payload.subarray(separator + 1)),
  decipher.final(),
])
const checksum = crypto.createHash('sha256').update(plaintext).digest('hex')
if (checksum !== header.databaseSha256) {
  throw new Error('Backup checksum validation failed.')
}

const safetyCopy = `${databasePath}.pre-restore-${new Date().toISOString().replaceAll(':', '-')}`
try {
  await fs.copyFile(databasePath, safetyCopy)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
await fs.mkdir(path.dirname(databasePath), { recursive: true })
await fs.writeFile(databasePath, plaintext, { mode: 0o600 })

console.log(JSON.stringify({ restored: databasePath, safetyCopy, checksum }, null, 2))
