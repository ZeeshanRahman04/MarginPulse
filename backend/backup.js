import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const databasePath = process.env.DATABASE_PATH ?? path.join(root, 'src/db/margin-pulse.sqlite')
const backupDirectory = process.env.BACKUP_DIRECTORY ?? path.join(root, 'backups')
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 30)
const secret = process.env.BACKUP_ENCRYPTION_KEY

if (!secret || secret.length < 32) {
  throw new Error('BACKUP_ENCRYPTION_KEY must contain at least 32 characters.')
}

const plaintext = await fs.readFile(databasePath)
const salt = crypto.randomBytes(16)
const iv = crypto.randomBytes(12)
const key = crypto.scryptSync(secret, salt, 32)
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
const header = {
  algorithm: 'aes-256-gcm',
  createdAt: new Date().toISOString(),
  databaseSha256: crypto.createHash('sha256').update(plaintext).digest('hex'),
  iv: iv.toString('base64'),
  salt: salt.toString('base64'),
  tag: cipher.getAuthTag().toString('base64'),
}
const payload = Buffer.concat([
  Buffer.from(`${JSON.stringify(header)}\n`),
  ciphertext,
])
const filename = `margin-pulse-${header.createdAt.replaceAll(':', '-')}.sqlite.enc`

await fs.mkdir(backupDirectory, { recursive: true, mode: 0o700 })
await fs.writeFile(path.join(backupDirectory, filename), payload, { mode: 0o600 })
await pruneExpiredBackups()

console.log(JSON.stringify({ backup: filename, ...header }, null, 2))

async function pruneExpiredBackups() {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const entries = await fs.readdir(backupDirectory, { withFileTypes: true })

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.sqlite.enc'))
      .map(async (entry) => {
        const backupPath = path.join(backupDirectory, entry.name)
        const stats = await fs.stat(backupPath)
        if (stats.mtimeMs < cutoff) await fs.rm(backupPath)
      }),
  )
}
