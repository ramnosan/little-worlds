import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

// Bundle the installed, locked Three.js release into a classic script so the
// deliverable also opens from file:// without a server, imports, or a CDN.
for (const [source, output] of [
  ['helicopter', 'horizon-05'],
  ['raptor', 'raptor-22'],
]) {
  const result = await build({
    entryPoints: [`src/${source}/scene.js`],
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2022',
    legalComments: 'inline',
    write: false,
  });
  const template = await readFile(`src/${source}/template.html`, 'utf8');
  const license = await readFile('node_modules/three/LICENSE', 'utf8');
  const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  await writeFile(
    `public/${output}.html`,
    template.replace('/* SCENE_BUNDLE */', () => script).replace('THREE_LICENSE', () => license),
  );
  console.log(`Built public/${output}.html — self-contained, with Three.js license.`);
}
