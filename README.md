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
- Veckoschema med automatisk påfyllning av pass kl. 08–12, 16–18 och 18–20 för 42 dagar från dagens datum.
- Bokning med rekommenderat tak på sju deltagare (fler kan boka efter bekräftelse), minst två volontärer per pass och skydd mot dubbla bokningar av samma pass och en bekräftelsefråga vid överlappande pass.
- Mina bokningar och avbokning fram till 24 timmar innan passet.
- Administratören kan lägga till och inaktivera volontärer, skapa och ställa in pass samt boka och avboka åt andra.
- Administratörens volontärlista visar genomförda pass. Bokningar på avslutade, ej inställda pass räknas; volontärer med fler än 15 pass markeras grönt. Detta är en beräkning utifrån bokningar, inte närvaroregistrering.
- CSV-export med semikolon som avgränsare. I Google Sheets: Arkiv → Importera → Ladda upp, välj filen och semikolon som avgränsare vid behov.

Söndagar 18–20 träffas socialiseringsgruppen för ordinarie uppgifter och socialiseringsträning med katterna. Volontärer anmäler sig via bokningen. Första söndagen varje månad är det öppet hus och passet 16–18 visas som inställt. Befintliga pass uppdateras automatiskt vid första starten med dessa regler. Bokningar behålls, även på inställda pass, så administratören kan kontakta berörda. En databaskopia sparas före uppdateringen som `data/schema-v1-backup.sqlite`.

## Data och säkerhetskopia

All data sparas lokalt i **data/katthem.sqlite**. Stoppa appen och kopiera data-mappen till en säker plats för en fullständig säkerhetskopia. CSV är en rapport och ersätter inte en databaskopia. Lägg inte databasen i en offentligt delad mapp.

I Coolify ligger samma filer i `/app/data` på den beständiga volymen. Volymen ersätter inte säkerhetskopior: stoppa applikationen före filkopiering, spara kopian utanför driftservern och prova återställning. Ta säkerhetskopia före uppdateringar. På en ny server återställs filerna till en volym med samma destination och skrivbehörighet före appstart.

Pass använder datorns lokala tid. Använd svensk tidszon på datorn. Inaktivering tar inte bort befintliga bokningar; administratören hanterar dessa i schemat. Inställning av ett pass bevarar passet och bokningarna i historiken men stoppar nya bokningar och påminnelser.

## Nästa version

Automatisk Google Sheets-synkning och återkommande personliga bokningar ingår inte ännu. Schemat fylls automatiskt på sex veckor framåt. Befintliga vanliga pass och extra händelser kan ändras, och lösenordsåterställning finns på inloggningssidan. För gemensam drift används Coolify-konfigurationen ovan med HTTPS och säkerhetskopiering.

## Verifiering

Kör `npm test` för integrationstester av autentisering, behörighet, bokning och datalagring. Testerna använder en separat tillfällig databas.

## Passantal, grönmarkering och volontärimport

Volontärer ser sitt eget antal genomförda pass under Mina bokningar och Mitt konto. Admin ser allas antal i Administration och kan grönmarkera volontärer manuellt. Fler än 15 genomförda pass ger också automatiskt grönmarkering. Att ta bort en manuell markering tar inte bort den automatiska.

Under Administration → Importera volontärer (CSV) kan admin förhandsgranska och importera upp till 500 nya volontärer. Använd UTF-8, komma eller semikolon och rubrikerna `namn;e-post;lösenord;grön`. Kolumnen `grön` är valfri och accepterar `ja` eller `nej`. Välj Grönmarkera alla i importen för att markera hela gruppen. Varje rad kräver ett lösenord på 10–200 tecken. Befintliga eller dubblerade e-postadresser stoppar hela importen. Inga e-postmeddelanden skickas; lämna kontouppgifterna personligen.

## Lokal drift från Windows-nätverksenhet

Om repot ligger på en nätverksenhet används %LOCALAPPDATA%\Katthem\data för SQLite och startkonton. Befintlig data måste kopieras dit medan appen är stoppad; originalet kan behållas som arkiv. Använd den lokala datamappen för säkerhetskopior och för aktuella startuppgifter i lokala-konton.txt. DATA_DIR kan anges uttryckligen för annan lagring. Docker använder fortfarande /app/data.

## Administratörer, öppet hus och påminnelser

Admin kan skapa konton med rollen Administratör eller Volontär under Lägg till konto. Befintliga konton kan byta roll med en bekräftelse; egen roll och egen aktivering kan inte ändras. CSV-import skapar fortsatt endast volontärer.

Öppet hus är ett eget bokningsbart pass 11–15 första söndagen varje månad i det befintliga sexveckorsschemat. Volontärer bokar sig själva och admin kan boka åt andra. Ordinarie pass 16–18 är fortsatt inställt den dagen. Öppet hus fylls automatiskt på tolv månader framåt och kan inte skapas, flyttas eller tas bort manuellt. Överlappande personliga bokningar kräver en extra bekräftelse.

Alla pass har ett rekommenderat tak på sju personer. Den åttonde och senare bokningen kräver en uttrycklig extra bekräftelse, även via API och när admin bokar åt någon annan.

Admin ser aktiva volontärer som inte har ett genomfört pass under senaste kalendermånaden. Nya konton utan historik varnas först en månad efter registrering. För befintliga konton utan historik börjar denna period vid uppgraderingen. Beräkningen använder avslutade bokningar, inte faktisk närvaroregistrering.

På sidan visas egna bokade pass inom nästa dygn som påminnelser. E-postpåminnelser skickas via Resend när RESEND_API_KEY, EMAIL_FROM (verifierad avsändare) och APP_URL är konfigurerade. Compose vidarebefordrar dessa variabler; vid lokal start anges de i processens miljö. Avsändaradressen och API-nyckeln ska inte checkas in. Inställningar och eventuella sändningsfel visas under Administration → Påminnelser.

Appen kontrollerar varje minut och vid start efter bokningar inom 24 timmar. En påminnelse skickas per bokning; sena bokningar påminns vid nästa kontroll. Avbokade, inställda och redan påbörjade pass samt inaktiva konton undantas. Leveranshistorik sparas i SQLite och en idempotensnyckel skyddar återförsök. Appen måste vara igång för att skicka. Admin kan även köra kontrollen direkt med Skicka påminnelser för nästa dygn. Inga riktiga e-postutskick gjordes under testerna.

Tekniska referenser: [Resend Send Email](https://resend.com/docs/api-reference/emails/send-email) och [idempotensnycklar](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Extra händelser, till exempel veterinärbesök

Admin skapar en händelse under Administration → Skapa händelse med namn, datum, start, slut och information. Händelsen visas i veckoschemat och i listan Händelser under Administration. Volontärer kan boka sig och admin kan boka åt andra. Skapa admin och Gör till admin finns kvar.

Ändra / boka om bevarar deltagarnas bokningar. En flytt kräver extra bekräftelse om någon deltagare har en överlappande bokning. Vid tidsändring nollställs tidigare e-postpåminnelser för deltagarna, så nästa kontroll kan påminna om den nya tiden. Bokade deltagare får ändringsmejl via den aktiverade e-postkopplingen.

Ställ in händelse spärrar nya bokningar och påminnelser men behåller bokningshistoriken; den räknas inte som genomförd. En inställd händelse kan aktiveras igen med Boka om. Avslutade händelser kan inte ändras. Öppet hus ligger fast första söndagen i månaden kl. 11–15.

## Gmail på sidan

Under Administration → Påminnelser → E-postinställningar kan admin spara Gmail-adress, ett Google-applösenord och sidans publika webbadress. Aktivera tvåstegsverifiering och skapa ett applösenord enligt [Googles instruktioner](https://support.google.com/mail/answer/185833?hl=sv). Spara, skicka ett testmejl och aktivera automatiska Gmail-påminnelser. Inställningarna börjar gälla utan omstart. Testmejl skickas bara efter att admin klickar Skicka testmejl.

Gmail använder TLS till smtp.gmail.com på port 465. Applösenordet krypteras med AES-256-GCM i data/email-settings.json; nyckeln ligger i data/email-secret.key. Båda filerna måste ingå i en skyddad säkerhetskopia av datamappen. Krypteringen skyddar inte mot någon som har tillgång till både nyckel och inställningsfil. Inget applösenord skickas tillbaka till webbläsaren. Tomt lösenordsfält behåller sparat lösenord; byte av Gmail-adress kräver ett nytt.

Sparade Gmail-inställningar ersätter Resend-konfigurationen. Avmarkera aktivering och spara för att pausa e-postutskicken. Databasens leveranshistorik förhindrar normala dubbletter; Gmail saknar Resends idempotensgaranti, så en oklar nätverkskvittens kan leda till en dubblett vid återförsök.

## Version 0.2.001

Versionsnumret visas längst ner på sidan. Paketversionen använder standardformatet 0.2.1, som visas som 0.2.001.

Admin kan sätta ett nytt lösenord för ett annat konto via Medlemmar → Volontärer & styrelse → Byt lösenord. Lösenordet kräver 10–200 tecken och bekräftelse i formuläret. Kontots samtliga sessioner avslutas när det sparas. Ingen e-post skickas; lämna det nya lösenordet direkt till personen. Eget lösenord ändras under Mitt konto.

## Version 0.2.002 – uppgradering av befintligt schema

De ursprungliga automatiska passen 08–10 och 17–19 uppdateras en gång vid start till 08–12 och 18–20. Eftermiddagspass 16–18 läggs till på dessa datum om de saknas. Söndagsreglerna tillämpas och boknings-ID samt konton bevaras. Endast pass med de ursprungliga namnen, tiderna och standardtexterna matchas; anpassade pass och händelser lämnas kvar. En databaskopia före tiduppgraderingen sparas i datamappen. Lokala och publicerade databaser är separata och synkas inte via GitHub. Driftsätt den nya koden för att uppgradera serverns befintliga schema. Hänvisningar till lokala startkonton och märkningen Lokal version visas inte längre i gränssnittet.

## Superadmin och admin (version 0.2.003)

Båda rollerna får hantera schema, bokningar, händelser, volontärer och lokala prototyper för kattinfo och medlemmar. Endast superadmin får skapa administratörer eller superadministratörer, ändra behörigheter, hantera administratörskonton och deras lösenord samt läsa eller ändra e-postinställningar. Admin kan skapa och hantera volontärkonton och byta volontärers lösenord. Båda kan starta en påminnelsekontroll utan att ändra e-postinställningar. Eget lösenord byts under Mitt konto; egen roll eller aktivering kan inte ändras i kontolistan.

En ny databas får ett lokalt startkonto med rollen superadmin. För en befintlig installation utan aktiv superadmin kan BOOTSTRAP_SUPERADMIN_EMAIL sättas till ett befintligt aktivt kontos e-postadress vid start; kontot befordras och gamla sessioner avslutas. Adressen väljs aldrig automatiskt. Ta därefter bort miljövariabeln. Den publicerade installationen ändras inte av lokala rolländringar.

Version 0.2.003 innehåller en engångsuppgradering av det befintliga aktiva kontot daniel@staahlis.se till superadmin. Kontots lösenord ändras inte; tidigare sessioner avslutas. Uppgraderingen skapar inget konto om adressen saknas. Alla admins och superadmins grönmarkeras automatiskt.


## Version 0.2.004 – löpande schema och volontärstöd

### Automatisk påfyllning

Vid start, vid hämtning av schemat och varje minut kontrollerar appen att ordinarie pass finns för 42 dagar från dagens datum. Söndagsreglerna gäller även nya pass. Befintliga pass och bokningar bevaras. Ett flyttat eller inställt pass återskapas inte på sin ursprungliga plats. Påfyllningen sparar därför passens ursprung i databasen. Öppet hus fortsätter fyllas på tolv månader framåt.

### Redigera och ställa in

Admin och superadmin kan öppna ett vanligt pass eller en extra händelse och välja **Ändra / boka om**. Namn, datum, tider och information kan ändras. Deltagarnas boknings-ID behålls, och en tidsändring kräver extra bekräftelse om den krockar med en deltagares andra aktiva bokning. Avslutade pass och automatiskt öppet hus kan inte ändras. Ett inställt pass kan bokas om och återaktiveras efter samma kontroller.

**Ställ in** behåller pass och deltagare i historiken, spärrar nya bokningar och påminnelser och undantar passet från genomförda pass. Samma beteende gäller vanliga pass och händelser. Volontären ser kommande inställda egna pass under Mina bokningar. CSV-exporten har en statuskolumn för att skilja inställda och aktiva pass.

### Ändringsmejl

Ändrat namn, datum, tid eller information samt inställning och återaktivering köar ett mejl till varje aktiv bokad deltagare. Kön sparas i SQLite i samma transaktion som ändringen. Utskick försöks direkt och därefter varje minut. Misslyckade utskick och utskick som väntar på aktiverad e-post finns kvar efter omstart. Administration visar antalet väntande och misslyckade ändringsmejl. Utskick använder samma Gmail- eller Resend-koppling som påminnelserna. Inga mejl skickas när kopplingen är avstängd. Gmail kan vid oklar nätverkskvittens skicka en dubblett, precis som för påminnelserna.

### Glömt lösenord

På inloggningssidan finns **Glömt lösenord?**. Ett aktivt konto kan få en återställningslänk via den aktiverade e-postkopplingen. Länken gäller i 30 minuter och kan användas en gång. Endast en hash av länktoken sparas i databasen. Ett lyckat lösenordsbyte avslutar kontots alla sessioner och ogiltigförklarar övriga återställningslänkar. Även lösenordsbyte under Mitt konto eller genom admin ogiltigförklarar gamla länkar.

Svaret avslöjar inte om adressen finns. Begäran och bekräftelse begränsas till sammanlagt tio anrop per minut per anslutande IP-adress, och högst tre länkar per konto under 30 minuter. Bakom en proxy kan IP-gränsen delas av flera personer. Om e-post är avstängd eller inte fungerar behöver administratören hjälpa personen via det befintliga lösenordsbytet.

### Information, uppdatering och kalender

**Praktisk information** är en ny sida för inloggade användare med fält för adress och introduktion. Tillträde och nycklar ingår inte här; dörrkoden hanteras på bokningssidan i den andra upplagan. Rutiner och viktiga instruktioner finns analogt på katthemmet. Admin och superadmin kan fylla i och spara texten. Tomma fält visar att information kommer; inga riktiga uppgifter eller instruktioner har hittats på.

Schemat och Mina bokningar uppdateras var 30:e sekund när fliken är synlig, och när användaren återvänder till fliken. En öppen dialog skyddas från uppdateringen så att formulär inte skrivs över. Schemat har även **Uppdatera nu**.

**Lägg till i kalender** hämtar en ICS-fil för en egen aktiv bokning, med svensk tidszon och regler för sommar- och vintertid. Nedladdningen kräver inloggning och rätt till bokningen. Kalenderfilen är en kopia vid nedladdningstillfället, inte en prenumeration; ändringar i portalen uppdaterar inte automatiskt en redan importerad kalenderpost.

Kontaktvägen vid sena förhinder hanteras i den separata kommande uppdateringen. Ingen närvaroregistrering eller instämpling har lagts till.

### Verifiering

`npm test` kör befintliga integrationstester och nya tester för påfyllning, bevarade ändringar, mejlkö med återförsök, lösenordsåterställning och kalenderformat. Tester använder tillfälliga databaser och simulerad e-post; inga riktiga mejl skickas.

Rollen `admin` visas som **Styrelse** i gränssnittet. Behörigheterna är oförändrade; superadmin är fortsatt en separat roll.

Under introduktionen i Praktisk information finns en utfällbar manual anpassad efter inloggad roll. Volontärer får boknings- och kontohjälp, styrelsen även stöd för schema och volontärkonton, och superadmin dessutom hjälp med roller och e-postinställningar.

Styrelse/admin och superadmin kan lägga till **Extra information** på vanliga pass, händelser och öppet hus. Fältet är separat från den vanliga passbeskrivningen och syns i schemakortet och passdialogen. Det följer med i nya kalenderfiler och ändringsmejl. Öppna passet och välj Extra information; tom text tar bort tillägget. Öppet hus behåller sina fasta tider.

Överlappande bokningar tillåts efter uttrycklig bekräftelse, exempelvis morgonpass 08–12 och öppet hus 11–15. Detta gäller både egen bokning, bokning åt någon annan och flytt av ett bokat pass. API kräver `confirmOverlap: true` efter varningen. Bekräftelsen för minst sju deltagare är separat och båda kan behövas. Samma person kan fortfarande bara boka samma pass en gång.

Framtida pass inom de närmaste sju dagarna markeras röda i schemat om färre än två är anmälda. Inställda och redan påbörjade pass undantas. Röd markering har företräde framför tidsfärgen och bokningsbakgrunden; texten Du är bokad visar fortfarande egen bokning.

Introduktionsavsnittet har tagits bort från Praktisk information och redigeringsformuläret i väntan på eventuell checklista för nya volontärer. Adress och rollanpassad portalmanual finns kvar. Ingen checklista är införd.

Under Praktisk information finns Min första tid på katthemmet: en personlig introduktionschecklista med kryss som sparas automatiskt per inloggat konto i SQLite. Den omfattar trygghet, arbetet inklusive genomgång av sanering, katternas bemötande, portalen och avstämning. Kryss kan tas bort och finns kvar efter utloggning och omstart. Ingen närvaro eller instämpling registreras. Endast användarens egna kryss hämtas och ändras av API.

Introduktionschecklistan döljs i Praktisk information för grönmarkerade användare, inklusive styrelse och superadmin som alltid är gröna. Detta gäller både manuell och automatisk grönmarkering. Sparade kryss bevaras och visas igen om användaren inte längre är grön. Adress och portalmanual visas fortfarande.

## Version 0.3.001

Medlemsregistret är tillgängligt för styrelse/admin och superadmin med kontaktuppgifter, medlemsstatus, styrelseroll och övriga ansvarsområden. Medlemsprofiler kopplas till inloggningskonton via användar-id. Medlemmar kan även finnas utan konto. Endast dessa roller får läsa och ändra profilerna.

Dörrkod visas vid schemat för inloggade användare; styrelse/admin och superadmin får ändra den. Dagens städning visas i passdialogen, inte på kalenderkortet. Sena avbokningar hänvisas till katthemmets bemanningsgrupp i Messenger, även i påminnelser.

Kattinfo ingår inte i denna version och har sparats separat som lokalt arkiv. Funktioner från 0.2.004–0.2.005, bland annat rullande schema, checklistan, kalenderfiler och ändringsmejl, behålls.

### Personlig kalenderprenumeration
Under Veckoschema och Mina bokningar finns Prenumerera på mina pass. Länken läggs till som en kalenderprenumeration (inte filimport). Varje aktivt konto har en egen slumpmässig, privat länk som visar dess aktuella bokningar med adress och arbetsuppgifter. Länken kan återkallas i samma dialog; en ny länk skapas nästa gång. Kalenderappen bestämmer hur ofta uppdateringar hämtas. Inaktiverade kontons länkar fungerar inte. Länkar är känsliga och ska inte delas. Lokala länkar fungerar endast på den lokala datorn; externa kalenderappar behöver en publicerad HTTPS-adress via APP_URL.

Kalenderexporter och prenumerationer innehåller en DISPLAY-påminnelse 12 timmar före varje pass (VALARM). Kalenderappen avgör hur importerade påminnelser hanteras. Restid och avresepåminnelser ställs in i kalenderappen; portalen beräknar inte restid. Informationssidan heter Praktisk information.

### Återkommande bokningar och bemanning (0.4.001)
Öppna ett framtida ordinarie pass och välj Boka återkommande. Välj varje, varannan eller var fjärde vecka och ett slutdatum inom det öppna schemat (högst sex veckor). Förhandsgranska innan bokning. Inställda eller saknade pass hoppas över och redan bokade pass behålls. Överlappningar och minst sju anmälda kräver separat bekräftelse. Hela bokningen sker i en transaktion och kräver ny förhandsgranskning om planen ändrats. Varje pass avbokas separat enligt vanliga regler; serien förlängs inte automatiskt. Styrelsen kan boka åt vald volontär.
Bemanning visas för admin och superadmin med en lista för kommande 42 dagar: färre än två bokade eller ingen grönmarkerad person. Även veckoschemat visar om en grönmarkerad person är bokad. Detta är planeringsstöd utan bokningsspärr. Rutinerade, manuellt gröna och administratörer räknas. Överlämning sker på whiteboardtavlan på plats, vilket också förklaras i Praktisk information och introduktionschecklistan. Ersättare hanteras i Messenger.

Efter varje automatiskt öppet hus skapas en separat bokningsbar Volontärsträff kl. 15–16. Admin och superadmin kan ändra Information om träffen samt flytta eller ställa in händelsen. Ursprungstillfället sparas så att en flyttad eller inställd träff inte återskapas vid omstart.

Admin och superadmin kan välja Administration → Skapa extra pass. En gång skapar ett enskilt pass. Varje/varannan/var fjärde vecka tillsammans med slutdatum förhandsgranskar en serie (högst ett år). Befintliga pass med samma tid och inställda söndagspass hoppas över. Serien sparas atomärt och varje tillfälle kan sedan hanteras separat. Pass skapas utan att boka volontärer. Befintlig funktion för Extra information används.

Bemanning visar närmaste sju kalenderdagarna (idag och sex dagar framåt), med passerade pass bortfiltrerade och avdelare med veckonummer vid ny vecka. Administration har fällbara sektioner för skapande, CSV, uppföljning, e-post, händelser, konton och exporthjälp. Öppna sektioner bevaras vid automatisk uppdatering under samma sidbesök.

### Samlat medlemsregister och volontärkonton (0.5.001)
Medlemmar samlar nu både profiler och kontohantering. Varje konto får en profil, eller kopplas till en befintlig profil med samma unika e-post. Kopplingen lagras med användar-id och behålls vid ändrad e-post. Medlemsuppgifter såsom telefon, medlemsnummer, styrelseroll och ansvar bevaras. Om flera profiler har samma e-post krävs manuellt val i medlemsformuläret. En medlem kan finnas utan konto; Skapa volontärkonto på profilen kopplar ett nytt konto direkt till just den profilen även om den tidigare saknat e-post. Namn och e-post synkas, medan bokningar och behörigheter behålls på kontot. Admin får inte ändra administratörers kontouppgifter via medlemsformuläret.
Födelsedatum är frivilligt och bara synligt för admin/superadmin tillsammans med övriga medlemsuppgifter. Administration visar födelsedagar idag och innevarande vecka (måndag–söndag), även över årsskifte; avslutade medlemskap utesluts. 29 februari visas den 29 februari under skottår. Kontoåtgärder har flyttats från Administration till Medlemmar; uppföljning av frånvaro ligger kvar. Samla in uppgifter ligger efter manualen i Praktisk information.

### Volontärer och medlemsmarkering (0.5.002)
Sidan heter Volontärer. Alla profiler är volontärprofiler; medlemskap i föreningen anges separat med Är medlem i föreningen. Befintliga profiler med medlemsnummer, medlemsdatum, stödmedlemsstatus eller styrelseroll behåller medlemsmarkering vid uppgraderingen. Kontorollen Admin är skild från styrelserollen i profilen. Överst finns en gemensam fällbar lista för Styrelse och administratörer, med styrelsen först och övriga admins därefter. Alla inloggade volontärer ser namn och roll, men inga kontaktuppgifter, födelsedatum, medlemsmarkeringar eller privata anteckningar. Endast admin och superadmin får den separata volontärslistan med sökning och filter för medlemskap, grönmarkering och kontostatus. Kontoåtgärder ligger på respektive volontärkort.

Admin och superadmin använder samma Bekräfta bokning och Avboka pass som volontärer, i knappraden längst ned i passdialogen. Självbokning använder alltid det inloggade kontot, oavsett vilken annan volontär som valts. Administrativa bokningar åt andra ligger separat. Alla ordinarie bokningsvarningar gäller.

På kalenderkortet kan admin och superadmin också bekräfta egen bokning direkt under Hantera pass. Knappen visas bara på framtida, ej inställda pass där personen inte redan är bokad. Samma kontroller för bemanning och överlappning används.

### Nyheter ovanför kalendern
Admin och superadmin publicerar via Administration → Nyheter ovanför kalendern. Välj 1, 3 eller 7 dagar, ett eget slutdatum eller ingen tidsgräns. Läsaren kan dölja varje nyhet, vilket sparas per konto i databasen och gäller på alla enheter. Sluttiden gäller oavsett om nyheten lästs. Redigering ger en ny version som visas igen. Nyheter kan avpubliceras; gamla versioner kan inte skriva över nyare ändringar. Endast publicerade, ej utgångna nyheter som inte dolts hämtas för volontären.

Manualen i Praktisk information är samlad och uppdaterad i 0.5.007, med rollanpassade avsnitt för samtliga boknings-, kalender-, nyhets-, profil-, bemannings- och administrationsfunktioner. Samla in uppgifter ingår som ett fällbart avsnitt sist i manualen för admin och superadmin. Volontärer får enbart användarhjälpen.

Volontärprofiler har Katthem (namn/ort, frivillig text) och markeringen Har gått djurvårdsutbildningen. Utbildning visas på kort och profil samt som filter. Praktisk information visar en kontaktlista för inloggade med styrelsen och utbildade: namn, styrelseroll/uppdrag, utbildningsmarkering, katthem och telefon. Saknas telefon visas Kontakta via Messenger. Vilande/avslutade profiler och inaktiva konton utesluts. Andra privata fält som födelsedatum, adress och anteckningar delas inte i kontaktlistan.

Djurvårdsutbildade syns även i den gemensamma fällbara listan på Volontärer. Styrelsen visas först, därefter övriga administratörer och sedan utbildade volontärer utan dessa roller. Personer visas bara en gång; utbildningsmarkeringen visas även på utbildade styrelsemedlemmar och administratörer. För alla inloggade delas namn, roll och utbildningsmarkering i denna lista, utan att privata profiler eller kontaktfält läggs till där.
