"use client";

import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Watchlist } from "@/components/watchlist/Watchlist";

interface RightSidebarProps {
  open: boolean;
  onToggle: () => void;
}

export function RightSidebar({ open, onToggle }: RightSidebarProps) {
  return (
    <>
      {/* Móvil: backdrop que cierra al tocar */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onToggle}
        />
      )}

      {/* Móvil: overlay deslizable desde la derecha */}
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-72 flex-col border-l border-tv-border bg-tv-panel",
          "transition-transform duration-300 ease-in-out md:hidden",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <Watchlist />
      </aside>

      {/* Desktop: en el flujo normal, colapsa con animación de ancho */}
      <aside
        className={cn(
          "hidden flex-col overflow-hidden border-tv-border bg-tv-panel md:flex",
          "transition-[width] duration-300 ease-in-out",
          open ? "w-64 border-l" : "w-0",
        )}
      >
        <div className="w-64">
          <Watchlist />
        </div>
      </aside>

      {/* Desktop: pestaña en el borde derecho para re-abrir */}
      <button
        onClick={onToggle}
        aria-label="Mostrar watchlist"
        className={cn(
          "fixed right-0 top-1/2 z-30 hidden -translate-y-1/2 md:flex",
          "h-16 w-5 flex-col items-center justify-center",
          "rounded-l border border-r-0 border-tv-border bg-tv-panel",
          "text-tv-text-muted transition-opacity duration-300 hover:text-tv-text",
          open ? "pointer-events-none opacity-0" : "opacity-100",
        )}
      >
        <ChevronLeft className="h-3 w-3" />
      </button>
    </>
  );
}
