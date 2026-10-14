import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#09090b',
        surface: {
          DEFAULT: '#121215',
          raised: '#18181b',
          overlay: '#222227',
          border: '#27272a',
        },
        primary: {
          DEFAULT: '#6366f1',
          hover: '#4f46e5',
          active: '#4338ca',
          foreground: '#ffffff',
        },
        status: {
          queued: '#a1a1aa',
          preparing: '#38bdf8',
          running: '#60a5fa',
          collecting: '#818cf8',
          completed: '#34d399',
          failed: '#f87171',
          cancelled: '#fbbf24',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'Menlo',
          'Monaco',
          'Consolas',
          '"Courier New"',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
