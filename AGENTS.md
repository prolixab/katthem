# Projektets arbets- och publiceringsrutin

- Uppdatera alltid både användarmanualen i public/app.js (portalManual) och relevant dokumentation i README.md när funktioner eller arbetssätt ändras.
- För varje uppdatering som pushas till GitHub: publicera också en kort svensk uppdateringsnyhet på den driftsatta sidan. Summera ändringarna som användarna märker och ange version.
- Registrera den verkliga tidpunkten då pushen lyckas. Nyhetens expires_at ska vara denna tidpunkt plus exakt 72 timmar (259200000 millisekunder), inte tre dagar från första appstart, omstart eller en senare driftsättning. Sätt aldrig en påhittad pushtid i förväg.
- Programuppdateringar gäller normalt alla katthem: använd den befintliga gemensamma nyhetsfunktionen med all_shelters=true, published=true och tom targets-lista. Nyheten visas enligt portalens vanliga regler: på startsidan tills läsaren döljer den, och på Anslagstavlan fram till sluttiden.
- Publicera en nyhet en gång per uppdatering. Kontrollera befintlig version/nyhet före återförsök så att den inte dupliceras eller får förlängd visningstid. Om driftsättningen är försenad räknas fortfarande de 72 timmarna från pushen; publicera inte en redan utgången nyhet.
- Använd autentiserad åtkomst till den riktiga driftsatta installationen. En lokal SQLite-ändring publicerar ingenting på driftservern. Skicka inte någon nyhet eller ange att den har publicerats om driftåtkomst saknas; rapportera hindret och behåll texten som utkast. Spara aldrig inloggningsuppgifter i Git.
- Denna rutin är en arbetsinstruktion, inte en installerad automatisk push- eller publiceringsintegration. Committa/pusha enligt användarens tillstånd; gör inte en push enbart för att denna fil beskriver rutinen.
