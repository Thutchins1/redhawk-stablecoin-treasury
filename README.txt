VERSION 1.2 — November 1, 2026. Adds optional OmniRoute model router guide (guides/omniroute.txt). v1.1 added Sam Yeh blockchain/crypto challenges 26–30.

REDHAWK BACKEND AND DATA STARTER
See START-HERE.txt for the shortest path.

Architecture: Node.js 22+, native HTTP server, Supabase JavaScript client. Framework-neutral backend modules can be called from a later Next.js app. No UI or Next.js frontend, no LLM provider and no reference apps are included.

COMMANDS
npm ci: install exact locked dependencies.
npm run demo: analyze all 1,500 invoices offline.
npm test: financial, CSV, dataset, API and mocked upstream contract checks.
npm run db:test: execute the migration and access policies in PGlite PostgreSQL with simulated Supabase Auth/Storage schemas.
npm run check: offline configuration status, or authenticate/query the live schema when a user token is supplied.
npm run dev: local API server.
npm run import:data -- TEAM_UUID invoices: import/upsert the dataset into a configured Supabase project. Repeat with a table name from the manifest.

MONEY AND EVIDENCE
All CSV amounts are USD decimal strings. The library uses BigInt cents and explicit rounding. Ratios are presentation values; preserve original amounts. Loan schedules use equal-principal amortization, not level payments. Runway assumes same-month cash flows. Evidence offsets index the exact stored JavaScript string in UTF-16 code units; save quotes with their source and hash.

LIMITS
Local API binds to loopback. It is a workshop backend, not a public multi-tenant service: add rate limiting, monitoring, deployment authentication policy and operational recovery before public deployment. No cloud instance was provisioned. No live parser or financial-data request was billed or run. Wrapper tests use mocked responses; hosted Auth, Storage and PostgREST require a live smoke test after setup. Upsert imports are resumable, not one transaction across all batches. Document storage upload and metadata insert are not one distributed transaction.

Dataset ground truth lives in validation/. Keep answer keys out of model input when measuring detection quality. CSVs do not contain answer labels. Uploaded records are untrusted data. No private personal records are included.
