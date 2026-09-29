import { toast } from "sonner";
import { Copy, Trash2, FileText, LayoutGrid, RefreshCw, Lock } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { Countdown } from "@/components/Countdown";
import { revokeShare, scanFile, buildShareLink } from "@/lib/api";
import { getSessionId, formatBytes, formatTime } from "@/lib/format";

export const SharesDashboard = ({ shares, onChange }) => {
  const copy = (id) => {
    navigator.clipboard.writeText(buildShareLink(id));
    toast.success("Share link copied");
  };

  const revoke = async (id) => {
    try {
      await revokeShare(id, getSessionId());
      toast.success("Share revoked");
      onChange();
    } catch {
      toast.error("Could not revoke share");
    }
  };

  const reverify = async (id) => {
    try {
      const r = await scanFile(id);
      toast[r.integrityVerified ? "success" : "error"](
        r.integrityVerified ? "🟢 Hash verified — integrity intact" : "🔴 Integrity check failed"
      );
    } catch {
      toast.error("Re-verification failed");
    }
  };

  return (
    <section id="dashboard" className="scroll-mt-24">
      <div className="mb-5 flex items-center gap-2">
        <LayoutGrid className="h-5 w-5 text-blue-600" />
        <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900">My Shares</h2>
        <span className="ml-1 rounded-full bg-slate-100 px-2.5 py-0.5 font-mono text-xs text-slate-500">
          {shares.length}
        </span>
      </div>

      {shares.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 py-14 text-center">
          <FileText className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          <p className="text-sm text-slate-500">No shares yet. Upload a file to create your first secure share.</p>
        </div>
      ) : (
        <div data-testid="my-shares-dashboard-grid" className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {shares.map((s) => (
            <div
              key={s.shareId}
              data-testid={`share-card-${s.shareId}`}
              className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                      <span className="truncate">{s.originalFileName}</span>
                      {s.passwordProtected && <Lock className="h-3 w-3 flex-shrink-0 text-blue-500" />}
                    </p>
                    <p className="font-mono text-[11px] text-slate-400">{s.shareId}</p>
                  </div>
                </div>
                <StatusBadge status={s.status} testId={`card-status-${s.shareId}`} />
              </div>

              <div className="grid grid-cols-2 gap-y-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs">
                <Meta label="Created" value={formatTime(s.uploadTime)} />
                <Meta label="Size" value={formatBytes(s.fileSize)} />
                <Meta label="Security" value={<span className="text-emerald-600">🟢 Verified</span>} />
                <Meta label="Downloads" value={`${s.downloadCount} / ${s.oneTime ? 1 : "∞"}`} />
                <Meta
                  label="Remaining"
                  value={<Countdown expiryTime={s.expiryTime} status={s.status} className="font-mono text-blue-600" />}
                />
                <Meta label="Type" value={s.oneTime ? "🔥 Burn" : "Standard"} />
              </div>

              <div className="mt-3 flex items-center gap-1.5">
                <ActionBtn testId={`copy-${s.shareId}`} onClick={() => copy(s.shareId)} icon={Copy} label="Copy" />
                <ActionBtn testId={`reverify-${s.shareId}`} onClick={() => reverify(s.shareId)} icon={RefreshCw} label="Re-verify" />
                <ActionBtn testId={`revoke-${s.shareId}`} onClick={() => revoke(s.shareId)} icon={Trash2} label="Revoke" danger />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

const Meta = ({ label, value }) => (
  <div>
    <span className="block text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
    <span className="font-medium text-slate-700">{value}</span>
  </div>
);

const ActionBtn = ({ onClick, icon: Icon, label, danger, testId }) => (
  <button
    data-testid={testId}
    onClick={onClick}
    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
      danger
        ? "border-slate-200 text-slate-500 hover:border-red-300 hover:bg-red-50 hover:text-red-600"
        : "border-slate-200 text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
    }`}
  >
    <Icon className="h-3.5 w-3.5" /> {label}
  </button>
);
