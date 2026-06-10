"use client";

import { useEffect, useState, useCallback } from "react";
import { useTradeMonitor } from "@/hooks/useTradeMonitor";
import type { Trade } from "@/lib/trade-logger";

function pnlColor(v?: number) {
  if (v === undefined) return "text-zinc-400";
  return v >= 0 ? "text-emerald-400" : "text-red-400";
}

function fmt(n: number) {
  return n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${color}`}>
      {children}
    </span>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}

function TradeRow({ trade, onClose }: { trade: Trade; onClose: (id: string, price: number, reason: Trade["closeReason"]) => void }) {
  const [closePrice, setClosePrice] = useState("");
  const [showClose, setShowClose] = useState(false);

  const isLong   = trade.direction === "LONG";
  const isOpen   = trade.status === "open";
  const rr       = trade.tp2 && trade.stopLoss
    ? (isLong
        ? (trade.tp2 - trade.entryPrice) / (trade.entryPrice - trade.stopLoss)
        : (trade.entryPrice - trade.tp2) / (trade.stopLoss - trade.entryPrice)
      ).toFixed(1)
    : "—";

  return (
    <tr className="border-t border-zinc-800 text-sm">
      <td className="py-3 px-3 font-mono text-zinc-300">{trade.symbol}</td>
      <td className="py-3 px-3">
        <Badge color={isLong ? "bg-emerald-900 text-emerald-300" : "bg-red-900 text-red-300"}>
          {trade.direction}
        </Badge>
      </td>
      <td className="py-3 px-3 text-zinc-300">{new Date(trade.entryTime).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}</td>
      <td className="py-3 px-3 font-mono text-white">${fmt(trade.entryPrice)}</td>
      <td className="py-3 px-3 font-mono text-red-400">${fmt(trade.stopLoss)}</td>
      <td className="py-3 px-3 font-mono text-emerald-400">${fmt(trade.tp1)}</td>
      <td className="py-3 px-3 text-zinc-400">{rr}×</td>
      <td className="py-3 px-3">
        <div className="flex gap-1 flex-wrap text-xs">
          {trade.confirmations.rsiCross    && <Badge color="bg-blue-900 text-blue-300">RSI</Badge>}
          {trade.confirmations.choch       && <Badge color="bg-purple-900 text-purple-300">ChoCh</Badge>}
          {trade.confirmations.candlePattern && <Badge color="bg-amber-900 text-amber-300">{trade.confirmations.patternName ?? "Vela"}</Badge>}
        </div>
      </td>
      <td className="py-3 px-3">
        {isOpen ? (
          <Badge color="bg-zinc-700 text-zinc-200">Abierto</Badge>
        ) : (
          <Badge color={
            trade.closeReason === "TP1" || trade.closeReason === "TP2" ? "bg-emerald-900 text-emerald-300" :
            trade.closeReason === "SL" ? "bg-red-900 text-red-300" : "bg-zinc-700 text-zinc-300"
          }>
            {trade.closeReason}
          </Badge>
        )}
      </td>
      <td className={`py-3 px-3 font-mono font-semibold ${pnlColor(trade.pnlPct)}`}>
        {trade.pnlPct !== undefined ? `${trade.pnlPct >= 0 ? "+" : ""}${trade.pnlPct.toFixed(2)}%` : "—"}
      </td>
      <td className="py-3 px-3">
        {isOpen && (
          showClose ? (
            <div className="flex gap-1 items-center">
              <input
                type="number"
                placeholder="Precio"
                value={closePrice}
                onChange={e => setClosePrice(e.target.value)}
                className="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white"
              />
              {(["TP1", "SL", "manual"] as Trade["closeReason"][]).map(r => (
                <button
                  key={r}
                  onClick={() => { onClose(trade.id, parseFloat(closePrice), r); setShowClose(false); }}
                  disabled={!closePrice}
                  className="rounded bg-zinc-700 px-2 py-1 text-xs text-white hover:bg-zinc-600 disabled:opacity-40"
                >
                  {r}
                </button>
              ))}
              <button onClick={() => setShowClose(false)} className="text-xs text-zinc-500 hover:text-white">✕</button>
            </div>
          ) : (
            <button
              onClick={() => setShowClose(true)}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Cerrar
            </button>
          )
        )}
      </td>
    </tr>
  );
}

export default function TradesPage() {
  const [trades, setTrades]   = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  // Activa el monitor de SL/TP en tiempo real
  useTradeMonitor();

  const loadTrades = useCallback(async () => {
    try {
      const res = await fetch("/api/trades");
      if (res.ok) setTrades(await res.json() as Trade[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTrades();
    const id = setInterval(() => void loadTrades(), 60_000);
    return () => clearInterval(id);
  }, [loadTrades]);

  const handleClose = useCallback(async (id: string, closePrice: number, closeReason: Trade["closeReason"]) => {
    await fetch(`/api/trades/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ closePrice, closeReason }),
    });
    await loadTrades();
  }, [loadTrades]);

  const open   = trades.filter(t => t.status === "open");
  const closed = trades.filter(t => t.status === "closed");
  const wins   = closed.filter(t => (t.pnlPct ?? 0) > 0);
  const totalPnl = closed.reduce((s, t) => s + (t.pnlPct ?? 0), 0);
  const wr     = closed.length ? ((wins.length / closed.length) * 100).toFixed(1) : "—";
  const pf     = (() => {
    const g = closed.filter(t => (t.pnlPct ?? 0) > 0).reduce((s, t) => s + (t.pnlPct ?? 0), 0);
    const l = Math.abs(closed.filter(t => (t.pnlPct ?? 0) <= 0).reduce((s, t) => s + (t.pnlPct ?? 0), 0));
    return l > 0 ? (g / l).toFixed(2) : g > 0 ? "∞" : "—";
  })();

  const allRows = [...open, ...closed.slice().reverse()];

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-7xl px-4 py-8">

        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Diario de Trades</h1>
            <p className="mt-1 text-sm text-zinc-500">Paper trading — MTF Pullback Strategy</p>
          </div>
          <a href="/" className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">
            ← Volver al chart
          </a>
        </div>

        {/* Resumen */}
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard label="Trades cerrados" value={String(closed.length)} sub={`${open.length} abiertos`} />
          <SummaryCard label="Win Rate" value={`${wr}%`} sub={`${wins.length}W / ${closed.length - wins.length}L`} />
          <SummaryCard label="Profit Factor" value={pf} sub="descontando fees 0.2%" />
          <SummaryCard
            label="P&L acumulado"
            value={`${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}%`}
            sub={`sobre ${closed.length} trades cerrados`}
          />
        </div>

        {/* Tabla */}
        {loading ? (
          <p className="text-zinc-500">Cargando trades...</p>
        ) : allRows.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-12 text-center">
            <p className="text-zinc-400">No hay trades registrados todavía.</p>
            <p className="mt-2 text-sm text-zinc-600">Las señales se registran automáticamente cuando la app detecta una entrada.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full">
              <thead className="bg-zinc-900 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="py-3 px-3 text-left">Símbolo</th>
                  <th className="py-3 px-3 text-left">Dir</th>
                  <th className="py-3 px-3 text-left">Entrada</th>
                  <th className="py-3 px-3 text-left">Precio</th>
                  <th className="py-3 px-3 text-left">SL</th>
                  <th className="py-3 px-3 text-left">TP1</th>
                  <th className="py-3 px-3 text-left">R:R</th>
                  <th className="py-3 px-3 text-left">Confirmaciones</th>
                  <th className="py-3 px-3 text-left">Estado</th>
                  <th className="py-3 px-3 text-left">P&L</th>
                  <th className="py-3 px-3 text-left">Acción</th>
                </tr>
              </thead>
              <tbody className="bg-zinc-950">
                {allRows.map(t => (
                  <TradeRow key={t.id} trade={t} onClose={handleClose} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-6 text-xs text-zinc-700">
          El monitor revisa SL/TP cada minuto y cierra trades automáticamente.
          Podés cerrar manualmente con el botón "Cerrar".
          Los datos se guardan en <code>data/trades.json</code>.
        </p>
      </div>
    </div>
  );
}
