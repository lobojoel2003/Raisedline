import { existsSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILD_INFO,
  buildChart,
  buildMap,
  chartFromCsv,
  checkDocument,
  DEFAULT_RULES,
  importSvg,
  PAGE_PRESETS,
  pagePreset,
  parseDocument,
  retranslate,
  summarizeReport,
  toBrailleAscii,
  traceImage,
  versionString,
  type BuildResult,
  type ChartSpec,
  type ChartType,
  type PageSpec,
  type TactileDocument,
  type TouchReport,
  type TouchRules,
  type TraceMode,
} from '@raisedline/core';
import { num, parseArgs, str, UsageError, type ParsedArgs } from './args.js';
import { dataUrl, decodeImage, planOutputs, readText, relative, writeOutputs } from './io.js';
import {
  liblouisAvailable,
  liblouisTables,
  liblouisVersion,
  resolveTranslator,
} from './liblouis.js';
import { serve } from './serve.js';

const HELP = `raisedline — charts and maps you can read by touch

Usage
  raisedline <command> [input] [options]

Commands
  chart <data.csv|spec.json>   Tactile bar, line, scatter or pie chart from data
  svg <diagram.svg>            Redesign an SVG diagram as a tactile graphic
  trace <image.png|jpg>        Trace a scan or picture into raised lines and areas
  map <map.geojson>            Tactile map from GeoJSON (geographic or planar)
  check <file>                 Run the touch check on a document or any input
  export <doc.raisedline.json> Export a saved document to other formats
  braille <text>               Translate text to braille (Unicode or BRF)
  serve                        Open the Raisedline web app locally (with liblouis)
  pages                        List page sizes

Common options
  -o, --out <path>       Output file or base name (format inferred from extension)
  -f, --format <list>    pdf, svg, stl, brf, gcode, json, report (comma separated)
      --title <text>     Title shown in braille at the top of the page
      --page <name>      Page size (see "raisedline pages"), default letter-landscape
      --margin <mm>      Page margin in millimetres (default 12)
      --braille <table>  ueb-grade1 (built in) or liblouis:<table>, e.g. liblouis:en-ueb-g2.ctb
      --grade2           Shortcut for --braille liblouis:en-ueb-g2.ctb
      --interline        Print the text under braille labels (PDF/SVG proofs only)
      --mirror           Mirror output for machines that emboss from the back
      --strict           Exit with an error when the touch check finds warnings
      --json             Machine-readable output
  -q, --quiet            Only print errors
  -h, --help             Help for a command
  -v, --version          Version and build number

Run "raisedline <command> --help" for command options.
Docs: https://github.com/lobojoel2003/Raisedline`;

const COMMAND_HELP: Record<string, string> = {
  chart: `raisedline chart <data.csv|spec.json> [options]

The first CSV row holds headers; the first column holds categories (or x values for scatter
plots); every other column becomes a series. A JSON file can hold a full chart spec.

  -t, --type <type>      bar (default), line, scatter or pie
      --title <text>     Chart title
      --x-label <text>   Horizontal axis title (default: first CSV header)
      --y-label <text>   Vertical axis title
      --y-min, --y-max   Value range
      --gridlines / --no-gridlines

Example
  raisedline chart rainfall.csv --type bar --title "Monthly rainfall" -f pdf,stl`,
  svg: `raisedline svg <diagram.svg> [options]

      --title <text>       Title (default: the SVG <title>)
      --simplify <mm>      Remove detail smaller than this (default 0.4)
      --no-labels          Skip text elements`,
  trace: `raisedline trace <image.png|jpg> [options]

      --mode <mode>        auto (default), lines, outlines or regions
      --threshold <0-255>  Darkness threshold (default: automatic)
      --invert             Trace light shapes on a dark background
      --colors <n>         Colour regions for --mode regions (default 4)
      --smoothing <px>     Blur radius before tracing (default 1)
      --simplify <mm>      Remove detail smaller than this (default 0.6)`,
  map: `raisedline map <map.geojson> [options]

      --label-property <name>     Feature property used for labels (default "name")
      --category-property <name>  Feature property used for textures and symbols
      --simplify <mm>             Remove outline detail smaller than this (default 0.6)
      --y-down                    Planar coordinates grow downwards (like pixels)
      --no-north                  Leave out the north arrow`,
  check: `raisedline check <file> [options]

Runs the touch-readability check on a saved document (.raisedline.json) or on any input the
other commands accept. Exits with code 1 when errors are found (or warnings with --strict).

      --min-gap <mm>          Clear space needed between lines (default ${DEFAULT_RULES.minLineGap})
      --label-clearance <mm>  Clear space around braille (default ${DEFAULT_RULES.labelClearance})
      --rules <file.json>     Override any rule
      --json                  Print the full report as JSON`,
  export: `raisedline export <doc.raisedline.json> -f pdf,stl,brf,gcode,svg

      --braille <table>   Re-translate every label with another braille table`,
  braille: `raisedline braille <text> [--braille <table>] [--brf]

Prints Unicode braille, or Braille ASCII (BRF) with --brf.
      --list-tables       Show installed liblouis tables`,
  serve: `raisedline serve [--port 5173] [--host 127.0.0.1]

Serves the web app locally. When liblouis is installed the app can also produce contracted
(Grade 2) braille and any other liblouis table.`,
};

interface Ctx {
  args: ParsedArgs;
  quiet: boolean;
  json: boolean;
}

function log(ctx: Ctx, msg = '') {
  if (!ctx.quiet && !ctx.json) process.stdout.write(msg + '\n');
}

function pageFrom(opts: ParsedArgs['options']): PageSpec | undefined {
  const name = str(opts, 'page');
  const margin = num(opts, 'margin');
  if (!name && margin === undefined) return undefined;
  return pagePreset(name ?? 'letter-landscape', margin);
}

function rulesFrom(opts: ParsedArgs['options']): Partial<TouchRules> {
  const rules: Partial<TouchRules> = {};
  const file = str(opts, 'rules');
  if (file) Object.assign(rules, JSON.parse(readText(file)));
  const gap = num(opts, 'min-gap');
  if (gap !== undefined) rules.minLineGap = gap;
  const lc = num(opts, 'label-clearance');
  if (lc !== undefined) rules.labelClearance = lc;
  return rules;
}

function translatorFrom(opts: ParsedArgs['options']) {
  return resolveTranslator(opts.grade2 ? 'liblouis:en-ueb-g2.ctb' : str(opts, 'braille'));
}

function requireInput(args: ParsedArgs, what: string): string {
  const input = args.positionals[1];
  if (!input)
    throw new UsageError(`Missing ${what}. Run "raisedline ${args.positionals[0]} --help".`);
  if (!existsSync(input)) throw new Error(`File not found: ${input}`);
  return input;
}

function build(kind: string, input: string, opts: ParsedArgs['options']): BuildResult {
  const translator = translatorFrom(opts);
  const page = pageFrom(opts);
  const title = str(opts, 'title');
  switch (kind) {
    case 'chart': {
      const type = (str(opts, 'type') ?? 'bar') as ChartType;
      if (!['bar', 'line', 'scatter', 'pie'].includes(type))
        throw new UsageError(`Unknown chart type "${type}"`);
      let spec: ChartSpec;
      if (extname(input).toLowerCase() === '.json') {
        spec = JSON.parse(readText(input)) as ChartSpec;
        if (title) spec.title = title;
      } else {
        spec = chartFromCsv(readText(input), {
          type,
          title:
            title ??
            input
              .replace(/^.*[/\\]/, '')
              .replace(/\.[^.]+$/, '')
              .replace(/[-_]+/g, ' '),
          xLabel: str(opts, 'x-label'),
          yLabel: str(opts, 'y-label'),
        });
      }
      if (str(opts, 'type')) spec.type = type;
      if (num(opts, 'y-min') !== undefined) spec.yMin = num(opts, 'y-min');
      if (num(opts, 'y-max') !== undefined) spec.yMax = num(opts, 'y-max');
      if (opts.gridlines) spec.gridlines = true;
      if (opts['no-gridlines']) spec.gridlines = false;
      if (page) spec.page = page;
      return buildChart(spec, { translator });
    }
    case 'svg':
      return importSvg(readText(input), {
        title,
        page,
        translator,
        simplify: num(opts, 'simplify'),
        labels: opts['no-labels'] ? false : undefined,
      });
    case 'trace':
      return traceImage(decodeImage(input), {
        title:
          title ??
          input
            .replace(/^.*[/\\]/, '')
            .replace(/\.[^.]+$/, '')
            .replace(/[-_]+/g, ' '),
        page,
        translator,
        mode: str(opts, 'mode') as TraceMode | undefined,
        threshold: num(opts, 'threshold'),
        invert: !!opts.invert,
        colors: num(opts, 'colors'),
        smoothing: num(opts, 'smoothing'),
        simplify: num(opts, 'simplify'),
        imageHref: dataUrl(input),
      });
    case 'map':
      return buildMap(readText(input), {
        title,
        page,
        translator,
        simplify: num(opts, 'simplify'),
        labelProperty: str(opts, 'label-property'),
        categoryProperty: str(opts, 'category-property'),
        yDown: !!opts['y-down'],
        northArrow: opts['no-north'] ? false : undefined,
      });
  }
  throw new UsageError(`Unknown command "${kind}"`);
}

/** Load any supported input as a document. */
function loadAny(input: string, opts: ParsedArgs['options']): TactileDocument {
  const ext = extname(input).toLowerCase();
  if (input.endsWith('.raisedline.json')) return parseDocument(readText(input));
  if (ext === '.json') {
    const data = JSON.parse(readText(input));
    if (data?.format === 'raisedline') return parseDocument(data);
    if (data?.type === 'FeatureCollection' || data?.type === 'Feature')
      return build('map', input, opts).tactile;
    return build('chart', input, opts).tactile;
  }
  if (ext === '.geojson') return build('map', input, opts).tactile;
  if (ext === '.csv' || ext === '.tsv') return build('chart', input, opts).tactile;
  if (ext === '.svg') return build('svg', input, opts).tactile;
  if (['.png', '.jpg', '.jpeg'].includes(ext)) return build('trace', input, opts).tactile;
  throw new UsageError(`Do not know how to read "${input}"`);
}

function printReport(ctx: Ctx, report: TouchReport, limit = 8) {
  log(ctx, summarizeReport(report));
  const icon = { error: '✖', warning: '▲', info: '•' };
  for (const issue of report.issues.slice(0, limit)) {
    log(ctx, `  ${icon[issue.severity]} ${issue.message}`);
    log(ctx, `    ${issue.hint}`);
  }
  if (report.issues.length > limit)
    log(ctx, `  … and ${report.issues.length - limit} more (use --json for all).`);
}

function exitCodeFor(report: TouchReport, strict: boolean): number {
  if (report.counts.error > 0) return 1;
  if (strict && report.counts.warning > 0) return 1;
  return 0;
}

async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const o = args.options;
  const ctx: Ctx = { args, quiet: !!o.quiet, json: !!o.json };
  const cmd = args.positionals[0];

  if (o.version && !cmd) {
    if (ctx.json)
      process.stdout.write(JSON.stringify({ ...BUILD_INFO, liblouis: liblouisVersion() }) + '\n');
    else {
      process.stdout.write(
        `raisedline ${versionString()} (${BUILD_INFO.channel}${BUILD_INFO.date ? `, built ${BUILD_INFO.date.slice(0, 10)}` : ''})\n`,
      );
      process.stdout.write(
        `liblouis: ${liblouisVersion() ?? 'not installed (built-in UEB Grade 1 only)'}\n`,
      );
    }
    return 0;
  }
  if (!cmd || cmd === 'help') {
    process.stdout.write((COMMAND_HELP[args.positionals[1] ?? ''] ?? HELP) + '\n');
    return 0;
  }
  if (o.help) {
    process.stdout.write((COMMAND_HELP[cmd] ?? HELP) + '\n');
    return 0;
  }

  switch (cmd) {
    case 'pages': {
      for (const [name, p] of Object.entries(PAGE_PRESETS))
        process.stdout.write(`${name.padEnd(20)} ${p.label}\n`);
      return 0;
    }
    case 'braille': {
      if (o['list-tables']) {
        if (!liblouisAvailable())
          process.stdout.write('liblouis is not installed; only ueb-grade1 is available.\n');
        else process.stdout.write(liblouisTables().join('\n') + '\n');
        return 0;
      }
      const text = args.positionals.slice(1).join(' ');
      if (!text)
        throw new UsageError('Give some text to translate, e.g. raisedline braille "Hello world"');
      const out = translatorFrom(o).translate(text);
      if (ctx.json)
        process.stdout.write(
          JSON.stringify({ text, braille: out, brf: toBrailleAscii(out) }) + '\n',
        );
      else process.stdout.write((o.brf ? toBrailleAscii(out) : out.replace(/⠀/g, ' ')) + '\n');
      return 0;
    }
    case 'serve': {
      const here = dirname(fileURLToPath(import.meta.url));
      const webRoot = str(o, 'web-root') ?? join(here, 'web');
      const port = num(o, 'port') ?? 5173;
      const { url } = await serve(webRoot, port, str(o, 'host') ?? '127.0.0.1');
      process.stdout.write(`Raisedline is running at ${url}\n`);
      process.stdout.write(
        liblouisAvailable()
          ? `liblouis ${liblouisVersion()} detected: Grade 2 braille is available.\n`
          : 'liblouis not found: using built-in UEB Grade 1 braille.\n',
      );
      process.stdout.write('Press Ctrl+C to stop.\n');
      await new Promise(() => {});
      return 0;
    }
    case 'check': {
      const input = requireInput(args, 'input file');
      const doc = loadAny(input, o);
      const report = checkDocument(doc, rulesFrom(o));
      if (ctx.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      else printReport(ctx, report, 20);
      return exitCodeFor(report, !!o.strict);
    }
    case 'export': {
      const input = requireInput(args, 'document (.raisedline.json)');
      let doc = parseDocument(readText(input));
      if (o.braille || o.grade2) doc = retranslate(doc, translatorFrom(o));
      const outputs = planOutputs(
        input.replace(/\.raisedline\.json$/, '.json'),
        str(o, 'out'),
        str(o, 'format'),
      );
      const report = checkDocument(doc, rulesFrom(o));
      const written = writeOutputs(doc, outputs, {
        interline: !!o.interline,
        mirror: !!o.mirror,
        transcriberNotes: !!o['transcriber-notes'],
        report,
      });
      if (ctx.json)
        process.stdout.write(JSON.stringify({ files: written, report }, null, 2) + '\n');
      else for (const w of written) log(ctx, `wrote ${relative(w)}`);
      return 0;
    }
    case 'chart':
    case 'svg':
    case 'trace':
    case 'map': {
      const input = requireInput(args, 'input file');
      const result = build(cmd, input, o);
      const report = checkDocument(result.tactile, rulesFrom(o));
      const outputs = planOutputs(input, str(o, 'out'), str(o, 'format'));
      const written = writeOutputs(result.tactile, outputs, {
        interline: !!o.interline,
        mirror: !!o.mirror,
        transcriberNotes: !!o['transcriber-notes'],
        translator: translatorFrom(o),
        report,
      });
      if (ctx.json) {
        process.stdout.write(
          JSON.stringify({ files: written, notes: result.notes, report }, null, 2) + '\n',
        );
      } else {
        log(
          ctx,
          `${result.tactile.title} — ${result.tactile.pages.length} page${result.tactile.pages.length > 1 ? 's' : ''}, ${result.tactile.page.width} × ${result.tactile.page.height} mm`,
        );
        for (const n of result.notes) log(ctx, `  note: ${n}`);
        printReport(ctx, report);
        for (const w of written) log(ctx, `wrote ${relative(w)}`);
      }
      return exitCodeFor(report, !!o.strict);
    }
  }
  throw new UsageError(`Unknown command "${cmd}". Run "raisedline --help".`);
}

run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    const e = err as Error;
    process.stderr.write(`raisedline: ${e.message}\n`);
    process.exitCode = e instanceof UsageError ? 2 : 1;
  },
);
