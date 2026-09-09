# AptCompare – Build 1 funcțional

## Pornire
```bash
npm install
npm start
```
Deschide http://localhost:3000

## Ce este funcțional
- backend Node/Express;
- listă configurabilă de surse;
- adăugare sursă din UI;
- scanare individuală sau toate sursele;
- crawler same-domain care descoperă pagini de apartamente/unități;
- extragere euristică: tip, camere, preț, TVA, suprafață utilă/totală/construită, status, finalizare;
- calcul automat €/mp util;
- stocare în `data/listings.json`;
- comparator dinamic și filtre;
- fiecare înregistrare păstrează URL-ul sursă și data scanării;
- lipsurile rămân NA.

## Limitări Build 1
Extractorul este generic. Pentru template-ul exact folosit de proiectele Digital Partners merită în Build 2 să introducem selectori CSS/JSON dedicați după ce inspectăm HTML-ul real al template-ului. Asta va crește precizia și va elimina duplicatele.
