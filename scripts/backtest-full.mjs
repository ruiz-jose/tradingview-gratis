#!/usr/bin/env node
/**
 * backtest-full.mjs — Backtest MTF Long+Short | ciclo completo de mercado
 *
 * Descarga datos históricos desde Binance (API pública, sin cuenta),
 * los cachea en scripts/cache/ y evalúa la estrategia MTF Pullback
 * en ambas direcciones sobre 2–3 años de historia.
 *
 * Uso:
 *   node scripts/backtest-full.mjs [SYMBOL] [AÑOS]
 *
 * Ejemplos:
 *   node scripts/backtest-full.mjs BTCUSDT 2    ← 2 años (recomendado)
 *   node scripts/backtest-full.mjs BTCUSDT 3    ← 3 años (incluye bear 2022)
 *   node scripts/backtest-full.mjs ETHUSDT 2
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve }                                    from 'node:path';
import { fileURLToPath }                                       from 'node:url';
import {
  emaArr, rsiArr, computeTmSeries, simulate,
  FEES_PCT, WARMUP, MAX_BARS,
  fetchPaginated, calcMetrics, fd, fp, ff,
} from './lib-backtest.mjs';

const SYMBOL = (process.argv[2] || 'BTCUSDT').toUpperCase();
const YEARS  = parseFloat(process.argv[3] || '2');

const N_15M = Math.round(YEARS * 365 * 24 * 4);  // ~70 080 para 2 años
const N_1H  = Math.round(YEARS * 365 * 24);        // ~17 520
const N_4H  = Math.round(YEARS * 365 * 6);         // ~4 380
const N_1W  = 220;
const N_1M  = 72;

const __dir     = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dir, 'cache');
const TODAY     = new Date().toISOString().slice(0, 10);

// ── Caché en disco ────────────────────────────────────────────────────────────

async function getCandles(sym, iv, n) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const path = resolve(CACHE_DIR, `${sym}_${iv}_${n}_${TODAY}.json`);
  if (existsSync(path)) {
    process.stdout.write(`  ${sym} ${iv.padEnd(4)} (${n.toLocaleString()})  [caché] ✓\n`);
    return JSON.parse(readFileSync(path, 'utf8'));
  }
  const data = await fetchPaginated(sym, iv, n);
  writeFileSync(path, JSON.stringify(data));
  return data;
}

// ── Detección Long parametrizada (espejo de detectSignalP para Short) ─────────

function detectLongP(candles, rsiVals, i, p = {}) {
  const {
    rsiThreshold  = 35,   // oversold (vs 65 overbought para Short)
    rangeMin      = 0.008,
    lookback      = 30,
    slBuffer      = 0.003,
    minConfirms   = 2,
    chochWindow   = 20,
    rsiPeakWindow = 5,
  } = p;

  if (i < WARMUP || !candles[i] || !candles[i - 1]) return null;

  // 1. Rango mínimo y precio en MITAD INFERIOR (retroceso bajista activo)
  let hi = -Infinity, lo = Infinity;
  for (let j = Math.max(0, i - (lookback - 1)); j <= i; j++) {
    if (candles[j].high > hi) hi = candles[j].high;
    if (candles[j].low  < lo) lo = candles[j].low;
  }
  if (hi <= 0 || (hi - lo) / lo < rangeMin) return null;
  if (candles[i].close > lo + (hi - lo) * 0.5) return null;

  // 2. RSI oversold cross (RSI tocó <threshold y ahora está subiendo)
  const rNow = rsiVals[i], rPrev = rsiVals[i - 1];
  if (rNow === null || rPrev === null) return null;
  let rMin = Infinity;
  for (let j = Math.max(0, i - (rsiPeakWindow - 1)); j <= i; j++) {
    if (rsiVals[j] !== null && rsiVals[j] < rMin) rMin = rsiVals[j];
  }
  const rsiCross = rMin < rsiThreshold && rNow > rPrev;

  // 3. ChoCh alcista: cierra por encima del último máximo local del retroceso
  let structHigh = null;
  for (let j = Math.max(1, i - chochWindow + 1); j < i; j++) {
    if (candles[j - 1] && candles[j] && candles[j + 1] &&
        candles[j].high > candles[j - 1].high &&
        candles[j].high > candles[j + 1].high &&
        candles[j].high < hi * 0.999) {
      structHigh = candles[j].high;
    }
  }
  const choch = structHigh !== null && candles[i].close > structHigh;

  // 4. Patrón de vela alcista (Bullish Engulfing o Hammer)
  const curr = candles[i], prev = candles[i - 1];
  let bullPat = false;
  if (prev.close < prev.open && curr.close > curr.open &&
      curr.open <= prev.close && curr.close >= prev.open) {
    bullPat = true;
  }
  if (!bullPat) {
    const body = Math.abs(curr.close - curr.open);
    const rng  = curr.high - curr.low;
    const uw   = curr.high - Math.max(curr.open, curr.close);
    const lw   = Math.min(curr.open, curr.close) - curr.low;
    if (rng > 0 && body < rng * 0.4 && lw > body * 2 &&
        uw < body * 0.6 && (curr.close - curr.low) / rng > 0.55) {
      bullPat = true;
    }
  }

  // RSI obligatorio + mínimo 1 de los otros 2
  if (!rsiCross) return null;
  const count = [choch, rsiCross, bullPat].filter(Boolean).length;
  if (count < minConfirms) return null;

  const sl   = lo * (1 - slBuffer);
  const tp1  = hi;
  const risk = curr.close - sl;
  const tp2  = risk > 0 ? curr.close + risk * 2 : tp1;

  return { sl, tp1, tp2, count, choch, rsiCross, bullPat, hi, lo };
}

// ── Simulador Long ────────────────────────────────────────────────────────────

function simulateLong(c15m, rsi15m, htfData, p = {}) {
  const trades = [];
  let active = null;
  const ptrs = htfData.map(d => ({ ...d, idx: 0 }));

  for (let i = WARMUP; i < c15m.length - 1; i++) {
    const t = c15m[i].time;
    for (const ptr of ptrs) {
      while (ptr.idx + 1 < ptr.series.length && ptr.candles[ptr.idx + 1].time <= t) ptr.idx++;
    }

    if (active) {
      const c    = c15m[i];
      const bars = i - active.entryBar;
      if (c.low <= active.sl) {
        const pnl = (active.sl - active.entry) / active.entry * 100 - 2 * FEES_PCT;
        trades.push({ ...active, exitTime: c.time, exitPrice: active.sl, pnl, win: false, reason: 'SL', bars });
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

    // Filtro HTF: todos alcistas
    if (!ptrs.every(ptr => { const tm = ptr.series[ptr.idx]; return tm && tm.direction === 'bull'; })) continue;

    const sig = detectLongP(c15m, rsi15m, i, p);
    if (!sig) continue;

    const next = c15m[i + 1];
    active = {
      dir: 'LONG',
      entryTime: next.time, entry: next.open, entryBar: i + 1,
      sl: sig.sl, tp1: sig.tp1, tp2: sig.tp2,
      count: sig.count, choch: sig.choch, rsiCross: sig.rsiCross, bullPat: sig.bullPat,
    };
  }

  if (active) {
    const last = c15m[c15m.length - 1];
    const pnl = (last.close - active.entry) / active.entry * 100 - 2 * FEES_PCT;
    trades.push({ ...active, exitTime: last.time, exitPrice: last.close, pnl, win: pnl > 0, reason: 'FIN', bars: c15m.length - 1 - active.entryBar, openClose: true });
  }

  return trades;
}

// ── Equity curve ASCII ────────────────────────────────────────────────────────

function equityCurveAscii(curve, width = 68, height = 10) {
  if (curve.length < 2) return '';
  const step = Math.max(1, Math.ceil(curve.length / width));
  const pts  = [];
  for (let i = 0; i < curve.length; i += step) pts.push(curve[i]);
  if (pts[pts.length - 1] !== curve[curve.length - 1]) pts.push(curve[curve.length - 1]);

  const mn = Math.min(...pts), mx = Math.max(...pts), rng = mx - mn || 1;
  const grid = Array.from({ length: height }, () => new Array(pts.length).fill(' '));

  for (let x = 0; x < pts.length; x++) {
    const y = height - 1 - Math.round(((pts[x] - mn) / rng) * (height - 1));
    grid[y][x] = '█';
    // Fill downward to base line (100)
    const base = height - 1 - Math.round(((100 - mn) / rng) * (height - 1));
    const from = Math.min(y, base), to = Math.max(y, base);
    for (let r = from; r <= to; r++) if (grid[r][x] === ' ') grid[r][x] = '░';
  }

  const lines = [];
  for (let r = 0; r < height; r++) {
    const val = (mx - (r / (height - 1)) * rng).toFixed(0).padStart(6);
    lines.push(`  ${val} ┤ ${grid[r].join('')}`);
  }
  return lines.join('\n');
}

// ── Tabla de breakdown mensual ────────────────────────────────────────────────

function monthlyBreakdown(trades) {
  const map = {};
  for (const t of trades) {
    const key = new Date(t.entryTime * 1000).toISOString().slice(0, 7);
    if (!map[key]) map[key] = [];
    map[key].push(t);
  }
  return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
}

// ── Bloque de métricas ────────────────────────────────────────────────────────

const SEP = '─'.repeat(72);

function printBlock(label, m, trades) {
  if (!m) { console.log(`  ${label}: sin trades\n`); return; }
  const exits = {};
  for (const t of trades) exits[t.reason] = (exits[t.reason] || 0) + 1;
  const bev = m.ev >= 0 ? '✅' : '❌';
  const bpf = m.pf >= 1.2 ? '✅' : m.pf >= 1.0 ? '⚠️ ' : '❌';
  const bwr = m.wrPct >= 45 ? '✅' : m.wrPct >= 35 ? '⚠️ ' : '❌';
  const bdd = m.maxDD <= 20 ? '✅' : m.maxDD <= 35 ? '⚠️ ' : '❌';

  console.log(`\n  ${SEP}`);
  console.log(`  ${label}`);
  console.log(`  ${SEP}`);
  console.log(`  Trades          ${m.n}  (${m.wins}W / ${m.losses}L)`);
  console.log(`  Win Rate     ${bwr} ${m.wrPct.toFixed(1)}%`);
  console.log(`  Profit Factor ${bpf} ${ff(m.pf)}`);
  console.log(`  EV / trade   ${bev} ${fp(m.ev)}`);
  console.log(`  Avg win / loss  ${fp(m.avgW)} / ${fp(m.avgL)}  (ratio: ${m.avgL !== 0 ? ff(Math.abs(m.avgW / m.avgL)) : '∞'})`);
  console.log(`  Retorno total   ${fp(m.totalReturn)}`);
  console.log(`  Max Drawdown ${bdd} ${m.maxDD.toFixed(2)}%`);
  console.log(`  Sharpe          ${ff(m.sharpe)}   Sortino: ${ff(m.sortino)}   Calmar: ${ff(m.calmar)}`);
  console.log(`  Max racha neg.  ${m.maxLoseStreak} pérdidas seguidas`);
  console.log(`  Salidas         TP1:${exits.TP1 || 0}  SL:${exits.SL || 0}  Timeout:${exits.TO || 0}  Fin:${exits.FIN || 0}`);
}

// ── Veredicto final ───────────────────────────────────────────────────────────

function verdict(m) {
  if (!m || m.n < 10) {
    return '⚠️  MUESTRA INSUFICIENTE — Se necesitan ≥10 trades para un veredicto.';
  }
  const { pf, wrPct: wr, maxDD: dd, totalReturn: ret, sharpe } = m;
  if (pf >= 1.5 && wr >= 45 && dd <= 20 && ret > 10 && sharpe >= 0.5) {
    return '✅  RENTABLE — Métricas profesionales superadas. Apto para paper trading.';
  }
  if (pf >= 1.2 && ret > 0) {
    return '⚠️  MARGINAL — PF>1.2 pero algún criterio no se cumple.\n     Mejorar position sizing o filtrar señales de menor calidad.';
  }
  if (pf >= 1.0 && ret > 0) {
    return '⚠️  BREAKEVEN — Expectativa casi nula descontando fees.\n     No operar en cuenta real. Revisar parámetros o añadir filtros.';
  }
  return '❌  PERDEDORA — Profit Factor < 1.0. Requiere revisión fundamental.\n     No operar bajo ninguna condición.';
}

// ── Main ──────────────────────────────────────────────────────────────────────

const BAR = '═'.repeat(72);

console.log(`\n${BAR}`);
console.log(`  BACKTEST MTF LONG+SHORT  |  ${SYMBOL}  |  ${YEARS} años  |  fee ${FEES_PCT}%/lado`);
console.log(BAR);

// 1. Descarga de datos (secuencial para no exceder rate limit de Binance)
console.log('\nDescargando / cargando caché...');
const c15m = await getCandles(SYMBOL, '15m', N_15M);
const c1h  = await getCandles(SYMBOL, '1h',  N_1H);
const c4h  = await getCandles(SYMBOL, '4h',  N_4H);
const c1w  = await getCandles(SYMBOL, '1w',  N_1W);
const c1M  = await getCandles(SYMBOL, '1M',  N_1M);

console.log(`\nPeríodo analizado: ${fd(c15m[0].time)} → ${fd(c15m[c15m.length - 1].time)}`);
console.log(`Velas: 15m=${c15m.length.toLocaleString()} | 1h=${c1h.length} | 4h=${c4h.length} | 1w=${c1w.length} | 1M=${c1M.length}`);

// 2. Indicadores
console.log('\nCalculando indicadores...');
const rsi15m  = rsiArr(c15m, 14);
const htfData = [
  { candles: c1h, series: computeTmSeries(c1h) },
  { candles: c4h, series: computeTmSeries(c4h) },
  { candles: c1w, series: computeTmSeries(c1w) },
  { candles: c1M, series: computeTmSeries(c1M) },
];

// 3. Simulación
console.log('Simulando trades...');
const shortTrades = simulate(c15m, rsi15m, htfData).map(t => ({ ...t, dir: 'SHORT' }));
const longTrades  = simulateLong(c15m, rsi15m, htfData);
const allTrades   = [...shortTrades, ...longTrades].sort((a, b) => a.entryTime - b.entryTime);

console.log(`  → Long: ${longTrades.length} trades  |  Short: ${shortTrades.length} trades  |  Total: ${allTrades.length}`);

// 4. Métricas
const mShort = calcMetrics(shortTrades);
const mLong  = calcMetrics(longTrades);
const mAll   = calcMetrics(allTrades);

console.log(`\n${BAR}`);
console.log(`  RESULTADOS  ${SYMBOL}  |  ${fd(c15m[0].time)} → ${fd(c15m[c15m.length - 1].time)}`);
console.log(BAR);

printBlock('SHORT  (HTF 1h+4h+1w+1M todos bajistas)', mShort, shortTrades);
printBlock('LONG   (HTF 1h+4h+1w+1M todos alcistas)', mLong,  longTrades);
printBlock('COMBINADO  Long + Short', mAll, allTrades);

// 5. Breakdown mensual
if (allTrades.length > 0) {
  console.log(`\n${BAR}`);
  console.log('  BREAKDOWN MENSUAL');
  console.log(BAR);
  console.log(`  ${'Mes'.padEnd(8)} ${'N'.padStart(4)} ${'WR%'.padStart(6)} ${'PF'.padStart(5)} ${'Ret%'.padStart(7)} ${'MaxDD'.padStart(7)}  Dir`);
  console.log('  ' + SEP);

  for (const [month, mts] of monthlyBreakdown(allTrades)) {
    const m = calcMetrics(mts);
    if (!m) continue;
    const longs  = mts.filter(t => t.dir === 'LONG').length;
    const shorts = mts.filter(t => t.dir === 'SHORT').length;
    const icon = m.totalReturn >= 0 ? '✅' : '❌';
    console.log(
      `  ${month}  ${String(m.n).padStart(4)}  ${(m.wrPct.toFixed(0) + '%').padStart(5)}  ` +
      `${ff(m.pf).padStart(5)}  ${fp(m.totalReturn).padStart(7)}  ${('-' + m.maxDD.toFixed(1) + '%').padStart(6)}  ` +
      `${icon} ${longs}L/${shorts}S`,
    );
  }
}

// 6. Equity curve
if (mAll && mAll.equityCurve.length > 2) {
  console.log(`\n${BAR}`);
  console.log('  CURVA DE EQUITY (Long+Short combinados)');
  console.log(BAR);
  console.log(equityCurveAscii(mAll.equityCurve));
  console.log(`\n  Inicio: 100.00  →  Fin: ${mAll.equity.toFixed(2)}  (${fp(mAll.totalReturn)})`);
}

// 7. Análisis por tipo de confirmación
if (allTrades.length >= 5) {
  const byConf = {};
  for (const t of allTrades) {
    const key = [t.choch && 'ChoCh', t.rsiCross && 'RSI', (t.bearPat || t.bullPat) && 'Vela']
      .filter(Boolean).join('+');
    if (!byConf[key]) byConf[key] = [];
    byConf[key].push(t);
  }
  console.log(`\n${BAR}`);
  console.log('  POR COMBINACIÓN DE CONFIRMACIONES');
  console.log(BAR);
  console.log(`  ${'Confirmaciones'.padEnd(20)} ${'N'.padStart(4)} ${'WR%'.padStart(6)} ${'PF'.padStart(5)} ${'EV/t'.padStart(7)}`);
  console.log('  ' + '─'.repeat(50));
  for (const [key, ts] of Object.entries(byConf).sort((a, b) => b[1].length - a[1].length)) {
    const m = calcMetrics(ts);
    if (!m) continue;
    console.log(`  ${key.padEnd(20)} ${String(m.n).padStart(4)}  ${(m.wrPct.toFixed(0) + '%').padStart(5)}  ${ff(m.pf).padStart(5)}  ${fp(m.ev).padStart(7)}`);
  }
}

// 8. Veredicto final
console.log(`\n${BAR}`);
console.log('  VEREDICTO PROFESIONAL');
console.log(BAR);

const benchmarks = [
  ['Trades totales  (≥30)', (mAll?.n ?? 0) >= 30,    `${mAll?.n ?? 0}`],
  ['Win Rate        (≥45%)', (mAll?.wrPct ?? 0) >= 45, `${(mAll?.wrPct ?? 0).toFixed(1)}%`],
  ['Profit Factor   (≥1.5)', (mAll?.pf ?? 0) >= 1.5,  ff(mAll?.pf ?? 0)],
  ['EV / trade      (>0%)',  (mAll?.ev ?? -1) > 0,    fp(mAll?.ev ?? 0)],
  ['Max Drawdown    (≤20%)', (mAll?.maxDD ?? 100) <= 20, `${(mAll?.maxDD ?? 100).toFixed(1)}%`],
  ['Retorno total   (>0%)',  (mAll?.totalReturn ?? -1) > 0, fp(mAll?.totalReturn ?? 0)],
  ['Sharpe          (≥0.5)', (mAll?.sharpe ?? -1) >= 0.5, ff(mAll?.sharpe ?? 0)],
];

console.log('');
for (const [label, pass, val] of benchmarks) {
  console.log(`  ${pass ? '✅' : '❌'}  ${label.padEnd(28)}  Resultado: ${val}`);
}

const passed = benchmarks.filter(([, p]) => p).length;
console.log(`\n  Benchmarks superados: ${passed}/${benchmarks.length}`);
console.log(`\n  ${verdict(mAll)}`);
console.log(`\n${BAR}\n`);
