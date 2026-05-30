"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Timeframe } from "@/lib/binance/types";

export type IndicatorKey =
  | "ema20"
  | "ema50"
  | "ema200"
  | "ema9"
  | "ema21"
  | "sma20"
  | "sma50"
  | "sma200"
  | "rsi"
  | "macd"
  | "volume"
  | "supertrend"
  | "bbands"
  | "vwap"
  | "stochrsi"
  | "adx"
  | "cvd"
  | "atr"
  | "chop"
  | "bos"
  | "patterns"
  | "trendmeter";

export type DrawingTool = "cursor" | "hline" | "measure" | "eraser";

export interface PriceLine {
  id: string;
  symbol: string;
  price: number;
}

export interface AlertConfig {
  enabled: boolean;
  sound: boolean;
  browser: boolean;
  telegram: boolean;
  minScore: number; // 3 | 4 | 5
}

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  enabled: true,
  sound: true,
  browser: false,
  telegram: true,
  minScore: 4,
};

export interface IndicatorConfig {
  ema20: number;
  ema50: number;
  ema200: number;
  ema9: number;
  ema21: number;
  sma20: number;
  sma50: number;
  sma200: number;
  rsi: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  supertrendAtr: number;
  supertrendFactor: number;
  bbandsLen: number;
  bbandsMultiplier: number;
  stochRsiLen: number;
  stochRsiK: number;
  stochRsiD: number;
  adxLen: number;
  atrLen: number;
  cvdEmaLen: number;
  chopLen: number;
  bosLen: number;
}

type EmaKey = Extract<IndicatorKey, "ema9" | "ema21" | "ema20" | "ema50" | "ema200">;
type SmaKey = Extract<IndicatorKey, "sma20" | "sma50" | "sma200">;

const EMA_KEYS: EmaKey[] = ["ema9", "ema21", "ema20", "ema50", "ema200"];
const SMA_KEYS: SmaKey[] = ["sma20", "sma50", "sma200"];

interface TfEmaPreset {
  show: Record<EmaKey, boolean>;
  emaConfig: Pick<IndicatorConfig, EmaKey>;
  smaShow: Record<SmaKey, boolean>;
  smaConfig: Pick<IndicatorConfig, SmaKey>;
}

export const DEFAULT_CONFIG: IndicatorConfig = {
  ema20: 20,
  ema50: 50,
  ema200: 200,
  ema9: 9,
  ema21: 21,
  sma20: 20,
  sma50: 50,
  sma200: 200,
  rsi: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  supertrendAtr: 10,
  supertrendFactor: 3,
  bbandsLen: 20,
  bbandsMultiplier: 2,
  stochRsiLen: 14,
  stochRsiK: 3,
  stochRsiD: 3,
  adxLen: 14,
  atrLen: 14,
  cvdEmaLen: 14,
  chopLen: 14,
  bosLen: 5,
};

// Criterio profesional por categoría de temporalidad:
//   Scalp     (1m·3m·5m)     → EMA 9, 21, 50          | SMA 9, 20
//   Intraday  (15m·30m·1h)   → EMA 9, 21, 50, 100, 200 | SMA 50, 100, 200
//   Swing     (4h·1d)        → EMA 12, 26, 50, 200     | SMA 50, 100, 200 (Golden/Death Cross)
//   Posicional(1w·1M)        → EMA 21, 55, 200         | SMA 20, 50, 200 (domina en macro)
// Los slots sma20/sma50/sma200 reutilizan su período igual que los slots EMA.
const TF_EMA_PRESETS: Partial<Record<string, TfEmaPreset>> = {
  // ── Scalp ──────────────────────────────────────────────────────────────────
  "1m":  { show: { ema9: true,  ema21: true,  ema20: false, ema50: true,  ema200: false }, emaConfig: { ema9: 9,  ema21: 21, ema20: 20,  ema50: 50,  ema200: 200 }, smaShow: { sma20: true,  sma50: true,  sma200: false }, smaConfig: { sma20: 9,  sma50: 20,  sma200: 200 } },
  "3m":  { show: { ema9: true,  ema21: true,  ema20: false, ema50: true,  ema200: false }, emaConfig: { ema9: 9,  ema21: 21, ema20: 20,  ema50: 50,  ema200: 200 }, smaShow: { sma20: true,  sma50: true,  sma200: false }, smaConfig: { sma20: 9,  sma50: 20,  sma200: 200 } },
  "5m":  { show: { ema9: true,  ema21: true,  ema20: false, ema50: true,  ema200: false }, emaConfig: { ema9: 9,  ema21: 21, ema20: 20,  ema50: 50,  ema200: 200 }, smaShow: { sma20: true,  sma50: true,  sma200: false }, smaConfig: { sma20: 9,  sma50: 20,  sma200: 200 } },
  // ── Intraday ───────────────────────────────────────────────────────────────
  "15m": { show: { ema9: true,  ema21: true,  ema20: true,  ema50: true,  ema200: true  }, emaConfig: { ema9: 9,  ema21: 21, ema20: 100, ema50: 50,  ema200: 200 }, smaShow: { sma20: true,  sma50: true,  sma200: true  }, smaConfig: { sma20: 100, sma50: 50,  sma200: 200 } },
  "30m": { show: { ema9: true,  ema21: true,  ema20: true,  ema50: true,  ema200: true  }, emaConfig: { ema9: 9,  ema21: 21, ema20: 100, ema50: 50,  ema200: 200 }, smaShow: { sma20: true,  sma50: true,  sma200: true  }, smaConfig: { sma20: 100, sma50: 50,  sma200: 200 } },
  "1h":  { show: { ema9: true,  ema21: true,  ema20: true,  ema50: true,  ema200: true  }, emaConfig: { ema9: 9,  ema21: 21, ema20: 100, ema50: 50,  ema200: 200 }, smaShow: { sma20: true,  sma50: true,  sma200: true  }, smaConfig: { sma20: 100, sma50: 50,  sma200: 200 } },
  // ── Swing ──────────────────────────────────────────────────────────────────
  "4h":  { show: { ema9: true,  ema21: false, ema20: true,  ema50: true,  ema200: true  }, emaConfig: { ema9: 12, ema21: 21, ema20: 26,  ema50: 50,  ema200: 200 }, smaShow: { sma20: true,  sma50: true,  sma200: true  }, smaConfig: { sma20: 100, sma50: 50,  sma200: 200 } },
  "1d":  { show: { ema9: true,  ema21: false, ema20: true,  ema50: true,  ema200: true  }, emaConfig: { ema9: 12, ema21: 21, ema20: 26,  ema50: 50,  ema200: 200 }, smaShow: { sma20: true,  sma50: true,  sma200: true  }, smaConfig: { sma20: 100, sma50: 50,  sma200: 200 } },
  // ── Posicional ─────────────────────────────────────────────────────────────
  "1w":  { show: { ema9: false, ema21: true,  ema20: true,  ema50: true,  ema200: true  }, emaConfig: { ema9: 9,  ema21: 21, ema20: 55,  ema50: 50,  ema200: 200 }, smaShow: { sma20: true,  sma50: true,  sma200: true  }, smaConfig: { sma20: 20,  sma50: 50,  sma200: 200 } },
  "1M":  { show: { ema9: false, ema21: true,  ema20: false, ema50: true,  ema200: true  }, emaConfig: { ema9: 9,  ema21: 21, ema20: 55,  ema50: 50,  ema200: 200 }, smaShow: { sma20: true,  sma50: true,  sma200: true  }, smaConfig: { sma20: 20,  sma50: 50,  sma200: 200 } },
};

export const INDICATOR_COLORS: Record<IndicatorKey, string> = {
  ema20: "#ffb74d",
  ema50: "#2962ff",
  ema200: "#ab47bc",
  ema9: "#26c6da",
  ema21: "#66bb6a",
  sma20: "#ff9800",
  sma50: "#00bcd4",
  sma200: "#e91e63",
  rsi: "#ab47bc",
  macd: "#2962ff",
  volume: "#787b86",
  supertrend: "#26a69a",
  bbands: "#9575cd",
  vwap: "#ff9800",
  stochrsi: "#26c6da",
  adx: "#ef5350",
  cvd: "#26a69a",
  atr: "#ffb74d",
  chop: "#ab47bc",
  bos: "#26a69a",
  patterns: "#ffb74d",
  trendmeter: "#2962ff",
};

export const DEFAULT_WATCHLIST = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "MATICUSDT",
];

function makeDefaultRecord<T>(val: T): Record<IndicatorKey, T> {
  return {
    ema20: val, ema50: val, ema200: val, ema9: val, ema21: val,
    sma20: val, sma50: val, sma200: val,
    rsi: val, macd: val, volume: val,
    supertrend: val, bbands: val, vwap: val,
    stochrsi: val, adx: val, cvd: val, atr: val, chop: val,
    bos: val, patterns: val, trendmeter: val,
  };
}

interface ChartState {
  symbol: string;
  timeframe: Timeframe;
  indicators: Record<IndicatorKey, boolean>;
  hidden: Record<IndicatorKey, boolean>;
  config: IndicatorConfig;
  watchlist: string[];

  alertConfig: AlertConfig;

  multiMode: boolean;
  multiTimeframes: [Timeframe, Timeframe, Timeframe, Timeframe];

  tool: DrawingTool;
  priceLines: PriceLine[];
  symbolDialogOpen: boolean;
  settingsTarget: IndicatorKey | null;

  setSymbol: (s: string) => void;
  setAlertConfig: (patch: Partial<AlertConfig>) => void;
  setTimeframe: (t: Timeframe) => void;
  toggleIndicator: (key: IndicatorKey) => void;
  removeIndicator: (key: IndicatorKey) => void;
  toggleHidden: (key: IndicatorKey) => void;
  setConfig: (patch: Partial<IndicatorConfig>) => void;
  addToWatchlist: (s: string) => void;
  removeFromWatchlist: (s: string) => void;
  setTool: (t: DrawingTool) => void;
  addPriceLine: (price: number, symbol: string) => void;
  clearPriceLines: (symbol?: string) => void;
  setSymbolDialogOpen: (v: boolean) => void;
  setSettingsTarget: (k: IndicatorKey | null) => void;
  setMultiMode: (v: boolean) => void;
  setMultiTimeframe: (idx: number, tf: Timeframe) => void;
}

export const useChartStore = create<ChartState>()(
  persist(
    (set) => ({
      symbol: "BTCUSDT",
      timeframe: "15m" as Timeframe,
      indicators: {
        ...makeDefaultRecord(false),
        ema9: true,
        ema21: true,
        ema50: true,
        ema200: true,
        rsi: true,
        volume: true,
      },
      hidden: makeDefaultRecord(false),
      config: { ...DEFAULT_CONFIG },
      watchlist: DEFAULT_WATCHLIST,
      alertConfig: { ...DEFAULT_ALERT_CONFIG },
      multiMode: false,
      multiTimeframes: ["1m", "5m", "1h", "4h"] as [Timeframe, Timeframe, Timeframe, Timeframe],
      tool: "cursor",
      priceLines: [],
      symbolDialogOpen: false,
      settingsTarget: null,

      setSymbol: (symbol) => set({ symbol }),
      setAlertConfig: (patch) =>
        set((s) => ({ alertConfig: { ...s.alertConfig, ...patch } })),
      setTimeframe: (timeframe) =>
        set((s) => {
          const preset = TF_EMA_PRESETS[timeframe];
          if (!preset) return { timeframe };
          const indicators = { ...s.indicators };
          const hidden = { ...s.hidden };
          EMA_KEYS.forEach((key) => {
            indicators[key] = preset.show[key];
            if (preset.show[key]) hidden[key] = false;
          });
          SMA_KEYS.forEach((key) => {
            indicators[key] = preset.smaShow[key];
            if (preset.smaShow[key]) hidden[key] = false;
          });
          const config = { ...s.config, ...preset.emaConfig, ...preset.smaConfig };
          return { timeframe, indicators, hidden, config };
        }),
      toggleIndicator: (key) =>
        set((s) => ({
          indicators: { ...s.indicators, [key]: !s.indicators[key] },
          hidden: !s.indicators[key]
            ? { ...s.hidden, [key]: false }
            : s.hidden,
        })),
      removeIndicator: (key) =>
        set((s) => ({
          indicators: { ...s.indicators, [key]: false },
          hidden: { ...s.hidden, [key]: false },
        })),
      toggleHidden: (key) =>
        set((s) => ({ hidden: { ...s.hidden, [key]: !s.hidden[key] } })),
      setConfig: (patch) =>
        set((s) => ({ config: { ...s.config, ...patch } })),
      addToWatchlist: (s) =>
        set((state) => ({
          watchlist: state.watchlist.includes(s)
            ? state.watchlist
            : [...state.watchlist, s],
        })),
      removeFromWatchlist: (s) =>
        set((state) => ({
          watchlist: state.watchlist.filter((x) => x !== s),
        })),
      setTool: (tool) => set({ tool }),
      addPriceLine: (price, symbol) =>
        set((state) => ({
          priceLines: [
            ...state.priceLines,
            {
              id:
                typeof crypto !== "undefined" && "randomUUID" in crypto
                  ? crypto.randomUUID()
                  : `${Date.now()}-${Math.random()}`,
              symbol,
              price,
            },
          ],
        })),
      clearPriceLines: (symbol) =>
        set((state) => ({
          priceLines: symbol
            ? state.priceLines.filter((p) => p.symbol !== symbol)
            : [],
        })),
      setSymbolDialogOpen: (symbolDialogOpen) => set({ symbolDialogOpen }),
      setSettingsTarget: (settingsTarget) => set({ settingsTarget }),
      setMultiMode: (multiMode) => set({ multiMode }),
      setMultiTimeframe: (idx, tf) =>
        set((s) => {
          const next = [...s.multiTimeframes] as [Timeframe, Timeframe, Timeframe, Timeframe];
          next[idx] = tf;
          return { multiTimeframes: next };
        }),
    }),
    {
      name: "tv-gratis-chart-state",
      partialize: (s) => ({
        symbol: s.symbol,
        timeframe: s.timeframe,
        indicators: s.indicators,
        hidden: s.hidden,
        config: s.config,
        watchlist: s.watchlist,
        alertConfig: s.alertConfig,
        multiMode: s.multiMode,
        multiTimeframes: s.multiTimeframes,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ChartState>;
        return {
          ...current,
          ...p,
          config: { ...current.config, ...(p.config ?? {}) },
          alertConfig: { ...current.alertConfig, ...(p.alertConfig ?? {}) },
        };
      },
    },
  ),
);
