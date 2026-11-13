# MVP 02 — Contratos entre módulos

> Etapa 0 · proposta. Estes contratos permitem desenvolver back-end, front-end, algoritmo e simulador em paralelo. Na Etapa 1 viram código em `packages/shared` (tipos TypeScript + schemas Zod). Qualquer mudança depois disso passa pelo `project-architect`.

## 1. Tipos de domínio

```ts
export type Categoria = 'CARRO_PEQUENO' | 'CARRO_GRANDE' | 'MOTO';
export type Nivel = 'terreo' | 'ss1' | 'ss2';
export type FonteCapacidade = 'planta' | 'desenho' | 'simulada';

export interface Regiao {
  id: string;                 // 'N1', 'N2', 'N3', 'S1', 'S2', 'SS1', 'SS1M', 'SS2O', 'SS2C', 'SS2L'
  nome: string;
  nivel: Nivel;
  categorias: Categoria[];
  capacidade: number;
  ocupadas: number;
  livres: number;             // calculado: capacidade - ocupadas
  operacional: boolean;
  fonteCapacidade: FonteCapacidade;
  atualizadoEm: string;       // ISO 8601
}

export type StatusTicket = 'AGUARDANDO' | 'ESTACIONADO' | 'SAIU' | 'CANCELADO';

export interface Ticket {
  codigo: string;             // 'PV-0042' (impresso, digitável)
  tokenPublico: string;       // aleatório, só no QR
  categoria: Categoria;
  acessoId: string;           // 'A_NE', 'A_S1', 'A_S2'
  entradaEm: string;
  regiaoRecomendadaId: string;
  regiaoEstacionadaId: string | null;
  estacionadoEm: string | null;
  saidaEm: string | null;
  status: StatusTicket;
}

export interface AvaliacaoRegiao {
  regiaoId: string;
  elegivel: boolean;
  motivo?: 'CATEGORIA_INCOMPATIVEL' | 'SEM_VAGAS' | 'FORA_DE_OPERACAO' | 'DADOS_INVALIDOS' | 'SEM_ROTA';
  criterios?: { disponibilidade: number; distancia: number; fluxo: number }; // já normalizados 0..1
  custoRota?: number;         // unidades relativas da planta
  score?: number;
}

export interface Recomendacao {
  id: string;
  ticketCodigo: string;
  regiaoId: string;
  score: number;
  pesos: { disponibilidade: number; distancia: number; fluxo: number }; // padrão 0.5 / 0.3 / 0.2
  avaliacoes: AvaliacaoRegiao[];
  justificativa: string;
  rota: { nos: string[]; custo: number };   // ids de nós do mapa
  criadaEm: string;
}
```

## 2. Pacote `core` (algoritmo) — função pura

```ts
export function recomendar(entrada: {
  categoria: Categoria;
  acessoNo: string;                        // nó do mapa onde fica o totem
  regioes: Regiao[];
  fluxoRecente: Record<string, number>;    // contagem nos últimos 5 min por região
  vazaoReferencia: Record<string, number>; // por região
  mapa: MapaDigital;                       // JSON do mapa (nós, arestas, regiões)
  agora: Date;
  pesos?: Partial<Recomendacao['pesos']>;
}): { tipo: 'RECOMENDADA'; regiaoId: string; score: number; avaliacoes: AvaliacaoRegiao[]; justificativa: string; rota: Recomendacao['rota'] }
  | { tipo: 'SEM_REGIAO'; avaliacoes: AvaliacaoRegiao[]; justificativa: string };

export function menorCaminho(mapa: MapaDigital, origem: string, destino: string): { nos: string[]; custo: number } | null;
```

Sem banco, sem relógio global e sem aleatoriedade: o mesmo estado sempre gera a mesma resposta, o que torna o algoritmo testável.

## 3. Formato do mapa (`MapaDigital`)

Igual ao rascunho [`mapa/capim-dourado.rascunho.json`](mapa/capim-dourado.rascunho.json): `niveis[]`, `regioes[]` (polígono, categorias, capacidade e fonte, `noAcesso`), `acessos[]`, `nos[]` (`xy` em coordenadas da planta), `arestas[]` (`sentido`: `unico` · `duplo` · `a-confirmar`) e `ligacoesEntreNiveis[]`. A base vetorial (`base-vetorial.json`) é só visual.

## 4. API REST (`/api`)

| Método | Rota | Corpo / parâmetros | Resposta | Quem usa |
|---|---|---|---|---|
| `GET` | `/regioes` | — | `Regiao[]` | painel, totem |
| `PATCH` | `/regioes/:id` | `{ operacional?, capacidade? }` | `Regiao` | painel (operador), simulador |
| `GET` | `/mapa` | — | `MapaDigital` | web |
| `POST` | `/entradas` | `{ acessoId, categoria, placa? }` | `{ ticket: Ticket, recomendacao: Recomendacao, qrUrl: string }` | totem, simulador |
| `POST` | `/tickets/:codigo/estacionar` | `{ regiaoId? }` (padrão: recomendada) | `{ ticket, regiao }` | painel, simulador |
| `POST` | `/tickets/:codigo/saida` | — | `{ ticket, regiao }` — **Etapa 2: só ticket `ESTACIONADO`** (senão 409 `TRANSICAO_INVALIDA`) | painel, simulador |
| `POST` | `/tickets/:codigo/recomendacao` | — | `{ ticket, recomendacao, motivo }` — nova recomendação (ticket `AGUARDANDO`) | totem, simulador |
| `POST` | `/tickets/:codigo/cancelar` | — | `{ ticket }` — desistência antes de estacionar | painel, simulador |
| `GET` | `/tickets` | `?status=&limite=` | `Ticket[]` | painel |
| `GET` | `/recomendacoes` | `?limite=20` | `Recomendacao[]` | painel |
| `GET` | `/localizador/:token` | — | `{ ticket: Pick<Ticket,'codigo'\|'entradaEm'\|'status'\|'categoria'\|'estacionadoEm'\|'saidaEm'>, regiao: Regiao \| null, recomendada: Regiao, orientacao: string[] }`. `regiao` é a região **registrada** na confirmação; `estacionadoEm` e `saidaEm` foram adicionados na Etapa 3 | localizador |
| `GET` | `/indicadores` | — | `{ capacidadeTotal, ocupadas, livres, taxaOcupacao, veiculosAguardando, recomendacoesUltimaHora, regioesAltaOcupacao: string[] }` | painel |
| `POST` | `/sensores/eventos` | `EventoSensor` (token) | `{ eventoId, resultado, mensagem?, resultadoOriginal? }` | sensores virtuais (e reais, no futuro) |
| `GET` | `/simulacao` | — | estado do simulador + `veiculosSimuladosAtivos` (Etapa 3) | painel |
| `GET` | `/simulacao/cenarios` | — | `{ id, nome, descricao, ocupacaoInicial, entradasPorMinuto }[]` (Etapa 3) | painel |
| `POST` | `/simulacao/iniciar` · `pausar` · `retomar` · `encerrar` · `reiniciar` | (token) | estado | painel |
| `PATCH` | `/simulacao/config` | `ConfigSimulacao` parcial (token) | estado | painel |
| `POST` | `/simulacao/cenario` | `{ cenario: 'A'..'E', config? }` (token) | estado | painel |
| `POST` | `/simulacao/eventos` | evento manual (token) | resultado | painel, apresentações |

Detalhes do simulador, dos sensores e das mudanças da Etapa 2: [08-simulador.md](08-simulador.md). A comparação ParkVision × tradicional (`/metricas/comparacao`) fica para a Etapa 5.

**Erros** (sempre `{ erro: { codigo, mensagem, detalhes? } }`):

| Código | HTTP | Quando |
|---|---|---|
| `DADOS_INVALIDOS` | 400 | Corpo fora do schema (Zod) |
| `SEM_REGIAO_ELEGIVEL` | 409 | Nenhuma região aceita o veículo agora; `detalhes` traz as avaliações |
| `TICKET_NAO_ENCONTRADO` | 404 | Código ou token inexistente |
| `TRANSICAO_INVALIDA` | 409 | Ex.: estacionar um ticket que já saiu |
| `REGIAO_LOTADA` | 409 | Confirmação em região sem vaga livre |
| `REGIAO_INDISPONIVEL` | 409 | Confirmação em região fora de operação (Etapa 2) |
| `CATEGORIA_INCOMPATIVEL` | 409 | Região não aceita a categoria do veículo |
| `NAO_AUTORIZADO` | 401 | Rota do simulador/sensores sem `x-simulador-token` válido |
| `SIMULACAO_ESTADO_INVALIDO` | 409 | Ex.: pausar uma simulação parada |

## 5. Tempo real (Socket.IO)

Desde a Etapa 2, todo evento sai num envelope padronizado (`EventoTempoReal`):

```ts
{ id: string /* uuid */; tipo: TipoEvento; ocorridoEm: string /* ISO */; entidadeId: string; simulado: boolean; dados: ... }
```

**Namespace `/painel`**: cada evento é emitido no canal com o nome do `tipo` e no canal agregado `evento`.

| Evento | `dados` | Disparado quando |
|---|---|---|
| `veiculo:entrou` | `{ ticket, recomendacao }` | Nova entrada (totem ou simulador) |
| `veiculo:recomendado` | `{ ticket, recomendacao, motivo }` | Nova recomendação (ex.: região lotou antes da confirmação) |
| `veiculo:estacionou` | `{ ticket, regiao }` | Confirmação |
| `veiculo:saiu` | `{ ticket, regiao \| null }` | Saída (ou cancelamento, com `regiao: null`) |
| `regiao:ocupacao` | `Regiao` | A ocupação muda |
| `regiao:fluxo` | `Regiao` | Leitura de fluxo dos sensores |
| `regiao:status` | `Regiao` | Operação ou estado dos sensores muda |
| `indicadores:atualizados` | `Indicadores` | Após qualquer mudança acima |
| `simulador:estado` · `simulador:cenario` · `simulador:sensor` · `simulador:alerta` | ver [08-simulador.md](08-simulador.md) §7 | Controle e eventos do simulador |

Na Etapa 1, os nomes eram `ticket:criado`, `ticket:estacionado`, `ticket:saida` e `regiao:atualizada`. Eles foram substituídos pelos acima.

**Namespace `/simulador`**: recebe os eventos `simulador:*` e exige `auth: { token: SIMULADOR_TOKEN }`.

## 6. Simulador

O simulador roda dentro da API (`apps/api/src/simulador/`) e usa os mesmos serviços das rotas REST. Os detalhes estão em [08-simulador.md](08-simulador.md): estado, configuração, cenários A–E, sensores virtuais e reinício seguro.

Cada veículo simulado faz este ciclo:

1. Entrada.
2. Tempo de manobra.
3. Confirmação, via evento de sensor `VAGA_OCUPADA` com ticket e chance de ir para outra região.
4. Se a confirmação for rejeitada, nova recomendação.
5. Permanência.
6. Saída (`VAGA_LIBERADA`).

## 7. Rotas da web

| Rota | Interface | Observação |
|---|---|---|
| `/totem?acesso=A_NE` | Totem de entrada | O acesso fica fixo por totem |
| `/painel` | Dashboard administrativo | Inclui o controle do simulador |
| `/t/:token` | Localizador de veículo | Aberto pelo QR Code; não exige login |

## 8. Responsáveis pelos contratos

| Contrato | Dono | Consumidores |
|---|---|---|
| Tipos e schemas (`packages/shared`) | project-architect | todos |
| `recomendar()` / `menorCaminho()` | algorithm-engineer | backend |
| REST + Socket.IO | backend-engineer | frontend, simulador |
| `MapaDigital` (arquivo do mapa) | project-architect + frontend-designer | backend, algoritmo, frontend |
| Cenários do simulador | backend-engineer | qa, painel |
