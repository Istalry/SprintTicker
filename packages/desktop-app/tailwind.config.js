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
      // The redesign's greys (Documentation/design-history/Redesign-2026-11.md
      // §5). Colour is for meaning only: green is running, amber is paused or
      // waiting on you, red is danger. Everything else is grey -- there is no
      // blue or purple token, so a class naming one renders nothing, and the
      // grep in REDESIGN-PLAN.md §7 finds it.
      colors: {
        dark: {
          950: '#0A0A0B',
          900: '#0F0F10',
          800: '#18181A',
          700: '#232326',
          // Hover over a raised surface, one step lighter than the selection.
          600: '#323237'
        },
        border: {
          dark: '#2E2E33',
          // A field's edge -- inputs, selects, textareas only: 3.4:1 on the
          // cards, where the quiet border was 1.3:1 and an empty field all
          // but vanished (REVIEW-2026-11 A12, WCAG 1.4.11).
          field: '#6B6B73'
        },
        // A primary button: light grey, with dark text (text-dark-900).
        primary: '#E4E4E7',
        // Selection and focus: a grey fill and a light outline.
        select: '#2A2A2E',
        focus: '#D4D4D8',
        accent: {
          green: '#22C55E',
          amber: '#F59E0B',
          // Red text, borders and icons: 4.5:1 or more on every surface,
          // tints and the selection included. #EF4444 read 3.8-4.3 there
          // (REVIEW-2026-11 A7).
          red: '#F87171',
          // A danger button's fill, under white text (4.8:1), and its hover.
          'red-fill': '#DC2626',
          'red-fill-hover': '#B91C1C'
        },
        text: {
          primary: '#EDEDEF',
          secondary: '#A1A1A8',
          // 4.5:1 on the selection and on a hover (REVIEW-2026-11 A8).
          muted: '#9A9AA2'
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};
