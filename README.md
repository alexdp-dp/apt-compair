# AptCompare Build 11

Build 11 focuses on generic crawler correctness and conservative data extraction.

- Generic contextual price scoring: never picks the smallest/first euro amount from the page.
- Prices near parking, garage, storage, design, furnishing, commission, advance/payment, rent or fee terms are rejected/penalized.
- If an individual price cannot be identified confidently, it stays NA and the existing category `de la` fallback can be used.
- Generic availability inference is disabled. AptCompare no longer displays `Sold Out`; unclear availability stays empty/NA rather than being guessed.
- Keeps Build 10 scanning, sitemap discovery, long-tail typology titles, project/location extraction, PostgreSQL admin reset, and stable image fallback.
