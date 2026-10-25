
# Browser Rendering `/crawl` 參數表

查表資料；判準在 `rules/引數對應與終態判準.md`。

## Core

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

## Options object

| Parameter              | Type    | Default | Description                                    |
| ---------------------- | ------- | ------- | ---------------------------------------------- |
| `includePatterns`      | array   | []      | Wildcard patterns to include (`*` and `**`)    |
| `excludePatterns`      | array   | []      | Wildcard patterns to exclude (higher priority) |
| `includeSubdomains`    | boolean | false   | Follow links to subdomains                     |
| `includeExternalLinks` | boolean | false   | Follow external links                          |

## Advanced

| Parameter             | Type   | Description                                                |
| --------------------- | ------ | ---------------------------------------------------------- |
| `jsonOptions`         | object | AI-powered structured extraction (prompt, response_format) |
| `authenticate`        | object | HTTP basic auth (username, password)                       |
| `setExtraHTTPHeaders` | object | Custom headers for requests                                |
| `rejectResourceTypes` | array  | Skip: image, media, font, stylesheet                       |
| `userAgent`           | string | Custom user agent string                                   |
| `cookies`             | array  | Custom cookies for requests                                |
