# AptCompare Build 12

Hotfix / parser recovery build.

- Restores data extraction after Build 11 became too conservative.
- Listing/category cards are first-class extraction sources: title, rooms, area, price and VAT are saved before detail-page enrichment.
- Detail pages enrich missing fields but cannot wipe card values with NA.
- Generic price extraction is context-aware and rejects parking/garage/storage/design/commission/advance/rent/fee amounts.
- If an individual price is unclear, category `de la` remains the fallback.
- Generic Sold Out inference remains disabled.
- Keeps sitemap discovery, long-tail full titles, location-page lookup, PostgreSQL admin reset, scan concurrency and stable image fallback.
