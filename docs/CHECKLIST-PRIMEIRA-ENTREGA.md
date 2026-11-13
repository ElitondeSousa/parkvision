# Checklist — Primeira Entrega (13/11/2026, 12h)

Legenda: ✅ concluído · ⚠️ concluído com pendência registrada · ❌ não feito

Revisão feita contra o enunciado, com base nos arquivos que existem no repositório. Nada foi marcado como concluído sem um arquivo que comprove.

## 1. Requisitos obrigatórios da entrega

| # | Requisito | Arquivo(s) que comprovam | Status | Pendências |
|---|---|---|---|---|
| 1 | Proposta e estrutura inicial das telas | [05-telas.md](05-telas.md), [`prototype/index.html`](../prototype/index.html) | ✅ | Mapa interativo ainda com simulação Z1–Z4 (rotulada como exemplo); zonas reais aparecem no painel "Planta real" |
| 2 | Documentação inicial do projeto | [README](../README.md), [01](01-visao-geral.md) a [10](10-analise-planta.md) | ✅ | — |
| 3 | Linguagem de programação escolhida | [03 §3](03-arquitetura.md#3-stack-escolhida), [08 DT-01](08-decisoes-tecnicas.md) | ✅ | — |
| 4 | Arquitetura proposta | [03-arquitetura.md](03-arquitetura.md), [diagrams/01](diagrams/01-arquitetura-geral.md) | ✅ | — |
| 5 | Plataforma e tecnologias adotadas | [03 §3 e §11](03-arquitetura.md), [08](08-decisoes-tecnicas.md) | ✅ | Versões exatas de bibliotecas serão fixadas no `package.json` da Fase 1 |
| 6 | Como a tecnologia sorteada (Design System) será incorporada | [06-tecnologia-sorteada.md](06-tecnologia-sorteada.md), [04-design-system.md](04-design-system.md), [`design-system/`](../design-system/) | ✅ | Storybook e componentes React são da Fase 1 |

## 2. Documentos pedidos

| Documento | Arquivo | Status | Observação |
|---|---|---|---|
| 01 — Visão geral (problema, objetivo, solução, público, benefícios) | [01-visao-geral.md](01-visao-geral.md) | ✅ | Números de mercado tratados como hipóteses a validar |
| 02 — Requisitos funcionais e não funcionais | [02-requisitos.md](02-requisitos.md) | ✅ | RF, RNF, restrições, regras de negócio e rastreabilidade RF → telas |
| 03 — Arquitetura técnica | [03-arquitetura.md](03-arquitetura.md) | ✅ | Stack, módulos, fluxos, MQTT/API, banco, IoT, QR, pagamentos, segurança |
| 04 — Design System | [04-design-system.md](04-design-system.md) | ✅ | — |
| 05 — Estrutura das telas | [05-telas.md](05-telas.md) | ✅ | — |
| 06 — Tecnologia sorteada | [06-tecnologia-sorteada.md](06-tecnologia-sorteada.md) | ✅ | — |
| 07 — Cronograma e roadmap | [07-roadmap.md](07-roadmap.md) | ✅ | Datas são estimativas a ajustar ao calendário da disciplina; nomes dos integrantes a preencher |
| 08 — Decisões técnicas | [08-decisoes-tecnicas.md](08-decisoes-tecnicas.md) | ✅ | — |
| README na raiz | [README.md](../README.md) | ✅ | Status: planejamento técnico inicial |
| Lógica de distribuição inteligente (item 7 do enunciado) | [09-distribuicao-inteligente.md](09-distribuicao-inteligente.md) | ✅ | Fórmula, algoritmo, exemplo numérico, recomendação × reserva, concorrência |
| Análise da planta (item 1 do enunciado) | [10-analise-planta.md](10-analise-planta.md), [adaptacao-planta.md](adaptacao-planta.md) | ⚠️ | Planta recebida e analisada; contagem dos pátios e das motos, escala e grafo definitivo pendentes (não constam na planta) |

## 3. Arquitetura e tecnologias (item 4 do enunciado)

| Item | Onde | Status |
|---|---|---|
| Frontend justificado | [08 DT-02](08-decisoes-tecnicas.md) | ✅ |
| Backend justificado | [08 DT-03](08-decisoes-tecnicas.md) | ✅ |
| Banco: zonas, vagas, categorias, tickets, entradas/saídas, pagamentos, histórico | [03 §6](03-arquitetura.md#6-banco-de-dados), [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma) (validado com `prisma validate`) | ✅ |
| IoT e sensores (ultrassônico, magnético, alternativas) | [03 §7](03-arquitetura.md#7-iot-e-monitoramento), [08 DT-07](08-decisoes-tecnicas.md), [10 §5](10-analise-planta.md) | ✅ |
| Tempo real (MQTT + WebSocket) | [03 §5](03-arquitetura.md#5-fluxos-de-comunicação), [08 DT-05/06](08-decisoes-tecnicas.md) | ✅ |
| Pagamento futuro com Pix (sem implementação real) | [03 §9](03-arquitetura.md#9-pagamentos), [08 DT-11](08-decisoes-tecnicas.md) | ✅ |
| QR Code sem dados sensíveis | [03 §8](03-arquitetura.md#8-ticket-e-qr-code), [08 DT-10](08-decisoes-tecnicas.md) | ✅ |
| Hardware e sinalização | [03 §7.3](03-arquitetura.md#73-hardware-de-sinalização), [04 §8](04-design-system.md#8-aplicações-fora-da-tela) | ✅ |

## 4. Design System (item 5 do enunciado)

| Elemento | Onde | Status |
|---|---|---|
| Nome, logotipo/símbolo | [04 §2.1](04-design-system.md), [`design-system/brand/`](../design-system/brand/) | ✅ |
| Paleta, tipografia, hierarquia, diretrizes | [04 §2](04-design-system.md) | ✅ |
| Tokens: cores, espaçamentos, bordas, raios, sombras, tipografia, estados | [`tokens.json`](../design-system/tokens/tokens.json) → [`tokens.css`](../design-system/tokens/build/tokens.css) (107 primitivos, 68 semânticos × 2 temas, 68 de componente) | ✅ |
| Contraste validado | `node design-system/scripts/check-contrast.mjs` → 26/26 pares ≥ 4,5:1 | ✅ |
| Componentes (botões, cards, indicadores, badges, campos, tabelas, navegação lateral, cabeçalhos, modais, alertas, gráficos, zonas e vagas) | [04 §5](04-design-system.md#5-componentes), [`components/README.md`](../design-system/components/README.md), página Design System do protótipo | ✅ |
| Estados: livre, ocupada, reservada, indisponível, manutenção, erro, carregamento — não só por cor | [04 §4](04-design-system.md#4-estados-visuais), protótipo (vaga nos 7 estados com ícone, letra e padrão) | ✅ |
| Documento de organização, aplicação e manutenção | [04 §9](04-design-system.md#9-organização-aplicação-e-manutenção) | ✅ |
| Estrutura inicial de tokens e componentes para implementação | `design-system/tokens/`, `design-system/scripts/`, `design-system/components/README.md` | ✅ |

## 5. Telas (item 6 do enunciado)

| Tela | Âncora no protótipo | Status |
|---|---|---|
| 1 — Dashboard administrativo | `#dashboard` | ✅ |
| 2 — Mapa do estacionamento | `#mapa` | ⚠️ Proposta de zonas sobre a planta real + simulação interativa de exemplo |
| 3 — Distribuição inteligente | `#distribuicao` | ✅ |
| 4 — Veículos e tickets | `#tickets` | ✅ |
| 5 — Pagamento por QR Code (mobile) | `#pagamento` | ✅ |
| 6 — Configurações | `#config` | ✅ |

## 6. Diagramas (item 9 do enunciado)

Todos em Mermaid e verificados (20 diagramas renderizados sem erro).

| Diagrama | Arquivo | Status |
|---|---|---|
| Arquitetura geral | [diagrams/01](diagrams/01-arquitetura-geral.md) | ✅ |
| Fluxo de entrada do veículo | [diagrams/02](diagrams/02-fluxo-entrada.md) | ✅ |
| Distribuição inteligente | [diagrams/03](diagrams/03-distribuicao-inteligente.md) | ✅ |
| Pagamento por QR Code | [diagrams/04](diagrams/04-pagamento-qrcode.md) | ✅ |
| Comunicação sensores–backend–painel | [diagrams/05](diagrams/05-comunicacao-sensores.md) | ✅ |
| Modelo de dados (extra) | [diagrams/06](diagrams/06-modelo-dados.md) | ✅ |
| Circulação sobre a planta real | [10 §4](10-analise-planta.md#4-grafo-de-circulação-rascunho) | ⚠️ Rascunho; ligações tracejadas a confirmar |

## 7. Ferramenta Geproj (To Host)

| Item | Onde | Status | Pendência |
|---|---|---|---|
| Como a equipe usará a plataforma | [07 §5](07-roadmap.md) | ✅ | Uso manual; não foi verificada API/integração |
| Projeto cadastrado no Geproj | — | ❌ | A equipe precisa cadastrar fases, tarefas e responsáveis (lista inicial em [07](07-roadmap.md)) |

## 8. Pendências consolidadas

1. **Planta:** contar vagas dos pátios norte/sul e de motos; confirmar acessos, cancelas, rampas e ligação entre subsolos; obter escala/cotas; validar zonas com a operação ([10 §6–7](10-analise-planta.md)).
2. **Protótipo:** substituir a simulação Z1–Z4 pelas zonas reais (Fase 1).
3. **Equipe:** preencher nomes dos integrantes e responsáveis no [07](07-roadmap.md) e cadastrar o projeto no Geproj.
4. **Fase 1:** componentes React + Storybook; fixar versões no `package.json`; incluir verificação de contraste não textual (3:1) no script.
5. **Repositório:** ✅ publicado em https://github.com/ElitondeSousa/parkvision (branch `main`).

## 9. Ferramentas utilizadas na produção desta entrega

| Tipo | Uso |
|---|---|
| Claude Code (assistente de IA) | Apoio na escrita da documentação, nos tokens, no protótipo e na revisão |
| Skill `ui-ux-pro-max: design-system` | Referência para a arquitetura de tokens em 3 camadas |
| Agents especializados | Documentação (01, 02, 07), UX/UI (protótipo HTML/CSS), revisão técnica (inconsistências corrigidas) |
| Prisma CLI 6.19 | Validação do `schema.prisma` |
| Mermaid 11 | Verificação dos 20 diagramas |
| PyMuPDF | Leitura e recorte da planta em PDF |
