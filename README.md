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

Volontärer ser sitt eget antal genomförda pass under Mina bokningar och Mitt konto. Admin ser allas antal i Administration och kan grönmarkera volontärer manuellt. Minst 10 genomförda pass och helt klar checklista ger automatisk grönmarkering. Manuell markering ersätter passkravet men kräver fortfarande klar checklista. Att ta bort en manuell markering tar inte bort den automatiska.

Under Administration → Importera volontärer (CSV) kan admin förhandsgranska och importera upp till 500 nya volontärer. Använd UTF-8, komma eller semikolon och rubrikerna `namn;e-post;grön`. Kolumnen `grön` är valfri och accepterar `ja` eller `nej`. Välj Grönmarkera alla i importen för att markera hela gruppen. Befintliga eller dubblerade e-postadresser stoppar hela importen. Nya volontärer väljer eget lösenord via välkomstmejlet. Om e-post är avstängd väntar utskicket.

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

Den personliga introduktionschecklistan är tillgänglig under Praktisk information → Introduktion och stöd för alla inloggade, även gröna, godkända, styrelse, admin och superadmin. Mitt konto → Min introduktionschecklista leder till samma lista. Var och en fyller i sina egna punkter; sparade kryss bevaras. Admin och superadmin behåller grönstatus genom sin roll.

## Version 0.3.001

Medlemsregistret är tillgängligt för styrelse/admin och superadmin med kontaktuppgifter, medlemsstatus, styrelseroll och övriga ansvarsområden. Medlemsprofiler kopplas till inloggningskonton via användar-id. Medlemmar kan även finnas utan konto. Endast dessa roller får läsa och ändra profilerna.

Dörrkod visas vid schemat för inloggade användare; styrelse/admin och superadmin får ändra den. Dagens städning visas i passdialogen, inte på kalenderkortet. Sena avbokningar hänvisas till katthemmets bemanningsgrupp i Messenger, även i påminnelser.

Kattinfo ingår inte i denna version och har sparats separat som lokalt arkiv. Funktioner från 0.2.004–0.2.005, bland annat rullande schema, checklistan, kalenderfiler och ändringsmejl, behålls.

### Personlig kalenderprenumeration
Under Veckoschema och Mina bokningar finns Prenumerera på mina pass. Länken läggs till som en kalenderprenumeration (inte filimport). Varje aktivt konto har en egen slumpmässig, privat länk som visar dess aktuella bokningar med adress och arbetsuppgifter. Länken kan återkallas i samma dialog; en ny länk skapas nästa gång. Kalenderappen bestämmer hur ofta uppdateringar hämtas. Inaktiverade kontons länkar fungerar inte. Länkar är känsliga och ska inte delas. Lokala länkar fungerar endast på den lokala datorn; externa kalenderappar behöver en publicerad HTTPS-adress via APP_URL.

Kalenderexporter och prenumerationer innehåller en DISPLAY-påminnelse 12 timmar före varje pass (VALARM). Kalenderappen avgör hur importerade påminnelser hanteras. Restid och avresepåminnelser ställs in i kalenderappen; portalen beräknar inte restid. Informationssidan heter Praktisk information.

### Återkommande bokningar och bemanning (0.4.001)
Öppna ett framtida ordinarie pass och välj **Boka det här passet återkommande**. Bokningen gäller samma veckodag och klockslag. Välj varje, varannan eller var fjärde vecka och ett slutdatum inom det öppna schemat (högst sex veckor). Förhandsgranska innan bokning. Inställda eller saknade pass hoppas över och redan bokade pass behålls. Överlappningar och minst sju anmälda kräver separat bekräftelse. Hela bokningen sker i en transaktion och kräver ny förhandsgranskning om planen ändrats. Varje pass avbokas separat enligt vanliga regler; serien förlängs inte automatiskt. Styrelsen kan boka åt vald volontär.
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

### Nyheter på startsidan
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

Katthem kopplas via profilfältet Katthem: Huskvarna använder katthemmets gemensamma adress och dörrkod. Äldre tomma profiler använder befintligt katthem; en okänd ort visar ingen adress eller kod. Samma adressval används i personens kalenderexport och prenumeration. Admin redigerar fortsatt Huskvarna-katthemmets gemensamma adress och kod.


## Flera katthem (0.6.003)

Starta med npm start (portal.mjs), även i produktion. Docker och Windows-startfilen använder portalen. server.mjs är en intern server per katthem och får inte användas som publik produktionsstart. Portalen binder den publika porten och startar en intern server på loopback per registrerat katthem, med en hemlig intern åtkomstnyckel. Alla API-anrop auktoriseras i portalen innan de skickas till valt hem. Det är separata SQLite-databaser, e-postinställningar, CSV-jobb, kalenderprenumerationer, schema, profiler och nyheter.

Befintlig data ligger kvar orörd i det ursprungliga hemmet Huskvarna. Katthemstillhörighet bestäms av kontots ordinarie hem och explicita tilldelningar, aldrig av fritext eller matchande e-post. Superadmin i det ursprungliga hemmet har tillgång till alla hem. Under Administration → Hantera katthem och åtkomst kan superadmin skapa hem och tilldela/återkalla extra åtkomst som admin eller volontär. Nya hem får inga exempelkonton, ingen förifylld kod och ingen kopia av Huskvarnas adress eller e-postinställningar. Välj det nya hemmet och fyll i uppgifterna där. Systemets superadmin skapas bara i det ursprungliga hemmet.

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

Formuläret för nya konton föreslår unika tillfälliga lösenord med webbläsarens kryptografiska slumptalsgenerator. Inget gemensamt standardlösenord införs. CSV-import skapar ett unikt slumpat tillfälligt lösenord på servern när kolumnen lösenord saknas eller fältet är tomt. Äldre filer med uttryckliga startlösenord på 10–200 tecken fungerar fortfarande. Inga lösenord skickas automatiskt via e-post. Tidsbegränsad lösenordsbytesvy exponerar inga scheman, nyheter eller andra profiler. Gatewayn kontrollerar originalkontots krav även vid tilldelad åtkomst till andra katthem; interna skuggkonton kan inte användas för att kringgå det. Vid flytt följer lösenordsbyteskravet med kontot.

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

## Version 0.6.019 – ladda ner säkerhetskopior och händelser på Anslagstavlan

Systemets superadmin kan välja Ladda ner ZIP vid en kopia under Administration → Säkerhetskopiering efter Hämta status. Hela kopian ingår: manifest.json, databaser, inställningar och nyckelfiler. Den valda kopian fryses till en skyddad tillfällig mapp och verifieras före ZIP-skapandet. Arkivet strömmas som en inloggningsskyddad nedladdning utan webbläsarcache; tillfälliga filer städas även om överföringen avbryts. Administratörer och volontärer får inte ladda ner systemets säkerhetskopior.

Packa upp ZIP-filen före npm run verify-backup eller restore-backup. Förvara den skyddat på separat lagring; den innehåller känsliga kontouppgifter och nycklar. ZIP-filen är inte lösenordskrypterad. Nedladdningen registreras i ändringshistoriken. Ett versionslåst ZIP-bibliotek används för strömmande komprimering; testerna läser filen med ett separat ZIP-bibliotek.

Händelseöversikten har flyttats från Administration till Anslagstavla och visar kommande händelser och öppet hus. Volontärer kan öppna information och boka. Admin skapar händelser och kan visa deltagare, ändra tider eller ställa in via översikten. Kalendern finns kvar och hanterar samma pass. Återkommande ordinarie extra pass skapas fortsatt under Administration → Skapa och planera. Äldre avsnitt om Händelser under Administration avser tidigare versioner.

## Version 0.6.020 – förberedd tillvalsmodul för närvarobekräftelse

Närvarobekräftelse är en separat modul i presence.mjs och public/presence.js, avstängd från början i varje katthem. Systemets superadmin kan senare aktivera den under Administration → Moduler – närvarobekräftelse. När modulen är avstängd visas ingen volontärmeny, inga bekräftelser kan lämnas och QR-funktionen är spärrad på servern. Alla vanliga bokningar fungerar oberoende av modulen.

Modulen visar enbart dagens positiva bekräftelser från frivilliga. En egen bokning för idag kan kopplas till en bekräftelse, eller personen kan ange en spontan insats utan att skapa någon bokning. Inga ankomstklockslag, sluttider, arbetstimmar, positioner, frånvarorader eller individuella historikvyer lagras. Saknad bekräftelse räknas inte som frånvaro. Bekräftelser påverkar inte genomförda pass, grönmarkering, introduktion eller bokningsrätt. Dagens namn visas för inloggade i samma katthem; detta framgår innan personen bekräftar.

Bekräftelser rensas vid dagsbyte (svensk tid) och avstängning. Egna felaktiga bekräftelser kan ångras. Inaktiverade eller avslutade engagemang rensas automatiskt från modulen. Bekräftelser stryks ur databasernas säkerhetskopior före kontrollsummor och arkivering, så funktionen skapar ingen närvarohistorik genom backuper. Modulinställningen ingår i säkerhetskopian. Endast aktivering och avstängning loggas i administratörshistoriken, aldrig personers bekräftelser.

Aktiverad modul kan generera en QR-skylt. Koden innehåller bara en länk till rätt katthem och kräver inloggning och uttrycklig bekräftelse. Ingen person identifieras genom själva koden och fysisk plats kontrolleras inte. Publicerad portaladress ska användas vid utskrift. Tekniskt kontrakt och utbyggnadspunkter finns i docs/narvaromodul.md.

## Version 0.6.021 – korrekt e-post för tilldelade volontärprofiler

När ett ordinarie konto får åtkomst till ett annat katthem och e-postadressen redan används lokalt skapas ett separat skuggkonto med en intern reservadress. Profil-, konto- och deltagarsvar visar nu den verkliga e-postadressen från källkontot. Kontona slås inte ihop och behörigheter, bokningar och lokala profiluppgifter behålls.

En oförändrad synlig e-postadress översätts tillbaka till den interna adressen när en lokal profil sparas. Ett försök att ändra denna inloggningsadress i målkatthemmet avvisas med hänvisning till det ordinarie katthemmet. Databasen behöver ingen manuell ändring för befintliga reservadresser. Rättningen gäller portalens JSON-visning; interna export- och utskicksvägar har inte ändrats i denna version.

## Version 0.6.022 – separat visningsskärm för schemat

Administration → Visningsskärm för schemat → Hantera visningslänk skapar en läslänk för valt katthem. En admin i samma katthem kan rotera eller återkalla den. Inga vanliga konton eller administratörssessioner behövs på skärmen. Använd en separat webbläsarprofil utan portalinloggning och spara hela länken som bokmärke. Visningen på /visning använder separata filer och visar sju dagar totalt: idag och sex dagar framåt. Veckonummer och en tydlig avdelare markerar övergången till en ny vecka, även vid årsskifte. Helskärmsknappen aktiveras lokalt på skärmen.

Namngivning är avstängd från början: passnamn, tider, inställda pass och antal bokade visas. Admin kan uttryckligen välja deltagarnamn. E-post, telefon, dörrkod, profiluppgifter, extra information och interna anteckningar lämnar aldrig denna vy. Namn från inställda pass visas inte. Ingen närvaroregistrering eller uppgift om arbetad tid ingår.

Nyckeln är slumpad (256 bitar), sparas som SHA-256-hash i registret och är bunden till ett katthem. Länken bär nyckeln i fragmentet, som inte skickas i URL till servern. Klienten skickar den i X-Display-Key enbart till GET /api/display med credentials:omit. Nyckeln ger ingen normal session, ingen åtkomst till övriga API:er och inga skrivrättigheter. POST /api/portal/display skapar en ny nyckel med show_names och revisionsnummer; DELETE återkallar med revisionsnummer. GET där visar bara status, aldrig nyckeln. Rotation och återkallande loggas utan nyckelvärde.

Sidan använder no-store, no-referrer, noindex och en separat CSP. Länken är en åtkomstnyckel: den fungerar även utanför lokalen om den delas. Ingen platskontroll ingår. Schemat hämtas var 30:e sekund, med tolv sekunders timeout. Återkallad länk tömmer bilden vid nästa hämtning. Nätverksfel visar tydlig varning och senast hämtade schema i högst cirka två minuter före tömning, därefter fortsatta återförsök. API:et tillåter inga egna datumintervall och lämnar inga interna id:n. Tabellerna i display.mjs separerar visningsbehörighet från vanlig inloggning.

### Frivillig närvarobekräftelse från visningsskärmen

När närvaromodulen är aktiverad i det valda katthemmet får skärmen en QR-kod med texten Jag är här och hjälper till. Koden går till den vanliga inloggningen och därefter närvarosidan för just katthemmet. Den innehåller varken visningsnyckel eller personuppgifter. Volontären bekräftar på egen mobil. Skärmens rättigheter är fortsatt begränsade till läsning.

Visningssvaret innehåller endast QR-bild och mobilens länk, aldrig en lista över bekräftelser eller annan närvarodata. Avstängd närvaromodul döljer rutan vid nästa skärmuppdatering. Återkallad visningslänk eller inaktuellt schema döljer också QR-rutan. På närvarosidan gäller fortsatt frivillighet, ingen tidsmätning eller frånvaroregistrering och ingen påverkan på bokningsrätt eller statistik.

### Förnamn på visningsskärmen

När namnvisning är vald skickar visnings-API:et förnamn. Från version 0.6.023 läggs vid behov minsta särskiljande prefix från efternamnet till för lika förnamn. Bindestreck i förnamn bevaras. Personer med samma förnamn visas var för sig och bokningar eller konton slås inte ihop. Namn som består av flera ord behöver därför kontrolleras i profilen om annat tilltalsnamn önskas. QR-bekräftelsen kräver fortsatt personlig inloggning. Från version 0.6.023 kan admin separat tillåta dagens bokade pass på gemensam skärm.

## Version 0.6.023 – dagens bokade volontärer på gemensam skärm

Admin kan under Visningsskärm för schemat välja både namnvisning och Tillåt frivillig bekräftelse för dagens bokade volontärer. Valet skapar en ny länk och ändrar inte rättigheterna på äldre läslänkar. Standardvärdet är avstängt. Närvaromodulen måste också vara aktiverad för katthemmet. Bara då har länken en begränsad skrivmöjlighet för positiva dagsbekräftelser. Vanlig bokning, avbokning, profiländring och administration förblir spärrade.

På dagens datum öppnas Jag är här. Volontären väljer sitt namn och pass samt Bekräfta att jag är här. Bara bokningar på dagens datum, i samma katthem, på ej inställda pass, för aktiva konton med aktivt engagemang, går att välja. Andra dagar har avstängd knapp. Valet innehåller passnamn och tid för personer med flera pass. Spontana insatser går via QR-koden och personlig inloggning. Saknad bekräftelse räknas fortsatt inte som frånvaro. Bekräftelsen påverkar inte passantal, grönmarkering, introduktion eller bokningsrätt.

Namn på schemat och i listan använder förnamn och minsta antal bokstäver från efternamnet som skiljer lika förnamn. Bindestreck bevaras. Identiska namn går inte att välja från skärmen utan hänvisas till QR-inloggningen. Systemet slår inte ihop personer eller bokningar. En gemensam skärm identifierar inte vem som klickar. Länken fungerar även utanför lokalen om någon delar den.

GET /api/display skickar begränsade val utan konto- eller boknings-id:n. Varje val är en HMAC med serverhemlighet, katthem, aktuell visningsnyckel, svenskt datum och bokning. POST /api/display/confirm tar endast choice och visningsnyckeln. Servern kontrollerar aktuella rättigheter, modulstatus, bokning och datum igen. Avbokade eller inställda pass, avstängda konton, gårdagens val och gamla eller återkallade länkar kan inte användas. Den privata worker-rutten blockeras på portalens offentliga gränssnitt. Förfrågningar begränsas till 120 bekräftelseförsök per minut och katthem. Dubbeltryck är idempotenta genom närvaromodulens unika index.

Skärmen visar inte vilka som bekräftat eller saknar bekräftelse. Efter lyckat val visas bara ett kort generellt tack. Bekräftelser lagras utan klockslag i den befintliga dagsmodulen, rensas vid dagsbyte/avstängning och tas bort ur säkerhetskopior. Namnval och bekräftelser hamnar inte i adminloggen. Egna felaktiga bekräftelser kan ångras via personlig inloggning på mobilen. Detta avsnitt utökar beskrivningen av den tidigare helt skrivskyddade visningslänken: läsläget finns kvar som standard.

Kortvariga SQLite-lås mellan portal och katthemsprocess väntas nu ut i upp till fem sekunder även i katthemsprocessen, i stället för att omedelbart ge HTTP 500. Detta skyddar samtidiga schemaläsningar och bokningsförsök när en annan anslutning skriver. Ett integrationstest håller ett skrivlås och verifierar att läsningen lyckas när låset släpps.

## Version 0.6.024 – närvaro per pass och samlad volontärprofil

Jag är här ligger nu på varje pass i skärmschemat. Bara dagens aktiva pass har en fungerande knapp. Dialogen visar det valda passet och bara dess bokade, aktiva volontärer. Andra dagar har avstängd knapp och inställda pass har ingen knapp. Signerade passnycklar kopplar varje dialog till rätt tillfälle utan att exponera interna id:n. Namn som inte går att skilja åt och spontana insatser hänvisas fortsatt till QR-inloggningen. Dialogen bevaras vid oförändrade bakgrundshämtningar och stängs om dess val blir inaktuella.

Den privata volontärprofilen visar Senast på plats: bara datumet för senaste frivilliga bekräftelsen från mobil eller gemensam skärm. Det är en uppgift om bekräftelse, ingen verifiering av fysisk plats eller vem som klickade. Tomt fält betyder ingen sparad uppgift, inte frånvaro. Dagens närvarolista rensas som tidigare. Tabellen presence_last har högst en rad per konto, utan klockslag och tidigare datum. Den skrivs över vid nästa bekräftelse och används aldrig för bokningsrätt, passantal, grönmarkering eller uppföljningsvarningar. Gamla bokningar fyller inte datumet. Endast en kvarvarande faktisk närvarobekräftelse kan fylla uppgiften vid uppgradering.

Vid personlig ångring av dagens sista bekräftelse tas det senaste datumet bort om det gäller idag. Äldre datum går inte att återställa eftersom ingen historik sparas. Avstängd närvaromodul eller gallring rensar datumet. Vid paus behålls senaste datumet. Tabellen stryks ur säkerhetskopior tillsammans med dagens bekräftelser, så en återställning återför ingen närvarohistorik. Datumet finns bara i inloggade egna kontouppgifter och adminskyddade profiler, aldrig i skärmschemat eller namnväljaren.

I volontärslistan återstår endast Visa volontärprofil på personkorten. Lösenord, roll, grönmarkering och aktivering finns inne i profilen, med tidigare behörighetskontroller. Profiler som hanteras genom tilldelad åtkomst behåller sina spärrar för lokal kontoadministration.

Profilens Introduktion genomförd och godkänd följer den befintliga samlade introduktionsstatusen automatiskt. Full checklista räcker inte ensam för nya volontärer: praktisk introduktion och slutligt godkännande krävs fortsatt. Systemets superadmin kan via profilen klicka ur rutan för en volontär som behöver en ny avstämning. Servern sätter intro_review_required och stoppar nya egna bokningar, även om en ursprunglig introduktionskvot återstår. Befintliga bokningar och checklistans kryss behålls och admin kan boka handledda pass. Grönmarkering är fortsatt separat.

PATCH /api/engagements/:id/introduction-status kräver superadmin, ett volontärkonto, completed och aktuellt revisionsnummer. Samtidiga profiländringar skyddas mot överskrivning. Nytt godkännande kräver full checklista, aktuella rutiner och bekräftad praktisk introduktion. Ordinarie administratörsgranskning kan återgodkänna när dessa krav är uppfyllda. Händelsen registreras i adminloggen. En ny lokal introduktion vid återkomst eller flytt har fortsatt sin vanliga separata introduktionskvot.

### Introduktionschecklista (0.6.025)
Admin och superadmin kan under Praktisk information → Aktuella rutiner → Redigera introduktionschecklista ändra rubriker och texter och lägga till frågor/punkter och avsnitt för sitt katthem. Befintliga punkter har stabila ID:n och sparade kryss behålls; befintliga punkter kan därför inte raderas i redigeraren. Nya punkter börjar okryssade. Vid sparandet väljs om de gäller alla volontärer eller bara nya och pågående introduktioner. Redan praktiskt och slutligt godkända volontärer undantas i det senare fallet. Textändringar visas även för dem. Nya konton och omstartade introduktioner använder senaste checklistan. Samtidiga ändringar skyddas med revisionskontroll. Godkännanden/bokningar återkallas inte av mallredigering; berörda checklistors fullständighet och grönmarkering räknas om.

Att superadmin klickar ur ”Introduktion genomförd och godkänd” rensar **inte** checklistan: kryssen och bokningarna ligger kvar, men en ny avstämning krävs. Checklistans mall, versioner och individuella tilldelning lagras i katthemmets databas och följer med dess säkerhetskopia.

Standardvalet i redigeraren är alltid **nya och pågående introduktioner**, även om föregående ändring gällde alla. Redan godkända volontärer behöver därmed inte komplettera nya punkter om inte admin uttryckligen ändrar målgruppen.

Introduktionspåminnelsen döljs när `intro_ready` är sant. Den egna checklistan är fortsatt åtkomlig via Mitt konto eller Praktisk information. Återkallat godkännande visar påminnelsen igen med sparade kryss kvar. Fullständig checklista räcker inte för att återställa ett återkallat godkännande; admin/SA behöver godkänna igen. Även introduktionsraden under aktuella rutiner döljs efter godkännande. Rutinbekräftelsen hanteras fortfarande separat.

### Redigerbara städrutiner på passen (0.6.026)
Admin och superadmin kan välja **Redigera städrutiner** i ett pass, eller **Praktisk information → Aktuella rutiner → Redigera städrutiner på passen**. Ange gemensam daglig text och städning per veckodag. Texterna sparas i katthemmets egen databas (`shift_routines`) med revisionskontroll och visas på alla pass; befintliga texter används vid uppgradering. Varje text får innehålla högst 2000 tecken. Volontärer kan läsa men inte ändra dem. Ändringen loggas i adminloggen och följer med databasbackuper. Bokningar och introduktionsgodkännanden påverkas inte. Detta är separat från versionshanterade Aktuella rutiner och kräver ingen läsbekräftelse; uppdatera instruktionerna på plats separat. Enskilda pass har fortsatt sin egen beskrivning och Extra information.

### Tillfälliga passrutiner (0.6.027)
I städrutinernas redigerare väljer Admin/SA **Permanent** eller **Tillfällig**. Permanent ändrar ordinarie texter. Tillfällig sparar en separat uppsättning för ett datumintervall, inklusive start- och slutdagen, i katthemmets databas. Passets datum avgör vilka texter som visas, utan tidsstyrda jobb. Berörda pass märks ”Tillfälliga rutiner”. Utanför perioden återgår visningen automatiskt till de ordinarie texterna. Endast en tillfällig period kan finnas åt gången; en ny sparad period ersätter den föregående. Redigeraren visar den sparade perioden och låter admin ändra eller ta bort den. Permanent redigering bevarar en sparad tillfällig period. Bokningar, introduktion och läsbekräftelser påverkas inte. Revisionskontroll skyddar även ändring och borttagning av perioden.
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

### Katthemmets namn i inloggat läge (0.6.019)
Vid logotypen visas valt katthems namn när användaren är inloggad. Katthemmet visas som Huskvarna. Namnet uppdateras vid byte av katthem och visas även med standardlogotypen. Inloggningssidan behåller Volontärsportalen.

## Version 0.6.028 – myndig medbokad, navigation och praktisk information
Volontärer som är under 18 på **passets datum** kan bara bokas om en aktiv person med aktivt engagemang och registrerat födelsedatum, som då är minst 18, redan är bokad på **samma pass**. Regeln gäller även adminbokning och varje nytt tillfälle i återkommande bokningar. Saknat födelsedatum tillåter egen bokning men räknas inte som myndigt sällskap. Födelsedatum får framöver läggas till/rättas av admin/SA i volontärprofilen; självbetjäningsvägen avvisar ändringar. Det hindrar att en känd minderårig kringgår spärren genom att ta bort eller ändra sitt datum.

Kontroll vid enskild bokning, återkommande bokning och avbokning sker inom skrivtransaktionen. Sista myndiga personen kan inte avbokas medan minderåriga finns kvar på ett framtida aktivt pass; boka ersättare, boka om minderåriga eller ställ in hela passet först. Ändrat datum/återaktivering av ett pass kontrolleras också. Befintliga brister, och sådana som uppstår efter administrativa profil- eller engagemangsändringar, visas för admins under Planering och säkerhet. Inga gamla bokningar tas bort automatiskt. Detta kontrollerar bokningar och registrerade födelsedatum, inte faktisk närvaro eller identitet. Ålder räknas inte ut från namn eller administratörsroll, och andra volontärers födelsedatum visas inte. Skottårsfödelsedag räknas som 1 mars under år utan 29 februari.

När närvaromodulen är aktiv ligger **Jag är här direkt under Mina bokningar** i menyn. Praktisk information har infällda grupper: **Inför och under ditt pass** (adress, aktuella rutiner, överlämning), **Introduktion och stöd** (introduktion, checklista, kontaktpersoner), **Volontärsträffar** och **Manual**. Länkar till rutiner/checklista/kontakter öppnar rätt grupp automatiskt.

Uppföljning av inaktivitet sker efter **60 dygn** sedan senaste genomförda bokade passet, eller kontots skapande om genomförda pass saknas. Endast aktiva volontärer med aktivt engagemang flaggas. Närvarobekräftelser påverkar inte denna beräkning, och ingen automatisk inaktivering sker.

Vid tilldelad åtkomst till flera katthem hämtar ålderskontrollen registrerat födelsedatum från det ordinarie hemmet via en skrivskyddad databasanslutning, utan att kopiera datumet till den andra profilen eller exponera det i dess svar. Ett känt födelsedatum i ordinarie hemmet går före lokala uppgifter; om det saknas används ett eventuellt lokalt administrerat datum.

## Version 0.6.029 – ändringsbar uppföljning efter 30 dagar
Standardgränsen för uppföljning är nu **30 dygn**, även vid uppgradering från den tidigare fasta 60-dagarsgränsen. Under **Administration → Uppföljning och kontakt → Volontärer att följa upp** kan Admin och SA ändra gränsen till 30, 60 eller 90 dagar i en vallista för sitt katthem. Värdet lagras i `activity_settings`, följer med databasbackuper och skyddas med revisionskontroll. Ändringen loggas i adminhistoriken och listan räknas om direkt.

Beräkningen utgår från senaste avslutade bokade passet, eller kontots skapande om sådana pass saknas. Samma inställda frist gäller nya konton. Endast aktiva volontärer med aktivt engagemang flaggas. Ingen automatisk inaktivering, gallring eller e-post sker på grund av uppföljningssignalen. Närvarobekräftelser påverkar inte beräkningen. Äldre dokumentavsnitt med fast gräns på 60 dagar gäller tidigare versioner.

## Version 0.6.030 – incheckning samlad under Mina bokningar
”Jag är här” visas på **samma sida som bokningslistan under Mina bokningar**, direkt efter listan, när närvaromodulen är aktiverad i valt katthem. Den separata menyfliken är borttagen. Bokningar från alla katthem visas som tidigare, men närvarodelen gäller valt katthem och är märkt med katthemmets namn. QR-länken och startsidans knapp leder till samma sida och rullar till närvarodelen. Dagens pass kan bekräftas även efter passets start; spontana insatser och ångring finns kvar. Bakgrundsuppdateringen fungerar i den samlade vyn. Modulavstängning döljer delen; bokningslistan fungerar oberoende av modulen.

## Version 0.6.031 – volontären kan ange födelsedatum
Under **Mitt konto → Min profil** kan volontären själv lägga in sitt födelsedatum när uppgiften saknas. Efter sparandet låses datumet för volontärens egen redigering. Admin och SA kan fortsatt lägga till och rätta det via volontärprofilen. Servern tillåter första registreringen och oförändrat datum men avvisar egen ändring/radering av ett redan registrerat datum. Giltiga datum, inga framtida datum och revisionsskydd gäller som tidigare. Åldersreglerna gäller direkt utifrån det sparade datumet. Detta ersätter den tidigare regeln att endast admin kunde fylla i datumet även första gången. Uppgiften är självrapporterad och innebär ingen extern åldersverifiering.

## Version 0.6.032 – skyddad visningsdator och kortlivad QR-incheckning
Visningslänken behöver nu en godkänd webbläsare. Öppna den fullständiga länken på katthemmets dator, kontrollera dess registreringskod och låt **SA** godkänna koden i **Administration → Visningsskärm för schemat → Hantera visningslänk → Godkänd visningsdator**. Koden gäller tio minuter. En godkänd webbläsare per katthem kan vara aktiv åt gången; SA kan ersätta eller återkalla den. Admin kan fortfarande skapa/återkalla länken men inte godkänna webbläsare. **Äldre länkar måste registreras efter uppgraderingen**. Skapa ny länk återkallar befintlig enhet och dess mobilbehörigheter.

Godkännandet använder en slumpad 256-bitars webbläsarnyckel i HttpOnly/SameSite=Strict-cookie, Secure och __Host-prefix i produktion. Endast hash lagras i registret. Nyckeln gäller upp till ett år. Länk utan cookie, fel katthem och återkallad webbläsare ger ingen schemaåtkomst och kan inte bekräfta från skärmen. Rensad cookie, annan webbläsare eller återställning från säkerhetskopia kräver ny registrering. Skyddet binder till webbläsarprofilen, inte fysisk hårdvara; det skyddar inte mot kopiering av en hel profil eller fysisk åtkomst till en redan godkänd dator.

När närvaromodulen är aktiv genererar den godkända skärmen en signerad QR-kod per minut. Koden upphör vid nästa minutgräns, skickas i URL-fragment och är bunden till katthem, godkänd enhet, dess revision och modulens revision. Ändrade koder, fel katthem, gammal minut, modulavstängning/återaktivering och återkallad enhet nekas. Skärmen döljer utgången QR och hämtar en ny kod automatiskt.

Efter inloggning växlas giltig QR mot **fem minuters** bekräftelserätt, bunden till just portalsessionen och katthemmet. Om inloggningen tar så lång tid att QR-koden har gått ut behöver volontären skanna den aktuella koden igen. Mina bokningar visar bekräftelser och egen ångring även utan ny QR; knappar för nya mobilbekräftelser kräver giltig bekräftelserätt. Servern kontrollerar detta, även för admin och SA, och en betrodd intern markering krävs i katthemsprocessen. En förfalskad klientheader ger ingen behörighet. GET /api/presence/qr lämnar inte längre en utskrivbar återanvändbar kod. Bokade kan fortsatt bekräfta från namnlistan på den godkända skärmen om det separata tillvalet är aktiverat. Spontana insatser går via QR och personlig inloggning.

Modulen kan fortsatt stängas av per katthem. Avstängning, länkrotation och återkallat enhetsgodkännande spärrar även tidigare mobilbehörigheter. QR-behörigheter hålls bara i minnet och försvinner vid omstart. Enhetsregistreringar tas bort ur säkerhetskopior så att återkallat godkännande inte återkommer vid återställning. Endast godkännande/återkallande loggas, aldrig enhetsnyckel, QR-token eller individuella skanningar. Befintliga regler om frivillighet, ingen timmätning och att saknad bekräftelse inte räknas som frånvaro gäller oförändrat. Det här försvårar sparade länkar och foton; det verifierar inte fysisk plats och hindrar inte direkt vidarebefordran av en aktuell kod.

## Version 0.6.033 – valbart läslås och två socialiseringspass
SA kan slå på eller av **Kräv godkänd webbläsare för att läsa schemat** under Administration → Visningsskärm för schemat → Hantera visningslänk. Inställningen gäller per katthem och är **avstängd från början**, även vid uppgradering. Vanliga admins får inte ändra inställningen. Med låset avstängt kan alla med länken läsa det begränsade schemat. Med låset på krävs godkänd webbläsare. Ändring skyddas av revision och loggas; den återkallar gamla QR-token och mobilbehörigheter.

**Incheckning och roterande QR kräver alltid godkänd visningswebbläsare**, oberoende av läslåset. En offentlig läslänk ger därför inga incheckningsrättigheter. Utan läslås kan visningsdatorn välja Registrera för incheckning och visa sin kod för SA. Med läslås visas registreringsrutan direkt. Detta ersätter föregående avsnitts krav att alla äldre läslänkar måste registreras: det gäller bara när SA aktiverar läslåset, eller när incheckning ska användas.

Söndagens socialiseringsgrupp har nu två separata pass, **16–18 och 18–20**, även första söndagen i månaden. Vid uppgradering delas ännu inte påbörjade, genererade framtida 16–20-pass en gång. Gamla bokningar följer med till båda delarna och det första passets boknings-ID behålls. Noteringar följer med och inställda pass förblir inställda. Historik, redan påbörjade pass och egna anpassade pass lämnas orörda. Upprepad start skapar inte extra pass eller bokningar. Nya bokningar och avbokningar görs separat per tvåtimmarspass.

## Version 0.6.034 – tydlig rubrik för incheckning
QR-delen högst upp i det publika veckoschemat har nu rubriken **Incheckning**, ovanför texten Jag är här och hjälper till. Rubriken visas tillsammans med QR-delen när incheckning är tillgänglig på den godkända visningswebbläsaren. Manualerna beskriver placeringen.


## Startsida och separat veckoschema – version 0.6.036

Den befintliga designen, vänstermenyn, färginställningarna, logotypen och administrationens uppdelning behålls. Startsida har lagts till i menyn och öppnas efter inloggning samt via logotypen. Den bygger innehållsmässigt på det ljusa designförslaget, inom portalens befintliga grafiska profil.

- **Startsida:** personlig hälsning, nästa egna bokning i valt katthem, pass med bemanningsbehov inom sju dagar, aktuella nyheter, rutin- och bokningspåminnelser, introduktion, översikt, adress/dörrkod, hopfällbar bokningsvägledning samt genvägar till praktisk information.
- **Veckoschema:** enbart kalendern med veckoval, filter, dagval på mobil, Vecka/Lista, kalenderfiler, bokningsinformation och knappar för att boka eller hantera ett pass. Startsidesinnehållet visas därmed inte ovanför kalendern.
- **Mina bokningar:** fortsatt egna bokningar över tillgängliga katthem och incheckning när den modulen är påslagen. Bokningsregler, åldersskydd, avbokning och behörigheter gäller som tidigare.
- Passrutorna har kompakt, innehållsanpassad höjd. Röd bemanningsvarning går före egen bokningsbakgrund. Grönmarkerad volontär anges separat. På mobil är bokningsknapparna minst 44 pixlar höga.
- På mobil öppnas menyn med Meny. Vid byte av vy är hopfällbara delar infällda; öppna delar bevaras vid uppdateringar i samma vy.
- I volontärvyn heter katalogen **Kontaktpersoner**. Admin och superadmin använder fortsatt **Volontärer** för hanteringen.
- Vid logotypen står **Tassportalen** med valt katthems namn under. Förekommande egen föreningslogotyp finns kvar. Samma benämning används vid inloggning och i webbläsarflikens titel.
- Den publika visningsskärmens QR-del har rubriken **Incheckning**, från den tidigare förberedda uppdateringen. Incheckningens säkerhetsregler och avstängningsmöjlighet behålls.

Manualerna för volontärer, admin och superadmin är uppdaterade. De två tidigare designexemplen sparas separat lokalt för jämförelse; deras alternativa toppmeny respektive sidomeny ingår inte som en generell ombyggnad i denna uppdatering.

Startsidesbilden `public/portal-cat.png` är skapad med det inbyggda bildverktyget som dekorativ miljöbild. Det är inte ett foto av en identifierad katt på hemmet. Prompt: en avslappnad brun tigrerad katt på en elfenbensvit filt i ett ljust katthemsrum, naturligt fönsterljus, varmvit och blek salviagrön bakgrund, realistisk fotografisk stil, liggande format utan text eller logotyp.

**Kontaktpersoner:** i volontärvyn öppnas kontaktlistan utfälld. Volontären kan fälla ihop den under samma sidbesök. När sidan öppnas på nytt visas den utfälld igen. Styrelselistan under Praktisk information och administratörernas volontärsida behåller hopfällbar standardvisning.

Veckovyn behåller även passerade pass i den valda veckan. I Alla pass visas historiken tillsammans med kommande pass. Passerade pass har märkningen Passerat och knappen Visa pass för läsning; nya bokningar på redan påbörjade pass tillåts inte. Ingen ny tidsgräns för radering av gamla pass införs.


### Grundstandard och Djurens Vänners profil

Portalens ursprungliga gröna färger behålls som grundstandard. Egna färger och uppladdade logotyper bevaras. Befintliga profiler skrivs inte över vid uppdateringen.

Djurens Vänners blå profil använder **RGB 1, 42, 94 / #012A5E**, ljus bakgrund och vita ytor. Admin eller superadmin kan välja **Administration → Grafisk profil → Djurens Vänner – blå profil**, förhandsgranska och spara. Profilvalet behåller uppladdad logotyp och gäller bara valt katthem. **Återställ grön grundstandard** återställer ursprungliga färger och standardlogotyp. Huskvarnas befintliga sparade blå huvudfärg fungerar även utan att en ny profil väljs.

Huvudfärgen används på knappar, rubriker, menyval och länkar. Röda bemanningsvarningar och gröna statusmarkeringar är oberoende av profilfärgen. Ett eget underbemannat pass har röd bakgrund och separat grön text för den egna bokningen; vanliga egna bokningar har ljusgrön bakgrund. Visningsskärmen fick rubriken Incheckning ovanför QR-koden. Incheckningens säkerhetsregler och möjlighet till avstängning är oförändrade.

## Menykolumn och portalnamn – version 0.6.037

Menykolumnen är 270 px på större skärmar och 255 px i smalare datorfönster. Tassportalen hålls på en rad vid logotypen. På mobil används fortsatt hopfällbar meny och mindre logotyp; på de smalaste skärmarna anpassas även namnets textstorlek. Manualerna är uppdaterade.

Logotypens motiv visas i en fast yta vid byte av katthem: 62 × 62 px på dator och 36 × 36 px på mobil. Vita och transparenta yttermarginaler i olika bildfiler jämnas ut för visningen, utan att originalfilerna ändras. Bildens proportioner och hela motivet bevaras.

## Tydligare vänstermeny – version 0.6.038

Menyn har grupperna **Vardag** och **Information** samt **Administration** för admin och superadmin. Vardag innehåller Startsida, Veckoschema och Mina bokningar. Information innehåller Praktisk information, Kontaktpersoner för volontärer och Anslagstavla. Administrationsgruppen innehåller Bemanning, Volontärer när katalogen är tillgänglig och Administration. Funktionerna och behörigheterna är oförändrade.

Enhetliga linjeikoner används för menyvalen. Aktiv sida har ljus bakgrund och en smal markering i valt katthems huvudfärg. Mitt konto och Logga ut är samlade under profilen längst ned. På mobil finns även dessa val inne i den hopfällbara menyn. De tidigare menybredderna och jämna logotypstorlekarna behålls. Alla tre rollmanualer är uppdaterade.

## Linjerade block på startsidan

Välkomstsektionen, informationsblocken och genvägarna använder lika breda kolumner och samma mellanrum vid respektive skärmbredd. Blockens inner- och ytterkanter linjerar även i smalare dator- och surfplattefönster. På mobil staplas blocken i en kolumn. Manualen för alla roller är uppdaterad.

Under **Mitt konto** visas **Min profil** före **Byt lösenord**, för volontärer, admin och superadmin.

## Kompakta volontärskort

Volontärslistan använder tre kolumner på stora skärmar, två på mindre och en på mobil. Vita kort har initialer, namn, roll, eventuellt uppdrag och ansvar, e-postlänk samt genomförda pass. Tomma ansvarsbeskrivningar och upprepat katthemsnamn utelämnas. Grönmarkering visas med kant och text; introduktion som pågår har egen status. Visa profil ligger i kortets nederkant. Alla befintliga sökfilter och profilåtgärder finns kvar, med nya filter för styrelse, administratörer och volontärer.

Styrelsemedlemmar märks **Styrelse** i korten. När superadmin sparar en styrelsemedlem med volontärbehörighet får kontot automatiskt adminbehörighet; superadminbehörighet bevaras. Befintlig regel att endast superadmin får ändra administratörsbehörigheter gäller även denna befordran. Borttagen styrelseroll tar inte automatiskt bort en separat adminbehörighet.

## Kontaktansvar för styrelsen

Admin och superadmin anger Kontaktansvar under Volontärer → Visa profil → Redigera profil: **Huskvarna**, **Värnamo** eller **Båda katthemmen**. Fältet börjar tomt; det härleds inte från arbetsplats eller inloggningsbehörighet. Kontaktansvar ändrar inte roll, aktivering eller katthemsåtkomst. Befintliga profiler behåller sina uppgifter.

Kontaktpersoner och Praktisk information använder kompakta kort med initialer, namn, styrelseuppdrag, kontaktansvar och telefon/Messenger. Personer för valt katthem visas först, följda av övriga tillgängliga kontakter. Kontaktansvar som saknas visas som Ej angivet. Kort har två kolumner på dator och en på mobil; Kontaktkorten har ingen knapp för telefonredigering. Admin och SA ändrar telefonnummer under Volontärer → Visa profil → Redigera profil. Alla rollmanualer är uppdaterade.

Kontaktansvar följer profilens befintliga synkronisering mellan katthem med explicit tilldelad åtkomst. Lokala ändringar i mottagande katthem bevaras enligt samma regler som telefon och Messenger. Fältet ger inte nya personer åtkomst eller exponerar profiler från andra katthem utan befintlig koppling.

Uppföljning har fasta alternativ: **30, 60 eller 90 dagar**, med 30 som standard. Äldre andra värden anpassas uppåt till närmaste alternativ, högst 90 dagar (exempel: 45 blir 60). Befintliga 30/60/90 bevaras. Ingen automatisk inaktivering sker.

Ortnamnet visas genomgående som **Huskvarna**, även i kontaktansvar, katthemsval och manualer. Äldre alternativa ortnamn i katthemsregistret och profilernas katthemsfält normaliseras till Huskvarna. Interna kontaktansvarsvärden och äldre ortalias fungerar fortsatt för befintliga uppgifter.

## Välkomstmejl för nya konton

Nya inloggningskonton får ett välkomstmejl med ämnet **Välkommen till Tassportalen – välj ditt lösenord**. Mejlet innehåller en engångslänk som gäller i 24 timmar och leder till val av eget lösenord. Lösenord skickas aldrig i mejlet. Detta gäller skapande via volontärprofil, separat kontoregistrering och CSV-import samt första inloggningskontot för en tidigare profil. Befintliga konton, automatiska katthemskopplingar och exempelkonton får inga välkomstmejl vid uppgradering. Ordinarie lösenordsåterställning gäller fortfarande i 30 minuter.

Utskicket köas i samma databastransaktion som kontot och överlever omstart. Aktiverad e-post och rätt publik portaladress behövs; utan fungerande e-post visas väntande status. Högst tio mejl behandlas per körning; bakgrunden kör varje minut. Vid fel görs högst sex försök med fem minuters mellanrum. Token lagras bara som hash. Kontot kvarstår om mejltjänsten är tillfälligt otillgänglig. Lokala testadresser och interna kopplingsadresser får inga mejl.

Admin/SA ser status under **Volontärer → Visa profil → Kontohantering** och kan välja **Skicka ny inbjudan** för nya konton som ännu inte valt eget lösenord, enligt ordinarie behörighetsregler. Inga mejl eller lösenordslänkar visas i profilsvaren. Avstängda konton får inga utskick. En utgången länk kan ersättas via Glömt lösenord eller en ny inbjudan.

Det befintliga registreringsformulärets tillfälliga lösenord finns kvar som reserv. Volontären behöver inte få detta om välkomstmejlets länk används. Det är inte möjligt att välja lösenord enbart genom att känna till någon annans e-postadress.


### Introduktionsuppmaning i välkomstmejlet

Välkomstmejlet innehåller ett permanent avsnitt **Ditt nästa steg** som hänvisar till introduktionsstegen på startsidan, aktuella rutiner, checklistan och praktisk introduktion med en erfaren volontär.

Ett tillfälligt tillägg förklarar att även redan erfarna volontärer går igenom portalens introduktion för att kunna stötta nya. Admin kan bekräfta tidigare praktisk introduktion; den behöver inte göras om enbart för införandet av portalen. Tillägget följer med välkomstmejlen fram till **1 januari 2027 kl. 00.00 Europe/Stockholm**, motsvarande **31 december 2026 kl. 23.00 UTC**. Därefter utelämnas hela tillägget automatiskt medan den vanliga introduktionsuppmaningen finns kvar.

Datumet kontrolleras när varje mejl skickas, även vid köade utskick, återförsök och nya inbjudningar. Redan skickade mejl, lösenordslänkens giltighet och introduktionskrav påverkas inte.



## Grafisk profil på det publika veckoschemat (0.6.042)

Visningssidan följer valt katthems sparade färger och uppladdade logotyp från Administration → Grafisk profil. En profiländring hämtas automatiskt med schemat. Passkorten har rundade hörn och färgad överkant som i portalen. Röda bemanningsvarningar har en egen statusfärg. På breda skärmar visas sju dagar sida vid sida med större text för läsning på avstånd.


## Spara inställningar för båda katthemmen (0.6.043)

Superadmin kan välja gemensam sparning i Grafisk profil, Moduler → Närvarobekräftelse och E-postinställningar. Formuläret visar vilka katthem som omfattas. Standardvalet är det katthem du arbetar i. Vid en samtidig ändring behöver du öppna inställningarna på nytt innan du sparar gemensamt.

- Grafisk profil sparar färgerna och logotypen på de angivna katthemmen.
- Närvaromodulen får samma av/på-inställning på katthemmen. Vid avstängning rensas dagens bekräftelser och senaste närvarodatum för de katthem som omfattas.
- E-post sparar Gmail-adress, portaladress, e-postaktivering samt mottagare och intervall för schemalagda CSV-exporter. CSV-exporterna från båda hemmen går till Gmail-adressen i formuläret. Om adressen är ny på något av hemmen behöver du ange applösenordet. Ett tomt lösenordsfält bevarar det sparade lösenordet för samma adress på respektive hem. Varje hem har sitt eget utskicksschema och exportunderlag.

## Snabbare startsida och visningsskärm (0.6.044)

Startsidan visar samma kattbild i WebP. Webbläsaren väljer mellan 480 och 960 pixlars bredd utifrån visningsytan och skärmens pixeltäthet. Originalbilden i PNG finns kvar. Visningsskärmen hämtar fortfarande aktuella uppgifter var femte sekund och ritar om passkorten när deras innehåll eller möjlighet till incheckning ändras. QR-kodens giltighet och kontrollen av visningslänken fungerar som tidigare.

## Alfabetisk volontärlista

Admin och superadmin ser volontärlistan uppdelad efter förnamnets första bokstav. Sektionerna följer svensk bokstavsordning med Å, Ä och Ö sist. Varje rubrik visar antalet personer i det aktuella sök- och filterurvalet. Namn inom sektionen sorteras också på svenska. Namn som börjar med andra tecken samlas under #. Accenter som É samlas under grundbokstaven E, medan Å, Ä och Ö är egna sektioner.

Bokstavsraden hoppar till sektionens rubrik och flyttar tangentbordsfokus dit. Bokstäver utan synliga personer är inaktiva. Sökning och befintliga filter gäller hela listan; tomma sektioner döljs och antal uppdateras direkt. Profilknappar och behörigheter fungerar som tidigare. På mobil visas ett kort per rad och bokstavsraden kan rullas i sidled. Kontaktpersonslistan för volontärer påverkas inte.

## Senast inloggad i volontärprofilen

Admin och superadmin ser **Senast inloggad** under Visa profil, med datum och klockslag i Europe/Stockholm. Endast lyckad autentisering uppdaterar `users.last_login_at`. Misslyckade försök, läsning av sidor, bakgrundsuppdateringar och internt skapade sessioner vid byte av katthem räknas inte som inloggning. Kopplade profiler visar den ordinarie kontoinloggningens tid. Uppgiften behålls vid flytt av konto och rensas vid gallring när identiteten raderas.

Äldre uppgifter fylls inte i eller gissas från kontots ålder. Innan en lyckad inloggning registrerats står Ingen inloggning registrerad ännu. Tiden visas bara i den privata volontärprofilen, inte i offentliga scheman eller volontärernas kontaktlistor. Den är separat från Senast på plats och bekräftar inte fysisk närvaro eller arbetstid. Ingen historik över enskilda inloggningar sparas av funktionen.

## Deltagarnamn i inloggat veckoschema

Inloggade volontärer ser bokade personers namn på passkorten i både veckovy och listvy samt i passdialogen. Samma `displayNames`-regel som på schemavisningssidan används: förnamn och bara de efternamnsbokstäver som behövs för att särskilja lika förnamn. Namnen levereras som `slots[].names` och uppdateras med ordinarie schemahämtning efter bokning eller avbokning. Inställda pass har en tom namnlista.

Andra personers boknings-id, användar-id, e-post och privata profiler lämnas inte ut till volontärer. `bookings` innehåller fortsatt bara den egna personens bokningar. Admin och superadmin behåller den fullständiga deltagarlistan och bokningshanteringen. Namnvisningen kräver inloggning och åtkomst till valt katthem och är oberoende av den separata visningsskärmens inställningar.

## Tydlig portaladress i volontärmejl

Välkomstmejl, lösenordsåterställning, passpåminnelser och ändrings-/inställelsemejl har en separat avslutning med rubriken Hitta tillbaka till Tassportalen, raden Portalens adress och tips om att spara ett bokmärke. Den vanliga adressen hämtas från den konfigurerade portaladressens origin (t.ex. https://katthem.teed.se); den innehåller varken återställningstoken eller katthemsparametrar. Vid domänbyte följer nya mejl den sparade adressen. Personliga engångslänkar och befintliga länkar till rätt katthem behålls separat. Redan skickade mejl och redan köade ändringsmejl skrivs inte om.

## Läs checklistans framsteg i volontärprofilen

Admin och superadmin ser antal klara punkter under Introduktion i volontärprofilen och i Granska introduktion. Visa introduktionschecklista öppnar en läsvy med varje tillämplig punkt markerad Klar eller Återstår, grupperad enligt personens checklista. Kryss och introduktionsgodkännanden ändras inte av läsvyn.

`GET /api/engagements/:id/checklist` kräver admin eller superadmin och använder valt katthems behörigheter. Volontärer får inte läsa andras framsteg. Gallrade och okända konton returnerar 404. Andra metoder nekas. Äldre godkända introduktioner får fortsatt sin tidigare uppsättning tillämpliga punkter.

## Katthemmets namn i CSV-mejl

Automatiska och manuella CSV-exporter anger katthemmets aktuella namn i både ämnesraden (`Huskvarna – CSV-export ÅÅÅÅ-MM-DD`) och första raden i mejltexten (`CSV-export från katthem: Huskvarna`). Namnet hämtas vid utskick från katthemsregistret, så även framtida namnbyten slår igenom utan att utskicksschemat behöver startas om. Separata katthem fortsätter skicka var sitt underlag, även med samma mottagaradress. Tidigare skickade mejl ändras inte.

## Rättad manuell grönmarkering

En sparad manuell grönmarkering (`green_manual`) räknas nu i den gemensamma grönstatusen. För volontärer krävs en komplett introduktionschecklista samt antingen manuell markering eller minst tio genomförda pass. Sparade manuella markeringar börjar gälla vid nästa hämtning utan att sättas på nytt. Om ett kryss tas bort upphör grönstatusen tills checklistan är komplett igen. Intro-godkännande är separat och ersätter inte checklistan.

Den egna checklistan använder fortsatt `PATCH /api/checklist` med det inloggade kontots id. Ingen rätt att fylla i andras checklistor har lagts till. Admins läsvy över en annan persons framsteg är fortsatt skrivskyddad.

För styrelse- och administratörskonton visar profilen en förklaring i stället för den tidigare låsta introduktionsrutan. Grönstatus genom rollen säger inte att frågorna har besvarats; faktisk checklistprogress visas separat. Volontärernas godkännanderuta fungerar som tidigare.

### Mobilbredd (0.6.050)
Långa e-postadresser och länkar bryts över rader i huvudinnehåll, sidhuvud och dialoger. Flex- och gridinnehåll får krympa till tillgänglig bredd. Mobilhuvudet placerar logotyp och meny i separata kolumner utan överlappning. Formulär använder en kolumn vid högst 600 px och textfält minst 16 px på mobil för att undvika automatisk inzoomning vid fokus i iOS. Ingen global döljning av horisontellt överflöde används; innehållet förblir tillgängligt.

Bokningsdialogen visar Boka det här passet med namn, datum och klockslag samt huvudknappen Bekräfta bokning av detta pass. Återkommande bokning ligger separat under Boka det här passet återkommande, hopfällt från början. Ordinarie bokningsregler, avbokning och adminverktyg är oförändrade. Ingen extra informationsruta har lagts ovanför veckoschemat.

Vid sparning av **Introduktion genomförd och godkänd** får portalen bara tillbaka volontärens introduktionsstatus och eventuell plats i listan över väntande introduktioner. Den öppna profilen uppdaterar kryssrutan och meddelandet på plats. Volontärslistan byggs inte om.

### Cachevalidering och mindre svar

JavaScript och CSS i den inloggade portalen valideras med ETag. Oförändrade filer återanvänds från webbläsarens cache. När manuell grönmarkering sparas från en volontärprofil skickar servern tillbaka ändrad grönstatus och berörda pass, och volontärprofilen ligger kvar öppen.

Visningsskärmen skickar en revisionsnyckel för veckoschemat. Servern kontrollerar visningsbehörigheten vid varje anrop, men utelämnar passkorten om schemat är oförändrat. Incheckning, QR-kod och status hanteras i varje svar.

## Bemanning för ett eller flera katthem

I Bemanning kan styrelsemedlemmar med administratörsbehörighet för flera katthem välja Huskvarna, Värnamo eller Alla mina katthem. Vyn börjar på valt katthem. Det gemensamma valet visar kommande pass i datumordning med katthemmets namn och samma filter för pass som behöver stöd. När ett pass hanteras från ett annat katthem växlar portalen till det katthemmet. Vid förhinder mindre än 24 timmar före ett pass meddelar volontären fortfarande katthemmets bemanningsgrupp i Messenger.

## Uppföljningsmejl efter 60 dagar

Admin kan under **Administration → Uppföljning och kontakt → Volontärer att följa upp** öppna inställningen för 60-dagarsmejl. Utskick är avstängda från början per katthem. Förhandsgranskningen visar aktuella mottagare innan admin aktiverar funktionen. E-post måste vara konfigurerad.

Aktiva volontärer får ett mejl per uppehåll efter 60 dagar från sitt senaste avslutade bokade pass, eller från registrering för den som saknar avslutade pass. Volontären loggar in och bekräftar under **Mitt konto → Mitt engagemang**, där det också går att pausa eller avsluta enligt vanliga regler. Admin ser skickade mejl och bekräftelser i samma uppföljning. Ett uteblivet svar påverkar varken konto, bokningsbehörighet eller gallring. Tillfälliga leveransfel prövas igen högst sex gånger totalt.
