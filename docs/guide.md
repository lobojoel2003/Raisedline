# Preparing graphics for touch

A tactile graphic is not a raised copy of a print graphic. It is a redesign for a reader
who explores with the fingertips, one small area at a time. Raisedline automates the
mechanical parts of that redesign; these notes cover the judgement calls.

## Before you start

- **Ask what the student needs from the graphic.** A bar chart in a maths lesson may need
  exact values; the same chart in a geography lesson may only need "winter is wettest". Leave
  out what is not needed.
- **Split busy graphics.** A map of a whole campus can become an overview page and a page per
  area. Raisedline's crowding check shows where a fingertip meets too many features.
- **Keep text as text.** In SVG files, text converted to outlines cannot become braille.

## Reading the touch check

| Score             | Meaning                                               |
| ----------------- | ----------------------------------------------------- |
| 90–100, no errors | Ready to print. Still proof it on your own equipment. |
| 65–89             | Review the flagged areas.                             |
| below 65          | Rework: simplify, enlarge or split the graphic.       |

Errors are things a reader cannot work out (braille on top of a line, two lines merging).
Warnings are things that slow a reader down or are easy to misread. Notes are suggestions.

Common fixes:

- **Lines too close:** use a larger page (`--page tabloid-landscape`), leave out a series, or
  move one feature. For charts, fewer categories per page helps most.
- **Labels crowded:** Raisedline already falls back to key abbreviations; shorten names or
  give the graphic more room for full labels.
- **Area too small to identify:** use a solid fill or a point symbol for small regions.
- **Too many textures or line styles:** combine categories or split the graphic.

## Producing the graphic

- **Swell paper:** export PDF and print at 100% (no "fit to page") on a laser printer or
  copier, then run the sheet through a fuser. Black areas swell; everything else stays flat.
- **Graphics embossers:** print the PDF through the embosser's graphics driver.
- **Braille embossers without graphics mode:** export BRF. The graphic is drawn with braille
  cells, so keep it simple.
- **BrailleRAP:** export G-code. Check whether your machine embosses from the back of the
  sheet; if so, use `--mirror`.
- **3D printing:** export STL. A 0.4 mm nozzle and 0.2 mm layers work well; print flat with
  no supports. Large pages may not fit your printer bed: choose the `print-bed` page size or
  scale in the slicer.

## Braille

The built-in translator writes Unified English Braille Grade 1. For contracted (Grade 2)
braille or another language, install liblouis and use `--grade2` or `--braille
liblouis:<table>`; in the web app, run `raisedline serve` and pick the table in **Page &
braille**. You can always type a label directly in braille to control it exactly.

## Page sizes

Run `raisedline pages` for the list. The default is US Letter, landscape. Braille paper
(11 × 11.5 in), A4, A3 and tabloid are also available, and the margin can be changed.
