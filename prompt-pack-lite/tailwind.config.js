/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'packer-blue': '#0069C3',
        'packer-grey': '#2A3947',
        'packer-border': '#E8EDF2',
        'packer-text-muted': '#5B6A78',
        'packer-white': '#FFFFFF',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'subtle': '0 1px 3px rgba(0,0,0,0.05)',
      }
    },
  },
  plugins: [],
}
