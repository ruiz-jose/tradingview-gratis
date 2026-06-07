#!/usr/bin/env node
/**
 * lib-backtest.mjs — Núcleo compartido para todos los scripts de validación.
 *
 * Exporta:
 *  - Indicadores: emaArr, rsiArr, atrArr, supertrendDirArr, macdHistArr
 *  - computeTmSeries()    — trendMeter en batch (igual que src/lib/indicators)
 *  - detectSignalP()      — detectShortEntry parametrizado
 *  - simulate()           — simulador de trades
 *  - fetchPage()          — petición paginada a Binance
 *  - fetchPaginated()     — descarga completa paginada
 *  - calcMetrics()        — métricas estadísticas de una lista de trades
 *  - FEES_PCT, WARMUP, MAX_BARS
 */

export const FEES_PCT = 0.1;  // comisión por lado (taker Binance Futures)
export const WARMUP   = 60;   // velas de calentamiento
export const MAX_BARS = 200;  // 200 × 15m = 50h máximo en trade

// ── Indicadores ───────────────────────────────────────────────────────────────

export function emaArr(candles, period) {
  const out = new Array(candles.length).fill(null);
  if (candles.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += candles[i].close;
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsiArr(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].close - candles[i - 1].close;
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  out[period] = 100 - 100 / (1 + (loss === 0 ? 100 : gain / loss));
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i].close - candles[i - 1].close;
    gain = (gain * (period - 1) + (d > 0 ? d : 0)) / period;
    loss = (loss * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = 100 - 100 / (1 + (loss === 0 ? 100 : gain / loss));
  }
  return out;
}

export function atrArr(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr = [0];
  for (let i = 1; i < candles.length; i++) {
    tr.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low  - candles[i - 1].close),
    ));
  }
  let val = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = val;
  for (let i = period + 1; i < candles.length; i++) {
    val = (val * (period - 1) + tr[i]) / period;
    out[i] = val;
  }
  return out;
}

export function supertrendDirArr(candles, atrPeriod, factor) {
  const atr = atrArr(candles, atrPeriod);
  const out = new Array(candles.length).fill(null);
  let prevUpper = 0, prevLower = 0, prevDir = 1, init = false;
  for (let i = atrPeriod; i < candles.length; i++) {
    if (atr[i] === null) continue;
    const hl2 = (candles[i].high + candles[i].low) / 2;
    let upper = hl2 + factor * atr[i];
    let lower = hl2 - factor * atr[i];
    if (init) {
      lower = lower > prevLower || candles[i - 1].close < prevLower ? lower : prevLower;
      upper = upper < prevUpper || candles[i - 1].close > prevUpper ? upper : prevUpper;
    }
    const d = !init ? 1 : prevDir === 1 ? (candles[i].close < lower ? -1 : 1) : (candles[i].close > upper ? 1 : -1);
    out[i] = d;
    prevUpper = upper; prevLower = lower; prevDir = d; init = true;
  }
  return out;
}

export function macdHistArr(candles, fast, slow, signal) {
  const out = new Array(candles.length).fill(null);
  const ef = emaArr(candles, fast);
  const es = emaArr(candles, slow);
  const ml = candles.map((_, i) => ef[i] !== null && es[i] !== null ? ef[i] - es[i] : null);
  const start = ml.findIndex(v => v !== null);
  if (start === -1 || candles.length - start < signal) return out;
  const k = 2 / (signal + 1);
  let sv = ml.slice(start, start + signal).reduce((a, b) => a + b, 0) / signal;
  const sl = new Array(candles.length).fill(null);
  sl[start + signal - 1] = sv;
  for (let i = start + signal; i < candles.length; i++) { sv = ml[i] * k + sv * (1 - k); sl[i] = sv; }
  for (let i = 0; i < candles.length; i++) {
    if (ml[i] !== null && sl[i] !== null) out[i] = ml[i] - sl[i];
  }
  return out;
}

export function computeTmSeries(candles) {
  const e20 = emaArr(candles, 20);
  const e50 = emaArr(candles, 50);
  const e9  = emaArr(candles, 9);
  const e21 = emaArr(candles, 21);
  const st  = supertrendDirArr(candles, 10, 3);
  const mh  = macdHistArr(candles, 12, 26, 9);
  const rs  = rsiArr(candles, 14);
  return candles.map((c, i) => {
    if ([e20[i], e50[i], e9[i], e21[i], st[i], mh[i], rs[i]].some(v => v === null)) return null;
    const score =
      (c.close > e20[i] ? 1 : -1) +
      (c.close > e50[i] ? 1 : -1) +
      (e9[i] > e21[i]   ? 1 : -1) +
      st[i] +
      (mh[i] >= 0       ? 1 : -1) +
      (rs[i] > 50       ? 1 : -1);
    return { score, direction: score >= 4 ? 'bull' : score <= -4 ? 'bear' : 'neutral' };
  });
}

// ── Detección de señal parametrizada ─────────────────────────────────────────

/**
 * @param {object} p  parámetros opcionales
 * @param {number} p.rsiThreshold    pico RSI overbought (default 65)
 * @param {number} p.rangeMin        rango mínimo relativo (default 0.008 = 0.8%)
 * @param {number} p.lookback        velas de lookback para el rango (default 30)
 * @param {number} p.slBuffer        buffer SL sobre pullback high (default 0.003 = 0.3%)
 * @param {number} p.minConfirms     confirmaciones mínimas (default 2)
 * @param {number} p.chochWindow     ventana de ChoCh (default 20)
 * @param {number} p.rsiPeakWindow   ventana de pico RSI (default 5)
 */
export function detectSignalP(candles, rsiVals, i, p = {}) {
  const {
    rsiThreshold  = 65,
    rangeMin      = 0.008,
    lookback      = 30,
    slBuffer      = 0.003,
    minConfirms   = 2,
    chochWindow   = 20,
    rsiPeakWindow = 5,
  } = p;

  if (i < WARMUP || !candles[i] || !candles[i - 1]) return null;

  // 1. Rango y retroceso activo
  let hi = -Infinity, lo = Infinity;
  for (let j = Math.max(0, i - (lookback - 1)); j <= i; j++) {
    if (candles[j].high > hi) hi = candles[j].high;
    if (candles[j].low  < lo) lo = candles[j].low;
  }
  if (hi <= 0 || (hi - lo) / lo < rangeMin) return null;
  if (candles[i].close < lo + (hi - lo) * 0.5) return null;

  // 2. RSI overbought cross
  const rNow = rsiVals[i], rPrev = rsiVals[i - 1];
  if (rNow === null || rPrev === null) return null;
  let rPeak = -Infinity;
  for (let j = Math.max(0, i - (rsiPeakWindow - 1)); j <= i; j++) {
    if (rsiVals[j] !== null && rsiVals[j] > rPeak) rPeak = rsiVals[j];
  }
  const rsiCross = rPeak > rsiThreshold && rNow < rPrev;

  // 3. ChoCh
  let structureLow = null;
  for (let j = Math.max(1, i - chochWindow + 1); j < i; j++) {
    if (candles[j - 1] && candles[j] && candles[j + 1] &&
        candles[j].low < candles[j - 1].low &&
        candles[j].low < candles[j + 1].low &&
        candles[j].low > lo * 1.001) {
      structureLow = candles[j].low;
    }
  }
  const choch = structureLow !== null && candles[i].close < structureLow;

  // 4. Patrón de vela bajista
  const curr = candles[i], prev = candles[i - 1];
  let bearPat = false;
  if (prev.close > prev.open && curr.close < curr.open &&
      curr.open >= prev.close && curr.close <= prev.open) {
    bearPat = true;
  }
  if (!bearPat) {
    const body = Math.abs(curr.close - curr.open);
    const rng  = curr.high - curr.low;
    const uw   = curr.high - Math.max(curr.open, curr.close);
    const lw   = Math.min(curr.open, curr.close) - curr.low;
    if (rng > 0 && body < rng * 0.4 && uw > body * 2 &&
        lw < body * 0.6 && (curr.high - curr.close) / rng > 0.55) {
      bearPat = true;
    }
  }

  // 5. Mínimo minConfirms de 3 confirmaciones
  const count = [choch, rsiCross, bearPat].filter(Boolean).length;
  if (count < minConfirms) return null;

  const sl   = hi * (1 + slBuffer);
  const tp1  = lo;
  const risk = sl - curr.close;
  const tp2  = risk > 0 ? curr.close - risk * 2 : tp1;

  return { sl, tp1, tp2, count, choch, rsiCross, bearPat, hi, lo };
}

// ── Simulador ─────────────────────────────────────────────────────────────────

export function simulate(c15m, rsi15m, htfData, signalParams = {}) {
  const trades = [];
  let active = null;
  const ptrs = htfData.map(d => ({ ...d, idx: 0 }));

  for (let i = WARMUP; i < c15m.length - 1; i++) {
    const t = c15m[i].time;
    for (const p of ptrs) {
      while (p.idx + 1 < p.series.length && p.candles[p.idx + 1].time <= t) p.idx++;
    }

    if (active) {
      const c = c15m[i];
      const bars = i - active.entryBar;
      if (c.high >= active.sl) {
        const pnl = (active.entry - active.sl) / active.entry * 100 - 2 * FEES_PCT;
        trades.push({ ...active, exitTime: c.time, exitPrice: active.sl, pnl, win: false, reason: 'SL', bars });
        active = null; continue;
      }
      if (c.low <= active.tp1) {
        const pnl = (active.entry - active.tp1) / active.entry * 100 - 2 * FEES_PCT;
        trades.push({ ...active, exitTime: c.time, exitPrice: active.tp1, pnl, win: true, reason: 'TP1', bars });
        active = null; continue;
      }
      if (bars >= MAX_BARS) {
        const pnl = (active.entry - c.close) / active.entry * 100 - 2 * FEES_PCT;
        trades.push({ ...active, exitTime: c.time, exitPrice: c.close, pnl, win: pnl > 0, reason: 'TO', bars });
        active = null;
      }
      continue;
    }

    if (!ptrs.every(p => { const tm = p.series[p.idx]; return tm && tm.direction === 'bear'; })) continue;

    const sig = detectSignalP(c15m, rsi15m, i, signalParams);
    if (!sig) continue;

    const next = c15m[i + 1];
    active = {
      entryTime: next.time, entry: next.open, entryBar: i + 1,
      sl: sig.sl, tp1: sig.tp1, tp2: sig.tp2,
      count: sig.count, choch: sig.choch, rsiCross: sig.rsiCross, bearPat: sig.bearPat,
      pullbackHigh: sig.hi, pullbackLow: sig.lo,
    };
  }

  if (active) {
    const last = c15m[c15m.length - 1];
    const pnl = (active.entry - last.close) / active.entry * 100 - 2 * FEES_PCT;
    trades.push({ ...active, exitTime: last.time, exitPrice: last.close, pnl, win: pnl > 0, reason: 'FIN', bars: c15m.length - 1 - active.entryBar, openClose: true });
  }

  return trades;
}

// ── Métricas estadísticas ─────────────────────────────────────────────────────

export function calcMetrics(trades) {
  if (!trades.length) return null;

  const wins   = trades.filter(t => t.win);
  const losses = trades.filter(t => !t.win);
  const pnls   = trades.map(t => t.pnl);

  const wr     = wins.length / trades.length;
  const avgW   = wins.length   ? wins.reduce((s, t)   => s + t.pnl, 0) / wins.length   : 0;
  const avgL   = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const gGain  = wins.reduce((s, t)   => s + t.pnl, 0);
  const gLoss  = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const pf     = gLoss > 0 ? gGain / gLoss : Infinity;

  // Equity curve y drawdown
  let equity = 100, peak = 100, maxDD = 0;
  const equityCurve = [100];
  for (const t of trades) {
    equity *= (1 + t.pnl / 100);
    equityCurve.push(equity);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
  }
  const totalReturn = equity - 100;

  // Sharpe / Sortino (por trade, no anualizado aquí)
  const mean  = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance = pnls.reduce((a, b) => a + (b - mean) ** 2, 0) / pnls.length;
  const stdDev = Math.sqrt(variance);
  const downDev = Math.sqrt(
    pnls.filter(p => p < 0).reduce((a, b) => a + b ** 2, 0) / pnls.length
  );
  const sharpe  = stdDev   > 0 ? mean / stdDev   : 0;
  const sortino = downDev  > 0 ? mean / downDev  : 0;
  const calmar  = maxDD    > 0 ? totalReturn / maxDD : Infinity;

  // Racha máxima de pérdidas
  let maxLoseStreak = 0, curStreak = 0;
  for (const t of trades) {
    if (!t.win) { curStreak++; maxLoseStreak = Math.max(maxLoseStreak, curStreak); }
    else curStreak = 0;
  }

  // Expectativa (EV) por trade en % del capital
  const ev = mean;

  return {
    n: trades.length,
    wins: wins.length, losses: losses.length,
    wr, wrPct: wr * 100,
    avgW, avgL,
    gGain, gLoss,
    pf,
    totalReturn, equity,
    maxDD,
    sharpe, sortino, calmar,
    mean, stdDev,
    maxLoseStreak,
    ev,
    equityCurve,
  };
}

// ── Fetch Binance ─────────────────────────────────────────────────────────────

export async function fetchPage(symbol, interval, limit, endTime) {
  let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  if (endTime) url += `&endTime=${endTime}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Binance ${res.status}: ${await res.text()}`);
  return (await res.json()).map(k => ({
    time: Math.floor(k[0] / 1000), openMs: Number(k[0]),
    open: parseFloat(k[1]), high: parseFloat(k[2]),
    low:  parseFloat(k[3]), close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

export async function fetchPaginated(symbol, interval, total, silent = false) {
  const PER = 1000;
  const batches = [];
  let endTime = null;
  if (!silent) process.stdout.write(`  ${symbol} ${interval.padEnd(4)} (${total})  `);
  while (true) {
    const fetched = batches.reduce((s, b) => s + b.length, 0);
    if (fetched >= total) break;
    const limit = Math.min(PER, total - fetched);
    const batch = await fetchPage(symbol, interval, limit, endTime);
    if (!batch.length) break;
    batches.unshift(batch);
    endTime = batch[0].openMs - 1;
    if (!silent) process.stdout.write('.');
    if (batch.length < limit) break;
    await new Promise(r => setTimeout(r, 120));
  }
  if (!silent) process.stdout.write(' ✓\n');
  const seen = new Set();
  return batches.flat()
    .sort((a, b) => a.time - b.time)
    .filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true; });
}

// ── Utilidades de formato ─────────────────────────────────────────────────────

export function fd(ts) { return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16); }
export function fp(n)  { return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`; }
export function ff(n, d = 2) { return n === Infinity ? '∞' : isNaN(n) ? '-' : n.toFixed(d); }
