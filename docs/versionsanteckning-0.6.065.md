# Versionsanteckning – version 0.6.065

Introduktion genomförd visas som separat status för volontärer med färdig checklista, praktisk introduktion och admins godkännande. Admin kan filtrera på denna status. Grönmarkeringen behåller sin erfarenhetsregel: importerade rutinerade med erfarenhetsmarkering behöver inte tio nya pass, medan övriga behöver tio grönmeriterande arbetspass och klar checklista.

Praktisk introduktion markeras automatiskt efter tre avslutade bokade arbetspass sedan introduktionens start. Event, volontärsträffar, avbokade och inställda pass räknas inte. Närvarobekräftelse används inte. Manuell rättning och SA:s begäran om ny avstämning respekteras.

Efter tredje arbetspasset visas en portalnotis för alla admins och SA i katthemmet, även om checklistan är ofullständig. Notisen anger vad som återstår och öppnar introduktionsgranskningen. En post per volontär visas utan dubbletter vid omladdning. Den försvinner efter godkännande eller när personen inte längre är aktiv. Det är ingen e-postnotis. Automatiken godkänner inte självständig bokning och kryssar inte i checklistan.

Manual och README är uppdaterade. Verifiering omfattar testsvit, statusfilter, trepassgräns, ofullständig checklista, manuella korrigeringar och behörigheter. Den riktiga driftsidan, /healthz och ändrade skript ska kontrolleras efter push.

## Utkast till uppdateringsnyhet
Rubrik: Uppdatering 0.6.065 – tydligare introduktion och adminnotis

Introduktion genomförd visas nu separat från grönmarkering och går att filtrera i volontärlistan. Praktisk introduktion markeras automatiskt efter tre avslutade bokade arbetspass. Då visas en notis för admins i katthemmet, även om checklistan inte är klar. Admin gör fortfarande slutligt godkännande. Event och volontärsträffar räknas inte mot trepassgränsen. Tidigare rutinerade som importerats gröna behåller sitt undantag; övriga behöver tio grönmeriterande arbetspass och klar checklista. Manualen är uppdaterad.

Nyhetens sluttid ska vara exakt 72 timmar efter lyckad push.
