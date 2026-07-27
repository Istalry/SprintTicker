/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/index.html',
    './src/renderer/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          900: '#0D0F12',
          800: '#16191E',
          700: '#21262E'
        },
        border: {
          dark: '#2D3440'
        },
        accent: {
          green: '#10B981',
          amber: '#F59E0B',
          blue: '#3B82F6',
          red: '#EF4444',
          purple: '#8B5CF6'
        },
        text: {
          primary: '#F3F4F6',
          secondary: '#9CA3AF'
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
        sans: ['Inter', 'sans-serif']
      }
    }
  },
  plugins: []
};
