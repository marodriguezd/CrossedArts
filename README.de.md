<div align="center">
  <img src="frontend/public/favicon.svg" alt="CrossedArts-Logo" height="96" />
</div>

# CrossedArts - Learning Operating System

[![Deploy to GitHub Pages](https://github.com/marodriguezd/CrossedArts/actions/workflows/deploy.yml/badge.svg)](https://github.com/marodriguezd/CrossedArts/actions/workflows/deploy.yml)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

**Live-Anwendung:** [https://marodriguezd.github.io/CrossedArts/](https://marodriguezd.github.io/CrossedArts/)

[English](README.md) · [Español](README.es.md) · Deutsch · [Français](README.fr.md) · [Italiano](README.it.md) · [中文](README.zh.md)

---

## Was es ist

CrossedArts ist eine persönliche, **Local-First- visuelle Lern- und Wissensplattform**, die vollständig im Browser läuft. Sie bringt Kurse, Bücher, importierte Dokumente, Notizen, Konzepte und die Arbeiten, die du erstellst, in eine Umgebung — alles in einer lokalen SQLite-Datenbank gespeichert, ohne erforderlichen Backend-Server.

Alles ist so organisiert, wie Lernende tatsächlich lernen: eine **Dashboard**-Galerie dessen, was du lernst, ein **Wissensgraph**, wie diese Teile zusammenhängen, eine **Berg**-Fortschrittsansicht eines Lernkontexts und **praktische Arbeiten**, die festhalten, was du erstellt hast. Es ist bewusst **domänenneutral**: Es funktioniert gleich für Mathematik, Musik, Programmierung oder Kunst.

Die Anwendung richtet sich an Lernende, die die volle Hoheit über ihre Lerndaten behalten wollen, ohne von Cloud-Diensten oder Abonnements abhängig zu sein.

## Funktionen

- **Dashboard-Galerie:** Ein kuratierter, visueller Einstieg in dein Lernen — Kurse, Bücher, importierte Dokumente und praktische Arbeiten, gruppiert nach Zweck (weiter lernen, importierte Ressourcen, praktische Arbeiten)
- **Heute / Fokus:** Eine einzige, deterministische Antwort auf „Was soll ich jetzt tun?" — die nächste Lektion, fällige Wiederholungen, offene praktische Arbeiten, unerfüllte Ziele und kürzlich studierte Ressourcen, jeweils mit dem Grund der Auflistung
- **Kurse & Lektionen:** Hierarchische Kursstruktur mit Modulen, Lektionen und editierbarem Markdown-Inhalt
- **Bücher & Ressourcen:** Bibliothekskatalog mit Lesefortschritt, importierten Dokumenten (PDF, EPUB, TXT, MD) und Ressourcenorganisation
- **Lernsitzungen:** Vereinheitlichte Karteikartenwiederholung (SM-2), Übungsfragen und gemischte Modi mit lokalem Fortschrittstracking
- **Praktische Arbeiten:** Übungen, Projekte, Essays, Zeichnungen oder Code, die du erstellst, verlinkt mit der Ressource, Lektion oder dem Konzept, das sie demonstrieren — in jeder Disziplin. Jeder Eintrag öffnet einen **Praxis-Arbeitsbereich** mit Markdown-Inhalt, persistierter Checkliste, Selbstbewertung und dem zugehörigen Kontext
- **Lernziele:** Explizite, anwenderdefinierte Ziele (Kurs, Buch, Praxis, Gewohnheit) mit Zieldaten; Zielfortschritt wird nur aus gemessenem Fortschritt abgeleitet, niemals erfunden
- **Analytik:** Tägliche Lernserien, Genauigkeit, Aktivität pro Ressource, Bereichsvergleich (7/30/90 Tage/alle) und Streak — berechnet aus echten Lernsitzungen und Wiederholungen
- **Wissensgraph:** Interaktive 2D-Visualisierung von Kursen, Büchern, Modulen, Lektionen, Notizen, Konzepten, praktischen Arbeiten und ihren Beziehungen, plus **struktureller Analytik** (Grad, Komponenten, schwach verbundene und kürzlich berührte Knoten), die Topologie beschreibt und niemals Wichtigkeit rankt
- **Bergfortschritt:** Eine Reiseanzeige, global oder auf einen Kurs bezogen, mit echtem gemessenem Fortschritt und echten Kursmodulen als Meilensteinen
- **Kurspakete:** Exportiert das *Bildungsmaterial* einer Ressource (Lehrplan und vorgeschlagene Arbeit, niemals deinen Fortschritt oder Notizen) als portables JSON-Paket zum Teilen und additiven Importieren
- **Lokale Medien:** Video- und Audiowiedergabe aus lokalen Ordnern via File System Access API
- **Lokale Suche:** Deterministische SQL-basierte Suche über alle Inhalte, plus globale Befehlspalette (Strg+K)
- **Dokumenteningestion:** In-Browser-Parsing von PDF-, EPUB-, TXT- und MD-Dateien mit SHA-256-Deduplizierung
- **KI-Anbieter:** Lokale On-Device-Inferenz (WebLLM/WebGPU), heuristischer Demo-Modus, Ollama oder OpenAI-API. Antworten tragen **Quellenzitate** zurück zur exakten Ressource, Lektion oder Notiz, in der sie verankert sind, plus Anbieter und Modell, die sie erzeugt haben
- **Sicherung & Export:** Binärer SQLite-Export/-Import und JSON-Sicherung mit Schemavalidierung
- **PWA:** Offline-fähige App-Shell mit Service-Worker-Caching

## Local-First-Modell

CrossedArts nutzt eine duale Speicherarchitektur:

- **SQLite WASM** (`sql.js`): Die kanonische relationale Datenbank im Browser. Speichert alle Lerndaten — Kurse, Lektionen, Notizen, Karteikarten, Konzepte, Sitzungen und Ressourcen.
- **IndexedDB**: Persistenzschicht, die Browser-Neustarts überlebt. Die SQLite-Datenbank wird bei jeder Mutation nach IndexedDB serialisiert.

**Was ohne Backend funktioniert:**
- Alle Lernaktivitäten (Kurse, Lektionen, Notizen, Karteikarten, Lernsitzungen)
- Lokale Medienwiedergabe
- Dokumenteningestion und Suche
- Wissensgraph-Visualisierung
- Sicherung und Wiederherstellung

**Was Netzwerkzugang erfordert:**
- Erster Download lokaler KI-Modelle (WebLLM-Gewichte, Embedding-Modell)
- OpenAI-API-Aufrufe (opt-in)
- Ollama-Verbindung (opt-in, lokaler Server)

## KI & Suche

CrossedArts unterstützt vier KI-Anbietermodi:

| Modus | Beschreibung | Netzwerk erforderlich |
|------|-------------|-----------------|
| **Lokal (WebLLM)** | On-Device-Inferenz via WebGPU. Modelle: Qwen3 1.7B (Standard), Llama 3.2 1B, SmolLM2 1.7B, Qwen3 0.6B | Nur erster Download |
| **Demo** | Heuristische Antworten auf Basis lokaler Inhalte. Kein KI-Modell geladen | Nein |
| **Ollama** | Verbindet sich mit einem lokalen Ollama-Server unter `http://localhost:11434` | Lokales Netzwerk |
| **OpenAI** | Nutzt OpenAI-API mit In-Memory-Schlüsselspeicherung | Ja |

**Embeddings & RAG:**
- Lokale Embeddings via Transformers.js mit `onnx-community/embeddinggemma-300m-ONNX` (768 native Dimensionen, gespeichert als 256d via Matryoshka Representation Learning)
- Hybrides Retrieval aus lexikalischer Suche und semantischen Embeddings
- Vektoren in IndexedDB gecacht mit SHA-256-Content-Hashing und Pipeline-Versionierung (`v2.0-embeddinggemma-mrl256-sha256`)
- Sämtliche Embedding-Berechnung geschieht auf dem Gerät; die Browser-Integration nutzt den verifizierten ONNX-EmbeddingGemma-300M-Export und bevorzugt derzeit WASM aus Korrektheitsgründen

## Fortschrittssemantik

CrossedArts trackt mehrere verschiedene Dinge, die alle „Fortschritt" heißen. Sie werden niemals still vermischt: Gemessener Fortschritt (abgeschlossene Lektionen, gelesene Seiten) wird als Prozentwert gezeigt; grober Status (`not started` / `in progress` / `completed`) wird als Status gezeigt und niemals als erfundener Prozentwert. Praxisabschluss, Konzeptbeherrschung und Lernaktivität sind eigene Konzepte mit eigener Bedeutung.

Die vollständigen Regeln — einschließlich welches Artefakt an Galerie, Graph, Berg und Kurspaketen teilnimmt — sind in [`docs/PROGRESS.md`](docs/PROGRESS.md) dokumentiert.

## Einschränkungen

- **Kein vollwertiges LMS:** CrossedArts hat keine Klassen, Einschreibung, Benotung, Lehrerkonten oder Fernunterricht. Kurspakete sind portables *Bildungsmaterial*, kein Managementsystem.
- **Browserunterstützung:** Chrome, Edge oder Brave für lokale Medienfunktionen erforderlich (File System Access API). Andere Browser können alle Nicht-Medienfunktionen nutzen.
- **Lokale KI-Hardware:** WebGPU-fähige GPU für lokale LLM-Inferenz empfohlen. CPU-Fallback ist verfügbar, aber langsamer.
- **Erster Download:** Die erste Nutzung lokaler KI erfordert das Herunterladen von Modellgewichten; das Embedding-Modell wird bei Bedarf abgerufen und vom Browser gecacht.
- **Mediensicherung:** Lokale Mediendateien sind nicht in SQLite-Sicherungen enthalten. Nur die Datenbank wird gesichert; Medien müssen nach Wiederherstellung neu verlinkt werden.
- **Keine automatische Synchronisierung:** Multi-Geräte-Synchronisierung ist nicht eingebaut. Export/Import ist der manuelle Übertragungsmechanismus.
- **Einzelanwender:** Keine Mehranwenderunterstützung oder Authentifizierung.

## Schnellstart

### Voraussetzungen

- Node.js v22 oder höher (die Testsuite nutzt `--experimental-strip-types`)
- Chrome-, Edge- oder Brave-Browser

### Installation & Entwicklung

```bash
git clone https://github.com/marodriguezd/CrossedArts.git
cd CrossedArts/frontend
npm install
npm run dev
```

`http://localhost:5173` im Browser öffnen.

### Testen

```bash
cd frontend
npm test
```

Die Testsuite umfasst 715 Tests in 63 Testdateien zu SQLite-Initialisierung, SM-2-Algorithmus, Lernsitzungen, Wissensgraph (einschließlich struktureller Analytik), RAG- und Zitationsprovenienz, Dokumenteningestion, KI-Anbietern, Lernartefakt-Projektion, Berg-Scoping, Kurspaket-Konflikten, Lernzielen, Analytik, Fokusplanung, Praxis-Arbeitsbereich, WCAG-Designkontrast und Disabled-State-Lesbarkeit.

#### Visuelles & responsives QA (für Deployment Pflicht, lokal optional)

Der Render-Layer wird programmatisch mit Playwright gegen den Produktionsbuild verifiziert — drei Viewports (Desktop 1280×800, Tablet 834×1112, Mobil 390×844), mit Prüfung auf horizontalen Overflow, Konsolenfehler, erwartete Überschriften pro Ansicht, Befehlspalette, Designumschalter und Praxis-Arbeitsbereich:

```bash
cd frontend
npx playwright install chromium   # einmalig
npm run build
npm run preview:qa &             # serviert den Build auf 127.0.0.1:4173
QA_URL=http://127.0.0.1:4173 npm run qa:visual
```

Screenshots werden nach `/tmp/crossedarts-qa` geschrieben (niemals committet). Der Runner exitt nicht-null, wenn ein objektiver Check scheitert.

Diese Suite auf der eigenen Maschine auszuführen ist optional — `npm test` deckt das funktionale Verhalten ab. **Sie zu bestehen ist nicht optional**: Sie läuft gegen den exakten Produktionsbuild, der publiziert wird, und der `Deploy to Pages`-Job deklariert `needs: [build-frontend, validate-backend]`, sodass ein scheiternder Visual-QA-Check das Deployment auf GitHub Pages blockiert. Sie läuft außerdem bei jedem Pull Request gegen `main` und manuell via `workflow_dispatch`.

> [!WARNING]
> `npm run preview:qa` statt `npm run preview -- --port …` verwenden: npm reicht nachgestellte Argumente nicht an Vite weiter, sodass Port- und `--strictPort`-Flags stillschweigend verworfen würden.

### Build

```bash
cd frontend
npm run build
```

Produktionsassets werden in `frontend/dist/` erzeugt.

## Architektur

CrossedArts ist ein Monorepo mit zwei unabhängigen Komponenten:

- **`frontend/`**: React-19- + TypeScript- + Vite-Single-Page-Anwendung. Deployt auf GitHub Pages.
- **`backend/`**: Optionaler Python-FastAPI-Server für Batch-Ingestion und erweiterte Analyse.

Das Frontend ist ohne Backend voll funktionsfähig. Das Backend stellt zusätzliche Dienste für schwere Verarbeitungsworkflows bereit.

## Backend-Begleiter

Das optionale Python-Backend stellt bereit:

- Batch-Dokumenteningestion (PDF, EPUB)
- Metadatenextraktion und Thumbnail-Generierung
- Sentence-Transformers-Embeddings
- LangChain-LLM-Workflows

Setup:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
PYTHONPATH=. alembic -c backend/alembic.ini upgrade head
python -m backend.app.main
```

Der API-Server läuft unter `http://127.0.0.1:8080` mit interaktiver Dokumentation unter `/docs`.

### Netzwerkexposition ist Opt-in

> [!CAUTION]
> Die API hat **keine Authentifizierung** und ist für lokale Nutzung gedacht. Sie bindet standardmäßig an
> `127.0.0.1`, und ein Start auf einer Nicht-Loopback-Schnittstelle (z. B.
> `HOST=0.0.0.0`) wird **verweigert**, sofern nicht explizit
> `ALLOW_NETWORK_ACCESS=true` gesetzt ist. Das Aktivieren dieses Flags exponiert eine schreibfähige,
> unauthentifizierte API an dein Netzwerk; bei Bedarf den Port mit Firewall oder
> Reverse-Proxy beschränken. Bei Ollama-Nutzung `OLLAMA_ORIGINS` auf den exakten
> Origin setzen (z. B. `http://localhost:5173`) statt auf `"*"`.

## Datensicherung

In der Einstellungsansicht:

- **SQLite exportieren:** Eine standardmäßige `.sqlite`-Datenbankdatei herunterladen
- **SQLite importieren:** Aus einer früheren `.sqlite`-Sicherung wiederherstellen
- **JSON exportieren:** Einen strukturierten Dump aller Tabellen erzeugen
- **JSON importieren:** Aus einer JSON-Sicherung wiederherstellen (vor Änderungen validiert)

## Hinweise zu Drittanbietern

Drittanbieter-Abhängigkeiten behalten ihre jeweiligen Lizenzen:
- `onnx-community/embeddinggemma-300m-ONNX`: Gemma-Nutzungsbedingungen
- `Xenova/multilingual-e5-small`: MIT
- WebLLM (`@mlc-ai/web-llm`): Apache-2.0
- Transformers.js (`@huggingface/transformers`): Apache-2.0
- SQLite WASM (`sql.js`): MIT
