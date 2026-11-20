# Versionsanteckning – version 0.6.041

Nya konton får välkomstmejl med en engångslänk för eget lösenord, giltig i 24 timmar. Gäller även CSV-import och första inloggningen för en tidigare profil. Utskicket köas atomiskt med kontot, överlever omstart och försöker igen vid fel. Kontohantering visar utskicksstatus och möjlighet att skicka ny inbjudan. Befintliga konton får inga mejl vid uppdateringen. Ordinarie lösenordsåterställning gäller fortsatt i 30 minuter. Tillfälliga lösenord finns kvar som reserv och skickas inte i mejlet.

Kontaktkortens snabbknapp Ändra telefon är borttagen; telefon redigeras via volontärprofilen. Uppföljningsgränsen väljs som 30, 60 eller 90 dagar, med 30 som standard. Äldre andra värden anpassas uppåt till närmaste alternativ, högst 90 dagar. Ortnamnet visas som Huskvarna i gränssnitt och manualer; äldre ortalias i katthemsfält normaliseras utan att kontaktansvar eller behörighet byts.

Manualer och README är uppdaterade. Verifierat med 120 tester samt lokal kontroll av utskicksstatus och ny inbjudan med testkonto och avstängd e-post.

Gemensam uppdateringsnyhet publiceras med sluttid exakt 72 timmar från verklig lyckad push. Tidpunkt registreras först efter lyckad push.
