# AptCompare Build 15

Build 15 pornește din Build 14 și adaugă scope strict pe URL-ul sursă.

Dacă sursa este:
`https://cordia.ro/ansambluri-rezidentiale/centropolitan-by-cordia/`

crawlerul poate folosi numai pagina respectivă și URL-uri descendente din acel subfolder. URL-uri precum `/blog/`, alte proiecte Cordia sau orice altă zonă a domeniului sunt ignorate chiar dacă apar în sitemap, meniuri, HTML sau JavaScript.

Pentru surse introduse la rădăcină (`https://exemplu.ro/`), comportamentul rămâne crawl pe întreg domeniul.

Build 15 păstrează logica de titlu, suprafață și preț din Build 14.
