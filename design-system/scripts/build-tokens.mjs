#!/usr/bin/env node
/**
 * ParkVision — build de Design Tokens
 *
 * Lê design-system/tokens/tokens.json (fonte única da verdade) e gera:
 *   - design-system/tokens/build/tokens.css      → variáveis CSS (--pv-*), tema claro + escuro
 *   - design-system/tokens/build/tokens.resolved.json → valores resolvidos (para gráficos/canvas, firmware de painéis)
 *   - prototype/assets/tokens.css                → cópia consumida pelo protótipo navegável
 *
 * Convenção de nomes:
 *   primitive.color.vision.600     → --pv-color-vision-600
 *   semantic.<tema>.brand.primary  → --pv-brand-primary   (valor muda por tema)
 *   component.button.primary-bg    → --pv-button-primary-bg
 *
 * Referências "{camada.caminho}" viram var(--pv-...) — a cadeia primitive → semantic → component
 * permanece visível no CSS final e a troca de tema só redefine a camada semântica.
 *
 * Uso: node design-system/scripts/build-tokens.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = resolve(root, 'design-system/tokens/tokens.json');
const tokens = JSON.parse(readFileSync(src, 'utf8'));

const isToken = (n) => n && typeof n === 'object' && '$value' in n;

/** Converte caminho (sem a camada) em nome de variável CSS. */
const varName = (path) => '--pv-' + path.join('-');

/** "{semantic.brand.primary}" → var(--pv-brand-primary) */
function toCssValue(value) {
  if (typeof value !== 'string') return String(value);
  return value.replace(/\{([^}]+)\}/g, (_, ref) => {
    const parts = ref.split('.');
    const layer = parts.shift();
    if (!['primitive', 'semantic', 'component'].includes(layer)) {
      throw new Error(`Referência com camada inválida: {${ref}}`);
    }
    return `var(${varName(parts)})`;
  });
}

/** Achata um grupo em [[caminho, valor]] */
function flatten(node, path = [], out = []) {
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    if (isToken(child)) out.push([[...path, key], child.$value]);
    else if (child && typeof child === 'object') flatten(child, [...path, key], out);
  }
  return out;
}

/** Resolve uma referência até o valor bruto (para o JSON resolvido). */
function resolveRaw(value, theme, depth = 0) {
  if (depth > 10) throw new Error('Referência circular: ' + value);
  if (typeof value !== 'string') return value;
  return value.replace(/\{([^}]+)\}/g, (_, ref) => {
    const parts = ref.split('.');
    const layer = parts.shift();
    let node = layer === 'semantic' ? tokens.semantic[theme] : tokens[layer];
    for (const p of parts) node = node?.[p];
    if (!isToken(node)) throw new Error(`Referência não encontrada: {${ref}}`);
    return resolveRaw(node.$value, theme, depth + 1);
  });
}

const primitives = flatten(tokens.primitive);
const semLight = flatten(tokens.semantic.light);
const semDark = flatten(tokens.semantic.dark);
const components = flatten(tokens.component);

// Garante que os dois temas definem exatamente as mesmas chaves semânticas
const keys = (l) => new Set(l.map(([p]) => p.join('.')));
const kl = keys(semLight), kd = keys(semDark);
const missing = [...kl].filter((k) => !kd.has(k)).concat([...kd].filter((k) => !kl.has(k)));
if (missing.length) throw new Error('Tema claro/escuro divergentes: ' + missing.join(', '));

const decl = (list, indent = '  ') =>
  list.map(([p, v]) => `${indent}${varName(p)}: ${toCssValue(v)};`).join('\n');

const css = `/**
 * ParkVision Design Tokens v${tokens.$version}
 * ARQUIVO GERADO — não edite à mão. Fonte: design-system/tokens/tokens.json
 * Regenerar: node design-system/scripts/build-tokens.mjs
 */

/* ── Camada 1: primitivos ───────────────────────────── */
:root {
${decl(primitives)}
}

/* ── Camada 2: semânticos — tema claro (padrão) ─────── */
:root,
[data-theme="light"] {
  color-scheme: light;
${decl(semLight)}
}

/* ── Camada 2: semânticos — tema escuro ─────────────── */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${decl(semDark, '    ')}
  }
}
[data-theme="dark"] {
  color-scheme: dark;
${decl(semDark)}
}

/* ── Camada 3: componentes ──────────────────────────── */
:root {
${decl(components)}
}
`;

const resolved = { version: tokens.$version, light: {}, dark: {} };
for (const theme of ['light', 'dark']) {
  const all = [...primitives, ...flatten(tokens.semantic[theme]), ...components];
  for (const [p, v] of all) resolved[theme][varName(p)] = resolveRaw(v, theme);
}

const outDir = resolve(root, 'design-system/tokens/build');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'tokens.css'), css);
writeFileSync(resolve(outDir, 'tokens.resolved.json'), JSON.stringify(resolved, null, 2));
const protoDir = resolve(root, 'prototype/assets');
mkdirSync(protoDir, { recursive: true });
writeFileSync(resolve(protoDir, 'tokens.css'), css);

console.log(
  `✔ ${primitives.length} primitivos · ${semLight.length} semânticos (×2 temas) · ${components.length} de componente`
);
