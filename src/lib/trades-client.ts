import { type Trade, type NewTradeInput } from "@/lib/trade-logger";

const STORAGE_KEY = "trades";
/** Trading fee deducted from P&L (0.2% round-trip, matching trade-logger.ts) */
const TRADING_FEE_PCT = 0.2;

function readAll(): Trade[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as Trade[];
  } catch {
    return [];
  }
}

function writeAll(trades: Trade[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
}

export function getAllTrades(): Trade[] {
  return readAll();
}

export function getOpenTrades(): Trade[] {
  return readAll().filter(t => t.status === "open");
}

export function logTrade(input: NewTradeInput): Trade {
  const trades = readAll();
  const risk = input.direction === "LONG"
    ? ((input.entryPrice - input.stopLoss) / input.entryPrice) * 100
    : ((input.stopLoss - input.entryPrice) / input.entryPrice) * 100;

  // crypto.randomUUID() is available in all modern browsers on secure origins (HTTPS/localhost)
  const trade: Trade = {
    id: crypto.randomUUID(),
    ...input,
    riskPct: Math.abs(risk),
    entryTime: new Date().toISOString(),
    status: "open",
  };

  trades.push(trade);
  writeAll(trades);
  return trade;
}

export function closeTrade(
  id: string,
  closePrice: number,
  closeReason: Trade["closeReason"],
): Trade | null {
  const trades = readAll();
  const idx = trades.findIndex(t => t.id === id);
  if (idx === -1) return null;

  const t = trades[idx];
  const pnlPct = t.direction === "LONG"
    ? ((closePrice - t.entryPrice) / t.entryPrice) * 100 - TRADING_FEE_PCT
    : ((t.entryPrice - closePrice) / t.entryPrice) * 100 - TRADING_FEE_PCT;

  trades[idx] = { ...t, status: "closed", closeTime: new Date().toISOString(), closePrice, closeReason, pnlPct };
  writeAll(trades);
  return trades[idx];
}
