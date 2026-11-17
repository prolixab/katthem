# Närvarobekräftelse – valbar modul

Modulen är avstängd från början per katthem. SA kan aktivera eller deaktivera den under Administration → Moduler – närvarobekräftelse. Avstängning rensar dagens bekräftelser och profilernas senaste bekräftelsedatum samt spärrar QR och mobilbehörigheter.

## Visningsdator
Skapa en visningslänk under Administration → Visningsskärm för schemat. Öppna den på katthemmets dator och låt SA godkänna registreringskoden som visas där. Koden gäller tio minuter; endast en webbläsare per katthem kan vara godkänd. SA kan aktivera läslås för publikt schema per katthem; det är avstängt från början. Utan läslås fungerar befintliga länkar för läsning. QR och incheckning kräver ändå registrering; välj Registrera för incheckning på visningssidan. Med läslås visas registreringskoden direkt. SA kan återkalla/ersätta enheten. Webbläsarnyckeln ligger i en HttpOnly/Secure/SameSite=Strict-cookie i produktion och endast dess hash lagras. Länkrotation återkallar enheter. Rensad lagring kräver ny registrering. Enhetsgodkännanden ingår inte i säkerhetskopior.

## Incheckning
Den godkända skärmen visar en QR som byts varje minut och upphör vid nästa minutgräns. Efter inloggning kan en giltig kod växlas mot fem minuters bekräftelserätt för den inloggade sessionen och samma katthem. Om koden hinner gå ut under inloggningen behöver volontären skanna igen. Mina bokningar visar närvarodelen; direkta incheckningsanrop utan giltig bekräftelserätt nekas. Egna feltryck kan ångras utan ny kod. Namnval för dagens bokade pass går bara från den godkända skärmen och kräver separat aktivering. Spontana insatser går via QR och personlig inloggning.

- PUT /api/presence/settings: aktivering och revisionsnummer; endast SA.
- GET /api/presence: dagens positiva uppgifter, egna bekräftelser och giltighet för sessionens bekräftelserätt.
- POST /api/presence/access: signerad aktuell QR-token; skapar en kortlivad sessionsbunden rätt.
- POST /api/presence/confirmations: eget bokat pass idag eller spontan insats; serververifierad rätt krävs.
- DELETE /api/presence/confirmations/:id: ångra egen bekräftelse idag.
- GET /api/presence/qr: ger inte längre en statisk eller utskrivbar kod.
- POST /api/display/enroll: registrera webbläsare som väntar på godkännande.
- POST/DELETE /api/portal/display/device: godkänn med kod eller återkalla; endast SA och revisionskontroll.

Domänreglerna validerar bokningens ägare, datum, status och engagemang. Gateway verifierar enhet, token och sessionsrätt; katthemsprocessen kräver en intern betrodd markering för mobila bekräftelser. Privata skärmrutten går inte att anropa från det publika gränssnittet.

## Integritet och begränsningar
Bekräftelsen är frivillig samordning, inte arbetstidskontroll. Inga frånvarolistor, individuella historiklistor, ankomstklockslag eller positionskontroller. Senaste bekräftelsedatumet sparas privat utan klockslag. Dagens bekräftelser rensas vid dagsbyte och alla närvarouppgifter stryks ur backuper. Skanningar och personers bekräftelser hamnar inte i adminloggen. QR och mobilrättigheter är kortlivade; modulavstängning, återkallad enhet/länk och omstart spärrar dem. Skyddet hindrar inte att någon vidarebefordrar en giltig kod direkt eller kopierar en hel webbläsarprofil.
