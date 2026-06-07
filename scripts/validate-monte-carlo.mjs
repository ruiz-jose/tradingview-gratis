#!/usr/bin/env node
/**
 * validate-monte-carlo.mjs — Validación estadística y simulación Monte Carlo
 *
 * Técnicas aplicadas:
 *  1. Significancia estadística — ¿el win rate es real o ruido? (test binomial exacto)
 *  2. Monte Carlo shuffle — 10,000 permutaciones aleatorias del P&L
 *     → Distribución del Max Drawdown esperado
 *     → Distribución del retorno final
 *     → Riesgo de ruina (equity cae <50%)
 *  3. Métricas de riesgo ajustadas: Sharpe, Sortino, Calmar por trade
 *  4. Análisis de rachas (consecutivas ganadoras / perdedoras)
 *  5. Expectativa matemática (EV) y R-multiples
 *
 * Uso:
 *   node scripts/validate-monte-carlo.mjs [SYMBOL] [N_15M] [N_SIM]
 *
 * Ejemplos:
 *   node scripts/validate-monte-carlo.mjs BTCUSDT 5000 10000
 *   node scripts/validate-monte-carlo.mjs ETHUSDT 5000 10000
 */

import {
  rsiArr, computeTmSeries, simulate, calcMetrics,
  fetchPaginated, fd, fp, ff,
  WARMUP,
} from './lib-backtest.mjs';

const SYMBOL = process.argv[2] || 'BTCUSDT';
const N_15M  = parseInt(process.argv[3] || '5000', 10);
const N_SIM  = parseInt(process.argv[4] || '10000', 10);
const W      = 78;
const LINE   = '═'.repeat(W);
const DASH   = '─'.repeat(W);

// ── Test binomial exacto (distribución binomial) ──────────────────────────────
// P(X >= wins | n trials, p = 0.5)  — H0: estrategia al azar
function binomialPValue(wins, n) {
  if (n === 0) return 1;
  // CDF binomial acumulada con p=0.5 (test unilugar H1: wr > 0.5)
  let prob = 0;
  const p = 0.5;
  // Calculamos P(X >= wins) = 1 - P(X < wins)
  // Usamos la fórmula recursiva para C(n,k)
  let binom = Math.pow(p, n); // C(n,0) * p^0 * (1-p)^n
  // P(X=0) = (1-p)^n when p=0.5 = p^n
  for (let k = 0; k <= n; k++) {
    if (k >= wins) prob += binom;
    if (k < n) binom *= (n - k) / (k + 1); // C(n,k+1)/C(n,k) = (n-k)/(k+1)
  }
  return Math.min(1, prob);
}

// Intervalo de confianza Wilson para proporciones (95%)
function wilsonCI(wins, n) {
  if (n === 0) return [0, 1];
  const z = 1.96; // 95%
  const p = wins / n;
  const denom = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denom;
  const half = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

// ── Monte Carlo ───────────────────────────────────────────────────────────────
function monteCarlo(pnls, nSim) {
  const n = pnls.length;
  const arr = [...pnls];
  const maxDDs = [];
  const returns = [];
  let ruinCount = 0;

  for (let s = 0; s < nSim; s++) {
    // Fisher-Yates shuffle
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    let equity = 100, peak = 100, maxDD = 0;
    for (const pnl of arr) {
      equity *= (1 + pnl / 100);
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak * 100;
      if (dd > maxDD) maxDD = dd;
    }
    maxDDs.push(maxDD);
    returns.push(equity - 100);
    if (equity < 50) ruinCount++;
  }

  maxDDs.sort((a, b) => a - b);
  returns.sort((a, b) => a - b);

  function pct(arr, p) { return arr[Math.floor(p * arr.length)]; }

  return {
    ruin: ruinCount / nSim,
    dd: {
      p5:  pct(maxDDs, 0.05),
      p25: pct(maxDDs, 0.25),
      med: pct(maxDDs, 0.50),
      p75: pct(maxDDs, 0.75),
      p95: pct(maxDDs, 0.95),
    },
    ret: {
      p5:  pct(returns, 0.05),
      p25: pct(returns, 0.25),
      med: pct(returns, 0.50),
      p75: pct(returns, 0.75),
      p95: pct(returns, 0.95),
    },
  };
}

// ── Análisis de rachas ────────────────────────────────────────────────────────
function streakAnalysis(trades) {
  let maxW = 0, maxL = 0, curW = 0, curL = 0;
  const winStreaks = [], loseStreaks = [];

  for (const t of trades) {
    if (t.win) {
      curW++; curL = 0;
      maxW = Math.max(maxW, curW);
    } else {
      curL++; curW = 0;
      maxL = Math.max(maxL, curL);
    }
  }

  // Simular distribución de rachas con Monte Carlo (1000 simulaciones)
  const pnls = trades.map(t => t.pnl);
  for (let s = 0; s < 1000; s++) {
    const shuf = [...trades];
    for (let i = shuf.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuf[i], shuf[j]] = [shuf[j], shuf[i]];
    }
    let cw = 0, cl = 0;
    for (const t of shuf) {
      if (t.win) { cw++; cl = 0; } else { cl++; cw = 0; }
      if (cw > 0) winStreaks.push(cw);
      if (cl > 0) loseStreaks.push(cl);
    }
  }

  winStreaks.sort((a, b) => a - b);
  loseStreaks.sort((a, b) => a - b);
  const p95WinStreak  = winStreaks[Math.floor(0.95 * winStreaks.length)] || 0;
  const p95LoseStreak = loseStreaks[Math.floor(0.95 * loseStreaks.length)] || 0;

  return { maxW, maxL, p95WinStreak, p95LoseStreak };
}

// ── Análisis de R-multiples ───────────────────────────────────────────────────
function rMultiples(trades) {
  const rs = trades.map(t => {
    const risk = Math.abs((t.entry - t.sl) / t.entry * 100);
    return risk > 0 ? t.pnl / risk : null;
  }).filter(r => r !== null);

  if (!rs.length) return null;

  rs.sort((a, b) => a - b);
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  const variance = rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length;
  const pct = p => rs[Math.floor(p * rs.length)];

  return {
    mean,
    stdDev: Math.sqrt(variance),
    p5:  pct(0.05),
    p25: pct(0.25),
    med: pct(0.50),
    p75: pct(0.75),
    p95: pct(0.95),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'▓'.repeat(W)}`);
  console.log(`  VALIDACIÓN MONTE CARLO — ${SYMBOL} | ${N_15M} velas 15m | ${N_SIM.toLocaleString()} simulaciones`);
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

  if (c15m.length < WARMUP + 10) { console.error('Datos insuficientes.'); process.exit(1); }

  console.log('\nCalculando indicadores...');
  const rsi15m = rsiArr(c15m, 14);
  const tm1h = computeTmSeries(c1h);
  const tm4h = computeTmSeries(c4h);
  const tm1w = computeTmSeries(c1w);
  const tm1M = computeTmSeries(c1M);

  const htfData = [
    { candles: c1h, series: tm1h },
    { candles: c4h, series: tm4h },
    { candles: c1w, series: tm1w },
    { candles: c1M, series: tm1M },
  ];

  console.log('Simulando trades...');
  const trades = simulate(c15m, rsi15m, htfData);

  if (trades.length < 5) {
    console.log('\n⚠️  Menos de 5 trades — validación estadística no es confiable.');
    console.log('   Amplía el período (N_15M mayor) o prueba en un bear market conocido.\n');
    process.exit(0);
  }

  const m = calcMetrics(trades);
  const pnls = trades.map(t => t.pnl);

  // ── 1. Métricas base ─────────────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log(`  BLOQUE 1 — MÉTRICAS BASE`);
  console.log(DASH);
  const base = [
    ['Período',          `${fd(c15m[WARMUP].time)} → ${fd(c15m.at(-1).time)}`],
    ['Trades totales',   `${m.n}  (${m.wins}W / ${m.losses}L)`],
    ['Win rate',         `${ff(m.wrPct)}%`],
    ['Avg ganancia',     fp(m.avgW)],
    ['Avg pérdida',      fp(m.avgL)],
    ['Profit factor',    ff(m.pf)],
    ['Retorno total',    fp(m.totalReturn)],
    ['Max drawdown',     `-${ff(m.maxDD)}%`],
    ['EV / trade',       fp(m.ev)],
    ['Racha pérd. máx.', `${m.maxLoseStreak} trades`],
  ];
  for (const [k, v] of base) console.log(`  ${k.padEnd(22)} ${v}`);

  // ── 2. Significancia estadística ─────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log(`  BLOQUE 2 — SIGNIFICANCIA ESTADÍSTICA`);
  console.log(DASH);
  const pVal = binomialPValue(m.wins, m.n);
  const [lo, hi] = wilsonCI(m.wins, m.n);
  const sig = pVal < 0.05 ? '✓ SIGNIFICATIVO (p < 0.05)' : pVal < 0.10 ? '~ MARGINAL (0.05 ≤ p < 0.10)' : '✗ NO significativo (p ≥ 0.10)';

  // Z-test de proporciones vs 0.5
  const z = (m.wr - 0.5) / Math.sqrt(0.25 / m.n);
  // Sharpe anualizado (asumiendo ~70 trades/año basado en la frecuencia observada)
  // Calculamos la frecuencia real
  const periodDays = (c15m.at(-1).time - c15m[WARMUP].time) / 86400;
  const tradesPerYear = m.n / periodDays * 365;
  const sharpeAnn = m.sharpe * Math.sqrt(tradesPerYear);
  const sortinoAnn = m.sortino * Math.sqrt(tradesPerYear);

  const stat = [
    ['H0: wr = 50% (azar)',      sig],
    ['p-value (binomial)',       ff(pVal, 4)],
    ['Z-score (vs 0.5)',         ff(z, 2)],
    ['IC 95% win rate',          `[${ff(lo * 100)}%, ${ff(hi * 100)}%]  (Wilson)`],
    ['Sharpe anualizado',        ff(sharpeAnn, 3)],
    ['Sortino anualizado',       ff(sortinoAnn, 3)],
    ['Calmar ratio',             ff(m.calmar, 3)],
    ['Trades/año estimados',     ff(tradesPerYear, 1)],
  ];
  for (const [k, v] of stat) console.log(`  ${k.padEnd(28)} ${v}`);

  // Interpretación
  console.log(`\n  Interpretación:`);
  if (pVal < 0.05) {
    console.log(`  → El win rate de ${ff(m.wrPct)}% es estadísticamente distinto del azar (p=${ff(pVal,3)})`);
    console.log(`    con ${m.n} trades. El edge es real con 95% de confianza.`);
  } else if (m.n < 30) {
    console.log(`  → Solo ${m.n} trades: muestra insuficiente. Necesitas ≥30 para significancia.`);
    console.log(`    El edge no puede confirmarse ni descartarse todavía.`);
  } else {
    console.log(`  → Con ${m.n} trades, el win rate NO es estadísticamente superior al azar.`);
    console.log(`    El profit factor debe compensar mediante R:R favorable.`);
  }

  // ── 3. Monte Carlo ───────────────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log(`  BLOQUE 3 — MONTE CARLO (${N_SIM.toLocaleString()} permutaciones)`);
  console.log(DASH);
  process.stdout.write('  Simulando');
  const mc = monteCarlo(pnls, N_SIM);
  console.log(' ✓\n');

  console.log('  MAX DRAWDOWN esperado (distribución de percentiles):\n');
  const ddRows = [
    ['Optimista  (5%)',   `-${ff(mc.dd.p5)}%`],
    ['Favorable (25%)',   `-${ff(mc.dd.p25)}%`],
    ['Mediana   (50%)',   `-${ff(mc.dd.med)}%`],
    ['Adverso   (75%)',   `-${ff(mc.dd.p75)}%`],
    ['Extremo   (95%)',   `-${ff(mc.dd.p95)}%`],
    ['(Real observado)', `-${ff(m.maxDD)}%`],
  ];
  for (const [k, v] of ddRows) console.log(`    ${k.padEnd(22)} ${v}`);

  console.log('\n  RETORNO TOTAL esperado (distribución de percentiles):\n');
  const retRows = [
    ['Pesimista  (5%)',   fp(mc.ret.p5)],
    ['Bajo       (25%)',  fp(mc.ret.p25)],
    ['Mediana    (50%)',  fp(mc.ret.p50 || mc.ret.med)],
    ['Alto       (75%)',  fp(mc.ret.p75)],
    ['Optimista  (95%)',  fp(mc.ret.p95)],
    ['(Real observado)', fp(m.totalReturn)],
  ];
  for (const [k, v] of retRows) console.log(`    ${k.padEnd(22)} ${v}`);

  const ruinPct = (mc.ruin * 100).toFixed(2);
  const ruinLabel = mc.ruin < 0.01 ? '✓ BAJO' : mc.ruin < 0.05 ? '~ MODERADO' : '✗ ALTO';
  console.log(`\n  Riesgo de ruina (equity < 50%):  ${ruinPct}%  ${ruinLabel}`);

  // DD real vs MC
  const betterThanMedian = m.maxDD < mc.dd.med;
  console.log(`\n  Drawdown real vs mediana MC:      ${betterThanMedian ? 'FAVORABLE' : 'DESFAVORABLE'}`);
  console.log(`  → El DD real (${ff(m.maxDD)}%) es ${betterThanMedian ? 'MEJOR' : 'PEOR'} que la mediana esperada (${ff(mc.dd.med)}%).`);

  // ── 4. Análisis de rachas ────────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log(`  BLOQUE 4 — ANÁLISIS DE RACHAS`);
  console.log(DASH);
  const st = streakAnalysis(trades);
  const streak = [
    ['Racha ganadora máx. (real)',  `${st.maxW} trades consecutivos`],
    ['Racha perdedora máx. (real)', `${st.maxL} trades consecutivos`],
    ['Racha perdedora p95 (MC)',    `${st.p95LoseStreak} trades  (¿cuánto capital necesitas aguantar?)`],
  ];
  for (const [k, v] of streak) console.log(`  ${k.padEnd(32)} ${v}`);

  // Capital mínimo recomendado basado en rachas
  const avgLossAmt = Math.abs(m.avgL);
  const capitalMin = st.p95LoseStreak * avgLossAmt;
  console.log(`\n  Con un avg de pérdida de ${fp(m.avgL)}, una racha de ${st.p95LoseStreak}`);
  console.log(`  trades perdedores consecutivos representa una pérdida de ~${ff(capitalMin)}%.`);
  console.log(`  → Recomienda gestión de riesgo por trade ≤ ${ff(Math.min(2, 10 / st.p95LoseStreak), 1)}% del capital.`);

  // ── 5. R-multiples ───────────────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log(`  BLOQUE 5 — DISTRIBUCIÓN DE R-MÚLTIPLES`);
  console.log(DASH);
  const rm = rMultiples(trades);
  if (rm) {
    const rmRows = [
      ['R medio (expectativa)',  ff(rm.mean, 3)],
      ['Desviación estándar R',  ff(rm.stdDev, 3)],
      ['P5  (peor caso)',        ff(rm.p5, 2)],
      ['P25',                    ff(rm.p25, 2)],
      ['Mediana',                ff(rm.med, 2)],
      ['P75',                    ff(rm.p75, 2)],
      ['P95 (mejor caso)',       ff(rm.p95, 2)],
    ];
    for (const [k, v] of rmRows) console.log(`  ${k.padEnd(26)} ${v}R`);
    console.log(`\n  Un R medio positivo (${ff(rm.mean,2)}R) confirma que la estrategia`);
    console.log(`  genera valor esperado positivo POR UNIDAD DE RIESGO.`);
    if (rm.mean > 0) {
      console.log(`  → EDGE CONFIRMADO por R-múltiples.`);
    } else {
      console.log(`  → ADVERTENCIA: R medio negativo → el edge es negativo por riesgo asumido.`);
    }
  } else {
    console.log('  No se pudieron calcular R-múltiples (faltan datos de SL).');
  }

  // ── Veredicto final ─────────────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log(`  VEREDICTO MONTE CARLO`);
  console.log(DASH);

  const verdicts = [];
  if (pVal < 0.05)      verdicts.push('✓ Win rate estadísticamente significativo');
  else if (m.pf > 1.5)  verdicts.push('~ Win rate no significativo pero PF compensa');
  else                  verdicts.push('✗ Win rate y PF no justifican el edge');

  if (mc.ruin < 0.02)   verdicts.push('✓ Riesgo de ruina muy bajo (<2%)');
  else if (mc.ruin < 0.05) verdicts.push('~ Riesgo de ruina aceptable (2-5%)');
  else                  verdicts.push('✗ Riesgo de ruina alto (>5%) — reducir tamaño');

  if (sharpeAnn > 1.0)  verdicts.push('✓ Sharpe anualizado > 1.0 (excelente)');
  else if (sharpeAnn > 0.5) verdicts.push('~ Sharpe anualizado 0.5–1.0 (aceptable)');
  else                  verdicts.push('✗ Sharpe anualizado < 0.5 (bajo)');

  if (m.calmar > 2)     verdicts.push('✓ Calmar ratio > 2 (buen rendimiento/riesgo)');
  else if (m.calmar > 1) verdicts.push('~ Calmar ratio 1–2 (aceptable)');
  else                  verdicts.push('✗ Calmar ratio < 1 (retorno no compensa el DD)');

  for (const v of verdicts) console.log(`  ${v}`);
  console.log(`\n${LINE}\n`);
}

main().catch(err => {
  console.error('\n[validate-monte-carlo] Error:', err.message ?? err);
  process.exit(1);
});
