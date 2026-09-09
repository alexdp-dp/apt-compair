# AptCompare Build 14

Recovery/stability build based on Build 13.

Changes in this build:
- price extraction changed only; title/area/discovery logic kept from Build 13
- price is accepted from the same listing/card context as the typology when available
- detail-page price search is restricted to the primary property area and stops before recommendation/similar-property sections
- amounts associated with parking, garage, storage, design, furniture, deposit, installments, commission, taxes, rent, etc. are rejected as apartment price
- no global `body` minimum-price selection
- if no reliable individual price is found, category `de la` fallback remains available; otherwise NA
- Sold Out remains disabled as a generic inferred availability

Deploy normally on Render with the existing PostgreSQL DATABASE_URL.
