"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TrendMeterResult } from "@/lib/indicators";
import type { Timeframe } from "@/lib/binance/types";
import type { AlertConfig } from "@/lib/store/chart-store";

export interface TrendAlert {
  id: string;
  timestamp: number;
  symbol: string;
  timeframe: Timeframe;
  direction: "bull" | "bear";
  score: number;
  signals: TrendMeterResult["signals"];
}

// Cooldown dinámico: evita re-alertar la misma dirección antes de que "el bar" tenga sentido
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

function playAlertSound(direction: "bull" | "bear") {
  try {
    const ctx = new AudioContext();
    // Ascending tones for bull, descending for bear
    const freqs = direction === "bull" ? [440, 554, 659] : [659, 554, 440];
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.start(t);
      osc.stop(t + 0.35);
    });
  } catch {
    // AudioContext blocked or not supported — silent failure
  }
}

function fireBrowserNotification(alert: TrendAlert) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const bull = alert.direction === "bull";
  new Notification(
    `${bull ? "📈" : "📉"} ${alert.symbol} — Tendencia ${bull ? "ALCISTA" : "BAJISTA"}`,
    {
      body: `Timeframe: ${alert.timeframe} | Fuerza: ${Math.abs(alert.score)}/5 señales alineadas`,
      tag: `trend-${alert.symbol}`,
      silent: true,
    },
  );
}

export function useTrendAlerts(
  trendResult: TrendMeterResult | null,
  symbol: string,
  timeframe: Timeframe,
  config: AlertConfig,
) {
  const prevDirectionRef = useRef<TrendMeterResult["direction"] | null>(null);
  const lastAlertTimeRef = useRef<number>(0);
  // Use ref so config changes don't re-trigger the effect on every render
  const configRef = useRef(config);
  configRef.current = config;

  const [activeAlerts, setActiveAlerts] = useState<TrendAlert[]>([]);

  const dismiss = useCallback((id: string) => {
    setActiveAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  useEffect(() => {
    if (!trendResult) return;
    const { direction, score, signals } = trendResult;
    const cfg = configRef.current;
    const prev = prevDirectionRef.current;

    const directionChanged = prev !== null && direction !== prev;
    const isActionable = direction === "bull" || direction === "bear";
    const isStrong = Math.abs(score) >= cfg.minScore;

    prevDirectionRef.current = direction;

    if (!cfg.enabled || !directionChanged || !isActionable || !isStrong) return;

    const now = Date.now();
    if (now - lastAlertTimeRef.current < getCooldown(timeframe)) return;
    lastAlertTimeRef.current = now;

    const alert: TrendAlert = {
      id: `${now}-${Math.random().toString(36).slice(2)}`,
      timestamp: now,
      symbol,
      timeframe,
      direction,
      score,
      signals,
    };

    setActiveAlerts((prev) => [alert, ...prev].slice(0, 3));

    if (cfg.sound) playAlertSound(direction);
    if (cfg.browser) fireBrowserNotification(alert);
  }, [trendResult, symbol, timeframe]);

  return { activeAlerts, dismiss };
}
