#!/usr/bin/env node
/**
 * backtest-mtf-short.mjs — Backtest de la estrategia MTF Short Entry
 *
 * Simula la estrategia sobre datos históricos de Binance:
 *   · Filtro HTF: 1h, 4h, 1w, 1M todos bajistas (trendMeter ≤ -4/6)
 *   · Retroceso activo en 15m (precio en mitad superior del rango)
 *   · Mínimo 2 de 3 confirmaciones: ChoCh, RSI overbought cross, vela bajista
 *   · Stop Loss en el máximo del retroceso (+0.3%)
 *   · Take Profit en el mínimo del retroceso (inicio del pullback)
 *
 * Uso:
 *   node scripts/backtest-mtf-short.mjs [SYMBOL] [N_15M_CANDLES]
 *
 * Ejemplos:
 *   node scripts/backtest-mtf-short.mjs BTCUSDT 3000   (~31 días)
 *   node scripts/backtest-mtf-short.mjs BTCUSDT 5000   (~52 días)
 *   node scripts/backtest-mtf-short.mjs ETHUSDT 3000
 */

const SYMBOL   = process.argv[2] || 'BTCUSDT';
const N_15M    = parseInt(process.argv[3] || '3000', 10);
const FEES_PCT = 0.1;   // comisión por lado (taker Binance Futures)
const WARMUP   = 60;    // velas de calentamiento descartadas
const MAX_BARS = 200;   // 200 × 15m = 50h máximo en un trade abierto

// ── Arrays de indicadores O(n) ────────────────────────────────────────────────

function emaArr(candles, period) {
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

function rsiArr(candles, period = 14) {
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

function atrArr(candles, period = 14) {
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

function supertrendDirArr(candles, atrPeriod, factor) {
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

function macdHistArr(candles, fast, slow, signal) {
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

/**
 * trendMeter en batch: 6 señales, umbral ±4/6 (igual que src/lib/indicators/index.ts).
 * Devuelve array de { score, direction } | null por cada vela.
 */
function computeTmSeries(candles) {
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

// ── Detección de señal short (réplica exacta de detectShortEntry en 15m) ──────

function detectSignal(candles, rsiVals, i) {
  if (i < WARMUP || !candles[i] || !candles[i - 1]) return null;

  // 1. Retroceso activo: rango ≥ 0.8% y precio en mitad superior
  let hi = -Infinity, lo = Infinity;
  for (let j = Math.max(0, i - 29); j <= i; j++) {
    if (candles[j].high > hi) hi = candles[j].high;
    if (candles[j].low  < lo) lo = candles[j].low;
  }
  if (hi <= 0 || (hi - lo) / lo < 0.008) return null;
  if (candles[i].close < lo + (hi - lo) * 0.5) return null;

  // 2. RSI overbought cross: pico >65 en últimas 5 velas, ahora declinando
  const rNow = rsiVals[i], rPrev = rsiVals[i - 1];
  if (rNow === null || rPrev === null) return null;
  let rPeak = -Infinity;
  for (let j = Math.max(0, i - 4); j <= i; j++) {
    if (rsiVals[j] !== null && rsiVals[j] > rPeak) rPeak = rsiVals[j];
  }
  const rsiCross = rPeak > 65 && rNow < rPrev;

  // 3. ChoCh: último mínimo local dentro del retroceso, cierre por debajo
  let structureLow = null;
  for (let j = Math.max(1, i - 19); j < i; j++) {
    if (candles[j - 1] && candles[j] && candles[j + 1] &&
        candles[j].low < candles[j - 1].low &&
        candles[j].low < candles[j + 1].low &&
        candles[j].low > lo * 1.001) {
      structureLow = candles[j].low;
    }
  }
  const choch = structureLow !== null && candles[i].close < structureLow;

  // 4. Patrón de vela bajista en la vela actual
  const curr = candles[i], prev = candles[i - 1];
  let bearPat = false;
  if (prev.close > prev.open && curr.close < curr.open &&
      curr.open >= prev.close && curr.close <= prev.open) {
    bearPat = true;  // bearish engulfing
  }
  if (!bearPat) {
    const body = Math.abs(curr.close - curr.open);
    const rng  = curr.high - curr.low;
    const uw   = curr.high - Math.max(curr.open, curr.close);
    const lw   = Math.min(curr.open, curr.close) - curr.low;
    if (rng > 0 && body < rng * 0.4 && uw > body * 2 &&
        lw < body * 0.6 && (curr.high - curr.close) / rng > 0.55) {
      bearPat = true;  // shooting star
    }
  }

  // 5. Mínimo 2 de 3 confirmaciones
  const count = [choch, rsiCross, bearPat].filter(Boolean).length;
  if (count < 2) return null;

  const sl   = hi * 1.003;
  const tp1  = lo;
  const risk = sl - curr.close;
  const tp2  = risk > 0 ? curr.close - risk * 2 : tp1;

  return { sl, tp1, tp2, count, choch, rsiCross, bearPat, hi, lo };
}

// ── Fetch paginado de Binance ─────────────────────────────────────────────────

async function fetchPage(symbol, interval, limit, endTime) {
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

async function fetchPaginated(symbol, interval, total) {
  const PER = 1000;
  const batches = [];
  let endTime = null;
  process.stdout.write(`  ${symbol} ${interval.padEnd(4)} (${total})  `);
  while (true) {
    const fetched = batches.reduce((s, b) => s + b.length, 0);
    if (fetched >= total) break;
    const limit = Math.min(PER, total - fetched);
    const batch = await fetchPage(symbol, interval, limit, endTime);
    if (!batch.length) break;
    batches.unshift(batch);
    endTime = batch[0].openMs - 1;
    process.stdout.write('.');
    if (batch.length < limit) break;
    await new Promise(r => setTimeout(r, 120));
  }
  process.stdout.write(' ✓\n');
  const seen = new Set();
  return batches.flat()
    .sort((a, b) => a.time - b.time)
    .filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true; });
}

// ── Simulación ────────────────────────────────────────────────────────────────

function simulate(c15m, rsi15m, htfData) {
  const trades = [];
  let active = null;

  // Punteros HTF: avanzan con el tiempo, O(n) total
  const ptrs = htfData.map(d => ({ ...d, idx: 0 }));

  for (let i = WARMUP; i < c15m.length - 1; i++) {
    const t = c15m[i].time;

    // Avanzar punteros al último bar HTF cuyo open ≤ t
    for (const p of ptrs) {
      while (p.idx + 1 < p.series.length && p.candles[p.idx + 1].time <= t) p.idx++;
    }

    // ── Gestión del trade abierto ────────────────────────────────────────────
    if (active) {
      const c = c15m[i];
      const bars = i - active.entryBar;

      if (c.high >= active.sl) {           // SL hit (conservador: primero SL)
        const pnl = (active.entry - active.sl) / active.entry * 100 - 2 * FEES_PCT;
        trades.push({ ...active, exitTime: c.time, exitPrice: active.sl, pnl, win: false, reason: 'SL', bars });
        active = null;
        continue;
      }
      if (c.low <= active.tp1) {           // TP1 hit
        const pnl = (active.entry - active.tp1) / active.entry * 100 - 2 * FEES_PCT;
        trades.push({ ...active, exitTime: c.time, exitPrice: active.tp1, pnl, win: true, reason: 'TP1', bars });
        active = null;
        continue;
      }
      if (bars >= MAX_BARS) {              // Timeout: cierre en mercado
        const pnl = (active.entry - c.close) / active.entry * 100 - 2 * FEES_PCT;
        trades.push({ ...active, exitTime: c.time, exitPrice: c.close, pnl, win: pnl > 0, reason: 'TO', bars });
        active = null;
      }
      continue;
    }

    // ── Filtro HTF: todos bajistas ────────────────────────────────────────────
    if (!ptrs.every(p => { const tm = p.series[p.idx]; return tm && tm.direction === 'bear'; })) continue;

    // ── Señal en 15m ─────────────────────────────────────────────────────────
    const sig = detectSignal(c15m, rsi15m, i);
    if (!sig) continue;

    // Entrar al open de la siguiente vela
    const next = c15m[i + 1];
    active = {
      entryTime: next.time, entry: next.open, entryBar: i + 1,
      sl: sig.sl, tp1: sig.tp1, tp2: sig.tp2,
      count: sig.count, choch: sig.choch, rsiCross: sig.rsiCross, bearPat: sig.bearPat,
      pullbackHigh: sig.hi, pullbackLow: sig.lo,
    };
  }

  // Cerrar trade abierto al final del período
  if (active) {
    const last = c15m[c15m.length - 1];
    const pnl = (active.entry - last.close) / active.entry * 100 - 2 * FEES_PCT;
    trades.push({ ...active, exitTime: last.time, exitPrice: last.close, pnl, win: pnl > 0, reason: 'FIN', bars: c15m.length - 1 - active.entryBar, openClose: true });
  }

  return trades;
}

// ── Reporte ───────────────────────────────────────────────────────────────────

function fd(ts) { return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16); }
function fp(n)  { return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`; }

function report(trades, c15m) {
  const W    = 78;
  const LINE = '═'.repeat(W);
  const DASH = '─'.repeat(W);

  console.log(`\n${LINE}`);
  console.log(`  BACKTEST MTF SHORT  ${SYMBOL}  15m  |  ${N_15M} velas  |  fee ${FEES_PCT}%/lado`);
  console.log(`  Período: ${fd(c15m[WARMUP].time)} → ${fd(c15m.at(-1).time)}`);
  console.log(LINE);

  if (!trades.length) {
    console.log('\n  ⚠️  Sin trades en el período.\n');
    console.log('  Posibles causas:');
    console.log('  · Período sin alineación HTF bajista (probar en bear market conocido)');
    console.log('  · RSI nunca superó 65 durante los pullbacks');
    console.log('  · Retrocesos demasiado pequeños (<0.8% de rango)');
    console.log('\n  Sugerencia: probar Jun–Nov 2022 con N_15M=15000\n');
    console.log(LINE + '\n');
    return;
  }

  const wins   = trades.filter(t => t.win);
  const losses = trades.filter(t => !t.win);
  const cnt    = { SL: 0, TP1: 0, TO: 0, FIN: 0 };
  for (const t of trades) cnt[t.reason] = (cnt[t.reason] || 0) + 1;

  const wr     = (wins.length / trades.length * 100).toFixed(1);
  const avgW   = wins.length   ? wins.reduce((s, t)   => s + t.pnl, 0) / wins.length   : 0;
  const avgL   = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const gGain  = wins.reduce((s, t)   => s + t.pnl, 0);
  const gLoss  = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const pf     = gLoss > 0 ? (gGain / gLoss).toFixed(2) : '∞';
  const avgBar = (trades.reduce((s, t) => s + t.bars, 0) / trades.length).toFixed(1);

  // Calidad por número de confirmaciones
  const by2 = trades.filter(t => t.count === 2);
  const by3 = trades.filter(t => t.count === 3);

  // Equity curve
  let equity = 100, peak = 100, maxDD = 0;
  for (const t of trades) {
    equity *= (1 + t.pnl / 100);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
  }

  console.log('\n  RESUMEN\n');
  const rows = [
    ['Trades totales',     `${trades.length}  (TP1: ${cnt.TP1 || 0}  SL: ${cnt.SL || 0}  Timeout: ${cnt.TO || 0})`],
    ['Win rate',           `${wr}%  (${wins.length}W / ${losses.length}L)`],
    ['Avg ganancia',       fp(avgW)],
    ['Avg pérdida',        fp(avgL)],
    ['Profit factor',      pf],
    ['Retorno total',      `${fp(equity - 100)}  (equity final: ${equity.toFixed(2)})`],
    ['Max drawdown',       `-${maxDD.toFixed(2)}%`],
    ['Duración prom.',     `${avgBar} velas × 15m = ${(parseFloat(avgBar) * 15 / 60).toFixed(1)}h`],
    ['3 confirmaciones',   `${by3.length} trades  WR: ${by3.length ? (by3.filter(t=>t.win).length/by3.length*100).toFixed(0)+'%' : '-'}`],
    ['2 confirmaciones',   `${by2.length} trades  WR: ${by2.length ? (by2.filter(t=>t.win).length/by2.length*100).toFixed(0)+'%' : '-'}`],
  ];
  for (const [k, v] of rows) console.log(`  ${k.padEnd(22)} ${v}`);

  // Tabla de operaciones
  console.log(`\n${DASH}`);
  console.log('  OPERACIONES  (C=ChoCh  R=RSI cross  P=Patrón vela)\n');
  const hdr =
    `  ${'#'.padStart(3)}  ` +
    `${'Entrada UTC'.padEnd(16)}  ` +
    `${'Salida UTC'.padEnd(16)}  ` +
    `${'Entry $'.padStart(10)}  ` +
    `${'Exit $'.padStart(10)}  ` +
    `${'PnL neto'.padStart(9)}  ` +
    `${'Bars'.padStart(4)}  ` +
    `Conf  Sal`;
  console.log(hdr);
  console.log('  ' + '─'.repeat(hdr.length - 2));

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const cf = `${t.choch ? 'C' : '·'}${t.rsiCross ? 'R' : '·'}${t.bearPat ? 'P' : '·'}`;
    console.log(
      `  ${String(i + 1).padStart(3)}  ` +
      `${fd(t.entryTime).padEnd(16)}  ` +
      `${fd(t.exitTime).padEnd(16)}  ` +
      `${t.entry.toFixed(2).padStart(10)}  ` +
      `${t.exitPrice.toFixed(2).padStart(10)}  ` +
      `${fp(t.pnl).padStart(9)}  ` +
      `${String(t.bars).padStart(4)}  ` +
      `${cf.padStart(4)}  ` +
      `${t.win ? '✓' : '✗'} ${t.reason}` +
      (t.openClose ? ' *' : ''),
    );
  }

  console.log(`\n${LINE}\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n[backtest-mtf-short] ${SYMBOL} | ${N_15M} velas 15m | fee ${FEES_PCT}%/lado\n`);

  console.log('Descargando datos históricos...');
  const n1h = Math.min(1500, Math.ceil(N_15M / 4)  + 100);
  const n4h = Math.min(1000, Math.ceil(N_15M / 16) + 100);

  const [c15m, c1h, c4h, c1w, c1M] = await Promise.all([
    fetchPaginated(SYMBOL, '15m', N_15M),
    fetchPaginated(SYMBOL, '1h',  n1h),
    fetchPaginated(SYMBOL, '4h',  n4h),
    fetchPaginated(SYMBOL, '1w',  200),
    fetchPaginated(SYMBOL, '1M',  60),
  ]);

  if (c15m.length < WARMUP + 10) {
    console.error('No hay suficientes velas 15m. Reduce N_15M o prueba otro símbolo.');
    process.exit(1);
  }

  console.log('\nCalculando indicadores...');
  const rsi15m = rsiArr(c15m, 14);

  process.stdout.write('  1h  '); const tm1h = computeTmSeries(c1h); process.stdout.write('✓  ');
  process.stdout.write('4h  ');  const tm4h = computeTmSeries(c4h); process.stdout.write('✓  ');
  process.stdout.write('1w  ');  const tm1w = computeTmSeries(c1w); process.stdout.write('✓  ');
  process.stdout.write('1M  ');  const tm1M = computeTmSeries(c1M); process.stdout.write('✓\n');

  const htfData = [
    { candles: c1h, series: tm1h },
    { candles: c4h, series: tm4h },
    { candles: c1w, series: tm1w },
    { candles: c1M, series: tm1M },
  ];

  console.log('\nSimulando trades...');
  const trades = simulate(c15m, rsi15m, htfData);
  console.log(`  → ${trades.length} señales encontradas en período con HTF bajista`);

  report(trades, c15m);
}

main().catch(err => {
  console.error('\n[backtest-mtf-short] Error:', err.message ?? err);
  process.exit(1);
});
