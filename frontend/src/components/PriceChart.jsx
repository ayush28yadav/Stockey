import { useEffect, useMemo, useRef } from 'react';
import { AreaSeries, CandlestickSeries, ColorType, createChart } from 'lightweight-charts';

export function PriceChart({ trades = [], price, theme, chartType = 'candlestick', timeframe = '1D', selectedSymbol }) {
  const host = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const lastFitKeyRef = useRef('');

  const chartOptions = useMemo(() => {
    const dark = theme === 'dark';
    return {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: dark ? '#85909b' : '#6b7280',
        fontFamily: 'DM Mono, ui-monospace, monospace',
        fontSize: 11
      },
      grid: {
        vertLines: { color: dark ? '#1e2228' : '#e6e8eb' },
        horzLines: { color: dark ? '#1e2228' : '#e6e8eb' }
      },
      rightPriceScale: { borderColor: dark ? '#2a2e34' : '#d9dde2' },
      timeScale: { borderColor: dark ? '#2a2e34' : '#d9dde2', timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { labelBackgroundColor: '#4b77d1' }, horzLine: { labelBackgroundColor: '#4b77d1' } }
    };
  }, [theme]);

  // Create chart instance
  useEffect(() => {
    if (!host.current) return undefined;
    const chart = createChart(host.current, chartOptions);
    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [chartOptions]);

  // Create or swap series based on chartType
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (seriesRef.current) {
      try {
        chart.removeSeries(seriesRef.current);
      } catch {
        // ignore if already removed
      }
      seriesRef.current = null;
    }

    if (chartType === 'line') {
      const dark = theme === 'dark';
      seriesRef.current = chart.addSeries(AreaSeries, {
        lineColor: '#4b77d1',
        topColor: dark ? 'rgba(75, 119, 209, 0.4)' : 'rgba(75, 119, 209, 0.25)',
        bottomColor: dark ? 'rgba(75, 119, 209, 0.0)' : 'rgba(75, 119, 209, 0.02)',
        lineWidth: 2
      });
    } else {
      seriesRef.current = chart.addSeries(CandlestickSeries, {
        upColor: '#19b34b',
        downColor: '#e55357',
        borderVisible: false,
        wickUpColor: '#19b34b',
        wickDownColor: '#e55357'
      });
    }
    // Force re-fit when series type changes
    lastFitKeyRef.current = '';
  }, [chartType, theme]);

  // Update data
  useEffect(() => {
    if (!seriesRef.current) return;

    const base = Number(price || trades[0]?.price || 100);

    // Map timeframe to seconds interval & candle count
    const intervalMap = {
      '1D': { seconds: 300, count: 40 },
      '5D': { seconds: 900, count: 50 },
      '1M': { seconds: 3600, count: 60 },
      '3M': { seconds: 14400, count: 60 },
      '6M': { seconds: 28800, count: 70 },
      'YTD': { seconds: 86400, count: 80 },
      '1Y': { seconds: 86400, count: 100 },
      'All': { seconds: 86400, count: 120 }
    };

    const { seconds: stepSeconds, count: minCandleCount } = intervalMap[timeframe] ?? intervalMap['1D'];
    const buckets = new Map();

    [...trades].reverse().forEach((trade) => {
      const tradeTime = Math.floor(new Date(trade.created_at ?? trade.executedAt ?? Date.now()).getTime() / 1000);
      const timestamp = Math.floor(tradeTime / stepSeconds) * stepSeconds;
      const value = Number(trade.price);
      if (!Number.isFinite(value)) return;

      const candle = buckets.get(timestamp) ?? { time: timestamp, open: value, high: -Infinity, low: Infinity, close: value };
      candle.high = Math.max(candle.high, value);
      candle.low = Math.min(candle.low, value);
      candle.close = value;
      buckets.set(timestamp, candle);
    });

    let rawCandles = [...buckets.values()].filter((candle) => Number.isFinite(candle.high));

    // Fill historical candles if data is sparse or to fulfill timeframe view
    const nowSec = Math.floor(Date.now() / 1000);
    if (rawCandles.length < minCandleCount) {
      let previous = base * 0.985;
      const generated = Array.from({ length: minCandleCount }, (_, index) => {
        const timeVal = Math.floor((nowSec - (minCandleCount - 1 - index) * stepSeconds) / stepSeconds) * stepSeconds;
        const existing = buckets.get(timeVal);
        if (existing) {
          previous = existing.close;
          return existing;
        }
        const cycle = Math.sin((index + (selectedSymbol?.charCodeAt(0) || 0)) * 0.28);
        const drift = cycle * base * 0.0035 + (index % 5 === 0 ? base * 0.002 : -base * 0.001);
        const close = Math.max(0.1, previous + drift);
        const high = Math.max(previous, close) + base * 0.0015;
        const low = Math.min(previous, close) - base * 0.0015;
        const candle = { time: timeVal, open: previous, high, low, close };
        previous = close;
        return candle;
      });

      // Deduplicate by time sorted ascending
      const timeMap = new Map();
      generated.forEach(c => timeMap.set(c.time, c));
      rawCandles.forEach(c => timeMap.set(c.time, c));
      rawCandles = [...timeMap.values()].sort((a, b) => a.time - b.time);
    }

    if (chartType === 'line') {
      const lineData = rawCandles.map((c) => ({ time: c.time, value: c.close }));
      seriesRef.current.setData(lineData);
    } else {
      seriesRef.current.setData(rawCandles);
    }

    // Only fit content on symbol, timeframe, or chartType change, NOT on every live trade tick
    const currentFitKey = `${selectedSymbol}-${timeframe}-${chartType}`;
    if (lastFitKeyRef.current !== currentFitKey) {
      chartRef.current?.timeScale().fitContent();
      lastFitKeyRef.current = currentFitKey;
    }
  }, [trades, price, timeframe, chartType, selectedSymbol]);

  return <div className="chart-host" ref={host} aria-label={`${timeframe} ${chartType} price chart`} />;
}
