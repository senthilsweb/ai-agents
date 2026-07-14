# utils

Standalone, single-file tools shared across the monorepo. No build
step, no dependencies to install.

## duckdb-s3-console.html

A DuckDB-WASM SQL console in one HTML file: CodeMirror editor,
paginated results, a row inspector, and a settings drawer for
S3/MinIO credentials. Queries remote parquet straight from the
browser — public https URLs work with zero setup (the default query
reads the [job-scout public dataset](../agents/job-scout/data/README.md));
S3/MinIO needs credentials via Settings.

Serve it over http, not `file://` (a `file://` page sends
`Origin: null`, which S3/MinIO CORS rejects):

    cd utils
    python3 -m http.server 8000
    open http://localhost:8000/duckdb-s3-console.html

For MinIO, also allow the origin on the server:
`MINIO_API_CORS_ALLOW_ORIGIN="http://localhost:8000"` (or `*`).

Settings can be remembered in the browser (localStorage) — credentials
never live in this file. Needs internet on first load (DuckDB-WASM and
CodeMirror come from jsDelivr).
