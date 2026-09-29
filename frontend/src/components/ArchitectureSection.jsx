import { Cloud, Database, Server, Network, ShieldCheck, Bell } from "lucide-react";

const SERVICES = [
  { icon: Server, name: "Amazon S3", desc: "Private object storage for uploaded files" },
  { icon: Network, name: "API Gateway", desc: "REST entrypoint for all client requests" },
  { icon: Cloud, name: "AWS Lambda", desc: "Serverless upload, validation & download logic" },
  { icon: Database, name: "DynamoDB", desc: "Share & file metadata store" },
  { icon: Bell, name: "S3 Events", desc: "Trigger SafeDrop validation after upload" },
  { icon: ShieldCheck, name: "AWS IAM", desc: "Least-privilege access control" },
];

const DIAGRAM = `        Browser (React SPA)
              |
              v
      Amazon API Gateway  ──────  REST /api/*
              |
              v
         AWS Lambda  ──────────────────┐
          |      |                     │
          v      v                     v
    Amazon S3   Amazon DynamoDB   (auth + presign)
   (private)     (metadata)
      |
      | S3 upload event
      v
   AWS Lambda  ──►  SafeDrop validation  ──►  DynamoDB status update`;

export const ArchitectureSection = () => (
  <section id="architecture" className="scroll-mt-24">
    <div className="mb-2 font-mono text-xs uppercase tracking-widest text-blue-600">Cloud Design</div>
    <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">AWS Serverless Architecture</h2>
    <p className="mt-2 max-w-2xl text-sm text-slate-500">
      DropBoxer is built against a backend API abstraction that maps 1:1 to AWS managed services.
      Files stay in a private bucket and are only reachable through backend-controlled, expiring links.
    </p>

    <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
      <div className="lg:col-span-3 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <pre className="font-mono text-[12.5px] leading-relaxed text-blue-100">{DIAGRAM}</pre>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-2">
        {SERVICES.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.name} className="rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-blue-300">
              <Icon className="mb-2 h-5 w-5 text-blue-600" />
              <p className="text-sm font-semibold text-slate-800">{s.name}</p>
              <p className="mt-0.5 text-xs text-slate-500">{s.desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  </section>
);
