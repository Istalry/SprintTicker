/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/index.html',
    './src/renderer/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      // Header tiers, in addition to Tailwind's defaults.
      //
      // The default breakpoints are page breakpoints and are the wrong ruler
      // for the top bar: at `2xl` (1536px) every header element is visible and
      // the LED matrix is squeezed to its 3px floor, which is the worst of both
      // choices. These four are derived from what the header's own contents
      // measure, so that each block appears only once there is room for it
      // *and* for a matrix of at least 4px dots.
      //
      // If you add or widen something in the header, re-derive these rather
      // than nudging them until it looks right.
      screens: {
        'hdr-sm': '1100px', // EOD label, device IP address
        'hdr-md': '1300px', // Setup Wizard label, "Ping:" label, canvas captions
        'hdr-lg': '1480px', // remote control pad
        'hdr-xl': '1720px'  // rear OLED preview, the word "Connected"
      },
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
