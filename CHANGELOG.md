# Changelog

All notable changes to Raisedline are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every CI build also carries a
build number (`1.0.0+build.N.<commit>`), shown by `raisedline --version` and in the web app footer.

## [Unreleased]

## [1.0.0] - 2026-11-12

The first public release: a complete, install-free workflow from a textbook graphic to a
tactile graphic that has been checked for touch readability.

### Added

- **Web app** with side-by-side sighted and tactile views, linked highlighting (hover a bar,
  line, label or region in one view to find it in the other), a raised-on-swell-paper look,
  and a print interline for sighted transcribers.
- **Touch preview**: a fingertip-sized cursor that counts the features under one fingertip,
  plus on-page markers for every touch-check finding.
- **Touch check** with a 0–100 score and plain-language findings: lines closer than a finger
  can separate, lines that fold back on themselves, shallow crossings, braille on or near lines,
  overlapping or crowded labels, symbols that are too small or crowded, textured areas too
  narrow to identify, dash patterns too short to recognise, lines too thin to raise, content in
  the margin or off the page, crowded fingertip-sized regions, too many textures, line styles
  or symbols, and a missing title or key. All thresholds are configurable.
- **Charts** from CSV or JSON: bar (grouped), line, scatter and pie, redesigned for touch:
  textures instead of colours, line styles plus point symbols, nice tick values with braille
  numbers, gridlines that break around data, key abbreviations for long category names, and a
  key on the page or on its own page.
- **SVG diagram import** with transforms, `<use>`, CSS classes, arcs and curves: colours become
  textures and line styles, small marks keep their shape, text becomes braille labels placed
  clear of the graphics, and detail below finger resolution is simplified away.
- **Image tracing** (OpenCV-style pipeline in TypeScript, nothing to install): Otsu
  thresholding, morphology, skeletonisation for centre lines, marching squares for outlines,
  and colour-region separation into textures.
- **Tactile maps** from GeoJSON (longitude/latitude or planar), with semantic textures (water,
  buildings, green space, parking), line styles for roads, paths, rivers and rails, point
  symbols, collision-free braille labels, key codes, lead lines and a north arrow.
- **Braille**: built-in Unified English Braille Grade 1 translator (checked against liblouis),
  plus liblouis for Grade 2 and other languages through the CLI and `raisedline serve`.
  Labels can also be typed directly in Unicode braille or `{brf:...}`.
- **Exports**: true-size vector PDF for swell paper (with optional proof and transcriber notes),
  SVG, binary STL relief for 3D printing with domed braille dots, BRF that draws the graphic in
  braille cells for any embosser, G-code for BrailleRAP-compatible open-source embossers, PNG,
  and a JSON project format.
- **Command-line tool** `raisedline` with `chart`, `svg`, `trace`, `map`, `check`, `export`,
  `braille` and `serve` commands; `check` exits non-zero on errors (or warnings with
  `--strict`) for use in pipelines.
- Release artifacts: standalone CLI, npm packages, static web app, single-file offline app,
  example outputs and SHA-256 checksums.

[Unreleased]: https://github.com/lobojoel2003/Raisedline/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/lobojoel2003/Raisedline/releases/tag/v1.0.0
