/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/web/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#060a14', 900: '#0a1020', 850: '#0e1529', 800: '#121a31', 700: '#1a2440', 600: '#25314f', 500: '#3a4766' },
        gold: { 300: '#ecd58f', 400: '#dcbc63', 500: '#c9a43f', 600: '#a8862c' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Barlow Condensed"', 'Inter', 'sans-serif'],
      },
      keyframes: {
        pulseGold: { '0%,100%': { boxShadow: '0 0 0 0 rgba(220,188,99,0.0)' }, '50%': { boxShadow: '0 0 0 6px rgba(220,188,99,0.18)' } },
        flash: { '0%': { backgroundColor: 'rgba(220,188,99,0.25)' }, '100%': { backgroundColor: 'transparent' } },
        slideIn: { '0%': { transform: 'translateY(8px)', opacity: 0 }, '100%': { transform: 'none', opacity: 1 } },
      },
      animation: { pulseGold: 'pulseGold 1.6s ease-in-out infinite', flash: 'flash 1.2s ease-out', slideIn: 'slideIn .2s ease-out' },
    },
  },
  plugins: [],
}
