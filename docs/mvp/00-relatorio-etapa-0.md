# Relatório — Etapa 0 do MVP (preparação e análise)

> **Status:** concluída, aguardando validação da equipe. Nada foi commitado. Nenhum código do sistema foi implementado, conforme o enunciado.
> **Backup do estado anterior:** `C:\Users\SonTs\Documents\Projetos Pessoais\Estacionamento-backup-1a-entrega-2026-11-13` (cópia completa, com o histórico Git no commit `5230a95`).

## 1. Diagnóstico do projeto

| Item | Situação |
|---|---|
| Código executável | **Não existe.** O repositório tem só planejamento da 1ª entrega |
| Reaproveitável no MVP | Design System (tokens em 3 camadas, build e checagem de contraste funcionando), análise da planta (`docs/10`), ideias do modelo de dados, protótipo HTML como referência visual |
| Fica de fora do MVP | Plano NestJS, MQTT/ESP32, pagamento Pix, reserva de vaga, as 6 telas do protótipo |
| `backend/prisma/schema.prisma` | Esquema de planejamento (válido no Prisma 6), maior que o MVP; será substituído por um esquema menor em `apps/api/prisma/` |
| Git / GitHub | Branch `main` sincronizada com `github.com/ElitondeSousa/parkvision` (público, GitHub Pages ativo) |

**Ambiente verificado**

| Ferramenta | Versão / estado |
|---|---|
| Node.js | 24.19.0 |
| pnpm / npm | 10.22.0 / 11.17.0 |
| Git / gh | 2.54 / 2.103 (autenticado) |
| Docker | 29.9 instalado; **serviço parado** no momento do diagnóstico |
| PostgreSQL local (`psql`) | não instalado (vai rodar no Docker) |
| Python | 3.12 (usado só para ler a planta) |
| Navegadores | Edge disponível; Chrome **não** instalado (o plugin Chrome DevTools não funciona) |
| Plugins sugeridos | Context7, Playwright e GitHub: no catálogo, **não instalados** |

## 2. Entregáveis da Etapa 0

| Pedido do enunciado | Onde está |
|---|---|
| Diagnóstico do projeto | Seção 1 deste relatório |
| Arquitetura proposta | [01-arquitetura-mvp.md](01-arquitetura-mvp.md) |
| Organização de pastas | [01-arquitetura-mvp.md §4](01-arquitetura-mvp.md#4-organização-de-pastas) |
| Contratos entre módulos | [02-contratos.md](02-contratos.md) |
| Plano de Skills, Agents e Plugins | [03-plano-execucao.md §2–4](03-plano-execucao.md) + `.claude/agents/` + `.claude/skills/parkvision-regras/` |
| Planejamento de execução | [03-plano-execucao.md §1](03-plano-execucao.md) |
| Proposta inicial do mapa digital | [04-proposta-mapa.md](04-proposta-mapa.md) + visualizador [`mapa/proposta-mapa.html`](mapa/proposta-mapa.html) + [simulação 3D](mapa/simulacao-3d.html) |
| Dúvidas para validação humana | [05-duvidas.md](05-duvidas.md) |

## 3. Principais decisões propostas

1. **Stack:** React 19 + Vite + Tailwind (ligado aos tokens do Design System), Fastify 5, Socket.IO 4, PostgreSQL 16 + Prisma 6, Vitest e Playwright, em monorepo pnpm.
2. **Algoritmo isolado** em `packages/core` (funções puras e testáveis). Pesos 50/30/20; a saúde da região vira filtro; sem reserva.
3. **Mapa como dado:** um arquivo JSON com regiões, acessos e grafo, usado pelo front para desenhar e pelo back para medir distâncias.
4. **Mapa fiel por construção:** a base geométrica foi extraída do próprio desenho vetorial do PDF; as regiões foram traçadas nas mesmas coordenadas.
5. **Simulador como cliente da API:** usa os mesmos endpoints do totem; inclui o modo "tradicional" para a comparação com métricas simuladas.

## 4. Mapa: o que foi identificado

- **10 regiões propostas:** N1, N2, N3 (pátio norte), S1, S2 (pátio sul), SS1 (140 vagas), SS1M (motos, 374), SS2O, SS2C, SS2L (216 no total).
- **6 acessos** e um grafo com 27 nós e 26 trechos; distâncias relativas calculadas. Do acesso nordeste: N3 = 477, N2 = 666, N1 = 899.
- **Ambiguidades registradas, sem inventar nada:** capacidade dos pátios, divisão do SS2, ligação das rampas com o térreo, cancelas e sentido de circulação no térreo.

## 4.1 Segunda leitura da planta

A pedido da equipe, a planta foi relida em alta resolução e as vagas foram contadas no próprio desenho vetorial ([06-revisao-planta.md](06-revisao-planta.md)): pátios = 539 vagas (N1 127, N2 48, N3 203, S1 78, S2 83), SS2 por bloco 77/49/90, motos 374. Achados novos: divergência no SS1 (texto 140 × ~165 desenhadas), pátio de serviço a leste fora da distribuição, acesso nordeste e rotatória esclarecidos, hipótese da posição dos subsolos.

## 5. Arquivos criados (nenhum arquivo existente foi alterado)

```
docs/mvp/00-relatorio-etapa-0.md
docs/mvp/01-arquitetura-mvp.md
docs/mvp/02-contratos.md
docs/mvp/03-plano-execucao.md
docs/mvp/04-proposta-mapa.md
docs/mvp/05-duvidas.md
docs/mvp/06-revisao-planta.md
docs/mvp/mapa/vagas-desenho.json            ← posição de cada vaga detectada no desenho
docs/mvp/mapa/maquete-shopping.json         ← volumetria do prédio (gerada por gerar-maquete.mjs)
docs/mvp/mapa/cliente-mobile.html           ← localizador no celular (visão do cliente)
docs/mvp/mapa/capim-dourado.rascunho.json   ← regiões, acessos, grafo (coordenadas da planta)
docs/mvp/mapa/base-vetorial.json            ← traços extraídos do PDF
docs/mvp/mapa/planta-terreo.png, planta-ss1.png, planta-ss2.png
docs/mvp/mapa/proposta-mapa.html            ← visualizador
docs/mvp/mapa/simulacao-3d.html             ← simulação 3D (demonstração visual, dados simulados)
docs/mvp/mapa/gerar-dados.mjs + dados.js    ← empacotamento para abrir sem servidor
.claude/agents/ (6 agents)
.claude/skills/parkvision-regras/SKILL.md
```

## 6. Verificações executadas

| Verificação | Resultado |
|---|---|
| Sobreposição das regiões à planta (térreo, SS1, SS2) no visualizador | Alinhadas às fileiras e aos blocos desenhados |
| Contagem automática das vagas de moto no desenho | 374 retângulos únicos na área de motos |
| Tentativa de contagem automática das vagas de carro | **Não confiável** (linhas soltas); transformada na dúvida D1 |
| Validação dos JSONs do mapa | OK (`gerar-dados.mjs` valida antes de empacotar) |
| Cálculo das rotas (Dijkstra) | Executado; tabela em [04 §5](04-proposta-mapa.md) |
| Testes automatizados de código | Não se aplica: não há código nesta etapa |

## 7. Pendências

1. Respostas às dúvidas D1–D14 ([05-duvidas.md](05-duvidas.md)).
2. Aprovação da arquitetura, dos contratos e do mapa.
3. Iniciar o Docker Desktop antes da Etapa 1.
4. Decidir se os plugins Context7 e Playwright serão instalados.
5. Depois da aprovação: atualizar os documentos 03, 08 e 09 da 1ª entrega e fazer o commit.

## 8. Próximos passos (após a validação)

Etapa 1: monorepo, `packages/shared` com o mapa aprovado, `packages/core` com o algoritmo e os testes, API Fastify com Prisma, seed das regiões e ocupação. Ordem detalhada em [03-plano-execucao.md](03-plano-execucao.md#ordem-dentro-da-etapa-1-para-não-haver-retrabalho).

## 9. Como voltar ao estado anterior, se a equipe não aprovar

Nada foi commitado, e os arquivos novos estão só nas pastas `docs/mvp/` e `.claude/` (agents e skill). Duas opções:

- **Apagar só o que esta etapa criou** (na pasta do projeto). Primeiro veja a lista do que será removido; o segundo comando remove:

  ```bash
  git clean -n -d docs/mvp .claude/agents .claude/skills
  ```

  ```bash
  git clean -f -d docs/mvp .claude/agents .claude/skills
  ```

- **Usar o backup:** a pasta `Estacionamento-backup-1a-entrega-2026-11-13` tem o projeto exatamente como estava antes desta etapa.
