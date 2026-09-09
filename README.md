# AptCompare Build 13 — recovery/stable

Acest build revine la parserul stabil din Build 10 și elimină regresiile introduse în Build 11/12.

- parserul de tipologii/date este cel din Build 10
- NU mai face extragerea experimentală din listing care concatena suprafața/statusul în titlu
- disponibilitatea generică este dezactivată (nu mai deduce Sold Out)
- păstrează PostgreSQL, Database Admin, sitemap discovery, localizare, scanare paralelă, titluri complete, NARI/vile/case și fallback imagini fără flicker
- BUILD=13

Scopul acestui build este recuperarea unei baze funcționale înainte de a reface separat, testat, parserul generic de preț.
