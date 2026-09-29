from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException, Query, Body
from fastapi.responses import JSONResponse, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
import os
import logging
import hashlib
import secrets
import bcrypt
from pathlib import Path
from datetime import datetime, timezone, timedelta

import aws_service

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="DropBoxer API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("dropboxer")

# --- SafeDrop validation config ----------------------------------------------
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", 25 * 1024 * 1024))
ALLOWED_EXT = {"pdf", "png", "jpg", "jpeg", "gif", "webp", "doc", "docx",
               "txt", "csv", "zip", "xls", "xlsx", "ppt", "pptx", "md", "json"}
DANGEROUS_EXT = {"exe", "bat", "sh", "cmd", "com", "msi", "jar", "scr", "vbs",
                 "dll", "ps1", "app", "deb", "apk", "bin", "cgi", "php", "js"}
SUSPICIOUS_TOKENS = ["..", "/", "\\", "\x00", "<script", "%00"]
LIFETIME_MAP = {"5m": 5, "15m": 15, "1h": 60, "24h": 1440}


# AccessGuard — share passwords are always bcrypt-hashed, never stored in plaintext.
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def scan_file(filename: str, data: bytes, content_type: str):
    """SafeDrop: serverless file safety & integrity validation layer.

    NOTE: This is a file-safety/validation layer (extension, MIME, size, path,
    integrity hash) — it is NOT a full antivirus engine.
    """
    checks = []

    def add(name, passed, detail):
        checks.append({"name": name, "passed": bool(passed), "detail": detail})

    name = filename or ""
    parts = name.lower().split(".")
    ext = parts[-1] if len(parts) > 1 else ""
    size = len(data)

    add("Non-empty upload", size > 0, f"{size} bytes read")
    add("Within 25 MB limit", 0 < size <= MAX_UPLOAD_BYTES, f"{round(size / 1024 / 1024, 2)} MB")
    add("Allowed file extension", ext in ALLOWED_EXT and ext not in DANGEROUS_EXT, f".{ext or 'none'}")

    mime_root = (content_type or "").split("/")[0]
    add("Recognized MIME type", mime_root in {"image", "text", "application"} and bool(content_type),
        content_type or "unknown")

    has_dangerous_segment = any(p in DANGEROUS_EXT for p in parts[1:])
    suspicious = any(tok in name for tok in SUSPICIOUS_TOKENS) or has_dangerous_segment or name.startswith(".")
    add("No suspicious filename/path", not suspicious, "clean" if not suspicious else "flagged pattern")

    file_hash = hashlib.sha256(data).hexdigest()
    add("SHA-256 integrity hash", True, file_hash[:16] + "…")

    status = "verified" if all(c["passed"] for c in checks) else "rejected"
    return status, checks, file_hash


def compute_status(doc: dict) -> str:
    if doc.get("status") == "USED":
        return "USED"
    now = datetime.now(timezone.utc)
    expiry = datetime.fromisoformat(doc["expiryTime"])
    if now >= expiry:
        return "EXPIRED"
    upload = datetime.fromisoformat(doc["uploadTime"])
    total = (expiry - upload).total_seconds()
    remaining = (expiry - now).total_seconds()
    if remaining <= max(60, total * 0.15):
        return "EXPIRING SOON"
    return "ACTIVE"


def remaining_seconds(doc: dict) -> int:
    now = datetime.now(timezone.utc)
    expiry = datetime.fromisoformat(doc["expiryTime"])
    return max(0, int((expiry - now).total_seconds()))


def public_share(doc: dict, owner: bool = False) -> dict:
    """Serialize a share for API output. Never leaks the internal S3 object key."""
    out = {
        "shareId": doc["shareId"],
        "originalFileName": doc["originalFileName"],
        "fileSize": doc["fileSize"],
        "contentType": doc["contentType"],
        "uploadTime": doc["uploadTime"],
        "expiryTime": doc["expiryTime"],
        "downloadCount": doc["downloadCount"],
        "maxDownloads": doc["maxDownloads"],
        "oneTime": doc["oneTime"],
        "passwordProtected": bool(doc.get("passwordHash")),
        "lifetime": doc.get("lifetime"),
        "safetyStatus": doc["safetyStatus"],
        "fileHash": doc["fileHash"],
        "status": compute_status(doc),
        "remainingSeconds": remaining_seconds(doc),
    }
    if owner:
        out["safetyChecks"] = doc.get("safetyChecks", [])
    return out


# --- Endpoints ----------------------------------------------------------------
@api_router.get("/")
async def root():
    return {"service": "DropBoxer", "status": "ok"}


@api_router.post("/scan/{file_id}")
async def scan_endpoint(file_id: str):
    """SafeDrop re-verification: re-download the object and recompute its hash."""
    doc = await db.shares.find_one({"shareId": file_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Share not found")
    data, _ = aws_service.get_object(doc["objectKey"])
    recomputed = hashlib.sha256(data).hexdigest()
    integrity_ok = recomputed == doc["fileHash"]
    return {
        "shareId": file_id,
        "safetyStatus": doc["safetyStatus"],
        "fileHash": recomputed,
        "integrityVerified": integrity_ok,
        "checks": doc.get("safetyChecks", []),
    }


@api_router.post("/upload")
async def upload(
    file: UploadFile = File(...),
    lifetime: str = Form(...),
    oneTime: bool = Form(False),
    password: str = Form(None),
    sessionId: str = Form(...),
):
    data = await file.read()

    # FEATURE 3 — SafeDrop validation (runs before the file becomes shareable)
    safety_status, checks, file_hash = scan_file(file.filename, data, file.content_type)
    if safety_status != "verified":
        return JSONResponse(status_code=422, content={
            "safetyStatus": "rejected",
            "safetyChecks": checks,
            "message": "Upload rejected — File failed safety validation",
        })

    minutes = LIFETIME_MAP.get(lifetime)
    if minutes is None:
        raise HTTPException(status_code=400, detail="Invalid lifetime option")

    # Upload bytes to private object storage (Amazon S3 in production)
    object_key = aws_service.generate_object_key(sessionId, file.filename)
    aws_service.put_object(object_key, data, file.content_type or "application/octet-stream")

    now = datetime.now(timezone.utc)
    expiry = now + timedelta(minutes=minutes)
    share_id = "DBX-" + secrets.token_hex(4).upper()  # 32 bits of entropy, hard to guess

    doc = {
        "shareId": share_id,
        "originalFileName": file.filename,
        "objectKey": object_key,
        "fileSize": len(data),
        "contentType": file.content_type or "application/octet-stream",
        "uploadTime": now.isoformat(),
        "expiryTime": expiry.isoformat(),
        "downloadCount": 0,
        "maxDownloads": 1 if oneTime else 1_000_000,
        "oneTime": bool(oneTime),
        "passwordHash": hash_password(password) if password else None,
        "lifetime": lifetime,
        "status": "ACTIVE",
        "safetyStatus": safety_status,
        "safetyChecks": checks,
        "fileHash": file_hash,
        "sessionId": sessionId,
    }
    await db.shares.insert_one(doc)
    logger.info(f"Created share {share_id} ({file.filename}, {len(data)}B, oneTime={oneTime})")
    return public_share(doc, owner=True)


@api_router.get("/shares")
async def list_shares(sessionId: str = Query(...)):
    docs = await db.shares.find({"sessionId": sessionId}).sort("uploadTime", -1).to_list(200)
    return [public_share(d, owner=True) for d in docs]


@api_router.get("/share/{share_id}")
async def get_share(share_id: str):
    doc = await db.shares.find_one({"shareId": share_id})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "invalid", "message": "Invalid or unavailable share."})
    return public_share(doc)


@api_router.get("/status/{share_id}")
async def get_status(share_id: str):
    doc = await db.shares.find_one({"shareId": share_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Invalid share")
    return {
        "shareId": share_id,
        "status": compute_status(doc),
        "remainingSeconds": remaining_seconds(doc),
        "downloadCount": doc["downloadCount"],
        "maxDownloads": doc["maxDownloads"],
    }


@api_router.get("/download/{share_id}")
async def download(share_id: str, pw: str = Query(None)):
    """Authorization gate. Validates access, then mints a short-lived signed URL.
    Does NOT consume the share — consumption happens atomically when bytes stream."""
    doc = await db.shares.find_one({"shareId": share_id})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "invalid", "message": "Invalid or unavailable share."})
    if doc["safetyStatus"] != "verified":
        return JSONResponse(status_code=403, content={"error": "unsafe", "message": "File failed safety validation."})
    st = compute_status(doc)
    if st == "EXPIRED":
        return JSONResponse(status_code=410, content={"error": "expired", "message": "This file has expired and is no longer available."})
    if st == "USED" or doc["downloadCount"] >= doc["maxDownloads"]:
        return JSONResponse(status_code=410, content={"error": "used", "message": "This one-time link has already been used."})

    # AccessGuard — password must be verified before any download URL is minted.
    if doc.get("passwordHash"):
        if not pw:
            return JSONResponse(status_code=401, content={"error": "password_required", "message": "This share is password protected."})
        if not verify_password(pw, doc["passwordHash"]):
            return JSONResponse(status_code=401, content={"error": "incorrect_password", "message": "Incorrect password."})

    token = aws_service.generate_download_token(share_id)
    return {"downloadUrl": f"/api/file/{share_id}?token={token}", "token": token}


@api_router.post("/verify/{share_id}")
async def verify_share_password(share_id: str, body: dict = Body(...)):
    """AccessGuard — verify the share password, then mint a temporary secure download URL."""
    doc = await db.shares.find_one({"shareId": share_id})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "invalid", "message": "Invalid or unavailable share."})
    if not doc.get("passwordHash"):
        return {"verified": True, "passwordRequired": False}

    password = (body.get("password") or "").strip()
    if not password or not verify_password(password, doc["passwordHash"]):
        return JSONResponse(status_code=401, content={"error": "incorrect_password", "message": "Incorrect password. Please try again."})

    # Password is correct — still enforce SafeDrop, TimeVault and Burn gates.
    if doc["safetyStatus"] != "verified":
        return JSONResponse(status_code=403, content={"error": "unsafe", "message": "File failed safety validation."})
    st = compute_status(doc)
    if st == "EXPIRED":
        return JSONResponse(status_code=410, content={"error": "expired", "message": "This file has expired and is no longer available."})
    if st == "USED" or doc["downloadCount"] >= doc["maxDownloads"]:
        return JSONResponse(status_code=410, content={"error": "used", "message": "This one-time link has already been used."})

    token = aws_service.generate_download_token(share_id)
    return {"verified": True, "passwordRequired": True,
            "downloadUrl": f"/api/file/{share_id}?token={token}", "token": token}


@api_router.post("/consume/{share_id}")
async def consume(share_id: str):
    """Record a successful download atomically (Burn After Download enforcement)."""
    doc = await db.shares.find_one({"shareId": share_id})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "invalid"})
    if compute_status(doc) == "EXPIRED":
        return JSONResponse(status_code=410, content={"error": "expired"})

    updated = await db.shares.find_one_and_update(
        {"shareId": share_id, "status": {"$ne": "USED"},
         "$expr": {"$lt": ["$downloadCount", "$maxDownloads"]}},
        {"$inc": {"downloadCount": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        return JSONResponse(status_code=410, content={"error": "used", "message": "This one-time link has already been used."})

    if updated["oneTime"] and updated["downloadCount"] >= updated["maxDownloads"]:
        await db.shares.update_one({"shareId": share_id},
                                   {"$set": {"status": "USED", "usedAt": datetime.now(timezone.utc).isoformat()}})
        updated = await db.shares.find_one({"shareId": share_id})
    return public_share(updated)


@api_router.get("/file/{share_id}")
async def file_stream(share_id: str, token: str = Query(...)):
    """Streams the file bytes and atomically consumes the share (burn point)."""
    payload = aws_service.verify_download_token(token)
    if not payload or payload.get("sid") != share_id:
        raise HTTPException(status_code=403, detail="Invalid or expired download token")

    doc = await db.shares.find_one({"shareId": share_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Invalid share")
    if compute_status(doc) == "EXPIRED":
        return JSONResponse(status_code=410, content={"error": "expired", "message": "This file has expired."})

    # Fetch bytes BEFORE burning so a storage failure can't consume a one-time link.
    data, ct = aws_service.get_object(doc["objectKey"])

    updated = await db.shares.find_one_and_update(
        {"shareId": share_id, "status": {"$ne": "USED"},
         "$expr": {"$lt": ["$downloadCount", "$maxDownloads"]}},
        {"$inc": {"downloadCount": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        return JSONResponse(status_code=410, content={"error": "used", "message": "This one-time link has already been used."})

    if updated["oneTime"] and updated["downloadCount"] >= updated["maxDownloads"]:
        await db.shares.update_one({"shareId": share_id},
                                   {"$set": {"status": "USED", "usedAt": datetime.now(timezone.utc).isoformat()}})

    return Response(
        content=data,
        media_type=updated["contentType"] or ct,
        headers={"Content-Disposition": f'attachment; filename="{updated["originalFileName"]}"'},
    )


@api_router.delete("/share/{share_id}")
async def revoke_share(share_id: str, sessionId: str = Query(...)):
    """Owner revoke — marks the share used so it can no longer be downloaded."""
    res = await db.shares.update_one(
        {"shareId": share_id, "sessionId": sessionId},
        {"$set": {"status": "USED", "revokedAt": datetime.now(timezone.utc).isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Share not found")
    return {"shareId": share_id, "status": "USED", "revoked": True}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    try:
        aws_service.init_storage()
        logger.info("Object storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
