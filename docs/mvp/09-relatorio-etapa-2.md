# MVP 09 — Relatório da Etapa 2: simulador do estacionamento

> Status: **concluída e commitada (`98f3a36`), aguardando a validação do grupo.** A Etapa 3 não foi iniciada.

## 1. Funcionalidades implementadas

- **Motor de simulação integrado à API da Etapa 1.** Usa os mesmos serviços das rotas REST, então nenhuma regra foi duplicada.
- **Entradas.** Funcionam no modo automático (chegadas com intervalo exponencial e proporção de categorias configurável) e no manual (`POST /api/simulacao/eventos`).
- **Confirmação.** Revalida categoria, operação e capacidade no momento da confirmação. Se a região estiver cheia ou indisponível, a confirmação é rejeitada e o veículo recebe uma nova recomendação, com até 3 tentativas antes da desistência.
- **Saídas.** Nada de saída duplicada, de veículo não estacionado ou em região diferente da registrada, e a ocupação nunca fica negativa.
- **Sensores virtuais.**
  - Eventos: vaga ocupada, vaga liberada, sem comunicação, leitura inconsistente, sensor normalizado, fluxo e disponibilidade.
  - Idempotentes pelo `eventoId`, inclusive com envios simultâneos.
  - Usam o mesmo formato que os sensores reais vão usar.
- **Fluxo e congestionamento.** As medições dos sensores somam no critério de fluxo do algoritmo. **Os pesos (50/30/20) não foram alterados**, então não houve pedido de validação.
- **Controle da simulação.**
  - Ações: iniciar, pausar, retomar, encerrar e reiniciar (o reinício é seguro).
  - Ajustes: velocidade, quantidade máxima de veículos, frequência de entradas e saídas, proporção de categorias, chance de ignorar a recomendação, tempo de manobra, falhas e duplicidades de sensor, semente.
  - Modos: automático e manual.
- **Eventos em tempo real.** Envelope padronizado (`id`, `tipo`, `ocorridoEm`, `entidadeId`, `simulado`, `dados`) no Socket.IO, nos canais específicos e no canal agregado `evento`.
- **Cenários reproduzíveis.** A (tranquilo), B (pico), C (região lotada), D (congestionamento) e E (indisponibilidade), com semente fixa.
- **Separação total entre dados simulados e reais.** O reinício remove só o que é simulado e preserva tickets reais, ocupação real e as decisões do operador.

## 2. Arquivos criados ou alterados

**Novos**
- `apps/api/src/simulador/motor.ts`: motor, relógio simulado, gerador com semente, preenchimento, reinício seguro.
- `apps/api/src/simulador/cenarios.ts`: cenários A–E.
- `apps/api/src/servicos/sensores.ts`: processamento idempotente de eventos de sensor.
- `apps/api/test/simulador.test.ts`: 27 testes, organizados pelos 16 itens obrigatórios.
- `packages/core/src/sensores-fluxo.test.ts`: 3 testes do algoritmo (falha de sensor e congestionamento).
- `docs/mvp/08-simulador.md`: documentação do simulador.
- `docs/mvp/09-relatorio-etapa-2.md`: este relatório.

**Alterados**
- `packages/shared/src/tipos.ts`: `statusSensores`, `fluxo` e `nivelFluxo()` na região.
- `packages/shared/src/eventos.ts`: envelope `EventoTempoReal` e novos nomes de evento.
- `packages/shared/src/esquemas.ts`: config, eventos manuais, eventos de sensor, novos códigos de erro.
- `packages/core/src/recomendar.ts`: região com falha de sensor fica com `DADOS_INVALIDOS`.
- `apps/api/prisma/schema.prisma`:
  - flags simuladas e estado de sensores na região;
  - `Ticket.simulado`;
  - recomendações 1:N;
  - nova tabela `evento_sensor`.
- `apps/api/src/servicos/tickets.ts`:
  - opções `simulado` e `agora`;
  - `novaRecomendacao` e `cancelar`;
  - saída só para veículo estacionado;
  - confirmação recusa região indisponível.
- `apps/api/src/servicos/regioes.ts`: fluxo vindo das recomendações e dos sensores; `operacional` efetivo.
- `apps/api/src/tempo-real.ts`: envelope e emissor novos.
- `apps/api/src/app.ts`: rotas do simulador, dos sensores, de nova recomendação e de cancelamento.
- `apps/api/src/servidor.ts`: motor em modo automático.
- `apps/api/src/seed.ts`: `--limpar` também zera o estado de sensores e de simulação.
- `apps/api/test/api.test.ts`: novos nomes de evento; regra de saída da Etapa 2.
- `apps/api/vitest.config.ts`: timeout de 60 s, porque as simulações são longas.
- Outros: `packages/core/src/recomendar.test.ts`, `docs/mvp/02-contratos.md`, `README.md`, `.claude/skills/parkvision-regras/SKILL.md`.

## 3. Arquitetura

O motor roda dentro do processo da API e chama os mesmos serviços das rotas REST. Ele avança por eventos discretos, com relógio simulado e gerador com semente. As confirmações e saídas simuladas passam pelo **mesmo caminho dos sensores** (`processarEventoSensor`), o que testa a idempotência em toda execução. Diagramas e detalhes estão em [08-simulador.md §1–2](08-simulador.md).

A Etapa 0 previa o simulador como processo separado. Ele foi mantido dentro da API por três motivos:
1. O reinício seguro e a idempotência ficam numa transação só.
2. Não há regra duplicada.
3. Os testes não dependem de um segundo serviço.

O contrato HTTP continua aberto para um simulador externo ou para sensores reais.

## 4. Endpoints e eventos

**Novos endpoints**
- Controle: `GET /api/simulacao`; `POST /api/simulacao/{iniciar,pausar,retomar,encerrar,reiniciar,cenario,eventos}`; `PATCH /api/simulacao/config`.
- Sensores: `POST /api/sensores/eventos`.
- Tickets: `POST /api/tickets/:codigo/{recomendacao,cancelar}`.

Todos os endpoints de controle e de sensores exigem `x-simulador-token`; sem ele, a resposta é `401 NAO_AUTORIZADO`. Os novos erros são `REGIAO_INDISPONIVEL`, `NAO_AUTORIZADO` e `SIMULACAO_ESTADO_INVALIDO`.

**Eventos**
- `veiculo:entrou`, `veiculo:recomendado`, `veiculo:estacionou`, `veiculo:saiu`
- `regiao:ocupacao`, `regiao:fluxo`, `regiao:status`
- `simulador:estado`, `simulador:cenario`, `simulador:sensor`, `simulador:alerta`
- `indicadores:atualizados`

Os nomes seguem o padrão da Etapa 1 (`entidade:acao`). Tabelas completas em [08-simulador.md §6–7](08-simulador.md).

**Mudanças de contrato em relação à Etapa 1**
1. `ticket:criado`, `ticket:estacionado`, `ticket:saida` e `regiao:atualizada` foram substituídos pelos eventos acima, com envelope.
2. A saída agora exige ticket `ESTACIONADO`; a desistência usa `cancelar`.
3. A confirmação recusa região fora de operação.
4. Um ticket pode ter várias recomendações.
5. Durante a simulação, a API usa o relógio simulado.

## 5. Resultados dos testes

```text
pnpm typecheck   → shared, core e api sem erros
pnpm test
  packages/shared   4 testes   ✔
  packages/core    89 testes   ✔  (86 da Etapa 1 + 3 novos)
  apps/api         43 testes   ✔  (16 da Etapa 1 + 27 da Etapa 2)
  total           136 testes   ✔   (api ≈ 70 s, por causa das simulações longas)
```

| # | Item obrigatório | Testes (`apps/api/test/simulador.test.ts`) |
|---|---|---|
| 1 | Entrada de veículos | ticket simulado com envelope; proporção de categorias nas chegadas automáticas |
| 2 | Confirmação | ocupa a vaga; revalida a disponibilidade (região fechada depois da recomendação) |
| 3 | Saída | libera a vaga na mesma região |
| 4 | Ocupação correta | 12 min simulados com falhas e duplicidades: ocupação = veículos estacionados em todas as regiões; indicadores conferem |
| 5 | Região cheia | rejeita e gera nova recomendação (simulador e REST 409 + `/recomendacao`) |
| 6 | Recomendação sem alterar ocupação | 20 entradas + nova recomendação → ocupação 0, nenhum `evento_ocupacao` |
| 7 | Saída duplicada | 2ª saída, saída sem estacionar e saída em outra região rejeitadas |
| 8 | Ocupação negativa | saída em região zerada recusada; `PATCH ocupadas: -1` → 400 |
| 9 | Capacidade | 10 leituras simultâneas numa região com 3 vagas → exatamente 3 confirmadas |
| 10 | Sensores simulados | falha tira a região da recomendação; normalização devolve; bloqueio simulado preserva o operador; sem ticket não mexe na ocupação; token e validação |
| 11 | Eventos duplicados | o mesmo `eventoId` em 3 envios simultâneos → 1 `APLICADO`, 2 `DUPLICADO` |
| 12 | Fluxo e congestionamento | SS1 com fluxo elevado sai do topo, pesos iguais aos padrão, medição expira |
| 13 | Pausa e retomada | ciclo de vida e transições inválidas; no modo automático, o relógio congela na pausa |
| 14 | Reinício seguro | remove só o simulado; ticket real, ajuste e decisão do operador intactos |
| 15 | Tempo real | Socket.IO real: envelope no canal específico e no agregado; `/simulador` recusa token errado |
| 16 | Cenários | A–E com os efeitos esperados; reprodutibilidade (mesma semente → mesmo resultado) |

**Teste manual com o servidor real.** O cenário B rodou em modo automático por 10 s: 135 entradas, 87 confirmações, 11 saídas e nenhum erro. O reinício removeu 951 tickets simulados e voltou a ocupação a 0.

## 6. Como executar a demonstração

```bash
pnpm db:up
```

```bash
pnpm db:push
```

```bash
pnpm db:seed
```

```bash
pnpm dev:api
```

Em outro terminal (com o token de `apps/api/.env`):

```bash
curl -X POST localhost:3333/api/simulacao/cenario -H "x-simulador-token: troque-este-token" -H "content-type: application/json" -d '{"cenario":"C"}'
```

```bash
curl localhost:3333/api/simulacao
```

```bash
curl -X POST localhost:3333/api/simulacao/reiniciar -H "x-simulador-token: troque-este-token"
```

Pausar, retomar, mudar a velocidade, o modo manual e ouvir o Socket.IO: [08-simulador.md §10](08-simulador.md). Ainda não há tela; o painel visual é da Etapa 3.

## 7. Problemas encontrados

1. **Lacunas estruturais da Etapa 1**, todas corrigidas estendendo o que já existia, sem implementação paralela:
   - só uma recomendação por ticket (impedia a nova recomendação);
   - saída aceitava ticket que não estacionou;
   - confirmação não revalidava a operação da região;
   - não havia marca `simulado` nem envelope de eventos;
   - a região não tinha campos de sensor ou fluxo.
2. **Proteção do Prisma.** O Prisma bloqueia `db push --force-reset` quando quem chama é um agente de IA. A proteção não foi contornada: o schema foi aplicado com `db push` comum (não destrutivo), e a limpeza dos testes usa o `semear({ limpar })`.
3. **Desempenho no pico.** No cenário B (30 chegadas/min), a velocidade efetiva fica abaixo da configurada, porque cada evento é uma transação no banco. Está registrado nas limitações.
4. **Cenário C.** A corrida "lotou entre a recomendação e a confirmação" quase não acontece sozinha. O algoritmo raramente escolhe uma região quase cheia, porque a disponibilidade pesa 50%. No cenário, as rejeições vêm de quem ignora a recomendação, e a corrida exata está coberta por um teste determinístico (item 5).
5. **Acesso nordeste.** Com ocupação uniforme, a recomendação para quem entra pelo acesso nordeste é o SS1, e não o N3. Por isso o cenário D congestiona o SS1.

## 8. Limitações

Detalhes em [08-simulador.md §12](08-simulador.md).
- A velocidade efetiva cai em cenários de pico.
- Sensor de vaga sem ticket é ignorado (não há modelo de vaga individual).
- Cada região tem um único status de sensor.
- Durante a simulação, a API usa o relógio simulado.
- O estado do motor fica em memória. Depois de reiniciar a API, ele retoma os veículos do banco com novos tempos de saída.
- Ainda não existe credencial para sensores reais.
- O simulador não implementa a estratégia "tradicional" para comparação. Essa métrica é da Etapa 5.

## 9. Linguagem da roleta diária

O grupo **ainda não informou** a linguagem sorteada hoje (13/11/2026). Seguindo o enunciado, o resultado não foi inventado e a Etapa 2 continuou com a stack atual (TypeScript, Fastify, Prisma, Socket.IO, Vitest).

Quando o grupo informar a linguagem, o lugar natural para avaliá-la sem mexer na arquitetura é o **motor de simulação**:
- a lógica é isolada;
- o contrato HTTP (`/api/sensores/eventos` e `/api/simulacao/*`) já está aberto;
- um gerador de carga ou um simulador de sensores externo pode ser escrito em outra linguagem e falar com a API por esse contrato.

Qualquer introdução fica sujeita à aprovação do grupo.

## 10. Pendências para a próxima etapa

**Para o grupo validar**
- A mudança de contrato da saída (só veículo estacionado) e os novos nomes de evento.
- O simulador dentro da API, em vez de em processo separado.
- Os parâmetros dos cenários A–E.

**Etapa 3 (interfaces), quando autorizada**
- Painel com controles do simulador.
- Mapa ouvindo `regiao:ocupacao`, `regiao:fluxo` e `regiao:status`.
- Alertas em `simulador:alerta`.
- Totem usando `POST /entradas` e `/tickets/:codigo/recomendacao`.

**Mais adiante**
- Credencial própria para sensores reais.
- Cache do fluxo ou escrita em lote, se a demonstração precisar de velocidades maiores no pico.
- Estratégia "tradicional" para a comparação da Etapa 5.
