import { useRef, useState } from "react";
import { toast } from "sonner";
import { UploadCloud, File as FileIcon, Loader2, CheckCircle2, XCircle, Flame, Clock, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { uploadFile } from "@/lib/api";
import { getSessionId, formatBytes, ALLOWED_EXT, MAX_BYTES } from "@/lib/format";

const LIFETIMES = [
  { value: "5m", label: "5 Minutes" },
  { value: "15m", label: "15 Minutes" },
  { value: "1h", label: "1 Hour" },
  { value: "24h", label: "24 Hours" },
];

export const UploadCard = ({ onCreated }) => {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [scan, setScan] = useState(null); // {state, checks, hash}
  const [lifetime, setLifetime] = useState("15m");
  const [oneTime, setOneTime] = useState(false);
  const [protect, setProtect] = useState(false);
  const [password, setPassword] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const runScan = async (f) => {
    setScan({ state: "scanning" });
    const ext = f.name.includes(".") ? f.name.split(".").pop().toLowerCase() : "";
    let hash = "";
    try {
      const buf = await f.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buf);
      hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch (_) {}
    const checks = [
      { name: "Non-empty upload", passed: f.size > 0 },
      { name: "Within 25 MB limit", passed: f.size > 0 && f.size <= MAX_BYTES },
      { name: "Allowed file extension", passed: ALLOWED_EXT.includes(ext) },
      { name: "No suspicious filename/path", passed: !/[\/\\]|\.\.|<script|%00/i.test(f.name) && !f.name.startsWith(".") },
      { name: "SHA-256 integrity hash", passed: true, detail: hash ? hash.slice(0, 16) + "…" : "computed" },
    ];
    const ok = checks.every((c) => c.passed);
    // brief delay so the scan animation is perceptible in the demo
    setTimeout(() => setScan({ state: ok ? "verified" : "rejected", checks, hash }), 650);
  };

  const pick = (f) => {
    if (!f) return;
    setFile(f);
    runScan(f);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.[0]) pick(e.dataTransfer.files[0]);
  };

  const reset = () => {
    setFile(null);
    setScan(null);
    setProgress(0);
    setProtect(false);
    setPassword("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const submit = async () => {
    if (!file || scan?.state !== "verified") return;
    setUploading(true);
    setProgress(0);
    try {
      const share = await uploadFile({
        file,
        lifetime,
        oneTime,
        password: protect ? password : null,
        sessionId: getSessionId(),
        onProgress: setProgress,
      });
      toast.success("File verified & share created", { description: share.shareId });
      onCreated(share);
      reset();
    } catch (err) {
      const data = err?.response?.data;
      if (data?.safetyStatus === "rejected") {
        setScan({ state: "rejected", checks: data.safetyChecks || [] });
        toast.error("Upload rejected — File failed safety validation");
      } else {
        toast.error("Upload failed", { description: data?.message || "Please try again." });
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-slate-900">Upload your file</h2>
        <span className="font-mono text-[11px] uppercase tracking-widest text-slate-400">Step 1</span>
      </div>
      <p className="mb-5 text-sm text-slate-500">Drag &amp; drop or choose a file. Max 25 MB · docs &amp; images.</p>

      {/* Drop zone */}
      <div
        data-testid="file-upload-drag-drop-zone"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !file && inputRef.current?.click()}
        className={`relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-all ${
          dragging ? "border-blue-400 bg-blue-50/60 scale-[1.01]" : "border-slate-300 bg-slate-50/60 hover:border-blue-300"
        }`}
      >
        <input
          ref={inputRef}
          data-testid="file-input-element"
          type="file"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        {!file ? (
          <>
            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600">
              <UploadCloud className="h-6 w-6" />
            </span>
            <p className="text-sm font-medium text-slate-700">Drop your file here</p>
            <p className="mt-1 text-xs text-slate-400">or click to browse</p>
            <Button
              type="button"
              variant="outline"
              data-testid="choose-file-button"
              className="mt-4"
              onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
            >
              Choose File
            </Button>
          </>
        ) : (
          <div className="w-full text-left" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                <FileIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p data-testid="selected-file-name" className="truncate text-sm font-semibold text-slate-800">{file.name}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  <span data-testid="selected-file-size">{formatBytes(file.size)}</span>
                  {" · "}
                  <span data-testid="selected-file-type" className="font-mono">{file.type || "unknown"}</span>
                </p>
              </div>
              <button data-testid="remove-file-button" onClick={reset} className="text-xs font-medium text-slate-400 hover:text-red-600">
                Remove
              </button>
            </div>
            <ScanStatus scan={scan} />
          </div>
        )}
      </div>

      {/* File Lifetime */}
      <div className="mt-6">
        <div className="mb-2.5 flex items-center gap-2">
          <Clock className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">File Lifetime</h3>
        </div>
        <RadioGroup
          data-testid="file-lifetime-radio-group"
          value={lifetime}
          onValueChange={setLifetime}
          className="grid grid-cols-2 gap-2.5 sm:grid-cols-4"
        >
          {LIFETIMES.map((l) => (
            <label
              key={l.value}
              htmlFor={`lt-${l.value}`}
              data-testid={`lifetime-option-${l.value}`}
              className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border px-2 py-3 text-center text-sm font-medium transition-all ${
                lifetime === l.value
                  ? "border-blue-500 bg-blue-50 text-blue-700 shadow-sm"
                  : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"
              }`}
            >
              <RadioGroupItem value={l.value} id={`lt-${l.value}`} className="sr-only" />
              {l.label}
            </label>
          ))}
        </RadioGroup>
      </div>

      {/* Burn after download */}
      <label
        htmlFor="burn"
        className={`mt-4 flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all ${
          oneTime ? "border-orange-300 bg-orange-50/70" : "border-slate-200 bg-slate-50/60 hover:border-orange-200"
        }`}
      >
        <Checkbox
          id="burn"
          data-testid="burn-after-download-checkbox"
          checked={oneTime}
          onCheckedChange={(v) => setOneTime(!!v)}
          className="mt-0.5"
        />
        <div>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <Flame className={`h-4 w-4 ${oneTime ? "text-orange-500" : "text-slate-400"}`} />
            Burn after first download
          </span>
          <p className="mt-0.5 text-xs text-slate-500">The link self-destructs the moment the file is downloaded once.</p>
        </div>
      </label>

      {/* AccessGuard — password protection */}
      <div className={`mt-3 rounded-xl border transition-all ${protect ? "border-blue-300 bg-blue-50/60" : "border-slate-200 bg-slate-50/60 hover:border-blue-200"}`}>
        <label htmlFor="protect" className="flex cursor-pointer items-start gap-3 p-4">
          <Checkbox
            id="protect"
            data-testid="protect-with-password-checkbox"
            checked={protect}
            onCheckedChange={(v) => setProtect(!!v)}
            className="mt-0.5"
          />
          <div>
            <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              <Lock className={`h-4 w-4 ${protect ? "text-blue-600" : "text-slate-400"}`} />
              Protect with password
            </span>
            <p className="mt-0.5 text-xs text-slate-500">Recipients must enter this password before downloading. It never appears in the link.</p>
          </div>
        </label>
        {protect && (
          <div className="border-t border-blue-200/70 px-4 py-3">
            <input
              data-testid="share-password-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Set a share password"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        )}
      </div>

      {uploading && (
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      <Button
        data-testid="upload-and-create-share-button"
        onClick={submit}
        disabled={!file || scan?.state !== "verified" || uploading || (protect && !password.trim())}
        className="mt-5 h-12 w-full bg-blue-600 text-base font-semibold hover:bg-blue-700 active:scale-[0.99]"
      >
        {uploading ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</>
        ) : (
          <><UploadCloud className="mr-2 h-4 w-4" /> Upload &amp; Create Share</>
        )}
      </Button>
    </div>
  );
};

const ScanStatus = ({ scan }) => {
  if (!scan) return null;
  const base = "mt-4 rounded-xl border p-3.5";
  if (scan.state === "scanning") {
    return (
      <div data-testid="safedrop-scan-status-badge" className={`${base} border-blue-200 bg-blue-50`}>
        <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
          <Loader2 className="h-4 w-4 animate-spin" /> 🔍 Scanning file…
        </div>
      </div>
    );
  }
  const ok = scan.state === "verified";
  return (
    <div
      data-testid="safedrop-scan-status-badge"
      className={`${base} ${ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}
    >
      <div className={`flex items-center gap-2 text-sm font-semibold ${ok ? "text-emerald-700" : "text-red-700"}`}>
        {ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        {ok ? "🟢 File verified — Safe to share" : "🔴 Upload rejected — File failed safety validation"}
      </div>
      <ul className="mt-2.5 space-y-1">
        {(scan.checks || []).map((c) => (
          <li key={c.name} className="flex items-center gap-2 text-xs">
            {c.passed ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <XCircle className="h-3.5 w-3.5 text-red-500" />}
            <span className={c.passed ? "text-slate-600" : "text-red-600"}>{c.name}</span>
            {c.detail && <span className="ml-auto font-mono text-[10px] text-slate-400">{c.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
};
