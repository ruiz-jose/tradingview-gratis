"use client";

import { useEffect, useRef } from "react";
import type { TrendAlert } from "@/hooks/useTrendAlerts";

const SIGNAL_LABELS: Record<string, string> = {
  vsEma20: "Precio/EMA20",
  vsEma50: "Precio/EMA50",
  emaFastCross: "EMA9/EMA21",
  supertrend: "Supertrend",
  macdHist: "MACD Hist",
};

const AUTO_DISMISS_MS = 8000;

function AlertCard({
  alert,
  onDismiss,
}: {
  alert: TrendAlert;
  onDismiss: (id: string) => void;
}) {
  const bull = alert.direction === "bull";
  const accent = bull ? "#26a69a" : "#ef5350";
  const absScore = Math.abs(alert.score);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    timerRef.current = setTimeout(() => onDismiss(alert.id), AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [alert.id, onDismiss]);

  return (
    <div
      className="pointer-events-auto relative overflow-hidden rounded-lg shadow-2xl animate-in slide-in-from-right-4 duration-300"
      style={{
        background: bull ? "rgba(38,166,154,0.13)" : "rgba(239,83,80,0.13)",
        border: `1px solid ${accent}66`,
        minWidth: 230,
        backdropFilter: "blur(10px)",
      }}
    >
      <div className="flex flex-col gap-2 p-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span style={{ color: accent, fontSize: 18, lineHeight: 1 }}>
              {bull ? "▲" : "▼"}
            </span>
            <span
              style={{ color: accent }}
              className="text-sm font-bold tracking-wider"
            >
              {bull ? "ALCISTA" : "BAJISTA"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-tv-text">
              {alert.symbol}
            </span>
            <span className="text-xs text-tv-text-muted">{alert.timeframe}</span>
            <button
              onClick={() => onDismiss(alert.id)}
              className="ml-1 text-base leading-none text-tv-text-muted transition-colors hover:text-tv-text"
              aria-label="Cerrar alerta"
            >
              ×
            </button>
          </div>
        </div>

        {/* Score bar */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-tv-text-muted">Fuerza</span>
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <div
                key={n}
                style={{
                  width: 14,
                  height: 5,
                  borderRadius: 2,
                  backgroundColor: n <= absScore ? accent : `${accent}33`,
                }}
              />
            ))}
          </div>
          <span
            style={{ color: accent }}
            className="text-[10px] font-bold"
          >
            {absScore}/5
          </span>
        </div>

        {/* Signals */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
          {(
            Object.entries(alert.signals) as [string, 1 | -1][]
          ).map(([key, val]) => (
            <div key={key} className="flex items-center gap-1">
              <span
                style={{ color: val === 1 ? "#26a69a" : "#ef5350" }}
              >
                {val === 1 ? "▲" : "▼"}
              </span>
              <span className="text-tv-text-muted">
                {SIGNAL_LABELS[key] ?? key}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Auto-dismiss progress bar */}
      <div
        className="absolute bottom-0 left-0 h-[2px] rounded-b-lg"
        style={{
          backgroundColor: accent,
          animation: `tv-alert-shrink ${AUTO_DISMISS_MS}ms linear forwards`,
        }}
      />
    </div>
  );
}

interface Props {
  alerts: TrendAlert[];
  onDismiss: (id: string) => void;
}

export function TrendAlertToast({ alerts, onDismiss }: Props) {
  if (alerts.length === 0) return null;
  return (
    <div className="absolute top-14 right-4 z-50 flex flex-col gap-2">
      {alerts.map((a) => (
        <AlertCard key={a.id} alert={a} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
