import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { Download, Loader2, FileText, Clock3, Hash, ShieldCheck, ArrowLeft } from "lucide-react";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Countdown } from "@/components/Countdown";
import { getShare, generateDownloadUrl, buildFileUrl } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";

export default function SharePage() {
  const { shareId } = useParams();
  const [share, setShare] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // "invalid" | "expired" | "used"
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getShare(shareId);
      setShare(data);
      if (data.status === "EXPIRED") setError("expired");
      else if (data.status === "USED") setError("used");
      else setError(null);
    } catch (err) {
      setError(err?.response?.status === 404 ? "invalid" : "invalid");
    } finally {
      setLoading(false);
    }
  }, [shareId]);

  useEffect(() => { load(); }, [load]);

  const download = async () => {
    setDownloading(true);
    try {
      const { downloadUrl } = await generateDownloadUrl(shareId);
      window.location.href = buildFileUrl(downloadUrl);
      toast.success("Download started");
      // Refresh after the burn is recorded
      setTimeout(load, 2500);
    } catch (err) {
      const code = err?.response?.data?.error;
      if (code === "expired") setError("expired");
      else if (code === "used") setError("used");
      toast.error(err?.response?.data?.message || "Download unavailable");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <Header />
      <div className="dbx-grid min-h-[calc(100vh-57px)] bg-white">
        <div className="mx-auto flex max-w-lg flex-col px-4 py-14 sm:px-6">
          {loading ? (
            <div className="flex items-center justify-center py-24 text-slate-400">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading share…
            </div>
          ) : error ? (
            <ErrorCard error={error} />
          ) : (
            <div data-testid="share-access-card" className="dbx-fade-up rounded-2xl border border-slate-200 bg-white p-6 shadow-md sm:p-8">
              <div className="mb-6 text-center">
                <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white">
                  <FileText className="h-6 w-6" />
                </span>
                <p className="font-mono text-[11px] uppercase tracking-widest text-blue-600">Secure Download</p>
                <h1 className="mt-1 break-words font-display text-xl font-bold text-slate-900">{share.originalFileName}</h1>
              </div>

              <div className="space-y-0 rounded-xl bg-slate-50 px-4 py-1">
                <Row label="File Size">{formatBytes(share.fileSize)}</Row>
                <Row label="File Type"><span className="font-mono text-xs">{share.contentType}</span></Row>
                <Row label="Security"><span className="text-emerald-600">🟢 Verified</span></Row>
                <Row label="Expires">
                  <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 text-slate-400" />{formatDateTime(share.expiryTime)}</span>
                </Row>
                <Row label="Remaining">
                  <Countdown expiryTime={share.expiryTime} status={share.status} className="font-mono text-blue-600" testId="share-countdown" />
                </Row>
                <Row label="Downloads">{share.downloadCount} / {share.oneTime ? 1 : "∞"}</Row>
              </div>

              <div className="mt-4 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2">
                <Hash className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
                <span className="truncate font-mono text-[11px] text-slate-500" title={share.fileHash}>{share.fileHash}</span>
              </div>

              {share.oneTime && (
                <p className="mt-4 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-center text-sm text-orange-700">
                  🔥 One-time link — this file burns after you download it.
                </p>
              )}

              <Button
                data-testid="download-securely-button"
                onClick={download}
                disabled={downloading}
                className="mt-6 h-12 w-full bg-blue-600 text-base font-semibold hover:bg-blue-700 active:scale-[0.99]"
              >
                {downloading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing…</> : <><Download className="mr-2 h-4 w-4" /> Download Securely</>}
              </Button>
              <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400">
                <ShieldCheck className="h-3.5 w-3.5" /> Delivered via a private, expiring backend link.
              </p>
            </div>
          )}

          <Link to="/" className="mt-6 inline-flex items-center justify-center gap-1.5 text-sm font-medium text-slate-500 hover:text-blue-600">
            <ArrowLeft className="h-4 w-4" /> Back to DropBoxer
          </Link>
        </div>
      </div>
    </div>
  );
}

const Row = ({ label, children }) => (
  <div className="flex items-center justify-between border-b border-slate-100 py-2.5 last:border-0">
    <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
    <span className="text-sm font-semibold text-slate-800">{children}</span>
  </div>
);

const ERRORS = {
  expired: { emoji: "❌", title: "This file has expired.", desc: "This file has expired and is no longer available." },
  used: { emoji: "🔥", title: "This one-time link has already been used.", desc: "This file has already been downloaded and the share link is no longer valid." },
  invalid: { emoji: "⚠️", title: "Invalid or unavailable share.", desc: "This share link is invalid, was revoked, or no longer exists." },
};

const ErrorCard = ({ error }) => {
  const e = ERRORS[error] || ERRORS.invalid;
  return (
    <div data-testid="share-access-card" className="dbx-fade-up rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-md">
      <div className="mb-4 text-5xl" data-testid="share-error-state">{e.emoji}</div>
      <h1 className="font-display text-xl font-bold text-slate-900">{e.title}</h1>
      <p className="mx-auto mt-2 max-w-xs text-sm text-slate-500">{e.desc}</p>
    </div>
  );
};
