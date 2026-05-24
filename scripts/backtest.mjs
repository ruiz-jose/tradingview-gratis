#!/usr/bin/env node
/**
 * backtest.mjs — Backtest de la estrategia trendMeter sobre datos históricos de Binance.
 *
 * Uso:
 *   node scripts/backtest.mjs [SYMBOL] [TIMEFRAME] [NUM_CANDLES]
 *
 * Ejemplos:
 *   node scripts/backtest.mjs BTCUSDT 15m 3000
 *   node scripts/backtest.mjs BTCUSDT 1m 5000
 *   node scripts/backtest.mjs ETHUSDT 1h 2000
 *
 * Env vars opcionales:
 *   BACKTEST_FEES_PCT  (default: 0.1 — Binance spot taker fee por lado)
 */

try { process.loadEnvFile('.env'); } catch { /* ok en CI */ }

const SYMBOL    = process.argv[2] || process.env.BINANCE_SYMBOL    || 'BTCUSDT';
const TIMEFRAME = process.argv[3] || process.env.BINANCE_TIMEFRAME || '1h';
const N_CANDLES = parseInt(process.argv[4] || '2000', 10);
const FEES_PCT  = parseFloat(process.env.BACKTEST_FEES_PCT || '0.1');
const WARMUP    = 60; // velas de calentamiento para que los indicadores se estabilicen

// ── Batch indicators (O(n) sobre el array completo) ───────────────────────────

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

function atrArr(candles, period) {
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
  let prevUpper = 0, prevLower = 0, prevDir = 1, initialized = false;
  for (let i = atrPeriod; i < candles.length; i++) {
    if (atr[i] === null) continue;
    const hl2 = (candles[i].high + candles[i].low) / 2;
    let upper = hl2 + factor * atr[i];
    let lower = hl2 - factor * atr[i];
    if (initialized) {
      lower = lower > prevLower || candles[i - 1].close < prevLower ? lower : prevLower;
      upper = upper < prevUpper || candles[i - 1].close > prevUpper ? upper : prevUpper;
    }
    const d = !initialized ? 1
      : prevDir === 1 ? (candles[i].close < lower ? -1 : 1)
      : (candles[i].close > upper ? 1 : -1);
    out[i] = d;
    prevUpper = upper; prevLower = lower; prevDir = d; initialized = true;
  }
  return out;
}

function macdHistArr(candles, fast, slow, signal) {
  const out = new Array(candles.length).fill(null);
  const emaFast = emaArr(candles, fast);
  const emaSlow = emaArr(candles, slow);
  const macdLine = candles.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i] - emaSlow[i] : null,
  );
  const start = macdLine.findIndex(v => v !== null);
  if (start === -1 || candles.length - start < signal) return out;
  const k = 2 / (signal + 1);
  let sigVal = macdLine.slice(start, start + signal).reduce((a, b) => a + b, 0) / signal;
  const sigLine = new Array(candles.length).fill(null);
  sigLine[start + signal - 1] = sigVal;
  for (let i = start + signal; i < candles.length; i++) {
    sigVal = macdLine[i] * k + sigVal * (1 - k);
    sigLine[i] = sigVal;
  }
  for (let i = 0; i < candles.length; i++) {
    if (macdLine[i] !== null && sigLine[i] !== null) out[i] = macdLine[i] - sigLine[i];
  }
  return out;
}

function computeTrendMeters(candles) {
  const ema20 = emaArr(candles, 20);
  const ema50 = emaArr(candles, 50);
  const ema9  = emaArr(candles, 9);
  const ema21 = emaArr(candles, 21);
  const stDir = supertrendDirArr(candles, 10, 3.0);
  const macdH = macdHistArr(candles, 12, 26, 9);

  return candles.map((c, i) => {
    if (ema20[i] === null || ema50[i] === null || ema9[i] === null ||
        ema21[i] === null || stDir[i] === null || macdH[i] === null) return null;
    const score =
      (c.close > ema20[i] ? 1 : -1) +
      (c.close > ema50[i] ? 1 : -1) +
      (ema9[i] > ema21[i] ? 1 : -1) +
      stDir[i] +
      (macdH[i] >= 0 ? 1 : -1);
    return { score, direction: score >= 3 ? 'bull' : score <= -3 ? 'bear' : 'neutral' };
  });
}

// ── Binance paginated fetch ───────────────────────────────────────────────────

async function fetchPageBinance(symbol, interval, limit, endTime) {
  let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  if (endTime) url += `&endTime=${endTime}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Binance ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.map(k => ({
    time:   Math.floor(k[0] / 1000),
    openMs: Number(k[0]),
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

async function fetchCandlesPaginated(symbol, interval, total) {
  const PER_PAGE = 1000;
  const batches = [];
  let endTime = null;

  process.stdout.write(`Descargando ${total} velas ${symbol} ${interval}`);

  while (true) {
    const fetched = batches.reduce((s, b) => s + b.length, 0);
    if (fetched >= total) break;
    const limit = Math.min(PER_PAGE, total - fetched);
    const batch = await fetchPageBinance(symbol, interval, limit, endTime);
    if (batch.length === 0) break;
    batches.unshift(batch);                    // oldest first
    endTime = batch[0].openMs - 1;
    process.stdout.write('.');
    if (batch.length < limit) break;           // no more historical data
    await new Promise(r => setTimeout(r, 120)); // stay well within Binance rate limits
  }

  process.stdout.write(' listo\n');

  const seen = new Set();
  return batches
    .flat()
    .sort((a, b) => a.time - b.time)
    .filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true; });
}

// ── Backtest simulation ───────────────────────────────────────────────────────

function backtest(candles, meters) {
  const trades = [];
  let position   = null;  // { type, entryPrice, entryIdx, entryTime, entryScore }
  let prevDir    = 'neutral';

  for (let i = WARMUP; i < candles.length - 1; i++) {
    const m = meters[i];
    if (!m) continue;

    const { direction, score } = m;
    const changed      = direction !== prevDir;
    const isActionable = direction === 'bull' || direction === 'bear';

    if (changed && isActionable) {
      // Cerramos posición existente (si hay)
      if (position) {
        const exitPrice = candles[i + 1].open;
        const rawPnl = position.type === 'long'
          ? (exitPrice - position.entryPrice) / position.entryPrice * 100
          : (position.entryPrice - exitPrice) / position.entryPrice * 100;
        const netPnl = rawPnl - 2 * FEES_PCT;
        trades.push({
          type:        position.type,
          entryTime:   position.entryTime,
          exitTime:    candles[i + 1].time,
          entryPrice:  position.entryPrice,
          exitPrice,
          rawPnlPct:   rawPnl,
          netPnlPct:   netPnl,
          durationBars: i + 1 - position.entryIdx,
          win:         netPnl > 0,
          entryScore:  position.entryScore,
        });
        position = null;
      }
      // Abrimos nueva posición al open de la siguiente vela
      position = {
        type:       direction === 'bull' ? 'long' : 'short',
        entryPrice: candles[i + 1].open,
        entryIdx:   i + 1,
        entryTime:  candles[i + 1].time,
        entryScore: score,
      };
    }

    prevDir = direction;
  }

  // Cerramos posición abierta al cierre de la última vela
  if (position) {
    const last = candles[candles.length - 1];
    const rawPnl = position.type === 'long'
      ? (last.close - position.entryPrice) / position.entryPrice * 100
      : (position.entryPrice - last.close) / position.entryPrice * 100;
    const netPnl = rawPnl - 2 * FEES_PCT;
    trades.push({
      type:        position.type,
      entryTime:   position.entryTime,
      exitTime:    last.time,
      entryPrice:  position.entryPrice,
      exitPrice:   last.close,
      rawPnlPct:   rawPnl,
      netPnlPct:   netPnl,
      durationBars: candles.length - 1 - position.entryIdx,
      win:         netPnl > 0,
      entryScore:  position.entryScore,
      openClose:   true,
    });
  }

  return trades;
}

// ── Report ────────────────────────────────────────────────────────────────────

function fmt(ts) { return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16); }
function pct(n)  { return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`; }

function report(trades, candles) {
  const W = 74;
  const line = '═'.repeat(W);
  const dash = '─'.repeat(W);

  if (trades.length === 0) {
    console.log('\nSin operaciones en el período.\n');
    return;
  }

  const wins   = trades.filter(t => t.win);
  const losses = trades.filter(t => !t.win);
  const longs  = trades.filter(t => t.type === 'long');
  const shorts = trades.filter(t => t.type === 'short');

  const winRate   = (wins.length / trades.length * 100).toFixed(1);
  const avgWin    = wins.length  ? wins.reduce((s, t) => s + t.netPnlPct, 0)  / wins.length  : 0;
  const avgLoss   = losses.length ? losses.reduce((s, t) => s + t.netPnlPct, 0) / losses.length : 0;
  const grossGain = wins.reduce((s, t) => s + t.netPnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnlPct, 0));
  const pf        = grossLoss > 0 ? (grossGain / grossLoss).toFixed(2) : '∞';
  const avgDur    = (trades.reduce((s, t) => s + t.durationBars, 0) / trades.length).toFixed(1);

  // Retorno compuesto (equity curve)
  let equity = 100, peak = 100, maxDD = 0;
  for (const t of trades) {
    equity *= (1 + t.netPnlPct / 100);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
  }
  const totalReturn = equity - 100;

  // Rachas
  let maxWinStreak = 0, maxLossStreak = 0, ws = 0, ls = 0;
  for (const t of trades) {
    if (t.win) { ws++; ls = 0; } else { ls++; ws = 0; }
    if (ws > maxWinStreak) maxWinStreak = ws;
    if (ls > maxLossStreak) maxLossStreak = ls;
  }

  const period = `${fmt(candles[WARMUP].time)} → ${fmt(candles[candles.length - 1].time)}`;

  console.log(`\n${line}`);
  console.log(`  BACKTEST  ${SYMBOL} ${TIMEFRAME.toUpperCase()}   ${period}`);
  console.log(line);

  console.log('\n  RESUMEN\n');
  const rows = [
    ['Período',          period],
    ['Velas analizadas', `${candles.length - WARMUP} (${WARMUP} warmup descartadas)`],
    ['Trades totales',   `${trades.length}  (${longs.length} long, ${shorts.length} short)`],
    ['Win rate',         `${winRate}%  (${wins.length}W / ${losses.length}L)`],
    ['Avg ganancia',     pct(avgWin)],
    ['Avg pérdida',      pct(avgLoss)],
    ['Profit factor',    pf],
    ['Retorno total',    `${pct(totalReturn)}  (equity final: ${equity.toFixed(2)})`],
    ['Max drawdown',     `-${maxDD.toFixed(2)}%`],
    ['Duración prom.',   `${avgDur} velas`],
    ['Racha gana./perd.', `${maxWinStreak}W / ${maxLossStreak}L`],
    ['Comisión',         `${FEES_PCT}% × 2 = ${(FEES_PCT * 2).toFixed(2)}% por trade`],
  ];
  for (const [k, v] of rows) console.log(`  ${k.padEnd(22)} ${v}`);

  // Por dirección
  function statLine(label, subset) {
    if (!subset.length) return `  ${label.padEnd(8)} sin trades`;
    const w = subset.filter(t => t.win);
    const wr = (w.length / subset.length * 100).toFixed(0);
    const avg = (subset.reduce((s, t) => s + t.netPnlPct, 0) / subset.length).toFixed(2);
    return `  ${label.padEnd(8)} ${subset.length} trades  WR ${wr}%  avg ${pct(parseFloat(avg))}`;
  }
  console.log('\n  POR DIRECCIÓN\n');
  console.log(statLine('Long  :', longs));
  console.log(statLine('Short :', shorts));

  // Tabla de operaciones
  console.log('\n' + dash);
  console.log('  OPERACIONES\n');
  const hdr =
    `  ${'#'.padStart(3)}  ` +
    `${'Tipo'.padEnd(5)}  ` +
    `${'Entrada'.padEnd(16)}  ` +
    `${'Salida'.padEnd(16)}  ` +
    `${'P.Entry'.padStart(10)}  ` +
    `${'P.Exit'.padStart(10)}  ` +
    `${'P&L neto'.padStart(9)}  ` +
    `${'Bars'.padStart(4)}`;
  console.log(hdr);
  console.log('  ' + '─'.repeat(hdr.length - 2));

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    console.log(
      `  ${String(i + 1).padStart(3)}  ` +
      `${(t.type === 'long' ? 'L' : 'S').padEnd(5)}  ` +
      `${fmt(t.entryTime).padEnd(16)}  ` +
      `${fmt(t.exitTime).padEnd(16)}  ` +
      `${t.entryPrice.toFixed(2).padStart(10)}  ` +
      `${t.exitPrice.toFixed(2).padStart(10)}  ` +
      `${pct(t.netPnlPct).padStart(9)}  ` +
      `${String(t.durationBars).padStart(4)}` +
      `  ${t.win ? 'W' : 'L'}` +
      (t.openClose ? ' *' : ''),
    );
  }
  console.log('\n  * posición cerrada al final del período');
  console.log(`\n${line}\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n[backtest] ${SYMBOL} ${TIMEFRAME} | ${N_CANDLES} velas | fee ${FEES_PCT}%/lado\n`);

  const candles = await fetchCandlesPaginated(SYMBOL, TIMEFRAME, N_CANDLES);
  if (candles.length < WARMUP + 10) {
    console.error('[backtest] No hay suficientes datos. Intentá con menos velas o un símbolo más líquido.');
    process.exit(1);
  }

  process.stdout.write(`[backtest] Calculando indicadores sobre ${candles.length} velas...`);
  const meters = computeTrendMeters(candles);
  process.stdout.write(' listo\n');

  process.stdout.write('[backtest] Simulando trades...');
  const trades = backtest(candles, meters);
  process.stdout.write(' listo\n');

  report(trades, candles);
}

main().catch(err => {
  console.error('[backtest] Error inesperado:', err.message ?? err);
  process.exit(1);
});
