# PlanGUARD — Constraint-Aware Incremental Hackathon Planning Agent

Built for the **Mind to Machine (MTM) Hackathon 2026** (18 November 2026).

PlanGUARD is a hybrid **AI + deterministic verification** event-planning agent system that ingests unstructured `.txt` message packs (English, Roman Urdu, emails, WhatsApp threads, notices), resolves contradictions and misleading claims, builds a mathematically validated 4-hour Islamabad hackathon plan across five areas, and incrementally updates **only affected planning areas** within strict call and latency limits.

---

## Architecture Overview

1. **Generic Message Ingestion (`src/processing/fileReader.ts`, `messageParser.ts`)**:
   - Reads `.txt` packs verbatim and parses emails, WhatsApp exports, numbered items, delimiter blocks, and blank-line notices without hardcoded facts.
   - Flags uncertain message boundaries rather than silently discarding text.
2. **Batched Multilingual Fact Extraction (`src/processing/factExtractor.ts`)**:
   - Uses a single structured-JSON model call (`areaTag: "reading"`) to extract quantities, costs, times, venue options, sender roles, authority levels, and operational-vs-announced deadlines in English and Roman Urdu.
3. **Hybrid Conflict Resolution (`src/processing/conflictResolver.ts`)**:
   - Distinguishes genuine updates, explicit corrections, operational clarifications, outdated announcements, unauthorized claims, hard-constraint violations (e.g. under-ordered food vs total attendance), and irrelevant messages.
   - Preserves complete status transition history (`Confirmed`, `Accepted`, `Conflicting`, `Superseded`, `Outdated`, `Unverified`, `Rejected`, `Irrelevant`).
4. **Dependency Engine & Five Planning Modules (`src/updates/`, `src/planners/`)**:
   - `venuePlanner.ts`: Evaluates capacity, backup generator, A/C, Wi-Fi, and cost constraints.
   - `schedulePlanner.ts`: Constructs exact 4-hour (240-min) non-overlapping schedules with prayer breaks while keeping administrative deadlines (such as code freeze cutoffs) separate from physical timetable slots.
   - `foodPlanner.ts`: Enforces full headcount coverage (never confusing team count with total people).
   - `judgingPlanner.ts`: Validates team-to-judge capacity, maximum load, and evaluation minutes.
   - `budgetPlanner.ts`: 100% deterministic expense ledger with deduplication and committed expense preservation.
   - Incremental updates predict affected areas via `dependencyEngine.ts`, never regenerate unaffected areas, and enforce a hard cap of `<= 5` model calls.
5. **Audited Model-Call Trace (`src/ai/modelWrapper.ts`, `src/trace/traceManager.ts`)**:
   - Every model invocation passes through `invokeModel()`, logging exact system instructions, prompts, raw responses, provider-reported token counts (never fabricated), timestamps, and conflict explanations.
6. **Deterministic Validation (`src/validation/planValidator.ts`)**:
   - Verifies all five areas and cross-area constraints; labels impossible constraint combinations as `IMPOSSIBLE` instead of inventing invalid workarounds.

---

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```
2. **Configure environment** (copy `.env.example` to `.env` and set `GEMINI_API_KEY`):
   ```bash
   cp .env.example .env
   ```
3. **Run automated verification tests**:
   ```bash
   npm test
   ```
4. **Start the server (port 3000)**:
   ```bash
   npm run dev
   ```
5. Open `http://localhost:3000` in your browser.

---

## API Endpoints

- `GET /api/state` — Current workspace state, validation report, and trace.
- `POST /api/messages/upload` — Upload `.txt` message pack (`{ filename, content }` or `text/plain`).
- `POST /api/messages/add` — Add one incremental message (`{ text, sender, sourceType }`).
- `GET /api/messages/samples` & `POST /api/messages/load-sample` — Load synthetic `.txt` benchmark packs.
- `POST /api/facts/:id/resolve` — Human verification (`confirm` | `reject`) for `Unverified` / `Conflicting` facts.
- `POST /api/config/model` — Switch configured small model (`gemini-3.1-flash-lite`, `gemini-4-hydrogen`, or `local`).
- `GET /api/export/:type` — Download `plan`, `trace`, `validation`, or `history` JSON files.

---

## Hackathon Team Git Milestones (30-Minute Cadence)

1. **Milestone 1 (00:30)**: Express server, static HTML5/CSS3/Vanilla JS shell, JSON persistence (`dataStore.ts`).
2. **Milestone 2 (01:00)**: Generic `.txt` parser (`messageParser.ts`) + audited model wrapper (`modelWrapper.ts`, `traceManager.ts`).
3. **Milestone 3 (01:30)**: Multilingual fact extraction (`factExtractor.ts`) + conflict resolution engine (`conflictResolver.ts`).
4. **Milestone 4 (02:00)**: Five deterministic/hybrid planning engines + `planValidator.ts`.
5. **Milestone 5 (02:30)**: Dependency graph & incremental update manager (`<= 5` calls) + exports.
6. **Milestone 6 (03:00)**: Full test suite (`npm test`), synthetic stress tests, and UI verification.
