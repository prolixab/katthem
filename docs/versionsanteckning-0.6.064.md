# Versionsanteckning – 0.6.064

Personer med tilldelad åtkomst till flera katthem har gemensamma profiluppgifter, inklusive styrelseroll och uppdrag. Redigera via Volontärer → Visa profil → Gemensamma profiluppgifter. Vanliga profilformuläret behåller lokala anteckningar och inställningar. Behörighet, introduktion, grönmarkering, engagemang och bokningar förblir lokala. Befintliga lokala avvikelser i gemensamma fält ersätts av ordinarie profil när hemmet öppnas. Konton länkas inte genom enbart samma e-post.

Volontärsidan visar antal aktiva volontärer per tillgängligt katthem, inklusive administratörer. En person med explicit tilldelad åtkomst räknas i respektive hem. Implicit global SA-åtkomst räknas inte som lokalt volontärengagemang. Manual och README är uppdaterade. En onboarding för samordnare finns som PDF med tre sidor.

## Utkast till uppdateringsnyhet

Rubrik: Uppdatering 0.6.064 – gemensamma profiler och volontärantal

Volontärer som har tilldelad åtkomst till flera katthem får gemensamma profiluppgifter, styrelseroll och uppdrag. Uppdatera en gång via Gemensamma profiluppgifter i profilkortet. Behörigheter och introduktion följer fortfarande varje katthem. På Volontärer visas också antal aktiva volontärer per katthem. Manualen är uppdaterad.

Publicera en gång för alla katthem med autentiserad driftåtkomst. Sluttid är verklig lyckad pushtid plus exakt 72 timmar. Kontrollera befintlig nyhet före återförsök. Pushtid registreras först när GitHub-pushen lyckas.

## Verifiering

155 tester verifierade. Den fullständiga körningen gav 154 godkända tester och en manualtextkontroll som efter korrigering passerade i riktad omkörning. Integrationskontroller täcker tvåvägsredigering, revisioner, administratörsskydd, separata lokala roller, skyddade personuppgifter, gallring och volontärantal. Lokal hälsokontroll svarade 200; profilredigerare och antalsvisning kontrollerades i webbläsare utan konsolfel. PDF-guiden har tre visuellt kontrollerade sidor.
