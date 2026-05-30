"use client";

import { PriceChart } from "./PriceChart";
import { useChartStore } from "@/lib/store/chart-store";
import type { Timeframe } from "@/lib/binance/types";
import { cn } from "@/lib/utils";

const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];

function MiniTimeframeSelector({ index }: { index: number }) {
  const multiTimeframes = useChartStore((s) => s.multiTimeframes);
  const setMultiTimeframe = useChartStore((s) => s.setMultiTimeframe);
  const current = multiTimeframes[index];

  return (
    <div className="absolute top-1 left-1 z-20 flex items-center gap-px rounded bg-tv-panel/90 p-0.5 backdrop-blur-sm">
      {TIMEFRAMES.map((t) => (
        <button
          key={t}
          onClick={() => setMultiTimeframe(index, t)}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase transition-colors",
            current === t
              ? "bg-tv-blue/20 text-tv-blue"
              : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

export function MultiChartGrid() {
  const symbol = useChartStore((s) => s.symbol);
  const multiTimeframes = useChartStore((s) => s.multiTimeframes);

  return (
    <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-px bg-tv-border">
      {multiTimeframes.map((tf, i) => (
        <div key={i} className="relative min-h-0 overflow-hidden bg-tv-bg">
          <MiniTimeframeSelector index={i} />
          <PriceChart symbol={symbol} timeframe={tf} usePreset />
        </div>
      ))}
    </div>
  );
}
