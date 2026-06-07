"use client";

import { useEffect, useState } from "react";
import { useChartStore } from "@/lib/store/chart-store";
import { fetchTicker24h } from "@/lib/binance/rest";
import type { Ticker24h } from "@/lib/binance/types";
import { formatPrice, formatPct, formatVolume } from "@/lib/format";
import { cn } from "@/lib/utils";

export function BottomPanel() {
  const symbol = useChartStore((s) => s.symbol);
  const [t, setT] = useState<Ticker24h | null>(null);
  const currentTicker = t?.symbol === symbol ? t : null;

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchTicker24h(symbol)
        .then((x) => {
          if (!cancelled) setT(x);
        })
        .catch(console.error);
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbol]);

  const upClass = (n: number) => (n >= 0 ? "text-tv-green" : "text-tv-red");

  return (
    <div className="flex h-9 shrink-0 items-center gap-0 overflow-x-auto border-t border-tv-border bg-tv-panel px-3 text-xs">
      <Stat label="Símbolo" value={symbol} />
      <Stat
        label="24h Cambio"
        value={currentTicker ? formatPct(currentTicker.priceChangePercent) : "—"}
        valueClass={currentTicker ? upClass(currentTicker.priceChangePercent) : ""}
      />
      <Stat
        label="24h Alto"
        value={currentTicker ? formatPrice(currentTicker.highPrice) : "—"}
        valueClass="text-tv-green"
        className="hidden sm:flex"
      />
      <Stat
        label="24h Bajo"
        value={currentTicker ? formatPrice(currentTicker.lowPrice) : "—"}
        valueClass="text-tv-red"
        className="hidden sm:flex"
      />
      <Stat
        label="24h Vol (base)"
        value={currentTicker ? formatVolume(currentTicker.volume) : "—"}
        className="hidden md:flex"
      />
      <Stat
        label="24h Vol (USDT)"
        value={currentTicker ? formatVolume(currentTicker.quoteVolume) : "—"}
        className="hidden md:flex"
      />
      <div className="ml-auto flex shrink-0 items-center gap-2 text-[10px] text-tv-text-dim">
        <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-tv-green" />
        <span className="hidden sm:inline">Binance · Live</span>
        <span className="sm:hidden">Live</span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass,
  className,
}: {
  label: string;
  value: string;
  valueClass?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 items-center gap-1.5 border-r border-tv-border px-3", className)}>
      <span className="text-tv-text-dim">{label}</span>
      <span className={cn("font-medium tabular-nums", valueClass ?? "text-tv-text")}>
        {value}
      </span>
    </div>
  );
}
