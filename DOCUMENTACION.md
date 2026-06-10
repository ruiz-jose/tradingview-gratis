# TradingView Gratis — Documentación de la App

## ¿Qué es esta app?

Clon open-source de TradingView enfocado en **cripto (Binance)**. Muestra gráficos de velas en tiempo real con indicadores técnicos y ejecuta una **estrategia automatizada multi-timeframe (MTF)** que detecta señales de entrada LONG y SHORT en BTCUSDT, alertando al usuario por sonido, notificación de browser y Telegram.

No ejecuta órdenes reales: opera en modo **paper trading** — registra las señales en un journal local con seguimiento de SL/TP.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 16 (App Router) |
| UI | React 19 + Tailwind CSS 4 + shadcn/ui |
| Gráficos | lightweight-charts v5 |
| Estado global | Zustand |
| Datos de mercado | Binance REST API + WebSocket |
| Notificaciones | Web Audio API · Browser Notifications · Telegram Bot |
| Persistencia | JSON en `data/trades.json` vía API Routes |

---

## Cómo ejecutar la app

```bash
# Instalar dependencias
npm install

# Variables de entorno opcionales (solo para Telegram)
# Crear .env.local con:
# TELEGRAM_BOT_TOKEN=...
# TELEGRAM_CHAT_ID=...

# Modo desarrollo
npm run dev
# → http://localhost:3000

# Producción
npm run build && npm start
```

### Scripts de backtesting

```bash
npm run backtest           # Backtest básico (BTCUSDT)
npm run backtest:mtf       # Backtest estrategia MTF SHORT
npm run validate:all       # Validaciones completas (Monte Carlo, Walk-Forward, Multi-Symbol)
npm run check-trend        # Verificar TrendMeter actual
```

---

## Flujo de ejecución completo

```
Usuario abre http://localhost:3000
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  page.tsx  →  PriceChart + MultiChartGrid               │
│  Layout: Header / LeftSidebar / RightSidebar (watchlist)│
│             / BottomPanel (journal de trades)           │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  CARGA INICIAL  (PriceChart.tsx)                        │
│                                                         │
│  1. fetchKlines(symbol, timeframe, 1000)                │
│     → GET https://api.binance.com/api/v3/klines         │
│     → 1000 velas históricas en el TF seleccionado       │
│                                                         │
│  2. Calcula todos los indicadores sobre el histórico:   │
│     EMA, SMA, RSI, MACD, ATR, Supertrend,              │
│     Bollinger Bands, VWAP, StochRSI, ADX, CVD, Chop    │
│                                                         │
│  3. Renderiza el gráfico (lightweight-charts)           │
│     + Marcadores BOS / Patrones / TrendCross            │
│     + Widget TrendMeter (esquina superior derecha)      │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  TIEMPO REAL  (BinanceWS — singleton por tab)           │
│                                                         │
│  Conexión:  wss://stream.binance.com:9443/stream        │
│  Streams:   <symbol>@kline_<tf>  +  @miniTicker         │
│  Auto-reconexión exponencial (1s → 30s máx)            │
│                                                         │
│  Por cada nueva vela que llega:                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Actualizar array de velas en memoria             │  │
│  │ candleSeries.update(vela)                        │  │
│  │ Recalcular TODOS los indicadores                 │  │
│  │ Actualizar precio live + pills de indicadores    │  │
│  └──────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────┘
                       │
           ┌───────────┴───────────┐
           ▼                       ▼
┌──────────────────┐   ┌───────────────────────────────┐
│  TREND ALERTS    │   │  MTF SIGNAL ENGINE             │
│  (useTrendAlerts)│   │  (useMtfShortSignal +          │
│                  │   │   useMtfLongSignal)            │
│  Monitorea       │   │                                │
│  TrendMeter del  │   │  Check cada 15 minutos         │
│  TF visible      │   │  Cooldown 4 horas por símbolo  │
│                  │   │                                │
│  Si cambia de    │   │  Fetch en paralelo:            │
│  bull→bear o     │   │  · 500 velas 15m               │
│  viceversa →     │   │  · 200 velas 1h                │
│  Toast en UI     │   │  · 200 velas 4h                │
│                  │   │  · 100 velas 1w                │
│  Cooldown:       │   │  · 60  velas 1M                │
│  4m (1m) a 48h  │   │                                │
│  (1M)            │   │  detectShortEntry() /          │
│                  │   │  detectLongEntry()             │
└──────────────────┘   └───────────────┬───────────────┘
                                       │
                          ¿Señal válida?
                          /            \
                        NO              SÍ
                        │               │
                      (fin)             ▼
                              ┌─────────────────────┐
                              │  ALERT PIPELINE      │
                              │                      │
                              │  1. Sonido (Web Audio│
                              │     API) — notas     │
                              │     descendentes/    │
                              │     ascendentes      │
                              │                      │
                              │  2. Browser          │
                              │     Notification     │
                              │     (si permiso)     │
                              │                      │
                              │  3. POST /api/trades │
                              │     → data/trades.json│
                              │     status: "open"   │
                              │                      │
                              │  4. POST /api/telegram│
                              │     → Bot Telegram   │
                              └──────────┬───────────┘
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │  TRADE MONITOR       │
                              │  (useTradeMonitor)   │
                              │                      │
                              │  Poll cada 60s:      │
                              │  Precio actual via   │
                              │  Binance ticker      │
                              │                      │
                              │  ¿Tocó SL o TP1?    │
                              │  → PATCH /api/trades │
                              │    status: "closed"  │
                              │    pnlPct calculado  │
                              │  → Telegram: resultado│
                              └─────────────────────┘
```

---

## Estrategia MTF — Cómo detecta una señal

### Arquitectura de 3 capas

La estrategia opera igual para LONG y SHORT (simétricas). Se explica SHORT como ejemplo:

#### Capa 1 — Filtro HTF (Higher Time Frame)

Los 4 timeframes superiores deben ser **todos bajistas** (TrendMeter ≤ -4/6):

```
1H bajista  ┐
4H bajista  ├── Si alguno falla → señal descartada
1W bajista  │
1M bajista  ┘
```

**TrendMeter** es un score de -6 a +6 basado en 6 señales binarias:

| Señal | Bull (+1) | Bear (-1) |
|-------|-----------|-----------|
| Precio vs EMA20 | Precio > EMA20 | Precio < EMA20 |
| Precio vs EMA50 | Precio > EMA50 | Precio < EMA50 |
| EMA9 vs EMA21 | EMA9 > EMA21 | EMA9 < EMA21 |
| Supertrend | Dirección = +1 | Dirección = -1 |
| MACD Hist | Histograma ≥ 0 | Histograma < 0 |
| RSI | RSI > 50 | RSI < 50 |

- **Bull:** score ≥ +4  
- **Bear:** score ≤ -4  
- **Neutral:** entre -3 y +3

#### Capa 2 — Retroceso activo en 15m

```
Últimas 30 velas de 15m:
  recentHigh = máximo del período
  recentLow  = mínimo del período
  rango      = (recentHigh - recentLow) / recentLow

  ¿Rango < 0.8%?  → mercado lateral, descartar
  ¿Precio < mitad del rango? → caída libre, no es retroceso, descartar
  ¿Precio ≥ mitad? → retroceso alcista activo ✓
```

#### Capa 3 — Confirmaciones (mínimo 2 de 3, RSI obligatorio)

| # | Confirmación | Condición SHORT | Condición LONG |
|---|-------------|----------------|---------------|
| 1 | **RSI cross** *(obligatorio)* | Peak RSI >65 en últimas 5 velas y ahora declina | Peak RSI <35 y ahora sube |
| 2 | **ChoCh** | Cierre por debajo del mínimo de estructura del retroceso | Cierre por encima del máximo de estructura |
| 3 | **Patrón de vela** | Bearish Engulfing o Shooting Star | Bullish Engulfing o Hammer |

> El RSI es **obligatorio** (si falla, la señal se descarta aunque las otras dos sean válidas).  
> Resultado de backtest: **PF 3.82 con RSI vs 0.83 sin RSI**.

### Gestión de riesgo (calculada automáticamente)

| Nivel | SHORT | LONG |
|-------|-------|------|
| **Entry** | Precio actual de cierre 15m | Precio actual de cierre 15m |
| **Stop Loss** | `recentHigh × 1.003` (+0.3%) | `recentLow × 0.997` (−0.3%) |
| **TP1** | `recentLow` (mínimo del swing) | `recentHigh` (máximo del swing) |
| **TP2** | `entrada − (riesgo × 2)` — R:R 1:2 | `entrada + (riesgo × 2)` — R:R 1:2 |

---

## Datos históricos requeridos por la estrategia

| Timeframe | Velas | Tiempo cubierto |
|-----------|-------|----------------|
| 15m | 500 | ~5 días |
| 1h | 200 | ~8 días |
| 4h | 200 | ~33 días |
| 1w | 100 | ~2 años |
| 1M | 60 | ~5 años |

---

## Indicadores técnicos disponibles

| Indicador | Parámetros por defecto | Uso en la estrategia |
|-----------|----------------------|---------------------|
| EMA | 9, 21, 50, 200 | TrendMeter + niveles de soporte/resistencia |
| SMA | 20, 50, 200 | Tendencia macro (1W, 1M) |
| RSI | 14 (Wilder) | TrendMeter + confirmación de señal (obligatorio) |
| MACD | 12/26/9 | TrendMeter |
| ATR | 14 | Base del Supertrend |
| Supertrend | ATR=10, Factor=3 | TrendMeter (+1 bull / -1 bear) |
| Bollinger Bands | 20/2.0 | Visual, no en estrategia |
| VWAP | diario | Visual, soporte/resistencia |
| StochRSI | 14/3/3 | Visual, crossovers rápidos |
| ADX | 14 | Visual, fuerza de tendencia |
| CVD | EMA=14 | Visual, momentum institucional |
| Choppiness Index | 14 | Detecta mercados laterales |
| BOS | 5 pivotes | Marcadores de ruptura de estructura |
| Patrones de vela | — | Confirmación de entrada (#3) |

---

## Estructura de archivos clave

```
tradingview-gratis/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Página principal (layout raíz)
│   │   ├── trades/page.tsx             # Journal de paper trading
│   │   └── api/
│   │       ├── trades/route.ts         # GET/POST trades
│   │       ├── trades/[id]/route.ts    # PATCH → cerrar posición
│   │       └── telegram/route.ts       # Envío a bot Telegram
│   │
│   ├── components/
│   │   ├── chart/
│   │   │   ├── PriceChart.tsx          # Gráfico principal (lógica central)
│   │   │   ├── MultiChartGrid.tsx      # Vista multi-panel
│   │   │   ├── IndicatorPill.tsx       # Etiquetas de indicadores
│   │   │   ├── TrendAlertToast.tsx     # Toasts de cambio de tendencia
│   │   │   └── AlertSettingsButton.tsx # Configuración de alertas
│   │   └── layout/
│   │       ├── Header.tsx              # Barra superior (símbolo, TF)
│   │       ├── LeftSidebar.tsx         # Herramientas de dibujo
│   │       ├── RightSidebar.tsx        # Watchlist
│   │       └── BottomPanel.tsx         # Panel de trades abiertos
│   │
│   ├── hooks/
│   │   ├── useMtfShortSignal.ts        # Motor de señales SHORT (cada 15m)
│   │   ├── useMtfLongSignal.ts         # Motor de señales LONG (cada 15m)
│   │   ├── useTrendAlerts.ts           # Alertas de cambio de TrendMeter
│   │   ├── useTradeMonitor.ts          # Monitor SL/TP (cada 60s)
│   │   └── useTelegramAlerts.ts        # Alertas Telegram por TrendMeter
│   │
│   ├── lib/
│   │   ├── indicators/index.ts         # Todos los indicadores + detectLongEntry/detectShortEntry
│   │   ├── trade-logger.ts             # Persistencia JSON de trades
│   │   ├── store/chart-store.ts        # Estado global (Zustand)
│   │   └── binance/
│   │       ├── rest.ts                 # fetchKlines → API REST Binance
│   │       ├── ws.ts                   # BinanceWS singleton + auto-reconexión
│   │       └── types.ts                # Tipos Candle, Timeframe
│   │
│   └── scripts/
│       ├── backtest.mjs                # Backtest básico
│       ├── backtest-mtf-short.mjs      # Backtest estrategia MTF SHORT
│       ├── validate-monte-carlo.mjs    # Validación Monte Carlo
│       ├── validate-walk-forward.mjs   # Validación Walk-Forward
│       └── validate-multi-symbol.mjs  # Validación multi-símbolo
│
├── data/
│   └── trades.json                    # Journal de paper trading (generado en runtime)
│
└── .env.local                         # TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (opcional)
```

---

## Configuración de alertas

Accesible desde el botón de campana en el Header:

| Opción | Descripción | Defecto |
|--------|-------------|---------|
| `enabled` | Activa/desactiva todo el motor de señales | `true` |
| `sound` | Sonido audible (Web Audio API) | `true` |
| `browser` | Notificación de escritorio | `true` |
| `telegram` | Envío a bot Telegram | `false` |
| `minScore` | Score mínimo de TrendMeter para alertar | `4` |

---

## Indicadores por timeframe (presets)

| Timeframe | Indicadores activos por defecto |
|-----------|--------------------------------|
| 1m, 5m | EMA9, EMA21 |
| 15m, 30m, 1h | EMA9, EMA21, EMA50 |
| 4h | EMA50, EMA200, SMA50 |
| 1d | EMA50, EMA200, SMA50, SMA200 |
| 1w, 1M | SMA50, SMA200 |

---

## Formato del mensaje Telegram (SHORT)

```
🚨 SEÑAL SHORT MTF — BTCUSDT 🚨

📊 Filtro HTF (todos bajistas):
  • 1H: 5/6
  • 4H: 6/6
  • 1W: 5/6
  • 1M: 5/6

📈 Retroceso 15m detectado:
  • Rango: $41.200 → $41.800
  • Resistencia: EMA50 ($41.500)

✅ Confirmaciones (mín. 2/3):
  ✅ ChoCh — cierre bajo mínimo de estructura ($41.320)
  ✅ RSI(14) 68.5 — cruce bajista desde sobrecompra (>65)
  ✅ Patrón vela: Shooting Star

─────────────────────
💰 Entrada:    $41.750
🛑 Stop Loss:  $41.954
🎯 TP1:        $41.200
🎯 TP2 (1:2):  $40.342  (R:R 1:2)
─────────────────────
📉 Dirección: SHORT ▼
⚠️ No es asesoramiento financiero.
```

---

## Estructura de un trade en el journal

```json
{
  "id": "uuid-v4",
  "symbol": "BTCUSDT",
  "direction": "SHORT",
  "entryTime": "2026-06-10T14:32:00Z",
  "entryPrice": 41750.00,
  "stopLoss": 41954.25,
  "tp1": 41200.00,
  "tp2": 40342.00,
  "riskPct": 0.49,
  "confirmations": {
    "choch": true,
    "rsiCross": true,
    "candlePattern": true,
    "patternName": "shootingStar"
  },
  "htfScores": {
    "1h": -5,
    "4h": -6,
    "1w": -5,
    "1M": -5
  },
  "status": "closed",
  "closeTime": "2026-06-10T17:45:00Z",
  "closePrice": 41200.00,
  "closeReason": "TP1",
  "pnlPct": 1.12
}
```

> `pnlPct` incluye comisión estimada de 0.2% (0.1% entrada + 0.1% salida).

---

## Limitaciones conocidas

- Las señales MTF están **fijadas en BTCUSDT** (ver `PriceChart.tsx` línea 215-216). El gráfico puede mostrar cualquier par, pero el motor de señales solo monitorea BTC.
- El journal es local (`data/trades.json`). No hay base de datos ni autenticación.
- La app no ejecuta órdenes reales. La integración con Pionex (`src/lib/pionex/`) existe como módulo pero no está conectada al flujo de señales.
- Los datos de Binance llegan via WebSocket público (sin API key). Existe un rate limit implícito en las llamadas REST al verificar señales cada 15 minutos (5 llamadas simultáneas).
