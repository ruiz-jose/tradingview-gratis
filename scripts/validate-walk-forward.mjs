#!/usr/bin/env node
/**
 * validate-walk-forward.mjs — Análisis Walk-Forward (WFA)
 *
 * Técnica profesional para detectar overfitting:
 *  - Divide los datos en K ventanas iguales (default K=5)
 *  - Evalúa el rendimiento en CADA ventana por separado
 *  - Si el edge es real, cada ventana debería mostrar resultados positivos
 *  - Métricas de consistencia: % de ventanas rentables, rango de PF, volatilidad del WR
 *
 * El WFA no optimiza parámetros (eso sería overfitting). En cambio verifica
 * que la estrategia funciona en sub-períodos distintos del conjunto de datos.
 *
 * Uso:
 *   node scripts/validate-walk-forward.mjs [SYMBOL] [N_15M] [K_FOLDS]
 *
 * Ejemplos:
 *   node scripts/validate-walk-forward.mjs BTCUSDT 8000 5
 *   node scripts/validate-walk-forward.mjs BTCUSDT 12000 6
 */

import {
  rsiArr, computeTmSeries, simulate, calcMetrics,
  fetchPaginated, fd, fp, ff,
  WARMUP,
} from './lib-backtest.mjs';

const SYMBOL  = process.argv[2] || 'BTCUSDT';
const N_15M   = parseInt(process.argv[3] || '8000', 10);
const K_FOLDS = parseInt(process.argv[4] || '5',    10);
const W       = 78;
const LINE    = '═'.repeat(W);
const DASH    = '─'.repeat(W);

// ── Utilidades ────────────────────────────────────────────────────────────────

function sliceHtf(htfData, startTime, endTime) {
  return htfData.map(d => ({
    candles: d.candles.filter(c => c.time >= startTime && c.time <= endTime),
    series:  d.series.filter((_, i) =>
      d.candles[i] && d.candles[i].time >= startTime && d.candles[i].time <= endTime
    ),
  }));
}

function buildHtfPtrs(htfRaw) {
  return htfRaw.map(d => ({ candles: d.candles, series: d.series }));
}

// ── Simulación sobre un sub-período ──────────────────────────────────────────
// Usa todo el histórico de indicadores pero solo ejecuta trades en la ventana
function simulateFold(c15m, rsi15m, htfData, foldStart, foldEnd, warmupCandles) {
  // Incluir warmupCandles ANTES del fold para inicializar correctamente los indicadores
  const startIdx = Math.max(WARMUP, foldStart - warmupCandles);
  const slice15m = c15m.slice(startIdx, foldEnd + 1);
  const sliceRsi = rsi15m.slice(startIdx, foldEnd + 1);

  // HTF: igual que en el backtest completo (punteros sincronizados por tiempo)
  const trades = simulate(slice15m, sliceRsi, htfData);

  // Filtrar solo los trades que EMPEZARON dentro del fold real
  const foldStartTime = c15m[foldStart].time;
  const foldEndTime   = c15m[foldEnd].time;
  return trades.filter(t => t.entryTime >= foldStartTime && t.entryTime <= foldEndTime);
}

// ── Comparar rendimiento entre ventanas ──────────────────────────────────────
function consistencyScore(foldMetrics) {
  const profitable = foldMetrics.filter(m => m && m.totalReturn > 0).length;
  const pfValues   = foldMetrics.filter(m => m && isFinite(m.pf)).map(m => m.pf);
  const wrValues   = foldMetrics.filter(m => m).map(m => m.wrPct);

  const pfMean = pfValues.reduce((a, b) => a + b, 0) / (pfValues.length || 1);
  const pfMin  = pfValues.length ? Math.min(...pfValues) : 0;
  const pfMax  = pfValues.length ? Math.max(...pfValues) : 0;

  const wrMean = wrValues.reduce((a, b) => a + b, 0) / (wrValues.length || 1);
  const wrMin  = wrValues.length ? Math.min(...wrValues) : 0;
  const wrMax  = wrValues.length ? Math.max(...wrValues) : 0;

  const variance = wrValues.reduce((a, b) => a + (b - wrMean) ** 2, 0) / (wrValues.length || 1);
  const wrStd    = Math.sqrt(variance);

  return { profitable, total: foldMetrics.length, pfMean, pfMin, pfMax, wrMean, wrMin, wrMax, wrStd };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'▓'.repeat(W)}`);
  console.log(`  ANÁLISIS WALK-FORWARD — ${SYMBOL} | ${N_15M} velas 15m | ${K_FOLDS} folds`);
  console.log(`${'▓'.repeat(W)}\n`);

  // ── Descarga de datos ───────────────────────────────────────────────────────
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

  if (c15m.length < WARMUP + K_FOLDS * 100) {
    console.error(`Datos insuficientes para ${K_FOLDS} folds. Reduce K o aumenta N_15M.`);
    process.exit(1);
  }

  console.log('\nCalculando indicadores...');
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

  // ── Backtest completo (baseline) ─────────────────────────────────────────────
  console.log('Calculando baseline (backtest completo)...');
  const allTrades = simulate(c15m, rsi15m, htfData);
  const baseMetrics = calcMetrics(allTrades);

  if (!baseMetrics || baseMetrics.n < 5) {
    console.log('\n⚠️  Menos de 5 trades totales — WFA no es confiable.');
    process.exit(0);
  }

  // ── División en K folds ─────────────────────────────────────────────────────
  const usable  = c15m.length - WARMUP;
  const foldLen = Math.floor(usable / K_FOLDS);
  const warmup  = Math.min(WARMUP * 3, 200); // velas de calentamiento por fold

  console.log(`\nDividiendo en ${K_FOLDS} folds de ~${foldLen} velas (${(foldLen * 15 / 60 / 24).toFixed(1)} días cada uno)...`);

  const foldResults = [];
  for (let k = 0; k < K_FOLDS; k++) {
    const foldStart = WARMUP + k * foldLen;
    const foldEnd   = k < K_FOLDS - 1 ? foldStart + foldLen - 1 : c15m.length - 2;

    process.stdout.write(`  Fold ${k + 1}/${K_FOLDS} (${fd(c15m[foldStart].time)} → ${fd(c15m[foldEnd].time)})... `);

    const foldTrades = simulateFold(c15m, rsi15m, htfData, foldStart, foldEnd, warmup);
    const fm = calcMetrics(foldTrades);
    foldResults.push({ k: k + 1, start: c15m[foldStart].time, end: c15m[foldEnd].time, trades: foldTrades, metrics: fm });

    if (fm) {
      console.log(`${fm.n} trades | WR: ${ff(fm.wrPct)}% | PF: ${ff(fm.pf)} | Ret: ${fp(fm.totalReturn)}`);
    } else {
      console.log('0 trades');
    }
  }

  // ── Reporte ─────────────────────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log(`  BASELINE (backtest completo)`);
  console.log(DASH);
  const baseRows = [
    ['Trades',        `${baseMetrics.n}  (${baseMetrics.wins}W / ${baseMetrics.losses}L)`],
    ['Win rate',      `${ff(baseMetrics.wrPct)}%`],
    ['Profit factor', ff(baseMetrics.pf)],
    ['Retorno total', fp(baseMetrics.totalReturn)],
    ['Max drawdown',  `-${ff(baseMetrics.maxDD)}%`],
    ['Sharpe',        ff(baseMetrics.sharpe, 3)],
  ];
  for (const [k, v] of baseRows) console.log(`  ${k.padEnd(20)} ${v}`);

  console.log(`\n${LINE}`);
  console.log(`  RESULTADOS POR FOLD`);
  console.log(DASH);

  const hdr = `  ${'Fold'.padEnd(6)} ${'Período'.padEnd(26)} ${'Trades'.padStart(6)} ${'WR%'.padStart(6)} ${'PF'.padStart(6)} ${'Ret%'.padStart(8)} ${'Max DD'.padStart(8)}`;
  console.log(hdr);
  console.log('  ' + '─'.repeat(hdr.length - 2));

  const foldMetrics = foldResults.map(fr => fr.metrics);
  for (const fr of foldResults) {
    const m = fr.metrics;
    const period = `${fd(fr.start)} → ${fd(fr.end)}`;
    if (m) {
      const sign = m.totalReturn >= 0 ? '+' : '';
      console.log(
        `  ${String(fr.k).padEnd(6)} ` +
        `${period.padEnd(26)} ` +
        `${String(m.n).padStart(6)} ` +
        `${ff(m.wrPct).padStart(6)} ` +
        `${ff(m.pf).padStart(6)} ` +
        `${(sign + ff(m.totalReturn)).padStart(8)} ` +
        `${('-'+ff(m.maxDD)).padStart(8)}`
      );
    } else {
      console.log(`  ${String(fr.k).padEnd(6)} ${period.padEnd(26)} ${'0'.padStart(6)} ${'─'.padStart(6)} ${'─'.padStart(6)} ${'─'.padStart(8)} ${'─'.padStart(8)}`);
    }
  }

  // ── Análisis de consistencia ─────────────────────────────────────────────────
  const cs = consistencyScore(foldMetrics);

  console.log(`\n${LINE}`);
  console.log(`  CONSISTENCIA DE LA ESTRATEGIA`);
  console.log(DASH);

  const pctProfitable = (cs.profitable / cs.total * 100).toFixed(0);
  const csRows = [
    ['Folds rentables',      `${cs.profitable} / ${cs.total}  (${pctProfitable}%)`],
    ['PF rango',             `${ff(cs.pfMin)} – ${ff(cs.pfMax)}  (media: ${ff(cs.pfMean)})`],
    ['WR rango',             `${ff(cs.wrMin)}% – ${ff(cs.wrMax)}%  (media: ${ff(cs.wrMean)}%)`],
    ['WR desv. estándar',    `${ff(cs.wrStd)}%  (menor = más consistente)`],
  ];
  for (const [k, v] of csRows) console.log(`  ${k.padEnd(28)} ${v}`);

  // ── Detección de overfitting ─────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log(`  DIAGNÓSTICO DE OVERFITTING`);
  console.log(DASH);

  const overfit = [];
  const healthy = [];

  if (cs.profitable / cs.total >= 0.8)
    healthy.push(`✓ ${cs.profitable}/${cs.total} folds rentables (≥80%): estrategia consistente`);
  else if (cs.profitable / cs.total >= 0.6)
    overfit.push(`~ ${cs.profitable}/${cs.total} folds rentables (60-79%): consistencia moderada`);
  else
    overfit.push(`✗ Solo ${cs.profitable}/${cs.total} folds rentables (<60%): posible overfitting`);

  if (cs.wrStd < 10)
    healthy.push(`✓ Baja dispersión del WR (${ff(cs.wrStd)}% σ): edge estable entre períodos`);
  else if (cs.wrStd < 20)
    overfit.push(`~ Dispersión moderada del WR (${ff(cs.wrStd)}% σ): algo variable`);
  else
    overfit.push(`✗ Alta dispersión del WR (${ff(cs.wrStd)}% σ): comportamiento inconsistente`);

  if (cs.pfMin > 1.0)
    healthy.push(`✓ PF mínimo > 1.0 en todos los folds: siempre rentable`);
  else if (cs.pfMin > 0.8)
    overfit.push(`~ PF mínimo ${ff(cs.pfMin)}: algún fold negativo`);
  else
    overfit.push(`✗ PF mínimo ${ff(cs.pfMin)}: folds muy negativos → overfitting probable`);

  // Degradación IS→OOS: compara primer vs último fold
  const firstFold = foldMetrics[0];
  const lastFold  = foldMetrics[foldMetrics.length - 1];
  if (firstFold && lastFold) {
    const pfDeg = (lastFold.pf - firstFold.pf) / Math.abs(firstFold.pf) * 100;
    if (Math.abs(pfDeg) < 30)
      healthy.push(`✓ Degradación temporal del PF (${pfDeg > 0 ? '+' : ''}${ff(pfDeg)}%): sin decaimiento significativo`);
    else if (pfDeg < -30)
      overfit.push(`✗ PF degradó un ${ff(pfDeg)}% del primer al último fold: posible decaimiento`);
    else
      overfit.push(`~ PF varió un ${ff(pfDeg)}%: monitorizar en tiempo real`);
  }

  for (const h of healthy) console.log(`  ${h}`);
  for (const o of overfit) console.log(`  ${o}`);

  // Veredicto
  const verdict = healthy.length > overfit.length
    ? '  → VEREDICTO: La estrategia muestra CONSISTENCIA entre períodos. Overfitting bajo.'
    : healthy.length === overfit.length
    ? '  → VEREDICTO: Resultados MIXTOS. Ampliar el período de prueba para confirmar.'
    : '  → VEREDICTO: Señales de OVERFITTING. Simplificar condiciones o ampliar muestra.';
  console.log(`\n${verdict}`);
  console.log(`\n${LINE}\n`);
}

main().catch(err => {
  console.error('\n[validate-walk-forward] Error:', err.message ?? err);
  process.exit(1);
});
