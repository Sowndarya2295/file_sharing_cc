"""DropBoxer backend E2E tests - covers upload, safety, download, burn, expiry, revoke."""
import os
import io
import time
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://burn-share.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
SESSION = "sess_test1"


# --- helpers ---
def _upload(filename="hello.txt", content=b"hello dropboxer", content_type="text/plain",
            lifetime="15m", one_time=False, session=SESSION):
    files = {"file": (filename, io.BytesIO(content), content_type)}
    data = {"lifetime": lifetime, "oneTime": str(one_time).lower(), "sessionId": session}
    return requests.post(f"{API}/upload", files=files, data=data, timeout=60)


# --- root ---
def test_root():
    r = requests.get(f"{API}/", timeout=15)
    assert r.status_code == 200
    assert r.json().get("service") == "DropBoxer"


# --- FEATURE 3: SafeDrop ---
class TestSafeDrop:
    def test_valid_upload_verified(self):
        r = _upload("TEST_hello.txt", b"hello safe world", "text/plain", "15m", False)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["shareId"].startswith("DBX-") and len(d["shareId"]) == 12
        assert d["safetyStatus"] == "verified"
        assert d["status"] == "ACTIVE"
        assert d["downloadCount"] == 0
        assert d["maxDownloads"] >= 1000
        assert len(d["fileHash"]) == 64
        assert "objectKey" not in d

    def test_disallowed_extension_rejected(self):
        r = _upload("TEST_evil.exe", b"MZbinary", "application/octet-stream", "15m", False)
        assert r.status_code == 422
        d = r.json()
        assert d["safetyStatus"] == "rejected"
        assert "safety validation" in d["message"]

    def test_suspicious_filename_rejected(self):
        r = _upload("../TEST_evil.txt", b"hi", "text/plain", "15m", False)
        assert r.status_code == 422
        assert r.json()["safetyStatus"] == "rejected"

    def test_empty_file_rejected(self):
        r = _upload("TEST_empty.txt", b"", "text/plain", "15m", False)
        assert r.status_code == 422


# --- FEATURE 1: TimeVault ---
class TestTimeVault:
    def test_status_endpoint(self):
        r = _upload("TEST_tv.txt", b"tv", "text/plain", "15m", False)
        sid = r.json()["shareId"]
        s = requests.get(f"{API}/status/{sid}", timeout=15).json()
        assert s["status"] == "ACTIVE"
        assert s["remainingSeconds"] > 0
        assert s["downloadCount"] == 0
        assert s["maxDownloads"] >= 1000

    def test_get_share_no_objectkey(self):
        r = _upload("TEST_meta.txt", b"meta", "text/plain", "15m", False)
        sid = r.json()["shareId"]
        s = requests.get(f"{API}/share/{sid}", timeout=15)
        assert s.status_code == 200
        j = s.json()
        assert "objectKey" not in j
        assert j["shareId"] == sid

    def test_unknown_share_404(self):
        s = requests.get(f"{API}/share/DBX-DEADBEEF", timeout=15)
        assert s.status_code == 404
        assert s.json().get("error") == "invalid"

    def test_expired_via_db_mutation(self):
        """Force expiry by mutating the doc directly in Mongo, then confirm 410."""
        import pymongo
        r = _upload("TEST_exp.txt", b"expiring", "text/plain", "5m", False)
        sid = r.json()["shareId"]
        mc = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        db = mc[os.environ.get("DB_NAME", "test_database")]
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        db.shares.update_one({"shareId": sid}, {"$set": {"expiryTime": past}})
        d = requests.get(f"{API}/download/{sid}", timeout=15)
        assert d.status_code == 410
        assert d.json().get("error") == "expired"


# --- FEATURE 2: Burn After Download ---
class TestBurn:
    def test_burn_flow(self):
        r = _upload("TEST_burn.txt", b"burn once", "text/plain", "15m", True)
        assert r.status_code == 200
        j = r.json()
        assert j["oneTime"] is True
        assert j["maxDownloads"] == 1
        sid = j["shareId"]

        # First download authorization
        d1 = requests.get(f"{API}/download/{sid}", timeout=15)
        assert d1.status_code == 200
        url = d1.json()["downloadUrl"]
        assert url.startswith("/api/file/")

        # Stream file (burn point)
        f1 = requests.get(f"{BASE_URL}{url}", timeout=30)
        assert f1.status_code == 200
        assert f1.content == b"burn once"

        # Second download attempt -> 410 used
        d2 = requests.get(f"{API}/download/{sid}", timeout=15)
        assert d2.status_code == 410
        assert d2.json().get("error") == "used"

        # Try to fetch file directly with a new token — must also fail
        # We can request /download again (denied), so instead simulate direct file replay
        # by requesting /api/file with an old token: it should still fail because status=USED
        f2 = requests.get(f"{BASE_URL}{url}", timeout=15)
        assert f2.status_code == 410

    def test_consume_endpoint_one_time(self):
        r = _upload("TEST_consume.txt", b"consume once", "text/plain", "15m", True)
        sid = r.json()["shareId"]
        c1 = requests.post(f"{API}/consume/{sid}", timeout=15)
        assert c1.status_code == 200
        c2 = requests.post(f"{API}/consume/{sid}", timeout=15)
        assert c2.status_code == 410
        assert c2.json().get("error") == "used"


# --- Scan ---
class TestScan:
    def test_rescan(self):
        r = _upload("TEST_scan.txt", b"scanme", "text/plain", "15m", False)
        sid = r.json()["shareId"]
        expected = r.json()["fileHash"]
        s = requests.post(f"{API}/scan/{sid}", timeout=30)
        assert s.status_code == 200
        j = s.json()
        assert j["fileHash"] == expected
        assert j["integrityVerified"] is True
        assert isinstance(j["checks"], list) and len(j["checks"]) > 0


# --- Session listing + revoke ---
class TestSessionOps:
    def test_list_and_revoke(self):
        session = "sess_test_revoke"
        r = _upload("TEST_rev.txt", b"rev", "text/plain", "15m", False, session)
        sid = r.json()["shareId"]
        lst = requests.get(f"{API}/shares", params={"sessionId": session}, timeout=15).json()
        assert any(x["shareId"] == sid for x in lst)

        dr = requests.delete(f"{API}/share/{sid}", params={"sessionId": session}, timeout=15)
        assert dr.status_code == 200
        assert dr.json()["status"] == "USED"

        # Download should now be denied
        d = requests.get(f"{API}/download/{sid}", timeout=15)
        assert d.status_code == 410
