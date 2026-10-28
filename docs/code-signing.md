# Windows-App signieren (SignPath Foundation)

Die Windows-App kommt nur **signiert** ins Release, weil Microsoft Defender die unsignierte `Hajime.exe` als Schadsoftware meldet (Fehlalarm). Die [SignPath Foundation](https://signpath.org) signiert Open-Source-Projekte kostenlos. Der Build-Workflow (`.github/workflows/build.yml`, Job `windows`) ist dafür vorbereitet und signiert automatisch, sobald die Zugangsdaten unten eingetragen sind. Bis dahin baut er ein unsigniertes Testpaket („Test-Windows-unsigniert“ unter *Actions*), das nicht ins Release kommt.

## 1. Voraussetzungen

- **Zwei-Faktor-Anmeldung** auf GitHub (Pflicht der SignPath Foundation, auch später für das SignPath-Konto).
- Im README steht der Abschnitt **„Code signing policy“** mit dem vorgeschriebenen Satz, den Rollen und der Privacy policy; die Release-Seiten verweisen darauf. Ist erledigt.
- Lizenz MIT (OSI-anerkannt), Projekt wird gepflegt und ist veröffentlicht (Mac- und Webversion).

## 2. Antrag stellen

Formular: <https://signpath.org/apply> (englisch, von HubSpot eingebettet). Unten stehen die Felder in der Reihenfolge des Formulars mit fertigen Einträgen zum Kopieren. Persönliche Angaben (Name, E-Mail) stehen bewusst nicht in dieser öffentlichen Datei.

### Erfolgsaussichten – vorher lesen

Die Foundation prüft, ob ein Projekt **bekannt und vertrauenswürdig** ist (Pflichtfeld *Reputation*) und ob es **schon in der zu signierenden Form veröffentlicht** ist. Stand 28.10.2026 ist Hajime zwei Tage öffentlich, hat 0 Sterne, etwa 7 Downloads und noch keine Windows-Version im Release. Eine Ablehnung oder Rückfrage ist gut möglich. Was die Chancen verbessert:

- Hajime eine Weile bei echten Turnieren und Trainings nutzen und das belegen (Vereinsseite, Turnierbericht, Foto, Erwähnung beim Landesverband).
- Sterne, Downloads, Issues von anderen Vereinen sammeln, z. B. durch einen Hinweis in Judo-Foren oder Vereinsgruppen.
- Die unsignierte Windows-Version zum Testen bereitstellen (liegt nach jedem Build unter *Actions → Test-Windows-unsigniert*).

Ein Antrag schadet nicht; bei Ablehnung kann er später mit mehr Belegen wiederholt werden.

### Felder und Einträge

**Project Name\*** – „A Google search for this name should clearly identify your project.“ „Hajime“ allein ist ein häufiges japanisches Wort, deshalb mit Zusatz:

```
Hajime – Judo Scoreboard
```

**Repository URL\***

```
https://github.com/junky84/hajime
```

**Homepage URL\*** – die README ist die Homepage:

```
https://github.com/junky84/hajime
```

**Download URL** – die Seite muss erwähnen, dass das Projekt SignPath nutzt. Der Abschnitt *Download & Start* der README tut das (die Release-Seiten erst ab dem nächsten Release):

```
https://github.com/junky84/hajime#download--start
```

**Privacy Policy URL**

```
https://github.com/junky84/hajime#privacy-policy
```

**Wikipedia URL (optional)** – leer lassen.

**Tagline\*** – ein Satz, kann auf der Website der Foundation erscheinen:

```
Free, offline judo scoreboard for training, club championships and tournaments – runs in any Chrome/Edge browser or as a desktop app.
```

**Category\*** – Auswahl: Accessibility, AI Tools, Audio, Developer Tools, Educational, Gaming, Graphics, Productivity, Science, Other. Eine Kategorie „Sport“ gibt es nicht:

```
Other
```

**Description\*** – kurzer Absatz, ohne versionsbezogene Funktionen:

```
Hajime is an open-source scoreboard for judo, made for clubs that run trainings, club championships and youth tournaments without dedicated hardware. An operator controls the contest on a laptop while the audience view runs full screen on a second screen or projector. Hajime follows the IJF rules (clock, Golden Score, osaekomi, shido, automatic scoring) with rule profiles per age group, and optionally manages contest lists, tournament brackets, several mats and results. It needs no installation and no internet connection, and is available as a web version for Chrome/Edge and as an Electron desktop app for macOS and Windows.

Note for reviewers: the Windows app is built with Electron/electron-builder. Hajime.exe is the Electron executable renamed and branded by electron-builder (name, icon, version); the application code is in resources/app.asar. If signing Hajime.exe is not allowed under the upstream-binary rule, we would sign only the portable launcher Hajime-x.y.z-Windows-portable.exe.
```

**Reputation\*** – Belege für Verbreitung und Vertrauen. Nur Wahres eintragen; die Lücken in eckigen Klammern selbst füllen oder weglassen:

```
Hajime is a young project (public on GitHub since October 2026) developed for youth judo tournaments of a local club. It has regular releases with automated builds and start tests in GitHub Actions: https://github.com/junky84/hajime/releases
[Where it has been used, e.g. "Used at <club> club championship <date>" – with a link if possible]
[Any mention, e.g. club website, association newsletter, forum thread]
```

**Maintainer Type** – Auswahl: Independent community project, Non-profit foundation …, For-profit company …, Individual maintainer(s), Other:

```
Individual maintainer(s)
```

**Build System\*** – Auswahl: GitHub Actions, GitLab CI/CD:

```
GitHub Actions
```

**First Name\* / Last Name\*** – dein Name; daraus wird das SignPath-Konto angelegt. Er erscheint nicht im Zertifikat (das lautet auf die SignPath Foundation) und nicht im Repository.

**Email\*** – deine E-Mail-Adresse für das SignPath-Konto und die Benachrichtigungen (dort kommen später auch die Freigabe-Anfragen für jedes Release an).

**Company Name** – leer lassen.

**Primary Discovery Channel\*** – Auswahl: Organic search, AI / LLM tools, Developer platforms (e.g. GitHub), Community platforms, Social media, Events, Referral, Direct contact, Other:

```
AI / LLM tools
```

**Please specify the exact source (optional)**

```
Claude (Anthropic)
```

**Häkchen**

- *I have read and agree to the SignPath Foundation Code of Conduct …* (Pflicht) – vorher den verlinkten Code of Conduct lesen.
- *I agree to receive other communications from SignPath.* – freiwillig, nicht nötig.
- *I agree to allow SignPath to store and process my personal data.* (Pflicht).

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
