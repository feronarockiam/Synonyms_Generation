# Synonym Generation Pipeline

A production-grade data pipeline for extracting taxonomy terms and enriching them with search synonyms using Groq's Llama 3.1 70B API.

## Features
- **Idempotent**: Uses SHA256 hashing to deduplicate terms in a `term_cache.json`.
- **Crash-Resilient**: Saves progress every 10 terms. Resumes seamlessly.
- **Atomic Operations**: Safe file rewrites preventing corruption.
- **Token Bucket Rate Limiting**: Intelligent limits (30 RPM, 30K TPM) with circuit breaking.
- **Poison Pill Handling**: Failed terms go to `dead_letter_queue.json`.

## Setup
1. `npm install`
2. Create `data/input`, `data/output`, etc if not exist
3. Set `GROQ_API_KEY` in your `.env`

## Usage

**Standard run (resumes if interrupted)**:
```bash
npx ts-node src/index.ts --input data/input/taxonomy.csv
```

**Force restart (ignores checkpoint)**:
```bash
npx ts-node src/index.ts --input tests/fixtures/sample_taxonomy.csv --fresh
```

**Dry run (shows validations, no Groq calls)**:
```bash
npx ts-node src/index.ts --input tests/fixtures/sample_taxonomy.csv --dry-run
```

**Retry Failed Terms**:
```bash
npx ts-node src/index.ts --retry-failed
```
