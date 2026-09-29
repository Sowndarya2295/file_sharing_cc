# DropBoxer

**Secure Temporary File Sharing Using AWS Serverless Architecture**

> _"Share it. Secure it. Let it disappear."_

DropBoxer lets you upload a file to private cloud storage and share it securely for a limited time. Files expire automatically, can be made one-time (burn after download), and every upload passes a serverless safety-validation layer before it becomes shareable.

---

## 1. Project Overview

DropBoxer is a full-stack web application for **temporary, controlled file sharing**. A user uploads a file, chooses how long it should live, optionally marks it as a single-use link, and receives a hard-to-guess Share ID + link. Recipients open the link and download the file — but only while it is still valid.

The application is architected against a **backend API abstraction** so that AWS Lambda / S3 / DynamoDB deployment can be completed later without touching the frontend. The frontend never sees AWS credentials.

| Layer | Preview environment (now) | AWS production (target) |
|-------|---------------------------|--------------------------|
| File bytes | Emergent private object storage | **Amazon S3** (private bucket) |
| Metadata | MongoDB | **Amazon DynamoDB** |
| API | FastAPI (`/app/backend`) | **API Gateway + AWS Lambda** |
| Post-upload validation | Inline SafeDrop in `/api/upload` | **S3 Event → Lambda** |
| Access control | Signed download tokens | **S3 pre-signed URLs + IAM** |

The seam lives in [`/app/backend/aws_service.py`](backend/aws_service.py) — swap its bodies for `boto3` calls and the app is on real AWS.

---

## 2. Three Core Features

### ⏳ TimeVault — Smart Time-Based Expiration
Choose a lifetime of **5 minutes, 15 minutes, 1 hour, or 24 hours**. DropBoxer computes an expiry timestamp and surfaces file name, size, upload time, expiry time, a live remaining-time countdown, and status:

- `ACTIVE` · `EXPIRING SOON` · `EXPIRED`

Once expired, the share and download endpoints reject access: **"❌ This file has expired and is no longer available."**

### 🔥 Burn After Download — One-Time Secure Sharing
Tick **"Burn after first download"** at upload. DropBoxer then:
1. Generates a unique Share ID
2. Stores share metadata
3. Mints a temporary secure download URL only when access is requested
4. Allows exactly one successful download (atomic, race-safe)
5. Records the download and marks the share `USED`
6. Rejects every later attempt: **"🔥 This file has already been downloaded and the share link is no longer valid."**

### 🔍 SafeDrop — Serverless File Safety Validation
Before a file becomes shareable it is validated for: file extension, MIME/content type, maximum size (25 MB), suspicious filename/path patterns, empty/corrupted upload, and a **SHA-256 integrity hash**. States shown to the user:

- `🔍 Scanning file…` → `🟢 File verified — Safe to share` or `🔴 Upload rejected — File failed safety validation`

> SafeDrop is a **file validation and safety layer**, not a full antivirus engine.

---

## 3. System Architecture

```
        Browser (React SPA)
              |
              v
      Amazon API Gateway  ──────  REST /api/*
              |
              v
         AWS Lambda  ──────────────────┐
          |      |                     │
          v      v                     v
    Amazon S3   Amazon DynamoDB   (auth + presign)
   (private)     (metadata)
      |
      | S3 upload event (s3:ObjectCreated:*)
      v
   AWS Lambda  ──►  SafeDrop validation  ──►  DynamoDB status update
```

- The browser talks **only** to the API — never directly to S3 with credentials.
- S3 objects are private; downloads use short-lived pre-signed GET URLs generated **after** an authorization check.
- Uploading emits an S3 event that triggers the SafeDrop Lambda, which writes `safetyStatus` back to DynamoDB.

---

## 4. AWS Services

| Service | Role in DropBoxer |
|---------|-------------------|
| **Amazon S3** | Private object storage for uploaded files (never public) |
| **AWS Lambda** | Serverless upload, share, download, consume & validation logic |
| **Amazon API Gateway** | REST entrypoint mapping to Lambda functions |
| **Amazon DynamoDB** | Share/file metadata (see schema below) |
| **S3 Event Notifications** | Event-driven trigger for SafeDrop after upload |
| **AWS IAM** | Least-privilege roles for each Lambda |

**DynamoDB item schema:** `shareId`, `originalFileName`, `objectKey`, `fileSize`, `contentType`, `uploadTime`, `expiryTime`, `downloadCount`, `maxDownloads`, `oneTime`, `status`, `safetyStatus`, `fileHash`.

Deployment artifacts live in [`/app/aws/`](aws/): SAM `template.yaml`, Lambda handlers, and least-privilege IAM policies.

---

## 5. API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/upload` | Validate (SafeDrop), store object, create share |
| `GET`  | `/api/share/:shareId` | Share info + expiry/download validation |
| `GET`  | `/api/status/:shareId` | Lightweight status + remaining time |
| `GET`  | `/api/download/:shareId` | Authorize, then return a temporary secure download URL |
| `GET`  | `/api/file/:shareId?token=` | Stream bytes & atomically consume (burn point) |
| `POST` | `/api/consume/:shareId` | Record a successful one-time download |
| `POST` | `/api/scan/:fileId` | SafeDrop re-verification (recompute SHA-256) |
| `GET`  | `/api/shares?sessionId=` | List the current session's shares |
| `DELETE` | `/api/share/:shareId` | Owner revoke |

---

## 6. Environment Variables

**Backend (`/app/backend/.env`)**
```
MONGO_URL=...                 # metadata store (→ DynamoDB in prod)
DB_NAME=...
CORS_ORIGINS=*
EMERGENT_LLM_KEY=...          # object storage auth (→ IAM role in prod)
SHARE_TOKEN_SECRET=...        # signs temporary download tokens
MAX_UPLOAD_BYTES=26214400     # 25 MB
```

**Frontend (`/app/frontend/.env`)**
```
REACT_APP_BACKEND_URL=...     # public base URL of the API
```

**AWS Lambda (production)**: `BUCKET`, `METADATA_TABLE`, `PRESIGN_TTL`, `MAX_UPLOAD_BYTES` — never hardcode credentials; use IAM roles.

---

## 7. Local Development

```bash
# Backend (FastAPI, port 8001) and Frontend (React, port 3000) are managed by supervisor.
sudo supervisorctl restart backend frontend

# Backend logs
tail -f /var/log/supervisor/backend.err.log
```

Open the frontend URL, upload a file, pick a lifetime, optionally burn-after-download, and copy the share link.

---

## 8. AWS Deployment Architecture

```bash
cd /app/aws
sam build
sam deploy --guided        # creates the private S3 bucket, DynamoDB table,
                           # Lambda functions, API Gateway, and S3 event trigger
```

1. `FilesBucket` is created with **all public access blocked** and a 1-day lifecycle purge.
2. `SharesTable` (DynamoDB) stores metadata with a `shareId-index` GSI.
3. `ApiFunction` serves the REST routes via API Gateway.
4. `SafeDropFunction` is invoked by the S3 `ObjectCreated` event and writes `safetyStatus` back to DynamoDB.
5. Point `REACT_APP_BACKEND_URL` at the API Gateway `ApiUrl` output.

To switch the running app from Emergent storage to real S3, reimplement the functions in `backend/aws_service.py` with `boto3` (`put_object`, `get_object`, `generate_presigned_url`) — signatures stay identical.

---

## 9. Security Design

- **Private S3 bucket** — public access fully blocked; non-TLS denied (see `aws/iam/s3-bucket-policy.json`).
- **No credentials in the frontend** — the browser only ever calls the backend API.
- **Backend-controlled access** — files are served through expiring, signed links only.
- **Hard-to-guess Share IDs** — `DBX-` + 32 bits of CSPRNG entropy (`secrets`).
- **Authorization before URL generation** — expiry and burn state are checked before any download URL is minted.
- **Atomic one-time downloads** — a conditional/`find_one_and_update` prevents a second successful download under race.
- **Unique object keys** — UUID-based keys; original filenames never appear in the key.
- **Validated uploads** — size limit + extension/MIME/path checks via SafeDrop.
- **Least-privilege IAM** — each Lambda gets only the S3 prefix + table actions it needs.

---

## 10. Future Improvements

- Password-protected shares & optional recipient email verification.
- Configurable multi-download limits (e.g. 3/5/10) beyond one-time.
- CloudFront in front of pre-signed URLs for edge delivery.
- Virus-scanning integration (e.g. ClamAV Lambda layer) to complement SafeDrop.
- Per-share audit log (download IP, timestamp) in DynamoDB.
- Optional user accounts (Cognito) for a persistent, cross-device dashboard.

---

_Built as a cloud-computing final project: React + FastAPI + MongoDB now, mapping cleanly to Amazon S3 · Lambda · API Gateway · DynamoDB._
