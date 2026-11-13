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
| `POST` | `/tickets/:codigo/saida` | — | `{ ticket, regiao? }` | painel, simulador |
| `GET` | `/tickets` | `?status=&limite=` | `Ticket[]` | painel |
| `GET` | `/recomendacoes` | `?limite=20` | `Recomendacao[]` | painel |
| `GET` | `/localizador/:token` | — | `{ ticket: Pick<Ticket,'codigo'\|'entradaEm'\|'status'\|'categoria'>, regiao: Regiao \| null, recomendada: Regiao, orientacao: string[] }` | localizador |
| `GET` | `/indicadores` | — | `{ capacidadeTotal, ocupadas, livres, taxaOcupacao, veiculosAguardando, recomendacoesHora, regioesAltaOcupacao: string[] }` | painel |
| `GET` | `/simulacao` | — | `EstadoSimulacao` | painel |
| `POST` | `/simulacao/comando` | `{ acao: 'iniciar'\|'pausar'\|'reiniciar', cenario?, velocidade? }` | `EstadoSimulacao` | painel |
| `GET` | `/metricas/comparacao` | — | métricas ParkVision × tradicional, **marcadas `simulado: true`** | painel |

**Erros** (sempre `{ erro: { codigo, mensagem, detalhes? } }`):

| Código | HTTP | Quando |
|---|---|---|
| `DADOS_INVALIDOS` | 400 | Corpo fora do schema (Zod) |
| `SEM_REGIAO_ELEGIVEL` | 409 | Nenhuma região aceita o veículo agora; `detalhes` traz as avaliações |
| `TICKET_NAO_ENCONTRADO` | 404 | Código ou token inexistente |
| `TRANSICAO_INVALIDA` | 409 | Ex.: estacionar um ticket que já saiu |
| `REGIAO_LOTADA` | 409 | Confirmação em região sem vaga livre |

## 5. Tempo real (Socket.IO)

**Namespace `/painel`** (servidor → clientes web):

| Evento | Payload | Disparado quando |
|---|---|---|
| `regiao:atualizada` | `Regiao` | Ocupação, capacidade ou operação muda |
| `ticket:criado` | `{ ticket, recomendacao }` | Nova entrada no totem ou no simulador |
| `ticket:estacionado` | `{ ticket, regiao }` | Confirmação |
| `ticket:saida` | `{ ticket, regiao }` | Saída |
| `indicadores:atualizados` | `Indicadores` | Após qualquer mudança acima (no máx. 1 por segundo) |
| `simulacao:estado` | `EstadoSimulacao` | Início, pausa, troca de cenário |

**Namespace `/simulador`** (servidor → simulador): `simulacao:comando` `{ acao, cenario?, velocidade? }`. O simulador autentica com `SIMULADOR_TOKEN` (variável de ambiente) e envia os eventos pelos **mesmos endpoints REST** do totem e do painel.

## 6. Simulador

```ts
export interface EstadoSimulacao {
  status: 'PARADA' | 'RODANDO' | 'PAUSADA';
  cenario: 'normal' | 'pico' | 'regiao-lotada' | 'regiao-indisponivel';
  velocidade: 1 | 5 | 20;
  relogioSimulado: string;
  regiaoAlvo?: string;           // para os cenários lotada/indisponível
  estrategia: 'parkvision' | 'tradicional';
}
```

Ciclo por veículo simulado: `POST /entradas` → espera (tempo de manobra) → `POST /tickets/:codigo/estacionar` (com chance configurável de parar em outra região) → permanência → `POST /tickets/:codigo/saida`.

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
