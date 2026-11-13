#!/usr/bin/env node
/**
 * Gera maquete-shopping.json: volumetria simplificada do Capim Dourado Shopping,
 * traçada sobre a planta (coordenadas da folha "Planta Mix 1/2", térreo).
 * 1 unidade ≈ 0,3 m; alturas são estimativas visuais (a planta não informa alturas).
 * Uso: node docs/mvp/mapa/gerar-maquete.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = dirname(fileURLToPath(import.meta.url));

// Contorno geral do edifício (galeria + lojas), traçado sobre a planta
const galeria = [[686,662],[843,662],[900,600],[979,560],[979,476],[1172,476],[1172,532],[1280,640],[1406,648],[1406,300],[1620,250],[1720,215],[1720,790],[1631,790],[1631,1070],[1442,1075],[1440,1090],[1270,1085],[1210,1040],[1100,1020],[990,1030],[940,1035],[813,1035],[694,1010],[609,1056],[567,1039],[529,996],[508,937],[508,878],[529,827],[567,793],[622,780],[686,760]];

// Octógono central (Riachuelo e galeria em anel)
const oct = (cx, cy, rx, ry) => Array.from({ length: 8 }, (_, i) => { const a = Math.PI / 8 + i * Math.PI / 4; return [Math.round(cx + rx * Math.cos(a)), Math.round(cy + ry * Math.sin(a))]; });

const volumes = [
  { id: 'galeria', cor: 0xd8d3c9,   nome: 'Galeria (lojas e corredores)', tipo: 'galeria', base: 0, altura: 20, poligono: galeria },
  { id: 'ca', cor: 0xf0efea,        nome: 'C&A',            tipo: 'ancora', base: 0, altura: 28, poligono: [[979,476],[1172,476],[1172,600],[1140,632],[1010,632],[979,600]] },
  { id: 'riachuelo', cor: 0xc9cdd2, nome: 'Riachuelo',      tipo: 'ancora', base: 0, altura: 27, poligono: oct(1086, 700, 88, 72) },
  { id: 'renner', cor: 0xd7c9b3,    nome: 'Renner',         tipo: 'ancora', base: 0, altura: 26, poligono: [[622,780],[694,780],[694,1005],[669,1013],[609,1056],[567,1039],[529,996],[508,937],[508,878],[529,827],[567,793]] },
  { id: 'centauro', cor: 0xd0d3d6,  nome: 'Centauro',       tipo: 'ancora', base: 0, altura: 25, poligono: [[813,971],[940,971],[940,1032],[813,1032]] },
  { id: 'bloco_leste', cor: 0xc4ccd4, nome: 'Big · Wow Park\nMorofit · Pernambucanas', tipo: 'ancora', base: 0, altura: 30, poligono: [[1406,300],[1620,250],[1676,232],[1676,790],[1406,790]] },
  { id: 'cinemark', cor: 0x6f7a86,  nome: 'Cinemark',       tipo: 'cinema', base: 0, altura: 42, poligono: [[1442,791],[1631,791],[1631,1068],[1442,1068]] },
  { id: 'marisa', cor: 0xe2d6d6,    nome: 'Marisa',         tipo: 'ancora', base: 0, altura: 25, poligono: [[1270,995],[1440,995],[1440,1085],[1270,1085]] },
  { id: 'madero', cor: 0x9b8a75,    nome: 'Madero',         tipo: 'loja',   base: 0, altura: 16, poligono: [[1199,980],[1244,980],[1244,1025],[1199,1025]] },
];

// Praças com claraboia (domos de vidro)
const pracas = [
  { id: 'praca_sul',    nome: 'Praça de eventos (circular)', centro: [1084, 861], raio: 40 },
  { id: 'praca_norte',  nome: 'Praça de eventos (C&A)',      centro: [1078, 650], raio: 30 },
  { id: 'praca_leste',  nome: 'Praça de eventos (leste)',    centro: [1270, 760], raio: 22 },
];

// 2º pavimento — praça de alimentação (folha 2/2), alinhada pela fachada curva e pelas escadas rolantes
// Contorno traçado na folha 2/2 (pontos do PDF) e transformado para o térreo:
const fp = [[620,35],[500,80],[400,170],[330,300],[295,450],[290,600],[300,760],[340,900],[420,1030],[520,1130],[670,1170],[840,1120],[845,1018],[1360,1018],[1360,880],[1880,740],[1880,545],[1360,400],[1360,160],[875,160],[690,110]].map(([x, y]) => [x * 1.2, y * 1.2]);
const p0 = [348, 744], q0 = [508, 937];          // fachada curva: folha 2/2 → térreo (Renner)
const p1 = [2256, 768], q1 = [876, 916];         // ponta do átrio das escadas rolantes
const ang = Math.atan2(q1[1] - q0[1], q1[0] - q0[0]) - Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
const esc = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) / Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
const T = ([x, y]) => { const dx = x - p0[0], dy = y - p0[1]; return [Math.round(q0[0] + esc * (dx * Math.cos(ang) - dy * Math.sin(ang))), Math.round(q0[1] + esc * (dx * Math.sin(ang) + dy * Math.cos(ang)))]; };
volumes.push({ id: 'praca_alimentacao', nome: 'Praça de alimentação (2º pavimento)', tipo: 'pavimento2', base: 20, altura: 16, poligono: fp.map(T),
  observacao: `Posição estimada: escala ${esc.toFixed(3)}, rotação ${(ang * 180 / Math.PI).toFixed(1)}°, alinhando a fachada curva e o átrio das escadas rolantes ao térreo` });

const out = {
  $descricao: 'Maquete simplificada do Capim Dourado Shopping traçada sobre a planta (térreo). Contornos aproximados; alturas estimadas (não constam na planta). Coordenadas da folha Planta Mix 1/2.',
  status: 'rascunho', unidade: '1 unidade ≈ 0,3 m', volumes, pracas,
};
writeFileSync(resolve(dir, 'maquete-shopping.json'), JSON.stringify(out, null, 1));
console.log('✔ maquete-shopping.json:', volumes.length, 'volumes,', pracas.length, 'praças; praça de alimentação escala', esc.toFixed(3), 'rotação', (ang * 180 / Math.PI).toFixed(1) + '°');
