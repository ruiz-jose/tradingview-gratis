#!/usr/bin/env node
/**
 * backtest-multi-full.mjs — Comparativa multi-símbolo Long+Short
 *
 * Corre backtest-full sobre varios activos y muestra tabla comparativa.
 *
 * Uso:
 *   node scripts/backtest-multi-full.mjs [AÑOS]
 *   node scripts/backtest-multi-full.mjs 3
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve }                                    from 'node:path';
import { fileURLToPath }                                       from 'node:url';
import {
  emaArr, rsiArr, computeTmSeries, simulate,
  FEES_PCT, WARMUP, MAX_BARS,
  fetchPaginated, calcMetrics, fd, fp, ff,
} from './lib-backtest.mjs';

const YEARS   = parseFloat(process.argv[2] || '3');
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'ADAUSDT', 'XRPUSDT'];

const N_15M = Math.round(YEARS * 365 * 24 * 4);
const N_1H  = Math.round(YEARS * 365 * 24);
const N_4H  = Math.round(YEARS * 365 * 6);
const N_1W  = 220;
const N_1M  = 72;

const __dir     = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dir, 'cache');
const TODAY     = new Date().toISOString().slice(0, 10);

async function getCandles(sym, iv, n) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const path = resolve(CACHE_DIR, `${sym}_${iv}_${n}_${TODAY}.json`);
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  const data = await fetchPaginated(sym, iv, n);
  writeFileSync(path, JSON.stringify(data));
  return data;
}

function detectLongP(candles, rsiVals, i, p = {}) {
  const { rsiThreshold = 35, rangeMin = 0.008, lookback = 30, slBuffer = 0.003, minConfirms = 2, chochWindow = 20, rsiPeakWindow = 5 } = p;
  if (i < WARMUP || !candles[i] || !candles[i - 1]) return null;
  let hi = -Infinity, lo = Infinity;
  for (let j = Math.max(0, i - (lookback - 1)); j <= i; j++) {
    if (candles[j].high > hi) hi = candles[j].high;
    if (candles[j].low  < lo) lo = candles[j].low;
  }
  if (hi <= 0 || (hi - lo) / lo < rangeMin) return null;
  if (candles[i].close > lo + (hi - lo) * 0.5) return null;
  const rNow = rsiVals[i], rPrev = rsiVals[i - 1];
  if (rNow === null || rPrev === null) return null;
  let rMin = Infinity;
  for (let j = Math.max(0, i - (rsiPeakWindow - 1)); j <= i; j++) {
    if (rsiVals[j] !== null && rsiVals[j] < rMin) rMin = rsiVals[j];
  }
  const rsiCross = rMin < rsiThreshold && rNow > rPrev;
  if (!rsiCross) return null;
  let structHigh = null;
  for (let j = Math.max(1, i - chochWindow + 1); j < i; j++) {
    if (candles[j - 1] && candles[j] && candles[j + 1] &&
        candles[j].high > candles[j - 1].high && candles[j].high > candles[j + 1].high &&
        candles[j].high < hi * 0.999) structHigh = candles[j].high;
  }
  const choch = structHigh !== null && candles[i].close > structHigh;
  const curr = candles[i], prev = candles[i - 1];
  let bullPat = false;
  if (prev.close < prev.open && curr.close > curr.open && curr.open <= prev.close && curr.close >= prev.open) bullPat = true;
  if (!bullPat) {
    const body = Math.abs(curr.close - curr.open), rng = curr.high - curr.low;
    const uw = curr.high - Math.max(curr.open, curr.close), lw = Math.min(curr.open, curr.close) - curr.low;
    if (rng > 0 && body < rng * 0.4 && lw > body * 2 && uw < body * 0.6 && (curr.close - curr.low) / rng > 0.55) bullPat = true;
  }
  const count = [choch, rsiCross, bullPat].filter(Boolean).length;
  if (count < minConfirms) return null;
  const sl = lo * (1 - slBuffer), tp1 = hi, risk = curr.close - sl;
  return { sl, tp1, tp2: risk > 0 ? curr.close + risk * 2 : tp1, count, choch, rsiCross, bullPat, hi, lo };
}

function simulateLong(c15m, rsi15m, htfData) {
  const trades = []; let active = null;
  const ptrs = htfData.map(d => ({ ...d, idx: 0 }));
  for (let i = WARMUP; i < c15m.length - 1; i++) {
    const t = c15m[i].time;
    for (const ptr of ptrs) { while (ptr.idx + 1 < ptr.series.length && ptr.candles[ptr.idx + 1].time <= t) ptr.idx++; }
    if (active) {
      const c = c15m[i], bars = i - active.entryBar;
      if (c.low <= active.sl) {
        trades.push({ ...active, exitTime: c.time, exitPrice: active.sl, pnl: (active.sl - active.entry) / active.entry * 100 - 2 * FEES_PCT, win: false, reason: 'SL', bars });
        active = null; continue;
      }
      if (c.high >= active.tp1) {
        const pnl = (active.tp1 - active.entry) / active.entry * 100 - 2 * FEES_PCT;
        trades.push({ ...active, exitTime: c.time, exitPrice: active.tp1, pnl, win: pnl > 0, reason: 'TP1', bars });
        active = null; continue;
      }
      if (bars >= MAX_BARS) {
        const pnl = (c.close - active.entry) / active.entry * 100 - 2 * FEES_PCT;
        trades.push({ ...active, exitTime: c.time, exitPrice: c.close, pnl, win: pnl > 0, reason: 'TO', bars });
        active = null;
      }
      continue;
    }
    if (!ptrs.every(ptr => { const tm = ptr.series[ptr.idx]; return tm && tm.direction === 'bull'; })) continue;
    const sig = detectLongP(c15m, rsi15m, i);
    if (!sig) continue;
    const next = c15m[i + 1];
    active = { dir: 'LONG', entryTime: next.time, entry: next.open, entryBar: i + 1, sl: sig.sl, tp1: sig.tp1, tp2: sig.tp2 };
  }
  if (active) {
    const last = c15m[c15m.length - 1];
    const pnl = (last.close - active.entry) / active.entry * 100 - 2 * FEES_PCT;
    trades.push({ ...active, exitTime: last.time, exitPrice: last.close, pnl, win: pnl > 0, reason: 'FIN', bars: c15m.length - 1 - active.entryBar });
  }
  return trades;
}

async function runSymbol(sym) {
  process.stdout.write(`  ${sym.padEnd(10)}`);
  try {
    const [c15m, c1h, c4h, c1w, c1M] = await Promise.all([
      getCandles(sym, '15m', N_15M), getCandles(sym, '1h', N_1H),
      getCandles(sym, '4h', N_4H),   getCandles(sym, '1w', N_1W),
      getCandles(sym, '1M', N_1M),
    ]);
    const rsi15m  = rsiArr(c15m, 14);
    const htfData = [
      { candles: c1h, series: computeTmSeries(c1h) },
      { candles: c4h, series: computeTmSeries(c4h) },
      { candles: c1w, series: computeTmSeries(c1w) },
      { candles: c1M, series: computeTmSeries(c1M) },
    ];
    const shortT = simulate(c15m, rsi15m, htfData).map(t => ({ ...t, dir: 'SHORT' }));
    const longT  = simulateLong(c15m, rsi15m, htfData);
    const all    = [...shortT, ...longT].sort((a, b) => a.entryTime - b.entryTime);
    const m      = calcMetrics(all);
    const period = `${fd(c15m[0].time).slice(0,7)} → ${fd(c15m[c15m.length-1].time).slice(0,7)}`;
    process.stdout.write(` ${String(all.length).padStart(3)} trades  ✓\n`);
    return { sym, m, longN: longT.length, shortN: shortT.length, period };
  } catch (e) {
    process.stdout.write(` ERROR: ${e.message}\n`);
    return { sym, m: null, longN: 0, shortN: 0, period: '' };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const BAR = '═'.repeat(78);
console.log(`\n${BAR}`);
console.log(`  BACKTEST MULTI-SÍMBOLO Long+Short  |  ${YEARS} años  |  ${SYMBOLS.length} activos  |  fee ${FEES_PCT}%/lado`);
console.log(BAR);
console.log('\nDescargando y simulando (datos cacheados cuando sea posible)...\n');

// Secuencial para evitar rate limit
const results = [];
for (const sym of SYMBOLS) results.push(await runSymbol(sym));

// ── Tabla resumen ─────────────────────────────────────────────────────────────
console.log(`\n${BAR}`);
console.log('  TABLA COMPARATIVA');
console.log(BAR);
console.log(`  ${'Símbolo'.padEnd(9)} ${'N'.padStart(4)} ${'L/S'.padStart(6)} ${'WR%'.padStart(6)} ${'PF'.padStart(5)} ${'EV/t'.padStart(7)} ${'Ret%'.padStart(7)} ${'MaxDD'.padStart(6)} ${'Sharpe'.padStart(7)}`);
console.log('  ' + '─'.repeat(70));

let totalTrades = 0, totalWins = 0;
for (const { sym, m, longN, shortN } of results) {
  if (!m) { console.log(`  ${sym.padEnd(9)}  sin trades`); continue; }
  const icon = m.pf >= 1.5 ? '✅' : m.pf >= 1.0 ? '⚠️ ' : '❌';
  console.log(
    `  ${sym.padEnd(9)} ${String(m.n).padStart(4)}  ${(longN + 'L/' + shortN + 'S').padStart(6)}  ` +
    `${(m.wrPct.toFixed(0) + '%').padStart(5)}  ${ff(m.pf).padStart(5)}  ${fp(m.ev).padStart(7)}  ` +
    `${fp(m.totalReturn).padStart(7)}  ${(m.maxDD.toFixed(1) + '%').padStart(6)}  ${ff(m.sharpe, 2).padStart(7)}  ${icon}`,
  );
  totalTrades += m.n; totalWins += m.wins;
}

// ── Métricas agregadas ────────────────────────────────────────────────────────
const allTrades = results.flatMap(r => r.m ? [] : []).concat(
  results.filter(r => r.m).flatMap(r => {
    // recalculamos desde los datos disponibles en m
    return [];
  })
);

const valid = results.filter(r => r.m && r.m.n >= 5);
if (valid.length) {
  const avgWR  = valid.reduce((s, r) => s + r.m.wrPct, 0) / valid.length;
  const avgPF  = valid.reduce((s, r) => s + (isFinite(r.m.pf) ? r.m.pf : 0), 0) / valid.length;
  const avgEV  = valid.reduce((s, r) => s + r.m.ev, 0) / valid.length;
  const avgDD  = valid.reduce((s, r) => s + r.m.maxDD, 0) / valid.length;
  const avgRet = valid.reduce((s, r) => s + r.m.totalReturn, 0) / valid.length;
  const profitable = valid.filter(r => r.m.pf > 1.0).length;

  console.log('  ' + '─'.repeat(70));
  console.log(`  ${'PROMEDIO'.padEnd(9)} ${String(totalTrades).padStart(4)}  ${''.padStart(6)}  ` +
    `${(avgWR.toFixed(0) + '%').padStart(5)}  ${ff(avgPF).padStart(5)}  ${fp(avgEV).padStart(7)}  ` +
    `${fp(avgRet).padStart(7)}  ${(avgDD.toFixed(1) + '%').padStart(6)}`);

  console.log(`\n${BAR}`);
  console.log('  ANÁLISIS DE ROBUSTEZ');
  console.log(BAR);
  console.log(`  Activos rentables (PF>1):  ${profitable}/${valid.length}`);
  console.log(`  WR media cross-asset:      ${avgWR.toFixed(1)}%  (σ = ${ff(Math.sqrt(valid.reduce((s,r) => s + (r.m.wrPct - avgWR)**2, 0) / valid.length), 1)}%)`);
  console.log(`  PF medio cross-asset:      ${ff(avgPF)}`);
  console.log(`  EV medio por trade:        ${fp(avgEV)}`);
  console.log(`  Max DD medio:              ${avgDD.toFixed(1)}%`);
  console.log(`  Total trades combinados:   ${totalTrades}`);

  console.log(`\n${BAR}`);
  console.log('  VEREDICTO MULTI-SÍMBOLO');
  console.log(BAR);

  if (profitable >= valid.length * 0.6 && avgPF >= 1.5 && totalTrades >= 30) {
    console.log('\n  ✅  ROBUSTO — La estrategia genera edge en ≥60% de los activos con PF≥1.5.');
    console.log('     Apto para diversificación real entre símbolos.\n');
  } else if (profitable >= valid.length * 0.5 && avgPF >= 1.2) {
    console.log('\n  ⚠️   MODERADO — Rentable en la mayoría de activos pero con dispersión alta.');
    console.log('     Operar con tamaños pequeños y monitoreo activo.\n');
  } else {
    console.log('\n  ❌  FRÁGIL — El edge no se generaliza cross-asset.');
    console.log('     No diversificar hasta mejorar la estrategia.\n');
  }
}

console.log(BAR + '\n');
