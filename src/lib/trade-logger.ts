import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

export interface Trade {
  id: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  entryTime: string;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  riskPct: number;
  confirmations: {
    choch: boolean;
    rsiCross: boolean;
    candlePattern: boolean;
    patternName?: string;
  };
  htfScores: Record<string, number>;
  status: "open" | "closed";
  closeTime?: string;
  closePrice?: number;
  closeReason?: "TP1" | "TP2" | "SL" | "manual";
  pnlPct?: number;
}

export interface NewTradeInput {
  symbol: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  confirmations: Trade["confirmations"];
  htfScores: Record<string, number>;
}

const DATA_DIR  = resolve(process.cwd(), "data");
const TRADES_FILE = resolve(DATA_DIR, "trades.json");

function readAll(): Trade[] {
  if (!existsSync(TRADES_FILE)) return [];
  try { return JSON.parse(readFileSync(TRADES_FILE, "utf8")) as Trade[]; }
  catch { return []; }
}

function writeAll(trades: Trade[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
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

  const trade: Trade = {
    id: randomUUID(),
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
    ? ((closePrice - t.entryPrice) / t.entryPrice) * 100 - 0.2
    : ((t.entryPrice - closePrice) / t.entryPrice) * 100 - 0.2;

  trades[idx] = { ...t, status: "closed", closeTime: new Date().toISOString(), closePrice, closeReason, pnlPct };
  writeAll(trades);
  return trades[idx];
}
