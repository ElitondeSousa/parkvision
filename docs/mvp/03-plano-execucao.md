# MVP 03 — Plano de execução, agents, skills e plugins

> Etapa 0 · proposta. Cada etapa só começa depois que a equipe valida a anterior.

## 1. Etapas

| Etapa | Objetivo | Entregável | Critério de pronto | Agents principais |
|---|---|---|---|---|
| **0 — Preparação** (esta) | Diagnóstico, arquitetura, contratos, proposta do mapa | Documentos em `docs/mvp/`, visualizador do mapa, agents e skill | Equipe aprova arquitetura, contratos, mapa e responde as dúvidas | project-architect |
| **1 — Back-end e algoritmo** | Monorepo, Prisma, seed das regiões, API, `recomendar()`, justificativas, ocupação | API rodando com algoritmo testável | Vitest cobre filtros, pontuação, desempate, justificativa, ocupação; nenhuma recomendação altera ocupação | backend, algorithm, devops |
| **2 — Simulador** | Entradas, estacionamentos, saídas, cenários, tempo real, modo tradicional | Simulador integrado | Iniciar/pausar/reiniciar funcionando; cenários `pico` e `regiao-lotada` mudam a recomendação | backend, algorithm, qa |
| **3 — Interfaces e mapa** | Totem, painel, localizador, `MapaSVG`, Design System no Tailwind | Três interfaces com o mapa fiel | Mapa sobreposto à planta sem desvio visível; contraste AA; selo "simulado" | frontend-designer |
| **4 — Integração** | Ticket, QR Code, eventos em tempo real ligados às telas | Fluxo completo | Roteiro da demonstração executa do início ao fim sem intervenção manual no banco | todos |
| **5 — Testes** | Playwright do roteiro, falhas (região lotada, QR inválido, queda de conexão) | MVP validado | Todos os testes passando; relatório de falhas resolvido | qa |
| **6 — Entrega** | Deploy, ambiente de demonstração, vídeo de segurança, roteiro, plano B | Projeto pronto para apresentar | Ensaio cronometrado (≈ 5 min); vídeo gravado; plano B testado | devops, todos |

### Ordem dentro da Etapa 1 (para não haver retrabalho)

1. devops: monorepo pnpm, `docker-compose.yml`, `.env.example`.
2. project-architect: `packages/shared` (tipos + Zod + mapa aprovado).
3. algorithm-engineer: `packages/core` com testes, **em paralelo** com o passo 4.
4. backend-engineer: esquema Prisma, seed, rotas REST, Socket.IO.
5. Integração `core` ↔ API e testes de integração.

## 2. Agents (criados em `.claude/agents/`)

| Agent | Responsabilidade | Arquivos que pode alterar |
|---|---|---|
| `project-architect` | Arquitetura, contratos, integração, revisão técnica | `docs/`, `packages/shared/` |
| `backend-engineer` | API, banco, regras de aplicação, ocupação, simulador | `apps/api/`, `apps/simulator/` |
| `algorithm-engineer` | Pontuação, compatibilidade, justificativas, rotas | `packages/core/` |
| `frontend-designer` | Interfaces, Design System, mapa interativo, UX | `apps/web/`, `design-system/`, mapa (com o arquiteto) |
| `qa-engineer` | Testes unitários, integração, ponta a ponta, falhas | `tests/`, novos `*.test.ts` (avisando o dono) |
| `devops-engineer` | Configuração, Docker, variáveis, CI, deploy | raiz, `.github/`, `docker-compose.yml`, `.env.example` |

Regra de convivência: **um arquivo, um dono**. Mudança em arquivo de outro agent vira pedido no relatório da etapa, não edição direta.

## 3. Skills

| Skill | Situação | Uso |
|---|---|---|
| `parkvision-regras` | **Criada** em `.claude/skills/` | Regras de negócio, algoritmo, mapa, dados simulados e processo, para todos os agents |
| `frontend-design` | Disponível | Direção visual das interfaces |
| `ui-ux-pro-max: design-system` / `ui-styling` | Disponível (plugin instalado) | Tokens → Tailwind, estados de componentes |
| `dataviz` | Disponível | Gráficos e indicadores do painel |
| `supabase:supabase-postgres-best-practices` | Disponível | Revisão do esquema e das consultas no PostgreSQL |
| `code-review`, `security-review`, `simplify` | Disponíveis | Revisão ao fim de cada etapa |
| `vercel:deploy` e afins | Disponíveis, exigem login | Só se a equipe escolher a Vercel para o front (Etapa 6) |

Não foi necessário instalar nenhuma skill nova além da `parkvision-regras`.

## 4. Plugins e integrações

| Item | Situação no ambiente | Recomendação |
|---|---|---|
| **Context7** (documentação atualizada de bibliotecas) | Disponível no catálogo, **não instalado** | Instalar antes da Etapa 1 (Fastify 5, Tailwind 4, Socket.IO 4, Prisma). Pede login no Context7 |
| **Playwright** (MCP para testes e navegação) | Disponível no catálogo, **não instalado** | Opcional: os testes usam o pacote npm `@playwright/test` de qualquer forma; o plugin ajuda a depurar na Etapa 5 |
| **GitHub** | `gh` CLI autenticado (conta ElitondeSousa); plugin MCP disponível, não instalado | O `gh` basta; plugin desnecessário |
| **Chrome DevTools MCP** | Instalado, mas o Chrome não está no computador | Usar o navegador do app ou o Edge headless para conferências visuais |
| **Deploy** (Vercel / Supabase) | Plugins instalados, sem login | Decidir na Etapa 6. A API precisa de servidor contínuo por causa do Socket.IO |
| **Docker** | Instalado; serviço parado no diagnóstico | Iniciar o Docker Desktop antes da Etapa 1 |
| **Geproj** (To Host) | Sem integração conhecida | Uso manual: uma tarefa por item de etapa, com o dono (agent/integrante) e o link do relatório |

## 5. Demonstração final (planejada para a Etapa 6)

Roteiro de ~5 min, conforme o enunciado: mapa real → ocupação → chegada de veículo → categoria → recomendação → justificativa → ticket com QR → localizador → confirmação → painel atualizado → região lotada e nova escolha → comparação ParkVision × tradicional (**métricas simuladas, com aviso na tela**).

**Plano B:** vídeo de segurança gravado do roteiro; banco PGlite (sem Docker); cenário reiniciável com um clique; roteiro em papel com as falas.
