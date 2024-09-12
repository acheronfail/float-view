/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx,svelte}'],
  theme: {
    extend: {
      fontSize: {
        sm: '0.8rem',
      },
      screens: {
        wide: '640px',
      },
    },
  },
  plugins: [],
};
