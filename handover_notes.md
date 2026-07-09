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

---

## 3. Environment Variable Requirements
For the application to run successfully in development and production, the following variables are required:

| Variable | Description | Location / Value |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Private Gemini API Key | Railway system variables & `.env.local` |
| `DATABASE_URL` | PostgreSQL connection string | Railway system variables (falls back to memory DB in dev) |
| `PORT` | Node.js Express server port | Defaults to `3000` |
| `VITE_ADMIN_PASSWORD` | Frontend Admin Dashboard password | Optional (defaults to `admin@rdc2026` if unset) |
