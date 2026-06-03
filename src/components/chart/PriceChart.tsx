"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
} from "lightweight-charts";
import { fetchKlines } from "@/lib/binance/rest";
import { getBinanceWS } from "@/lib/binance/ws";
import {
  ema,
  sma,
  rsi,
  macd,
  atr,
  supertrend,
  bollingerBands,
  vwap,
  stochRSI,
  adx,
  cvd,
  choppiness,
  bos,
  candlePatterns,
  trendMeter,
  trendMeterSeries,
  type TrendMeterResult,
} from "@/lib/indicators";
import type { Candle, Timeframe } from "@/lib/binance/types";
import {
  INDICATOR_COLORS,
  useChartStore,
  resolvePresetIndicators,
  type IndicatorKey,
} from "@/lib/store/chart-store";
import { formatPrice, formatVolume } from "@/lib/format";
import { IndicatorPill } from "./IndicatorPill";
import { MeasureOverlay } from "./MeasureOverlay";
import { useTelegramAlerts } from "@/hooks/useTelegramAlerts";
import { useTrendAlerts } from "@/hooks/useTrendAlerts";
import { useMtfShortSignal } from "@/hooks/useMtfShortSignal";
import { TrendAlertToast } from "./TrendAlertToast";

// Ordered list of subpane indicators (determines pane slot assignment)
const SUBPANE_ORDER: IndicatorKey[] = ["rsi", "macd", "stochrsi", "adx", "cvd", "atr", "chop"];
// Objeto estable para modo preset: referencia fija, evita re-renders infinitos
const EMPTY_HIDDEN = {} as Record<IndicatorKey, boolean>;

function getPaneIdx(key: IndicatorKey, indics: Record<IndicatorKey, boolean>): number {
  const pos = SUBPANE_ORDER.indexOf(key);
  if (pos === -1) return 0;
  return 1 + SUBPANE_ORDER.slice(0, pos).filter((k) => indics[k]).length;
}

interface MeasurePoint { time: number; price: number }
interface MeasureState { phase: "idle" | "placing" | "done"; a: MeasurePoint | null; b: MeasurePoint | null }
const INITIAL_MEASURE: MeasureState = { phase: "idle", a: null, b: null };

function durationLabel(aTime: number, bTime: number): string {
  const diff = Math.abs(bTime - aTime);
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

interface Props { symbol: string; timeframe: Timeframe; usePreset?: boolean }

const TV = {
  bg: "#131722",
  panel: "#1e222d",
  border: "#2a2e39",
  text: "#d1d4dc",
  textMuted: "#787b86",
  green: "#26a69a",
  red: "#ef5350",
  blue: "#2962ff",
  yellow: "#ffb74d",
  purple: "#ab47bc",
  grid: "#1e222d",
};

interface HoverInfo { o: number; h: number; l: number; c: number; v: number; time: number; pct: number }

interface LastValues {
  ema20?: number; ema50?: number; ema200?: number;
  ema9?: number; ema21?: number;
  sma20?: number; sma50?: number; sma200?: number;
  rsi?: number;
  macd?: number; macdSignal?: number; macdHist?: number;
  volume?: number;
  vwap?: number;
  stochRsiK?: number; stochRsiD?: number;
  adx?: number; diPlus?: number; diMinus?: number;
  cvd?: number;
  atr?: number;
  chop?: number;
}

interface PaneOffset { top: number; height: number }

export function PriceChart({ symbol, timeframe, usePreset = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  // ── Main pane series ──────────────────────────────────────────────────────
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ema20Ref   = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref   = useRef<ISeriesApi<"Line"> | null>(null);
  const ema200Ref  = useRef<ISeriesApi<"Line"> | null>(null);
  const ema9Ref    = useRef<ISeriesApi<"Line"> | null>(null);
  const ema21Ref   = useRef<ISeriesApi<"Line"> | null>(null);
  const sma20Ref   = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50Ref   = useRef<ISeriesApi<"Line"> | null>(null);
  const sma200Ref  = useRef<ISeriesApi<"Line"> | null>(null);
  // Supertrend — two series (green = bullish, red = bearish)
  const stBullRef  = useRef<ISeriesApi<"Line"> | null>(null);
  const stBearRef  = useRef<ISeriesApi<"Line"> | null>(null);
  // Bollinger Bands
  const bbUpperRef  = useRef<ISeriesApi<"Line"> | null>(null);
  const bbMiddleRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerRef  = useRef<ISeriesApi<"Line"> | null>(null);
  // VWAP
  const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  // ── RSI pane ──────────────────────────────────────────────────────────────
  const rsiRef   = useRef<ISeriesApi<"Line"> | null>(null);
  const rsi30Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const rsi70Ref = useRef<ISeriesApi<"Line"> | null>(null);

  // ── MACD pane ─────────────────────────────────────────────────────────────
  const macdRef       = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistRef   = useRef<ISeriesApi<"Histogram"> | null>(null);

  // ── StochRSI pane ─────────────────────────────────────────────────────────
  const srKRef  = useRef<ISeriesApi<"Line"> | null>(null);
  const srDRef  = useRef<ISeriesApi<"Line"> | null>(null);
  const sr20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const sr80Ref = useRef<ISeriesApi<"Line"> | null>(null);

  // ── ADX pane ──────────────────────────────────────────────────────────────
  const adxLineRef    = useRef<ISeriesApi<"Line"> | null>(null);
  const diPlusRef     = useRef<ISeriesApi<"Line"> | null>(null);
  const diMinusRef    = useRef<ISeriesApi<"Line"> | null>(null);
  const adxThreshRef  = useRef<ISeriesApi<"Line"> | null>(null);

  // ── CVD pane ──────────────────────────────────────────────────────────────
  const cvdHistRef   = useRef<ISeriesApi<"Histogram"> | null>(null);
  const cvdSignalRef = useRef<ISeriesApi<"Line"> | null>(null);

  // ── ATR pane ──────────────────────────────────────────────────────────────
  const atrLineRef = useRef<ISeriesApi<"Line"> | null>(null);

  // ── Chop pane ─────────────────────────────────────────────────────────────
  const chopLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const chop38Ref   = useRef<ISeriesApi<"Line"> | null>(null);
  const chop62Ref   = useRef<ISeriesApi<"Line"> | null>(null);

  // ── Misc ──────────────────────────────────────────────────────────────────
  const candlesRef = useRef<Candle[]>([]);
  const priceLinesMapRef = useRef<Map<string, IPriceLine>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<{ setMarkers: (m: any[]) => void } | null>(null);

  // ── Store ─────────────────────────────────────────────────────────────────
  const storeIndicators = useChartStore((s) => s.indicators);
  const storeHidden     = useChartStore((s) => s.hidden);
  // En modo multi-panel cada ventana usa los indicadores canónicos de su temporalidad.
  const indicators = useMemo(
    () => usePreset ? resolvePresetIndicators(timeframe) : storeIndicators,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [usePreset, timeframe, storeIndicators],
  );
  const hidden = usePreset ? EMPTY_HIDDEN : storeHidden;
  const config         = useChartStore((s) => s.config);
  const alertConfig    = useChartStore((s) => s.alertConfig);
  const tool           = useChartStore((s) => s.tool);
  const priceLines     = useChartStore((s) => s.priceLines);
  const addPriceLine   = useChartStore((s) => s.addPriceLine);
  const removeIndicator = useChartStore((s) => s.removeIndicator);
  const toggleHidden   = useChartStore((s) => s.toggleHidden);
  const setSettingsTarget = useChartStore((s) => s.setSettingsTarget);

  // Stable refs for callbacks
  const toolRef            = useRef(tool); toolRef.current = tool;
  const addPriceLineRef    = useRef(addPriceLine); addPriceLineRef.current = addPriceLine;
  const symbolRef          = useRef(symbol); symbolRef.current = symbol;
  const configRef          = useRef(config); configRef.current = config;
  const indicatorsRef      = useRef(indicators); indicatorsRef.current = indicators;

  const [hover, setHover]       = useState<HoverInfo | null>(null);
  const [lastPrice, setLastPrice] = useState<{ value: number; pct: number } | null>(null);
  const [lastValues, setLastValues] = useState<LastValues>({});
  const [trendResult, setTrendResult] = useState<TrendMeterResult | null>(null);
  const [paneOffsets, setPaneOffsets] = useState<PaneOffset[]>([]);
  const [measure, setMeasure]   = useState<MeasureState>(INITIAL_MEASURE);
  const [renderTick, setRenderTick] = useState(0);
  const measureRef = useRef(measure); measureRef.current = measure;

  useTelegramAlerts(trendResult, symbol, timeframe, alertConfig);
  useMtfShortSignal(symbol, alertConfig);
  const { activeAlerts, dismiss } = useTrendAlerts(trendResult, symbol, timeframe, alertConfig);

  function recomputePaneOffsets() {
    if (!chartRef.current) return;
    const panes = chartRef.current.panes();
    let top = 0;
    const offsets: PaneOffset[] = panes.map((p) => {
      const h = p.getHeight();
      const o = { top, height: h };
      top += h;
      return o;
    });
    setPaneOffsets(offsets);
  }

  // ── Create chart once ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: TV.bg },
        textColor: TV.text,
        fontFamily: "var(--font-sans), Inter, system-ui, sans-serif",
        fontSize: 11,
        panes: { separatorColor: TV.border, separatorHoverColor: TV.border },
      },
      grid: { vertLines: { color: TV.grid }, horzLines: { color: TV.grid } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: TV.textMuted, width: 1, style: 3, labelBackgroundColor: TV.panel },
        horzLine: { color: TV.textMuted, width: 1, style: 3, labelBackgroundColor: TV.panel },
      },
      rightPriceScale: { borderColor: TV.border, textColor: TV.textMuted },
      timeScale: {
        borderColor: TV.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
      },
      autoSize: true,
    });

    // Candles (pane 0)
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: TV.green, downColor: TV.red,
      borderUpColor: TV.green, borderDownColor: TV.red,
      wickUpColor: TV.green, wickDownColor: TV.red,
      priceLineColor: TV.textMuted, priceLineStyle: 2,
    });

    // Signal markers attached to candle series
    markersRef.current = createSeriesMarkers(candleSeriesRef.current, []);

    // EMAs (always present, data set when enabled)
    const lineOpts = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false };
    ema9Ref.current   = chart.addSeries(LineSeries, { ...lineOpts, color: INDICATOR_COLORS.ema9,   visible: false });
    ema21Ref.current  = chart.addSeries(LineSeries, { ...lineOpts, color: INDICATOR_COLORS.ema21,  visible: false });
    ema20Ref.current  = chart.addSeries(LineSeries, { ...lineOpts, color: INDICATOR_COLORS.ema20,  visible: false });
    ema50Ref.current  = chart.addSeries(LineSeries, { ...lineOpts, color: INDICATOR_COLORS.ema50,  visible: false });
    ema200Ref.current = chart.addSeries(LineSeries, { ...lineOpts, color: INDICATOR_COLORS.ema200, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, visible: false });
    // SMAs (dashed lines to distinguish from EMA)
    const smaOpts = { ...lineOpts, lineStyle: 2 as const };
    sma20Ref.current  = chart.addSeries(LineSeries, { ...smaOpts, color: INDICATOR_COLORS.sma20,  visible: false });
    sma50Ref.current  = chart.addSeries(LineSeries, { ...smaOpts, color: INDICATOR_COLORS.sma50,  visible: false });
    sma200Ref.current = chart.addSeries(LineSeries, { ...smaOpts, color: INDICATOR_COLORS.sma200, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, visible: false });

    // Supertrend (two colour-coded lines, always present)
    stBullRef.current = chart.addSeries(LineSeries, { ...lineOpts, color: TV.green,  visible: false });
    stBearRef.current = chart.addSeries(LineSeries, { ...lineOpts, color: TV.red,    visible: false });

    // Bollinger Bands (3 lines, always present)
    bbUpperRef.current  = chart.addSeries(LineSeries, { ...lineOpts, color: INDICATOR_COLORS.bbands, lineStyle: 2, visible: false });
    bbMiddleRef.current = chart.addSeries(LineSeries, { ...lineOpts, color: INDICATOR_COLORS.bbands, visible: false });
    bbLowerRef.current  = chart.addSeries(LineSeries, { ...lineOpts, color: INDICATOR_COLORS.bbands, lineStyle: 2, visible: false });

    // VWAP (always present)
    vwapSeriesRef.current = chart.addSeries(LineSeries, { ...lineOpts, color: INDICATOR_COLORS.vwap, lineWidth: 2, visible: false });

    chartRef.current = chart;

    // Click handler
    chart.subscribeClick((param) => {
      if (!param.point || !candleSeriesRef.current) return;
      const price = candleSeriesRef.current.coordinateToPrice(param.point.y);
      if (price === null || !isFinite(price)) return;

      if (toolRef.current === "hline") {
        addPriceLineRef.current(price, symbolRef.current);
        return;
      }
      if (toolRef.current === "measure") {
        if (!param.time) return;
        const time = Number(param.time);
        const cur = measureRef.current;
        if (cur.phase === "idle") {
          setMeasure({ phase: "placing", a: { time, price }, b: { time, price } });
        } else if (cur.phase === "placing") {
          setMeasure({ phase: "done", a: cur.a, b: { time, price } });
        } else {
          setMeasure({ phase: "placing", a: { time, price }, b: { time, price } });
        }
      }
    });

    // Crosshair handler
    chart.subscribeCrosshairMove((param) => {
      if (toolRef.current === "measure" && measureRef.current.phase === "placing" && param.point && param.time && candleSeriesRef.current) {
        const price = candleSeriesRef.current.coordinateToPrice(param.point.y);
        if (price !== null && isFinite(price)) {
          const time = Number(param.time);
          setMeasure((prev) => prev.phase === "placing" ? { ...prev, b: { time, price } } : prev);
        }
      }
      if (!param.time || !candleSeriesRef.current) { setHover(null); return; }
      const data = param.seriesData.get(candleSeriesRef.current);
      const vol = volumeSeriesRef.current ? param.seriesData.get(volumeSeriesRef.current) : null;
      if (data && "open" in data) {
        const o = data.open as number;
        const c = data.close as number;
        setHover({ o, h: data.high as number, l: data.low as number, c, v: vol && "value" in vol ? (vol.value as number) : 0, time: Number(param.time), pct: o === 0 ? 0 : ((c - o) / o) * 100 });
      }
    });

    const tsRangeHandler = () => setRenderTick((t) => t + 1);
    const lrHandler = () => setRenderTick((t) => t + 1);
    chart.timeScale().subscribeVisibleTimeRangeChange(tsRangeHandler);
    chart.timeScale().subscribeVisibleLogicalRangeChange(lrHandler);

    const ro = new ResizeObserver(() => requestAnimationFrame(() => recomputePaneOffsets()));
    ro.observe(containerRef.current);
    recomputePaneOffsets();

    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(tsRangeHandler);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(lrHandler);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      priceLinesMapRef.current.clear();
      markersRef.current = null;
      ema9Ref.current = ema21Ref.current = null;
      ema20Ref.current = ema50Ref.current = ema200Ref.current = null;
      stBullRef.current = stBearRef.current = null;
      bbUpperRef.current = bbMiddleRef.current = bbLowerRef.current = null;
      vwapSeriesRef.current = null;
      rsiRef.current = rsi30Ref.current = rsi70Ref.current = null;
      macdRef.current = macdSignalRef.current = macdHistRef.current = null;
      srKRef.current = srDRef.current = sr20Ref.current = sr80Ref.current = null;
      adxLineRef.current = diPlusRef.current = diMinusRef.current = adxThreshRef.current = null;
      cvdHistRef.current = cvdSignalRef.current = null;
      atrLineRef.current = null;
      chopLineRef.current = chop38Ref.current = chop62Ref.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Volume pane ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.volume && !volumeSeriesRef.current) {
      const v = chartRef.current.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume", color: TV.textMuted, priceLineVisible: false, lastValueVisible: false }, 0);
      v.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volumeSeriesRef.current = v;
      v.setData(candlesRef.current.map((k) => ({ time: k.time as UTCTimestamp, value: k.volume, color: k.close >= k.open ? `${TV.green}66` : `${TV.red}66` })));
    } else if (!indicators.volume && volumeSeriesRef.current && chartRef.current) {
      chartRef.current.removeSeries(volumeSeriesRef.current);
      volumeSeriesRef.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.volume]);

  // ── RSI pane ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.rsi && !rsiRef.current) {
      const pi = getPaneIdx("rsi", indicatorsRef.current);
      const r   = chartRef.current.addSeries(LineSeries, { color: INDICATOR_COLORS.rsi, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pi);
      const r30 = chartRef.current.addSeries(LineSeries, { color: TV.textMuted, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false }, pi);
      const r70 = chartRef.current.addSeries(LineSeries, { color: TV.textMuted, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false }, pi);
      rsiRef.current = r; rsi30Ref.current = r30; rsi70Ref.current = r70;
      try { chartRef.current.panes()[pi]?.setStretchFactor(1); chartRef.current.panes()[0]?.setStretchFactor(3); } catch {}
      updateRSI();
    } else if (!indicators.rsi && rsiRef.current && chartRef.current) {
      chartRef.current.removeSeries(rsiRef.current);
      if (rsi30Ref.current) chartRef.current.removeSeries(rsi30Ref.current);
      if (rsi70Ref.current) chartRef.current.removeSeries(rsi70Ref.current);
      rsiRef.current = rsi30Ref.current = rsi70Ref.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.rsi]);

  // ── MACD pane ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.macd && !macdRef.current) {
      const pi = getPaneIdx("macd", indicatorsRef.current);
      const m = chartRef.current.addSeries(LineSeries, { color: INDICATOR_COLORS.macd, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pi);
      const s = chartRef.current.addSeries(LineSeries, { color: TV.yellow, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pi);
      const h = chartRef.current.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pi);
      macdRef.current = m; macdSignalRef.current = s; macdHistRef.current = h;
      try { chartRef.current.panes()[pi]?.setStretchFactor(1); chartRef.current.panes()[0]?.setStretchFactor(3); } catch {}
      updateMACD();
    } else if (!indicators.macd && macdRef.current && chartRef.current) {
      if (macdRef.current) chartRef.current.removeSeries(macdRef.current);
      if (macdSignalRef.current) chartRef.current.removeSeries(macdSignalRef.current);
      if (macdHistRef.current) chartRef.current.removeSeries(macdHistRef.current);
      macdRef.current = macdSignalRef.current = macdHistRef.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.macd, indicators.rsi]);

  // ── StochRSI pane ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.stochrsi && !srKRef.current) {
      const pi = getPaneIdx("stochrsi", indicatorsRef.current);
      const k   = chartRef.current.addSeries(LineSeries, { color: INDICATOR_COLORS.stochrsi, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pi);
      const d   = chartRef.current.addSeries(LineSeries, { color: TV.yellow, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pi);
      const r20 = chartRef.current.addSeries(LineSeries, { color: TV.textMuted, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false }, pi);
      const r80 = chartRef.current.addSeries(LineSeries, { color: TV.textMuted, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false }, pi);
      srKRef.current = k; srDRef.current = d; sr20Ref.current = r20; sr80Ref.current = r80;
      try { chartRef.current.panes()[pi]?.setStretchFactor(1); chartRef.current.panes()[0]?.setStretchFactor(3); } catch {}
      updateStochRSI();
    } else if (!indicators.stochrsi && srKRef.current && chartRef.current) {
      if (srKRef.current) chartRef.current.removeSeries(srKRef.current);
      if (srDRef.current) chartRef.current.removeSeries(srDRef.current);
      if (sr20Ref.current) chartRef.current.removeSeries(sr20Ref.current);
      if (sr80Ref.current) chartRef.current.removeSeries(sr80Ref.current);
      srKRef.current = srDRef.current = sr20Ref.current = sr80Ref.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.stochrsi, indicators.rsi, indicators.macd]);

  // ── ADX pane ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.adx && !adxLineRef.current) {
      const pi = getPaneIdx("adx", indicatorsRef.current);
      const a   = chartRef.current.addSeries(LineSeries, { color: INDICATOR_COLORS.adx,  lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, pi);
      const dp  = chartRef.current.addSeries(LineSeries, { color: TV.green, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pi);
      const dm  = chartRef.current.addSeries(LineSeries, { color: TV.red,   lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pi);
      const th  = chartRef.current.addSeries(LineSeries, { color: TV.textMuted, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false }, pi);
      adxLineRef.current = a; diPlusRef.current = dp; diMinusRef.current = dm; adxThreshRef.current = th;
      try { chartRef.current.panes()[pi]?.setStretchFactor(1); chartRef.current.panes()[0]?.setStretchFactor(3); } catch {}
      updateADX();
    } else if (!indicators.adx && adxLineRef.current && chartRef.current) {
      if (adxLineRef.current) chartRef.current.removeSeries(adxLineRef.current);
      if (diPlusRef.current) chartRef.current.removeSeries(diPlusRef.current);
      if (diMinusRef.current) chartRef.current.removeSeries(diMinusRef.current);
      if (adxThreshRef.current) chartRef.current.removeSeries(adxThreshRef.current);
      adxLineRef.current = diPlusRef.current = diMinusRef.current = adxThreshRef.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.adx, indicators.rsi, indicators.macd, indicators.stochrsi]);

  // ── CVD pane ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.cvd && !cvdHistRef.current) {
      const pi = getPaneIdx("cvd", indicatorsRef.current);
      const h = chartRef.current.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pi);
      const s = chartRef.current.addSeries(LineSeries, { color: TV.yellow, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pi);
      cvdHistRef.current = h; cvdSignalRef.current = s;
      try { chartRef.current.panes()[pi]?.setStretchFactor(1); chartRef.current.panes()[0]?.setStretchFactor(3); } catch {}
      updateCVD();
    } else if (!indicators.cvd && cvdHistRef.current && chartRef.current) {
      if (cvdHistRef.current) chartRef.current.removeSeries(cvdHistRef.current);
      if (cvdSignalRef.current) chartRef.current.removeSeries(cvdSignalRef.current);
      cvdHistRef.current = cvdSignalRef.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.cvd, indicators.rsi, indicators.macd, indicators.stochrsi, indicators.adx]);

  // ── ATR pane ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.atr && !atrLineRef.current) {
      const pi = getPaneIdx("atr", indicatorsRef.current);
      const a = chartRef.current.addSeries(LineSeries, { color: INDICATOR_COLORS.atr, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pi);
      atrLineRef.current = a;
      try { chartRef.current.panes()[pi]?.setStretchFactor(1); chartRef.current.panes()[0]?.setStretchFactor(3); } catch {}
      updateATR();
    } else if (!indicators.atr && atrLineRef.current && chartRef.current) {
      chartRef.current.removeSeries(atrLineRef.current);
      atrLineRef.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.atr, indicators.rsi, indicators.macd, indicators.stochrsi, indicators.adx, indicators.cvd]);

  // ── Chop pane ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.chop && !chopLineRef.current) {
      const pi = getPaneIdx("chop", indicatorsRef.current);
      const c   = chartRef.current.addSeries(LineSeries, { color: INDICATOR_COLORS.chop, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pi);
      const c38 = chartRef.current.addSeries(LineSeries, { color: TV.green, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false }, pi);
      const c62 = chartRef.current.addSeries(LineSeries, { color: TV.red,   lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false }, pi);
      chopLineRef.current = c; chop38Ref.current = c38; chop62Ref.current = c62;
      try { chartRef.current.panes()[pi]?.setStretchFactor(1); chartRef.current.panes()[0]?.setStretchFactor(3); } catch {}
      updateChop();
    } else if (!indicators.chop && chopLineRef.current && chartRef.current) {
      if (chopLineRef.current) chartRef.current.removeSeries(chopLineRef.current);
      if (chop38Ref.current) chartRef.current.removeSeries(chop38Ref.current);
      if (chop62Ref.current) chartRef.current.removeSeries(chop62Ref.current);
      chopLineRef.current = chop38Ref.current = chop62Ref.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.chop, indicators.rsi, indicators.macd, indicators.stochrsi, indicators.adx, indicators.cvd, indicators.atr]);

  // ── Visibility (eye toggle) ───────────────────────────────────────────────
  useEffect(() => {
    const v = (key: IndicatorKey) => indicators[key] && !hidden[key];
    // Main-pane overlays (always created, toggle visible)
    ema9Ref.current?.applyOptions({ visible: v("ema9") });
    ema21Ref.current?.applyOptions({ visible: v("ema21") });
    ema20Ref.current?.applyOptions({ visible: v("ema20") });
    ema50Ref.current?.applyOptions({ visible: v("ema50") });
    ema200Ref.current?.applyOptions({ visible: v("ema200") });
    sma20Ref.current?.applyOptions({ visible: v("sma20") });
    sma50Ref.current?.applyOptions({ visible: v("sma50") });
    sma200Ref.current?.applyOptions({ visible: v("sma200") });
    const stVisible = v("supertrend");
    stBullRef.current?.applyOptions({ visible: stVisible });
    stBearRef.current?.applyOptions({ visible: stVisible });
    const bbVisible = v("bbands");
    bbUpperRef.current?.applyOptions({ visible: bbVisible });
    bbMiddleRef.current?.applyOptions({ visible: bbVisible });
    bbLowerRef.current?.applyOptions({ visible: bbVisible });
    vwapSeriesRef.current?.applyOptions({ visible: v("vwap") });
    // Subpane indicators (created/destroyed, but hidden eye still works)
    if (rsiRef.current) rsiRef.current.applyOptions({ visible: v("rsi") });
    if (rsi30Ref.current) rsi30Ref.current.applyOptions({ visible: v("rsi") });
    if (rsi70Ref.current) rsi70Ref.current.applyOptions({ visible: v("rsi") });
    if (macdRef.current) macdRef.current.applyOptions({ visible: v("macd") });
    if (macdSignalRef.current) macdSignalRef.current.applyOptions({ visible: v("macd") });
    if (macdHistRef.current) macdHistRef.current.applyOptions({ visible: v("macd") });
    if (volumeSeriesRef.current) volumeSeriesRef.current.applyOptions({ visible: v("volume") });
    const srVis = v("stochrsi");
    if (srKRef.current) srKRef.current.applyOptions({ visible: srVis });
    if (srDRef.current) srDRef.current.applyOptions({ visible: srVis });
    if (sr20Ref.current) sr20Ref.current.applyOptions({ visible: srVis });
    if (sr80Ref.current) sr80Ref.current.applyOptions({ visible: srVis });
    const adxVis = v("adx");
    if (adxLineRef.current) adxLineRef.current.applyOptions({ visible: adxVis });
    if (diPlusRef.current) diPlusRef.current.applyOptions({ visible: adxVis });
    if (diMinusRef.current) diMinusRef.current.applyOptions({ visible: adxVis });
    if (adxThreshRef.current) adxThreshRef.current.applyOptions({ visible: adxVis });
    const cvdVis = v("cvd");
    if (cvdHistRef.current) cvdHistRef.current.applyOptions({ visible: cvdVis });
    if (cvdSignalRef.current) cvdSignalRef.current.applyOptions({ visible: cvdVis });
    if (atrLineRef.current) atrLineRef.current.applyOptions({ visible: v("atr") });
    const chopVis = v("chop");
    if (chopLineRef.current) chopLineRef.current.applyOptions({ visible: chopVis });
    if (chop38Ref.current) chop38Ref.current.applyOptions({ visible: chopVis });
    if (chop62Ref.current) chop62Ref.current.applyOptions({ visible: chopVis });
  }, [indicators, hidden]);

  // ── Config-driven recomputes ──────────────────────────────────────────────
  useEffect(() => { updateEMAs(); }, [config.ema20, config.ema50, config.ema200, config.ema9, config.ema21]);
  useEffect(() => { updateSMAs(); }, [config.sma20, config.sma50, config.sma200]);
  useEffect(() => { updateRSI(); }, [config.rsi]);
  useEffect(() => { updateMACD(); }, [config.macdFast, config.macdSlow, config.macdSignal]);
  useEffect(() => { updateSupertrend(); }, [config.supertrendAtr, config.supertrendFactor]);
  useEffect(() => { updateBBands(); }, [config.bbandsLen, config.bbandsMultiplier]);
  useEffect(() => { updateStochRSI(); }, [config.stochRsiLen, config.stochRsiK, config.stochRsiD]);
  useEffect(() => { updateADX(); }, [config.adxLen]);
  useEffect(() => { updateCVD(); }, [config.cvdEmaLen]);
  useEffect(() => { updateATR(); }, [config.atrLen]);
  useEffect(() => { updateChop(); }, [config.chopLen]);
  useEffect(() => { updateSignalMarkers(); }, [indicators.bos, indicators.patterns, indicators.trendcross, config.bosLen]);
  useEffect(() => {
    updateTrendMeter();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.trendmeter]);

  // ── Price lines (hline tool) ──────────────────────────────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    const map = priceLinesMapRef.current;
    const linesForSymbol = priceLines.filter((p) => p.symbol === symbol);
    const activeIds = new Set(linesForSymbol.map((p) => p.id));
    for (const [id, apiLine] of map.entries()) {
      if (!activeIds.has(id)) {
        try { series.removePriceLine(apiLine); } catch {}
        map.delete(id);
      }
    }
    for (const pl of linesForSymbol) {
      if (!map.has(pl.id)) {
        const apiLine = series.createPriceLine({ price: pl.price, color: TV.blue, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "" });
        map.set(pl.id, apiLine);
      }
    }
  }, [priceLines, symbol]);

  // ── Cursor & measure ──────────────────────────────────────────────────────
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.cursor = tool === "hline" || tool === "measure" ? "crosshair" : "";
    }
    if (tool !== "measure") setMeasure(INITIAL_MEASURE);
  }, [tool]);

  // ── Update functions ──────────────────────────────────────────────────────

  function updateEMAs() {
    const c = candlesRef.current;
    if (c.length === 0) return;
    const cfg = configRef.current;
    const indics = indicatorsRef.current;
    let last9: number | undefined, last21: number | undefined, last20: number | undefined, last50: number | undefined, last200: number | undefined;

    if (ema9Ref.current && indics.ema9) {
      const d = ema(c, cfg.ema9);
      ema9Ref.current.setData(d.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      last9 = d.at(-1)?.value;
    }
    if (ema21Ref.current && indics.ema21) {
      const d = ema(c, cfg.ema21);
      ema21Ref.current.setData(d.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      last21 = d.at(-1)?.value;
    }
    if (ema20Ref.current && indics.ema20) {
      const d = ema(c, cfg.ema20);
      ema20Ref.current.setData(d.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      last20 = d.at(-1)?.value;
    }
    if (ema50Ref.current && indics.ema50) {
      const d = ema(c, cfg.ema50);
      ema50Ref.current.setData(d.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      last50 = d.at(-1)?.value;
    }
    if (ema200Ref.current && indics.ema200) {
      const d = ema(c, cfg.ema200);
      ema200Ref.current.setData(d.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      last200 = d.at(-1)?.value;
    }
    const lastVol = c.at(-1)?.volume;
    setLastValues((prev) => ({ ...prev, ema9: last9, ema21: last21, ema20: last20, ema50: last50, ema200: last200, volume: lastVol }));
  }

  function updateSMAs() {
    const c = candlesRef.current;
    if (c.length === 0) return;
    const cfg = configRef.current;
    const indics = indicatorsRef.current;
    let last20: number | undefined, last50: number | undefined, last200: number | undefined;

    if (sma20Ref.current && indics.sma20) {
      const d = sma(c, cfg.sma20);
      sma20Ref.current.setData(d.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      last20 = d.at(-1)?.value;
    }
    if (sma50Ref.current && indics.sma50) {
      const d = sma(c, cfg.sma50);
      sma50Ref.current.setData(d.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      last50 = d.at(-1)?.value;
    }
    if (sma200Ref.current && indics.sma200) {
      const d = sma(c, cfg.sma200);
      sma200Ref.current.setData(d.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      last200 = d.at(-1)?.value;
    }
    setLastValues((prev) => ({ ...prev, sma20: last20, sma50: last50, sma200: last200 }));
  }

  function updateRSI() {
    const c = candlesRef.current;
    if (c.length === 0 || !rsiRef.current) return;
    const data = rsi(c, configRef.current.rsi).map((p) => ({ time: p.time as UTCTimestamp, value: p.value }));
    rsiRef.current.setData(data);
    if (rsi30Ref.current && data.length > 0) rsi30Ref.current.setData([{ time: data[0].time, value: 30 }, { time: data[data.length - 1].time, value: 30 }]);
    if (rsi70Ref.current && data.length > 0) rsi70Ref.current.setData([{ time: data[0].time, value: 70 }, { time: data[data.length - 1].time, value: 70 }]);
    setLastValues((prev) => ({ ...prev, rsi: data.at(-1)?.value }));
  }

  function updateMACD() {
    const c = candlesRef.current;
    if (c.length === 0 || !macdRef.current) return;
    const cfg = configRef.current;
    const m = macd(c, cfg.macdFast, cfg.macdSlow, cfg.macdSignal);
    macdRef.current.setData(m.map((p) => ({ time: p.time as UTCTimestamp, value: p.macd })));
    macdSignalRef.current?.setData(m.map((p) => ({ time: p.time as UTCTimestamp, value: p.signal })));
    macdHistRef.current?.setData(m.map((p) => ({ time: p.time as UTCTimestamp, value: p.histogram, color: p.histogram >= 0 ? `${TV.green}80` : `${TV.red}80` })));
    const last = m.at(-1);
    setLastValues((prev) => ({ ...prev, macd: last?.macd, macdSignal: last?.signal, macdHist: last?.histogram }));
  }

  function updateSupertrend() {
    const c = candlesRef.current;
    if (c.length === 0 || !stBullRef.current || !stBearRef.current) return;
    if (!indicatorsRef.current.supertrend) return;
    const cfg = configRef.current;
    const stData = supertrend(c, cfg.supertrendAtr, cfg.supertrendFactor);

    const bullData: { time: UTCTimestamp; value: number }[] = [];
    const bearData: { time: UTCTimestamp; value: number }[] = [];
    for (let i = 0; i < stData.length; i++) {
      const p = stData[i];
      if (p.direction === 1) {
        if (i > 0 && stData[i - 1].direction === -1) bearData.push({ time: p.time as UTCTimestamp, value: p.value });
        bullData.push({ time: p.time as UTCTimestamp, value: p.value });
      } else {
        if (i > 0 && stData[i - 1].direction === 1) bullData.push({ time: p.time as UTCTimestamp, value: p.value });
        bearData.push({ time: p.time as UTCTimestamp, value: p.value });
      }
    }
    stBullRef.current.setData(bullData);
    stBearRef.current.setData(bearData);
  }

  function updateBBands() {
    const c = candlesRef.current;
    if (c.length === 0 || !bbUpperRef.current || !bbMiddleRef.current || !bbLowerRef.current) return;
    if (!indicatorsRef.current.bbands) return;
    const cfg = configRef.current;
    const bb = bollingerBands(c, cfg.bbandsLen, cfg.bbandsMultiplier);
    bbUpperRef.current.setData(bb.map((p) => ({ time: p.time as UTCTimestamp, value: p.upper })));
    bbMiddleRef.current.setData(bb.map((p) => ({ time: p.time as UTCTimestamp, value: p.middle })));
    bbLowerRef.current.setData(bb.map((p) => ({ time: p.time as UTCTimestamp, value: p.lower })));
  }

  function updateVWAP() {
    const c = candlesRef.current;
    if (c.length === 0 || !vwapSeriesRef.current) return;
    if (!indicatorsRef.current.vwap) return;
    const data = vwap(c);
    vwapSeriesRef.current.setData(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    setLastValues((prev) => ({ ...prev, vwap: data.at(-1)?.value }));
  }

  function updateStochRSI() {
    const c = candlesRef.current;
    if (c.length === 0 || !srKRef.current || !srDRef.current) return;
    const cfg = configRef.current;
    const data = stochRSI(c, cfg.stochRsiLen, cfg.stochRsiK, cfg.stochRsiD);
    srKRef.current.setData(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.k })));
    srDRef.current.setData(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.d })));
    if (sr20Ref.current && data.length > 0) sr20Ref.current.setData([{ time: data[0].time as UTCTimestamp, value: 20 }, { time: data[data.length - 1].time as UTCTimestamp, value: 20 }]);
    if (sr80Ref.current && data.length > 0) sr80Ref.current.setData([{ time: data[0].time as UTCTimestamp, value: 80 }, { time: data[data.length - 1].time as UTCTimestamp, value: 80 }]);
    const last = data.at(-1);
    setLastValues((prev) => ({ ...prev, stochRsiK: last?.k, stochRsiD: last?.d }));
  }

  function updateADX() {
    const c = candlesRef.current;
    if (c.length === 0 || !adxLineRef.current || !diPlusRef.current || !diMinusRef.current) return;
    const data = adx(c, configRef.current.adxLen);
    adxLineRef.current.setData(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.adx })));
    diPlusRef.current.setData(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.diPlus })));
    diMinusRef.current.setData(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.diMinus })));
    if (adxThreshRef.current && data.length > 0) adxThreshRef.current.setData([{ time: data[0].time as UTCTimestamp, value: 20 }, { time: data[data.length - 1].time as UTCTimestamp, value: 20 }]);
    const last = data.at(-1);
    setLastValues((prev) => ({ ...prev, adx: last?.adx, diPlus: last?.diPlus, diMinus: last?.diMinus }));
  }

  function updateCVD() {
    const c = candlesRef.current;
    if (c.length === 0 || !cvdHistRef.current || !cvdSignalRef.current) return;
    const data = cvd(c, configRef.current.cvdEmaLen);
    cvdHistRef.current.setData(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value, color: p.value >= p.signal ? `${TV.green}99` : `${TV.red}99` })));
    cvdSignalRef.current.setData(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.signal })));
    setLastValues((prev) => ({ ...prev, cvd: data.at(-1)?.value }));
  }

  function updateATR() {
    const c = candlesRef.current;
    if (c.length === 0 || !atrLineRef.current) return;
    const data = atr(c, configRef.current.atrLen);
    atrLineRef.current.setData(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    setLastValues((prev) => ({ ...prev, atr: data.at(-1)?.value }));
  }

  function updateChop() {
    const c = candlesRef.current;
    if (c.length === 0 || !chopLineRef.current) return;
    const data = choppiness(c, configRef.current.chopLen);
    chopLineRef.current.setData(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    if (chop38Ref.current && data.length > 0) chop38Ref.current.setData([{ time: data[0].time as UTCTimestamp, value: 38.2 }, { time: data[data.length - 1].time as UTCTimestamp, value: 38.2 }]);
    if (chop62Ref.current && data.length > 0) chop62Ref.current.setData([{ time: data[0].time as UTCTimestamp, value: 61.8 }, { time: data[data.length - 1].time as UTCTimestamp, value: 61.8 }]);
    setLastValues((prev) => ({ ...prev, chop: data.at(-1)?.value }));
  }

  function updateTrendMeter() {
    const c = candlesRef.current;
    if (c.length === 0 || !indicatorsRef.current.trendmeter) {
      setTrendResult(null);
      return;
    }
    setTrendResult(trendMeter(c));
  }

  function updateSignalMarkers() {
    const c = candlesRef.current;
    if (c.length === 0 || !markersRef.current) return;
    const indics = indicatorsRef.current;
    const cfg = configRef.current;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const markers: any[] = [];

    if (indics.bos) {
      for (const sig of bos(c, cfg.bosLen)) {
        markers.push({
          time: sig.time as UTCTimestamp,
          position: sig.direction === "bull" ? "belowBar" : "aboveBar",
          color: sig.direction === "bull" ? TV.green : TV.red,
          shape: sig.direction === "bull" ? "arrowUp" : "arrowDown",
          text: "BOS",
        });
      }
    }

    if (indics.patterns) {
      for (const sig of candlePatterns(c)) {
        markers.push({
          time: sig.time as UTCTimestamp,
          position: sig.direction === "bull" ? "belowBar" : "aboveBar",
          color: sig.direction === "bull" ? TV.green : TV.red,
          shape: sig.direction === "bull" ? "arrowUp" : "arrowDown",
          text: sig.label,
        });
      }
    }

    if (indics.trendcross && c.length >= 50) {
      const series = trendMeterSeries(c);
      let prevDir: "bull" | "bear" | "neutral" | null = null;
      for (let i = 0; i < series.length; i++) {
        const pt = series[i];
        if (!pt) { prevDir = null; continue; }
        if (prevDir !== null && prevDir !== pt.direction) {
          // Cambio de tendencia confirmado
          const isBull = pt.direction === "bull";
          const isBear = pt.direction === "bear";
          markers.push({
            time: c[i].time as UTCTimestamp,
            position: isBull ? "belowBar" : isBear ? "aboveBar" : (prevDir === "bear" ? "belowBar" : "aboveBar"),
            color: isBull ? TV.green : isBear ? TV.red : TV.yellow,
            shape: "circle",
            text: "✕",
          });
        }
        prevDir = pt.direction;
      }
    }

    // Sort by time (required by lightweight-charts)
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    markersRef.current.setMarkers(markers);
  }

  // ── Load data + live subscription ─────────────────────────────────────────
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;

    async function load() {
      try {
        const klines = await fetchKlines(symbol, timeframe, 1000);
        if (cancelled) return;
        candlesRef.current = klines;

        if (candleSeriesRef.current) {
          candleSeriesRef.current.setData(klines.map((k) => ({ time: k.time as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close })));
        }
        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.setData(klines.map((k) => ({ time: k.time as UTCTimestamp, value: k.volume, color: k.close >= k.open ? `${TV.green}66` : `${TV.red}66` })));
        }

        updateEMAs();
        updateSMAs();
        updateRSI();
        updateMACD();
        updateSupertrend();
        updateBBands();
        updateVWAP();
        updateStochRSI();
        updateADX();
        updateCVD();
        updateATR();
        updateChop();
        updateTrendMeter();
        updateSignalMarkers();

        chartRef.current?.timeScale().fitContent();
        requestAnimationFrame(() => recomputePaneOffsets());

        if (klines.length > 0) {
          const last = klines[klines.length - 1];
          const prev = klines[klines.length - 2] ?? last;
          setLastPrice({ value: last.close, pct: prev.close === 0 ? 0 : ((last.close - prev.close) / prev.close) * 100 });
        }

        const ws = getBinanceWS();
        unsub = ws.subscribeKline({
          symbol,
          interval: timeframe,
          onCandle: (k) => {
            if (!candleSeriesRef.current) return;
            const arr = candlesRef.current;
            const lastCandle = arr[arr.length - 1];
            if (lastCandle && lastCandle.time === k.time) {
              arr[arr.length - 1] = k;
            } else if (!lastCandle || k.time > lastCandle.time) {
              arr.push(k);
              if (arr.length > 2000) arr.shift();
            } else {
              return;
            }
            candleSeriesRef.current.update({ time: k.time as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close });
            if (volumeSeriesRef.current) volumeSeriesRef.current.update({ time: k.time as UTCTimestamp, value: k.volume, color: k.close >= k.open ? `${TV.green}66` : `${TV.red}66` });

            updateEMAs();
            updateSMAs();
            updateRSI();
            updateMACD();
            updateSupertrend();
            updateBBands();
            updateVWAP();
            updateStochRSI();
            updateADX();
            updateCVD();
            updateATR();
            updateChop();
            updateTrendMeter();
            updateSignalMarkers();

            const prev = arr[arr.length - 2] ?? lastCandle;
            setLastPrice({ value: k.close, pct: prev && prev.close !== 0 ? ((k.close - prev.close) / prev.close) * 100 : 0 });
          },
        });
      } catch (e) {
        console.error("Failed to load chart data:", e);
      }
    }

    load();
    return () => { cancelled = true; if (unsub) unsub(); };
  }, [symbol, timeframe]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const greenOrRed = (n: number) => n >= 0 ? "text-tv-green" : "text-tv-red";
  const rsiPaneIdx   = getPaneIdx("rsi",      indicators);
  const macdPaneIdx  = getPaneIdx("macd",     indicators);
  const srPaneIdx    = getPaneIdx("stochrsi", indicators);
  const adxPaneIdx   = getPaneIdx("adx",      indicators);
  const cvdPaneIdx   = getPaneIdx("cvd",      indicators);
  const atrPaneIdx   = getPaneIdx("atr",      indicators);
  const chopPaneIdx  = getPaneIdx("chop",     indicators);

  // ── Measure overlay ───────────────────────────────────────────────────────
  let measureRender: React.ReactNode = null;
  if (measure.a && measure.b && chartRef.current && candleSeriesRef.current) {
    const ts = chartRef.current.timeScale();
    const aX = ts.timeToCoordinate(measure.a.time as UTCTimestamp);
    const bX = ts.timeToCoordinate(measure.b.time as UTCTimestamp);
    const aY = candleSeriesRef.current.priceToCoordinate(measure.a.price);
    const bY = candleSeriesRef.current.priceToCoordinate(measure.b.price);
    if (aX !== null && bX !== null && aY !== null && bY !== null) {
      const priceDiff = measure.b.price - measure.a.price;
      const pctChange = measure.a.price === 0 ? 0 : (priceDiff / measure.a.price) * 100;
      const isUp = priceDiff >= 0;
      const start = Math.min(measure.a.time, measure.b.time);
      const end   = Math.max(measure.a.time, measure.b.time);
      const inRange = candlesRef.current.filter((c) => c.time >= start && c.time <= end);
      measureRender = (
        <MeasureOverlay
          aX={aX} aY={aY} bX={bX} bY={bY}
          priceDiff={priceDiff} pctChange={pctChange}
          bars={inRange.length}
          volume={inRange.reduce((s, c) => s + c.volume, 0)}
          durationText={durationLabel(measure.a.time, measure.b.time)}
          isUp={isUp}
          isPreview={measure.phase === "placing"}
        />
      );
    }
  }
  void renderTick;

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {measureRender}

      {/* ── Main pane overlay: symbol + OHLC + price + indicator pills ── */}
      <div
        style={{ top: (paneOffsets[0]?.top ?? 0) + 12, left: 12 }}
        className="pointer-events-none absolute z-10 flex flex-col gap-1 text-xs tabular-nums"
      >
        {/* Row 1: symbol info + OHLC on hover */}
        <div className="flex h-5 flex-nowrap items-center gap-x-3 overflow-hidden whitespace-nowrap">
          <div className="flex shrink-0 items-center gap-2 text-[13px] font-semibold">
            <span className="text-tv-text">{symbol}</span>
            <span className="text-tv-text-muted">·</span>
            <span className="uppercase text-tv-text-muted">{timeframe}</span>
            <span className="text-tv-text-muted">·</span>
            <span className="text-tv-text-muted">Binance</span>
          </div>
          {hover && (
            <div className="flex items-center gap-x-3 text-[11px]">
              <span className="text-tv-text-muted">O <span className={greenOrRed(hover.c - hover.o)}>{formatPrice(hover.o)}</span></span>
              <span className="text-tv-text-muted">H <span className={greenOrRed(hover.c - hover.o)}>{formatPrice(hover.h)}</span></span>
              <span className="text-tv-text-muted">L <span className={greenOrRed(hover.c - hover.o)}>{formatPrice(hover.l)}</span></span>
              <span className="text-tv-text-muted">C <span className={greenOrRed(hover.c - hover.o)}>{formatPrice(hover.c)}</span></span>
              <span className={greenOrRed(hover.pct)}>{hover.pct >= 0 ? "+" : ""}{hover.pct.toFixed(2)}%</span>
              <span className="text-tv-text-muted">Vol <span className="text-tv-text">{formatVolume(hover.v)}</span></span>
            </div>
          )}
        </div>

        {/* Row 2: live price */}
        <div className="flex h-7 items-center gap-2">
          {lastPrice ? (
            <>
              <span className={`text-lg font-semibold tabular-nums ${greenOrRed(lastPrice.pct)}`}>{formatPrice(lastPrice.value)}</span>
              <span className={`text-xs ${greenOrRed(lastPrice.pct)}`}>{lastPrice.pct >= 0 ? "+" : ""}{lastPrice.pct.toFixed(2)}%</span>
            </>
          ) : (
            <span className="text-xs text-tv-text-muted">Cargando…</span>
          )}
        </div>

        {/* Indicator pills for main pane */}
        <div className="mt-1 flex flex-col items-start gap-1">
          {indicators.ema9 && (
            <IndicatorPill name={`EMA ${config.ema9}`} value={lastValues.ema9 !== undefined ? formatPrice(lastValues.ema9) : undefined} color={INDICATOR_COLORS.ema9} hidden={hidden.ema9} onToggleHide={() => toggleHidden("ema9")} onSettings={() => setSettingsTarget("ema9")} onRemove={() => removeIndicator("ema9")} />
          )}
          {indicators.ema21 && (
            <IndicatorPill name={`EMA ${config.ema21}`} value={lastValues.ema21 !== undefined ? formatPrice(lastValues.ema21) : undefined} color={INDICATOR_COLORS.ema21} hidden={hidden.ema21} onToggleHide={() => toggleHidden("ema21")} onSettings={() => setSettingsTarget("ema21")} onRemove={() => removeIndicator("ema21")} />
          )}
          {indicators.ema20 && (
            <IndicatorPill name={`EMA ${config.ema20}`} value={lastValues.ema20 !== undefined ? formatPrice(lastValues.ema20) : undefined} color={INDICATOR_COLORS.ema20} hidden={hidden.ema20} onToggleHide={() => toggleHidden("ema20")} onSettings={() => setSettingsTarget("ema20")} onRemove={() => removeIndicator("ema20")} />
          )}
          {indicators.ema50 && (
            <IndicatorPill name={`EMA ${config.ema50}`} value={lastValues.ema50 !== undefined ? formatPrice(lastValues.ema50) : undefined} color={INDICATOR_COLORS.ema50} hidden={hidden.ema50} onToggleHide={() => toggleHidden("ema50")} onSettings={() => setSettingsTarget("ema50")} onRemove={() => removeIndicator("ema50")} />
          )}
          {indicators.ema200 && (
            <IndicatorPill name={`EMA ${config.ema200}`} value={lastValues.ema200 !== undefined ? formatPrice(lastValues.ema200) : undefined} color={INDICATOR_COLORS.ema200} hidden={hidden.ema200} onToggleHide={() => toggleHidden("ema200")} onSettings={() => setSettingsTarget("ema200")} onRemove={() => removeIndicator("ema200")} />
          )}
          {indicators.sma20 && (
            <IndicatorPill name={`SMA ${config.sma20}`} value={lastValues.sma20 !== undefined ? formatPrice(lastValues.sma20) : undefined} color={INDICATOR_COLORS.sma20} hidden={hidden.sma20} onToggleHide={() => toggleHidden("sma20")} onSettings={() => setSettingsTarget("sma20")} onRemove={() => removeIndicator("sma20")} />
          )}
          {indicators.sma50 && (
            <IndicatorPill name={`SMA ${config.sma50}`} value={lastValues.sma50 !== undefined ? formatPrice(lastValues.sma50) : undefined} color={INDICATOR_COLORS.sma50} hidden={hidden.sma50} onToggleHide={() => toggleHidden("sma50")} onSettings={() => setSettingsTarget("sma50")} onRemove={() => removeIndicator("sma50")} />
          )}
          {indicators.sma200 && (
            <IndicatorPill name={`SMA ${config.sma200}`} value={lastValues.sma200 !== undefined ? formatPrice(lastValues.sma200) : undefined} color={INDICATOR_COLORS.sma200} hidden={hidden.sma200} onToggleHide={() => toggleHidden("sma200")} onSettings={() => setSettingsTarget("sma200")} onRemove={() => removeIndicator("sma200")} />
          )}
          {indicators.supertrend && (
            <IndicatorPill name={`ST ${config.supertrendAtr}, ${config.supertrendFactor}`} value={undefined} color={INDICATOR_COLORS.supertrend} hidden={hidden.supertrend} onToggleHide={() => toggleHidden("supertrend")} onSettings={() => setSettingsTarget("supertrend")} onRemove={() => removeIndicator("supertrend")} />
          )}
          {indicators.bbands && (
            <IndicatorPill name={`BB ${config.bbandsLen}, ${config.bbandsMultiplier}`} value={undefined} color={INDICATOR_COLORS.bbands} hidden={hidden.bbands} onToggleHide={() => toggleHidden("bbands")} onSettings={() => setSettingsTarget("bbands")} onRemove={() => removeIndicator("bbands")} />
          )}
          {indicators.vwap && (
            <IndicatorPill name="VWAP" value={lastValues.vwap !== undefined ? formatPrice(lastValues.vwap) : undefined} color={INDICATOR_COLORS.vwap} hidden={hidden.vwap} onToggleHide={() => toggleHidden("vwap")} onSettings={() => setSettingsTarget("vwap")} onRemove={() => removeIndicator("vwap")} />
          )}
          {indicators.volume && (
            <IndicatorPill name="Vol" value={lastValues.volume !== undefined ? formatVolume(lastValues.volume) : undefined} color={INDICATOR_COLORS.volume} hidden={hidden.volume} onToggleHide={() => toggleHidden("volume")} onSettings={() => setSettingsTarget("volume")} onRemove={() => removeIndicator("volume")} />
          )}
          {indicators.bos && (
            <IndicatorPill name={`BOS (${config.bosLen})`} value={undefined} color={INDICATOR_COLORS.bos} hidden={hidden.bos} onToggleHide={() => toggleHidden("bos")} onSettings={() => setSettingsTarget("bos")} onRemove={() => removeIndicator("bos")} />
          )}
          {indicators.patterns && (
            <IndicatorPill name="Patrones" value={undefined} color={INDICATOR_COLORS.patterns} hidden={hidden.patterns} onToggleHide={() => toggleHidden("patterns")} onSettings={() => setSettingsTarget("patterns")} onRemove={() => removeIndicator("patterns")} />
          )}
          {indicators.trendcross && (
            <IndicatorPill name="Cambio tendencia ✕" value={undefined} color={INDICATOR_COLORS.trendcross} hidden={hidden.trendcross} onToggleHide={() => toggleHidden("trendcross")} onSettings={() => setSettingsTarget("trendcross")} onRemove={() => removeIndicator("trendcross")} />
          )}
        </div>
      </div>

      {/* ── Subpane pills ── */}
      {indicators.rsi && paneOffsets[rsiPaneIdx] && (
        <div style={{ top: paneOffsets[rsiPaneIdx].top + 6, left: 12 }} className="pointer-events-none absolute z-10">
          <IndicatorPill name={`RSI ${config.rsi}`} value={lastValues.rsi !== undefined ? lastValues.rsi.toFixed(2) : undefined} color={INDICATOR_COLORS.rsi} hidden={hidden.rsi} onToggleHide={() => toggleHidden("rsi")} onSettings={() => setSettingsTarget("rsi")} onRemove={() => removeIndicator("rsi")} />
        </div>
      )}

      {indicators.macd && paneOffsets[macdPaneIdx] && (
        <div style={{ top: paneOffsets[macdPaneIdx].top + 6, left: 12 }} className="pointer-events-none absolute z-10">
          <IndicatorPill
            name={`MACD ${config.macdFast}, ${config.macdSlow}, ${config.macdSignal}`}
            value={lastValues.macd !== undefined ? `${lastValues.macd.toFixed(2)} / ${(lastValues.macdSignal ?? 0).toFixed(2)}` : undefined}
            color={INDICATOR_COLORS.macd} hidden={hidden.macd} onToggleHide={() => toggleHidden("macd")} onSettings={() => setSettingsTarget("macd")} onRemove={() => removeIndicator("macd")} />
        </div>
      )}

      {indicators.stochrsi && paneOffsets[srPaneIdx] && (
        <div style={{ top: paneOffsets[srPaneIdx].top + 6, left: 12 }} className="pointer-events-none absolute z-10">
          <IndicatorPill
            name={`StochRSI ${config.stochRsiLen}`}
            value={lastValues.stochRsiK !== undefined ? `K:${lastValues.stochRsiK.toFixed(1)} D:${(lastValues.stochRsiD ?? 0).toFixed(1)}` : undefined}
            color={INDICATOR_COLORS.stochrsi} hidden={hidden.stochrsi} onToggleHide={() => toggleHidden("stochrsi")} onSettings={() => setSettingsTarget("stochrsi")} onRemove={() => removeIndicator("stochrsi")} />
        </div>
      )}

      {indicators.adx && paneOffsets[adxPaneIdx] && (
        <div style={{ top: paneOffsets[adxPaneIdx].top + 6, left: 12 }} className="pointer-events-none absolute z-10">
          <IndicatorPill
            name={`ADX ${config.adxLen}`}
            value={lastValues.adx !== undefined ? `ADX:${lastValues.adx.toFixed(1)} +DI:${(lastValues.diPlus ?? 0).toFixed(1)} -DI:${(lastValues.diMinus ?? 0).toFixed(1)}` : undefined}
            color={INDICATOR_COLORS.adx} hidden={hidden.adx} onToggleHide={() => toggleHidden("adx")} onSettings={() => setSettingsTarget("adx")} onRemove={() => removeIndicator("adx")} />
        </div>
      )}

      {indicators.cvd && paneOffsets[cvdPaneIdx] && (
        <div style={{ top: paneOffsets[cvdPaneIdx].top + 6, left: 12 }} className="pointer-events-none absolute z-10">
          <IndicatorPill
            name={`CVD EMA(${config.cvdEmaLen})`}
            value={lastValues.cvd !== undefined ? formatVolume(lastValues.cvd) : undefined}
            color={INDICATOR_COLORS.cvd} hidden={hidden.cvd} onToggleHide={() => toggleHidden("cvd")} onSettings={() => setSettingsTarget("cvd")} onRemove={() => removeIndicator("cvd")} />
        </div>
      )}

      {indicators.atr && paneOffsets[atrPaneIdx] && (
        <div style={{ top: paneOffsets[atrPaneIdx].top + 6, left: 12 }} className="pointer-events-none absolute z-10">
          <IndicatorPill
            name={`ATR ${config.atrLen}`}
            value={lastValues.atr !== undefined ? lastValues.atr.toFixed(2) : undefined}
            color={INDICATOR_COLORS.atr} hidden={hidden.atr} onToggleHide={() => toggleHidden("atr")} onSettings={() => setSettingsTarget("atr")} onRemove={() => removeIndicator("atr")} />
        </div>
      )}

      {indicators.chop && paneOffsets[chopPaneIdx] && (
        <div style={{ top: paneOffsets[chopPaneIdx].top + 6, left: 12 }} className="pointer-events-none absolute z-10">
          <IndicatorPill
            name={`CHOP ${config.chopLen}`}
            value={lastValues.chop !== undefined ? lastValues.chop.toFixed(1) : undefined}
            color={INDICATOR_COLORS.chop} hidden={hidden.chop} onToggleHide={() => toggleHidden("chop")} onSettings={() => setSettingsTarget("chop")} onRemove={() => removeIndicator("chop")} />
        </div>
      )}

      {/* ── Trend Alert Toast ── */}
      <TrendAlertToast alerts={activeAlerts} onDismiss={dismiss} />

      {/* ── Trend Meter overlay ── */}
      {indicators.trendmeter && trendResult && paneOffsets[0] && (
        <div
          style={{ top: (paneOffsets[0]?.top ?? 0) + 12, right: 60 }}
          className="pointer-events-none absolute z-10"
        >
          <div className={`flex flex-col gap-1 rounded border px-3 py-2 text-xs backdrop-blur-sm ${
            trendResult.direction === "bull"
              ? "border-tv-green/40 bg-tv-green/10"
              : trendResult.direction === "bear"
              ? "border-tv-red/40 bg-tv-red/10"
              : "border-tv-text-muted/40 bg-tv-text-muted/10"
          }`}>
            {/* Título + veredicto */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-tv-text-muted">Tendencia</span>
              <span className={`font-bold tracking-wide ${
                trendResult.direction === "bull" ? "text-tv-green"
                : trendResult.direction === "bear" ? "text-tv-red"
                : "text-tv-yellow"
              }`}>
                {trendResult.direction === "bull" ? "▲ ALCISTA"
                  : trendResult.direction === "bear" ? "▼ BAJISTA"
                  : "◆ NEUTRAL"}
              </span>
            </div>
            {/* Barra de fuerza — 6 segmentos */}
            <div className="flex items-center gap-1">
              {[-2, -1, 0, 1, 2, 3].map((i) => {
                const filled =
                  trendResult.direction === "bull"
                    ? trendResult.score >= i + 4
                    : trendResult.direction === "bear"
                    ? trendResult.score <= i - 4
                    : false;
                const color =
                  trendResult.direction === "bull" ? "#26a69a"
                  : trendResult.direction === "bear" ? "#ef5350"
                  : "#787b86";
                return (
                  <div
                    key={i}
                    style={{ backgroundColor: filled ? color : `${color}33`, width: 12, height: 6, borderRadius: 2 }}
                  />
                );
              })}
            </div>
            {/* Señales individuales */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
              {[
                { label: "Precio/EMA20", v: trendResult.signals.vsEma20 },
                { label: "Precio/EMA50", v: trendResult.signals.vsEma50 },
                { label: "EMA9/EMA21",   v: trendResult.signals.emaFastCross },
                { label: "Supertrend",   v: trendResult.signals.supertrend },
                { label: "MACD Hist",    v: trendResult.signals.macdHist },
                { label: `RSI ${trendResult.rsiValue.toFixed(1)}`, v: trendResult.signals.rsiLevel },
              ].map(({ label, v }) => (
                <div key={label} className="flex items-center gap-1">
                  <span style={{ color: v === 1 ? "#26a69a" : "#ef5350" }}>{v === 1 ? "▲" : "▼"}</span>
                  <span className="text-tv-text-muted">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
