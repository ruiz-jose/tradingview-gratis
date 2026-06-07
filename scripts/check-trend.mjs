#!/usr/bin/env node
/**
 * check-trend.mjs
 * Multi-timeframe trend checker: entry signal (15m) confirmed by context (1h).
 * Sends a Telegram alert only when both timeframes agree AND score ≥ MIN_SCORE.
 *
 * Env vars:
 *   BINANCE_SYMBOL          (default: BTCUSDT)
 *   ENTRY_TIMEFRAME         (default: 15m)  — timeframe que genera la señal
 *   CONTEXT_TIMEFRAME       (default: 1h)   — timeframe de confirmación
 *   MIN_SCORE               (default: 4)    — mínimo de señales alineadas (4-6)
 *   COOLDOWN_MINUTES        (default: 60)   — minutos mínimos entre alertas
 *   TELEGRAM_BOT_TOKEN      required for alerts
 *   TELEGRAM_CHAT_ID        required for alerts
 *   STATE_FILE              (default: .trend-state.json)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

try { process.loadEnvFile('.env'); } catch { /* ok en CI */ }

const SYMBOL           = process.env.BINANCE_SYMBOL    || 'BTCUSDT';
// BINANCE_TIMEFRAME se mantiene como alias para compatibilidad
const ENTRY_TF         = process.env.ENTRY_TIMEFRAME   || process.env.BINANCE_TIMEFRAME || '15m';
const CONTEXT_TF       = process.env.CONTEXT_TIMEFRAME || '1h';
const MIN_SCORE        = parseInt(process.env.MIN_SCORE        || '4', 10);
const COOLDOWN_MINUTES = parseInt(process.env.COOLDOWN_MINUTES || '60', 10);
const TOKEN            = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID          = process.env.TELEGRAM_CHAT_ID;
const STATE_FILE       = process.env.STATE_FILE || '.trend-state.json';

// ── Indicators (exact port from src/lib/indicators/index.ts) ─────────────────

function emaIndicator(candles, period) {
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += candles[i].close;
  prev /= period;
  const out = [{ time: candles[period - 1].time, value: prev }];
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k);
    out.push({ time: candles[i].time, value: prev });
  }
  return out;
}

function atrIndicator(candles, period = 14) {
  if (candles.length <= period) return [];
  const tr = [];
  for (let i = 1; i < candles.length; i++) {
    tr.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low  - candles[i - 1].close),
    ));
  }
  let val = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [{ time: candles[period].time, value: val }];
  for (let i = period; i < tr.length; i++) {
    val = (val * (period - 1) + tr[i]) / period;
    out.push({ time: candles[i + 1].time, value: val });
  }
  return out;
}

function supertrendIndicator(candles, atrPeriod = 10, factor = 3.0) {
  const atrVals = atrIndicator(candles, atrPeriod);
  if (atrVals.length === 0) return [];
  let prevUpper = 0, prevLower = 0, prevDir = 1;
  const out = [];
  for (let i = 0; i < atrVals.length; i++) {
    const ci = atrPeriod + i;
    const hl2 = (candles[ci].high + candles[ci].low) / 2;
    const a = atrVals[i].value;
    let upper = hl2 + factor * a;
    let lower = hl2 - factor * a;
    if (i > 0) {
      lower = lower > prevLower || candles[ci - 1].close < prevLower ? lower : prevLower;
      upper = upper < prevUpper || candles[ci - 1].close > prevUpper ? upper : prevUpper;
    }
    let dir;
    if (i === 0) {
      dir = 1;
    } else if (prevDir === 1) {
      dir = candles[ci].close < lower ? -1 : 1;
    } else {
      dir = candles[ci].close > upper ? 1 : -1;
    }
    out.push({ time: candles[ci].time, value: dir === 1 ? lower : upper, direction: dir });
    prevUpper = upper;
    prevLower = lower;
    prevDir = dir;
  }
  return out;
}

function macdIndicator(candles, fast = 12, slow = 26, signal = 9) {
  if (candles.length < slow + signal) return [];
  const emaFast = emaIndicator(candles, fast);
  const emaSlow = emaIndicator(candles, slow);
  const fastByTime = new Map(emaFast.map(p => [p.time, p.value]));
  const macdLine = [];
  for (const p of emaSlow) {
    const f = fastByTime.get(p.time);
    if (f !== undefined) macdLine.push({ time: p.time, value: f - p.value });
  }
  const synthCandles = macdLine.map(p => ({
    time: p.time, open: p.value, high: p.value, low: p.value, close: p.value, volume: 0,
  }));
  const sig = emaIndicator(synthCandles, signal);
  const sigByTime = new Map(sig.map(p => [p.time, p.value]));
  const out = [];
  for (const p of macdLine) {
    const s = sigByTime.get(p.time);
    if (s === undefined) continue;
    out.push({ time: p.time, macd: p.value, signal: s, histogram: p.value - s });
  }
  return out;
}

function rsiIndicator(candles, period = 14) {
  if (candles.length <= period) return [];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  gain /= period;
  loss /= period;
  let rs = loss === 0 ? 100 : gain / loss;
  const out = [{ time: candles[period].time, value: 100 - 100 / (1 + rs) }];
  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    rs = loss === 0 ? 100 : gain / loss;
    out.push({ time: candles[i].time, value: 100 - 100 / (1 + rs) });
  }
  return out;
}

function trendMeter(candles) {
  if (candles.length < 50) return null;
  const close    = candles[candles.length - 1].close;
  const ema20Val = emaIndicator(candles, 20).at(-1)?.value;
  const ema50Val = emaIndicator(candles, 50).at(-1)?.value;
  const ema9Val  = emaIndicator(candles, 9).at(-1)?.value;
  const ema21Val = emaIndicator(candles, 21).at(-1)?.value;
  if (!ema20Val || !ema50Val || !ema9Val || !ema21Val) return null;
  const lastST   = supertrendIndicator(candles, 10, 3).at(-1);
  const lastMACD = macdIndicator(candles, 12, 26, 9).at(-1);
  const lastRSI  = rsiIndicator(candles, 14).at(-1)?.value;
  if (!lastST || !lastMACD || lastRSI === undefined) return null;
  const signals = {
    vsEma20:      close > ema20Val ? 1 : -1,
    vsEma50:      close > ema50Val ? 1 : -1,
    emaFastCross: ema9Val > ema21Val ? 1 : -1,
    supertrend:   lastST.direction,
    macdHist:     lastMACD.histogram >= 0 ? 1 : -1,
    rsiLevel:     lastRSI > 50 ? 1 : -1,
  };
  const score = signals.vsEma20 + signals.vsEma50 + signals.emaFastCross + signals.supertrend + signals.macdHist + signals.rsiLevel;
  const direction = score >= 4 ? 'bull' : score <= -4 ? 'bear' : 'neutral';
  return { score, direction, signals, rsiValue: lastRSI };
}

// ── Market data providers ─────────────────────────────────────────────────────

async function withRetry(fn, retries = 2, baseDelay = 1500) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (err) {
      lastError = err;
      if (i < retries - 1) await new Promise(r => setTimeout(r, baseDelay * (i + 1)));
    }
  }
  throw lastError;
}

async function fetchCandlesFromBinance(symbol, interval, limit) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.map(k => ({
    time:   Math.floor(k[0] / 1000),
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

const BYBIT_INTERVAL = {
  '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30,
  '1h': 60, '2h': 120, '4h': 240, '6h': 360, '12h': 720,
  '1d': 'D', '1w': 'W', '1M': 'M',
};

async function fetchCandlesFromBybit(symbol, interval, limit) {
  const bybitInterval = BYBIT_INTERVAL[interval] ?? interval;
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${bybitInterval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit error: ${res.status}`);
  const json = await res.json();
  if (json.retCode !== 0) throw new Error(`Bybit error: ${json.retMsg}`);
  return json.result.list.reverse().map(k => ({
    time:   Math.floor(Number(k[0]) / 1000),
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

const OKX_BAR = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1H', '2h': '2H', '4h': '4H', '6h': '6H', '12h': '12H',
  '1d': '1D', '1w': '1W', '1M': '1M',
};

async function fetchCandlesFromOkx(symbol, interval, limit) {
  const instId = symbol.replace(/^([A-Z0-9]+?)(USDT|USDC|BTC|ETH)$/, '$1-$2');
  const bar = OKX_BAR[interval] ?? interval;
  const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OKX error: ${res.status}`);
  const json = await res.json();
  if (json.code !== '0') throw new Error(`OKX error: ${json.msg}`);
  return json.data.reverse().map(k => ({
    time:   Math.floor(Number(k[0]) / 1000),
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

async function fetchCandles(symbol, interval, limit = 100) {
  const providers = [
    { name: 'Binance', fn: () => fetchCandlesFromBinance(symbol, interval, limit) },
    { name: 'Bybit',   fn: () => fetchCandlesFromBybit(symbol, interval, limit) },
    { name: 'OKX',     fn: () => fetchCandlesFromOkx(symbol, interval, limit) },
  ];
  for (const { name, fn } of providers) {
    try {
      const candles = await withRetry(fn, 2, 1500);
      console.log(`[check-trend] Fuente ${interval}: ${name}`);
      return candles;
    } catch (err) {
      console.warn(`[check-trend] ${name} (${interval}) no disponible: ${err.message}`);
    }
  }
  return null;
}

// ── Telegram ──────────────────────────────────────────────────────────────────

async function sendTelegram(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  if (!res.ok) throw new Error(`Telegram error: ${await res.text()}`);
}

// ── State ─────────────────────────────────────────────────────────────────────

function loadState() {
  if (!existsSync(STATE_FILE)) return { direction: 'neutral', lastAlertAt: null };
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    return {
      direction:  s.direction  ?? 'neutral',
      lastAlertAt: s.lastAlertAt ?? null,
    };
  } catch {
    return { direction: 'neutral', lastAlertAt: null };
  }
}

function saveState(direction, lastAlertAt) {
  writeFileSync(STATE_FILE, JSON.stringify({
    direction,
    lastAlertAt,
    symbol:           SYMBOL,
    entryTimeframe:   ENTRY_TF,
    contextTimeframe: CONTEXT_TF,
    updatedAt:        new Date().toISOString(),
  }), 'utf8');
}

// ── Main ──────────────────────────────────────────────────────────────────────

const LABELS = { bull: '🟢 ALCISTA', bear: '🔴 BAJISTA', neutral: '⚪ NEUTRAL' };

async function main() {
  const { direction: prevDirection, lastAlertAt } = loadState();

  console.log(`[check-trend] ${SYMBOL} | entry: ${ENTRY_TF} | context: ${CONTEXT_TF} | minScore: ${MIN_SCORE} | prev: ${prevDirection}`);

  // Fetch both timeframes in parallel
  const [entryCandlesRaw, contextCandlesRaw] = await Promise.all([
    fetchCandles(SYMBOL, ENTRY_TF,   100),
    fetchCandles(SYMBOL, CONTEXT_TF, 100),
  ]);

  if (!entryCandlesRaw) {
    console.warn('[check-trend] Todos los proveedores fallaron para el timeframe de entrada. Se conserva el estado.');
    process.exit(0);
  }
  if (!contextCandlesRaw) {
    console.warn('[check-trend] Todos los proveedores fallaron para el timeframe de contexto. Se conserva el estado.');
    process.exit(0);
  }

  const entryCandles = entryCandlesRaw.slice(0, -1);
  const contextCandles = contextCandlesRaw.slice(0, -1);

  const entryResult  = trendMeter(entryCandles);
  const contextResult = trendMeter(contextCandles);

  if (!entryResult) {
    console.log('[check-trend] Datos insuficientes en entry TF — saltando');
    return;
  }
  if (!contextResult) {
    console.log('[check-trend] Datos insuficientes en context TF — saltando');
    return;
  }

  const { direction, score, signals } = entryResult;
  const { direction: contextDirection, score: contextScore } = contextResult;

  console.log(`[check-trend] entry ${ENTRY_TF}: ${direction} (score ${score > 0 ? '+' : ''}${score})`);
  console.log(`[check-trend] context ${CONTEXT_TF}: ${contextDirection} (score ${contextScore > 0 ? '+' : ''}${contextScore})`);

  // Siempre guardamos el estado actual (dirección del entry TF)
  const now = new Date();
  saveState(direction, lastAlertAt);

  // ── Filtros para decidir si enviar alerta ─────────────────────────────────

  const changed      = direction !== prevDirection;
  const isActionable = direction === 'bull' || direction === 'bear';

  if (!changed || !isActionable) {
    console.log('[check-trend] Sin cambio accionable — sin alerta');
    return;
  }

  // Filtro 1: score mínimo en el entry TF
  if (Math.abs(score) < MIN_SCORE) {
    console.log(`[check-trend] Score insuficiente (${score}, mínimo ±${MIN_SCORE}) — sin alerta`);
    return;
  }

  // Filtro 2: el timeframe de contexto debe confirmar la misma dirección
  if (contextDirection !== direction) {
    console.log(`[check-trend] Sin confirmación de contexto (entry: ${direction}, context: ${contextDirection}) — sin alerta`);
    return;
  }

  // Filtro 3: cooldown entre alertas
  if (lastAlertAt) {
    const minutesSinceLast = (now - new Date(lastAlertAt)) / 60_000;
    if (minutesSinceLast < COOLDOWN_MINUTES) {
      console.log(`[check-trend] Cooldown activo (${minutesSinceLast.toFixed(1)} min < ${COOLDOWN_MINUTES} min) — sin alerta`);
      return;
    }
  }

  // Filtro 4: credenciales de Telegram
  if (!TOKEN || !CHAT_ID) {
    console.warn('[check-trend] TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados — sin alerta');
    return;
  }

  // ── Construir y enviar alerta ─────────────────────────────────────────────

  const sigLines = [
    `• Precio vs EMA20:   ${signals.vsEma20      === 1 ? '✅' : '❌'}`,
    `• Precio vs EMA50:   ${signals.vsEma50      === 1 ? '✅' : '❌'}`,
    `• Cruce EMA rápido:  ${signals.emaFastCross === 1 ? '✅' : '❌'}`,
    `• Supertrend:        ${signals.supertrend   === 1 ? '✅' : '❌'}`,
    `• MACD histograma:   ${signals.macdHist     === 1 ? '✅' : '❌'}`,
    `• RSI > 50:          ${signals.rsiLevel     === 1 ? '✅' : '❌'}`,
  ].join('\n');

  const message =
    `<b>📊 Cambio de Tendencia Detectado</b>\n\n` +
    `Par: <b>${SYMBOL}</b>\n` +
    `Señal (${ENTRY_TF}):    <b>${LABELS[direction]}</b>  (${score > 0 ? '+' : ''}${score}/6)\n` +
    `Contexto (${CONTEXT_TF}): <b>${LABELS[contextDirection]}</b>  (${contextScore > 0 ? '+' : ''}${contextScore}/6)\n\n` +
    `<b>Señales (${ENTRY_TF}):</b>\n${sigLines}`;

  await sendTelegram(TOKEN, CHAT_ID, message);
  saveState(direction, now.toISOString());
  console.log(`[check-trend] ✅ Alerta enviada → ${direction} (entry: ${ENTRY_TF} + contexto: ${CONTEXT_TF} confirmado)`);
}

main().catch(err => { console.error('[check-trend] Error inesperado:', err.message ?? err); process.exit(1); });
