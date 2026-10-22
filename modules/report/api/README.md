# Report business transport

`client.ts` is the browser entry point. It uses native same-origin `fetch`; JWTs never enter JavaScript/localStorage. The API signatures match the original Report request helpers, including `signal`/`timeout` on GET/POST. A successful `{code,message,data}` response resolves to `data`. `downloadReport(path, data, filename)` POSTs JSON and automatically downloads XLSX using the caller's sanitized filename. A 401 navigates to `/login?next=<relative current route>`.

`app/api/report/business/[...path]/route.ts` reads only the existing `report_access_token` HttpOnly cookie. `server.ts` forwards it as Bearer to the operator-configured **origin** `REPORT_API_URL` (default `http://127.0.0.1:8001`), under `/api/v1`. Do not set this variable to an untrusted host: that host receives the credential. Only HTTP(S) origins without credentials, paths, queries or fragments are valid. No browser-supplied host, forwarding header, authorization header or URL changes the upstream origin. The upstream backend remains responsible for user/role/department authorization, filtering and masking.

The exact path/method allowlist lives in `policy.ts`:

- GET current profile; department tree/subordinates; feedback category tree; report-search options/read-only dictionaries/metrics.
- GET police community/street/tag and 110-statistics category/feedback/place dictionaries.
- POST police search, 110-statistics and their XLSX exports.
- GET warnings rules/options/list/recent.
- GET/POST tag packages; PUT/DELETE a positive numeric package ID.
- GET tags-v2 catalog/stats/search/alarm detail; PUT verification; POST XLSX export.

Unknown routes/methods, login, user/department administration, report execution, legacy tag search and generic proxying are deliberately not exposed. Adding a page requiring another route requires an explicit policy change and test; do not widen prefixes.

## Limits and differences from the original transport

- Incoming JSON is limited to **2 MiB actual UTF-8 bytes**, read incrementally even without Content-Length; object bodies only. JSON responses are bounded at **32 MiB**. Query strings are capped at **64 KiB**. These can reject unusually large requests/catalogs that the original Axios client accepted.
- Default request deadline is 30 s; tags-v2 search and exports have 120 s server deadlines. Browser GET/POST callers can request up to 120 s, but cannot extend the route's server deadline. Deadlines include body reads, and binary streams remain cancellable and timed until consumed. A stream interrupted after headers fails the download rather than changing the already-sent HTTP status. Client disconnect aborts fetch, not necessarily database work already started upstream.
- Error responses deliberately use safe localized status-based messages instead of upstream exception/detail strings, which may contain SQL, input or credentials. Specific backend validation explanations are therefore less detailed than the original frontend. HTTP 401/403/404/409/422/429 semantics remain distinct.
- Export responses stream through the proxy without buffering a workbook there. The browser buffers the XLSX Blob for automatic download. Response headers are rebuilt, never forwarding upstream cookies, redirects, debug headers or arbitrary filenames. Caller-provided filenames are used rather than the upstream suggested filename.
- Dynamic alarm identifiers are restricted to ASCII letters, digits, `_` and `-` (1–128 characters), package IDs to positive decimal integers (up to 19 digits). Encoded separators, traversal, extra path segments and noncanonical encodings are refused.
- No automatic retries of writes or queries, and no caching. No new dependencies. Existing auth and outer navigation/chat are untouched by this transport implementation.

## Verification

From the project root:

```sh
node --experimental-strip-types --test "modules/report/api/*.test.mjs"
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js modules/report/api/client.ts modules/report/api/policy.ts modules/report/api/server.ts 'app/api/report/business/[...path]/route.ts'
```

Tests mock native fetch/streams and browser download APIs, covering method/path policy, origin configuration and traversal attacks, header/credential isolation, request limits, error redaction, response envelopes, cancellation/timeouts, streaming export and safe filenames. They do **not** establish live backend/database availability, real account department restrictions, masking accuracy, or browser UI parity; those need authenticated integration tests against the configured Report backend. No development build/restart is required.
