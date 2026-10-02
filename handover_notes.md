# Handover Notes: RDC Assessments & Recruitments System

This document summarizes the engineering history, architectural improvements, and resolved issues for subsequent AI agents working on the RDC Assessments & Recruitments project.

---

## 1. Project Context & Stack
- **Frontend**: React.js built with Vite, Tailwind CSS.
- **Backend**: Node.js Express server (`server/index.js`).
- **Database**: PostgreSQL (using `pg` pool, falls back to in-memory store in local development if `DATABASE_URL` is unset).
- **Deployment**: Hosted on Railway, integrated with GitHub for automatic redeployments on push to the `main` branch.

---

## 2. Completed Milestones & Architectural History

### Milestone 1: Gemini API Key Security Refactoring (Leaked Key Resolution)
- **Problem**: The Gemini API key was originally accessed on the client-side React code via `import.meta.env.VITE_GEMINI_API_KEY`. Vite inlines all `VITE_` prefixed variables directly into the compiled public production JS bundle, exposing the secret key to browser inspection and crawler bots.
- **Solution**: Refactored the app to run the AI evaluations securely on the server-side.
  - Created `server/aiService.js` to wrap prompt configurations and initialize `GoogleGenAI` using `process.env.GEMINI_API_KEY`.
  - Registered a secure proxy endpoint `POST /api/evaluate` in `server/index.js`.
  - Updated the frontend `src/utils/aiService.js` to make simple fetch calls to `/api/evaluate`.
  - Renamed environment variables to `GEMINI_API_KEY` (removing the `VITE_` prefix) to prevent Vite from ever inlining them again.
- **Current Status**: **Fully Secure**. The key is stored in Railway's private dashboard variables and is 100% hidden from the client browser.

### Milestone 2: Ollama Integration and Reversion (Self-Hosted LLM experiment)
- **Goal**: Transition from Gemini API to a self-hosted local Ollama (`llama3`) instance running inside a Docker container.
- **Implementation**:
  - Created a `Dockerfile` and `start.sh` script to bundle Ollama and Express inside a single Ubuntu container and pre-pull the `llama3` model (4.7 GB) during image building.
  - Refactored `server/aiService.js` to call `${process.env.OLLAMA_URL}/api/generate`.
- **Encountered Roadblocks**:
  1. *Missing zstd dependency*: Fixed by installing `zstd` in the Dockerfile, which Ollama's installer script requires.
  2. *Missing devDependencies*: Fixed by delaying setting `NODE_ENV=production` to the bottom of the Dockerfile so that Vite build tools are successfully installed.
  3. *Out-Of-Memory (OOM) 500 Errors*: Once successfully deployed, Ollama requests consistently returned `500 Internal Server Error`. The 8B parameter `llama3` model requires 6GB+ RAM to execute, exceeding Railway's standard container RAM limits (which resulted in silent OOM kills).
- **Resolution**: The user elected to roll back to the cloud Gemini API. We ran a hard git reset to commit `a46d9e5` and force-pushed to restore the secure Gemini Express backend proxy.

### Milestone 3: Multimodal Document Support (Scanned PDFs and Images)
- **Problem**: Uploading scanned PDFs (consisting of image snapshots of pages rather than digital text) caused client-side parser failures, triggering the error: `No readable text found in the document.`
- **Solution**: Upgraded the pipeline to support multimodal inputs.
  - **Frontend (`src/pages/AdminDashboard.jsx`)**:
    - Refactored file upload logic. For PDFs and image files (`.png`, `.jpg`, `.jpeg`, `.webp`), the file is read as a base64 Data URL using `FileReader`.
    - If a PDF lacks digital text, the interface enters "Visual mode" and sends the base64 data to the API instead of throwing an error.
    - Updated Dropzone config to accept image files directly.
  - **Backend (`server/aiService.js` & `server/index.js`)**:
    - Updated `POST /api/evaluate` to receive `fileData` (base64 string) and `mimeType` in the body.
    - If base64 file data is present, construct a multimodal prompt using Gemini's native `inlineData` structure:
      ```javascript
      contents = [
          {
              inlineData: {
                  mimeType: mimeType,
                  data: cleanBase64
              }
          },
          "Please evaluate this document according to your system instructions."
      ];
      ```
    - The `gemini-2.5-flash` model performs built-in OCR and visual analysis on the scanned document, returning the assessment.
- **Current Status**: **Fully Functional**. Active on the main branch.

### Milestone 4: Set-Based Partitioning for Kaushal Batching Questions
- **Problem**: The original randomization selected 10 questions entirely at random from a flat list, leading to scenarios where a candidate could get too many maintenance questions or too many daily-checks questions, affecting test balance.
- **Solution**: Split the updated July 2026 question bank into two balanced sets:
  - **Set 1**: Operations & Safety (20 questions, mapped to `SET: 1` in [src/data/kaushalBatchingQuestions.js](file:///d:/RDC%20Drive/AI/Assessments/rdc-assessments/src/data/kaushalBatchingQuestions.js)).
  - **Set 2**: Maintenance & Troubleshooting (10 questions, mapped to `SET: 2` in [src/data/kaushalBatchingQuestions.js](file:///d:/RDC%20Drive/AI/Assessments/rdc-assessments/src/data/kaushalBatchingQuestions.js)).
- **Frontend Randomizer**: Updated [src/components/RecruitmentTab.jsx](file:///d:/RDC%20Drive/AI/Assessments/rdc-assessments/src/components/RecruitmentTab.jsx#L86-L92) to pick exactly **7 questions from Set 1** and **3 questions from Set 2**, then combine and shuffle them to maintain consistent structural representation across tests.
- **Current Status**: **Fully Functional**. Active on the main branch.

### Milestone 5: Monthly Trainee Report Cycles (Operations and Sales)
- **Problem**: HR uploaded each trainee's monthly report by hand on the "Offline PDF Evaluators" screen, and nothing was stored — no history, no way to spot trainees copying each other or recycling last month's report, and no supervisor step.
- **Solution**: the Operations and Sales dropdown entries now open report **cycles** (`server/reports/`, `src/pages/reports/`):
  1. HR picks the month, the trainees' last date and the supervisors' last date, selects trainees from the employee master (the same filter panel as hr.rdcc.ai/master) and assigns each a supervisor from the master. Only employee codes leave the browser; names, e-mails and plants are resolved server-side.
  2. Each trainee is e-mailed their own link (`/report/:token`) and can upload or replace a PDF, Word file or photo until the last date. HR can reopen one trainee, upload on their behalf, or re-send a link.
  3. After the last date a scheduler tick (`engine.js`, every 5 min) extracts the text (AI transcription for scans and photos), finds **copy** flags (other trainees, this cycle and every earlier cycle of the track) and **repeat** flags (the trainee's own earlier reports) with a deterministic 7-word-shingle overlap (`similarity.js`, unit tested), asks Gemini whether each overlap is real copying or template text, then scores each report on the existing six criteria.
  4. Each supervisor gets one link (`/review/:token`) listing their trainees: the original report, the AI assessment PDF, the red flags, and a 1–5 rating with comments.
  5. HR downloads the Excel summary and presses "Send results", which e-mails each trainee the AI report (PDF) and the supervisor's rating. Red flags never go to the trainee.
- Reminders go out once, 2 days before each deadline. Every step is stamped in the database, so a restart resumes and nothing is e-mailed twice.
- Scores are returned by Gemini as JSON (`responseJsonSchema`) and totalled in code — the old screen had the model write HTML, so the score existed only as text.
- **Verify locally**: `npm test` (detector). For the whole cycle, run the server against a local Postgres, a stand-in master and Gemini (`GEMINI_BASE_URL` points the SDK elsewhere) and an SMTP sink.

---

## 3. Environment Variable Requirements
For the application to run successfully in development and production, the following variables are required:

| Variable | Description | Location / Value |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Private Gemini API Key | Railway system variables & `.env.local` |
| `DATABASE_URL` | PostgreSQL connection string | Railway system variables (falls back to memory DB in dev) |
| `PORT` | Node.js Express server port | Defaults to `3000` |
| `VITE_ADMIN_PASSWORD` | Frontend Admin Dashboard password | Optional (defaults to `admin@rdc2026` if unset) |
| `MASTER_API_URL`, `MASTER_API_KEY` | Employee master (portal) for report cycles | `http://portal:3000` on hr.rdcc.ai |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | E-mail for report-cycle links and results | Same account PARAKH uses |
| `PUBLIC_URL` | Base of the links in those e-mails | `https://hr.rdcc.ai/eval` |
| `REPORT_TICK_MS` | Scheduler interval | Optional, default 300000 (5 min) |
| `GEMINI_BASE_URL` | Points the Gemini SDK at a stand-in | Testing only — never set in production |
