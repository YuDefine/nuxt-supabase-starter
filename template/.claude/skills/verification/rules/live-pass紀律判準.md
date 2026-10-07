
# Rule 1 - 依 Launch model 串行或隔離 drive，全程維持 Doctor 與 cleanup 紀律

- Level: `MUST`
- Coordinator 依 target skill 的 Launch model drive 每個 feature：server/UI 用一個 leased instance 串行，short-lived CLI 每次用 isolated session。
- 全程維持：
  1. first drive、fresh session、surprising failure 後先 Doctor；doctor 看不到 wedged UI 時 reset 或 relaunch。
  2. cleanup 後逐次確認已捕捉 evidence 仍存在。
  3. drive 建立的 process、port、profile、scratch state 不超過需要的生命週期。
- Cleanup 只清自己建立的 process／scratch state，**NEVER** 依 process name 殺程序，**NEVER** 刪 evidence。

## Good Example

- 這個例子是好的，因為 surprising failure 後先 Doctor。

```text
drive loans 時 500 → Doctor：port 3000 owner 是另一個 instance → relaunch leased instance 再 drive
```

## Bad Example

- 這個例子是壞的，因為依名稱殺程序。

```text
pkill node，再重跑 drive
```

# Rule 2 - pause／resume 只在已授予的 capability 內，每次寫 audit event

- Level: `MUST`
- Agent 可依已授予的 capability 自行 pause／resume；每次 pause／resume 都寫 audit event。這不授予新 credential、external write 或 global scope，grant 外仍走 human gate。

## Good Example

- 這個例子是好的，因為 pause 留下 audit event。

```text
audit: pause live-pass（等 seed 重建），resume 14:02
```

## Bad Example

- 這個例子是壞的，因為以 pause／resume 為名取得 grant 外的寫入。

```text
resume 時順便用 production token 補資料
```
