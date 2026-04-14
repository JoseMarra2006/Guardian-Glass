/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        petro: {
          green: '#008542',
          yellow: '#FFD100',
          dark: '#012110',
          neon: '#39FF14' // Para o efeito de AR
        }
      }
    },
  },
  plugins: [],
}