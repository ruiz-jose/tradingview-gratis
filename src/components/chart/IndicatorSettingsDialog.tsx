"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  useChartStore,
  DEFAULT_CONFIG,
  type IndicatorKey,
  type IndicatorConfig,
} from "@/lib/store/chart-store";

const TITLES: Record<IndicatorKey, string> = {
  ema20: "EMA — Slot A",
  ema50: "EMA — Slot B",
  ema200: "EMA — Slot C",
  ema9: "EMA 9",
  ema21: "EMA 21",
  sma20: "SMA — Slot A",
  sma50: "SMA — Slot B",
  sma200: "SMA — Slot C",
  rsi: "RSI",
  macd: "MACD",
  volume: "Volumen",
  supertrend: "Supertrend",
  bbands: "Bollinger Bands",
  vwap: "VWAP",
  stochrsi: "Stochastic RSI",
  adx: "ADX",
  atr: "ATR",
  cvd: "CVD",
  chop: "Choppiness Index",
  bos: "Break of Structure",
  patterns: "Patrones de vela",
  trendmeter: "Trend Meter",
  trendcross: "Cambio de tendencia ✕",
};

export function IndicatorSettingsDialog() {
  const target = useChartStore((s) => s.settingsTarget);
  const setTarget = useChartStore((s) => s.setSettingsTarget);
  const config = useChartStore((s) => s.config);
  const setConfig = useChartStore((s) => s.setConfig);

  const open = target !== null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setTarget(null); }}>
      <DialogContent className="max-w-sm bg-tv-panel">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            {target ? TITLES[target] : ""} — Configuración
          </DialogTitle>
        </DialogHeader>
        {target && (
          <SettingsForm
            target={target}
            config={config}
            onSave={(patch) => { setConfig(patch); setTarget(null); }}
            onReset={() => { setConfig(DEFAULT_CONFIG); setTarget(null); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface FormProps {
  target: IndicatorKey;
  config: IndicatorConfig;
  onSave: (patch: Partial<IndicatorConfig>) => void;
  onReset: () => void;
}

function SettingsForm({ target, config, onSave, onReset }: FormProps) {
  const [draft, setDraft] = useState<IndicatorConfig>({ ...config });

  useEffect(() => {
    setDraft({ ...config });
  }, [config, target]);

  const set = (k: keyof IndicatorConfig) => (n: number) =>
    setDraft((d) => ({ ...d, [k]: n }));

  function save() {
    switch (target) {
      case "ema20":  return onSave({ ema20: clamp(draft.ema20, 2, 500) });
      case "ema50":  return onSave({ ema50: clamp(draft.ema50, 2, 500) });
      case "ema200": return onSave({ ema200: clamp(draft.ema200, 2, 500) });
      case "ema9":   return onSave({ ema9: clamp(draft.ema9, 2, 500) });
      case "ema21":  return onSave({ ema21: clamp(draft.ema21, 2, 500) });
      case "sma20":  return onSave({ sma20: clamp(draft.sma20, 2, 500) });
      case "sma50":  return onSave({ sma50: clamp(draft.sma50, 2, 500) });
      case "sma200": return onSave({ sma200: clamp(draft.sma200, 2, 500) });
      case "rsi":    return onSave({ rsi: clamp(draft.rsi, 2, 100) });
      case "macd":
        return onSave({
          macdFast: clamp(draft.macdFast, 2, 100),
          macdSlow: clamp(draft.macdSlow, 2, 200),
          macdSignal: clamp(draft.macdSignal, 2, 100),
        });
      case "supertrend":
        return onSave({
          supertrendAtr: clamp(draft.supertrendAtr, 1, 50),
          supertrendFactor: clamp(draft.supertrendFactor, 1, 10),
        });
      case "bbands":
        return onSave({
          bbandsLen: clamp(draft.bbandsLen, 2, 500),
          bbandsMultiplier: clamp(draft.bbandsMultiplier, 1, 5),
        });
      case "stochrsi":
        return onSave({
          stochRsiLen: clamp(draft.stochRsiLen, 2, 100),
          stochRsiK: clamp(draft.stochRsiK, 1, 20),
          stochRsiD: clamp(draft.stochRsiD, 1, 20),
        });
      case "adx":   return onSave({ adxLen: clamp(draft.adxLen, 2, 100) });
      case "atr":   return onSave({ atrLen: clamp(draft.atrLen, 2, 100) });
      case "cvd":   return onSave({ cvdEmaLen: clamp(draft.cvdEmaLen, 2, 100) });
      case "chop":  return onSave({ chopLen: clamp(draft.chopLen, 2, 100) });
      case "bos":   return onSave({ bosLen: clamp(draft.bosLen, 2, 20) });
      case "volume":
      case "vwap":
      case "patterns":
        return onSave({});
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {(target === "ema20" || target === "ema50" || target === "ema200" ||
        target === "ema9" || target === "ema21" ||
        target === "sma20" || target === "sma50" || target === "sma200") && (
        <Field label="Período" value={draft[target as keyof IndicatorConfig] as number}
          onChange={set(target as keyof IndicatorConfig)} />
      )}

      {target === "rsi" && (
        <Field label="Período" value={draft.rsi} onChange={set("rsi")} />
      )}

      {target === "macd" && (
        <div className="grid grid-cols-3 gap-2">
          <Field label="Rápida" value={draft.macdFast} onChange={set("macdFast")} />
          <Field label="Lenta" value={draft.macdSlow} onChange={set("macdSlow")} />
          <Field label="Señal" value={draft.macdSignal} onChange={set("macdSignal")} />
        </div>
      )}

      {target === "supertrend" && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="ATR" value={draft.supertrendAtr} onChange={set("supertrendAtr")} />
          <Field label="Factor" value={draft.supertrendFactor} onChange={set("supertrendFactor")} />
        </div>
      )}

      {target === "bbands" && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Período" value={draft.bbandsLen} onChange={set("bbandsLen")} />
          <Field label="Múltiplo" value={draft.bbandsMultiplier} onChange={set("bbandsMultiplier")} />
        </div>
      )}

      {target === "stochrsi" && (
        <div className="grid grid-cols-3 gap-2">
          <Field label="Período" value={draft.stochRsiLen} onChange={set("stochRsiLen")} />
          <Field label="K" value={draft.stochRsiK} onChange={set("stochRsiK")} />
          <Field label="D" value={draft.stochRsiD} onChange={set("stochRsiD")} />
        </div>
      )}

      {target === "adx" && (
        <Field label="Período" value={draft.adxLen} onChange={set("adxLen")} />
      )}

      {target === "atr" && (
        <Field label="Período" value={draft.atrLen} onChange={set("atrLen")} />
      )}

      {target === "cvd" && (
        <Field label="EMA Señal" value={draft.cvdEmaLen} onChange={set("cvdEmaLen")} />
      )}

      {target === "chop" && (
        <Field label="Período" value={draft.chopLen} onChange={set("chopLen")} />
      )}

      {target === "bos" && (
        <Field label="Pivots (barras)" value={draft.bosLen} onChange={set("bosLen")} />
      )}

      {(target === "volume" || target === "vwap" || target === "patterns") && (
        <p className="text-xs text-tv-text-muted">
          Este indicador no tiene parámetros configurables.
        </p>
      )}

      <div className="mt-2 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          className="text-tv-text-muted hover:text-tv-text"
        >
          Reset defaults
        </Button>
        <Button size="sm" onClick={save} className="bg-tv-blue hover:bg-tv-blue/90">
          Aplicar
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
        {label}
      </span>
      <Input
        type="number"
        min={1}
        max={500}
        value={value}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (!isNaN(n)) onChange(n);
        }}
        className="bg-tv-bg tabular-nums"
      />
    </label>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
