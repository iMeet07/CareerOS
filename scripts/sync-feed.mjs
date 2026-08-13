#!/usr/bin/env node
// Feed sync stub — Cloudflare D1/KV sync is not configured for local dev.
// The scraper pushes directly to the local SQLite server instead.
// This file exists to prevent the LaunchAgent from logging "file not found" errors.
console.log("[feed-sync] Local mode — no Cloudflare sync configured. Skipping.");
