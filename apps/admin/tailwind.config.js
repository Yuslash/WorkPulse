/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Plus Jakarta Sans carries body text and UI chrome; Bricolage
        // Grotesque (font-display) is reserved for headings and the big
        // display numbers, matching the source design's pairing.
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Bricolage Grotesque"', '"Plus Jakarta Sans"', 'ui-sans-serif', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        elevated: 'rgb(var(--elevated) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        'border-strong': 'rgb(var(--border-strong) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        faint: 'rgb(var(--faint) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-fg': 'rgb(var(--accent-fg) / <alpha-value>)',
        'viz-1': 'rgb(var(--viz-1) / <alpha-value>)',
        'viz-2': 'rgb(var(--viz-2) / <alpha-value>)',
        'viz-3': 'rgb(var(--viz-3) / <alpha-value>)',
        'viz-4': 'rgb(var(--viz-4) / <alpha-value>)',
        active: 'rgb(var(--active) / <alpha-value>)',
        idle: 'rgb(var(--idle) / <alpha-value>)',
        locked: 'rgb(var(--locked) / <alpha-value>)',
        offline: 'rgb(var(--offline) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        DEFAULT: '0.375rem',
        // The source design's radius scale: the outer app frame, cards, the
        // smaller "sub" panels nested inside them, and small chips.
        app: '40px',
        card: '26px',
        sub: '18px',
        chip: '14px',
      },
      boxShadow: {
        // Theme-responsive shadows that adapt seamlessly between warm parchment and deep obsidian
        'warm-sm': 'var(--shadow-sm, 0 2px 8px -2px rgba(60, 52, 44, 0.10))',
        'warm-md': 'var(--shadow-md, 0 14px 34px -16px rgba(60, 52, 44, 0.20))',
        'warm-app': 'var(--shadow-app, 0 46px 90px -44px rgba(60, 52, 44, 0.32))',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(2px)' },
          to: { opacity: '1', transform: 'none' },
        },
        rise: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'none' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-9px)' },
        },
        grow: {
          from: { transform: 'scaleY(.05)' },
          to: { transform: 'scaleY(1)' },
        },
      },
      animation: {
        'pulse-dot': 'pulse-dot 2s ease-in-out infinite',
        'fade-in': 'fade-in 140ms ease-out',
        rise: 'rise 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
        float: 'float 4s ease-in-out infinite',
        grow: 'grow 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};
