# Versionsanteckning – version 0.6.059

Händelser har eget bemanningsbehov och valfritt deltagartak, beskrivning och märkning i veckoschemat. Startsidan visar de tre närmaste händelserna och en länk till alla.

Gemensamma event kan gälla flera katthem med en gemensam deltagarlista och ett bemanningsmål. SA eller admin i samtliga deltagande hem kan tilldela eventansvariga utan generell adminåtkomst. Eventansvariga kan redigera sitt event och hantera deltagare. SA har alltid åtkomst. Önskad fördelning mellan hem är valfri. Deltagartak, unik bokning, åldersregel och överlappningsvarning gäller även gemensamma event.

Event och volontärsträffar räknas som aktivitet men ger ingen merit för automatisk grönmarkering. Profilen skiljer på totalt antal genomförda pass och grönmeriterande arbetspass. Gemensamma event räknas en gång per person, även efter kontoflytt.

Vid redigering av passrutiner kan admin aktivera separata arbetsinstruktioner för morgon, eftermiddag och kväll, permanent eller för en tillfällig period. Gemensamma dagliga och veckovisa rutiner finns kvar som bas. Event påverkas inte av arbetspassens rutintexter.

Gemensamma event har ännu inga egna ändringsmejl, automatiska passpåminnelser eller närvaroknappar. Dessa bokningar behöver avbokas separat före statusbyte och kontoflytt. Gemensamma event ingår i den samlade kalenderexporten men inte i lokala kalenderprenumerationer.

Manualen och README är uppdaterade. Uppdateringsnyhetens sluttid ska vara exakt 72 timmar efter lyckad push.

## Utkast till uppdateringsnyhet

Rubrik: Uppdatering 0.6.059 – gemensamma event och passrutiner

Nu kan händelser ha eget bemanningsbehov och valfritt deltagartak. Gemensamma event för flera katthem får en gemensam deltagarlista och särskilt tilldelade eventansvariga. Händelser visas på startsidan och i veckoschemat. Event och volontärsträffar räknas som aktivitet men ger ingen merit för automatisk grönmarkering. Admin kan aktivera olika arbetsrutiner för morgon-, eftermiddags- och kvällspass, permanent eller tillfälligt. Manualen är uppdaterad.

## Korrigering av containerpaketering
De tre nya runtime-modulerna inkluderas nu i Dockerfilens COPY-lista och tillåts av .dockerignore. Det rättar startfelet vid driftsättning av 0.6.058.
