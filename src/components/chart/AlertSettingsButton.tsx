"use client";

import { Bell, BellOff } from "lucide-react";
import { useChartStore } from "@/lib/store/chart-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function AlertSettingsButton() {
  const alertConfig = useChartStore((s) => s.alertConfig);
  const setAlertConfig = useChartStore((s) => s.setAlertConfig);

  async function handleBrowserToggle() {
    if (typeof Notification === "undefined") return;
    if (!alertConfig.browser && Notification.permission === "default") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return;
    }
    setAlertConfig({ browser: !alertConfig.browser });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex h-8 items-center gap-1.5 rounded px-2 text-xs transition-colors hover:bg-tv-panel-hover hover:text-tv-text",
          alertConfig.enabled ? "text-tv-green" : "text-tv-text-muted",
        )}
        aria-label="Configurar alertas de tendencia"
      >
        {alertConfig.enabled ? (
          <Bell className="h-3.5 w-3.5" />
        ) : (
          <BellOff className="h-3.5 w-3.5" />
        )}
        <span className="hidden sm:inline">Alertas</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={4}
        className="w-56 border-tv-border bg-tv-panel p-3 text-tv-text"
      >
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-tv-text-muted">
          Alertas de Tendencia
        </p>

        {/* Master enable */}
        <ToggleRow
          label="Activar alertas"
          checked={alertConfig.enabled}
          onChange={(v) => setAlertConfig({ enabled: v })}
        />

        <div
          className={cn(
            "mt-2 flex flex-col gap-2 transition-opacity",
            !alertConfig.enabled && "pointer-events-none opacity-40",
          )}
        >
          {/* Sound */}
          <ToggleRow
            label="Sonido"
            checked={alertConfig.sound}
            onChange={(v) => setAlertConfig({ sound: v })}
          />

          {/* Browser notification */}
          <ToggleRow
            label="Notificación del navegador"
            checked={alertConfig.browser}
            onChange={handleBrowserToggle}
          />

          {/* Minimum score */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-tv-text-muted">Mín. señales</span>
            <div className="flex gap-1">
              {[3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setAlertConfig({ minScore: n })}
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded text-xs font-semibold transition-colors",
                    alertConfig.minScore === n
                      ? "bg-tv-green text-tv-bg"
                      : "bg-tv-panel-hover text-tv-text-muted hover:text-tv-text",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <p className="px-1 text-[10px] text-tv-text-dim">
            {alertConfig.minScore === 5
              ? "Solo alerta con las 5 señales alineadas"
              : alertConfig.minScore === 4
              ? "Alerta con 4 o 5 señales alineadas"
              : "Alerta con 3, 4 o 5 señales alineadas"}
          </p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded px-1 py-1 transition-colors hover:bg-tv-panel-hover"
    >
      <span className="text-xs text-tv-text">{label}</span>
      <div
        className={cn(
          "relative h-4 w-7 rounded-full transition-colors",
          checked ? "bg-tv-green" : "bg-tv-border",
        )}
      >
        <div
          className={cn(
            "absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </div>
    </button>
  );
}
