"use client";

import { useEffect, useRef } from "react";
import { fetchKlines } from "@/lib/binance/rest";
import { detectShortEntry, type ShortEntrySignal } from "@/lib/indicators";
import type { AlertConfig } from "@/lib/store/chart-store";

// Comprueba al inicio y cada vez que cierra una vela de 15m
const CHECK_INTERVAL_MS = 15 * 60_000;
// Mínimo 4h entre alertas para el mismo símbolo (evita spam)
const SIGNAL_COOLDOWN_MS = 4 * 60 * 60_000;

export function useMtfShortSignal(symbol: string, config: AlertConfig) {
  const lastSignalRef = useRef<number>(0);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    // Al cambiar de símbolo, resetear cooldown para dar señal fresca si aplica
    lastSignalRef.current = 0;

    async function check() {
      const cfg = configRef.current;
      if (!cfg.enabled || !cfg.telegram) return;
      if (Date.now() - lastSignalRef.current < SIGNAL_COOLDOWN_MS) return;

      const results = await Promise.all([
        fetchKlines(symbol, "15m", 500),
        fetchKlines(symbol, "1h",  200),
        fetchKlines(symbol, "4h",  200),
        fetchKlines(symbol, "1w",  100),
        fetchKlines(symbol, "1M",   60),
      ]).catch(() => null);
      if (!results) return;

      const [c15m, c1h, c4h, c1w, c1M] = results;
      const signal = detectShortEntry(c15m, c1h, c4h, c1w, c1M);
      if (!signal) return;

      lastSignalRef.current = Date.now();
      void sendShortAlert(signal, symbol);
    }

    void check();
    const id = setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [symbol]);
}

async function sendShortAlert(signal: ShortEntrySignal, symbol: string): Promise<void> {
  const fmt = (n: number) =>
    n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const resistanceLabel = {
    ema50:        "EMA50",
    ema200:       "EMA200",
    both:         "EMA50 + EMA200",
    pullbackHigh: "Máximo del retroceso",
  }[signal.resistanceType];

  const htfLines = Object.entries(signal.htfScores)
    .map(([tf, score]) => `  • ${tf.toUpperCase()}: ${score}/6`)
    .join("\n");

  const c = signal.confirmations;
  const confirmLines = [
    `${c.choch              ? "✅" : "❌"} ChoCh — cierre bajo mínimo de estructura${signal.pullbackStructureLow ? ` ($${fmt(signal.pullbackStructureLow)})` : ""}`,
    `${c.rsiOverboughtCross ? "✅" : "❌"} RSI(14) ${signal.rsi15m.toFixed(1)} — cruce bajista desde sobrecompra (>65)`,
    `${c.bearishPattern     ? "✅" : "❌"} Patrón vela: ${c.confirmationPattern === "bearishEngulfing" ? "Engulfing Bajista" : c.confirmationPattern === "shootingStar" ? "Shooting Star" : "—"}`,
  ].join("\n");

  const rr = signal.stopLoss > signal.price
    ? ((signal.price - signal.tp2) / (signal.stopLoss - signal.price)).toFixed(1)
    : "—";

  const message =
    `🚨 <b>SEÑAL SHORT MTF — ${symbol}</b> 🚨\n\n` +
    `📊 <b>Filtro HTF (todos bajistas):</b>\n${htfLines}\n\n` +
    `📈 <b>Retroceso 15m detectado:</b>\n` +
    `  • Rango: $${fmt(signal.pullbackLowPrice)} → $${fmt(signal.pullbackHighPrice)}\n` +
    `  • Resistencia: ${resistanceLabel} ($${fmt(signal.resistanceLevel)})\n\n` +
    `✅ <b>Confirmaciones (mín. 2/3):</b>\n${confirmLines}\n\n` +
    `─────────────────────\n` +
    `💰 <b>Entrada:</b>    $${fmt(signal.price)}\n` +
    `🛑 <b>Stop Loss:</b>  $${fmt(signal.stopLoss)}\n` +
    `🎯 <b>TP1:</b>        $${fmt(signal.tp1)}\n` +
    `🎯 <b>TP2 (1:2):</b>  $${fmt(signal.tp2)}  (R:R 1:${rr})\n` +
    `─────────────────────\n` +
    `📉 Dirección: <b>SHORT ▼</b>\n` +
    `⚠️ <i>No es asesoramiento financiero.</i>`;

  await fetch("/api/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  }).catch(() => {});
}
