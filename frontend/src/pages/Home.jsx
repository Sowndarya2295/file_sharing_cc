import { useCallback, useEffect, useState } from "react";
import { Clock, Flame, ShieldCheck } from "lucide-react";
import { Header } from "@/components/Header";
import { UploadCard } from "@/components/UploadCard";
import { ResultCard } from "@/components/ResultCard";
import { SharesDashboard } from "@/components/SharesDashboard";
import { ArchitectureSection } from "@/components/ArchitectureSection";
import { listShares } from "@/lib/api";
import { getSessionId } from "@/lib/format";

const FEATURES = [
  { icon: Clock, tag: "TimeVault", title: "Smart Expiration", desc: "Files self-expire after 5m, 15m, 1h or 24h. Access is rejected the moment the clock runs out." },
  { icon: Flame, tag: "Burn After Download", title: "One-Time Links", desc: "Optional single-use links that destroy themselves right after the first successful download." },
  { icon: ShieldCheck, tag: "SafeDrop", title: "File Validation", desc: "Extension, MIME, size & path checks plus a SHA-256 integrity hash before anything is shareable." },
];

export default function Home() {
  const [result, setResult] = useState(null);
  const [shares, setShares] = useState([]);

  const refresh = useCallback(async () => {
    try {
      setShares(await listShares(getSessionId()));
    } catch (_) {}
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  const handleCreated = (share) => {
    setResult(share);
    refresh();
  };

  return (
    <div className="min-h-screen">
      <Header />

      {/* Hero */}
      <section className="dbx-grid border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-14 text-center sm:px-6 sm:py-20 lg:px-8">
          <span className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-blue-700">
            Secure Temporary File Sharing
          </span>
          <h1 className="font-display text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            DROPBOXER
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg font-medium text-slate-500">
            Share it. Secure it. Let it disappear.
          </p>
        </div>
      </section>

      <main className="mx-auto max-w-6xl space-y-16 px-4 py-12 sm:px-6 lg:px-8">
        {/* Feature strip */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.tag} className="rounded-2xl border border-slate-200 bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
                <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
                  <Icon className="h-5 w-5" />
                </span>
                <p className="font-mono text-[11px] uppercase tracking-widest text-blue-600">{f.tag}</p>
                <p className="mt-1 font-display text-lg font-bold text-slate-900">{f.title}</p>
                <p className="mt-1.5 text-sm text-slate-500">{f.desc}</p>
              </div>
            );
          })}
        </div>

        {/* Upload + Result */}
        <section id="upload" className="grid grid-cols-1 gap-6 scroll-mt-24 lg:grid-cols-2">
          <UploadCard onCreated={handleCreated} />
          {result ? (
            <ResultCard share={result} onReset={() => setResult(null)} />
          ) : (
            <div className="flex flex-col justify-center rounded-2xl border border-dashed border-slate-300 bg-white/50 p-8 text-center">
              <ShieldCheck className="mx-auto mb-3 h-9 w-9 text-slate-300" />
              <h3 className="font-display text-lg font-bold text-slate-700">Your share appears here</h3>
              <p className="mx-auto mt-2 max-w-xs text-sm text-slate-500">
                Upload a file to generate a secure share ID, a copyable link, and a live expiry countdown.
              </p>
            </div>
          )}
        </section>

        <SharesDashboard shares={shares} onChange={refresh} />

        <ArchitectureSection />
      </main>

      <footer className="border-t border-slate-200 bg-white py-8">
        <div className="mx-auto max-w-6xl px-4 text-center sm:px-6 lg:px-8">
          <p className="font-display text-sm font-bold text-slate-800">DropBoxer</p>
          <p className="mt-1 text-xs text-slate-400">
            Secure temporary file sharing · AWS serverless architecture · S3 · Lambda · DynamoDB · API Gateway
          </p>
        </div>
      </footer>
    </div>
  );
}
