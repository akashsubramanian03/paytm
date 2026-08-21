/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Paytm's two brand blues: the deep navy of the wordmark and the cyan.
        navy: {
          DEFAULT: '#012B72',
          950: '#00194A',
          900: '#012B72',
          800: '#06398C',
          700: '#0B4BA8',
          600: '#1B5FC1',
          500: '#2D8FD8',
        },
        sky: {
          DEFAULT: '#00B9F1',
          600: '#00A3D6',
          200: '#9EE4FA',
          100: '#E1F5FE',
          50: '#F0FAFF',
        },
        canvas: '#EDF1F6',
        line: '#E7EDF4',
        ink: {
          DEFAULT: '#121826',
          muted: '#66707F',
          faint: '#98A2B3',
        },
        credit: '#0E9F6E',
        debit: '#E8442E',
        warn: '#B45309',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      maxWidth: { app: '460px' },
      borderRadius: { card: '14px', tile: '12px' },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.07)',
        lift: '0 4px 16px rgba(1,43,114,0.10)',
        fab: '0 6px 18px rgba(1,43,114,0.32)',
        bar: '0 -1px 12px rgba(16,24,40,0.07)',
      },
      backgroundImage: {
        'brand-bar': 'linear-gradient(102deg, #012B72 0%, #1B5FC1 58%, #2D8FD8 100%)',
        'brand-card': 'linear-gradient(135deg, #012B72 0%, #0B4BA8 55%, #1668C9 100%)',
      },
      keyframes: {
        'sheet-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(-8px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'pop-tick': {
          '0%': { transform: 'scale(0.4)', opacity: '0' },
          '60%': { transform: 'scale(1.08)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      animation: {
        'sheet-up': 'sheet-up 220ms cubic-bezier(0.32, 0.72, 0, 1)',
        'fade-in': 'fade-in 180ms ease-out',
        'toast-in': 'toast-in 200ms cubic-bezier(0.32, 0.72, 0, 1)',
        'pop-tick': 'pop-tick 420ms cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [],
};
