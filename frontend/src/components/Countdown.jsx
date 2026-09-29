import { useEffect, useState } from "react";
import { formatCountdown } from "@/lib/format";

export const Countdown = ({ expiryTime, status, className = "", testId }) => {
  const calc = () => Math.max(0, Math.floor((new Date(expiryTime).getTime() - Date.now()) / 1000));
  const [secs, setSecs] = useState(calc());

  useEffect(() => {
    const t = setInterval(() => setSecs(calc()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [expiryTime]);

  if (status === "USED") return <span className={className} data-testid={testId}>Burned</span>;
  if (secs <= 0) return <span className={`text-red-600 ${className}`} data-testid={testId}>Expired</span>;
  return <span className={className} data-testid={testId}>{formatCountdown(secs)}</span>;
};
