# Relatório — Etapa 1 do MVP (back-end e algoritmo)

> **Status:** concluída, commitada (`c13d58e`) e enviada ao GitHub. A Etapa 2 (simulador) começa após a validação da equipe.

## 1. O que foi entregue

| Parte | Onde | Responsável |
|---|---|---|
| Monorepo pnpm, PostgreSQL 16 no Docker (bancos `parkvision` e `parkvision_teste`), `.env.example`, scripts | raiz | devops |
| Contratos: tipos, validação (Zod), eventos Socket.IO e **mapa oficial** (promovido do rascunho da Etapa 0) | `packages/shared` | arquitetura |
| Algoritmo de distribuição e rotas (funções puras) | `packages/core` | agent algorithm-engineer |
| API Fastify + Prisma + Socket.IO, carga inicial | `apps/api` | back-end |

### API (`http://localhost:3333`)

`GET /api/saude` · `GET /api/mapa` · `GET /api/regioes` · `PATCH /api/regioes/:id` · `POST /api/entradas` · `POST /api/tickets/:codigo/estacionar` · `POST /api/tickets/:codigo/saida` · `GET /api/tickets` · `GET /api/recomendacoes` · `GET /api/localizador/:token` · `GET /api/indicadores`

Erros padronizados (`DADOS_INVALIDOS`, `SEM_REGIAO_ELEGIVEL`, `REGIAO_LOTADA`, `CATEGORIA_INCOMPATIVEL`, `TRANSICAO_INVALIDA`, `TICKET_NAO_ENCONTRADO`…). As rotas de simulação (`/api/simulacao`, `/api/metricas/comparacao`) ficam para a Etapa 2.

### Regras garantidas por teste

- **Sem reserva:** a recomendação não altera a ocupação; ela sobe só na confirmação e desce na saída.
- **Nunca passa da capacidade**, nem com confirmações simultâneas (incremento atômico condicionado no banco).
- Moto vai só para SS1M; carro nunca vai para SS1M.
- Região lotada, fora de operação, com dados inválidos ou sem rota não é recomendada; o motivo aparece na avaliação.
- Pesos 50/30/20 (configuráveis), desempate por distância → vagas livres → código.
- Justificativa em português comparando com a segunda colocada.
- O fluxo recente espalha os carros entre regiões.
- QR Code com token aleatório; o banco guarda só o hash; localizador sem dados pessoais.

## 2. Verificações executadas

| Verificação | Resultado |
|---|---|
| `packages/shared` (mapa: regiões, totais da planta, referências, motos) | **4/4** testes |
| `packages/core` (rotas, filtros, pontuação, desempate, justificativas, determinismo, sem efeitos colaterais) | **86/86** testes |
| `apps/api` (integração com PostgreSQL real: fluxo completo, falhas, concorrência, validação, indicadores) | **16/16** testes |
| Verificação de tipos (TypeScript) nos 3 pacotes | sem erros |
| Teste de fumaça com o servidor real: entrada → recomendação → confirmação → eventos no Socket.IO; simulador com token errado recusado | OK |

## 3. Decisões tomadas nesta etapa

1. **Teste do banco sem apagar o esquema.** O Prisma bloqueia `db push --force-reset` quando chamado por um assistente de IA sem o consentimento de uma pessoa. Não contornei a trava: os testes usam `db push` comum e limpam só tickets, recomendações e eventos do banco de testes.
2. **Validade dos dados desligada por padrão** (`VALIDADE_DADOS_MS` vazio). No MVP a ocupação muda só por eventos, então uma região tranquila ficaria "vencida" e sairia da distribuição sem motivo. Liga-se quando o simulador (Etapa 2) passar a enviar sinais periódicos.
3. **Pesos parciais completam o padrão** (`{ distancia: 1 }` não zera os outros); peso negativo ou todos zero é erro.
4. **Ligações entre níveis com custo estimado** (A_NE→SS1 = 300, →SS1M = 250, →SS2 = 400), marcadas como estimativa no mapa.
5. **Esquema de planejamento antigo** (`backend/prisma/schema.prisma`) mantido como registro; o do MVP está em `apps/api/prisma/schema.prisma`.

## 4. Ponto para a equipe validar

**Com tudo vazio, um carro que entra pelo nordeste é mandado para o Subsolo 1, e não para N3.** Os dois ficam praticamente empatados (diferença de 0,006 no score) e o SS1 vence por estar mais perto pela rota estimada. Essa rota só existe por causa da ligação nordeste → Subsolo 1, que ainda é dúvida (D4). Se a ligação não existir ou for mais longa, N3 passa a ser a escolha. Confirmar a entrada dos subsolos resolve isso.

## 5. Arquivos criados ou alterados

```
package.json, pnpm-workspace.yaml, pnpm-lock.yaml, tsconfig.base.json, docker-compose.yml, .env.example
packages/shared/  (tipos.ts, esquemas.ts, eventos.ts, mapa/capim-dourado.json, mapa/index.ts, mapa.test.ts)
packages/core/    (index.ts, rotas.ts, recomendar.ts, rotas.test.ts, recomendar.test.ts, testes/apoio.ts)
apps/api/         (prisma/schema.prisma, prisma/criar-banco-teste.sql, src/*.ts, src/servicos/*.ts, test/*.ts, vitest.config.ts)
README.md         (seção "Como rodar o MVP")
.claude/launch.json (configuração "api" para subir o servidor)
.claude/skills/parkvision-regras/SKILL.md (validade dos dados configurável)
```

`apps/api/.env` existe localmente e **não** vai para o Git.

## 6. Pendências

1. Validar o ponto da seção 4 (ligações entre níveis).
2. Rotas de simulação e métricas de comparação (Etapa 2).
3. Atualizar os documentos da 1ª entrega (03, 08, 09) com as decisões do MVP (D12).

## 7. Próximos passos (Etapa 2 — simulador)

`apps/simulator` como cliente da API: entradas, estacionamentos e saídas com cenários (normal, pico, região lotada, região indisponível), controle iniciar/pausar/reiniciar pelo painel via Socket.IO, modo "tradicional" para comparação e métricas rotuladas como simuladas.
