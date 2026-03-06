## Blob Storage

File storage. `blob` is auto-imported on server-side.

### Blob API

```ts
import { blob } from 'hub:blob'

// Upload
const result = await blob.put('path/file.txt', body, {
  contentType: 'text/plain',
  access: 'public', // 'public' | 'private' (v0.10.4+)
  addRandomSuffix: true,
  prefix: 'uploads',
})
// Returns: { pathname, contentType, size, httpEtag, uploadedAt }

// Download
const file = await blob.get('path/file.txt') // Returns Blob or null

// List
const { blobs, cursor, hasMore, folders } = await blob.list({
  prefix: 'uploads/',
  limit: 10,
  folded: true,
})

// Serve (with proper headers)
return blob.serve(event, 'path/file.txt')

// Delete
await blob.del('path/file.txt')
await blob.del(['file1.txt', 'file2.txt']) // Multiple

// Metadata only
const meta = await blob.head('path/file.txt')
```

### Upload Helpers

```ts
// Server: Validate + upload handler
export default eventHandler(async (event) => {
  return blob.handleUpload(event, {
    formKey: 'files',
    multiple: true,
    ensure: { maxSize: '10MB', types: ['image/png', 'image/jpeg'] },
    put: { addRandomSuffix: true, prefix: 'images' },
  })
})

// Validate before manual upload
ensureBlob(file, { maxSize: '10MB', types: ['image'] })

// Multipart upload for large files (>10MB)
export default eventHandler(async (event) => {
  return blob.handleMultipartUpload(event) // Route: /api/files/multipart/[action]/[...pathname]
})
```

### Vue Composables

```ts
// Simple upload
const upload = useUpload('/api/upload')
const result = await upload(inputElement)

// Multipart with progress
const mpu = useMultipartUpload('/api/files/multipart')
const { completed, progress, abort } = mpu(file)
```

### Blob Providers

| Provider      | Package        | Config                                                               |
| ------------- | -------------- | -------------------------------------------------------------------- |
| Cloudflare R2 | -              | `BLOB` binding in wrangler.jsonc                                     |
| Vercel Blob   | `@vercel/blob` | `BLOB_READ_WRITE_TOKEN`                                              |
| S3            | `aws4fetch`    | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_REGION` |
