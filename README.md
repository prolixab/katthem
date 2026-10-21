# Katthemmet – lokal första version

Kräver Node.js 24 eller senare. Inga paket behöver installeras.

## Starta

Dubbelklicka på **Starta katthemmet.cmd**, eller kör `npm start` i denna mapp. Öppna http://127.0.0.1:3080. Stäng terminalen för att stoppa appen. Appen lyssnar bara på den här datorn.

Vid första starten skapas ett administratörskonto och ett volontärkonto med slumpade lösenord. Uppgifterna ligger i **data/lokala-konton.txt**. Byt lösenord under Mitt konto. Filen med startlösenorden uppdateras inte vid lösenordsbyte och kan därefter raderas.

## Funktioner

- Inloggning med separata roller och lösenord lagrade med salt och scrypt.
- Veckoschema med sex veckors morgon- och kvällspass från första starten.
- Bokning med kapacitetskontroll, skydd mot dubbelbokning och överlappande pass.
- Mina bokningar och avbokning fram till 24 timmar innan passet.
- Administratören kan lägga till och inaktivera volontärer, skapa och ställa in pass samt boka och avboka åt andra.
- CSV-export med semikolon som avgränsare. I Google Sheets: Arkiv → Importera → Ladda upp, välj filen och semikolon som avgränsare vid behov.

## Data och säkerhetskopia

All data sparas lokalt i **data/katthem.sqlite**. Stoppa appen och kopiera data-mappen till en säker plats för en fullständig säkerhetskopia. CSV är en rapport och ersätter inte en databaskopia. Lägg inte databasen i en offentligt delad mapp.

Pass använder datorns lokala tid. Använd svensk tidszon på datorn. Inaktivering tar inte bort befintliga bokningar; administratören hanterar dessa i schemat. Inställning av ett pass tar bort dess bokningar efter bekräftelse.

## Nästa version

Automatisk Google Sheets-synkning, e-postpåminnelser, lösenordsåterställning, återkommande personliga bokningar och ändring av befintliga pass ingår inte ännu. Nya pass skapas var för sig; de första sex veckorna läggs in automatiskt. För användning från flera datorer behövs gemensam drift, HTTPS, säkerhetskopiering och konfiguration av e-post. Publicera inte denna lokala server direkt på internet.

## Verifiering

Kör `npm test` för integrationstester av autentisering, behörighet, bokning och datalagring. Testerna använder en separat tillfällig databas.
