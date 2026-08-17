import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = join(root, 'public')
const fontFile = 'C:/Windows/Fonts/segoeuib.ttf'

function render(svgName, outName, size) {
  const svg = readFileSync(join(publicDir, svgName))
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    font: {
      fontFiles: [fontFile],
      loadSystemFonts: true,
      defaultFontFamily: 'Segoe UI',
    },
  })
  writeFileSync(join(publicDir, outName), resvg.render().asPng())
}

render('koolmovez-mark.svg', 'pwa-192.png', 192)
render('koolmovez-mark.svg', 'pwa-512.png', 512)
render('koolmovez-mark.svg', 'apple-touch-icon.png', 180)
render('koolmovez-mark.svg', 'favicon-32.png', 32)
render('koolmovez-mark-maskable.svg', 'pwa-512-maskable.png', 512)

console.log('Wrote PWA icons to public/')
