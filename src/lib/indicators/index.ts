import type { Candle } from "@/lib/binance/types";

export interface IndicatorPoint {
  time: number;
  value: number;
}

export interface MACDPoint {
  time: number;
  macd: number;
  signal: number;
  histogram: number;
}

export interface SupertrendPoint {
  time: number;
  value: number;
  direction: 1 | -1; // 1 = bullish, -1 = bearish
}

export interface BollingerPoint {
  time: number;
  upper: number;
  middle: number;
  lower: number;
}

export interface StochRSIPoint {
  time: number;
  k: number;
  d: number;
}

export interface ADXPoint {
  time: number;
  adx: number;
  diPlus: number;
  diMinus: number;
}

export interface CVDPoint {
  time: number;
  value: number;
  signal: number;
}

export interface SignalPoint {
  time: number;
  price: number;
  direction: "bull" | "bear";
  label: string;
}

// ─── Existing indicators ────────────────────────────────────────────────────

export function sma(candles: Candle[], period: number): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (candles.length < period) return out;
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
  }
  return out;
}

export function ema(candles: Candle[], period: number): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (candles.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += candles[i].close;
  prev /= period;
  out.push({ time: candles[period - 1].time, value: prev });
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k);
    out.push({ time: candles[i].time, value: prev });
  }
  return out;
}

export function rsi(candles: Candle[], period = 14): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (candles.length <= period) return out;
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
  out.push({ time: candles[period].time, value: 100 - 100 / (1 + rs) });
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

export function macd(
  candles: Candle[],
  fast = 12,
  slow = 26,
  signal = 9,
): MACDPoint[] {
  if (candles.length < slow + signal) return [];
  const emaFast = ema(candles, fast);
  const emaSlow = ema(candles, slow);
  const slowStartTime = emaSlow[0].time;
  const fastByTime = new Map(emaFast.map((p) => [p.time, p.value]));
  const macdLine: IndicatorPoint[] = [];
  for (const p of emaSlow) {
    const f = fastByTime.get(p.time);
    if (f !== undefined) macdLine.push({ time: p.time, value: f - p.value });
  }
  const synth: Candle[] = macdLine.map((p) => ({
    time: p.time,
    open: p.value,
    high: p.value,
    low: p.value,
    close: p.value,
    volume: 0,
  }));
  const sig = ema(synth, signal);
  const sigByTime = new Map(sig.map((p) => [p.time, p.value]));
  const out: MACDPoint[] = [];
  for (const p of macdLine) {
    const s = sigByTime.get(p.time);
    if (s === undefined) continue;
    out.push({ time: p.time, macd: p.value, signal: s, histogram: p.value - s });
  }
  void slowStartTime;
  return out;
}

// ─── New indicators ──────────────────────────────────────────────────────────

export function atr(candles: Candle[], period = 14): IndicatorPoint[] {
  if (candles.length <= period) return [];
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    tr.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close),
      ),
    );
  }
  let val = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out: IndicatorPoint[] = [{ time: candles[period].time, value: val }];
  for (let i = period; i < tr.length; i++) {
    val = (val * (period - 1) + tr[i]) / period;
    out.push({ time: candles[i + 1].time, value: val });
  }
  return out;
}

export function supertrend(
  candles: Candle[],
  atrPeriod = 10,
  factor = 3.0,
): SupertrendPoint[] {
  const atrVals = atr(candles, atrPeriod);
  if (atrVals.length === 0) return [];

  const out: SupertrendPoint[] = [];
  let prevUpper = 0,
    prevLower = 0,
    prevDir: 1 | -1 = 1;

  for (let i = 0; i < atrVals.length; i++) {
    const ci = atrPeriod + i;
    const hl2 = (candles[ci].high + candles[ci].low) / 2;
    const a = atrVals[i].value;

    let upper = hl2 + factor * a;
    let lower = hl2 - factor * a;

    if (i > 0) {
      lower =
        lower > prevLower || candles[ci - 1].close < prevLower
          ? lower
          : prevLower;
      upper =
        upper < prevUpper || candles[ci - 1].close > prevUpper
          ? upper
          : prevUpper;
    }

    let dir: 1 | -1;
    if (i === 0) {
      dir = 1;
    } else if (prevDir === 1) {
      dir = candles[ci].close < lower ? -1 : 1;
    } else {
      dir = candles[ci].close > upper ? 1 : -1;
    }

    out.push({
      time: candles[ci].time,
      value: dir === 1 ? lower : upper,
      direction: dir,
    });
    prevUpper = upper;
    prevLower = lower;
    prevDir = dir;
  }
  return out;
}

export function bollingerBands(
  candles: Candle[],
  period = 20,
  multiplier = 2.0,
): BollingerPoint[] {
  if (candles.length < period) return [];
  const out: BollingerPoint[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
    const mean = sum / period;
    let vari = 0;
    for (let j = i - period + 1; j <= i; j++) vari += (candles[j].close - mean) ** 2;
    const sd = Math.sqrt(vari / period);
    out.push({
      time: candles[i].time,
      upper: mean + multiplier * sd,
      middle: mean,
      lower: mean - multiplier * sd,
    });
  }
  return out;
}

export function vwap(candles: Candle[]): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  let cumTPV = 0,
    cumVol = 0;
  let prevDay = -1;
  for (const c of candles) {
    const day = Math.floor(c.time / 86400);
    if (day !== prevDay) {
      cumTPV = 0;
      cumVol = 0;
      prevDay = day;
    }
    const tp = (c.high + c.low + c.close) / 3;
    cumTPV += tp * c.volume;
    cumVol += c.volume;
    out.push({ time: c.time, value: cumVol === 0 ? c.close : cumTPV / cumVol });
  }
  return out;
}

export function stochRSI(
  candles: Candle[],
  period = 14,
  kSmooth = 3,
  dSmooth = 3,
): StochRSIPoint[] {
  const rsiVals = rsi(candles, period);
  if (rsiVals.length < period) return [];

  // Raw Stochastic of RSI
  const raw: IndicatorPoint[] = [];
  for (let i = period - 1; i < rsiVals.length; i++) {
    let lo = Infinity,
      hi = -Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      lo = Math.min(lo, rsiVals[j].value);
      hi = Math.max(hi, rsiVals[j].value);
    }
    const range = hi - lo;
    raw.push({
      time: rsiVals[i].time,
      value: range === 0 ? 50 : ((rsiVals[i].value - lo) / range) * 100,
    });
  }

  // Smooth K
  const kLine: IndicatorPoint[] = [];
  for (let i = kSmooth - 1; i < raw.length; i++) {
    let s = 0;
    for (let j = i - kSmooth + 1; j <= i; j++) s += raw[j].value;
    kLine.push({ time: raw[i].time, value: s / kSmooth });
  }

  // D = SMA(kSmooth) of K
  const out: StochRSIPoint[] = [];
  for (let i = dSmooth - 1; i < kLine.length; i++) {
    let s = 0;
    for (let j = i - dSmooth + 1; j <= i; j++) s += kLine[j].value;
    out.push({ time: kLine[i].time, k: kLine[i].value, d: s / dSmooth });
  }
  return out;
}

export function adx(candles: Candle[], period = 14): ADXPoint[] {
  if (candles.length < period * 2 + 1) return [];

  const tr: number[] = [],
    dmP: number[] = [],
    dmM: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const dn = candles[i - 1].low - candles[i].low;
    dmP.push(up > dn && up > 0 ? up : 0);
    dmM.push(dn > up && dn > 0 ? dn : 0);
    tr.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close),
      ),
    );
  }

  let sTR = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let sDMP = dmP.slice(0, period).reduce((a, b) => a + b, 0);
  let sDMM = dmM.slice(0, period).reduce((a, b) => a + b, 0);

  const diPArr: number[] = [],
    diMArr: number[] = [],
    dxArr: number[] = [],
    times: number[] = [];

  function addPoint(ci: number) {
    const dp = sTR === 0 ? 0 : (sDMP / sTR) * 100;
    const dm = sTR === 0 ? 0 : (sDMM / sTR) * 100;
    diPArr.push(dp);
    diMArr.push(dm);
    const sum = dp + dm;
    dxArr.push(sum === 0 ? 0 : (Math.abs(dp - dm) / sum) * 100);
    times.push(candles[ci].time);
  }

  addPoint(period);
  for (let i = period; i < tr.length; i++) {
    sTR = sTR - sTR / period + tr[i];
    sDMP = sDMP - sDMP / period + dmP[i];
    sDMM = sDMM - sDMM / period + dmM[i];
    addPoint(i + 1);
  }

  if (dxArr.length < period) return [];

  let adxVal = dxArr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out: ADXPoint[] = [
    {
      time: times[period - 1],
      adx: adxVal,
      diPlus: diPArr[period - 1],
      diMinus: diMArr[period - 1],
    },
  ];
  for (let i = period; i < dxArr.length; i++) {
    adxVal = (adxVal * (period - 1) + dxArr[i]) / period;
    out.push({ time: times[i], adx: adxVal, diPlus: diPArr[i], diMinus: diMArr[i] });
  }
  return out;
}

export function cvd(candles: Candle[], emaLen = 14): CVDPoint[] {
  if (candles.length < emaLen) return [];

  let cumDelta = 0;
  const cumDeltas: number[] = candles.map((c) => {
    cumDelta += c.close >= c.open ? c.volume : -c.volume;
    return cumDelta;
  });

  const k = 2 / (emaLen + 1);
  let sig = cumDeltas.slice(0, emaLen).reduce((a, b) => a + b, 0) / emaLen;

  const out: CVDPoint[] = [];
  for (let i = emaLen - 1; i < candles.length; i++) {
    if (i > emaLen - 1) sig = cumDeltas[i] * k + sig * (1 - k);
    out.push({ time: candles[i].time, value: cumDeltas[i], signal: sig });
  }
  return out;
}

export function choppiness(candles: Candle[], period = 14): IndicatorPoint[] {
  if (candles.length <= period) return [];

  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    tr.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close),
      ),
    );
  }

  const out: IndicatorPoint[] = [];
  for (let i = period; i < candles.length; i++) {
    let trSum = 0;
    let hh = -Infinity,
      ll = Infinity;
    for (let j = i - period; j < i; j++) {
      trSum += tr[j];
      hh = Math.max(hh, candles[j + 1].high);
      ll = Math.min(ll, candles[j + 1].low);
    }
    const hhll = hh - ll;
    const val =
      hhll === 0 ? 50 : (Math.log10(trSum / hhll) / Math.log10(period)) * 100;
    out.push({ time: candles[i].time, value: Math.min(100, Math.max(0, val)) });
  }
  return out;
}

export function bos(candles: Candle[], pivotLen = 5): SignalPoint[] {
  if (candles.length < pivotLen * 3) return [];

  const out: SignalPoint[] = [];
  let lastPH = -Infinity,
    lastPL = Infinity;
  let lastBullIdx = -1,
    lastBearIdx = -1;

  for (let i = pivotLen * 2; i < candles.length; i++) {
    const pi = i - pivotLen;

    let isPH = true,
      isPL = true;
    for (let j = pi - pivotLen; j <= pi + pivotLen; j++) {
      if (j !== pi) {
        if (candles[j].high >= candles[pi].high) isPH = false;
        if (candles[j].low <= candles[pi].low) isPL = false;
      }
    }
    if (isPH) lastPH = candles[pi].high;
    if (isPL) lastPL = candles[pi].low;

    if (lastPH !== -Infinity && candles[i].close > lastPH && i - lastBullIdx > pivotLen) {
      out.push({ time: candles[i].time, price: candles[i].low, direction: "bull", label: "BOS" });
      lastBullIdx = i;
      lastPH = -Infinity;
    }

    if (lastPL !== Infinity && candles[i].close < lastPL && i - lastBearIdx > pivotLen) {
      out.push({ time: candles[i].time, price: candles[i].high, direction: "bear", label: "BOS" });
      lastBearIdx = i;
      lastPL = Infinity;
    }
  }
  return out;
}

export function candlePatterns(candles: Candle[]): SignalPoint[] {
  if (candles.length < 2) return [];

  const out: SignalPoint[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const bodySize = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;

    // Bullish Engulfing
    if (
      p.close < p.open &&
      c.close > c.open &&
      c.open < p.close &&
      c.close > p.open
    ) {
      out.push({ time: c.time, price: c.low, direction: "bull", label: "ENG" });
      continue;
    }

    // Bearish Engulfing
    if (
      p.close > p.open &&
      c.close < c.open &&
      c.open > p.close &&
      c.close < p.open
    ) {
      out.push({ time: c.time, price: c.high, direction: "bear", label: "ENG" });
      continue;
    }

    if (range === 0) continue;

    // Hammer
    if (
      bodySize < range * 0.35 &&
      lowerWick > bodySize * 2 &&
      upperWick < bodySize * 0.5 &&
      (c.close - c.low) / range > 0.6
    ) {
      out.push({ time: c.time, price: c.low, direction: "bull", label: "HAM" });
      continue;
    }

    // Shooting Star
    if (
      bodySize < range * 0.35 &&
      upperWick > bodySize * 2 &&
      lowerWick < bodySize * 0.5 &&
      (c.high - c.close) / range > 0.6
    ) {
      out.push({ time: c.time, price: c.high, direction: "bear", label: "SS" });
    }
  }
  return out;
}

// ─── Trend Meter ──────────────────────────────────────────────────────────────
// Combina 5 señales para dar un veredicto alcista / bajista / neutral.
// Cada señal devuelve +1 (alcista) o -1 (bajista).
//  1. Precio vs EMA20
//  2. Precio vs EMA50
//  3. EMA9 vs EMA21 (cruce rápido)
//  4. Supertrend dirección
//  5. MACD histograma signo

export interface TrendSignals {
  vsEma20: 1 | -1;
  vsEma50: 1 | -1;
  emaFastCross: 1 | -1;
  supertrend: 1 | -1;
  macdHist: 1 | -1;
}

export interface TrendMeterResult {
  score: number;           // -5 a +5
  direction: "bull" | "bear" | "neutral";
  signals: TrendSignals;
}

export function trendMeter(candles: Candle[]): TrendMeterResult | null {
  if (candles.length < 50) return null;

  const close = candles[candles.length - 1].close;

  // EMA20 y EMA50
  const ema20Val = ema(candles, 20).at(-1)?.value;
  const ema50Val = ema(candles, 50).at(-1)?.value;
  const ema9Val  = ema(candles, 9).at(-1)?.value;
  const ema21Val = ema(candles, 21).at(-1)?.value;

  if (!ema20Val || !ema50Val || !ema9Val || !ema21Val) return null;

  // Supertrend
  const stData = supertrend(candles, 10, 3);
  const lastST = stData.at(-1);

  // MACD histograma
  const macdData = macd(candles, 12, 26, 9);
  const lastMACD = macdData.at(-1);

  if (!lastST || !lastMACD) return null;

  const signals: TrendSignals = {
    vsEma20:     close > ema20Val ? 1 : -1,
    vsEma50:     close > ema50Val ? 1 : -1,
    emaFastCross: ema9Val > ema21Val ? 1 : -1,
    supertrend:  lastST.direction,
    macdHist:    lastMACD.histogram >= 0 ? 1 : -1,
  };

  const score =
    signals.vsEma20 +
    signals.vsEma50 +
    signals.emaFastCross +
    signals.supertrend +
    signals.macdHist;

  const direction: TrendMeterResult["direction"] =
    score >= 3 ? "bull" : score <= -3 ? "bear" : "neutral";

  return { score, direction, signals };
}
