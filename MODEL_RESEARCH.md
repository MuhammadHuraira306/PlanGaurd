# Small Language Model Research & Eligibility Evaluation — PlanGUARD

## 1. Evaluation Dimensions
To maximize accuracy under PlanGUARD's **1-minute incremental / 2-minute full-run** latency limits and **5-call incremental cap**, candidate small models are evaluated on:
1. Multilingual comprehension (English + Roman Urdu informal phrasing)
2. Strict JSON schema adherence (`responseMimeType: "application/json"`)
3. Contextual authority & conflict signal recognition
4. Token efficiency & latency
5. Honest token usage reporting via provider metadata

---

## 2. Candidate Small-Model Comparison

*Note: Characteristics below reflect published model specifications / architecture tiers rather than fabricated experimental benchmarks. Always verify empirical accuracy and latency directly via PlanGUARD's live Model Trace panel on your target hardware or API tier.*

| Model | Deployment Mode | Published Tier / Size | Roman Urdu & Structured JSON | Token Metadata Exposed | Configurable in PlanGUARD |
|---|---|---|---|---|---|
| `gemini-3.1-flash-lite` | API (`@google/genai`) | Ultra-lightweight Flash Lite | Strong schema-constrained JSON; minimal thinking overhead | Yes (`usageMetadata`) | Default (`PLANGUARD_MODEL=gemini-3.1-flash-lite`) |
| `gemini-4-hydrogen` | API (`@google/genai`) | Fast Flash-tier (`ThinkingLevel.LOW`) | High multilingual nuance & Roman Urdu reasoning | Yes (`usageMetadata` incl. thoughts) | Selectable in UI & env |
| `qwen2.5:7b` (via Ollama) | Local Laptop (`/v1`) | 7B open-weights | Strong multilingual & JSON mode support | Provider-dependent (`usage` field) | Via `PLANGUARD_PROVIDER=local` |
| `llama3.2:3b` (via Ollama) | Local Laptop (`/v1`) | 3B open-weights | Fast on CPU/GPU; weaker on complex Roman Urdu idioms | Provider-dependent | Via `PLANGUARD_PROVIDER=local` |
| `gemma2:9b` (via Ollama) | Local Laptop (`/v1`) | 9B open-weights | Solid instruction following & structured extraction | Provider-dependent | Via `PLANGUARD_PROVIDER=local` |
| `phi-3.5-mini` (via Ollama) | Local Laptop (`/v1`) | 3.8B open-weights | Low memory footprint; requires strict schema prompts | Provider-dependent | Via `PLANGUARD_PROVIDER=local` |

---

## 3. Bonus Eligibility Notice (10 Points)
Per the Mind to Machine (MTM) 2026 Hackathon rules:
- The **10-point bonus** applies ONLY if **every model call** in the trace uses a model explicitly listed on the **organizers' official eligible small-model list** AND the final event plan passes every validation check.
- Do **not** assume any model automatically qualifies without checking the organizers' published list on hackathon day.
- Because PlanGUARD routes 100% of model invocations through `src/ai/modelProvider.ts` and `src/ai/modelWrapper.ts`, switching to any approved API or local laptop small model requires only changing the model dropdown or `PLANGUARD_PROVIDER` / `PLANGUARD_MODEL` environment variables, with exact model names (`response.modelVersion` or local response `model`) truthfully recorded in `data/traces/trace.json`.
