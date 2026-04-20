/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        linkedin: {
          50:  '#eff6ff',
          100: '#dbeafe',
          500: '#0a66c2',
          600: '#004182',
          700: '#00294f',
        },
      },
    },
  },
  plugins: [],
};
