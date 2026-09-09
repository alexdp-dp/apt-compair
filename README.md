# AptCompare Build 8

Build 8 core fixes:

- Full commercial typology names across all sources. Split card labels are concatenated from the same card (example: `2 camere + birou` + `Bonn` => `2 camere + birou Bonn`).
- Alera multi-project attribution fixed: project is extracted from the property content, never from the global navigation menu. Alera records without an explicit project are rejected rather than guessed.
- Project-level visual extraction from detail pages. Stable fallback: project image -> project/source logo -> static initials; broken images do not loop/flicker.
- Existing sitemap discovery, localization-page parsing, admin DB clear controls, and `Toate` room filter retained.
- PostgreSQL migration adds `project_image_url` and `project_logo_url` automatically.

Deploy normally on Render with Node 20+ and the existing DATABASE_URL.
