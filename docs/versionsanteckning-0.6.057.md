# Versionsanteckning – version 0.6.057

Vid administrativ ändring till pausad, inaktiv eller avslutad visas kommande och pågående bokningar i valt katthem. Admin/SA måste bekräfta att listan kontrollerats och att bokningarna avbokas automatiskt innan sparning. Avbokning och statusändring görs i samma transaktion. Historiska och redan inställda pass samt andra personers bokningar behålls. Sista myndiga på ett pass med minderåriga får inte avbokas utan ersättare; fel medför att hela ändringen återställs. Personens egen paus/avslut avbokar inte bokningar automatiskt.

Manualen har en sökfunktion för rubriker och instruktionstext i de avsnitt den inloggade rollen har tillgång till. Matchande avsnitt öppnas och antal träffar visas. Sökningen ignorerar skiftläge och diakritiska tecken. Rensa sökning visar avsnitten igen.

Manualen och README är uppdaterade. Uppdateringsnyheten publiceras för alla katthem med sluttid exakt 72 timmar efter lyckad push.

## Utkast till uppdateringsnyhet

Rubrik: Uppdatering 0.6.057 – sökbar manual och bekräftad avbokning

Nu kan du söka i manualens rubriker och instruktioner. När admin eller SA ändrar en persons status till pausad, inaktiv eller avslutad visas berörda bokningar och en bekräftelseruta för automatisk avbokning. Historik och andras bokningar behålls, och åldersregeln gäller fortfarande. Manualen är uppdaterad.
