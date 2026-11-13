#!/usr/bin/env node
/**
 * Empacota o rascunho do mapa e a base vetorial em dados.js para o visualizador
 * (proposta-mapa.html) abrir direto pelo navegador, sem servidor.
 * Uso: node docs/mvp/mapa/gerar-dados.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const base = readFileSync(resolve(dir, 'base-vetorial.json'), 'utf8');
const mapa = readFileSync(resolve(dir, 'capim-dourado.rascunho.json'), 'utf8');
const vagas = readFileSync(resolve(dir, 'vagas-desenho.json'), 'utf8');
const maquete = readFileSync(resolve(dir, 'maquete-shopping.json'), 'utf8');
JSON.parse(base); JSON.parse(mapa); JSON.parse(vagas); JSON.parse(maquete); // valida
writeFileSync(
  resolve(dir, 'dados.js'),
  `/* ARQUIVO GERADO por gerar-dados.mjs — não editar */\nwindow.PV_BASE=${base};\nwindow.PV_MAPA=${mapa};\nwindow.PV_VAGAS=${vagas};\nwindow.PV_MAQUETE=${maquete};\n`
);
console.log('✔ dados.js gerado');
