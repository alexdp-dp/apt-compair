# AptCompare — Build 3

Build 3 mută aplicația pe PostgreSQL persistent și schimbă modelul din „unități individuale” în **tipologii unice per proiect**.

## Render

Web Service:
- Environment: Node
- Build Command: `npm install`
- Start Command: `npm start`

Variabilă obligatorie:
- `DATABASE_URL` = Internal Database URL al bazei PostgreSQL din Render

La primul start aplicația își creează singură tabelele și seed-uiește cele 12 surse inițiale dacă baza este goală.

## Ce include Build 3

- PostgreSQL persistent pentru surse, tipologii, scanări și istoric de preț.
- Scanare în background; request-ul de pornire nu rămâne deschis până la final.
- Live status: sursă curentă, pagini analizate, tipologii găsite, stări queued/scanning/completed/error.
- Agregare pe tipologie unică: aceeași tipologie repetată în mai multe unități este păstrată o singură dată.
- URL de sursă cât mai specific pentru tipologie.
- Câmpurile negăsite rămân `NA` / NULL; nu se completează valori fictive.
- Istoric de preț când o tipologie își schimbă prețul.
- UI pe carduri de proiect, filtre cu butoane/slidere/checkbox-uri și modal „Vezi toate tipologiile”.
- Accente roșii și logo Digital Partners.
- Administrare surse din UI: adăugare, activare/dezactivare și scanare individuală.

## Observație importantă

Extractorul este deliberat conservator: dacă nu poate identifica sigur o informație, o lasă necompletată. Primele scanări reale pot evidenția selectori sau pattern-uri din template-ul vostru care merită adăugate pentru o precizie și mai mare.
