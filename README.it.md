<div align="center">
  <img src="frontend/public/favicon.svg" alt="logo CrossedArts" height="96" />
</div>

# CrossedArts - Learning Operating System

[![Deploy to GitHub Pages](https://github.com/marodriguezd/CrossedArts/actions/workflows/deploy.yml/badge.svg)](https://github.com/marodriguezd/CrossedArts/actions/workflows/deploy.yml)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

**Applicazione live:** [https://marodriguezd.github.io/CrossedArts/](https://marodriguezd.github.io/CrossedArts/)

[English](README.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · Italiano · [中文](README.zh.md)

---

## Cos'è

CrossedArts è una piattaforma personale, **locale prima di tutto, visiva, di apprendimento e conoscenza** che gira interamente nel browser. Riunisce corsi, libri, documenti importati, note, concetti e i lavori che produci in un unico ambiente — tuttoarchiviato in un database SQLite locale senza server di backend richiesto.

Tutto è organizzato come uno studente studia davvero: una galleria **Dashboard** di ciò che stai imparando, un **grafo di conoscenza** di come quei pezzi si relazionano, una vista **montagna** dell'avanzamento di un contesto di apprendimento, e **lavori pratici** che registrano ciò che hai prodotto. È deliberatamente **neutrale al dominio**: funziona uguale per matematica, musica, programmazione o arte.

L'applicazione è pensata per studenti che vogliono la piena proprietà dei propri dati di studio senza dipendere da servizi cloud o abbonamenti.

## Funzionalità

- **Galleria Dashboard:** un punto di ingresso visivo e curato al tuo apprendimento — corsi, libri, documenti importati e lavori pratici, raggruppati per scopo (continua a imparare, risorse importate, lavori pratici)
- **Oggi / Focus:** una risposta singola e deterministica a "cosa devo fare ora?" — la prossima lezione, i ripassi dovuti, i lavori pratici in sospeso, gli obiettivi non raggiunti e le risorse studiate di recente, ciascuno con il motivo per cui è elencato
- **Corsi & Lezioni:** struttura gerarchica dei corsi con moduli, lezioni e contenuto Markdown modificabile
- **Libri & Risorse:** catalogo biblioteca con avanzamento lettura, documenti importati (PDF, EPUB, TXT, MD) e organizzazione risorse
- **Sessioni di studio:** ripasso flashcard unificato (SM-2), domande di pratica e modalità miste con tracciamento locale dell'avanzamento
- **Lavori pratici:** esercizi, progetti, saggi, disegni o codice che produci, collegati alla risorsa, lezione o concetto che dimostrano — in qualsiasi disciplina. Ogni elemento apre un **workspace pratico** con contenuto Markdown, checklist persistita, autovalutazione e il suo contesto
- **Obiettivi di apprendimento:** obiettivi espliciti definiti dall'utente (corso, libro, pratica, abitudine) con date target; l'avanzamento obiettivi è derivato solo da avanzamento misurato, mai inventato
- **Analitica:** serie di studio giornaliere, accuratezza, attività per risorsa, confronto intervalli (7/30/90 giorni/tutto) e streak — calcolati da vere sessioni di studio e ripassi
- **Grafo di conoscenza:** visualizzazione 2D interattiva di corsi, libri, moduli, lezioni, note, concetti, lavori pratici e loro relazioni, più **analitica strutturale** (grado, componenti, nodi debolmente connessi e toccati di recente) che descrive la topologia e non classifica mai l'importanza
- **Avanzamento montagna:** un indicatore di percorso, globale o centrato su un corso, con vero avanzamento misurato e veri moduli del corso come traguardi
- **Pacchetti corso:** esporta il *materiale didattico* di una risorsa (programma e lavoro proposto, mai il tuo avanzamento o le tue note) come pacchetto JSON portabile da condividere e importare additivamente
- **Media locali:** riproduzione video e audio da cartelle locali via File System Access API
- **Ricerca locale:** ricerca deterministica SQL su tutti i contenuti, più palette comandi globale (Ctrl+K)
- **Ingestione documenti:** parsing nel browser di file PDF, EPUB, TXT e MD con deduplicazione SHA-256
- **Provider IA:** inferenza locale on-device (WebLLM/WebGPU), modalità demo euristica, Ollama o API OpenAI. Le risposte portano **citazioni delle fonti** alla risorsa, lezione o nota esatta su cui sono fondate, più provider e modello che le hanno prodotte
- **Backup & Export:** export/import SQLite binario e backup JSON con validazione schema
- **PWA:** app shell capace offline con caching service worker

## Modello locale prima di tutto

CrossedArts usa un'architettura di storage duale:

- **SQLite WASM** (`sql.js`): il database relazionale canonico nel browser. Archivia tutti i dati di apprendimento — corsi, lezioni, note, flashcard, concetti, sessioni e risorse.
- **IndexedDB**: livello di persistenza che sopravvive ai riavvii del browser. Il database SQLite è serializzato in IndexedDB a ogni mutazione.

**Cosa funziona senza backend:**
- Tutte le attività di apprendimento (corsi, lezioni, note, flashcard, sessioni di studio)
- Riproduzione media locali
- Ingestione documenti e ricerca
- Visualizzazione grafo di conoscenza
- Backup e ripristino

**Cosa richiede accesso rete:**
- Download iniziale dei modelli IA locali (pesi WebLLM, modello embedding)
- Chiamate API OpenAI (opt-in)
- Connessione Ollama (opt-in, server locale)

## IA & Ricerca

CrossedArts supporta quattro modalità di provider IA:

| Modalità | Descrizione | Rete richiesta |
|------|-------------|---------------|
| **Locale (WebLLM)** | Inferenza on-device via WebGPU. Modelli: Qwen3 1.7B (default), Llama 3.2 1B, SmolLM2 1.7B, Qwen3 0.6B | Solo primo download |
| **Demo** | Risposte euristiche basate sui contenuti locali. Nessun modello IA caricato | No |
| **Ollama** | Si collega a un server Ollama locale su `http://localhost:11434` | Rete locale |
| **OpenAI** | Usa API OpenAI con chiave in memoria | Sì |

**Embedding & RAG:**
- Embedding locali via Transformers.js con `onnx-community/embeddinggemma-300m-ONNX` (768 dimensioni native, archiviate come 256d via Matryoshka Representation Learning)
- Retrieval ibrido che combina ricerca lessicale ed embedding semantici
- Vettori in cache in IndexedDB con hashing contenuto SHA-256 e versionamento pipeline (`v2.0-embeddinggemma-mrl256-sha256`)
- Tutto il calcolo embedding avviene on-device; l'integrazione browser usa l'export ONNX EmbeddingGemma 300M verificato e attualmente preferisce WASM per correttezza

## Semantica dell'avanzamento

CrossedArts traccia diverse cose tutte chiamate "avanzamento". Non sono mai mescolate silenziosamente: l'avanzamento misurato (lezioni completate, pagine lette) è mostrato come percentuale; lo stato grezzo (`not started` / `in progress` / `completed`) è mostrato come stato e mai come percentuale inventata. Completamento pratica, padronanza concetti e attività di studio sono concetti separati con proprio significato.

Le regole complete — incluso quale artefatto partecipa a galleria, grafo, montagna e pacchetti corso — sono documentate in [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Limitazioni

- **Non un LMS completo:** CrossedArts non ha classi, iscrizioni, voti, account docenti o aula remota. I pacchetti corso sono *materiale didattico* portabile, non un sistema gestionale.
- **Supporto browser:** Chrome, Edge o Brave richiesti per le funzioni media locali (File System Access API). Gli altri browser possono usare tutte le funzioni non-media.
- **Hardware IA locale:** GPU compatibile WebGPU raccomandata per l'inferenza LLM locale. Il fallback CPU esiste ma è più lento.
- **Primo download:** il primo uso dell'IA locale richiede il download dei pesi del modello; il modello embedding è recuperato su domanda e cachato dal browser.
- **Backup media:** i file media locali non sono inclusi nei backup SQLite. Solo il database è salvato; i media vanno ricollegati dopo il ripristino.
- **Nessuna sync automatica:** la sincronizzazione multi-dispositivo non è integrata. Export/import è il meccanismo di trasferimento manuale.
- **Mono-utente:** nessun supporto multi-utente né autenticazione.

## Avvio rapido

### Prerequisiti

- Node.js v22 o superiore (la suite di test usa `--experimental-strip-types`)
- Browser Chrome, Edge o Brave

### Installazione & Sviluppo

```bash
git clone https://github.com/marodriguezd/CrossedArts.git
cd CrossedArts/frontend
npm install
npm run dev
```

Apri `http://localhost:5173` nel browser.

### Test

```bash
cd frontend
npm test
```

La suite di test include 715 test su 63 file che coprono inizializzazione SQLite, algoritmo SM-2, sessioni di studio, grafo di conoscenza (inclusa analitica strutturale), provenienza RAG e citazioni, ingestione documenti, provider IA, proiezione artefatti di apprendimento, scoping montagna, conflitti pacchetti corso, obiettivi di apprendimento, analitica, pianificazione focus, workspace pratico, contrasto tema WCAG e leggibilità stati disabilitati.

#### QA visivo & responsive (obbligatorio per il deploy, opzionale in locale)

Il layer di rendering è verificato programmaticamente con Playwright contro la build di produzione — tre viewport (desktop 1280×800, tablet 834×1112, mobile 390×844), controllando overflow orizzontale, errori console, titoli attesi per vista, palette comandi, toggle tema e workspace pratico:

```bash
cd frontend
npx playwright install chromium   # una volta
npm run build
npm run preview:qa &             # serve la build su 127.0.0.1:4173
QA_URL=http://127.0.0.1:4173 npm run qa:visual
```

Gli screenshot sono scritti in `/tmp/crossedarts-qa` (mai committati). Il runner esce non-zero se un check oggettivo fallisce.

Eseguire questa suite sulla propria macchina è opzionale — `npm test` copre il comportamento funzionale. **Passarla non lo è**: gira contro la build di produzione esatta pubblicata, e il job `Deploy to Pages` dichiara `needs: [build-frontend, validate-backend]`, quindi un check Visual QA fallito blocca il deploy su GitHub Pages. Gira anche su ogni pull request contro `main` e manualmente via `workflow_dispatch`.

> [!WARNING]
> Usa `npm run preview:qa` invece di `npm run preview -- --port …`: npm non inoltra gli argomenti finali a Vite, quindi i flag di porta e `--strictPort` sarebbero scartati silenziosamente.

### Build

```bash
cd frontend
npm run build
```

Gli asset di produzione sono generati in `frontend/dist/`.

## Architettura

CrossedArts è un monorepo con due componenti indipendenti:

- **`frontend/`**: single-page application React 19 + TypeScript + Vite. Deployata su GitHub Pages.
- **`backend/`**: server Python FastAPI opzionale per ingestion batch e analisi avanzata.

Il frontend è pienamente funzionale senza backend. Il backend fornisce servizi aggiuntivi per workflow di elaborazione pesante.

## Companion backend

Il backend Python opzionale fornisce:

- Ingestione documenti batch (PDF, EPUB)
- Estrazione metadati e generazione miniature
- Embedding Sentence Transformers
- Workflow LLM LangChain

Setup:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
PYTHONPATH=. alembic -c backend/alembic.ini upgrade head
python -m backend.app.main
```

Il server API gira su `http://127.0.0.1:8080` con documentazione interattiva su `/docs`.

### L'esposizione di rete è opt-in

> [!CAUTION]
> L'API **non ha autenticazione** ed è pensata per uso locale. Fa bind su
> `127.0.0.1` di default, e avviarla su un'interfaccia non-loopback (es.
> `HOST=0.0.0.0`) è **rifiutato** a meno di impostare esplicitamente
> `ALLOW_NETWORK_ACCESS=true`. Attivare quel flag espone un'API scrivibile e non
> autenticata alla tua rete; se lo fai, limita la porta con firewall o reverse
> proxy. Con Ollama, imposta `OLLAMA_ORIGINS` alla tua origin esatta (es.
> `http://localhost:5173`) invece di `"*"`.

## Backup dati

Nella vista Impostazioni:

- **Export SQLite:** scarica un file database `.sqlite` standard
- **Import SQLite:** ripristina da un backup `.sqlite` precedente
- **Export JSON:** genera un dump strutturato di tutte le tabelle
- **Import JSON:** ripristina da un backup JSON (validato prima di ogni modifica)

## Avvisi di terze parti

Le dipendenze di terze parti mantengono le rispettive licenze:
- `onnx-community/embeddinggemma-300m-ONNX`: Termini d'uso Gemma
- `Xenova/multilingual-e5-small`: MIT
- WebLLM (`@mlc-ai/web-llm`): Apache-2.0
- Transformers.js (`@huggingface/transformers`): Apache-2.0
- SQLite WASM (`sql.js`): MIT
