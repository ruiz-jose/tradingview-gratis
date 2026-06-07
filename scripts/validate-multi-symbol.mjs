#!/usr/bin/env node
/**
 * validate-multi-symbol.mjs — Validación cross-asset (multi-símbolo)
 *
 * Técnica profesional para verificar que el edge NO es específico de un solo
 * activo (que sería señal de overfitting sobre datos de BTC).
 *
 * Prueba la misma estrategia sin cambiar ningún parámetro en:
 *   BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, ADAUSDT
 *
 * Métricas clave:
 *  - ¿Cuántos símbolos tienen PF > 1?   → generalización
 *  - ¿Es consistente el win rate?        → robustez
 *  - PF medio y agregado                 → expectativa real
 *  - Correlación entre retornos          → diversificación
 *
 * Uso:
 *   node scripts/validate-multi-symbol.mjs [N_15M] [SYMBOLS...]
 *
 * Ejemplos:
 *   node scripts/validate-multi-symbol.mjs 3000
 *   node scripts/validate-multi-symbol.mjs 3000 BTCUSDT ETHUSDT SOLUSDT
 */

import {
  rsiArr, computeTmSeries, simulate, calcMetrics,
  fetchPaginated, fp, ff, fd,
  WARMUP,
} from './lib-backtest.mjs';

const N_15M = parseInt(process.argv[2] || '3000', 10);
const SYMBOLS = process.argv.slice(3).length > 0
  ? process.argv.slice(3)
  : ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT'];

const W    = 78;
const LINE = '═'.repeat(W);
const DASH = '─'.repeat(W);

// ── Backtest completo para un símbolo ─────────────────────────────────────────
async function backtestSymbol(symbol) {
  const n1h = Math.min(1500, Math.ceil(N_15M / 4)  + 100);
  const n4h = Math.min(1000, Math.ceil(N_15M / 16) + 100);

  try {
    const [c15m, c1h, c4h, c1w, c1M] = await Promise.all([
      fetchPaginated(symbol, '15m', N_15M, true),
      fetchPaginated(symbol, '1h',  n1h,   true),
      fetchPaginated(symbol, '4h',  n4h,   true),
      fetchPaginated(symbol, '1w',  200,   true),
      fetchPaginated(symbol, '1M',  60,    true),
    ]);

    if (c15m.length < WARMUP + 50) return { symbol, error: 'Datos insuficientes' };

    const rsi15m = rsiArr(c15m, 14);
    const tm1h   = computeTmSeries(c1h);
    const tm4h   = computeTmSeries(c4h);
    const tm1w   = computeTmSeries(c1w);
    const tm1M   = computeTmSeries(c1M);

    const htfData = [
      { candles: c1h, series: tm1h },
      { candles: c4h, series: tm4h },
      { candles: c1w, series: tm1w },
      { candles: c1M, series: tm1M },
    ];

    const trades  = simulate(c15m, rsi15m, htfData);
    const metrics = calcMetrics(trades);

    const period = c15m.length >= WARMUP
      ? `${fd(c15m[WARMUP].time)} → ${fd(c15m.at(-1).time)}`
      : '─';

    return { symbol, trades, metrics, period };
  } catch (err) {
    return { symbol, error: err.message };
  }
}

// ── Correlación de Pearson entre dos series ───────────────────────────────────
function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const ax = a.slice(-n), bx = b.slice(-n);
  const ma = ax.reduce((s, v) => s + v, 0) / n;
  const mb = bx.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (ax[i] - ma) * (bx[i] - mb);
    da  += (ax[i] - ma) ** 2;
    db  += (bx[i] - mb) ** 2;
  }
  const denom = Math.sqrt(da * db);
  return denom === 0 ? null : num / denom;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'▓'.repeat(W)}`);
  console.log(`  VALIDACIÓN MULTI-SÍMBOLO — ${N_15M} velas 15m | ${SYMBOLS.length} activos`);
  console.log(`${'▓'.repeat(W)}\n`);

  // ── Descarga y backtest secuencial ──────────────────────────────────────────
  console.log(`Procesando símbolos: ${SYMBOLS.join(', ')}\n`);

  const results = [];
  for (const sym of SYMBOLS) {
    process.stdout.write(`  ${sym.padEnd(10)} ► `);
    const res = await backtestSymbol(sym);
    if (res.error) {
      console.log(`ERROR: ${res.error}`);
    } else if (!res.metrics) {
      console.log(`0 trades`);
    } else {
      const m = res.metrics;
      console.log(`${m.n} trades | WR: ${ff(m.wrPct)}% | PF: ${ff(m.pf)} | Ret: ${fp(m.totalReturn)} | DD: -${ff(m.maxDD)}%`);
    }
    results.push(res);
    await new Promise(r => setTimeout(r, 400));
  }

  const valid = results.filter(r => !r.error && r.metrics);

  if (!valid.length) {
    console.log('\n⚠️  Sin resultados válidos para ningún símbolo.');
    process.exit(0);
  }

  // ── Tabla resumen ────────────────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log(`  RESUMEN MULTI-SÍMBOLO`);
  console.log(DASH);

  const hdr = `  ${'Símbolo'.padEnd(10)} ${'Trades'.padStart(6)} ${'WR%'.padStart(6)} ${'PF'.padStart(7)} ${'Ret%'.padStart(9)} ${'Max DD'.padStart(8)} ${'Sharpe'.padStart(8)} ${'EV/trade'.padStart(9)}`;
  console.log(hdr);
  console.log('  ' + '─'.repeat(hdr.length - 2));

  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.symbol.padEnd(10)} ERROR: ${r.error}`);
      continue;
    }
    if (!r.metrics) {
      console.log(`  ${r.symbol.padEnd(10)} ${'0'.padStart(6)} ${'─'.padStart(6)} ${'─'.padStart(7)} ${'─'.padStart(9)} ${'─'.padStart(8)} ${'─'.padStart(8)} ${'─'.padStart(9)}`);
      continue;
    }
    const m = r.metrics;
    const sign = m.totalReturn >= 0 ? '+' : '';
    console.log(
      `  ${r.symbol.padEnd(10)} ` +
      `${String(m.n).padStart(6)} ` +
      `${ff(m.wrPct).padStart(6)} ` +
      `${ff(m.pf).padStart(7)} ` +
      `${(sign + ff(m.totalReturn)).padStart(9)} ` +
      `${('-'+ff(m.maxDD)).padStart(8)} ` +
      `${ff(m.sharpe, 3).padStart(8)} ` +
      `${fp(m.ev).padStart(9)}`
    );
  }

  // ── Estadísticas agregadas ───────────────────────────────────────────────────
  const allTrades = valid.flatMap(r => r.trades);
  const aggMetrics = calcMetrics(allTrades);

  console.log(`\n${LINE}`);
  console.log(`  MÉTRICAS AGREGADAS (todos los activos combinados)`);
  console.log(DASH);
  if (aggMetrics) {
    const agg = [
      ['Trades totales',    `${aggMetrics.n}  (${aggMetrics.wins}W / ${aggMetrics.losses}L)`],
      ['Win rate',          `${ff(aggMetrics.wrPct)}%`],
      ['Profit factor',     ff(aggMetrics.pf)],
      ['EV por trade',      fp(aggMetrics.ev)],
      ['Retorno compuesto', fp(aggMetrics.totalReturn)],
      ['Max drawdown',      `-${ff(aggMetrics.maxDD)}%`],
      ['Sharpe',            ff(aggMetrics.sharpe, 3)],
      ['Sortino',           ff(aggMetrics.sortino, 3)],
    ];
    for (const [k, v] of agg) console.log(`  ${k.padEnd(26)} ${v}`);
  }

  // ── Análisis de generalización ───────────────────────────────────────────────
  const profitable = valid.filter(r => r.metrics && r.metrics.totalReturn > 0);
  const pfAbove1   = valid.filter(r => r.metrics && r.metrics.pf > 1.0);
  const wrValues   = valid.filter(r => r.metrics).map(r => r.metrics.wrPct);
  const wrMean     = wrValues.reduce((a, b) => a + b, 0) / (wrValues.length || 1);
  const wrStd      = Math.sqrt(wrValues.reduce((a, b) => a + (b - wrMean) ** 2, 0) / (wrValues.length || 1));

  console.log(`\n${LINE}`);
  console.log(`  ANÁLISIS DE GENERALIZACIÓN`);
  console.log(DASH);
  const gen = [
    ['Símbolos rentables',     `${profitable.length} / ${valid.length}  (${ff(profitable.length / valid.length * 100, 0)}%)`],
    ['PF > 1.0',               `${pfAbove1.length} / ${valid.length} activos`],
    ['WR media cross-asset',   `${ff(wrMean)}%  ± ${ff(wrStd)}% (σ)`],
  ];
  for (const [k, v] of gen) console.log(`  ${k.padEnd(28)} ${v}`);

  // ── Matriz de correlación de P&L ─────────────────────────────────────────────
  if (valid.length >= 2) {
    console.log(`\n${LINE}`);
    console.log(`  CORRELACIÓN DE P&L ENTRE ACTIVOS`);
    console.log(`  (valores cercanos a 0 = señales independientes; cercanos a 1 = mueven igual)`);
    console.log(DASH);

    // Construir series de P&L por tiempo (15m buckets)
    const allTimes = [...new Set(valid.flatMap(r => r.trades.map(t => t.entryTime)))].sort((a, b) => a - b);

    // Para cada activo: P&L total por período de 15m trade entry
    const pnlSeries = valid.map(r => {
      const byTime = new Map(r.trades.map(t => [t.entryTime, t.pnl]));
      return allTimes.map(t => byTime.get(t) ?? null);
    });

    // Correlación entre pares (ignorar nulls)
    const maxSymLen = Math.max(...valid.map(r => r.symbol.length));
    process.stdout.write(`  ${''.padEnd(maxSymLen + 2)}`);
    for (const r of valid) process.stdout.write(r.symbol.padStart(9));
    console.log();

    for (let i = 0; i < valid.length; i++) {
      process.stdout.write(`  ${valid[i].symbol.padEnd(maxSymLen + 2)}`);
      for (let j = 0; j < valid.length; j++) {
        if (i === j) {
          process.stdout.write(' ─────── '.padStart(9));
        } else {
          // Correlación solo en índices donde ambos tienen trade
          const aFiltered = [], bFiltered = [];
          for (let k = 0; k < allTimes.length; k++) {
            if (pnlSeries[i][k] !== null && pnlSeries[j][k] !== null) {
              aFiltered.push(pnlSeries[i][k]);
              bFiltered.push(pnlSeries[j][k]);
            }
          }
          const corr = pearson(aFiltered, bFiltered);
          process.stdout.write((corr !== null ? ff(corr, 3) : '─').padStart(9));
        }
      }
      console.log();
    }
  }

  // ── Diagnóstico de robustez ──────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log(`  DIAGNÓSTICO DE ROBUSTEZ`);
  console.log(DASH);

  const issues = [], goods = [];

  if (profitable.length / valid.length >= 0.8)
    goods.push(`✓ ${profitable.length}/${valid.length} activos rentables → edge generaliza bien`);
  else if (profitable.length / valid.length >= 0.5)
    issues.push(`~ ${profitable.length}/${valid.length} activos rentables → generalización parcial`);
  else
    issues.push(`✗ Solo ${profitable.length}/${valid.length} activos rentables → edge específico de activo`);

  if (wrStd < 8)
    goods.push(`✓ Baja dispersión del WR (σ=${ff(wrStd)}%) → comportamiento consistente`);
  else if (wrStd < 15)
    issues.push(`~ Dispersión moderada del WR (σ=${ff(wrStd)}%) → algo dependiente del activo`);
  else
    issues.push(`✗ Alta dispersión del WR (σ=${ff(wrStd)}%) → muy dependiente del activo`);

  if (aggMetrics && aggMetrics.pf > 1.5)
    goods.push(`✓ PF agregado ${ff(aggMetrics.pf)} > 1.5 → expectativa positiva consolidada`);
  else if (aggMetrics && aggMetrics.pf > 1.0)
    issues.push(`~ PF agregado ${ff(aggMetrics.pf)}: positivo pero ajustado`);
  else
    issues.push(`✗ PF agregado ≤ 1.0: sin expectativa positiva en el universo de activos`);

  for (const g of goods) console.log(`  ${g}`);
  for (const i of issues) console.log(`  ${i}`);

  const verdict = goods.length >= issues.length
    ? `\n  → VEREDICTO: La estrategia GENERALIZA a múltiples activos. Robustez confirmada.`
    : `\n  → VEREDICTO: La estrategia es PARCIALMENTE robusta. Considerar ajustes por activo.`;
  console.log(verdict);
  console.log(`\n${LINE}\n`);
}

main().catch(err => {
  console.error('\n[validate-multi-symbol] Error:', err.message ?? err);
  process.exit(1);
});
