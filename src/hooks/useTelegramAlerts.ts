"use client";

import { useEffect, useRef } from "react";
import type { TrendMeterResult } from "@/lib/indicators";
import type { Timeframe } from "@/lib/binance/types";

const DIRECTION_LABELS: Record<NonNullable<TrendMeterResult["direction"]>, string> = {
  bull: "🟢 ALCISTA",
  bear: "🔴 BAJISTA",
  neutral: "⚪ NEUTRAL",
};

// Mínimo de minutos entre alertas para el mismo símbolo (evita spam)
const COOLDOWN_MS = 5 * 60 * 1000;

export function useTelegramAlerts(
  trendResult: TrendMeterResult | null,
  symbol: string,
  timeframe: Timeframe,
) {
  const prevDirectionRef = useRef<TrendMeterResult["direction"] | null>(null);
  const lastAlertRef = useRef<number>(0);

  useEffect(() => {
    if (!trendResult) return;

    const { direction, score } = trendResult;
    const prev = prevDirectionRef.current;

    // Solo alerta si cambia de dirección (no en neutral→neutral, etc.)
    const directionChanged = prev !== null && direction !== prev;
    const isActionable = direction === "bull" || direction === "bear";

    if (!directionChanged || !isActionable) {
      prevDirectionRef.current = direction;
      return;
    }

    const now = Date.now();
    if (now - lastAlertRef.current < COOLDOWN_MS) {
      prevDirectionRef.current = direction;
      return;
    }

    prevDirectionRef.current = direction;
    lastAlertRef.current = now;

    const label = DIRECTION_LABELS[direction];
    const signals = trendResult.signals;
    const sigLines = [
      `• Precio vs EMA20: ${signals.vsEma20 === 1 ? "✅" : "❌"}`,
      `• Precio vs EMA50: ${signals.vsEma50 === 1 ? "✅" : "❌"}`,
      `• Cruce EMA rápido: ${signals.emaFastCross === 1 ? "✅" : "❌"}`,
      `• Supertrend: ${signals.supertrend === 1 ? "✅" : "❌"}`,
      `• MACD histograma: ${signals.macdHist === 1 ? "✅" : "❌"}`,
    ].join("\n");

    const message =
      `<b>📊 Cambio de Tendencia Detectado</b>\n\n` +
      `Par: <b>${symbol}</b> | Timeframe: <b>${timeframe}</b>\n` +
      `Tendencia: <b>${label}</b> (score ${score > 0 ? "+" : ""}${score}/5)\n\n` +
      `<b>Señales:</b>\n${sigLines}`;

    fetch("/api/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    }).catch(() => {
      // Silencioso — no interrumpir la UI si falla la alerta
    });
  }, [trendResult, symbol, timeframe]);
}
