/* Префиксы -webkit- для WebKitGTK (Linux): без них, например, backdrop-filter там просто не работает.
   Какие движки поддерживаются — в "browserslist" в package.json */
export default {
  plugins: {
    autoprefixer: {},
  },
}
