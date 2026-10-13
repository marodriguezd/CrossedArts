<div align="center">
  <img src="frontend/public/favicon.svg" alt="logo CrossedArts" height="96" />
</div>

# CrossedArts - Learning Operating System

[![Deploy to GitHub Pages](https://github.com/marodriguezd/CrossedArts/actions/workflows/deploy.yml/badge.svg)](https://github.com/marodriguezd/CrossedArts/actions/workflows/deploy.yml)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

**Application en direct :** [https://marodriguezd.github.io/CrossedArts/](https://marodriguezd.github.io/CrossedArts/)

[English](README.md) · [Español](README.es.md) · [Deutsch](README.de.md) · Français · [Italiano](README.it.md) · [中文](README.zh.md)

---

## Ce que c'est

CrossedArts est une plateforme personnelle, **locale d'abord, visuelle, d'apprentissage et de connaissances** qui tourne entièrement dans le navigateur. Elle réunit cours, livres, documents importés, notes, concepts et les travaux que vous produisez dans un seul environnement — le tout stocké dans une base SQLite locale sans serveur backend requis.

Tout est organisé comme un apprenant étudie réellement : une galerie **Dashboard** de ce que vous apprenez, un **graphe de connaissances** de leurs relations, une vue **montagne** de la progression d'un contexte d'apprentissage, et des **travaux pratiques** qui enregistrent ce que vous avez produit. Elle est délibérément **neutre de domaine** : elle fonctionne pareil pour les mathématiques, la musique, la programmation ou l'art.

L'application s'adresse aux apprenants qui veulent la pleine propriété de leurs données d'étude sans dépendre de services cloud ou d'abonnements.

## Capacités

- **Galerie Dashboard :** un point d'entrée visuel et curé de votre apprentissage — cours, livres, documents importés et travaux pratiques, groupés par objectif (continuer à apprendre, ressources importées, travaux pratiques)
- **Aujourd'hui / Focus :** une réponse unique et déterministe à « que dois-je faire maintenant ? » — la prochaine leçon, les révisions dues, les travaux pratiques en attente, les objectifs non atteints et les ressources récemment étudiées, chacun avec sa raison d'être listé
- **Cours & Leçons :** structure de cours hiérarchique avec modules, leçons et contenu Markdown éditable
- **Livres & Ressources :** catalogue de bibliothèque avec progression de lecture, documents importés (PDF, EPUB, TXT, MD) et organisation des ressources
- **Sessions d'étude :** révision de flashcards unifiée (SM-2), questions de pratique et modes mixtes avec suivi local de progression
- **Travaux pratiques :** exercices, projets, essais, dessins ou code que vous produisez, liés à la ressource, la leçon ou le concept démontré — dans toute discipline. Chaque élément ouvre un **espace de travail pratique** avec contenu Markdown, checklist persistée, auto-évaluation et son contexte
- **Objectifs d'apprentissage :** objectifs explicites définis par l'utilisateur (cours, livre, pratique, habitude) avec dates cibles ; la progression des objectifs est dérivée de la progression mesurée uniquement, jamais inventée
- **Analytique :** séries d'étude quotidiennes, précision, activité par ressource, comparaison de plages (7/30/90 jours/tout) et streak — calculés à partir de vraies sessions d'étude et révisions
- **Graphe de connaissances :** visualisation 2D interactive des cours, livres, modules, leçons, notes, concepts, travaux pratiques et leurs relations, plus une **analytique structurelle** (degré, composantes, nœuds faiblement connectés et récemment touchés) qui décrit la topologie et ne classe jamais l'importance
- **Progression montagne :** un indicateur de parcours, global ou centré sur un cours, utilisant la progression mesurée réelle et les vrais modules du cours comme jalons
- **Paquets de cours :** exporte le *matériel pédagogique* d'une ressource (programme et travail proposé, jamais votre progression ni vos notes) comme paquet JSON portable à partager et importer additivement
- **Médias locaux :** lecture vidéo et audio depuis des dossiers locaux via la File System Access API
- **Recherche locale :** recherche déterministe SQL sur tout le contenu, plus une palette de commandes globale (Ctrl+K)
- **Ingestion de documents :** analyse dans le navigateur des fichiers PDF, EPUB, TXT et MD avec déduplication SHA-256
- **Fournisseurs IA :** inférence locale sur appareil (WebLLM/WebGPU), mode démo heuristique, Ollama ou API OpenAI. Les réponses portent des **citations de sources** vers la ressource, la leçon ou la note exacte qui les fonde, plus le fournisseur et le modèle qui les ont produites
- **Sauvegarde & Export :** export/import SQLite binaire et sauvegarde JSON avec validation de schéma
- **PWA :** app shell capable hors ligne avec cache service worker

## Modèle local d'abord

CrossedArts utilise une architecture de stockage double :

- **SQLite WASM** (`sql.js`) : la base relationnelle canonique tournant dans le navigateur. Stocke toutes les données d'apprentissage — cours, leçons, notes, flashcards, concepts, sessions et ressources.
- **IndexedDB** : couche de persistance qui survit aux redémarrages du navigateur. La base SQLite est sérialisée vers IndexedDB à chaque mutation.

**Ce qui fonctionne sans backend :**
- Toutes les activités d'apprentissage (cours, leçons, notes, flashcards, sessions d'étude)
- Lecture des médias locaux
- Ingestion de documents et recherche
- Visualisation du graphe de connaissances
- Sauvegarde et restauration

**Ce qui requiert un accès réseau :**
- Téléchargement initial des modèles IA locaux (poids WebLLM, modèle d'embedding)
- Appels API OpenAI (opt-in)
- Connexion Ollama (opt-in, serveur local)

## IA & Recherche

CrossedArts prend en charge quatre modes de fournisseurs IA :

| Mode | Description | Réseau requis |
|------|-------------|---------------|
| **Local (WebLLM)** | Inférence sur appareil via WebGPU. Modèles : Qwen3 1.7B (défaut), Llama 3.2 1B, SmolLM2 1.7B, Qwen3 0.6B | Premier téléchargement uniquement |
| **Démo** | Réponses heuristiques basées sur le contenu local. Aucun modèle IA chargé | Non |
| **Ollama** | Se connecte à un serveur Ollama local à `http://localhost:11434` | Réseau local |
| **OpenAI** | Utilise l'API OpenAI avec stockage de clé en mémoire | Oui |

**Embeddings & RAG :**
- Embeddings locaux via Transformers.js avec `onnx-community/embeddinggemma-300m-ONNX` (768 dimensions natives, stockées en 256d via Matryoshka Representation Learning)
- Récupération hybride combinant recherche lexicale et embeddings sémantiques
- Vecteurs mis en cache dans IndexedDB avec hachage de contenu SHA-256 et versionnage de pipeline (`v2.0-embeddinggemma-mrl256-sha256`)
- Tout le calcul d'embedding se fait sur l'appareil ; l'intégration navigateur utilise l'export ONNX EmbeddingGemma 300M vérifié et préfère actuellement WASM pour la correction

## Sémantique de progression

CrossedArts suit plusieurs choses différentes toutes appelées « progression ». Elles ne sont jamais mélangées silencieusement : la progression mesurée (leçons terminées, pages lues) est montrée en pourcentage ; le statut grossier (`not started` / `in progress` / `completed`) est montré comme statut et jamais comme pourcentage inventé. L'achèvement de pratique, la maîtrise de concepts et l'activité d'étude sont des concepts séparés avec leur propre sens.

Les règles complètes — incluant quel artefact participe à la galerie, au graphe, à la montagne et aux paquets de cours — sont documentées dans [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Limitations

- **Pas un LMS complet :** CrossedArts n'a ni classes, ni inscription, ni notation, ni comptes enseignants ni classe distante. Les paquets de cours sont du *matériel pédagogique* portable, pas un système de gestion.
- **Support navigateurs :** Chrome, Edge ou Brave requis pour les fonctions médias locales (File System Access API). Les autres navigateurs peuvent utiliser toutes les fonctions non-média.
- **Matériel IA local :** GPU compatible WebGPU recommandé pour l'inférence LLM locale. Le repli CPU existe mais est plus lent.
- **Premier téléchargement :** la première utilisation de l'IA locale requiert le téléchargement des poids du modèle ; le modèle d'embedding est récupéré à la demande et mis en cache par le navigateur.
- **Sauvegarde médias :** les fichiers médias locaux ne sont pas inclus dans les sauvegardes SQLite. Seule la base est sauvegardée ; les médias doivent être re-liés après restauration.
- **Pas de synchro auto :** la synchronisation multi-appareils n'est pas intégrée. L'export/import est le mécanisme de transfert manuel.
- **Mono-utilisateur :** pas de support multi-utilisateur ni d'authentification.

## Démarrage rapide

### Prérequis

- Node.js v22 ou supérieur (la suite de tests utilise `--experimental-strip-types`)
- Navigateur Chrome, Edge ou Brave

### Installation & Développement

```bash
git clone https://github.com/marodriguezd/CrossedArts.git
cd CrossedArts/frontend
npm install
npm run dev
```

Ouvrez `http://localhost:5173` dans votre navigateur.

### Tests

```bash
cd frontend
npm test
```

La suite de tests inclut 715 tests sur 63 fichiers couvrant l'initialisation SQLite, l'algorithme SM-2, les sessions d'étude, le graphe de connaissances (incluant l'analytique structurelle), la provenance RAG et citations, l'ingestion de documents, les fournisseurs IA, la projection d'artefacts d'apprentissage, le cadrage montagne, les conflits de paquets de cours, les objectifs d'apprentissage, l'analytique, la planification focus, l'espace de travail pratique, le contraste de thème WCAG et la lisibilité des états désactivés.

#### QA visuel & responsive (obligatoire pour le déploiement, optionnel en local)

La couche de rendu est vérifiée programmatiquement avec Playwright contre le build de production — trois viewports (desktop 1280×800, tablette 834×1112, mobile 390×844), vérifiant le débordement horizontal, les erreurs console, les titres attendus par vue, la palette de commandes, la bascule de thème et l'espace de travail pratique :

```bash
cd frontend
npx playwright install chromium   # une fois
npm run build
npm run preview:qa &             # sert le build sur 127.0.0.1:4173
QA_URL=http://127.0.0.1:4173 npm run qa:visual
```

Les captures sont écrites dans `/tmp/crossedarts-qa` (jamais commitées). Le runner sort non-zéro si un contrôle objectif échoue.

Exécuter cette suite sur votre machine est optionnel — `npm test` couvre le comportement fonctionnel. **La réussir ne l'est pas** : elle tourne contre le build de production exact qui est publié, et le job `Deploy to Pages` déclare `needs: [build-frontend, validate-backend]`, donc un contrôle Visual QA en échec bloque le déploiement sur GitHub Pages. Elle tourne aussi sur chaque pull request contre `main` et manuellement via `workflow_dispatch`.

> [!WARNING]
> Utilisez `npm run preview:qa` plutôt que `npm run preview -- --port …` : npm ne transmet pas les arguments traînants à Vite, donc les flags de port et `--strictPort` seraient silencieusement abandonnés.

### Build

```bash
cd frontend
npm run build
```

Les assets de production sont générés dans `frontend/dist/`.

## Architecture

CrossedArts est un monorepo avec deux composants indépendants :

- **`frontend/`** : application single-page React 19 + TypeScript + Vite. Déployée sur GitHub Pages.
- **`backend/`** : serveur Python FastAPI optionnel pour l'ingestion par lots et l'analyse avancée.

Le frontend est pleinement fonctionnel sans le backend. Le backend fournit des services additionnels pour les workflows de traitement lourds.

## Compagnon backend

Le backend Python optionnel fournit :

- Ingestion de documents par lots (PDF, EPUB)
- Extraction de métadonnées et génération de miniatures
- Embeddings Sentence Transformers
- Workflows LLM LangChain

Setup :

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
PYTHONPATH=. alembic -c backend/alembic.ini upgrade head
python -m backend.app.main
```

Le serveur API tourne à `http://127.0.0.1:8080` avec documentation interactive à `/docs`.

### L'exposition réseau est opt-in

> [!CAUTION]
> L'API n'a **pas d'authentification** et est destinée à un usage local. Elle se lie à
> `127.0.0.1` par défaut, et la démarrer sur une interface non-loopback (p. ex.
> `HOST=0.0.0.0`) est **refusé** sauf si vous définissez explicitement
> `ALLOW_NETWORK_ACCESS=true`. Activer ce flag expose une API inscriptible et non
> authentifiée à votre réseau ; restreignez le port avec un pare-feu ou un
> reverse proxy si vous le faites. Avec Ollama, définissez `OLLAMA_ORIGINS` à votre origine
> exacte (p. ex. `http://localhost:5173`) plutôt que `"*"`.

## Sauvegarde des données

Dans la vue Paramètres :

- **Exporter SQLite :** télécharger un fichier de base `.sqlite` standard
- **Importer SQLite :** restaurer depuis une sauvegarde `.sqlite` précédente
- **Exporter JSON :** générer un dump structuré de toutes les tables
- **Importer JSON :** restaurer depuis une sauvegarde JSON (validée avant tout changement)

## Mentions de tiers

Les dépendances tierces conservent leurs licences respectives :
- `onnx-community/embeddinggemma-300m-ONNX` : Conditions d'utilisation Gemma
- `Xenova/multilingual-e5-small` : MIT
- WebLLM (`@mlc-ai/web-llm`) : Apache-2.0
- Transformers.js (`@huggingface/transformers`) : Apache-2.0
- SQLite WASM (`sql.js`) : MIT
