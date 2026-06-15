"use client";

import { useEffect, useRef } from "react";
import type { Trade } from "@/lib/trade-logger";
import { getOpenTrades, closeTrade, logTrade } from "@/lib/trades-client";

const POLL_INTERVAL_MS = 60_000; // verifica SL/TP cada 1 minuto

async function getCurrentPrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) return null;
    const data = await res.json() as { price: string };
    return parseFloat(data.price);
  } catch {
    return null;
  }
}

async function sendTelegramClose(trade: Trade, closePrice: number, closeReason: string, pnlPct: number): Promise<void> {
  const fmt = (n: number) =>
    n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const icon = pnlPct >= 0 ? "✅" : "❌";
  const dir  = trade.direction === "LONG" ? "LONG ▲" : "SHORT ▼";

  const message =
    `${icon} <b>CIERRE ${dir} — ${trade.symbol}</b>\n\n` +
    `📌 Razón: <b>${closeReason}</b>\n` +
    `💰 Entrada:  $${fmt(trade.entryPrice)}\n` +
    `💵 Salida:   $${fmt(closePrice)}\n` +
    `📊 P&L:      <b>${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%</b> (incl. fees)\n\n` +
    `⚠️ <i>No es asesoramiento financiero.</i>`;

  await fetch("/api/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  }).catch(() => {});
}

export function useTradeMonitor() {
  const processingRef = useRef(false);

  useEffect(() => {
    async function checkOpenTrades() {
      if (processingRef.current) return;
      processingRef.current = true;

      try {
        const openTrades = getOpenTrades();
        if (!openTrades.length) return;

        // Agrupar por símbolo para hacer una sola petición de precio por activo
        const symbols = [...new Set(openTrades.map(t => t.symbol))];
        const prices: Record<string, number | null> = {};
        await Promise.all(symbols.map(async sym => {
          prices[sym] = await getCurrentPrice(sym);
        }));

        for (const trade of openTrades) {
          const price = prices[trade.symbol];
          if (price === null) continue;

          let closeReason: Trade["closeReason"] | null = null;

          if (trade.direction === "LONG") {
            if (price <= trade.stopLoss)  closeReason = "SL";
            else if (price >= trade.tp1)  closeReason = "TP1";
          } else {
            if (price >= trade.stopLoss)  closeReason = "SL";
            else if (price <= trade.tp1)  closeReason = "TP1";
          }

          if (!closeReason) continue;

          const closePrice = closeReason === "SL"  ? trade.stopLoss
                           : closeReason === "TP1" ? trade.tp1
                           : price;

          const pnlPct = trade.direction === "LONG"
            ? ((closePrice - trade.entryPrice) / trade.entryPrice) * 100 - 0.2
            : ((trade.entryPrice - closePrice) / trade.entryPrice) * 100 - 0.2;

          closeTrade(trade.id, closePrice, closeReason);
          await sendTelegramClose(trade, closePrice, closeReason, pnlPct);
        }
      } finally {
        processingRef.current = false;
      }
    }

    void checkOpenTrades();
    const id = setInterval(() => void checkOpenTrades(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
}

export interface LogSignalInput {
  symbol: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  confirmations: Trade["confirmations"];
  htfScores: Record<string, number>;
}

// Función helper exportada para que los hooks de señal registren un trade nuevo
export function logSignalTrade(input: LogSignalInput): void {
  try {
    logTrade(input);
  } catch {
    // silently ignore errors (e.g. localStorage unavailable)
  }
}
