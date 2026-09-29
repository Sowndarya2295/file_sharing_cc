import { Link, useLocation } from "react-router-dom";
import { ShieldCheck, Cloud } from "lucide-react";

const NAV = [
  { label: "Upload & Share", href: "/#upload" },
  { label: "My Shares", href: "/#dashboard" },
  { label: "AWS Architecture", href: "/#architecture" },
];

export const Header = () => {
  const { pathname } = useLocation();
  return (
    <header
      data-testid="dropboxer-header-nav"
      className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/85 backdrop-blur-xl"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6 lg:px-8">
        <Link to="/" data-testid="brand-logo" className="group flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-600/30 transition-transform group-hover:scale-105">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <span className="font-display text-lg font-extrabold tracking-tight text-slate-900">
            Drop<span className="text-blue-600">Boxer</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <a
              key={n.label}
              href={n.href}
              data-testid={`nav-${n.label.split(" ")[0].toLowerCase()}`}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 sm:flex">
          <Cloud className="h-3.5 w-3.5 text-blue-600" />
          <span className="font-mono text-[11px] font-medium uppercase tracking-widest text-slate-500">
            AWS Serverless
          </span>
        </div>
      </div>
      {pathname.startsWith("/share") && (
        <div className="border-t border-blue-100 bg-blue-50/60 py-1.5 text-center font-mono text-[11px] uppercase tracking-widest text-blue-700">
          Secure Share Access
        </div>
      )}
    </header>
  );
};
