# TradingView Gratis 📈

> **Una alternativa open-source y 100% gratis a TradingView Pro, pensada para LATAM.**
> Velas en vivo, indicadores propios, watchlist, multi-timeframe — sin pagar USD, sin login, sin ads.

Plataforma de charts crypto construida sobre los datos públicos de **Binance** (WebSocket) y la misma librería de render que usa TradingView ([`lightweight-charts`](https://github.com/tradingview/lightweight-charts)).

---

## ✨ Features

- 📊 **Velas en vivo** vía WebSocket de Binance (sin API key)
- 🔍 **Búsqueda de símbolo** sobre todos los pares USDT del exchange
- ⏱️ **Multi-timeframe**: 1m / 5m / 15m / 1h / 4h / 1d / 1w
- 📐 **Indicadores client-side**: EMA 20/50/200, RSI 14, MACD 12/26/9, Volumen
- 👁️ **Watchlist** con precios y cambio 24h actualizándose en tiempo real
- 🎨 **Visual idéntica a TradingView** (paleta, fuentes, layout)
- 💾 **Persistencia** en localStorage (símbolo, timeframe, indicadores)
- 🔌 **Reconexión robusta** del WebSocket con backoff exponencial
- 🌐 100% client-side — deploy estático en GitHub Pages / Vercel / Cloudflare

## 🚀 Empezar

```bash
npm install
npm run dev
```

Abrí [http://localhost:3000](http://localhost:3000).

## 🛠️ Stack

| Capa | Tech |
|---|---|
| Framework | Next.js 16 (App Router) |
| Lenguaje | TypeScript |
| Estilos | Tailwind CSS 4 + shadcn/ui |
| Charts | [lightweight-charts](https://github.com/tradingview/lightweight-charts) v5 |
| Estado | Zustand (con persistencia) |
| Iconos | lucide-react |
| Datos | Binance Public REST + WebSocket |

## 📐 Arquitectura

```
src/
├── app/
│   ├── layout.tsx          # Root, fuente Inter, TooltipProvider, dark
│   ├── page.tsx            # Dashboard armando el layout
│   └── globals.css         # Paleta TradingView
├── components/
│   ├── chart/
│   │   ├── PriceChart.tsx     # Chart core (lightweight-charts + panes)
│   │   ├── SymbolSelector.tsx # Búsqueda de pares USDT
│   │   ├── TimeframeSelector.tsx
│   │   └── IndicatorMenu.tsx  # Toggle EMA/RSI/MACD/Volume
│   ├── layout/
│   │   ├── Header.tsx
│   │   ├── LeftSidebar.tsx    # Iconos drawing tools (visual)
│   │   ├── RightSidebar.tsx
│   │   └── BottomPanel.tsx    # Stats 24h
│   ├── watchlist/
│   │   └── Watchlist.tsx      # Precios live multi-símbolo
│   └── ui/                    # shadcn primitives
└── lib/
    ├── binance/
    │   ├── rest.ts            # klines / ticker / exchangeInfo
    │   ├── ws.ts              # WS multiplex + auto-reconnect
    │   └── types.ts
    ├── indicators/
    │   └── index.ts           # SMA, EMA, RSI (Wilder), MACD
    ├── store/
    │   └── chart-store.ts     # Zustand global state
    └── format.ts              # formatPrice / formatPct / formatVolume
```

## 🌐 Deploy

### GitHub Pages (automático)

La app se despliega automáticamente en cada push a `master` vía GitHub Actions.

**URL pública:** [https://ruiz-jose.github.io/tradingview-gratis/](https://ruiz-jose.github.io/tradingview-gratis/)

Configuración incluida en el repo:
- `.github/workflows/deploy.yml` — build + deploy automático
- `next.config.ts` — `output: export`, `basePath`, `trailingSlash`, `images.unoptimized`

> **Setup inicial del repo (una sola vez):**
> `Settings → Pages → Source → GitHub Actions`
> `Settings → Environments → github-pages → Deployment branches → agregar master`

### Build estático local

```bash
npm run build   # genera la carpeta out/
```

### Vercel

```bash
npm i -g vercel
vercel
```

O conectá el repo en [vercel.com/new](https://vercel.com/new). No hay variables de entorno — todo es cliente.

## 🧠 Cómo funciona

### Datos históricos
Al abrir un símbolo se hace un `GET /api/v3/klines` (REST) que trae las últimas **1000 velas** del par + timeframe activo. Se renderizan instantáneamente.

### Datos en vivo
Una única conexión WebSocket multiplexada (`stream.binance.com`) recibe:
- `<symbol>@kline_<interval>` → updates de la vela actual + cierre de velas
- `<symbol>@miniTicker` → tickers del watchlist

Al reconectarse (Binance corta el WS cada 24h) se vuelven a suscribir todos los streams activos con backoff exponencial.

### Indicadores
Se calculan **client-side** sobre el array de velas en cada update. Implementaciones puras de TypeScript:
- `EMA`: seeded con SMA del primer período, luego `close * k + prev * (1-k)`
- `RSI`: Wilder (suavizado exponencial sobre ganancias/pérdidas, período 14)
- `MACD`: EMA(12) − EMA(26), signal = EMA(9) sobre MACD line

Para 1000 velas y panes múltiples el costo es despreciable.

## 🧪 Suite de Validación Profesional de Estrategias

El proyecto incluye una suite completa de herramientas para validar la estrategia **MTF Short Entry** con las mismas técnicas que usan los traders cuantitativos profesionales.

> **Requisito:** Node.js 18+ en el PATH (o usar la ruta directa al ejecutable).

### Estrategia validada

**MTF Short Entry** — entrada en corto con filtro multi-timeframe:
- **Filtro HTF:** 1h + 4h + 1w + 1M todos con TrendMeter ≤ −4/6 (bear)
- **Retroceso en 15m:** precio en mitad superior del rango, rango ≥ 0.8%
- **Mínimo 2 de 3 confirmaciones:** ChoCh · RSI cross bajista · patrón de vela
- **Risk management:** SL = máx. pullback × 1.003 · TP1 = mín. swing · TP2 = R:R 1:2

### Scripts disponibles

| Comando | Script | Qué hace |
|---|---|---|
| `npm run backtest:mtf` | `backtest-mtf-short.mjs` | Backtest base con reporte detallado |
| `npm run validate:mc` | `validate-monte-carlo.mjs` | Monte Carlo + significancia estadística |
| `npm run validate:wf` | `validate-walk-forward.mjs` | Walk-Forward Analysis (detección de overfitting) |
| `npm run validate:ms` | `validate-multi-symbol.mjs` | Validación cross-asset (6 pares) |
| `npm run validate:sens` | `validate-sensitivity.mjs` | Sensibilidad de parámetros |
| `npm run validate:all` | `validate-all.mjs` | Suite completa + scorecard final |

### Uso rápido

```bash
# Backtest base (ajustar N para más historia)
node scripts/backtest-mtf-short.mjs BTCUSDT 5000

# Suite completa (~10–15 min, recomendado en bear market conocido)
node scripts/validate-all.mjs BTCUSDT 5000
```

> **Nota:** la estrategia es exclusivamente bajista. Para obtener trades necesitás un período donde los 4 timeframes HTF estén alineados en bear. Ejemplo con datos históricos:
> ```bash
> # Bear market 2022 (~150 días con señales)
> node scripts/backtest-mtf-short.mjs BTCUSDT 15000
> ```

---

### Módulo 1 — Backtest Base

```bash
node scripts/backtest-mtf-short.mjs [SYMBOL] [N_VELAS_15M]
# Ejemplo: node scripts/backtest-mtf-short.mjs BTCUSDT 5000
```

**Outputs:** tabla de operaciones, win rate, profit factor, retorno total, max drawdown, duración promedio, desglose por confirmaciones (2 vs 3 de 3).

---

### Módulo 2 — Monte Carlo + Significancia Estadística

```bash
node scripts/validate-monte-carlo.mjs [SYMBOL] [N_15M] [N_SIMULACIONES]
# Ejemplo: node scripts/validate-monte-carlo.mjs BTCUSDT 5000 10000
```

**Técnicas aplicadas:**

| Técnica | Qué mide |
|---|---|
| Test binomial exacto | ¿Es el win rate estadísticamente superior al azar? (H₀: WR = 50%) |
| Intervalo de confianza Wilson 95% | Rango real del win rate con N trades |
| Monte Carlo shuffle (10 000 iter.) | Distribución del Max Drawdown esperado en percentiles |
| Riesgo de ruina | Probabilidad de que el equity caiga por debajo del 50% |
| Sharpe / Sortino / Calmar anualizados | Rendimiento ajustado al riesgo |
| R-múltiples | Expectativa real por unidad de riesgo asumido |
| Análisis de rachas | Racha perdedora máxima real vs percentil 95 por Monte Carlo |

**Outputs clave:**
- `p-value` del test binomial y Z-score vs azar
- Distribución del Max Drawdown: percentiles 5/25/50/75/95
- Riesgo de ruina en %
- Sharpe y Sortino anualizados
- Recomendación de tamaño máximo de posición

---

### Módulo 3 — Walk-Forward Analysis

```bash
node scripts/validate-walk-forward.mjs [SYMBOL] [N_15M] [K_FOLDS]
# Ejemplo: node scripts/validate-walk-forward.mjs BTCUSDT 8000 5
```

Divide el histórico en **K ventanas temporales iguales** y evalúa el rendimiento en cada una por separado. Si el edge es real, cada ventana debería mostrar resultados positivos.

**Detecta:** overfitting temporal (la estrategia funcionó solo en un período específico del mercado).

**Outputs:**
- Tabla de resultados por fold (trades, WR, PF, retorno, DD)
- Análisis de consistencia: % de folds rentables, dispersión del WR entre períodos
- Diagnóstico automático: Robusto / Moderado / Overfitting

---

### Módulo 4 — Validación Multi-Símbolo

```bash
node scripts/validate-multi-symbol.mjs [N_15M] [SYMBOL1 SYMBOL2 ...]
# Ejemplo: node scripts/validate-multi-symbol.mjs 3000
# Ejemplo: node scripts/validate-multi-symbol.mjs 3000 BTCUSDT ETHUSDT SOLUSDT
```

Prueba la **misma estrategia sin cambiar ningún parámetro** en los 6 principales pares USDT (BTC, ETH, BNB, SOL, XRP, ADA por defecto).

**Detecta:** overfitting a un solo activo (si funciona solo en BTC, el edge no es generalizable).

**Outputs:**
- Tabla comparativa por símbolo (trades, WR, PF, retorno, Sharpe, EV)
- Métricas agregadas de todos los activos combinados
- Matriz de correlación de P&L entre activos (¿señales independientes?)
- Diagnóstico de generalización

---

### Módulo 5 — Sensibilidad de Parámetros

```bash
node scripts/validate-sensitivity.mjs [SYMBOL] [N_15M] [PARAM]
# PARAM: rsi | range | lookback | sl | confirms | all
# Ejemplo: node scripts/validate-sensitivity.mjs BTCUSDT 5000 all
# Ejemplo: node scripts/validate-sensitivity.mjs BTCUSDT 5000 rsi
```

Varía cada parámetro de la estrategia en un rango y mide cómo cambia el rendimiento.

| Parámetro | Rango evaluado | Default |
|---|---|---|
| `rsiThreshold` | 58, 62, 65, 68, 72 | 65 |
| `rangeMin` | 0.4%, 0.6%, 0.8%, 1.0%, 1.2% | 0.8% |
| `lookback` | 20, 25, 30, 35, 40 velas | 30 |
| `slBuffer` | 0.1%, 0.2%, 0.3%, 0.5% | 0.3% |
| `minConfirms` | 2, 3 de 3 | 2 |

**Detecta:** overfitting fino (si el edge colapsa al cambiar un parámetro en ±1 paso, los resultados del backtest son frágiles).

**Outputs:**
- Tabla de PF/WR/retorno por valor de parámetro
- Grid 2D de RSI × Range (la combinación más crítica)
- Score de robustez 0–100 por parámetro
- Score global de robustez

---

### Módulo 6 — Suite Completa con Scorecard

```bash
node scripts/validate-all.mjs [SYMBOL] [N_15M]
# Ejemplo: node scripts/validate-all.mjs BTCUSDT 5000
```

Ejecuta los 5 módulos anteriores en secuencia y genera un **scorecard final en 5 dimensiones**:

| Dimensión | Métrica | Thresholds |
|---|---|---|
| Rentabilidad | Profit Factor | ★★★ ≥ 2.0 · ★★ ≥ 1.5 · ★ ≥ 1.0 |
| Calidad del edge | EV por trade | ★★★ > 0.5% · ★★ > 0.2% · ★ > 0% |
| Control del riesgo | Calmar ratio | ★★★ ≥ 2 · ★★ ≥ 1 · ★ ≥ 0.5 |
| Rendimiento ajustado | Sharpe anualizado | ★★★ ≥ 1.0 · ★★ ≥ 0.5 · ★ ≥ 0.2 |
| Validez estadística | 1 − p-value | ★★★ p < 0.05 · ★★ p < 0.10 · ★ p < 0.20 |

**Veredicto final:**
- 🏆 **≥ 80%** — Estrategia sólida, apta para capital real
- ⚠️ **55–79%** — Prometedora, requiere validación adicional
- 🚫 **< 55%** — Insuficiente, revisar condiciones de entrada

**Tiempo estimado:** 10–20 min (depende de N_15M y la conexión a Binance).

---

### Archivo compartido

`scripts/lib-backtest.mjs` — Motor core reutilizado por todos los módulos. Exporta los indicadores, el simulador parametrizado, el fetcher de Binance y `calcMetrics()`. Importarlo directamente si querés construir tus propios scripts de análisis.

---

## ⚠️ Qué NO incluye (todavía)

- ❌ Pine Script (propietario de TradingView, no se puede clonar)
- ❌ Drawing tools persistentes (Fibo, trend lines arrastrables)
- ❌ Replay bar-by-bar
- ❌ Alertas server-side (siguiente video de la serie)
- ❌ Trading real (bot con API privada — video 4)

## 📺 Serie de videos

Este repo es la base de la serie **"TradingView Gratis"**:

1. ✅ **Video 1 — Base**: lo que ves acá
2. 🔜 **Video 2 — Alertas**: Supabase + Telegram bot
3. 🔜 **Video 3 — Indicadores AI**: SuperTrend, Ichimoku, custom con Claude
4. 🔜 **Video 4 — Bot que opera**: API privada Binance + ejecución

## 📄 Licencia

MIT — usalo, forkealo, monetizalo, lo que quieras.

`lightweight-charts` es Apache 2.0 con atribución a TradingView — la atribución vive en el footer/UI por requerimiento de la licencia.
