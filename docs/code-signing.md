# Windows-App signieren (SignPath Foundation)

Die Windows-App kommt nur **signiert** ins Release, weil Microsoft Defender die unsignierte `Hajime.exe` als Schadsoftware meldet (Fehlalarm). Die [SignPath Foundation](https://signpath.org) signiert Open-Source-Projekte kostenlos. Der Build-Workflow (`.github/workflows/build.yml`, Job `windows`) ist dafür vorbereitet und signiert automatisch, sobald die Zugangsdaten unten eingetragen sind. Bis dahin baut er ein unsigniertes Testpaket („Test-Windows-unsigniert“ unter *Actions*), das nicht ins Release kommt.

## 1. Voraussetzungen

- **Zwei-Faktor-Anmeldung** auf GitHub (Pflicht der SignPath Foundation, auch später für das SignPath-Konto).
- Im README steht der Abschnitt **„Code signing policy“** mit dem vorgeschriebenen Satz, den Rollen und der Privacy policy; die Release-Seiten verweisen darauf. Ist erledigt.
- Lizenz MIT (OSI-anerkannt), Projekt wird gepflegt und ist veröffentlicht (Mac- und Webversion).

## 2. Antrag stellen

Formular: <https://signpath.org/apply>

Sinnvolle Angaben:

| Feld | Inhalt |
|---|---|
| Projekt | Hajime – Judo-Anzeigetafel |
| Repository | https://github.com/junky84/hajime |
| Homepage / Download | README bzw. https://github.com/junky84/hajime/releases |
| Lizenz | MIT |
| Build | GitHub Actions (GitHub-gehostete Runner), Workflow `.github/workflows/build.yml` |
| Zu signieren | `Hajime.exe` (Programmdatei) und `Hajime-x.y.z-Windows-portable.exe` |

**Wichtig – im Antrag ansprechen:** Hajime ist eine Electron-App. `Hajime.exe` ist die Electron-Programmdatei, die electron-builder umbenennt und mit Name, Symbol und Versionsangaben von Hajime versieht; das Programm selbst steckt in `resources/app.asar`. Die SignPath Foundation signiert grundsätzlich keine fremden („upstream“) Programmdateien. Deshalb fragen, ob `Hajime.exe` signiert werden darf. Falls nicht, wird nur die portable `.exe` signiert (siehe Schritt 4, Variable `SIGNPATH_SIGN_APP`).

Die Prüfung dauert laut Berichten anderer Projekte einige Tage bis einige Wochen.

## 3. Nach der Zusage: SignPath einrichten

1. SignPath-Konto anlegen (mit Zwei-Faktor-Anmeldung), in die Organisation der Foundation aufnehmen lassen.
2. **Trusted Build System:** „GitHub.com“ hinzufügen und dem Projekt zuordnen (damit SignPath prüfen kann, dass die Dateien aus diesem Repository gebaut wurden).
3. **Projekt** mit dem Slug `hajime` anlegen (anderer Slug geht auch, dann Variable unten setzen) und mit dem Repository verknüpfen.
4. **Artefaktkonfigurationen** anlegen und den Inhalt dieser Dateien einfügen:
   - Slug `hajime-app` ← `.signpath/artifact-configurations/hajime-app.xml`
   - Slug `hajime-portable` ← `.signpath/artifact-configurations/hajime-portable.xml`
5. **Signing policy** `release-signing` mit dem Zertifikat der Foundation; Approver: junky84 (jede Signatur wird von Hand freigegeben).
6. Einen **CI-Benutzer** mit der Rolle *Submitter* für die Signing policy anlegen und für ihn ein **API-Token** erzeugen.

## 4. Zugangsdaten in GitHub eintragen

Repository → *Settings → Secrets and variables → Actions*:

| Art | Name | Wert |
|---|---|---|
| Secret | `SIGNPATH_API_TOKEN` | API-Token des CI-Benutzers |
| Variable | `SIGNPATH_ORGANIZATION_ID` | Organisations-ID aus SignPath (schaltet das Signieren ein) |
| Variable (optional) | `SIGNPATH_PROJECT_SLUG` | nur wenn nicht `hajime` |
| Variable (optional) | `SIGNPATH_SIGNING_POLICY_SLUG` | nur wenn nicht `release-signing` |
| Variable (optional) | `SIGNPATH_SIGN_APP` | `false`, falls SignPath `Hajime.exe` nicht signieren darf |

## 5. Release

Wie bisher: Version in `package.json` setzen, `git tag vX.Y.Z && git push origin vX.Y.Z`.

Der Windows-Job baut die App, schickt `Hajime.exe` und danach die portable `.exe` an SignPath und **wartet auf die Freigabe** (Mail bzw. SignPath-Webseite, bis zu 3 Stunden). Danach prüft er die Signaturen, startet beide Pakete zur Probe und hängt sie ans Release. Wird nicht freigegeben, erscheint das Release trotzdem – ohne Windows.

Hinweis: Ein signiertes Programm baut seinen Ruf bei Microsoft SmartScreen erst mit der Zeit auf. In den ersten Wochen kann beim Start noch „Der Computer wurde durch Windows geschützt“ erscheinen (*Weitere Informationen → Trotzdem ausführen*); die Virenwarnung von Defender sollte mit der Signatur aber entfallen.
