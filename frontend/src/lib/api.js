import axios from "axios";

// The frontend talks ONLY to this backend API abstraction — it never touches
// AWS credentials directly. Each function maps to an AWS-backed backend route.
const BACKEND = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND}/api`;

// createShare / uploadFile — POST /api/upload  (S3 put_object + DynamoDB put)
export async function uploadFile({ file, lifetime, oneTime, password, sessionId, onProgress }) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("lifetime", lifetime);
  fd.append("oneTime", oneTime);
  if (password) fd.append("password", password);
  fd.append("sessionId", sessionId);
  const res = await axios.post(`${API}/upload`, fd, {
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
  return res.data;
}
export const createShare = uploadFile;

// generateUploadUrl — in production this returns an S3 pre-signed PUT URL.
export const generateUploadUrl = () => ({ mode: "server-managed", endpoint: `${API}/upload` });

// getShare / validateShare — GET /api/share/:id  (DynamoDB get + expiry check)
export async function getShare(shareId) {
  const res = await axios.get(`${API}/share/${shareId}`);
  return res.data;
}
export const validateShare = getShare;

// getStatus — GET /api/status/:id
export async function getStatus(shareId) {
  const res = await axios.get(`${API}/status/${shareId}`);
  return res.data;
}

// generateDownloadUrl — GET /api/download/:id  (auth check -> S3 pre-signed GET)
export async function generateDownloadUrl(shareId) {
  const res = await axios.get(`${API}/download/${shareId}`);
  return res.data;
}

// verifySharePassword (AccessGuard) — POST /api/verify/:id  (bcrypt check -> download URL)
export async function verifySharePassword(shareId, password) {
  const res = await axios.post(`${API}/verify/${shareId}`, { password });
  return res.data;
}

// consumeShare — POST /api/consume/:id  (Burn After Download record)
export async function consumeShare(shareId) {
  const res = await axios.post(`${API}/consume/${shareId}`);
  return res.data;
}

// scanFile — POST /api/scan/:id  (SafeDrop re-verification via Lambda)
export async function scanFile(fileId) {
  const res = await axios.post(`${API}/scan/${fileId}`);
  return res.data;
}

export async function listShares(sessionId) {
  const res = await axios.get(`${API}/shares`, { params: { sessionId } });
  return res.data;
}

export async function revokeShare(shareId, sessionId) {
  const res = await axios.delete(`${API}/share/${shareId}`, { params: { sessionId } });
  return res.data;
}

export const buildFileUrl = (downloadUrl) => `${BACKEND}${downloadUrl}`;
export const buildShareLink = (shareId) => `${window.location.origin}/share/${shareId}`;
