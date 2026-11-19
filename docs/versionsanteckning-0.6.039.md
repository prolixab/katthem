# Versionsanteckning – version 0.6.039

Kompakta volontärskort med initialer, klickbar e-post, roll och statusetiketter samt profilknappen längst ned. Grönmarkerade har vit bakgrund, grön kant och textetikett. Styrelsemedlemmar visas som Styrelse; nya rollfilter kompletterar befintlig sökning och filtrering. Korten anpassas till tre, två eller en kolumn beroende på skärmbredd.

När superadmin sparar en styrelsemedlems profil får ett kopplat volontärkonto automatiskt adminbehörighet. Superadmin behåller sin behörighet. Admin får inte använda styrelserollen för att kringgå befintliga behörighetsregler. Borttaget styrelseuppdrag tar inte automatiskt bort adminbehörighet.

Startsidan använder lika breda kolumner och enhetliga mellanrum så att inner- och ytterkanter linjerar. Min profil visas före Byt lösenord under Mitt konto. Manualer och README är uppdaterade.

Verifierat: 112 automatiska tester passerar; profilöppning, sökning, filter och mobilvy kontrollerade lokalt.

Uppdateringsnyhet publiceras för alla katthem med sluttid exakt 72 timmar efter lyckad push. Den verkliga pushtiden registreras efter att pushen lyckats.
