"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { BottomPanel } from "@/components/layout/BottomPanel";
import { PriceChart } from "@/components/chart/PriceChart";
import { IndicatorSettingsDialog } from "@/components/chart/IndicatorSettingsDialog";
import { useChartStore } from "@/lib/store/chart-store";

export default function HomePage() {
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  // Desktop: abierta por defecto. Móvil: cerrada por defecto.
  const [watchlistOpen, setWatchlistOpen] = useState(false);

  useEffect(() => {
    if (window.innerWidth >= 768) setWatchlistOpen(true);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-tv-bg">
      <Header
        watchlistOpen={watchlistOpen}
        onToggleWatchlist={() => setWatchlistOpen((v) => !v)}
      />
      <div className="relative flex min-h-0 flex-1">
        <LeftSidebar />
        <main className="relative flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <PriceChart symbol={symbol} timeframe={timeframe} />
          </div>
        </main>
        <RightSidebar open={watchlistOpen} onToggle={() => setWatchlistOpen((v) => !v)} />
      </div>
      <BottomPanel />
      <IndicatorSettingsDialog />
    </div>
  );
}
