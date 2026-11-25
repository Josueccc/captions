import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

const STATIC = [
  ['src/manifest.json', 'manifest.json'],
  ['src/popup/popup.html', 'popup.html'],
  ['src/popup/popup.css', 'popup.css'],
  ['src/options/options.html', 'options.html'],
  ['src/options/options.css', 'options.css'],
  ['src/icons', 'icons'],
  ['src/_locales', '_locales'],
];

async function copyStatic() {
  for (const [from, to] of STATIC) {
    await cp(from, `${outdir}/${to}`, { recursive: true });
  }
}

const copyStaticPlugin = {
  name: 'copy-static',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length === 0) {
        await copyStatic();
        if (watch) console.log(`[${new Date().toLocaleTimeString()}] rebuilt`);
      }
    });
  },
};

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const ctx = await esbuild.context({
  entryPoints: {
    background: 'src/background/index.ts',
    content: 'src/content/index.ts',
    'pcm-worklet': 'src/content/pcm-worklet.ts',
    popup: 'src/popup/popup.ts',
    options: 'src/options/options.ts',
  },
  outdir,
  bundle: true,
  format: 'iife',
  target: 'firefox140',
  sourcemap: 'linked',
  logLevel: 'info',
  plugins: [copyStaticPlugin],
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
