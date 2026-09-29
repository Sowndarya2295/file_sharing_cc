"""
DropBoxer — AWS service abstraction layer.

This module is the single seam between DropBoxer's application logic and cloud
infrastructure. In THIS preview environment the object bytes live in Emergent's
S3-compatible object store and metadata lives in MongoDB. Every function below is
written so it maps 1:1 onto real AWS primitives when you deploy:

    put_object()            -> Amazon S3  boto3.client("s3").put_object(...)     (private bucket)
    get_object()            -> Amazon S3  boto3.client("s3").get_object(...)
    generate_object_key()   -> S3 object key convention
    generate_download_token()  -> S3 pre-signed GET URL  (generate_presigned_url)
    verify_download_token()    -> (handled natively by S3 pre-signed URL expiry)

To go live: keep the same signatures, replace the request bodies with boto3 calls,
and inject credentials via IAM role / environment variables. See /app/aws/ for the
Lambda handlers, IAM least-privilege policies, and the SAM template.
"""
import os
import uuid
import requests
import jwt
from datetime import datetime, timezone, timedelta

# --- Object storage config (maps to an Amazon S3 private bucket) --------------
APP_NAME = "dropboxer"  # S3 key prefix — isolates this app's objects

_storage_key = None  # session-scoped, minted once


def _storage_url() -> str:
    base = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
    return base.rstrip("/") + "/objstore/api/v1/storage"


def token_secret() -> str:
    return os.environ.get("SHARE_TOKEN_SECRET", "dbx-dev-secret")


def init_storage(force: bool = False) -> str:
    """Authenticate with the object store and cache a session storage key."""
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    resp = requests.post(f"{_storage_url()}/init",
                         json={"emergent_key": os.environ.get("EMERGENT_LLM_KEY")}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def generate_object_key(session_id: str, filename: str) -> str:
    """Build a unique, non-guessable S3 object key. Original name is NOT in the key."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in (filename or "") else "bin"
    return f"{APP_NAME}/uploads/{session_id}/{uuid.uuid4().hex}.{ext}"


def put_object(path: str, data: bytes, content_type: str) -> dict:
    """Upload bytes to private object storage (S3 put_object equivalent)."""
    key = init_storage()
    resp = requests.put(
        f"{_storage_url()}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120,
    )
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.put(
            f"{_storage_url()}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data, timeout=120,
        )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    """Download bytes from private object storage (S3 get_object equivalent)."""
    key = init_storage()
    resp = requests.get(f"{_storage_url()}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.get(f"{_storage_url()}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


def generate_download_token(share_id: str, ttl_seconds: int = 120) -> str:
    """Mint a short-lived signed download token.

    Production equivalent: an S3 pre-signed GET URL with the same TTL. The frontend
    NEVER receives AWS credentials — only this expiring, backend-controlled token.
    """
    payload = {"sid": share_id, "exp": datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)}
    return jwt.encode(payload, token_secret(), algorithm="HS256")


def verify_download_token(token: str):
    try:
        return jwt.decode(token, token_secret(), algorithms=["HS256"])
    except Exception:
        return None
