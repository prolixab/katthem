# Katthemmet

Kräver Node.js 24 eller senare. Kör `npm ci` före första lokala starten för att installera det versionslåsta e-postbiblioteket. Docker installerar det vid bygget.

## Starta

Dubbelklicka på **Starta katthemmet.cmd**, eller kör `npm start` i denna mapp. Öppna http://127.0.0.1:3080. Stäng terminalen för att stoppa appen. Appen lyssnar bara på den här datorn.

Vid första starten skapas ett administratörskonto och ett volontärkonto med slumpade lösenord. Uppgifterna ligger i **data/lokala-konton.txt**. Byt lösenord under Mitt konto. Filen med startlösenorden uppdateras inte vid lösenordsbyte och kan därefter raderas.

## Driftsättning i Coolify

1. Skapa en applikation från detta Git-repository och välj **Docker Compose** som byggmetod. Använd rotmappen och `/docker-compose.yml` som Compose-fil. Compose bygger appens image med den befintliga Dockerfilen.
2. Koppla din HTTPS-domän till tjänsten **`katthem`**, internport **3080**, i Coolify. Låt Coolifys proxy hantera TLS och aktivera omdirigering till HTTPS. Compose exponerar endast internporten; ingen port publiceras direkt på servern.
3. Ange `APP_URL=https://din-domän.se` i Coolifys miljövariabler, med exakt den adress som användarna öppnar (utan sökväg). Variabeln är obligatorisk i Compose och produktionsstart kräver HTTPS. Övriga runtime-inställningar finns i Compose-filen. `.env.example` visar den enda variabel som behöver fyllas i. Vid fristående Docker Compose kan den kopieras till `.env`; lokal `npm start` läser inte `.env` automatiskt.
4. Compose skapar en **namngiven persistent volym** `katthem-data` med destination **`/app/data`**. Kontrollera den parsade lagringen i Coolify före första driftsättningen. Kör en instans på en server; använd inte flera repliker eller flera containrar samtidigt mot samma SQLite-fil. Vid manuella bind mounts måste katalogen vara skrivbar för containeranvändaren `node` (UID/GID 1000).
5. Driftsätt. Dockerfilens health check anropar `GET /healthz` på internporten och kontrollerar att databasen svarar. Endpointen kräver ingen inloggning.
6. Öppna Coolifys containerterminal och kör `cat /app/data/lokala-konton.txt` för att hämta de slumpade startlösenorden. Logga in som `admin@katthem.local`, byt lösenord och skapa riktiga volontärkonton. Inaktivera exempelfrivilligen `alex@katthem.local` och radera startlösenordsfilen när den inte behövs. Uppgifterna skrivs inte till applikationsloggen.

Sessionscookies får flaggan `Secure` i produktion. Skrivande API-anrop med en Origin-header måste matcha `APP_URL`; proxyheaders används inte för att avgöra tillåtet ursprung. Inloggningsbegränsningen gäller per direkt anslutande IP-adress, vilket bakom Coolifys proxy kan innebära en gemensam gräns på 15 försök per minut.

Verifiera efter driftsättning att inloggning, bokning och utloggning fungerar via HTTPS och att bokningarna finns kvar efter en omdriftsättning. För migrering av befintlig lokal data: stoppa båda instanserna, kopiera hela data-mappen till volymen, kontrollera ägarskap och starta sedan containern.

Compose hanterar volym, miljövariabler, omstartspolicy och avstängning; health check ärvs från Dockerfilen. Ta inte bort volymen vid omdriftsättning (`docker compose down -v` raderar data). Om appen redan körs som en Dockerfile-applikation måste befintlig data migreras till Compose-volymen före bytet, eftersom den får ett annat namn.

Konfigurationen följer Coolifys dokumentation för [Docker och Compose](https://coolify.io/docs/core/docker-and-containers), [applikationsinställningar](https://coolify.io/docs/applications/configuration/general) och [persistent lagring](https://coolify.io/docs/core/persistent-storage/storage-mounts/overview).

## Funktioner

- Inloggning med separata roller och lösenord lagrade med salt och scrypt.
- Veckoschema med sex veckors pass kl. 08–12, 16–18 och 18–20 från första starten.
- Bokning med rekommenderat tak på sju deltagare (fler kan boka efter bekräftelse), minst två volontärer per pass och skydd mot dubbelbokning och överlappande pass.
- Mina bokningar och avbokning fram till 24 timmar innan passet.
- Administratören kan lägga till och inaktivera volontärer, skapa och ställa in pass samt boka och avboka åt andra.
- Administratörens volontärlista visar genomförda pass. Bokningar på avslutade, ej inställda pass räknas; volontärer med fler än 15 pass markeras grönt. Detta är en beräkning utifrån bokningar, inte närvaroregistrering.
- CSV-export med semikolon som avgränsare. I Google Sheets: Arkiv → Importera → Ladda upp, välj filen och semikolon som avgränsare vid behov.

Söndagar 18–20 träffas socialiseringsgruppen för ordinarie uppgifter och socialiseringsträning med katterna. Volontärer anmäler sig via bokningen. Första söndagen varje månad är det öppet hus och passet 16–18 visas som inställt. Befintliga pass uppdateras automatiskt vid första starten med dessa regler. Bokningar behålls, även på inställda pass, så administratören kan kontakta berörda. En databaskopia sparas före uppdateringen som `data/schema-v1-backup.sqlite`.

## Data och säkerhetskopia

All data sparas lokalt i **data/katthem.sqlite**. Stoppa appen och kopiera data-mappen till en säker plats för en fullständig säkerhetskopia. CSV är en rapport och ersätter inte en databaskopia. Lägg inte databasen i en offentligt delad mapp.

I Coolify ligger samma filer i `/app/data` på den beständiga volymen. Volymen ersätter inte säkerhetskopior: stoppa applikationen före filkopiering, spara kopian utanför driftservern och prova återställning. Ta säkerhetskopia före uppdateringar. På en ny server återställs filerna till en volym med samma destination och skrivbehörighet före appstart.

Pass använder datorns lokala tid. Använd svensk tidszon på datorn. Inaktivering tar inte bort befintliga bokningar; administratören hanterar dessa i schemat. Inställning av ett pass tar bort dess bokningar efter bekräftelse.

## Nästa version

Automatisk Google Sheets-synkning, lösenordsåterställning, återkommande personliga bokningar och ändring av befintliga pass ingår inte ännu. Nya pass skapas var för sig; de första sex veckorna läggs in automatiskt. För gemensam drift används Coolify-konfigurationen ovan med HTTPS och säkerhetskopiering.

## Verifiering

Kör `npm test` för integrationstester av autentisering, behörighet, bokning och datalagring. Testerna använder en separat tillfällig databas.

## Passantal, grönmarkering och volontärimport

Volontärer ser sitt eget antal genomförda pass under Mina bokningar och Mitt konto. Admin ser allas antal i Administration och kan grönmarkera volontärer manuellt. Fler än 15 genomförda pass ger också automatiskt grönmarkering. Att ta bort en manuell markering tar inte bort den automatiska.

Under Administration → Importera volontärer (CSV) kan admin förhandsgranska och importera upp till 500 nya volontärer. Använd UTF-8, komma eller semikolon och rubrikerna `namn;e-post;lösenord;grön`. Kolumnen `grön` är valfri och accepterar `ja` eller `nej`. Välj Grönmarkera alla i importen för att markera hela gruppen. Varje rad kräver ett lösenord på 10–200 tecken. Befintliga eller dubblerade e-postadresser stoppar hela importen. Inga e-postmeddelanden skickas; lämna kontouppgifterna personligen.

## Lokal drift från Windows-nätverksenhet

Om repot ligger på en nätverksenhet används %LOCALAPPDATA%\Katthem\data för SQLite och startkonton. Befintlig data måste kopieras dit medan appen är stoppad; originalet kan behållas som arkiv. Använd den lokala datamappen för säkerhetskopior och för aktuella startuppgifter i lokala-konton.txt. DATA_DIR kan anges uttryckligen för annan lagring. Docker använder fortfarande /app/data.

## Administratörer, öppet hus och påminnelser

Admin kan skapa konton med rollen Administratör eller Volontär under Lägg till konto. Befintliga konton kan byta roll med en bekräftelse; egen roll och egen aktivering kan inte ändras. CSV-import skapar fortsatt endast volontärer.

Öppet hus är ett eget bokningsbart pass 11–15 första söndagen varje månad i det befintliga sexveckorsschemat. Volontärer bokar sig själva och admin kan boka åt andra. Ordinarie pass 16–18 är fortsatt inställt den dagen. Öppet hus fylls automatiskt på tolv månader framåt och kan inte skapas, flyttas eller tas bort manuellt. Överlappande personliga bokningar är fortsatt blockerade.

Alla pass har ett rekommenderat tak på sju personer. Den åttonde och senare bokningen kräver en uttrycklig extra bekräftelse, även via API och när admin bokar åt någon annan.

Admin ser aktiva volontärer som inte har ett genomfört pass under senaste kalendermånaden. Nya konton utan historik varnas först en månad efter registrering. För befintliga konton utan historik börjar denna period vid uppgraderingen. Beräkningen använder avslutade bokningar, inte faktisk närvaroregistrering.

På sidan visas egna bokade pass inom nästa dygn som påminnelser. E-postpåminnelser skickas via Resend när RESEND_API_KEY, EMAIL_FROM (verifierad avsändare) och APP_URL är konfigurerade. Compose vidarebefordrar dessa variabler; vid lokal start anges de i processens miljö. Avsändaradressen och API-nyckeln ska inte checkas in. Inställningar och eventuella sändningsfel visas under Administration → Påminnelser.

Appen kontrollerar varje minut och vid start efter bokningar inom 24 timmar. En påminnelse skickas per bokning; sena bokningar påminns vid nästa kontroll. Avbokade, inställda och redan påbörjade pass samt inaktiva konton undantas. Leveranshistorik sparas i SQLite och en idempotensnyckel skyddar återförsök. Appen måste vara igång för att skicka. Admin kan även köra kontrollen direkt med Skicka påminnelser för nästa dygn. Inga riktiga e-postutskick gjordes under testerna.

Tekniska referenser: [Resend Send Email](https://resend.com/docs/api-reference/emails/send-email) och [idempotensnycklar](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Extra händelser, till exempel veterinärbesök

Admin skapar en händelse under Administration → Skapa händelse med namn, datum, start, slut och information. Händelsen visas i veckoschemat och i listan Händelser under Administration. Volontärer kan boka sig och admin kan boka åt andra. Skapa admin och Gör till admin finns kvar.

Ändra / boka om bevarar deltagarnas bokningar. En flytt stoppas om någon deltagare har en överlappande bokning. Vid tidsändring nollställs tidigare e-postpåminnelser för deltagarna, så nästa kontroll kan påminna om den nya tiden. Informera deltagarna separat om ändringen.

Ställ in händelse spärrar nya bokningar och påminnelser men behåller bokningshistoriken; den räknas inte som genomförd. En inställd händelse kan aktiveras igen med Boka om. Avslutade händelser kan inte ändras. Öppet hus ligger fast första söndagen i månaden kl. 11–15.

## Gmail på sidan

Under Administration → Påminnelser → E-postinställningar kan admin spara Gmail-adress, ett Google-applösenord och sidans publika webbadress. Aktivera tvåstegsverifiering och skapa ett applösenord enligt [Googles instruktioner](https://support.google.com/mail/answer/185833?hl=sv). Spara, skicka ett testmejl och aktivera automatiska Gmail-påminnelser. Inställningarna börjar gälla utan omstart. Testmejl skickas bara efter att admin klickar Skicka testmejl.

Gmail använder TLS till smtp.gmail.com på port 465. Applösenordet krypteras med AES-256-GCM i data/email-settings.json; nyckeln ligger i data/email-secret.key. Båda filerna måste ingå i en skyddad säkerhetskopia av datamappen. Krypteringen skyddar inte mot någon som har tillgång till både nyckel och inställningsfil. Inget applösenord skickas tillbaka till webbläsaren. Tomt lösenordsfält behåller sparat lösenord; byte av Gmail-adress kräver ett nytt.

Sparade Gmail-inställningar ersätter Resend-konfigurationen. Avmarkera aktivering och spara för att pausa e-postutskicken. Databasens leveranshistorik förhindrar normala dubbletter; Gmail saknar Resends idempotensgaranti, så en oklar nätverkskvittens kan leda till en dubblett vid återförsök.

## Version 0.2.001

Versionsnumret visas längst ner på sidan. Paketversionen använder standardformatet 0.2.1, som visas som 0.2.001.

Admin kan sätta ett nytt lösenord för ett annat konto via Administration → Volontärer & administratörer → Byt lösenord. Lösenordet kräver 10–200 tecken och bekräftelse i formuläret. Kontots samtliga sessioner avslutas när det sparas. Ingen e-post skickas; lämna det nya lösenordet direkt till personen. Eget lösenord ändras under Mitt konto.

## Version 0.2.002 – uppgradering av befintligt schema

De ursprungliga automatiska passen 08–10 och 17–19 uppdateras en gång vid start till 08–12 och 18–20. Eftermiddagspass 16–18 läggs till på dessa datum om de saknas. Söndagsreglerna tillämpas och boknings-ID samt konton bevaras. Endast pass med de ursprungliga namnen, tiderna och standardtexterna matchas; anpassade pass och händelser lämnas kvar. En databaskopia före tiduppgraderingen sparas i datamappen. Lokala och publicerade databaser är separata och synkas inte via GitHub. Driftsätt den nya koden för att uppgradera serverns befintliga schema. Hänvisningar till lokala startkonton och märkningen Lokal version visas inte längre i gränssnittet.
