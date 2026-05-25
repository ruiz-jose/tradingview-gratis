"use client";

import { Code2, LayoutGrid, PanelRight, Zap } from "lucide-react";
import { SymbolSelector } from "@/components/chart/SymbolSelector";
import { TimeframeSelector } from "@/components/chart/TimeframeSelector";
import { IndicatorMenu } from "@/components/chart/IndicatorMenu";
import { AlertSettingsButton } from "@/components/chart/AlertSettingsButton";
import { Separator } from "@/components/ui/separator";
import { useChartStore } from "@/lib/store/chart-store";
import { cn } from "@/lib/utils";

interface HeaderProps {
  watchlistOpen: boolean;
  onToggleWatchlist: () => void;
}

export function Header({ watchlistOpen, onToggleWatchlist }: HeaderProps) {
  const multiMode = useChartStore((s) => s.multiMode);
  const setMultiMode = useChartStore((s) => s.setMultiMode);

  return (
    <header className="flex h-12 items-center justify-between border-b border-tv-border bg-tv-panel px-3">
      <div className="flex items-center gap-1">
        <div className="hidden items-center gap-2 pr-2 sm:flex">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-tv-blue/20">
            <Zap className="h-4 w-4 text-tv-blue" />
          </div>
          <span className="text-sm font-semibold text-tv-text">
            TradingView <span className="text-tv-text-muted">Gratis</span>
          </span>
        </div>
        <Separator orientation="vertical" className="hidden h-6 bg-tv-border sm:block" />
        <SymbolSelector />
        <Separator orientation="vertical" className="h-6 bg-tv-border" />
        {!multiMode && <TimeframeSelector />}
        {!multiMode && <Separator orientation="vertical" className="mx-1 h-6 bg-tv-border" />}
        <button
          onClick={() => setMultiMode(!multiMode)}
          aria-label="Vista multi-temporalidad"
          title="Ver 4 temporalidades"
          className={cn(
            "flex h-8 items-center gap-1.5 rounded px-2 transition-colors",
            multiMode
              ? "bg-tv-blue/15 text-tv-blue"
              : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
          )}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">4</span>
        </button>
        <Separator orientation="vertical" className="mx-1 h-6 bg-tv-border" />
        <IndicatorMenu />
      </div>

      <div className="flex items-center gap-1">
        <AlertSettingsButton />
        <Separator orientation="vertical" className="h-6 bg-tv-border" />
        <a
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden items-center gap-1.5 rounded px-2.5 py-1.5 text-xs text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text sm:flex"
        >
          <Code2 className="h-3.5 w-3.5" />
          <span>Source</span>
        </a>
        <button
          onClick={onToggleWatchlist}
          aria-label="Mostrar/ocultar watchlist"
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-tv-panel-hover hover:text-tv-text",
            watchlistOpen
              ? "bg-tv-blue/15 text-tv-blue"
              : "text-tv-text-muted",
          )}
        >
          <PanelRight className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
