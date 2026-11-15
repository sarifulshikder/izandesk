// Tailwind CSS v4 uses CSS-first configuration via @theme in globals.css.
// This file is kept for reference but is not auto-loaded by v4.
// To use a JS config with v4, add `@config "../tailwind.config.ts";` to your CSS.

const config = {
  darkMode: 'class',
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: { DEFAULT: 'var(--card)', foreground: 'var(--card-foreground)' },
        border: 'var(--border)',
        primary: { DEFAULT: '#06B6D4', foreground: '#0B0F17', hover: '#0891B2' },
        secondary: { DEFAULT: '#6366F1', foreground: '#FFFFFF' },
        accent: { DEFAULT: '#10B981', foreground: '#FFFFFF' },
        destructive: { DEFAULT: '#EF4444', foreground: '#FFFFFF' },
        warning: { DEFAULT: '#F59E0B', foreground: '#0B0F17' },
        muted: { DEFAULT: 'var(--muted)', foreground: 'var(--muted-foreground)' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
