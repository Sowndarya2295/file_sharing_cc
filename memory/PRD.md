# DropBoxer — PRD

## Original Problem Statement
Build DropBoxer — "Secure Temporary File Sharing Using AWS Serverless Architecture" (tagline: "Share it. Secure it. Let it disappear."). A temporary file-sharing platform with three core features (TimeVault expiry, Burn After Download, SafeDrop validation), designed against a clean AWS service-layer abstraction that maps to S3/Lambda/API Gateway/DynamoDB, with private storage, no exposed AWS credentials, hard-to-guess share IDs, and a polished non-AI-looking UI. No auth (session/browser based).

## User Choices
- Storage: AWS service-layer abstraction using Emergent object storage + MongoDB now, swappable to real AWS later.
- Include full AWS deployment artifacts (Lambda stubs, IAM policies, SAM template, README ASCII diagram).
- Max upload 25 MB; allowed types: common docs/images.
- My Shares = browser/session based (no login).

## Architecture
- **Frontend**: React (CRA + craco), Tailwind + shadcn/ui, react-router. Pages: `Home` (hero, feature strip, upload+result, My Shares dashboard, AWS architecture), `SharePage` (/share/:id). Frontend service layer at `src/lib/api.js` (uploadFile/createShare, getShare/validateShare, getStatus, generateDownloadUrl, consumeShare, scanFile, listShares, revokeShare).
- **Backend**: FastAPI (`/app/backend/server.py`) + MongoDB. AWS seam isolated in `/app/backend/aws_service.py` (object storage put/get + signed download tokens). All routes under `/api`.
- **AWS artifacts**: `/app/aws/` — `template.yaml` (SAM), `lambda/api_handlers.py`, `lambda/safedrop_validator.py`, `iam/lambda-policy.json`, `iam/s3-bucket-policy.json`.

## Personas
- **Sender**: uploads a file, sets a lifetime, optionally burn-after-download, shares the link.
- **Recipient**: opens a share link and downloads securely once (or until expiry).

## Core Requirements (static)
- TimeVault: 5m/15m/1h/24h lifetimes; ACTIVE / EXPIRING SOON / EXPIRED; expired → download rejected.
- Burn After Download: one-time link; atomic single successful download; subsequent → 410 used.
- SafeDrop: extension + MIME + 25MB + suspicious path + empty checks + SHA-256 hash; reject bad files.
- Security: private storage, no FE credentials, backend-controlled expiring links, CSPRNG share IDs, unique object keys, authorization before URL generation.

## Implemented (2026-09-29)
- Full upload → SafeDrop scan → private storage → share creation flow.
- Endpoints: POST /api/upload, GET /api/share/:id, GET /api/status/:id, GET /api/download/:id, GET /api/file/:id (atomic burn point, bytes fetched before consume), POST /api/consume/:id, POST /api/scan/:id, GET /api/shares, DELETE /api/share/:id.
- Live countdown, status badges, Result card, My Shares dashboard (copy/re-verify/revoke), Share page with expired/used/invalid states.
- Complete README (10 sections + ASCII diagram) and AWS SAM/Lambda/IAM artifacts.
- Verified: 13/13 backend tests + full frontend E2E passed (iteration_1).

## Backlog / Future (P1/P2)
- P1: password-protected shares; configurable multi-download limits.
- P2: CloudFront edge delivery; per-share audit log; optional Cognito accounts; ClamAV layer.
