# Versionsanteckning – 0.6.063

Admin och SA kan under Administration → Skapa och planera → Automatiska pass för katthemmet stänga av socialiseringsgruppen och den automatiska volontärsträffen separat per katthem. Söndagspassen behåller tider och bokningar som vanliga arbetspass. Kommande automatiska träffar ställs in och nygenerering stoppas; bokningar och historik bevaras. Öppet hus, egna händelser och andra katthem påverkas inte. Återaktivering återupplivar inte redan inställda träffar. Manual och README är uppdaterade.

Verifiering: alla 154 tester passerade, inklusive lokal behörighet, isolering mellan hem, nygenerering, revisionsskydd och bevarade bokningar. Lokal hälsokontroll svarade 200 och visade 0.6.063.

## Utkast till uppdateringsnyhet

Rubrik: Uppdatering 0.6.063 – automatiska pass per katthem

Admin och superadmin kan nu välja om katthemmet ska ha socialiseringsgruppen och automatisk volontärsträff efter öppet hus. Utan socialiseringsgrupp ligger söndagspassen kvar som vanliga arbetspass. Avstängda automatiska träffar ställs in och nya skapas inte. Ändringen gäller bara valt katthem. Manualen är uppdaterad.

Publicera en gång för alla katthem med autentiserad driftåtkomst. Sluttid är verklig lyckad pushtid plus exakt 72 timmar. Kontrollera befintlig nyhet före återförsök; publicera inte en redan utgången nyhet.
