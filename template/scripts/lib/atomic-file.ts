// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/atomic-file.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/atomic-file.ts
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

function tempKey(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 16)
}

export async function atomicWriteText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = join(dirname(path), `.${tempKey(path)}.${process.pid}.${randomUUID()}.tmp`)
  await writeFile(tempPath, content, { encoding: 'utf8', flag: 'wx' })
  await rename(tempPath, path)
}
