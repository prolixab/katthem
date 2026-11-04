# GDPR-genomgång av Katthemmet

Datum: 2026-11-04. Granskad kod: version 0.6.005, commit 702a444.

## Bedömning och avgränsning

Underlaget räcker inte för att bedöma att hela behandlingen följer GDPR. Det finns fungerande tekniska skydd, men viktiga funktioner och rutiner saknas eller är inte verifierade. Detta är en kod- och dokumentationsgranskning, inte en certifiering, penetrationstest eller fullständig granskning av produktionsdriften. Inga riktiga personregister har exporterats och inga personuppgifter har raderats under granskningen.

Föreningen behöver bestämma ändamål och rättslig grund för varje behandling. Avtal kan vara relevant för nödvändig medlemsadministration, men omfattar inte automatiskt alla andra ändamål. [IMY om föreningar och rättslig grund](https://www.imy.se/verksamhet/dataskydd/dataskydd-pa-olika-omraden/forening/).

Bekräftat av systemägaren 2026-11-04: Värnamo är moderföreningen och Huskvarna/Jönköping är en filial. CSV-utskick till Gmail är inte aktiverade. Det talar för en gemensam personuppgiftsansvarig förening, under förutsättning att filialen hör till samma juridiska person; föreningens formella namn och kontaktuppgifter behöver anges i integritetsinformationen.

Följande är inte verifierat: serverleverantör/land, övrig faktisk e-postkonfiguration, externa avtal, tidigare information till volontärer samt föreningens rutiner utanför appen. Avsaknad av en knapp i appen bevisar inte att motsvarande rättighet inte hanteras manuellt.

## Vilka uppgifter finns i systemet?

| Område | Uppgifter i koden | Spridning/åtkomst |
|---|---|---|
| Konto | Namn, e-post, lösenordshash, behörighet, aktivering, grönmarkering och passantal | Inloggad person samt behöriga administratörer; lösenordshashen lämnas inte i vanliga API-svar eller CSV-exporter |
| Profil | Telefon, Messenger-länk, hemadress, medlemsnummer, medlemsdatum, medlemsstatus, fullständigt födelsedatum, styrelseuppdrag, ansvarsområden, utbildning och fritextanteckningar | Fullständig profil för admin/superadmin i rätt katthem |
| Presentation av ansvariga | Namn, styrelse-/adminroll, utbildning, telefon och Messenger-länk; kontaktlistan innehåller också uppdrag/katthem | Inloggade volontärer i katthemmet |
| Aktivitet | Bokade pass, historik, frånvarouppföljning, introduktionskryss, lästa/dolda nyheter | Personen och behörig administration, beroende på funktion |
| Flera katthem | Tilldelningar, lokala åtkomstidentiteter, delade kontaktfält, flyttlogg och koppling mellan historiska identiteter | Centralt register och berörda katthemsdatabaser; superadmin har bred åtkomst |
| E-post | Mottagaradresser, påminnelser, ändringsmeddelanden, återställningslänkar; valfritt CSV-bilagor | Konfigurerad e-postleverantör och mottagarkonto |
| Kalender | Personliga bokningar, tid, adress och passinformation via privat tokenlänk | Den som har länken och vald kalenderleverantör |
| Drift | Sessionstoken och tillfälliga räknare för inloggningsförsök/IP | Servern; ytterligare proxy- och driftloggar är inte verifierade |

Källor i repot: members.mjs, server.mjs (snapshot och calendar-rutter), portal.mjs, volunteer-transfer.mjs, csv-exports.mjs, notifications.mjs och reminders.mjs.

## Prioriterade fynd

### 1. Information till volontärerna saknas i appen — hög prioritet

Jag hittade ingen integritetssida eller information vid insamling/import som identifierar personuppgiftsansvarig, kontaktväg, ändamål, rättslig grund, mottagare, lagringstider och rättigheter. Manualen beskriver användningen men ersätter inte sådan information. Om föreningen redan ger fullständig information på papper eller annan plats behöver det dokumenteras och hållas konsekvent.

Åtgärd: ta fram en föreningsspecifik integritetstext som är tillgänglig före inloggning och hänvisas till vid insamling/import. Hantera även att befintliga och importerade personer får information. Dokumentera ändamål och grunder för exempelvis schemaläggning, medlemskap, födelsedagshälsningar, kontaktlistor och frånvarouppföljning. [IMY:s föreningsvägledning](https://www.imy.se/verksamhet/dataskydd/dataskydd-pa-olika-omraden/forening/det-har-behover-ni-gora).

### 2. Ingen generell gallring eller radering av personer — hög prioritet

Inaktivering blockerar inloggning men bevarar konto och profil. Flytt avslutar den gamla profilen men bevarar bland annat gamla profiluppgifter och historiska kopplingar. Jag hittade ingen generell radering/anonymisering av en person eller fastställda retentionstider för profiler, bokningar och centrala register. Vissa tekniska token har tidsgränser, vilket inte innebär gallring av personregistret.

Åtgärd: besluta separata tider för medlemsadministration, avslutade volontärer, passhistorik, mejlköer, exporter, loggar och säkerhetskopior. Bygg därefter en kontrollerad gallringsfunktion. Att radera kopplingen till en person kräver hantering i både katthemsdatabaser och centrala register. Pseudonyma id-kopplingar är fortfarande personuppgifter när personen går att identifiera. Bevara bara verkligt anonym statistik eller de uppgifter som fortsatt behövs med dokumenterat stöd. En raderingsbegäran innebär inte att alla uppgifter alltid måste raderas oavsett andra skyldigheter.

Föreningar behöver fastställa lagringstider och gallringsrutiner. [IMY:s föreningsvägledning](https://www.imy.se/verksamhet/dataskydd/dataskydd-pa-olika-omraden/forening/det-har-behover-ni-gora).

### 3. CSV via e-post kan sprida omfattande personuppgifter — åtgärdas före aktivering

Systemägaren har bekräftat att funktionen inte är aktiverad. Detta fynd gäller därför den tillgängliga funktionen och framtida aktivering, inte ett konstaterat pågående CSV-utskick.

csv-exports.mjs inkluderar hemadress, födelsedatum, telefon, medlemsuppgifter och privata anteckningar. Lösenord och dörrkoder ingår inte. Gmail-anslutningen använder TLS, men själva CSV-bilagorna har ingen separat kryptering i appen. Kopior kan bli kvar i inkorg, skickat, nedladdningar och e-postleverantörens lagring. Appen gallrar inte dessa kopior.

Åtgärd: fastställ om och varför varje exporterad uppgift behövs, vem som får tillgång till mottagarkontot och hur kopior gallras. Bedöm en säkrare backupmetod innan breda återkommande utskick aktiveras. Kontrollera konto-/avtalsform för Gmail, leverantörernas roller och underleverantörer. Administratörens godkännande av ett utskick är inte i sig en rättslig grund för behandlingen av alla volontärers uppgifter.

Biträdesavtal behövs när en extern leverantör behandlar uppgifter för föreningens räkning. Eventuella överföringar utanför EU/EES behöver ett tillåtet stöd; inte varje utländsk tjänst är automatiskt förbjuden. [IMY om biträdesavtal](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/personuppgiftsansvariga-och-personuppgiftsbitraden/personuppgiftsbitradesavtal/), [IMY om tredjeland](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/overforing-till-tredje-land/).

### 4. Ansvar mellan moderförening och filial — formell bekräftelse behövs

Enligt systemägaren är Värnamo moderförening och Huskvarna/Jönköping filial. Om de ingår i samma juridiska person är det normalt föreningen som är personuppgiftsansvarig för båda verksamheterna; separata katthemsdatabaser innebär inte i sig separata personuppgiftsansvariga. Behörigheter ska ändå motsvara arbetsbehoven. Detta är en bedömning utifrån den lämnade organisationsbeskrivningen, inte en kontroll av stadgar eller organisationsnummer.

Tekniskt är hemmen uppdelade i databaser, men superadmin kan öppna samtliga. Åtkomsttilldelning kopierar vissa kontaktfält och styrelseuppgifter; flytt kopierar en mer fullständig profil. Det finns inga förenings-/personuppgiftsansvariguppgifter eller dokumenterad rättslig bedömning knuten till detta i appen.

Åtgärd: avgör om hemmen tillhör samma juridiska förening eller olika organisationer. Bedöm vem som bestämmer ändamål och medel, vem som eventuellt agerar biträde och vilket stöd som finns för delning/flytt. Gemensamt system och superadminroll avgör inte den juridiska ansvarsfördelningen. Begränsa åtkomst till faktiska arbetsbehov och dokumentera vilka personer som får central åtkomst. [IMY om ansvar och biträdesrelationer](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/personuppgiftsansvariga-och-personuppgiftsbitraden/personuppgiftsbitradesavtal/).

### 5. Uppgiftsminimering och fritext — prioritet före utökad användning

Fullständigt födelsedatum lagras trots att den beskrivna födelsedagsfunktionen främst behöver dag och månad. Hemadress och fri anteckningstext finns utan inbyggda ändamålsbegränsningar. Administratörer får hela profillistan för sitt hem i API-svaret.

Åtgärd: motivera varje fält. Använd dag/månad om inget dokumenterat behov finns av födelseår. Begränsa vilka administratörer som behöver medlems- och privatprofiluppgifter. Ge tydliga instruktioner för anteckningar; undvik exempelvis uppgifter om volontärers hälsa eller andra känsliga förhållanden när inget särskilt lagligt stöd och behov finns. Bokningar och grönmarkering är personuppgiftsbehandling även om de inte är särskilda kategorier av personuppgifter. Jag har inte funnit att grönmarkeringen ensam fattar ett sådant ingripande beslut som avses i GDPR:s särskilda regler om automatiserat beslutsfattande.

[IMY om inbyggt dataskydd och uppgiftsminimering](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/inbyggt-dataskydd-och-dataskydd-som-standard/).

### 6. Rutiner för registerutdrag och andra rättigheter — måste verifieras

Schemarapporten och den breda CSV-backupen är inte ett färdigt, avgränsat registerutdrag för en person. Självservice för fullständig profil och radering saknas. Rättelse kan göras av admin. Rättigheter kan hanteras manuellt, men kontaktväg, identitetskontroll, ansvarig handläggare och rutin för att samla uppgifter från flera hem, loggar och exporter behöver finnas.

Åtgärd: skapa en dokumenterad rutin för tillgång, rättelse, radering, invändning och eventuella andra tillämpliga rättigheter. Lämna inte ut andra volontärers uppgifter när en person begär ett utdrag. Normalt ska en begäran hanteras inom en månad; lagens villkor styr eventuella förlängningar. [IMY om tidsfrister](https://www.imy.se/privatperson/dataskydd/dina-rattigheter/galler-for-alla-rattigheterna/tidsfrister/).

### 7. Säkerhetsåtgärder och incidenthantering — hög prioritet för administration

Positivt i koden: lösenordshashning med scrypt och salt, begränsade inloggningsförsök, säkra kakinställningar, HTTPS-krav i produktionskonfigurationen, återkallbara kalenderlänkar, behörighetskontroll på servern och separation mellan hemmen. Databaser och hemligheter undantas från Git.

Luckor: appen saknar tvåstegsverifiering, scrypt använder standardparametrar som bör förstärkas, temporära lösenord kräver inget tvingat byte och start-/CSV-filer kan innehålla lösenord i klartext. Ingen heltäckande administrationslogg med vem som exporterade, ändrade åtkomst eller hanterade registerutdrag har identifierats. Appen krypterar inte SQLite-filerna; eventuell disk-, volym- och backupkryptering är inte kontrollerad. Gmail-nyckeln krypteras separat men nyckelfilen ligger också på servern.

Åtgärd: riskbedöm och prioritera starkare autentisering för privilegierade konton, bättre lösenordshashinställningar, säker nyckel-/backuphantering och begränsad spårbarhet för viktiga adminåtgärder. Logga inte lösenord, återställningslänkar eller fulla personprofiler. Tvåstegsverifiering är inte ett generellt ovillkorligt GDPR-krav för varje webbplats; skyddsnivån ska motsvara riskerna. Hashinställningar: [Node](https://nodejs.org/api/crypto.html#cryptoscryptsyncpassword-salt-keylen-options), [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).

Incidentrutin måste ange ansvar, kontaktvägar, åtgärder och dokumentation. Incidenter som är anmälningspliktiga ska normalt anmälas inom 72 timmar från vetskap; bedöm också om berörda måste informeras. [IMY om incidenthantering](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/personuppgiftsincidenter/hantering-av-personuppgiftsincidenter/).

## Kalender, kontaktlistor och kakor

Kalenderlänkar är privata åtkomstnycklar, inte vanliga offentliga länkar. Den som har länken kan läsa bokningarna. Informera om kalenderleverantörens behandling, lägg inga privata personanteckningar i passens fritext och granska webbserverns loggning av URL:er. Återkallande hindrar nya hämtningar men raderar inte importerade eller cachade kalenderkopior.

Styrelsens och djurvårdsutbildades kontaktuppgifter visas för andra inloggade volontärer. Det är fortfarande ett utlämnande som behöver ett definierat ändamål och stöd, även om katalogen inte är publik utan inloggning. Ange vilka uppgifter som visas och använd lämpliga kontaktvägar.

I granskad klientkod hittades inga analys- eller marknadsföringsverktyg; inloggningskakor används. Strikt nödvändiga kakor kräver normalt inte samtycke. En samtyckesbanner ska inte läggas till enbart för syns skull. Kontrollera även faktisk produktionsproxy och eventuella externa tillägg. [PTS om nödvändiga kakor](https://www.pts.se/internet-och-telefoni/kakor-cookies/).

## Föreslagen ordning

1. Föreningen fastställer ansvarig organisation, kontaktperson, ändamål och rättsliga grunder. Bekräfta serverland, leverantörer, avtalsform och om CSV-utskick är aktiva.
2. Ta fram integritetsinformation, gallringsbeslut, register över behandlingar och rutiner för rättigheter/incidenter. Kontrollera berörda leverantörsavtal.
3. Bygg samlat personutdrag och kontrollerad radering/anonymisering över samtliga berörda register. Besluta lagringstider innan automatisk gallring aktiveras.
4. Minimera födelsedatum/adress/fritext och CSV-innehåll efter dokumenterade behov; välj säker backup och styr åtkomst till mottagarkonton.
5. Förstärk administratörsinloggningen och verifiera återställning av backup, åtkomsttester och gallring i drift.

Inga funktioner, e-postutskick, gallringsjobb eller publicerade integritetstexter har aktiverats som del av denna granskning. Inga lagringstider eller rättsliga grunder har valts åt föreningen.


## Åtgärdsstatus – förberedd ändring 0.6.006

Efter granskningen har systemägaren beslutat att medlemsmarkering, medlemsnummer, medlemsdatum och hemadress ska tas bort även ur befintliga aktiva databaser. Kod och migrering är förberedda för detta. Volontärformulär, API-svar, framtida CSV-export och flytt använder inte dessa fält. Ett separat medlemsregister är bara en framtida möjlig modul, inte en aktiverad funktion eller ett arkiv. Äldre exporter och säkerhetskopior omfattas inte av denna migrering.

Detta åtgärdar delar av uppgiftsminimeringen men inte övriga fynd. Bland annat finns frivilligt fullständigt födelsedatum och volontäranteckningar kvar för befintliga volontärfunktioner. Juridiska grunder, integritetsinformation och generella gallrings- och rättighetsrutiner behöver fortfarande hanteras. Den publicerade miljön får förändringen först efter driftsättning.

## Åtgärdsstatus – lokalt förberedd ändring 0.6.007

Systemägaren har beställt modellen från den separata diskussionen: paus, inaktivitet, explicit avslut och tre kalendermånaders gallringsfrist, med varning efter två månader och två veckor. Frånvaro efter 60 dagar ger enbart uppföljning. Befintliga aktiva profiler får ingen retroaktiv gallringsfrist. Supabase avvaktas.

Implementationen separerar engagemang per katthem från gemensamma inloggningsuppgifter. Uppgifter i det avslutade hemmet gallras när fristen löper ut; kvarvarande legitimt engagemang i annat hem behåller nödvändig inloggning. Dokumenterade undantag har prövningsdatum, och administrativa uppdrag spärrar gallring tills de hanterats. Självservice för egna grunduppgifter har serverkontrollerad fälttillåtelse och revisionskontroll. Introduktion, versionsbekräftade rutiner och självständig bokning är separata från grönmarkering.

Detta ersätter inte fastställd integritetsinformation, rättsliga grunder, leverantörsavtal, incidentrutiner, personutdrag eller radering på begäran. Fullständigt födelsedatum är fortsatt frivilligt. Äldre säkerhetskopior, exporter och redan skickad e-post omfattas inte av gallringsjobbet. Den publicerade miljön ändras först vid separat driftsättning.
