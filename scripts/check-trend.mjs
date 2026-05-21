#!/usr/bin/env node
/**
 * check-trend.mjs
 * Fetches candles from Binance, computes trendMeter,
 * and sends a Telegram alert when direction changes.
 *
 * Env vars:
 *   BINANCE_SYMBOL          (default: BTCUSDT)
 *   BINANCE_TIMEFRAME       (default: 1h)
 *   TELEGRAM_BOT_TOKEN      required for alerts
 *   TELEGRAM_CHAT_ID        required for alerts
 *   STATE_FILE              (default: .trend-state.json)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

// Carga .env automáticamente en local; en CI las vars ya vienen del entorno
try { process.loadEnvFile('.env'); } catch { /* archivo no existe — ok en CI */ }

const SYMBOL     = process.env.BINANCE_SYMBOL    || 'BTCUSDT';
const TIMEFRAME  = process.env.BINANCE_TIMEFRAME || '1h';
const TOKEN      = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID    = process.env.TELEGRAM_CHAT_ID;
const STATE_FILE = process.env.STATE_FILE || '.trend-state.json';

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
  if (!lastST || !lastMACD) return null;
  const signals = {
    vsEma20:      close > ema20Val ? 1 : -1,
    vsEma50:      close > ema50Val ? 1 : -1,
    emaFastCross: ema9Val > ema21Val ? 1 : -1,
    supertrend:   lastST.direction,
    macdHist:     lastMACD.histogram >= 0 ? 1 : -1,
  };
  const score = signals.vsEma20 + signals.vsEma50 + signals.emaFastCross + signals.supertrend + signals.macdHist;
  const direction = score >= 3 ? 'bull' : score <= -3 ? 'bear' : 'neutral';
  return { score, direction, signals };
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

// Bybit interval map: Binance format → Bybit format
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
  // Bybit returns newest-first — reverse to oldest-first like Binance
  return json.result.list.reverse().map(k => ({
    time:   Math.floor(Number(k[0]) / 1000),
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

// OKX interval map: Binance format → OKX bar format
const OKX_BAR = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1H', '2h': '2H', '4h': '4H', '6h': '6H', '12h': '12H',
  '1d': '1D', '1w': '1W', '1M': '1M',
};

async function fetchCandlesFromOkx(symbol, interval, limit) {
  // Convert BTCUSDT → BTC-USDT
  const instId = symbol.replace(/^([A-Z0-9]+?)(USDT|USDC|BTC|ETH)$/, '$1-$2');
  const bar = OKX_BAR[interval] ?? interval;
  const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OKX error: ${res.status}`);
  const json = await res.json();
  if (json.code !== '0') throw new Error(`OKX error: ${json.msg}`);
  // OKX returns newest-first — reverse to oldest-first
  return json.data.reverse().map(k => ({
    time:   Math.floor(Number(k[0]) / 1000),
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

// Returns candles from the first responsive provider, or null if all fail.
async function fetchCandles(symbol, interval, limit = 100) {
  const providers = [
    { name: 'Binance', fn: () => fetchCandlesFromBinance(symbol, interval, limit) },
    { name: 'Bybit',   fn: () => fetchCandlesFromBybit(symbol, interval, limit) },
    { name: 'OKX',     fn: () => fetchCandlesFromOkx(symbol, interval, limit) },
  ];
  for (const { name, fn } of providers) {
    try {
      const candles = await withRetry(fn, 2, 1500);
      console.log(`[check-trend] Fuente: ${name}`);
      return candles;
    } catch (err) {
      console.warn(`[check-trend] ${name} no disponible: ${err.message}`);
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

// ── Main ──────────────────────────────────────────────────────────────────────

const LABELS = { bull: '🟢 ALCISTA', bear: '🔴 BAJISTA', neutral: '⚪ NEUTRAL' };

async function main() {
  let prevDirection = 'neutral';
  if (existsSync(STATE_FILE)) {
    try {
      prevDirection = JSON.parse(readFileSync(STATE_FILE, 'utf8')).direction ?? 'neutral';
    } catch { /* state file corrupted — start fresh */ }
  }

  console.log(`[check-trend] ${SYMBOL} ${TIMEFRAME} | prev: ${prevDirection}`);

  const candles = await fetchCandles(SYMBOL, TIMEFRAME, 100);

  if (!candles) {
    console.warn('[check-trend] Todos los proveedores de datos fallaron (451/403). Se conserva el estado anterior.');
    process.exit(0);
  }

  const result = trendMeter(candles);

  if (!result) {
    console.log('[check-trend] Not enough data — skipping');
    return;
  }

  const { direction, score, signals } = result;
  console.log(`[check-trend] direction: ${direction} (score ${score > 0 ? '+' : ''}${score})`);

  writeFileSync(STATE_FILE, JSON.stringify({ direction, symbol: SYMBOL, timeframe: TIMEFRAME, updatedAt: new Date().toISOString() }), 'utf8');

  const changed      = direction !== prevDirection;
  const isActionable = direction === 'bull' || direction === 'bear';

  if (!changed || !isActionable) {
    console.log('[check-trend] No actionable change — no alert sent');
    return;
  }

  if (!TOKEN || !CHAT_ID) {
    console.warn('[check-trend] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping alert');
    return;
  }

  const sigLines = [
    `• Precio vs EMA20:   ${signals.vsEma20      === 1 ? '✅' : '❌'}`,
    `• Precio vs EMA50:   ${signals.vsEma50      === 1 ? '✅' : '❌'}`,
    `• Cruce EMA rápido:  ${signals.emaFastCross === 1 ? '✅' : '❌'}`,
    `• Supertrend:        ${signals.supertrend   === 1 ? '✅' : '❌'}`,
    `• MACD histograma:   ${signals.macdHist     === 1 ? '✅' : '❌'}`,
  ].join('\n');

  const message =
    `<b>📊 Cambio de Tendencia Detectado</b>\n\n` +
    `Par: <b>${SYMBOL}</b> | Timeframe: <b>${TIMEFRAME}</b>\n` +
    `Tendencia: <b>${LABELS[direction]}</b> (score ${score > 0 ? '+' : ''}${score}/5)\n\n` +
    `<b>Señales:</b>\n${sigLines}`;

  await sendTelegram(TOKEN, CHAT_ID, message);
  console.log(`[check-trend] ✅ Alert sent → ${direction}`);
}

main().catch(err => { console.error('[check-trend] Error inesperado:', err.message ?? err); process.exit(1); });
