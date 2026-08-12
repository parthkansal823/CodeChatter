module.exports = {
  plugins: {
    // Tailwind 4 moved its PostCSS plugin into its own package, and folded
    // vendor prefixing in — autoprefixer is no longer needed here.
    "@tailwindcss/postcss": {},
  },
};
