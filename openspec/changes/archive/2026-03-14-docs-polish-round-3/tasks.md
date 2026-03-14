## 1. FAQ Organized by Decision Domain

- [x] 1.1 Add performance FAQ entries to `docs/FAQ.md` — "效能與規模" category: RLS 效能影響、N+1 查詢偵測、Supabase 免費方案規模限制
- [x] 1.2 Add cost FAQ entries — 超過免費方案限制怎麼辦、Cloudflare Workers 費用
- [x] 1.3 Add team collaboration FAQ entries — "團隊協作" category: 避免 migration 衝突、Code Review 標準、新成員快速上手

## 2. Docs Detail Fixes

- [x] 2.1 Fix DEPLOYMENT.md smoke test clarification — specify DEPLOY_URL format (`https://my-app.workers.dev`, with protocol, no trailing slash), add example in GitHub Variables table
- [x] 2.2 Implement setup script .env audit — after completion, parse `.env` and list empty/placeholder keys with descriptions as warning; satisfies setup script .env guidance spec

## 3. README Advanced Sections Moved to Existing Docs

- [x] 3.1 Move "核心概念" and "開發工作流程" sections from README to `docs/WORKFLOW.md`, replace with one-line summaries + links
- [x] 3.2 Verify README under 200 lines and all links resolve correctly
