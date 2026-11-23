# Versionsanteckning – version 0.6.052

CSV-importen hoppar över befintliga e-postadresser och fortsätter med nya volontärer. Om samma nya adress upprepas i filen används första raden. Förhandsgranskningen och slutresultatet visar nya och överhoppade rader med orsak. Kontrollerna görs igen i skrivtransaktionen vid import. Befintliga konton, lösenord, roller och checklistkryss ändras inte och inga nya välkomstinbjudningar skapas för dem. Felaktiga CSV-värden stoppar fortfarande importen före kontoskapande.

Tillfälliga konton vars adress slutar på .local kan importeras men får inga välkomstmejl, återställningsmejl, passpåminnelser eller ändrings-/inställelsemejl. Gmail och Resend har ett extra stopp för sådana mottagare. Redan köade ändringsmejl till .local skickas inte och räknas inte som väntande eller misslyckade.

Manualen och README är uppdaterade. Ingen uppdateringsnyhet publiceras denna gång enligt användarens önskemål.

## Utkast till uppdateringsnyhet

Rubrik: Uppdatering 0.6.052 – enklare CSV-import och lokala testkonton

Vid CSV-import hoppas redan kända e-postadresser över och importen fortsätter med nya volontärer. Förhandsgranskningen och resultatet visar vilka rader som hoppats över. Befintliga konton ändras inte. Tillfälliga konton med adresser som slutar på .local kan importeras men får inga mejlutskick. Manualen är uppdaterad.
