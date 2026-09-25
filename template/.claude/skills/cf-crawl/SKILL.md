---
name: cf-crawl
description: "Use when crawling a website with Cloudflare Browser Rendering /crawl to ingest web content."
---

<!-- clade-skill-scope: project -->

# Cloudflare Website Crawler

Crawl a site through Cloudflare Browser Rendering's `/crawl` REST API and save pages as local markdown.

## Arguments (`/cf-crawl <url> …`)

- First positional: URL (ask if missing)
- `--limit N` / `-l N`: max pages (default 20; the API's own default is 10)
- `--depth N` / `-d N`: max depth (default 100000)
- `--include "p1,p2"` / `--exclude "p1,p2"`: URL patterns (`*` excludes `/`, `**` includes it; exclude wins)
- `--no-render`: static HTML fetch, faster and cheaper, misses JS-rendered content
- `--merge`: combine output into one markdown file
- `--output DIR` / `-o DIR`: output dir (default `.crawl-output`)
- `--source sitemaps|links|all`: page discovery (default all)
- `--since DATE`: only pages modified since DATE (ISO date or Unix seconds) → API `modifiedSince` (`date -d "2026-03-10" +%s` on Linux, `date -j -f "%Y-%m-%d" "2026-03-10" +%s` on macOS)

## Step 1: Credentials

Need `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (token permission "Browser Rendering - Edit"). Check env first, then `.env`, `.env.local`, `~/.env`:

```bash
if [ -z "$CLOUDFLARE_ACCOUNT_ID" ] || [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  for envfile in .env .env.local "$HOME/.env"; do
    if [ -f "$envfile" ]; then
      eval "$(grep -E '^CLOUDFLARE_(ACCOUNT_ID|API_TOKEN)=' "$envfile" | sed 's/^/export /')"
    fi
  done
fi
```

Still missing or empty → ask the user to add both to the project `.env` and stop.

## Step 2: Start the crawl

```bash
curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/browser-rendering/crawl" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "<TARGET_URL>",
    "limit": <NUMBER_OF_PAGES>,
    "formats": ["markdown"]
  }'
```

Fill the body from the parsed arguments, adding only what the user passed: `--depth` → `depth`, `--source` → `source`, `--no-render` → `"render": false`, `--include`／`--exclude` → `"options": { "includePatterns": [...], "excludePatterns": [...] }`, `--since` → `"modifiedSince": <UNIX_TIMESTAMP>` (see Core Parameters). The response `result` is the job ID.

## Step 3: Poll every 5 seconds

```bash
curl -s "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/browser-rendering/crawl/<JOB_ID>?limit=1" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Status: {d[\"result\"][\"status\"]} | Finished: {d[\"result\"][\"finished\"]}/{d[\"result\"][\"total\"]}')"
```

Statuses: `running`, `completed`, `cancelled_due_to_timeout` (7-day limit), `cancelled_due_to_limits`, `errored`.

## Step 4: Retrieve and save

Records page with `?status=completed&limit=50&cursor=<CURSOR>`; with `modifiedSince`, `?status=skipped` lists unchanged pages, and robots-blocked URLs show `"status": "disallowed"`.

```bash
# Create output directory
mkdir -p .crawl-output

# Fetch and save all pages
python3 -c "
import json, os, re, sys, urllib.request

account_id = os.environ['CLOUDFLARE_ACCOUNT_ID']
api_token = os.environ['CLOUDFLARE_API_TOKEN']
job_id = '<JOB_ID>'
base = f'https://api.cloudflare.com/client/v4/accounts/{account_id}/browser-rendering/crawl/{job_id}'
outdir = '.crawl-output'
os.makedirs(outdir, exist_ok=True)

cursor = None
total_saved = 0

while True:
    url = f'{base}?status=completed&limit=50'
    if cursor:
        url += f'&cursor={cursor}'

    req = urllib.request.Request(url, headers={
        'Authorization': f'Bearer {api_token}'
    })
    with urllib.request.urlopen(req) as resp:
        data = json.load(resp)

    records = data.get('result', {}).get('records', [])
    if not records:
        break

    for rec in records:
        page_url = rec.get('url', '')
        md = rec.get('markdown', '')
        if not md:
            continue
        # Convert URL to filename
        name = re.sub(r'https?://', '', page_url)
        name = re.sub(r'[^a-zA-Z0-9]', '_', name).strip('_')[:120]
        filepath = os.path.join(outdir, f'{name}.md')
        with open(filepath, 'w') as f:
            f.write(f'<!-- Source: {page_url} -->\n\n')
            f.write(md)
        total_saved += 1

    cursor = data.get('result', {}).get('cursor')
    if cursor is None:
        break

print(f'Saved {total_saved} pages to {outdir}/')
"
```

## Parameter Reference

### Core Parameters

| Parameter       | Type    | Default    | Description                                               |
| --------------- | ------- | ---------- | --------------------------------------------------------- |
| `url`           | string  | (required) | Starting URL to crawl                                     |
| `limit`         | number  | 10         | Max pages to crawl (up to 100,000)                        |
| `depth`         | number  | 100,000    | Max link depth from starting URL                          |
| `formats`       | array   | ["html"]   | Output formats: `html`, `markdown`, `json`                |
| `render`        | boolean | true       | `true` = headless browser, `false` = fast HTML fetch      |
| `source`        | string  | "all"      | Page discovery: `all`, `sitemaps`, `links`                |
| `maxAge`        | number  | 86400      | Cache validity in seconds (max 604800)                    |
| `modifiedSince` | number  | -          | Unix timestamp; only crawl pages modified after this time |

### Options Object

| Parameter              | Type    | Default | Description                                    |
| ---------------------- | ------- | ------- | ---------------------------------------------- |
| `includePatterns`      | array   | []      | Wildcard patterns to include (`*` and `**`)    |
| `excludePatterns`      | array   | []      | Wildcard patterns to exclude (higher priority) |
| `includeSubdomains`    | boolean | false   | Follow links to subdomains                     |
| `includeExternalLinks` | boolean | false   | Follow external links                          |

### Advanced Parameters

| Parameter             | Type   | Description                                                |
| --------------------- | ------ | ---------------------------------------------------------- |
| `jsonOptions`         | object | AI-powered structured extraction (prompt, response_format) |
| `authenticate`        | object | HTTP basic auth (username, password)                       |
| `setExtraHTTPHeaders` | object | Custom headers for requests                                |
| `rejectResourceTypes` | array  | Skip: image, media, font, stylesheet                       |
| `userAgent`           | string | Custom user agent string                                   |
| `cookies`             | array  | Custom cookies for requests                                |

## Notes

- Respects robots.txt including crawl-delay
- Free plan: 10 minutes of browser time per day; results kept 14 days; max 10 MB per page
- Use `render: false` for static sites to save browser time
