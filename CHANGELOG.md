# Changelog

All notable changes to CrossedArts will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-10-07

### Security
- **Service Worker Cache Boundaries**: Hardened `sw.js` to strictly exclude dynamic backend routes (`/api/`, `/api/v1/`, `/docs`, `/openapi.json`, `/static/`, `/media/`, `/stream/`, `/content/`), Range streaming, and authenticated requests from Cache Storage, preventing stale API data in same-origin self-hosted deployments.
- **Dependency Security Updates**: Patched build tooling vulnerabilities (Rollup 4.64.1 path traversal GHSA-mw96-cpmx-2vgc, Playwright 1.63.0 SSL certificate validation GHSA-7mvr-c777-76hp, Vite 5.4.21 dev origin check, python-multipart 0.0.20 multipart DoS CVE-2024-53981).
- **Upload Resource Bounds & Cleanup**: Enforced explicit size limits (20 MB for cover images, 2 GB per file, 10 GB batch aggregate) with early stream validation and deterministic temporary directory cleanup on failed uploads.

### Fixed
- **Deployment Quality Gate Consistency**: Updated `.github/workflows/deploy.yml` so production deployments on `main` strictly gate on Ruff linting, Mypy typechecking, Pytest test suite, and frontend quality gates.
- **Cryptographic Fingerprint Equivalence**: Implemented pure TypeScript FIPS 180-4 SHA-256 fallback in `computeBinarySha256` to guarantee identical cryptographic digests across WebCrypto and fallback environments, separating non-cryptographic fast hashing into an explicit utility.
- **Browser Memory Protection**: Introduced explicit 100 MB limits for in-browser PDF/EPUB extraction with clear user-facing error reporting (`file-too-large`).

### Maintenance
- **Backend Dependency Lock Refresh**: Pinned LangChain 0.3.20 ecosystem packages and python-multipart in `backend/requirements.lock`.
- **Semantic Search Bounds**: Clarified and documented the personal-scale 3000-record scan limit (`SEMANTIC_SCAN_LIMIT`) with diagnostic logging and documentation.

## [1.0.0] - 2026-10-07

### Added
- **Local Document Ingestion**: Robust client-side PDF parsing using `pdfjs-dist` worker and EPUB parsing with `fflate` container/manifest/spine traversal, text normalization, and SHA-256 deduplication.
- **On-Device Embeddings & Vector Cache**: Client-side Transformers.js runtime using `onnx-community/embeddinggemma-300m-ONNX` (Matryoshka 256d) with IndexedDB caching and concurrency-safe queue scheduling.
- **Deep Linking & Navigation**: URL hash routing support (`#tab=focus`, `#tab=course_detail`, `#tab=resource_detail`, `#tab=notes`) enabling direct linkability and bookmarking without breaking SPA containment.
- **Practice Work as Knowledge Source**: Practice artifacts now participate as first-class nodes in the knowledge graph, relational links, and RAG context.
- **Automated Quality Gates & CI**: Comprehensive GitHub Actions workflows for frontend test fleet, typechecking, production builds, backend testing, pinned Ruff linting, Mypy typing, and Playwright responsive visual QA.
- **Reproducible Dependency Lockfile**: Deterministic backend dependencies via `backend/requirements.lock` including pinned FastAPI, Starlette with HTTP 206 Range streaming support, Ruff, and Mypy.
- **Legacy Namespace Isolation**: Full backward compatibility translation layer strictly isolated in `backend/app/core/compatibility.py`.

### Changed
- **Relational Integrity & Safety**: `PracticeWork` records are safely preserved with unlinked parent foreign keys upon resource or lesson deletion instead of cascading data loss.
- **RAG & Citation Provenance**: Grounded AI responses and study generators now attach verified source citations (resource, lesson, note, provider, and model).
- **Backend Network Exposure Hardening**: Configured local host defaults and strict CORS origin verification to prevent unauthorized localhost access.
- **Media Streaming**: MIME detection and HTTP 206 Range request handling for video and audio playback.

### Fixed
- Fixed mobile drawer focus restoration and keyboard trapping on overlay dialogs.
- Fixed WCAG AA color contrast ratios across light (cream) and dark (charcoal) semantic theme tokens.
- Fixed Starlette Range request compatibility in backend media streaming.
- Fixed N+1 queries in backend activity and session summarization endpoints.
