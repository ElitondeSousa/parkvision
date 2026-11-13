# Componentes — contratos iniciais

Especificação de API dos componentes do Design System ParkVision, para orientar a implementação em React (Fase 1). A demonstração visual de cada um está em [`prototype/index.html#design-system`](../../prototype/index.html). Regras gerais em [`docs/04-design-system.md`](../../docs/04-design-system.md).

**Convenções**

- Um componente = uma pasta: `Button/Button.tsx`, `Button.module.css`, `Button.stories.tsx`, `index.ts`.
- CSS só com `var(--pv-*)` (camada semântica ou de componente). Nada de hex.
- Todo componente interativo aceita `className`, repassa `ref` e atributos ARIA.
- Estados de vaga usam o tipo compartilhado `EstadoVaga` (mesmo enum do banco — `backend/prisma/schema.prisma`).

## Tipos compartilhados

```ts
/** Igual ao enum do Prisma + estado de interface "CARREGANDO". */
export type EstadoVaga = 'LIVRE' | 'OCUPADA' | 'RESERVADA' | 'INDISPONIVEL' | 'MANUTENCAO' | 'ERRO';
export type EstadoVisual = EstadoVaga | 'CARREGANDO';

export type CategoriaVeiculo = 'MOTO' | 'CARRO_PEQUENO' | 'CARRO_GRANDE';
export type FaixaOcupacao = 'NORMAL' | 'ALTA' | 'LOTADA'; // <70% · 70–89% · ≥90%
export type Tom = 'info' | 'sucesso' | 'atencao' | 'erro';
export type Tamanho = 'sm' | 'md' | 'lg';

/** Mapa único estado → apresentação. Fonte de verdade para mapa, badges e legenda. */
export const ESTADO_VAGA: Record<EstadoVisual, { rotulo: string; codigo: string; icone: string; token: string; padrao: string }> = {
  LIVRE:        { rotulo: 'Livre',          codigo: 'L', icone: 'circle-check',   token: 'livre',        padrao: 'solido' },
  OCUPADA:      { rotulo: 'Ocupada',        codigo: 'O', icone: 'car',            token: 'ocupada',      padrao: 'solido' },
  RESERVADA:    { rotulo: 'Reservada',      codigo: 'R', icone: 'clock',          token: 'reservada',    padrao: 'contorno-duplo' },
  INDISPONIVEL: { rotulo: 'Indisponível',   codigo: 'X', icone: 'ban',            token: 'indisponivel', padrao: 'hachura' },
  MANUTENCAO:   { rotulo: 'Em manutenção',  codigo: 'M', icone: 'wrench',         token: 'manutencao',   padrao: 'listras' },
  ERRO:         { rotulo: 'Erro de sensor', codigo: 'E', icone: 'triangle-alert', token: 'erro',         padrao: 'tracejado' },
  CARREGANDO:   { rotulo: 'Atualizando…',   codigo: '·', icone: 'loader',         token: 'carregamento', padrao: 'shimmer' },
};

export const faixaOcupacao = (pct: number): FaixaOcupacao => (pct >= 90 ? 'LOTADA' : pct >= 70 ? 'ALTA' : 'NORMAL');
```

## Fundamentos

| Componente | Props principais | Acessibilidade |
|---|---|---|
| `Button` | `variant: 'primary' \| 'secondary' \| 'ghost' \| 'danger'`, `size: Tamanho`, `iconLeft?`, `iconRight?`, `loading?`, `disabled?` | `<button>` nativo; `aria-busy` em loading; rótulo obrigatório mesmo com só ícone (`aria-label`) |
| `Icon` | `name`, `size: 16 \| 20 \| 24`, `label?` | Decorativo → `aria-hidden`; informativo → `role="img"` + `aria-label` |
| `Card` | `variant: 'default' \| 'interactive'`, `title?`, `actions?`, `loading?` | Interativo vira `<a>`/`<button>` inteiro, não `div` clicável |
| `StatCard` | `label`, `value: number \| string`, `unit?`, `trend?: { valor: number; direcao: 'up' \| 'down' }`, `icon?`, `loading?` | Valor com `tabular-nums`; tendência descrita em texto ("+4% vs. 1 h atrás") |
| `StatusBadge` | `estado: EstadoVisual` **ou** `tom: Tom` + `label`, `size?: 'sm' \| 'md'`, `showIcon = true` | Ícone + texto sempre; nunca só cor |
| `Alert` | `tom: Tom`, `title`, `children`, `onDismiss?` | `role="alert"` para erro, `role="status"` para os demais |
| `Toast` | igual a `Alert` + `duration` | Região `aria-live="polite"` única |
| `Modal` / `Drawer` | `open`, `onClose`, `title`, `size?`, `footer?` | Foco preso, `Esc` fecha, devolve foco ao gatilho, `aria-modal` |
| `Skeleton` | `variant: 'text' \| 'card' \| 'spot'`, `lines?` | `aria-hidden`; container com `aria-busy="true"` |
| `Stepper` | `steps: string[]`, `current: number` | `aria-current="step"` |

## Formulário

| Componente | Props principais | Estados |
|---|---|---|
| `TextField` | `label`, `name`, `value`, `onChange`, `hint?`, `error?`, `iconLeft?`, `type?`, `disabled?`, `readOnly?` | default · focus · erro (borda + ícone + mensagem ligada por `aria-describedby`) · disabled · read-only |
| `Select` | `label`, `options: { value; label; disabled? }[]`, `error?` | idem |
| `Toggle` | `label`, `checked`, `onChange`, `description?` | on · off · disabled — `role="switch"` |
| `NumberField` | `label`, `min`, `max`, `step`, `unit?` | idem `TextField` |

## Dados e navegação

| Componente | Props principais | Observações |
|---|---|---|
| `DataTable<T>` | `columns: { key; header; render?; align?; width? }[]`, `rows: T[]`, `loading?`, `empty?: ReactNode`, `onRowClick?`, `pagination?` | Estados vazio/carregando/erro obrigatórios; cabeçalho `<th scope="col">` |
| `Sidebar` | `items: { id; label; icon; href; badge? }[]`, `activeId`, `collapsed?` | Item ativo com indicador âmbar + `aria-current="page"` |
| `Header` | `title`, `subtitle?`, `actions?`, `breadcrumbs?` | `<header>` com `<h1>` da tela |
| `Tabs` | `tabs: { id; label }[]`, `active`, `onChange` | Padrão WAI-ARIA Tabs (setas do teclado) |
| `LineChart` / `BarChart` | `data`, `series: { key; label; tokenCor }[]`, `height?` | Cores só de `--pv-chart-*`; resumo textual + tabela alternativa |

## Domínio ParkVision

| Componente | Props principais | Observações |
|---|---|---|
| `ParkingSpot` | `codigo`, `estado: EstadoVisual`, `tipo: 'carro' \| 'moto' \| 'pcd'`, `rotacao?: 0 \| 90 \| 180 \| 270`, `selecionada?`, `reservadaAteMin?`, `onSelect?` | Mostra código de letra + padrão do estado; `aria-label="Vaga Z2-B-17, livre, carro pequeno"`; tamanho via `--pv-spot-*` |
| `OccupancyMeter` | `ocupadas`, `total`, `variant: 'bar' \| 'ring'`, `showLabel = true` | Faixa (Normal/Alta/Lotada) escrita ao lado; `role="meter"` com `aria-valuenow/min/max` |
| `ZoneCard` | `codigo`, `nome`, `livres`, `total`, `porCategoria?`, `saudeSensores`, `elegivel?`, `motivoInelegivel?`, `selecionada?` | Usado no Dashboard, Mapa e Distribuição |
| `ZoneOverlay` | `poligono: [x, y][]`, `codigo`, `faixa: FaixaOcupacao`, `selecionada?` | Desenhado sobre a planta real (SVG). 🗺️ Depende da planta |
| `RouteLine` | `pontos: [x, y][]`, `ativa?` | Âmbar `--pv-wayfinding-route`, com setas de sentido |
| `ScoreBreakdown` | `criterios: { nome; peso; valor }[]`, `score` | Mostra a justificativa da recomendação (Tela 3) |
| `TicketPreview` | `ticketId`, `codigoCurto`, `entradaEm`, `categoria`, `zona`, `setor`, `orientacao`, `qrUrl` | Simula impressão térmica 80 mm (monocromático) |
| `SignagePanel` | `linhas: { zona; seta: 'ESQUERDA' \| 'DIREITA' \| 'FRENTE' \| 'SUBIR' \| 'DESCER'; livres }[]`, `modo: 'NORMAL' \| 'LOTADO' \| 'FALHA'` | Mesmo payload do tópico MQTT `.../painel/{id}/display` |
| `SensorHealth` | `online`, `offline`, `erro` | Barra segmentada + números |
