'use client';

import { FC, useEffect, useMemo, useRef } from 'react';
import DrawChart from 'chart.js/auto';
import { TotalList } from '@gitroom/frontend/components/analytics/stars.and.forks.interface';
import { chunk } from 'lodash';
import useCookie from 'react-use-cookie';
import { cssVar, withAlpha } from './chart.theme';

function mergeDataPoints(data: TotalList[], numPoints: number): TotalList[] {
  const res = chunk(data, Math.ceil(data.length / numPoints));
  return res.map((row) => {
    return {
      date: `${row[0].date} - ${row?.at(-1)?.date}`,
      total: row.reduce((acc, curr) => acc + curr.total, 0),
    };
  });
}

export const ChartSocial: FC<{
  data: TotalList[];
  color?: 'primary' | 'green' | 'blue';
}> = (props) => {
  const { data, color = 'primary' } = props;
  const [mode] = useCookie('mode', 'dark');

  const list = useMemo(() => {
    const merged = data.length < 7 ? data : mergeDataPoints(data, 7);
    if (merged.length === 1) {
      return [
        // duplicating single datapoints metrics for chart to display a line on analytics
        merged[0],
        merged[0],
      ];
    }
    return merged;
  }, [data]);

  const ref = useRef<any>(null);
  const chart = useRef<null | DrawChart>(null);

  // The old 'purple' scheme was a leftover Postiz brand literal (#612BD3);
  // 'primary' resolves the live theme accent so charts follow the tokens.
  const accent = cssVar('--new-btn-primary', '#14b8a6');
  const colorSchemes = {
    primary: {
      start: withAlpha(accent, 0.8),
      end: withAlpha(accent, 0.1),
      border: accent,
    },
    green: {
      start: 'rgba(50, 213, 131, 0.8)',
      end: 'rgba(50, 213, 131, 0.1)',
      border: 'rgb(50, 213, 131)',
    },
    blue: {
      start: 'rgba(29, 155, 240, 0.8)',
      end: 'rgba(29, 155, 240, 0.1)',
      border: 'rgb(29, 155, 240)',
    },
  };

  const colors = colorSchemes[color];

  useEffect(() => {
    const ctx = ref.current.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, ref.current.height);
    gradient.addColorStop(0, colors.start);
    gradient.addColorStop(1, colors.end);

    chart.current = new DrawChart(ref.current!, {
      type: 'line',
      options: {
        maintainAspectRatio: false,
        responsive: true,
        animation: {
          duration: 750,
          easing: 'easeOutQuart',
        },
        interaction: {
          mode: 'index',
          intersect: false,
        },
        layout: {
          padding: {
            left: 0,
            right: 0,
            top: 4,
            bottom: 0,
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            display: false,
          },
          x: {
            display: false,
            ticks: {
              stepSize: 10,
              maxTicksLimit: 7,
            },
          },
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            enabled: true,
            backgroundColor: cssVar('--new-bgColorInner', '#fff'),
            titleColor: cssVar('--new-btn-text', '#000'),
            bodyColor: cssVar('--new-table-text', '#777'),
            borderColor: cssVar('--new-table-border', '#e7e9eb'),
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            displayColors: false,
            titleFont: {
              size: 12,
              weight: 'normal',
            },
            bodyFont: {
              size: 14,
              weight: 'bold',
            },
          },
        },
      },
      data: {
        labels: list.map((row) => row.date),
        datasets: [
          {
            borderColor: colors.border,
            borderWidth: 2,
            label: 'Total',
            backgroundColor: gradient,
            fill: true,
            data: list.map((row) => row.total),
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: colors.border,
            pointHoverBorderColor: cssVar('--new-bgColorInner', '#fff'),
            pointHoverBorderWidth: 2,
          },
        ],
      },
    });
    return () => {
      chart?.current?.destroy();
    };
    // Re-run on `mode` so resolved tokens are re-read after a theme flip,
    // and on `list` so new data redraws.
  }, [mode, list]);

  return <canvas className="w-full h-full" ref={ref} />;
};
