import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        border: 'var(--border)',
        primary: {
          DEFAULT: '#06B6D4', // Electric Cyan
          foreground: '#0B0F17',
          hover: '#0891B2',
        },
        secondary: {
          DEFAULT: '#6366F1', // Vivid Indigo
          foreground: '#FFFFFF',
        },
        accent: {
          DEFAULT: '#10B981', // Emerald Active
          foreground: '#FFFFFF',
        },
        destructive: {
          DEFAULT: '#EF4444', // Danger / Suspended
          foreground: '#FFFFFF',
        },
        warning: {
          DEFAULT: '#F59E0B', // Expiring / Grace
          foreground: '#0B0F17',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
