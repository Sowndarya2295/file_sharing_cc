"""AccessGuard tests — password-protected shares."""
import os
import io
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://burn-share.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
SESSION = "sess_pwtest"


def _upload(filename="pw.txt", content=b"protected data", content_type="text/plain",
            lifetime="15m", one_time=False, password=None, session=SESSION):
    files = {"file": (filename, io.BytesIO(content), content_type)}
    data = {"lifetime": lifetime, "oneTime": str(one_time).lower(), "sessionId": session}
    if password is not None:
        data["password"] = password
    return requests.post(f"{API}/upload", files=files, data=data, timeout=60)


class TestAccessGuardUpload:
    def test_upload_with_password_hashes_and_hides(self):
        r = _upload("TEST_pw1.txt", b"secret", password="open123")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["passwordProtected"] is True
        assert "passwordHash" not in d
        assert "password" not in d
        sid = d["shareId"]

        # Verify hash in Mongo starts with $2b$
        import pymongo
        mc = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        db = mc[os.environ.get("DB_NAME", "test_database")]
        doc = db.shares.find_one({"shareId": sid})
        assert doc is not None
        ph = doc.get("passwordHash")
        assert ph and ph.startswith("$2b$")
        assert ph != "open123"

    def test_get_share_no_hash_leak(self):
        r = _upload("TEST_pw2.txt", b"secret", password="open123")
        sid = r.json()["shareId"]
        s = requests.get(f"{API}/share/{sid}", timeout=15).json()
        assert s["passwordProtected"] is True
        assert "passwordHash" not in s

    def test_list_shares_no_hash_leak(self):
        session = "sess_pw_list"
        r = _upload("TEST_pw_list.txt", b"x", password="open123", session=session)
        assert r.status_code == 200
        lst = requests.get(f"{API}/shares", params={"sessionId": session}, timeout=15).json()
        assert any(x["shareId"] == r.json()["shareId"] and x["passwordProtected"] is True for x in lst)
        for x in lst:
            assert "passwordHash" not in x


class TestAccessGuardDownload:
    def test_download_requires_password(self):
        r = _upload("TEST_pwd.txt", b"secret", password="open123")
        sid = r.json()["shareId"]
        d = requests.get(f"{API}/download/{sid}", timeout=15)
        assert d.status_code == 401
        assert d.json().get("error") == "password_required"

    def test_download_wrong_password(self):
        r = _upload("TEST_pwd2.txt", b"secret", password="open123")
        sid = r.json()["shareId"]
        d = requests.get(f"{API}/download/{sid}", params={"pw": "wrong"}, timeout=15)
        assert d.status_code == 401
        assert d.json().get("error") == "incorrect_password"

    def test_download_correct_password(self):
        r = _upload("TEST_pwd3.txt", b"secret", password="open123")
        sid = r.json()["shareId"]
        d = requests.get(f"{API}/download/{sid}", params={"pw": "open123"}, timeout=15)
        assert d.status_code == 200
        assert "downloadUrl" in d.json()

    def test_unprotected_download_regression(self):
        r = _upload("TEST_unprot.txt", b"open", password=None)
        sid = r.json()["shareId"]
        assert r.json()["passwordProtected"] is False
        d = requests.get(f"{API}/download/{sid}", timeout=15)
        assert d.status_code == 200
        assert "downloadUrl" in d.json()


class TestAccessGuardVerify:
    def test_verify_wrong_password(self):
        r = _upload("TEST_v1.txt", b"secret", password="open123")
        sid = r.json()["shareId"]
        v = requests.post(f"{API}/verify/{sid}", json={"password": "wrong"}, timeout=15)
        assert v.status_code == 401
        assert v.json().get("error") == "incorrect_password"

    def test_verify_correct_password(self):
        r = _upload("TEST_v2.txt", b"secret", password="open123")
        sid = r.json()["shareId"]
        v = requests.post(f"{API}/verify/{sid}", json={"password": "open123"}, timeout=15)
        assert v.status_code == 200
        j = v.json()
        assert j["verified"] is True
        assert j["downloadUrl"].startswith("/api/file/")
        assert "token" in j


class TestAccessGuardCombos:
    def test_password_plus_burn(self):
        r = _upload("TEST_pwb.txt", b"burn+pw", password="open123", one_time=True)
        sid = r.json()["shareId"]
        # correct verify
        v = requests.post(f"{API}/verify/{sid}", json={"password": "open123"}, timeout=15)
        assert v.status_code == 200
        url = v.json()["downloadUrl"]
        # stream once
        f1 = requests.get(f"{BASE_URL}{url}", timeout=30)
        assert f1.status_code == 200
        assert f1.content == b"burn+pw"
        # second verify -> used
        v2 = requests.post(f"{API}/verify/{sid}", json={"password": "open123"}, timeout=15)
        assert v2.status_code == 410
        assert v2.json().get("error") == "used"

    def test_password_plus_expiry(self):
        r = _upload("TEST_pwe.txt", b"expired+pw", password="open123", lifetime="5m")
        sid = r.json()["shareId"]
        import pymongo
        mc = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        db = mc[os.environ.get("DB_NAME", "test_database")]
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        db.shares.update_one({"shareId": sid}, {"$set": {"expiryTime": past}})
        v = requests.post(f"{API}/verify/{sid}", json={"password": "open123"}, timeout=15)
        assert v.status_code == 410
        assert v.json().get("error") == "expired"

    def test_password_plus_safedrop(self):
        # SafeDrop should reject .exe before password logic runs
        r = _upload("TEST_evil.exe", b"MZ", "application/octet-stream", password="open123")
        assert r.status_code == 422
        assert r.json()["safetyStatus"] == "rejected"
