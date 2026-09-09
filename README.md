# AptCompare — Build 7

Build 7 schimbă fundamental logica crawlerului pentru a evita rezultatele generice.

## Ce este nou

- **Doar tipologii long-tail**: paginile generale precum `apartamente`, `apartamente-2-camere`, `faza-3`, `proiecte` sunt folosite numai pentru discovery. Nu sunt salvate ca tipologii.
- **Numele complet, literal**: `type_name` este titlul comercial complet din H1/card/pagina tipologiei, de exemplu `Garsonieră A9-P`, nu `A9`.
- `type_code` rămâne separat și este doar câmp tehnic.
- **Sitemap-first discovery**: crawlerul încearcă `robots.txt`, `sitemap.xml`, `sitemap_index.xml`, `wp-sitemap.xml` și sitemap-uri copil, apoi completează cu linkurile din pagini.
- **Localizare**: caută explicit pagina `Localizare` / `Locație` / `Location`, apoi extrage adresă/oraș/zonă din JSON-LD, text, Google Maps iframe/link și scripturile cu coordonate.
- **Alera / surse cu mai multe proiecte**: modelul UI este acum sursă → proiect → tipologii. Alera poate genera carduri separate pentru proiectele găsite pe paginile proprietăților.
- **Înlocuire atomică per sursă**: un scan reușit definește catalogul curent; dacă nu se găsește nicio tipologie long-tail validă, datele vechi sunt păstrate.
- **Database Admin în UI**: `Șterge datele proiectului` și `Golește toate datele scanate`, cu confirmare. Sursele, schema PostgreSQL și `DATABASE_URL` rămân intacte.
- Cardurile afișează proiectul, nu doar sursa, iar butonul de rescanare rulează sursa corespunzătoare.

## Deploy pe Render

1. Înlocuiește fișierele proiectului cu Build 7.
2. Păstrează aceeași variabilă `DATABASE_URL`.
3. Deploy normal. Migrarea adaugă automat coloanele noi `city` și `zone` în `typologies`.
4. Pentru un test curat: `Surse` → `Database Admin` → `Golește toate datele scanate`, apoi rescanează sursele.

## Comenzi Render

- Build Command: `npm install`
- Start Command: `npm start`
- Node: 20+


## Build 7 fixes
- Filtrul Număr camere pornește pe „Toate”; resetul revine la „Toate”.
- Filtrele de buget/suprafață pornesc neutru (500.000 € / 25 mp), ca rezultatele să nu fie ascunse imediat după scanare.
- Parserul acceptă titluri comerciale împărțite în card (ex. „2 camere” + „Torino”) și le păstrează ca titlu lung „2 camere Torino”.
- Pentru site-urile unde titlul complet există deja (ex. „Garsonieră A9-P”), acesta are prioritate și este păstrat literal.
- Paginile generale rămân discovery-only; URL-ul final salvat este pagina long-tail a tipologiei.
- Detectarea proiectului nu mai este limitată la Alera; caută și „În complexul: …”.
