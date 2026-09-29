import { CheckCircle2, Clock, XCircle, Flame } from "lucide-react";

const META = {
  ACTIVE: { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: CheckCircle2, label: "ACTIVE" },
  "EXPIRING SOON": { cls: "bg-amber-50 text-amber-700 border-amber-200", Icon: Clock, label: "EXPIRING SOON" },
  EXPIRED: { cls: "bg-red-50 text-red-700 border-red-200", Icon: XCircle, label: "EXPIRED" },
  USED: { cls: "bg-slate-100 text-slate-600 border-slate-200", Icon: Flame, label: "BURNED" },
};

export const StatusBadge = ({ status, testId }) => {
  const m = META[status] || META.ACTIVE;
  const { Icon } = m;
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold tracking-wide ${m.cls}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {m.label}
    </span>
  );
};
