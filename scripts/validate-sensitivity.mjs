#!/usr/bin/env node
/**
 * validate-sensitivity.mjs — Análisis de Sensibilidad de Parámetros
 *
 * Técnica profesional para detectar:
 *  1. Overfitting fino (los resultados colapsan si el parámetro varía ±1)
 *  2. Parámetros robustos (el edge se mantiene en un rango amplio)
 *  3. Zona óptima (combinación de parámetros con mejor rendimiento)
 *
 * Parámetros evaluados:
 *   rsiThreshold  : 58, 62, 65, 68, 72        (default: 65)
 *   rangeMin      : 0.004, 0.006, 0.008, 0.01, 0.012  (default: 0.008)
 *   lookback      : 20, 25, 30, 35, 40        (default: 30)
 *   slBuffer      : 0.001, 0.002, 0.003, 0.005 (default: 0.003)
 *   minConfirms   : 2, 3                       (default: 2)
 *
 * Modo de uso:
 *   node scripts/validate-sensitivity.mjs [SYMBOL] [N_15M] [PARAM]
 *
 * PARAM puede ser: rsi | range | lookback | sl | confirms | all (default: all)
 *
 * Ejemplos:
 *   node scripts/validate-sensitivity.mjs BTCUSDT 5000 rsi
 *   node scripts/validate-sensitivity.mjs BTCUSDT 5000 all
 */

import {
  rsiArr, computeTmSeries, simulate, calcMetrics,
  fetchPaginated, fp, ff,
  WARMUP,
} from './lib-backtest.mjs';

const SYMBOL = process.argv[2] || 'BTCUSDT';
const N_15M  = parseInt(process.argv[3] || '5000', 10);
const PARAM  = (process.argv[4] || 'all').toLowerCase();
const W      = 78;
const LINE   = '═'.repeat(W);
const DASH   = '─'.repeat(W);

// ── Definición del grid de parámetros ─────────────────────────────────────────

const PARAM_GRIDS = {
  rsi:      { key: 'rsiThreshold',  label: 'RSI Threshold',   values: [58, 62, 65, 68, 72],            defaultVal: 65  },
  range:    { key: 'rangeMin',      label: 'Range Min (%)',    values: [0.004, 0.006, 0.008, 0.010, 0.012], defaultVal: 0.008, fmt: v => `${(v*100).toFixed(1)}%` },
  lookback: { key: 'lookback',      label: 'Lookback Bars',    values: [20, 25, 30, 35, 40],            defaultVal: 30  },
  sl:       { key: 'slBuffer',      label: 'SL Buffer (%)',    values: [0.001, 0.002, 0.003, 0.005],    defaultVal: 0.003, fmt: v => `${(v*100).toFixed(1)}%` },
  confirms: { key: 'minConfirms',   label: 'Min Confirms',     values: [2, 3],                          defaultVal: 2   },
};

const DEFAULT_PARAMS = {
  rsiThreshold: 65,
  rangeMin:     0.008,
  lookback:     30,
  slBuffer:     0.003,
  minConfirms:  2,
};

// ── Análisis de un grid unidimensional ───────────────────────────────────────

function analyzeGrid(results, gridDef) {
  const fmt = gridDef.fmt || (v => String(v));
  const baseResult = results.find(r => Math.abs(r.param - gridDef.defaultVal) < 1e-9);
  const basePF = baseResult?.metrics?.pf || 0;

  const pfValues = results.filter(r => r.metrics && isFinite(r.metrics.pf)).map(r => r.metrics.pf);
  const pfMin    = pfValues.length ? Math.min(...pfValues) : 0;
  const pfMax    = pfValues.length ? Math.max(...pfValues) : 0;
  const pfRange  = pfMax - pfMin;
  const pfMean   = pfValues.reduce((a, b) => a + b, 0) / (pfValues.length || 1);

  // Sensibilidad: % de variación del PF respecto a la base al mover el parámetro
  const sensitive = results.filter(r => r.metrics && r.metrics.n > 0).some(r => {
    const delta = Math.abs(r.param - gridDef.defaultVal);
    if (delta === 0) return false;
    const pfChange = Math.abs((r.metrics.pf - basePF) / (basePF || 1));
    return pfChange > 0.5; // >50% de cambio = sensible
  });

  return { fmt, pfMin, pfMax, pfRange, pfMean, sensitive, basePF };
}

// ── Robustez score (0-100) ────────────────────────────────────────────────────
function robustnessScore(results) {
  const valid = results.filter(r => r.metrics && r.metrics.n >= 3);
  if (!valid.length) return 0;
  const profitable = valid.filter(r => r.metrics.pf > 1.0);
  const pct = profitable.length / valid.length;
  const pfValues = valid.map(r => r.metrics.pf).filter(v => isFinite(v));
  const pfMean  = pfValues.reduce((a, b) => a + b, 0) / (pfValues.length || 1);
  const pfStd   = Math.sqrt(pfValues.reduce((a, b) => a + (b - pfMean) ** 2, 0) / (pfValues.length || 1));
  const cv      = pfMean > 0 ? pfStd / pfMean : 1; // Coefficient of Variation (lower = more stable)
  return Math.round(pct * 50 + Math.max(0, (1 - cv)) * 50);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'▓'.repeat(W)}`);
  console.log(`  ANÁLISIS DE SENSIBILIDAD — ${SYMBOL} | ${N_15M} velas 15m | Param: ${PARAM.toUpperCase()}`);
  console.log(`${'▓'.repeat(W)}\n`);

  // ── Descarga única de datos ─────────────────────────────────────────────────
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

  if (c15m.length < WARMUP + 50) { console.error('Datos insuficientes.'); process.exit(1); }

  console.log('\nCalculando indicadores base...');
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

  // Determinar qué parámetros analizar
  const gridsToRun = PARAM === 'all'
    ? Object.entries(PARAM_GRIDS)
    : Object.entries(PARAM_GRIDS).filter(([k]) => k === PARAM);

  if (!gridsToRun.length) {
    console.error(`Parámetro '${PARAM}' no reconocido. Usa: ${Object.keys(PARAM_GRIDS).join(', ')}, all`);
    process.exit(1);
  }

  const summaries = [];

  for (const [paramName, gridDef] of gridsToRun) {
    console.log(`\n${LINE}`);
    console.log(`  GRID: ${gridDef.label.toUpperCase()}`);
    console.log(DASH);

    const fmt = gridDef.fmt || (v => String(v));
    const results = [];

    const hdr = `  ${'Valor'.padEnd(12)} ${'Trades'.padStart(6)} ${'WR%'.padStart(6)} ${'PF'.padStart(7)} ${'Ret%'.padStart(9)} ${'Max DD'.padStart(8)} ${'Sharpe'.padStart(8)} ${'EV/t'.padStart(7)}  Flag`;
    console.log(hdr);
    console.log('  ' + '─'.repeat(hdr.length - 2));

    for (const val of gridDef.values) {
      // Construir parámetros con solo este valor variado
      const params = { ...DEFAULT_PARAMS, [gridDef.key]: val };
      const trades  = simulate(c15m, rsi15m, htfData, params);
      const metrics = calcMetrics(trades);
      const isDefault = Math.abs(val - gridDef.defaultVal) < 1e-9;
      const flag = isDefault ? ' ◄ DEFAULT' : '';

      results.push({ param: val, trades, metrics });

      if (metrics) {
        const sign = metrics.totalReturn >= 0 ? '+' : '';
        console.log(
          `  ${fmt(val).padEnd(12)} ` +
          `${String(metrics.n).padStart(6)} ` +
          `${ff(metrics.wrPct).padStart(6)} ` +
          `${ff(metrics.pf).padStart(7)} ` +
          `${(sign + ff(metrics.totalReturn)).padStart(9)} ` +
          `${('-'+ff(metrics.maxDD)).padStart(8)} ` +
          `${ff(metrics.sharpe, 3).padStart(8)} ` +
          `${fp(metrics.ev).padStart(7)}` +
          flag
        );
      } else {
        console.log(`  ${fmt(val).padEnd(12)} ${'0'.padStart(6)} ${'─'.padStart(6)} ${'─'.padStart(7)} ${'─'.padStart(9)} ${'─'.padStart(8)} ${'─'.padStart(8)} ${'─'.padStart(7)}${flag}`);
      }
    }

    // Análisis del grid
    const analysis = analyzeGrid(results, gridDef);
    const score    = robustnessScore(results);

    console.log(`\n  Robustez de ${gridDef.label}:`);
    console.log(`    PF rango:     ${ff(analysis.pfMin)} – ${ff(analysis.pfMax)}  (spread: ${ff(analysis.pfRange)})`);
    console.log(`    PF media:     ${ff(analysis.pfMean)}`);
    console.log(`    Sensibilidad: ${analysis.sensitive ? '⚠️  ALTA — el PF varía >50% al mover el parámetro' : '✓ BAJA — el PF es estable en el rango'}`);
    console.log(`    Score:        ${score}/100  ${score >= 70 ? '✓ Robusto' : score >= 40 ? '~ Moderado' : '✗ Frágil'}`);

    summaries.push({ paramName, label: gridDef.label, score, analysis, results });
  }

  // ── Análisis 2D si se ejecutan todos ─────────────────────────────────────────
  if (PARAM === 'all') {
    console.log(`\n${LINE}`);
    console.log(`  ANÁLISIS 2D: RSI Threshold × Range Min`);
    console.log(`  (combinación más crítica según la lógica de la estrategia)`);
    console.log(DASH);

    const rsiValues   = PARAM_GRIDS.rsi.values;
    const rangeValues = PARAM_GRIDS.range.values;

    // Header
    const rsiHeader = `  ${''.padEnd(12)}` + rsiValues.map(v => `RSI ${v}`.padStart(10)).join('');
    console.log(rsiHeader);
    console.log('  ' + '─'.repeat(rsiHeader.length - 2));

    for (const rangeVal of rangeValues) {
      const row = [`  ${(PARAM_GRIDS.range.fmt(rangeVal)).padEnd(12)}`];
      for (const rsiVal of rsiValues) {
        const params  = { ...DEFAULT_PARAMS, rsiThreshold: rsiVal, rangeMin: rangeVal };
        const trades  = simulate(c15m, rsi15m, htfData, params);
        const metrics = calcMetrics(trades);
        const pf = metrics ? ff(metrics.pf) : '─';
        const isDefault = rsiVal === DEFAULT_PARAMS.rsiThreshold && Math.abs(rangeVal - DEFAULT_PARAMS.rangeMin) < 1e-9;
        row.push((isDefault ? `[${pf}]` : pf).padStart(10));
      }
      console.log(row.join(''));
    }
    console.log(`\n  [ ] = combinación default  |  Valores = Profit Factor`);

    // ── Resumen de robustez de todos los parámetros ───────────────────────────────
    console.log(`\n${LINE}`);
    console.log(`  RESUMEN DE ROBUSTEZ POR PARÁMETRO`);
    console.log(DASH);

    const sumHdr = `  ${'Parámetro'.padEnd(20)} ${'Score'.padStart(7)} ${'Evaluación'.padEnd(30)} ${'PF spread'.padStart(10)}`;
    console.log(sumHdr);
    console.log('  ' + '─'.repeat(sumHdr.length - 2));

    for (const s of summaries) {
      const eval_ = s.score >= 70 ? 'Robusto — puedes variar con confianza'
                  : s.score >= 40 ? 'Moderado — monitorizar si cambia'
                  : 'Frágil — posible overfitting fino';
      console.log(
        `  ${s.label.padEnd(20)} ` +
        `${String(s.score).padStart(7)} ` +
        `${eval_.padEnd(30)} ` +
        `${ff(s.analysis.pfRange).padStart(10)}`
      );
    }

    // Parámetros más críticos
    const sorted = [...summaries].sort((a, b) => a.score - b.score);
    const mostFragile = sorted[0];
    const mostRobust  = sorted[sorted.length - 1];

    console.log(`\n  Parámetro MÁS ROBUSTO:  ${mostRobust.label} (Score ${mostRobust.score}/100)`);
    console.log(`  Parámetro MÁS FRÁGIL:   ${mostFragile.label} (Score ${mostFragile.score}/100)`);

    if (mostFragile.score < 40) {
      console.log(`\n  ⚠️  ADVERTENCIA: '${mostFragile.label}' es altamente sensible.`);
      console.log(`     Cambiar su valor ±1 escalón colapsa el rendimiento.`);
      console.log(`     Esto puede indicar overfitting en ese parámetro específico.`);
    }

    const overallScore = Math.round(summaries.reduce((s, r) => s + r.score, 0) / summaries.length);
    console.log(`\n  Score global de robustez: ${overallScore}/100`);
    const verdict = overallScore >= 65
      ? '  → VEREDICTO: Estrategia ROBUSTA. Los parámetros no están sobreajustados.'
      : overallScore >= 45
      ? '  → VEREDICTO: Robustez MODERADA. Algunos parámetros merecen atención.'
      : '  → VEREDICTO: Estrategia FRÁGIL. Revisar condiciones de entrada para reducir sensibilidad.';
    console.log(verdict);
  }

  console.log(`\n${LINE}\n`);
}

main().catch(err => {
  console.error('\n[validate-sensitivity] Error:', err.message ?? err);
  process.exit(1);
});
