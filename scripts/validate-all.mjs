#!/usr/bin/env node
/**
 * validate-all.mjs — Suite completa de validación profesional
 *
 * Ejecuta los 4 módulos de validación en secuencia:
 *   1. Backtest base           — baseline de métricas
 *   2. Monte Carlo             — significancia estadística + riesgo de ruina
 *   3. Walk-Forward Analysis   — detección de overfitting temporal
 *   4. Multi-símbolo           — generalización cross-asset
 *   5. Sensibilidad            — robustez de parámetros
 *
 * Al final genera un scorecard consolidado con veredicto de 5 dimensiones.
 *
 * Uso:
 *   node scripts/validate-all.mjs [SYMBOL] [N_15M]
 *
 * Ejemplos:
 *   node scripts/validate-all.mjs BTCUSDT 5000
 *   node scripts/validate-all.mjs ETHUSDT 3000
 *
 * Tiempo estimado: 5–15 min dependiendo del N_15M y la conexión.
 */

import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath }       from 'node:url';
import { dirname, join }       from 'node:path';
import {
  rsiArr, computeTmSeries, simulate, calcMetrics,
  fetchPaginated, fp, ff, fd,
  WARMUP,
} from './lib-backtest.mjs';

const SYMBOL = process.argv[2] || 'BTCUSDT';
const N_15M  = parseInt(process.argv[3] || '5000', 10);
const W      = 78;
const LINE   = '═'.repeat(W);
const DASH   = '─'.repeat(W);
const __dir  = dirname(fileURLToPath(import.meta.url));

function banner(title) {
  console.log(`\n${'█'.repeat(W)}`);
  const pad = Math.floor((W - title.length - 2) / 2);
  console.log(`${'█'.repeat(pad)} ${title} ${'█'.repeat(W - pad - title.length - 2)}`);
  console.log(`${'█'.repeat(W)}\n`);
}

function runScript(scriptName, args = []) {
  const scriptPath = join(__dir, scriptName);
  console.log(`\n► Ejecutando: node ${scriptName} ${args.join(' ')}\n`);
  const result = spawnSync('node', [scriptPath, ...args], {
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    console.error(`\n⚠️  ${scriptName} terminó con código ${result.status}`);
  }
  return result.status === 0;
}

async function runBaselineAndScore() {
  // ── Descarga de datos para el scorecard ──────────────────────────────────────
  console.log('Descargando datos para el scorecard final...');
  const n1h = Math.min(1500, Math.ceil(N_15M / 4)  + 100);
  const n4h = Math.min(1000, Math.ceil(N_15M / 16) + 100);

  const [c15m, c1h, c4h, c1w, c1M] = await Promise.all([
    fetchPaginated(SYMBOL, '15m', N_15M),
    fetchPaginated(SYMBOL, '1h',  n1h),
    fetchPaginated(SYMBOL, '4h',  n4h),
    fetchPaginated(SYMBOL, '1w',  200),
    fetchPaginated(SYMBOL, '1M',  60),
  ]);

  const rsi15m = rsiArr(c15m, 14);
  const htfData = [
    { candles: c1h, series: computeTmSeries(c1h) },
    { candles: c4h, series: computeTmSeries(c4h) },
    { candles: c1w, series: computeTmSeries(c1w) },
    { candles: c1M, series: computeTmSeries(c1M) },
  ];

  const trades  = simulate(c15m, rsi15m, htfData);
  const metrics = calcMetrics(trades);
  return { metrics, trades, c15m };
}

function scoreDimension(label, value, thresholds, labels) {
  // thresholds = [excellent, good, poor]
  // labels     = [excellent label, good label, poor label, fail label]
  let score, verdict;
  if      (value >= thresholds[0]) { score = 3; verdict = labels[0]; }
  else if (value >= thresholds[1]) { score = 2; verdict = labels[1]; }
  else if (value >= thresholds[2]) { score = 1; verdict = labels[2]; }
  else                             { score = 0; verdict = labels[3]; }
  const stars = '★'.repeat(score) + '☆'.repeat(3 - score);
  return { label, value, score, stars, verdict };
}

async function main() {
  const startTime = Date.now();

  banner('SUITE DE VALIDACIÓN PROFESIONAL — MTF SHORT STRATEGY');
  console.log(`  Símbolo : ${SYMBOL}`);
  console.log(`  Período : ~${N_15M} velas 15m (${(N_15M * 15 / 60 / 24).toFixed(0)} días)`);
  console.log(`  Fecha   : ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC\n`);

  // ── MÓDULO 1: Backtest base ──────────────────────────────────────────────────
  banner('MÓDULO 1 / 5 — BACKTEST BASE');
  runScript('backtest-mtf-short.mjs', [SYMBOL, String(N_15M)]);

  // ── MÓDULO 2: Monte Carlo ────────────────────────────────────────────────────
  banner('MÓDULO 2 / 5 — MONTE CARLO + SIGNIFICANCIA ESTADÍSTICA');
  runScript('validate-monte-carlo.mjs', [SYMBOL, String(N_15M), '10000']);

  // ── MÓDULO 3: Walk-Forward ───────────────────────────────────────────────────
  banner('MÓDULO 3 / 5 — WALK-FORWARD ANALYSIS');
  runScript('validate-walk-forward.mjs', [SYMBOL, String(N_15M), '5']);

  // ── MÓDULO 4: Multi-símbolo ──────────────────────────────────────────────────
  banner('MÓDULO 4 / 5 — VALIDACIÓN MULTI-SÍMBOLO');
  runScript('validate-multi-symbol.mjs', [String(Math.min(N_15M, 3000))]);

  // ── MÓDULO 5: Sensibilidad ───────────────────────────────────────────────────
  banner('MÓDULO 5 / 5 — SENSIBILIDAD DE PARÁMETROS');
  runScript('validate-sensitivity.mjs', [SYMBOL, String(N_15M), 'all']);

  // ── SCORECARD FINAL ──────────────────────────────────────────────────────────
  banner('SCORECARD FINAL — VEREDICTO CONSOLIDADO');

  console.log('Calculando scorecard...');
  const { metrics: m, trades } = await runBaselineAndScore();

  if (!m || m.n < 5) {
    console.log('\n⚠️  Muestra insuficiente para el scorecard (<5 trades).');
    console.log('   Amplía el período o prueba en un bear market conocido.\n');
    return;
  }

  // Calcular estadísticas adicionales
  // Binomial significance
  let cumProb = 0;
  let binom = Math.pow(0.5, m.n);
  for (let k = 0; k <= m.n; k++) {
    if (k >= m.wins) cumProb += binom;
    if (k < m.n) binom *= (m.n - k) / (k + 1);
  }
  const pValue = Math.min(1, cumProb);

  // Sharpe anualizado
  const TRADES_PER_YEAR = 52; // estimación conservadora
  const sharpeAnn = m.sharpe * Math.sqrt(TRADES_PER_YEAR);

  // Dimensiones de evaluación
  const dims = [
    scoreDimension(
      'Rentabilidad (PF)',
      m.pf,
      [2.0, 1.5, 1.0],
      ['✓ Excelente (PF ≥ 2.0)', '✓ Bueno (PF 1.5–2.0)', '~ Ajustado (PF 1.0–1.5)', '✗ Negativo (PF < 1.0)']
    ),
    scoreDimension(
      'Calidad del Edge (EV/trade)',
      m.ev,
      [0.5, 0.2, 0.0],
      ['✓ Sólido (EV > 0.5%)', '✓ Positivo (EV 0.2–0.5%)', '~ Marginal (EV 0–0.2%)', '✗ Negativo (EV < 0%)']
    ),
    scoreDimension(
      'Control del Riesgo (Calmar)',
      m.calmar,
      [2.0, 1.0, 0.5],
      ['✓ Excelente (Calmar ≥ 2)', '✓ Bueno (Calmar 1–2)', '~ Bajo (Calmar 0.5–1)', '✗ Pobre (Calmar < 0.5)']
    ),
    scoreDimension(
      'Sharpe Anualizado',
      sharpeAnn,
      [1.0, 0.5, 0.2],
      ['✓ Excelente (≥ 1.0)', '✓ Aceptable (0.5–1.0)', '~ Bajo (0.2–0.5)', '✗ Inaceptable (< 0.2)']
    ),
    scoreDimension(
      'Significancia Estadística',
      1 - pValue,
      [0.95, 0.90, 0.80],
      ['✓ Muy significativo (p < 0.05)', '✓ Significativo (p < 0.10)', '~ Marginal (p < 0.20)', '✗ No significativo']
    ),
  ];

  // Tabla del scorecard
  console.log(`\n${LINE}`);
  console.log(`  EVALUACIÓN EN 5 DIMENSIONES — ${SYMBOL}`);
  console.log(DASH);

  const hdr = `  ${'Dimensión'.padEnd(34)} ${'Score'.padStart(6)} ${'Estrellas'.padEnd(10)} Veredicto`;
  console.log(hdr);
  console.log('  ' + '─'.repeat(hdr.length - 2));

  let totalScore = 0;
  for (const d of dims) {
    totalScore += d.score;
    console.log(
      `  ${d.label.padEnd(34)} ` +
      `${String(d.score * 33 + '%').padStart(6)} ` +
      `${d.stars.padEnd(10)} ` +
      `${d.verdict}`
    );
  }

  // Score total
  const maxScore = dims.length * 3;
  const pctTotal = Math.round(totalScore / maxScore * 100);
  console.log(`\n${DASH}`);
  console.log(`  ${'SCORE TOTAL'.padEnd(34)} ${String(pctTotal + '%').padStart(6)}  (${totalScore}/${maxScore} puntos)`);

  // Métricas clave
  console.log(`\n${LINE}`);
  console.log(`  MÉTRICAS CLAVE`);
  console.log(DASH);
  const kpi = [
    ['Trades totales',     `${m.n}  (${m.wins}W / ${m.losses}L)`],
    ['Win Rate',           `${ff(m.wrPct)}%`],
    ['Profit Factor',      ff(m.pf)],
    ['EV por trade',       fp(m.ev)],
    ['Retorno total',      fp(m.totalReturn)],
    ['Max Drawdown',       `-${ff(m.maxDD)}%`],
    ['Sharpe anualizado',  ff(sharpeAnn, 3)],
    ['Calmar ratio',       ff(m.calmar, 3)],
    ['p-value',            ff(pValue, 4)],
    ['Racha pérd. máx.',   `${m.maxLoseStreak} trades`],
  ];
  for (const [k, v] of kpi) console.log(`  ${k.padEnd(24)} ${v}`);

  // Veredicto final
  console.log(`\n${LINE}`);
  console.log(`  VEREDICTO FINAL`);
  console.log(DASH);

  let verdict, emoji, recommendation;
  if (pctTotal >= 80) {
    verdict = '🏆 ESTRATEGIA SÓLIDA — APTA PARA CAPITAL REAL';
    recommendation = [
      '  El edge está estadísticamente confirmado y es robusto.',
      '  Recomendaciones:',
      '  • Definir tamaño de posición con riesgo fijo por trade (1–2% del capital)',
      '  • Monitorizar mensualmente los KPIs para detectar degradación',
      '  • Revisar cada 3 meses si el PF sigue > 1.3 en tiempo real',
    ];
  } else if (pctTotal >= 55) {
    verdict = '⚠️  ESTRATEGIA PROMETEDORA — REQUIERE VALIDACIÓN ADICIONAL';
    recommendation = [
      '  La estrategia muestra edge positivo pero con área de mejora.',
      '  Recomendaciones:',
      '  • Ampliar el período de backtesting (≥3 meses de datos)',
      '  • Probar en más símbolos para confirmar generalización',
      '  • Paper trading 30 días antes de capital real',
      `  • Área más débil: ${dims.sort((a,b) => a.score-b.score)[0].label}`,
    ];
  } else {
    verdict = '🚫 ESTRATEGIA INSUFICIENTE — NO APTA PARA CAPITAL REAL';
    recommendation = [
      '  El análisis no confirma un edge estadístico robusto.',
      '  Recomendaciones:',
      '  • Revisar las condiciones de entrada (demasiado restrictivas o frágiles)',
      '  • Ampliar muestra con datos de bear market 2022 (N_15M=15000)',
      '  • Simplificar condiciones para aumentar frecuencia de trades',
      `  • Punto crítico: ${dims.sort((a,b) => a.score-b.score)[0].label}`,
    ];
  }

  console.log(`\n  ${verdict}`);
  console.log();
  for (const r of recommendation) console.log(r);

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n${LINE}`);
  console.log(`  Validación completa en ${elapsed} minutos.`);
  console.log(`  Fecha: ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`);
  console.log(`${LINE}\n`);
}

main().catch(err => {
  console.error('\n[validate-all] Error:', err.message ?? err);
  process.exit(1);
});
