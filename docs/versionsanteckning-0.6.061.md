# Versionsanteckning – version 0.6.061

Admin och superadmin kan utse och återkalla samordnare via Volontärer → Visa volontärprofil → Gör till samordnare / Ta bort samordnarroll. Åtgärden gäller endast valt katthem och ger inte rätt att utse administratörer eller ändra administratörers roller.

Även tilldelade konton från andra hem stöds: bara den befintliga lokala åtkomsten växlar mellan volontär och samordnare. Ordinarie roll och andra katthems åtkomst bevaras. Åtgärden kontrolleras på servern och loggas i ändringshistoriken. Varken volontärer eller samordnare kan tilldela rollen. Manual och README är uppdaterade.

Testerna omfattar admin/SA, återkallelse, obehöriga användare, skyddade adminroller, tilldelad åtkomst i annat hem och bevarad roll i ursprungshemmet. Två äldre integrationskontroller har stabiliserats: överlappning med datumberoende öppet hus bekräftas uttryckligen, och kontroll av nedladdningsloggen inväntar att serverns ström avslutats.

## Utkast till uppdateringsnyhet

Rubrik: Uppdatering 0.6.061 – admin kan utse samordnare

Både admin och superadmin kan nu utse och ta bort samordnare i volontärprofilen. Ändringen gäller bara det valda katthemmet. Övriga roller och åtkomst till andra katthem behålls. Manualen är uppdaterad.

Publicera en gång för alla katthem efter lyckad push. Sluttid: verklig pushtid plus exakt 72 timmar. Tider är ännu inte fastställda.
