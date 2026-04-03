# 分頁與搜尋

## 分頁查詢

```typescript
const from = (query.page - 1) * query.pageSize
const to = from + query.pageSize - 1

let dbQuery = db.from('resources').select('*', { count: 'exact' }).is('deleted_at', null)

// 搜尋
if (query.search) {
  const searchStr = `%${query.search}%`
  dbQuery = dbQuery.or(`name.ilike.${searchStr},code.ilike.${searchStr}`)
}

// 排序
dbQuery = dbQuery.order(query.sortBy || 'id', { ascending: query.sortDir === 'asc' })

// 分頁
const { data, count, error } = await dbQuery.range(from, to)
```

## 操作日誌

異動操作應記錄日誌：

```typescript
await db.from('operation_logs').insert({
  user_id: user.id,
  action: 'create', // create | update | delete
  target_type: 'resource',
  target_id: newItem.id.toString(),
  details: body,
})
```
