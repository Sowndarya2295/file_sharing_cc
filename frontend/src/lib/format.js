export const getSessionId = () => {
  let id = localStorage.getItem("dbx_session");
  if (!id) {
    id = "sess_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("dbx_session", id);
  }
  return id;
};

export const formatBytes = (b) => {
  if (!b) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
};

export const formatTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export const formatDateTime = (iso) =>
  new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export const formatCountdown = (secs) => {
  if (secs <= 0) return "00:00";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

export const ALLOWED_EXT = [
  "pdf", "png", "jpg", "jpeg", "gif", "webp", "doc", "docx",
  "txt", "csv", "zip", "xls", "xlsx", "ppt", "pptx", "md", "json",
];

export const MAX_BYTES = 25 * 1024 * 1024;
