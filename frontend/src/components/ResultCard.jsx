import { toast } from "sonner";
import { Copy, Download, Plus, ShieldCheck, Clock3, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { Countdown } from "@/components/Countdown";
import { generateDownloadUrl, buildFileUrl, buildShareLink } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";

const Row = ({ label, children, testId }) => (
  <div className="flex items-center justify-between border-b border-slate-100 py-2.5 last:border-0">
    <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
    <span data-testid={testId} className="text-sm font-semibold text-slate-800">{children}</span>
  </div>
);

export const ResultCard = ({ share, onReset }) => {
  const link = buildShareLink(share.shareId);

  const copy = () => {
    navigator.clipboard.writeText(link);
    toast.success("Share link copied to clipboard");
  };

  const download = async () => {
    try {
      const { downloadUrl } = await generateDownloadUrl(share.shareId);
      window.location.href = buildFileUrl(downloadUrl);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Download unavailable");
    }
  };

  return (
    <div
      data-testid="share-result-card"
      className="dbx-fade-up rounded-2xl border border-blue-200 bg-white p-6 shadow-md shadow-blue-600/5 sm:p-8"
    >
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <h2 className="font-display text-xl font-bold text-slate-900">File Ready</h2>
        </div>
        <StatusBadge status={share.status} testId="result-status-badge" />
      </div>

      <div className="rounded-xl bg-slate-50 px-4 py-1">
        <Row label="Filename" testId="result-filename">{share.originalFileName}</Row>
        <Row label="Size" testId="result-size">{formatBytes(share.fileSize)}</Row>
        <Row label="Security">
          <span className="inline-flex items-center gap-1 text-emerald-600">🟢 Verified</span>
        </Row>
        <Row label="Share ID">
          <span data-testid="share-id-display" className="font-mono text-blue-600">{share.shareId}</span>
        </Row>
        <Row label="Expires" testId="result-expiry">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="h-3.5 w-3.5 text-slate-400" />
            {formatDateTime(share.expiryTime)}
          </span>
        </Row>
        <Row label="Remaining">
          <Countdown expiryTime={share.expiryTime} status={share.status} className="font-mono text-blue-600" testId="result-countdown" />
        </Row>
        <Row label="Downloads" testId="result-downloads">
          {share.downloadCount} / {share.oneTime ? 1 : "∞"}
        </Row>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2">
        <Hash className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
        <span className="truncate font-mono text-[11px] text-slate-500" title={share.fileHash}>
          {share.fileHash}
        </span>
      </div>

      <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
        ⏳ This file expires at {formatDateTime(share.expiryTime)}
        {share.oneTime && " · burns after first download"}
      </p>

      <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <Button data-testid="copy-share-link-button" onClick={copy} className="bg-blue-600 hover:bg-blue-700">
          <Copy className="mr-2 h-4 w-4" /> Copy Link
        </Button>
        <Button data-testid="download-file-button" variant="outline" onClick={download}>
          <Download className="mr-2 h-4 w-4" /> Download
        </Button>
        <Button data-testid="create-another-share-button" variant="ghost" onClick={onReset} className="text-slate-600">
          <Plus className="mr-2 h-4 w-4" /> New Share
        </Button>
      </div>
    </div>
  );
};
