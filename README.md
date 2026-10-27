# Hajime

**Judo-Anzeigetafel** für Wettkämpfe – **ohne Installation**: als App für macOS und als **Webversion** für Chrome/Edge (Windows, Linux, Mac – ganz ohne Programmdatei).

- **Publikumsanzeige** im Vollbild auf dem zweiten Bildschirm/Beamer (erweiterter Desktop)
- **Bedienfenster** auf dem Laptop mit Live-Vorschau der Anzeige
- Namen optional, manuell oder per **Excel-Import**
- **Regelprofile** pro Altersklasse (Kampfzeit, Golden Score, „Ippon beendet den Kampf“ ja/nein, Yuko, Shido-Grenze, Osaekomi-Zeiten …)

## Screenshots

**Publikumsanzeige** (Vollbild auf Beamer/zweitem Bildschirm)

| Kampf läuft mit Osaekomi | Kampfende mit Sieger |
|---|---|
| ![Anzeige während Osaekomi](docs/screenshots/anzeige-osaekomi.png) | ![Anzeige mit Sieger](docs/screenshots/anzeige-sieger.png) |
| **Golden Score** | **Pausenbild mit den nächsten Kämpfen** |
| ![Anzeige Golden Score](docs/screenshots/anzeige-golden-score.png) | ![Pausenbild](docs/screenshots/anzeige-pausenbild.png) |

**Bedienfenster** (Laptop)

![Bedienfenster während des Kampfes](docs/screenshots/bedienung-kampf.png)

| Kampfliste & Teilnehmer (Excel-Import, Jeder gegen jeden) | Einstellungen & Regelprofile |
|---|---|
| ![Kampfliste](docs/screenshots/bedienung-kampfliste.png) | ![Einstellungen](docs/screenshots/bedienung-einstellungen.png) |

Alle Namen in den Screenshots sind erfunden (aus der [Beispiel-Excel](beispiel/Beispiel-Teilnehmer-20.xlsx)).

## Download & Start

Die fertigen Dateien liegen unter **Releases**.

| System | Datei | Start |
|---|---|---|
| **Windows** (und jedes andere System mit Chrome/Edge) | `Hajime-x.y.z-Web.zip` | Entpacken, `Hajime starten.html` öffnen. Keine Programmdatei, läuft offline – siehe [Webversion](#webversion-ohne-exe). |
| **macOS** (Apple Silicon + Intel) | `Hajime-x.y.z-Mac.zip` | Entpacken, `Hajime.app` starten. |

**macOS, erster Start** (die App ist nicht kostenpflichtig signiert): Meldung „kann nicht geöffnet werden“ → *Systemeinstellungen → Datenschutz & Sicherheit* → ganz unten *Dennoch öffnen*.
Alternativ im Terminal: `xattr -cr /Pfad/zu/Hajime.app`

<details>
<summary><b>Windows-Programm (.exe) – experimentell</b></summary>

Jeder Build erzeugt auch eine Windows-Version (`Hajime-x.y.z-Windows-portable.exe` und `Hajime-x.y.z-Windows.zip`). Sie wird automatisch auf einem Windows-Rechner gestartet und geprüft, liegt aber **nicht im Release**, sondern nur als Build-Ergebnis unter **Actions** → letzter erfolgreicher Lauf → *Artifacts* → `Hajime-Windows`.

Grund: Die .exe ist nicht signiert. Windows Defender stuft solche neuen, unbekannten Programme teils als Bedrohung ein (z. B. „Trojan:Win32/Cinjo.O!cl“, ein Fehlalarm der Cloud-Erkennung). Auf Firmen- oder Schulrechnern landet das bei der IT. Die Webversion hat dieses Problem nicht.

Die portable Version speichert ihre Daten im Ordner `Hajime-Daten` neben der .exe.
</details>

### Webversion (ohne .exe)

Für Rechner, auf denen keine fremden Programme laufen dürfen oder der Virenscanner unsignierte Programme blockiert. Die Webversion ist dieselbe App, läuft aber im Browser – es wird nichts ausgeführt außer der Webseite.

1. `Hajime-x.y.z-Web.zip` entpacken und `Hajime starten.html` in **Chrome oder Edge** öffnen (Internet ist nicht nötig).
2. *Anzeige öffnen* klicken und Pop-ups erlauben, falls der Browser fragt.
3. Beim ersten Mal fragt der Browser, ob die Seite **Fenster auf allen Bildschirmen verwalten** darf. Mit *Zulassen* erscheint oben eine Bildschirmauswahl und die Anzeige landet automatisch auf dem Beamer. Ohne Erlaubnis das Fenster von Hand hinüberziehen.
4. Im Anzeigefenster **einmal klicken** (Browser geben den Ton erst nach einem Klick frei – bis dahin steht dort ein roter Hinweis) und **doppelklicken** für Vollbild.

Daten (Einstellungen, Kampfliste, Protokoll) speichert der Browser. Für einen anderen Rechner unter *Einstellungen* eine Sicherung speichern und dort laden.

Der Ordner kann auch auf jeden Webserver gelegt werden. Dann lässt sich Hajime in Chrome/Edge über das Installieren-Symbol in der Adressleiste wie eine App anlegen und läuft nach dem ersten Aufruf auch offline. Getestet ist die Webversion mit Chromium (Chrome/Edge). Firefox und Safari sollten grundsätzlich laufen, können die Anzeige aber nicht selbst auf den zweiten Bildschirm schieben.

## Bedienung

1. App starten – die Anzeige öffnet sich automatisch im Vollbild auf dem zweiten Bildschirm (ist keiner angeschlossen: als Fenster). Oben rechts kann der Bildschirm gewechselt werden.
2. Namen eintragen (optional) oder Kampfliste laden, *Hajime* drücken.
3. Nach dem Kampf *Nächster Kampf* (Taste `N`) – das Ergebnis landet automatisch im Protokoll.

### Tastenkürzel

| Taste | Aktion |
|---|---|
| `Leertaste` | Hajime / Mate (nach Zeitende bei Gleichstand: Golden Score starten) |
| `A` / `L` | Osaekomi Weiß / Blau (nochmal drücken = Toketa) |
| `T` | Toketa |
| `Q` `W` `E` `R` | Weiß: Ippon, Waza-ari, Yuko, Shido |
| `U` `I` `O` `P` | Blau: Ippon, Waza-ari, Yuko, Shido |
| `Shift` + Wertungstaste | Wertung abziehen |
| `↑` / `↓` | Uhr ±1 Sekunde |
| `Strg/⌘ + Z` | Rückgängig |
| `N` | Nächster Kampf |
| `B` | Pausenbild (Turniername, Logo, nächste Kämpfe) an/aus |

Im Anzeigefenster: Doppelklick oder `F` = Vollbild an/aus.

### Was die Tafel automatisch macht

- Kampfzeit, Golden Score (optional mit Höchstdauer → danach Kampfrichterentscheid)
- Osaekomi-Uhr mit automatischer Wertung (Standard: 5 s Yuko, 10 s Waza-ari, 20 s Ippon), läuft nach Zeitende weiter
- 2× Waza-ari = Ippon, 3. Shido = Hansoku-make (abschaltbar)
- Sieger nach Zeitende über die Wertungen; große Einblendung der Wertung auf der Anzeige
- Gong bei Zeit- und Kampfende (wahlweise am Bedienrechner oder über die Anzeige)
- Manuelle Entscheidungen: Hantei, Kiken-gachi, Fusen-gachi, Disqualifikation, Unentschieden
- Alles wird laufend gespeichert und nach einem Absturz/Neustart wiederhergestellt

## Excel-Import

Im Reiter **Kampfliste** gibt es *Excel-Vorlage speichern*. Die Vorlage hat zwei Blätter – eines reicht:

- **Kampfliste** – fertige Paarungen: `Nr`, `Altersklasse`, `Gewichtsklasse`, `Weiß Name`, `Weiß Verein`, `Blau Name`, `Blau Verein`
- **Teilnehmer** – nur Namen: `Vorname`, `Nachname` (oder `Name`), `Verein`, `Altersklasse`, `Gewichtsklasse`.
  Daraus erzeugt die App pro Gruppe „Jeder gegen jeden“.

Die Spalten werden an den Überschriften erkannt, die Reihenfolge ist egal. CSV geht auch.

Zum Ausprobieren: [`beispiel/Beispiel-Teilnehmer-20.xlsx`](beispiel/Beispiel-Teilnehmer-20.xlsx) – 20 erfundene Kämpfer in 5 Gruppen (U11–U15), ergibt mit „Alle Gruppen: Jeder gegen jeden“ 31 Kämpfe.
Die **Altersklasse** wählt beim Laden eines Kampfes automatisch das passende Regelprofil (Name oder Alias, z. B. „U12, U13“).

## Regelprofile

Unter **Einstellungen → Regelprofile**. Mitgeliefert: U11, U13, U15, U18, Erwachsene, Masters.
Die Kampfzeiten sind Vorschläge – bitte mit der jeweiligen Ausschreibung abgleichen.
Für U11/U13 ist „Ippon beendet den Kampf“ ab Werk ausgeschaltet; es zählt dann die Anzahl der Wertungen nach Ablauf der Zeit.

## Entwicklung

```bash
npm install
npm start        # App starten
npm test         # Tests der Wettkampflogik und des Excel-Imports
npm run build:web   # Webversion nach dist/Hajime-Web bauen
HAJIME_SCREENSHOTS=docs/screenshots npx electron .   # README-Screenshots neu erzeugen
```

Aufbau:

- `main.js` – Electron-Hauptprozess (Fenster, Bildschirme, Vollbild)
- `src/js/core.js` – Wettkampfregeln, ohne Oberfläche, mit Tests in `test/`
- `src/js/render.js` + `src/css/board.css` – Anzeigetafel (auch als Vorschau im Bedienfenster)
- `src/js/control.js` – Bedienfenster
- `src/js/excel.js` – Import/Export (SheetJS liegt lokal in `src/vendor/`, funktioniert offline)
- `src/js/transport.js` – Verbindung der Fenster: Electron-IPC oder im Browser Pop-up + `postMessage`
- `scripts/build-web.js` – Webversion (Startseite, Web-App-Manifest, Offline-Speicher)

### Neue Version veröffentlichen

```bash
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions baut dann Windows-, Mac- und Webversion, startet sie zur Probe und hängt Mac- und Webversion an ein neues Release (Windows nur unter Actions, siehe oben).

## Hinweis

Diese App wurde mit Unterstützung von KI (Claude, Anthropic) entwickelt.

## Lizenz

MIT – siehe [LICENSE](LICENSE).
