# AptCompare Build 9

Stability build.

- fixes PostgreSQL INSERT mismatch that prevented all discovered typologies from being saved;
- scans up to 5 detail pages in parallel per source;
- scans up to 4 sources in parallel so one slow developer no longer blocks the entire batch;
- 12s request timeout + 6 minute controlled per-source budget; failed pages are counted and the scan continues;
- interrupted stale scans are marked as errors after restart/deploy instead of remaining stuck forever;
- image cards are NOT rerendered every second while scan status is polled, eliminating hero/logo refresh flicker;
- stable hero -> logo -> static initials fallback remains;
- HILS project URLs such as /nord/ are recognized as HILS Nord;
- all Build 8 rules remain: long-tail typologies only, full commercial titles, sitemap discovery, Localizare/Locație, multi-project Alera, Database Admin, room filter 'Toate'.

Deploy normally on Render. Existing PostgreSQL schema/data is migrated in place.
