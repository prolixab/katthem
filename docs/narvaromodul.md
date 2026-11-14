# Närvarobekräftelse – valbar modul

## Påkoppling

1. Driftsätt versionen; modulen är fortfarande avstängd.
2. Logga in som systemets superadmin och välj katthem.
3. Administration → Moduler – närvarobekräftelse → Aktivera → Spara modulinställning.
4. Hämta QR-skylten från den publicerade portalen.

Avstängning tar bort dagens bekräftelser och döljer modulen för volontärer. Aktivering styrs separat per databas/katthem, inte genom ett namn eller ett frivilligt klientvärde.

## Stabilt modulgränssnitt

Manifestet presenceModule beskriver id, version, standardaktivering och transientTables. createPresence tar emot en databas, injicerbar klocka och behörighetskontroll. Inställning, domänoperationer, snapshot och HTTP-adapter ligger i modulen. Klientvyn och QR-landningen ligger i public/presence.js. Core anropar bara modulens API och inkluderar snapshot i state.

- PUT /api/presence/settings: enabled och revisionsnummer; endast superadmin.
- GET /api/presence: dagens positiva uppgifter och egna val.
- POST /api/presence/confirmations: kind=booked och eget booking_id, eller kind=spontaneous.
- DELETE /api/presence/confirmations/:id: ångra en egen bekräftelse idag.
- GET /api/presence/qr: QR-bild och länk; endast admin när modulen är på.

Avstängda domänanrop returnerar MODULE_DISABLED. Servern validerar bokningens ägare, datum, status och användarens engagemang. Unika index gör dubbeltryck idempotenta. Inställning och skrivning skyddas med SQLite-transaktioner. Inga datum eller klockslag accepteras från klienten.

## Integritetsgränser vid utbyggnad

Behåll positiv, frivillig dagsbekräftelse. Lägg inte till frånvarolistor, förklaringskrav, individuell historik, positionering, tidsmätning eller koppling till behörighet/statistik utan ett nytt uttryckligt beslut. Tabeller med bekräftelser tas bort ur kopior före hash och verifiering, medan inställningar bevaras. Använd inte adminloggen för bekräftelser. QR-koden är en vanlig delbar länk, ingen platskontroll.
