"use client";

import { useEffect, useRef } from "react";
import type { TrendMeterResult } from "@/lib/indicators";
import type { Timeframe } from "@/lib/binance/types";
import type { AlertConfig } from "@/lib/store/chart-store";

const DIRECTION_LABELS: Record<NonNullable<TrendMeterResult["direction"]>, string> = {
  bull: "🟢 ALCISTA",
  bear: "🔴 BAJISTA",
  neutral: "⚪ NEUTRAL",
};

const COOLDOWN_BY_TF: Partial<Record<string, number>> = {
  "1m":  4  * 60_000,
  "3m":  6  * 60_000,
  "5m":  15 * 60_000,
  "15m": 45 * 60_000,
  "30m": 90 * 60_000,
  "1h":  4  * 60 * 60_000,
  "2h":  6  * 60 * 60_000,
  "4h":  12 * 60 * 60_000,
  "6h":  18 * 60 * 60_000,
  "8h":  24 * 60 * 60_000,
  "12h": 24 * 60 * 60_000,
  "1d":  48 * 60 * 60_000,
};
function getCooldown(tf: string): number {
  return COOLDOWN_BY_TF[tf] ?? 5 * 60_000;
}

export function useTelegramAlerts(
  trendResult: TrendMeterResult | null,
  symbol: string,
  timeframe: Timeframe,
  config: AlertConfig,
) {
  const prevDirectionRef = useRef<TrendMeterResult["direction"] | null>(null);
  const lastAlertRef = useRef<number>(0);
  useEffect(() => {
    prevDirectionRef.current = null;
    lastAlertRef.current = 0;
  }, [symbol, timeframe]);

  useEffect(() => {
    if (!trendResult) return;

    const { direction, score } = trendResult;
    const prev = prevDirectionRef.current;

    // Solo alerta si cambia de dirección (no en neutral→neutral, etc.)
    const directionChanged = prev !== null && direction !== prev;
    const isActionable = direction === "bull" || direction === "bear";
    const isStrong = Math.abs(score) >= config.minScore;

    prevDirectionRef.current = direction;

    // Skip if alerts master switch or Telegram toggle is off
    if (!config.enabled || !config.telegram) return;
    // Skip if direction did not change or is not actionable
    if (!directionChanged || !isActionable) return;
    // Skip if trend is not strong enough
    if (!isStrong) return;

    const now = Date.now();
    if (now - lastAlertRef.current < getCooldown(timeframe)) return;
    lastAlertRef.current = now;

    const label = DIRECTION_LABELS[direction];
    const signals = trendResult.signals;
    const sigLines = [
      `• Precio vs EMA20: ${signals.vsEma20 === 1 ? "✅" : "❌"}`,
      `• Precio vs EMA50: ${signals.vsEma50 === 1 ? "✅" : "❌"}`,
      `• Cruce EMA rápido: ${signals.emaFastCross === 1 ? "✅" : "❌"}`,
      `• Supertrend: ${signals.supertrend === 1 ? "✅" : "❌"}`,
      `• MACD histograma: ${signals.macdHist === 1 ? "✅" : "❌"}`,
      `• RSI > 50: ${signals.rsiLevel === 1 ? "✅" : "❌"}`,
    ].join("\n");

    const message =
      `<b>📊 Cambio de Tendencia Detectado</b>\n\n` +
      `Par: <b>${symbol}</b> | Timeframe: <b>${timeframe}</b>\n` +
      `Tendencia: <b>${label}</b> (score ${score > 0 ? "+" : ""}${score}/6)\n\n` +
      `<b>Señales:</b>\n${sigLines}`;

    fetch("/api/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    }).catch(() => {
      // Silencioso — no interrumpir la UI si falla la alerta
    });
  }, [trendResult, symbol, timeframe, config]);
}
