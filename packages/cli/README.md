# raisedline

Command-line tool for [Raisedline](https://github.com/lobojoel2003/Raisedline): turn charts,
SVG diagrams, scans and maps into tactile graphics, check them for touch readability, and
export PDF (swell paper), SVG, STL (3D printing), BRF (any braille embosser) and G-code
(BrailleRAP-compatible embossers).

```sh
raisedline chart rainfall.csv --type bar --title "Monthly rainfall" -f pdf,stl,brf
raisedline svg water-cycle.svg -o water-cycle.pdf
raisedline trace plant-cell.png --mode auto -o plant-cell.pdf
raisedline map campus.geojson -f pdf,brf
raisedline check campus.raisedline.json --strict   # exit 1 on problems
raisedline braille "Hello world" --grade2          # needs liblouis
raisedline serve                                   # the web app on http://127.0.0.1:5173
```

Run `raisedline --help` or `raisedline <command> --help` for every option. Install
[liblouis](https://liblouis.io) (`apt install liblouis-bin`, `brew install liblouis`) for
contracted (Grade 2) braille and other languages; without it the built-in Unified English
Braille Grade 1 translator is used.

Licensed under GPL-3.0-or-later.
