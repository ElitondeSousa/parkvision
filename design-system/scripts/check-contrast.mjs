#!/usr/bin/env node
// Verifica contraste WCAG dos pares de tokens críticos (mínimo AA 4.5:1).
// Uso: node design-system/scripts/check-contrast.mjs (após build-tokens)
import {readFileSync} from 'fs';
const r=JSON.parse(readFileSync(process.argv[2] ?? new URL('../tokens/build/tokens.resolved.json', import.meta.url),'utf8'));
const L=h=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]};
const cr=(a,b)=>{const x=L(a),y=L(b);return ((Math.max(x,y)+.05)/(Math.min(x,y)+.05)).toFixed(2)};
const pairs=[['text-primary','bg-canvas'],['text-secondary','bg-surface'],['text-muted','bg-surface'],['text-on-brand','brand-primary'],['text-link','bg-surface'],
...['livre','ocupada','reservada','indisponivel','manutencao','erro'].map(s=>[`status-${s}-fg`,`status-${s}-bg`]),
['feedback-warning-fg','feedback-warning-bg'],['wayfinding-on','wayfinding-route']];
for(const t of ['light','dark']){console.log('--',t);for(const [a,b] of pairs){const A=r[t]['--pv-'+a],B=r[t]['--pv-'+b];if(A?.startsWith('#')&&B?.startsWith('#')){const v=cr(A,B);console.log((v>=4.5?'✔':'✘'),a.padEnd(26),b.padEnd(22),v);if(v<4.5)process.exitCode=1;}}}
