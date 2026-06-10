# Guía de Uso — TradingView Gratis

## Inicio rápido

```bash
npm install
npm run dev
```

Abrí el navegador en `http://localhost:3000`

---

## Pantalla principal

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚡ TradingView Gratis  │ BTCUSDT ▾ │ 1M 5M [15M] 1H 4H 1D 1W │ ⊞4 │ Indicadores 5 │          🔔 Alertas │ </> │ ▣ │
├──┬──────────────────────────────────────────────────────────────┤
│  │  BTCUSDT · 15M · Binance                    [TENDENCIA ▼ BAJISTA] │
│ ↕│  61,234  -0.20%                                              │
│  │  • EMA 9   61,580                                            │
│🖊│  • EMA 21  61,736           GRÁFICO DE VELAS                 │
│─ │  • EMA 50  61,764                                            │
│📏│                                                              │
│🗑│                                                              │
├──┴──────────────────────────────────────────────────────────────┤
│                    PANEL INFERIOR                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. Cambiar el par / símbolo

Hacé click en **BTCUSDT ▾** en el header.

- Aparece un buscador: escribí el ticker (ej. `ETH`, `SOL`, `BNB`)
- El gráfico cambia inmediatamente con datos de Binance
- La watchlist del panel derecho muestra todos tus pares seguidos

> **Importante:** Las señales automáticas de la estrategia MTF solo monitorizan **BTCUSDT**, independientemente del par que estés viendo en el gráfico.

---

## 2. Cambiar el timeframe

Los botones en el header: `1M · 5M · 15M · 1H · 4H · 1D · 1W`

El botón activo aparece resaltado en azul.

| Timeframe | Uso recomendado |
|-----------|----------------|
| 15M | Timeframe de ejecución de la estrategia (señales de entrada) |
| 1H | Filtro de tendencia nivel 1 |
| 4H | Filtro de tendencia nivel 2 |
| 1D | Visión de swing trading |
| 1W | Tendencia macro |

---

## 3. Vista multi-panel (4 timeframes a la vez)

Hacé click en el ícono **⊞ 4** del header.

Muestra simultáneamente: **15M · 1H · 4H · 1D** — cada panel con sus indicadores preconfigurados para esa temporalidad. Ideal para verificar el contexto HTF antes de entrar.

Para volver al modo de un solo gráfico, hacé click en **⊞ 4** de nuevo.

---

## 4. Indicadores

### Activar / desactivar

Click en **Indicadores** (header) → menú desplegable con todos los disponibles.

Los que están activos muestran un check azul. Click para togglear on/off.

| Grupo | Indicadores disponibles |
|-------|------------------------|
| Medias móviles | EMA 9, EMA 21, EMA 20, EMA 50, EMA 200 · SMA 20, SMA 50, SMA 200 |
| Tendencia | Supertrend · Bollinger Bands |
| Volumen | Volumen · VWAP · CVD |
| Osciladores | RSI · Stoch RSI · MACD |
| Tendencia/Fuerza | ADX · Choppiness |
| Volatilidad | ATR |
| Señales | BOS · Patrones de vela · **Trend Meter** · Cambio de tendencia ✕ |

### Modificar parámetros

Cada indicador activo aparece como una **pill** (etiqueta) en la esquina superior izquierda del gráfico.

- Click en el ícono ⚙️ de la pill → abre diálogo de configuración (cambiar períodos, multiplicadores)
- Click en el ícono 👁️ → oculta/muestra sin desactivar
- Click en la ✕ → elimina el indicador

### Ocultar / mostrar sin eliminar

Click en el icono del ojo en cada pill del indicador.

---

## 5. Trend Meter (semáforo de tendencia)

Activalo desde **Indicadores → Señales → Trend Meter**.

Aparece un widget en la esquina superior derecha del gráfico:

```
┌──────────────────────────────┐
│  TENDENCIA  ▼ BAJISTA        │
│  ■ ■ ■ ■ ■ □  (fuerza)      │
│  ▼ Precio/EMA20              │
│  ▼ Precio/EMA50              │
│  ▼ EMA9/EMA21                │
│  ▲ Supertrend                │
│  ▼ MACD Hist                 │
│  ▼ RSI 37.8                  │
└──────────────────────────────┘
```

**Cómo leer el widget:**

- **▲ ALCISTA** (verde) → 4 o más señales positivas
- **▼ BAJISTA** (rojo) → 4 o más señales negativas
- **◆ NEUTRAL** (amarillo) → señales mixtas, sin tendencia clara
- La barra de 6 segmentos muestra la fuerza: más segmentos llenos = tendencia más fuerte

**Para operar con la estrategia**, el TrendMeter del gráfico de 15M debería coincidir con el contexto que muestran 1H, 4H, 1W.

---

## 6. Herramientas de dibujo (barra izquierda)

| Ícono | Herramienta | Cómo se usa |
|-------|------------|-------------|
| ↖ | Cursor (navegación) | Por defecto. Click y arrastrá para mover el gráfico |
| — | Línea horizontal | Click en el gráfico → dibuja una línea de precio. Útil para marcar soportes/resistencias |
| 📏 | Regla / Medir | Click en punto A → click en punto B → muestra Δ precio, %, cantidad de barras y volumen del rango |
| 🗑 | Borrar dibujos | Elimina todas las líneas del símbolo actual |

> Las herramientas **Línea de tendencia**, **Fibonacci** y **Texto** están bloqueadas (próximamente).

---

## 7. Watchlist (panel derecho)

Click en el ícono **▣** (esquina derecha del header) para abrir/cerrar.

- Muestra precio actual y cambio 24h de cada par, actualizados en tiempo real
- Click en un símbolo → carga ese gráfico
- Click en **+** → abre el buscador para agregar un par
- Hover sobre una fila → aparece una ✕ para quitarlo de la lista

---

## 8. Alertas de tendencia

Click en **🔔 Alertas** (header).

```
┌─────────────────────────────┐
│  ALERTAS DE TENDENCIA       │
│  ○─ Activar alertas    [ON] │
│     Sonido             [ON] │
│     Notificación nav.  [ON] │
│     Telegram           [OFF]│
│     Mín. señales    [3][4][5]│
└─────────────────────────────┘
```

| Opción | Qué hace |
|--------|---------|
| **Activar alertas** | Master switch — desactivarlo silencia todo |
| **Sonido** | Toca notas descendentes (SHORT) o ascendentes (LONG) cuando detecta señal |
| **Notificación del navegador** | Muestra popup del sistema operativo (requiere dar permiso la primera vez) |
| **Telegram** | Envía el mensaje detallado al bot configurado en `.env.local` |
| **Mín. señales** | Umbral del TrendMeter para alertas de cambio de tendencia: **3** = más sensible, **5** = solo señales muy fuertes |

### Configurar Telegram (opcional)

1. Creá un bot en Telegram hablando con `@BotFather` → guardá el token
2. Obtené tu Chat ID hablando con `@userinfobot`
3. Creá el archivo `.env.local` en la raíz del proyecto:

```
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
TELEGRAM_CHAT_ID=-100123456789
```

4. Reiniciá el servidor (`npm run dev`)
5. Activá el toggle **Telegram** en el panel de Alertas

---

## 9. Señales automáticas de la estrategia MTF

La app monitoriza **BTCUSDT** en segundo plano **cada 15 minutos**, buscando setups de la estrategia MTF Pullback.

**No necesitás hacer nada** — las señales se disparan solas cuando se cumplen las condiciones.

### Cuando hay señal SHORT o LONG:

1. Suena una alerta de audio (si está activada)
2. Aparece una notificación del navegador con precio, SL y TP2
3. El trade se registra automáticamente en el journal
4. Se envía el mensaje a Telegram (si está configurado)

### Condiciones para que se dispare una señal:

**Para SHORT:**
- TrendMeter bajista (-4/6 o más) en 1H, 4H, 1W y 1M (todos deben coincidir)
- Retroceso alcista activo en 15M (precio en mitad superior del rango)
- Al menos 2 de estas 3 confirmaciones, siendo RSI obligatorio:
  - RSI cruzó desde sobrecompra (>65) y ahora declina
  - ChoCh: precio cerró por debajo del mínimo de estructura
  - Patrón de vela: Bearish Engulfing o Shooting Star

**Para LONG:** simétricas pero inversas (sobreventa <35, precio en mitad inferior, patrones alcistas).

> El motor tiene un **cooldown de 4 horas** — no genera señales repetidas del mismo tipo en menos tiempo.

---

## 10. Diario de trades (journal)

Navegá a `http://localhost:3000/trades` o usá el enlace en el panel inferior.

```
┌─────────────────────────────────────────────────────┐
│  Diario de Trades                    ← Volver       │
│  Paper trading — MTF Pullback Strategy               │
├──────────┬──────────┬──────────┬──────────────────┤
│ TRADES   │ WIN RATE │  PROFIT  │  P&L ACUMULADO   │
│ CERRADOS │          │  FACTOR  │                  │
│    12    │  58.3%   │   2.41   │    +14.20%       │
│ 3 abiert.│  7W / 5L │  -fees   │  sobre 12 trades │
└──────────┴──────────┴──────────┴──────────────────┘

│ Símbolo │ Dir   │ Entrada  │ Precio     │ SL         │ TP1        │ R:R │ Conf.         │ Estado │ P&L    │
│ BTCUSDT │ SHORT │ 10/6 14h │ $61,750.00 │ $61,935.25 │ $61,200.00 │ 2×  │ RSI ChoCh Vel │ Abierto│  —     │
│ BTCUSDT │ LONG  │ 8/6 09h  │ $60,320.00 │ $60,139.00 │ $61,100.00 │ 2×  │ RSI ChoCh     │ TP1    │ +1.28% │
```

### Columnas de la tabla

| Columna | Descripción |
|---------|-------------|
| Dir | LONG (verde) o SHORT (rojo) |
| Precio | Precio de entrada |
| SL | Stop Loss calculado automáticamente |
| TP1 | Take Profit 1 (objetivo principal) |
| R:R | Relación riesgo:recompensa hacia TP2 |
| Confirmaciones | Badges de qué señales se cumplieron: RSI · ChoCh · Vela |
| Estado | Abierto / TP1 / TP2 / SL / manual |
| P&L | Resultado en % descontando 0.2% de comisiones |

### Cerrar un trade manualmente

1. En la fila del trade abierto, click en **Cerrar**
2. Ingresá el precio de cierre
3. Elegí el motivo: **TP1**, **SL** o **manual**

El monitor automático ya revisa SL y TP1 cada minuto — solo necesitás el cierre manual si querés salir en un precio diferente (por ejemplo, en TP2 o por criterio propio).

---

## 11. Flujo de trabajo recomendado

### Sesión de análisis diario

```
1. Abrí la app en 15M con Trend Meter activo
2. Activá la vista multi-panel (⊞4) para ver el contexto de 1H, 4H, 1D
3. Verificá la dirección del TrendMeter en cada timeframe
4. Si todos los HTF apuntan en la misma dirección → favorable para señal
5. Volvé al modo single panel, esperá la señal automática del motor MTF
```

### Cuando llega una señal

```
1. La notificación te avisa con precio entrada, SL y TP
2. Abrí el journal (/trades) para ver los niveles exactos
3. Revisá las confirmaciones que se cumplieron (RSI, ChoCh, patrón)
4. Decidí si aceptás la señal o la descartás según tu criterio
5. Si la tomás: ponés las órdenes en tu exchange (esto es paper trading)
6. El monitor cierra el trade en el journal cuando toca SL o TP1
```

---

## 12. Limitaciones actuales

| Limitación | Detalle |
|-----------|---------|
| Solo BTCUSDT en señales | El motor MTF monitoriza únicamente BTC, aunque el gráfico puede mostrar cualquier par |
| No ejecuta órdenes reales | Es 100% paper trading — el journal registra señales pero no conecta con ningún exchange |
| 1M (mensual) no seleccionable | El timeframe mensual se usa internamente para el filtro HTF pero no aparece en el selector de gráfico |
| Telegram requiere configuración | Sin `.env.local` las alertas Telegram fallan silenciosamente |
| Journal local | Los trades se guardan en `data/trades.json` — no hay sincronización ni backup automático |
| Sin líneas de tendencia ni Fibonacci | Esas herramientas de dibujo aparecen bloqueadas en la barra lateral |
