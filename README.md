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
- Administratörens volontärlista visar genomförda pass. Bokningar på avslutade, ej inställda pass räknas; volontärer med minst 10 pass och helt genomförd introduktionschecklista markeras grönt. Manuell/importerad markering kräver också klar checklista. Detta är en beräkning utifrån bokningar, inte närvaroregistrering.
- CSV-export med semikolon som avgränsare. I Google Sheets: Arkiv → Importera → Ladda upp, välj filen och semikolon som avgränsare vid behov.

Söndagar 18–20 träffas socialiseringsgruppen för ordinarie uppgifter och socialiseringsträning med katterna. Volontärer anmäler sig via bokningen. Första söndagen varje månad är det öppet hus och passet 16–18 visas som inställt. Befintliga pass uppdateras automatiskt vid första starten med dessa regler. Bokningar behålls, även på inställda pass, så administratören kan kontakta berörda. En databaskopia sparas före uppdateringen som `data/schema-v1-backup.sqlite`.

## Data och säkerhetskopia

Det ursprungliga katthemmets data sparas i **data/katthem.sqlite**, katthemsregister och åtkomst i **data/shelters.sqlite** och övriga katthem under **data/shelters/<id>/**. Stoppa appen och kopiera data-mappen till en säker plats för en fullständig säkerhetskopia. CSV är en rapport och ersätter inte en databaskopia. Lägg inte databasen i en offentligt delad mapp.

I Coolify ligger samma filer i `/app/data` på den beständiga volymen. Volymen ersätter inte säkerhetskopior: stoppa applikationen före filkopiering, spara kopian utanför driftservern och prova återställning. Ta säkerhetskopia före uppdateringar. På en ny server återställs filerna till en volym med samma destination och skrivbehörighet före appstart.

Pass använder datorns lokala tid. Använd svensk tidszon på datorn. Inaktivering tar inte bort befintliga bokningar; administratören hanterar dessa i schemat. Inställning av ett pass bevarar passet och bokningarna i historiken men stoppar nya bokningar och påminnelser.

## Planerade funktioner – avvaktar

- **Tvåfaktorsverifiering med Microsoft Authenticator:** planerad förstärkning för admin och superadmin. Införande och aktivering avvaktas. Personliga tidsbaserade engångskoder har diskuterats som den enklare vägen. Pushgodkännande med nummermatchning är ett separat alternativ som behöver utredas tillsammans med Microsofts inloggningsplattform. Metod och införandedatum är inte beslutade. Återställning vid förlorad telefon och säker hantering av nycklar behöver ingå när funktionen utvecklas. Inget tvåfaktorskrav eller någon Microsoft-koppling är aktiverad genom denna planering.
- **Automatisk Google Sheets-synkning:** finns inte i den nuvarande basmodulen.

Återkommande personliga bokningar är redan införda. Schemat fylls automatiskt på sex veckor framåt. Befintliga vanliga pass och extra händelser kan ändras, och lösenordsåterställning finns på inloggningssidan.

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
Admin och superadmin publicerar via Administration → Nyheter och anslagstavla. Välj 1, 3, 7, 14 eller 30 dagar eller ett eget slutdatum och klockslag. Publicering kräver framtida sluttid. Läsaren kan dölja varje nyhet, vilket sparas per konto i databasen och gäller på alla enheter. Sluttiden gäller oavsett om nyheten lästs. Redigering ger en ny version som visas igen. Nyheter kan avpubliceras; gamla versioner kan inte skriva över nyare ändringar. Startsidan visar publicerade, ej utgångna nyheter som läsaren inte dolt. Anslagstavlan visar alla aktuella publicerade nyheter oberoende av personliga döljningar.

Manualen i Praktisk information är samlad och uppdaterad i 0.5.007, med rollanpassade avsnitt för samtliga boknings-, kalender-, nyhets-, profil-, bemannings- och administrationsfunktioner. Samla in uppgifter ingår som ett fällbart avsnitt sist i manualen för admin och superadmin. Volontärer får enbart användarhjälpen.

Volontärprofiler har Katthem (namn/ort, frivillig text) och markeringen Har gått djurvårdsutbildningen. Utbildning visas på kort och profil samt som filter. Praktisk information visar en kontaktlista för inloggade med styrelsen och utbildade: namn, styrelseroll/uppdrag, utbildningsmarkering, katthem och telefon. Saknas telefon visas Kontakta via Messenger. Vilande/avslutade profiler och inaktiva konton utesluts. Andra privata fält som födelsedatum, adress och anteckningar delas inte i kontaktlistan.

Djurvårdsutbildade syns även i den gemensamma fällbara listan på Volontärer. Styrelsen visas först, därefter övriga administratörer och sedan utbildade volontärer utan dessa roller. Personer visas bara en gång; utbildningsmarkeringen visas även på utbildade styrelsemedlemmar och administratörer. För alla inloggade delas namn, roll och utbildningsmarkering i denna lista, utan att privata profiler eller kontaktfält läggs till där.

Den gemensamma listan på Volontärer visar även kontakttelefon för styrelsen, administratörer och djurvårdsutbildade. Saknas nummer visas Kontakta via Messenger, som i Praktisk information. Listan är fortsatt endast tillgänglig efter inloggning och delar inte födelsedatum, adress eller privata anteckningar.

Frivillig personlig Messenger-länk anges i volontärprofilen. Kontaktlistorna på Volontärer och Praktisk information använder länken om den finns; annars visas Kontakta via Messenger som text. Finns både telefon och länk visas båda. Bara HTTPS till m.me, messenger.com eller Facebooks /messages/t/-länkar accepteras. Tomt fält tar bort länken. Gruppens Messenger-länk läggs till separat senare. Manualen beskriver hur personlig länk anges och visas.

### Förberett CSV-intervall i e-postinställningar
Superadmin kan spara dagligen, varje vecka eller varje månad tillsammans med Gmail-inställningarna. Ingen automatisk CSV-export eller mejlsändning är aktiverad. Föreslaget innehåll inför aktivering är tre filer: volontarer.csv (konto-id, namn, e-post, behörighet, aktivt), schema.csv (pass-id, datum, start, slut, passnamn, typ, inställt), bokningar.csv (boknings-id, konto-id, pass-id). Föreslagen mottagare är enbart samma Gmail-adress som avsändaren. Lösenord, dörrkod, privata kalenderlänkar, e-postnycklar, födelsedatum, hemadress, telefon och privata profilanteckningar ingår inte. Detta är ett kompletterande exportunderlag, inte en komplett återställningsbackup.

### Automatiska CSV-utskick (0.5.013)
Funktionen är nu implementerad efter användarens uttryckliga godkännande av utskick för att återskapa volontärsinfo och kalender. Superadmin aktiverar den i E-postinställningar och väljer dagligen (24 timmar), varje vecka (7 dagar) eller varje månad (kalendermånad, datumet begränsas till månadens sista dag vid behov). Första utskicket planeras ett intervall efter aktivering; intervallet räknas efter senaste lyckade utskick. Byte av intervall eller Gmail-adress startar om planen. Mottagaren är fast samma Gmail-adress som avsändaren. Aktivering är avstängd som standard och ingen konfiguration aktiveras av koduppdateringen.
Åtta UTF-8/semikolonfiler tas i samma SQLite-lästransaktion: volontarer.csv, konton.csv, schema.csv, bokningar.csv, praktisk-info.csv, schema-ursprung.csv, volontarstraff-ursprung.csv och introduktion.csv. Kolumnnamnen motsvarar databasfälten. Privata profiluppgifter ingår enligt godkännandet; lösenord, dörrkod, e-postnycklar, sessioner och privata kalenderlänkar gör det inte. Formelliknande CSV-celler får ett inledande apostroftecken för säkrare kalkylarksöppning; vid teknisk återställning behöver denna exportkodning hanteras. Automatisk återimport finns inte. Uppgifterna möjliggör manuell återuppbyggnad men ersätter inte en komplett databasbackup.
Nästa körtid, senaste lyckade utskick och generiskt fel sparas i SQLite och visas bara för superadmin. Misslyckanden försöks igen tidigast efter en timme. Lyckade försök upprepas inte vid omstart. Samtidiga körningar i samma serverprocess delar ett jobb. Samma Message-ID används vid återförsök; ett avbrott efter SMTP-leverans men före databasmarkering kan ändå orsaka dubblett. Bilagor över totalt 15 MiB avvisas. Exporten skickas via sparad Gmail och inte via alternativ Resend-konfiguration.

Volontärskorten och grupperna med styrelse/admins/djurvårdsutbildade använder två kolumner även i smalare datorfönster; endast skärmar på högst 600 px går över till en kolumn. Kortens mellanrum och knappar är kompaktare för mindre scrollande vid redigering. Manualen är uppdaterad.

Volontärprofilens visning och redigering använder två kolumner i en bredare dialog. Kontakt och katthem ligger i vänsterkolumnen och Medlemskap och uppdrag till höger. På mobil används en kolumn. Det frivilliga Messenger-fältet finns i kontaktkolumnen. Manualen är uppdaterad.

### Anslagstavla och obligatorisk visningstid (0.5.016)
Alla inloggade har Anslagstavla i sidmenyn. Samma publicerade nyheter som på startsidan visas där, oberoende av personliga döljningar. Anslagstavlan har ingen Dölj-knapp och visar nyheten fram till dess sluttid. Publicering kräver ett aktivt val av antal dagar (1, 3, 7, 14 eller 30) eller eget slutdatum och tid; servern avvisar publicering utan framtida sluttid. Avpublicering av admin fungerar fortsatt i Administration. Äldre publicerade nyheter utan sluttid sparas som utkast vid uppgradering, med oförändrad text, och måste få en sluttid innan de kan publiceras igen. Manualen är uppdaterad.

### Gemensam volontärhantering (0.6.001)
Lägg till volontär och Redigera volontärprofil hanterar nu både personuppgifter och inloggning. Separata skapandeknappar och väljare för kontokoppling har tagits bort. Ny volontär kräver e-post och tillfälligt lösenord, med behörighet som superadmin kan välja. Äldre poster utan inloggning kan kompletteras i samma formulär. Gemensamma /api/volunteers-anrop sparar person och inloggning atomärt; befintliga lösenord, id och bokningar behålls. Ett nytt lösenord eller ändrad behörighet/aktivering avslutar tidigare sessioner. Befintliga admin-/superadminskydd gäller och egen roll/aktivering kan inte ändras där. Äldre API-vägar finns kvar för kompatibilitet och CSV-import. Manualen är uppdaterad.

Version 0.6.002: Volontärer blir gröna vid minst tio genomförda bokningar och komplett introduktionschecklista. Manuell/importerad grönmarkering ersätter bara passkravet; admin och superadmin är fortsatt alltid gröna. Söndagar har ett gemensamt socialiseringspass 16–20 även vid öppet hus. Framtida oförändrade standardpass slås samman med bibehållna deltagare; historik och anpassade pass bevaras. Dörrkod och tre statistikfält visas i fyra lika stora rutor på stor skärm, med dörrkoden först.

Katthem kopplas via profilfältet Katthem: Huskvarna och Jönköping/Jonkoping avser samma adress och dörrkod. Äldre tomma profiler använder befintligt katthem; en okänd ort visar ingen adress eller kod. Samma adressval används i personens kalenderexport och prenumeration. Admin redigerar fortsatt Huskvarna-katthemmets gemensamma adress och kod.


## Flera katthem (0.6.003)

Starta med npm start (portal.mjs), även i produktion. Docker och Windows-startfilen använder portalen. server.mjs är en intern server per katthem och får inte användas som publik produktionsstart. Portalen binder den publika porten och startar en intern server på loopback per registrerat katthem, med en hemlig intern åtkomstnyckel. Alla API-anrop auktoriseras i portalen innan de skickas till valt hem. Det är separata SQLite-databaser, e-postinställningar, CSV-jobb, kalenderprenumerationer, schema, profiler och nyheter.

Befintlig data ligger kvar orörd i det ursprungliga hemmet Huskvarna / Jönköping. Katthemstillhörighet bestäms av kontots ordinarie hem och explicita tilldelningar, aldrig av fritext eller matchande e-post. Superadmin i det ursprungliga hemmet har tillgång till alla hem. Under Administration → Hantera katthem och åtkomst kan superadmin skapa hem och tilldela/återkalla extra åtkomst som admin eller volontär. Nya hem får inga exempelkonton, ingen förifylld kod och ingen kopia av Huskvarnas adress eller e-postinställningar. Välj det nya hemmet och fyll i uppgifterna där. Systemets superadmin skapas bara i det ursprungliga hemmet.

Inloggningen väljer det ordinarie hemmet. Tilldelad styrelse/admin använder sitt ordinarie lösenord och kan växla mellan tilldelade hem. För ett annat hem skapas en separat åtkomstidentitet med egen lokal profil och bokningshistorik. Den kan inte användas för separat inloggning; åtkomsten kontrolleras mot ursprungskontot och tilldelningarna vid varje anrop. Ändringar i en annan persons uppdrag i ett hem ger inte åtkomst till fler hem. Återkallad åtkomst spärrar även den tilldelade identitetens kalenderprenumeration, medan historik behålls. Avstängning av ursprungskontot stoppar åtkomst till alla dess hem.

Fullständig backup: stoppa portalen och kopiera hela DATA_DIR, inklusive shelters.sqlite, katthem.sqlite, shelters/ och varje hems e-postfiler/nycklar. En CSV-export gäller bara valt hem och innehåller inte central behörighetskonfiguration. Kör en portal per datamapp, inte flera repliker. Vid första uppgraderingen behöver tidigare inloggade logga in på nytt. Inga ytterligare katthem eller personliga tilldelningar skapas utan att superadmin gör det i gränssnittet.


## Flytta volontärer och gemensamma nyheter (0.6.004)

Superadmin: Administration → Hantera katthem och åtkomst → Flytta volontär. Välj ordinarie konto och nytt katthem och förhandsgranska. Alla kommande aktiva bokningar i det gamla hemmet och andra hem vars extra åtkomst avslutas måste avbokas av volontären först. Pågående pass blockerar också flytt. Flytten avbokar inga pass automatiskt och kopierar inga bokningar till det nya schemat.

Kontaktprofil och lösenord följer med. Antalet genomförda pass från tidigare hem sparas som carried_shifts i kontot; tidigare bokningsposter ligger kvar för historik. Central volunteer_lineage gör att samma pass inte räknas dubbelt vid återflytt. Checklistan nollställs i det nya hemmet och tidigare grönmarkering gäller först efter att den genomförts igen. Admin-, styrelseuppdrag och lokala ansvarsområden följer inte med automatiskt. Superadmin flyttas inte. Det gamla kontot avslutas och inloggningar, privata kalenderlänkar och extra tilldelningar återkallas. Personen väljer nytt katthem vid nästa inloggning och skapar kalenderprenumerationen där.

Flytten sker i en SQLite-transaktion över katthemsregistret och berörda databaser. Standardläget DELETE för journalerna krävs för atomisk återställning vid avbrott; byt inte dessa databaser till WAL. Identiteter/profiler återanvänds bara när en tidigare flytt eller uttrycklig åtkomstkoppling bevisar att det är samma person. Orelaterad e-postkonflikt blockerar flytten. Förhandsgranskning måste göras om när uppgifter ändras. Fullständig backup behöver hela DATA_DIR, inklusive centrala registertabellerna och alla katthemsdatabaser.

Gemensamma nyheter ligger i katthemsregistret. Superadmin väljer Alla katthem (även framtida) eller en lista över Valda katthem. Sluttid är obligatorisk vid publicering. Berörda hem visar nyheten både över kalendern och på anslagstavlan. En personlig döljning påverkar bara startsidan; anslagstavlan behåller nyheten till sluttiden. Bara superadmin kan redigera, avpublicera eller radera gemensamma nyheter. Lokala admins fortsätter hantera lokala nyheter. Den automatiska CSV-exporten gäller ett enskilt hem och ersätter inte backup av de centrala nyhets- och åtkomstregistren.

Admin kan även använda Administration → Flytta volontär. Både ursprungshem och målhem måste ha adminbehörighet vid såväl förhandsgranskning som bekräftelse. Åtkomst som volontär räcker inte. Listan omfattar bara ordinarie volontärkonton i dessa hem. Admin kan inte flytta administratörs- eller superadminkonton, ändra tilldelningar eller påverka kopplingar till andra hem utanför sitt administrativa område; då behövs superadmin. Bokningskontroll, historik och ny checklista fungerar som vid superadmins flytt.

Tilldelad åtkomst materialiserar personen och profilen direkt i målhemmet. Styrelseuppdrag och kontaktuppgifter fylls i från ordinarie profil, utan privata anteckningar, hemadress eller födelsedatum. Redan sparade tilldelningar kompletteras när målhemmet öppnas. Automatiskt kopierade fält följer ändringar i ursprungsprofilen medan lokala avvikelser bevaras. Konton med samma e-post slås fortfarande inte ihop automatiskt.


## Renodlad volontärmodul (0.6.006)

Volontärprofilen innehåller inte medlemsmarkering, medlemsnummer, medlemsdatum eller hemadress. Fälten tas bort från aktiva SQLite-databaser vid uppgradering, med bevarade profil-id, kontokopplingar och bokningshistorik. Migreringen använder secure_delete och VACUUM och är idempotent. Gamla klienters inmatning i dessa fält ignoreras; inget av dem sparas eller skickas med i API-svar, CSV-export eller flytt.

Volontärernas kontaktuppgifter, katthem, uppdrag, utbildning, status, arbetsrelaterade anteckningar, frivilligt födelsedatum för födelsedagshälsningar, introduktion och passantal behålls. Namnet member_profiles och äldre API-namn är interna kompatibilitetsnamn för volontärprofiler och innebär inte att ett medlemsregister är aktivt.

Medlemsregister är en möjlig framtida, separat och valbar modul med egna behörigheter, ändamål och gallringsregler; den ingår inte i denna version. Inget medlemsarkiv eller nya medlemskopior skapas i migreringen. Befintliga exporter, e-postbilagor och äldre säkerhetskopior utanför aktiva databaser raderas inte av appuppgraderingen och behöver hanteras enligt föreningens beslutade gallringsrutiner.

## Engagemang, introduktion och självservice (0.6.007)

Mitt konto innehåller Min profil med egna grunduppgifter (namn, inloggningsadress, telefon, Messenger och frivilligt födelsedatum). Vid tilldelad åtkomst ändras namn och inloggningsadress i ordinarie hem, övriga kontaktfält i valt hem. API:t använder en uttrycklig tillåtelselista och revisionskontroll. Utbildning, uppdrag, behörighet, åtkomst och grönmarkering förblir administrativa uppgifter med befintligt kontoskydd.

Engagemang är separat från inloggningsspärr. Aktiv, pausad, inaktiv och avslutad hanteras under Mitt konto respektive Administration → Engagemang, introduktion och gallring. Egen paus/avslut kan avse ett hem eller hela föreningen. Paus kräver framtida uppföljningsdatum; avslut kräver att aktiva framtida/pågående bokningar hanterats. Ändring över högst tio berörda hem sker i en gemensam SQLite-transaktion; större organisationer ändrar ett hem i taget. 60 dagars frånvaro är bara en kontaktindikator och ändrar ingen status.

Efter uttryckligt avslut planeras gallring tre kalendermånader senare (månadsslut klampas). Adminvarning visas efter två månader plus fjorton dagar. Ett dokumenterat annat ändamål med framtida prövningsdatum kan pausa gallringen; administrativa uppdrag måste hanteras separat innan kontot gallras. Gallringsjobbet körs varje minut i portalprocessen och tar ikapp när servern är igång. Det raderar kontaktprofil, identifierbara bokningar, checklistor, sessions-/återställningsuppgifter, privata kalenderlänkar och relaterade personliga markeringar. Anonyma per-pass bemanningstal behålls. Ett kvarvarande konto som behövs i ett annat hem behåller sin gemensamma inloggning, men profilen i det avslutade hemmet återbildas inte. Efter sista gallrade engagemanget anonymiseras även inloggningsankaret och centrala kontaktkopior tas bort. En icke inloggningsbar anonym användarrad hindrar att gamla id återanvänds. Återkomst efter gallring skapar en ny profil med ny introduktion; återkomst före gallring nollställer också introduktionen.

Praktisk information innehåller versionshanterade lokala rutiner med bekräftad version och tidpunkt. Nya volontärer behöver checklista, praktisk introduktion, aktuell rutinbekräftelse och administrativt godkännande för självständig bokning. Admin kan boka introduktionspass med en rutinerad volontär att fråga åt aktiva volontärer. Befintliga konton behåller introduktionsbehörighet vid migrationen; nypublicerade rutiner behöver ändå bekräftas. Grönmarkering är ett separat erfarenhetsmått. Flytt nollställer lokal introduktion, och återflytt till en redan gallrad profil återanvänder inte den gallrade posten.

CSV-underlaget kompletteras med engagemang, rutinversioner och anonyma bemanningstal där dessa tabeller finns. Det är fortfarande en manuell återuppbyggnadsgrund, inte en automatisk databasåterställning. Externa CSV-filer och äldre säkerhetskopior gallras inte av serverjobbet. Fristen är föreningens valda policy; rättighetsbegäranden och övriga GDPR-frågor kräver egna rutiner. Supabase införs inte i denna ändring.

## Grafisk profil, volontärspåse och lösenordsbyte (0.6.010)

Administration → Grafisk profil låter admin/superadmin välja huvudfärg, sidbakgrund, text- och accentfärg samt en PNG/JPEG/WebP-logotyp på högst 200 kB. Inställningarna sparas per katthem i branding och visas även före inloggning för valt hem. Grafiken är offentlig; inga privata uppgifter ingår i den publika konfigurationen. Logotyper lagras som validerade bilddata, inte externa URL:er eller SVG. Revision skyddar samtidiga ändringar, och kontrast mellan text och sidbakgrund måste vara minst 4,5:1. Förhandsgranskning återställs vid avbrytande; standardutseende och tom logotyp kan sparas.

Volontärprofilen har en administrativ kryssruta Har fått volontärspåse. Den visas på privata volontärkort och i profilen. Befintliga profiler får false utan att andra uppgifter ändras. Volontärens egen profil-API tillåter inte att fältet ändras. Markeringen följer inte med vid flytt till ett nytt hem. CSV-underlaget innehåller påsmarkeringen och grafiska inställningar när tabeller/fält finns.

Vid denna uppgradering införs must_change_password med standardvärde 1. Befintliga lösenord/hashvärden behålls. Konton vars e-post inte slutar på .local behöver välja ett annat lösenord vid nästa användning; andra API-anrop blockeras tills bytet är klart. Flaggan nollställs vid eget verifierat byte eller återställning via e-post. Nytt startlösenord eller administrativ återställning kräver eget byte igen. Migrationen kör inte om kravet vid varje start. .local är ett uttryckligt undantag, inte en metod för riktiga användarkonton.

Formuläret för nya konton föreslår unika tillfälliga lösenord med webbläsarens kryptografiska slumptalsgenerator. Inget gemensamt standardlösenord införs. CSV-import behåller uttryckligen tilldelade startlösenord från filen; välj ett unikt per person. Inga lösenord skickas automatiskt via e-post. Tidsbegränsad lösenordsbytesvy exponerar inga scheman, nyheter eller andra profiler. Gatewayn kontrollerar originalkontots krav även vid tilldelad åtkomst till andra katthem; interna skuggkonton kan inte användas för att kringgå det. Vid flytt följer lösenordsbyteskravet med kontot.

Manuell testning: kontrollera nytt färgval, logotyp och standardåterställning i ett hem, växla till ett annat, kontrollera påsmarkering och prova ett icke-.local-konto med krav på byte. Publicering till GitHub görs separat på begäran.

## Lösenordsåterställning för flera katthem

Nya återställningslänkar innehåller katthemmets identifierare i parametern `shelter`. Länken väljer rätt katthem även i en ny webbläsare, och sparandet använder samma katthem även om väljaren ändras medan formuläret är öppet. Token ligger fortsatt i URL-fragmentet och tas bort ur adressfältet när formuläret öppnas. Äldre länkar utan katthem använder det aktuella valet; begär en ny länk om återställningen inte fungerar.

## Version 0.6.012 – schema, introduktion och mobilvy

På mobil visar Veckoschema en dag i taget med datumknappar och valet Visa hela veckan. Filtren gäller båda vyerna. Introduktionsöversikten i schemat och Praktisk information visar klara steg och leder till checklistan, rutinerna eller kontaktpersonerna. Admin registrerar fortsatt praktisk introduktion och godkännande.

Automatiska uppdateringar körs bara i Veckoschema och Mina bokningar. De bevarar fokus och rullningsläge, väntar vid formulärfält eller öppna dialoger och kastar svar om användaren hunnit byta vy, vecka eller katthem. Schemarenderingen har flyttats till public/schedule-view.js, som laddas före app.js. Manualen under Praktisk information beskriver de nya flödena och lösenordsåterställningen för flera katthem.

### Begränsade schemauppdateringar

Bakgrundsuppdateringen använder GET /api/schedule?start=ÅÅÅÅ-MM-DD&end=ÅÅÅÅ-MM-DD. Intervallet valideras och får vara högst 31 dagar. Svaret innehåller intervallets pass och användarens egna bokade pass även utanför intervallet; administratörer får deltagaruppgifter endast för dessa pass. Övriga volontärers privata profiler skickas inte i detta svar. Fullständig hämtning används fortsatt vid inloggning, veckobyten och bokningsändringar. Frågor och renderingen för schemat har separerats i schedule-data.mjs respektive public/schedule-view.js. Databasen får index för datum och passbokningar.

## Uppdateringsnyheter vid publicering

Vid varje uppdatering som pushas ska en kort svensk nyhet med versionsnummer och användarsammanfattning publiceras via den befintliga gemensamma nyhetsfunktionen för alla katthem. Sluttiden är exakt 72 timmar efter den lyckade pushen. Omstart eller senare driftsättning ska inte förlänga tiden. Nyheten finns på Anslagstavlan fram till sluttiden; startsidans nyhet kan döljas personligen enligt befintligt beteende.

Rutinen dokumenteras i AGENTS.md. Det är en publiceringsrutin, ingen installerad automatisk integration med GitHub. Publicering kräver åtkomst till den driftsatta portalen; lokala nyheter synkas inte till servern via Git. Utkast för den väntande uppdateringen finns i docs/uppdateringsnyhet-0.6.012.md. Faktisk pushtid och sluttid fastställs först när pushen har lyckats.

## Version 0.6.013 – inställbar bokningsrekommendation

Standardvärdet är nu fem deltagare. Admin och superadmin ändrar rekommendationen under Administration → Bokningsrekommendation, mellan 2 och 100 personer. Värdet sparas separat för varje katthem och gäller alla pass och händelser. Inställningen gäller direkt utan omstart. Befintliga bokningar behålls och minimibemanningen är fortsatt två.

Servern kontrollerar det aktuella värdet i bokningstransaktionen, även när flera bokar samtidigt. En extra bekräftelse krävs när rekommendationen uppnåtts, också när admin bokar åt andra och för återkommande bokningar. Ändrad rekommendation gör en tidigare förhandsgranskning av en återkommande serie inaktuell. Samtidiga inställningsändringar skyddas med revisionsnummer. Äldre avsnitt om sju deltagare beskriver tidigare versioner; denna inställning gäller nu.

## Version 0.6.014 – infällda administrationsdelar

Bokningsrekommendation är nu hopfällbar som övriga administrationsdelar. Alla delar, inklusive födelsedagar och styrelselistan, är stängda från början och vid byte av sida. Klicka på rubriken för att öppna en del. Öppna delar behålls vid omritning och sparning på samma sida.

### Navigation mellan startsida och schema (0.6.014)

Veckoschema i menyn öppnar schemavyn och rullar direkt till Veckans pass, med fokus på rubriken. Senast valda vecka och filter behålls. Loggan uppe till vänster är en tangentbordstillgänglig knapp till startsidans början; den återställer aktuell vecka, alla pass och mobil dagvy. Inloggning visar fortfarande startsidan från början.

## Version 0.6.015 – rollanpassad volontärmanual

Volontärmanualen visar inte inställning av bokningsrekommendation, grafisk profil, logotyp eller registrering av volontärspåse. Gemensamma avsnitt om lösenord, engagemang, nyheter, schema och grönmarkering har volontäranpassade instruktioner. Administrativa arbetssteg och driftinformation finns kvar för admin och superadmin. Användarmanualerna beskriver att uppdateringen har publicerats, utan att nämna kodplattform eller push. Den interna publiceringsrutinen och nyheternas faktiska tidsgräns är oförändrade.

## Version 0.6.016 – tre introduktionspass och gemensam godkännandenotis

Nya volontärer får boka upp till tre introduktionspass själva efter aktuell rutinbekräftelse. Hela checklistan krävs fortsatt för slutligt godkännande. Kvoten räknar samtliga ej inställda bokningar sedan introduktionen började, både genomförda och kommande, även pass bokade av admin. Avbokning eller inställning frigör plats. Vid återkomst eller ny lokal introduktion räknas äldre pass inte in.

När hela checklistan är klar visas en gemensam notis med personens namn på startsidan och i Administration för alla admins i det aktuella katthemmet. Volontären ser sin status och återstående kvot på startsidan. Notiserna försvinner vid slutligt godkännande, som kan ges före tredje passet. Inga extra e-postmeddelanden skickas. Admin bekräftar fortsatt praktisk introduktion och godkännande. Godkännande kräver full checklista och aktuella rutiner.

Kvoten kontrolleras i bokningstransaktionen; återkommande bokningar godkänns bara om hela serien ryms. Admin kan boka ytterligare pass med en rutinerad volontär att fråga åt en aktiv volontär. Befintliga fullt godkända volontärer behåller behörigheten. Minimibemanning och bokningsrekommendation ändras inte. Introduktionspassen ska genomföras med en erfaren volontär; föreningen har inga särskilda handledare. Detta avsnitt ersätter äldre beskrivningar av spärrad självständig bokning före introduktion.

## Version 0.6.017 – byt namn på katthem

Superadmin kan byta namn under Administration → Hantera katthem och åtkomst → Öppna katthem och åtkomst → Byt namn på katthem. Ändra namnet och välj Spara namn. Namnet ska innehålla 1–100 tecken och får inte redan användas av ett annat katthem.

Katthemmets interna identifierare och databas är oförändrade. Konton, bokningar, adress, dörrkod och åtkomst behålls. Namnet hämtas från det beständiga katthemsregistret vid inloggning och i portalen. Även profilvisning och nya profilsparningar använder aktuellt namn utan omstart. Samtidiga namnändringar skyddas mot överskrivning. Uppdatera sidan på andra redan öppna enheter för att se nytt namn direkt.

## Version 0.6.018 – bokningshjälp, säkerhetskopior och ändringshistorik

Schemat visar orsaken till bokningsstopp och leder till rutinbekräftelse, checklistan, kontaktpersonerna eller Mitt konto. Om servern stoppar en bokning efter att läget ändrats visas hjälpen i bokningsdialogen.

Administration → Ändringshistorik visar tidpunkt och ansvarig administratör för viktiga ändringar i det valda katthemmet. De senaste 100 händelserna visas, med 90 dagars lagring. Introduktionsgodkännande, bokningsrekommendation, passändringar, inställda pass, rutinpublicering och katthemsnamn registreras. Bara lyckade åtgärder loggas. Inga lösenord eller fritextanteckningar skrivs till historiken. Namn hämtas från aktuellt konto, så raderade personers namn återinförs inte från loggen.

### Säkerhetskopiering

Portalen skapar dagliga säkerhetskopior efter start och vid underhållskontrollen. Standardmappen är DATA_DIR/backups och de sju senaste kopiorna behålls. BACKUP_ENABLED=0 stänger av automatiken; BACKUP_DIR kan ange en annan skyddad lagringsplats. I Docker behövs en separat beständig montering om BACKUP_DIR pekar utanför /app/data. Kopior på samma server skyddar inte mot förlust av servern; kopiera därför också till separat skyddad lagring.

Före kopieringen spärras nya vanliga portalanrop kortvarigt och pågående anrop får avslutas. Flyttar mellan katthem och andra portalanrop kan inte ändra registret mitt i kopieringen. SQLite kopieras med VACUUM INTO, inte vanlig filkopiering av öppna databaser. Alla katthemsdatabaser, registret, e-postinställningar och nyckelfiler ingår. Kopior och nycklar innehåller känsliga uppgifter; mappar skapas med 0700 och filer med 0600 där filsystemet stöder det.

Varje kopia har kontrollsummor och återläses i en isolerad tillfällig mapp. SQLite integrity_check och foreign_key_check körs och det kontrolleras att alla registrerade katthem har en databas. Denna kontroll prövar filernas återläsbarhet och databasstruktur; den startar inte appen eller skickar påminnelser från kopian. Superadmin ser status och kan skapa eller verifiera kopior via Administration → Säkerhetskopiering. Den äldre rådet att stoppa appen före egen filkopiering gäller fortfarande.

Manuell kontroll: npm run verify-backup -- /sökväg/till/kopia. Återläsning till en ny tom mapp: npm run restore-backup -- /sökväg/till/kopia /ny/tom/datamapp. Kommandot vägrar skriva över en icke-tom mapp. Stoppa driftappen innan den byts till återställd data. För en fullständig driftövning startas en separat isolerad instans med utskick avstängda; det görs inte automatiskt av kontrollkommandot.

## Version 0.6.019 – prioriterad och rollanpassad navigation

Menyn visar Veckoschema först, därefter Bemanning för admin/superadmin, sedan Mina bokningar, Praktisk information och Volontärer. Administration visas bara för administrativa roller. Anslagstavla och Mitt konto ligger efter arbetsfunktionerna. Endast tillgängliga funktioner visas; serverns behörigheter ändras inte.

Administration är grupperad i Planering och säkerhet, Uppföljning och kontakt, Information och planeringsstöd, Import och export samt Utseende och trivsel. Introduktioner som väntar på godkännande och passplanering ligger tidigt. Katthemsåtkomst och säkerhetskopiering visas i den första gruppen för global superadmin. Gruppernas befintliga fällbara delar och öppningsbeteende behålls. Kontakter och rutiner har genvägar; all befintlig hantering av pass, engagemang, e-post, nyheter, CSV och historik finns kvar.

Praktisk information visar adress, introduktion, aktuella rutiner, kontaktpersoner och checklista före allmän träffinformation. På Mitt konto ligger engagemang och lösenordsbyte före profilredigering och passstatistik. Manualens befintliga rollfilter används även efter prioritetssortering, och ett inledande avsnitt beskriver navigationen. Administrativa funktioner presenteras inte som låsta alternativ för volontärer.

Standardnamnet vid logotypen är Volontärsportalen, även på inloggningssidan. Vald föreningslogotyp behålls och katthemmets namn visas fortsatt i katthemsväljaren.

### Mina bokningar och aktuella rutiner (0.6.019)
Mina bokningar samlar egna kommande bokningar från alla katthem som kontot har åtkomst till. En gemensam ICS-fil innehåller alla icke inställda kommande pass med respektive hems adress och separata händelse-ID:n. Veckokalendern och kalenderprenumerationen är fortsatt per valt katthem. Identiteter kopplas med portalens befintliga kontolänkar, aldrig enbart e-post.

Nya rutiner behöver läsas och bekräftas även inför redan bokade pass. En påminnelse ligger kvar tills aktuell version bekräftats; bokningarna avbokas inte. Gröna volontärer är rutinerade personer att fråga, inte formellt utsedda handledare. Volontärer behöver minst 10 genomförda pass och fullständig checklista för att bli gröna; import och manuell markering kringgår inte kravet. Admin och superadmin behåller grön rollmarkering.

Introduktionschecklistan innehåller även `profile-updated`: volontären öppnar Mitt konto, kontrollerar och uppdaterar sina profil- och kontaktuppgifter och bekräftar sedan punkten själv. Inga kontaktfält blir obligatoriska genom detta. Punkten ingår i den befintliga serverkontrollen av hela checklistan och undantas inte för importerade eller manuellt markerade volontärer. Tidigare genomförda checklistor behöver kompletteras med den nya punkten innan volontären kan vara grön igen.

Databasskrivningar i katthemmens server väntar upp till fem sekunder på ett tillfälligt SQLite-lås i stället för att omedelbart avbrytas. Bokningskvoten kontrolleras fortfarande i transaktionen. E-postinställningar ersätts atomiskt med unik temporär fil och begränsade återförsök vid tillfälliga Windows-lås; befintlig fil behålls vid misslyckat sparande.
