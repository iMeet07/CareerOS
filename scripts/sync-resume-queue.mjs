#!/usr/bin/env node
// Resume queue sync — not applicable in local SQLite mode.
// This script is a no-op for local development. The tailor sidecar (tailor-simple.mjs)
// handles queuing directly via POST /tailor without a separate queue table.
console.log("[resume-sync] Local mode — no queue sync needed. Use npm run tailor:prod.");
