<p align="center">
  <img src="design-system/brand/logo-horizontal.svg" alt="ParkVision" width="260">
</p>

# ParkVision — Estacionamento Inteligente

Sistema que **organiza e distribui automaticamente os veículos** em estacionamentos de shopping centers: monitora as vagas em tempo real, recomenda a melhor zona na entrada, imprime um ticket com a orientação, guia o motorista por sinalização luminosa (sem exigir aplicativo) e permite pagar pelo QR Code do ticket.

### ▶ [Abrir o protótipo das telas](https://elitondesousa.github.io/parkvision/prototype/)

As 6 telas (Visão geral, Mapa de vagas, Distribuição inteligente, Veículos e tickets, Pagamento por QR Code, Configurações) e a vitrine do Design System, direto no navegador.

> **Status atual: planejamento técnico inicial** (1ª entrega — 13/11/2026). Ainda não há MVP funcional; esta etapa entrega documentação, arquitetura, Design System e protótipo visual das telas.
>
> 🗺️ **Planta recebida em 13/11/2026** (Capim Dourado Shopping): análise e proposta inicial de zonas em [docs/10-analise-planta.md](docs/10-analise-planta.md). Subsolo 1 com 140 vagas, Subsolo 2 com 216 vagas, pátios descobertos norte e sul (quantidade a contar). O mapa interativo do protótipo ainda usa uma simulação rotulada como exemplo.

## Objetivo

Reduzir filas, congestionamentos internos e o tempo de procura por vaga fazendo com que **o próprio estacionamento** direcione cada veículo para a região mais adequada, considerando disponibilidade, distância, fluxo e a saúde dos sensores.

## Funcionalidades previstas

| # | Funcionalidade | Resumo |
|---|---|---|
| 1 | Monitoramento de vagas | Sensores (ultrassônicos/magnéticos) informam vaga livre/ocupada em tempo real via MQTT |
| 2 | Distribuição inteligente | Score por zona: disponibilidade (40%), distância pela rota (25%), fluxo (25%), saúde dos sensores (10%) |
| 3 | Classificação de veículos | Moto, carro pequeno, carro grande (+ necessidade PcD/idoso) → vagas compatíveis |
| 4 | Ticket de entrada | Impresso com zona, setor, orientação, QR Code e código curto |
| 5 | Sinalização inteligente | Painéis de LED com zona, seta e vagas livres |
| 6 | Painel administrativo | Ocupação geral e por zona, sensores, movimentação, histórico |
| 7 | Localização do veículo | Zona/setor registrados no ticket e na página do QR |
| 8 | Pagamento por QR Code | Página mobile com valor e Pix (simulado nesta etapa) |
| 9 | Acessibilidade | Todo o fluxo funciona sem smartphone; caixa e sinalização física continuam |

## Tecnologias

| Camada | Escolha |
|---|---|
| Linguagem | **TypeScript** (C++ no firmware ESP32) |
| Frontend | React 19 + Vite · CSS Modules + tokens do Design System · Recharts · Lucide · Storybook |
| Backend | Node.js 24 LTS + NestJS · Prisma |
| Banco de dados | PostgreSQL 16 |
| IoT | ESP32 + HC-SR04 (maquete) / magnetômetro QMC5883L (produção) · MQTT (Eclipse Mosquitto) |
| Tempo real | WebSocket (Socket.IO) para as telas · MQTT para dispositivos |
| Pagamentos | Interface `PaymentProvider` (mock) → gateway com Pix no MVP |
| Infra | Docker Compose · deploy de demonstração em PaaS |
| Gestão | Geproj (To Host) |
| **Tecnologia sorteada** | **Design System** — tokens em 3 camadas, componentes, estados, governança |

Justificativas em [docs/08-decisoes-tecnicas.md](docs/08-decisoes-tecnicas.md).

## Documentação

| Documento | Conteúdo |
|---|---|
| [01 — Visão Geral](docs/01-visao-geral.md) | Problema, objetivo, solução, público-alvo, benefícios |
| [02 — Requisitos](docs/02-requisitos.md) | Funcionais, não funcionais, regras de negócio, rastreabilidade |
| [03 — Arquitetura Técnica](docs/03-arquitetura.md) | Stack, módulos, fluxos, MQTT/API, banco, IoT, QR, pagamentos, segurança |
| [04 — Design System](docs/04-design-system.md) | Identidade, tokens, componentes, estados, regras, governança |
| [05 — Estrutura das Telas](docs/05-telas.md) | As 6 telas, componentes, navegação |
| [06 — Tecnologia Sorteada](docs/06-tecnologia-sorteada.md) | Design System: o que é, por que, como aplicar, exemplos |
| [07 — Cronograma e Roadmap](docs/07-roadmap.md) | Fases até o MVP, riscos, uso do Geproj |
| [08 — Decisões Técnicas](docs/08-decisoes-tecnicas.md) | Alternativas avaliadas, escolhas, limitações |
| [09 — Distribuição Inteligente](docs/09-distribuicao-inteligente.md) | Fórmula, algoritmo, exemplo, concorrência, reserva × recomendação |
| [10 — Análise da planta](docs/10-analise-planta.md) | Estrutura do Capim Dourado Shopping, proposta de zonas, pontos de sensores e painéis, limitações |
| [Adaptação à planta](docs/adaptacao-planta.md) | O que ainda falta adaptar à planta real |
| [Diagramas](docs/diagrams/) | Arquitetura, entrada, distribuição, pagamento, sensores, modelo de dados (Mermaid) |
| [Checklist da 1ª entrega](docs/CHECKLIST-PRIMEIRA-ENTREGA.md) | Requisito → evidência → status |

## Protótipo e Design System

- **Protótipo navegável das telas:** abra [`prototype/index.html`](prototype/index.html) no navegador (não precisa de build). Inclui as 6 telas e a página **Design System** (vitrine viva), com tema claro/escuro.
- **Tokens:** edite [`design-system/tokens/tokens.json`](design-system/tokens/tokens.json) e gere o CSS:

```bash
node design-system/scripts/build-tokens.mjs
```

```bash
node design-system/scripts/check-contrast.mjs
```

## Estrutura de pastas

```
.
├── README.md
├── docs/                         # documentação da 1ª entrega (01–10, checklist, diagramas)
│   ├── diagrams/                 # diagramas Mermaid
│   └── planta/                   # planta recebida (PDF + imagens)
├── design-system/
│   ├── tokens/tokens.json        # fonte da verdade dos tokens (W3C Design Tokens)
│   ├── tokens/build/             # CSS e JSON gerados
│   ├── brand/                    # logotipo e símbolo (SVG)
│   ├── components/README.md      # contratos dos componentes
│   └── scripts/                  # build de tokens e verificação de contraste
├── prototype/                    # protótipo HTML navegável (consome os tokens)
└── backend/
    └── prisma/schema.prisma      # modelo de dados inicial (validado)
```

Pastas `frontend/`, `simulator/` e `firmware/` serão criadas nas fases 1–3 (estrutura planejada em [docs/03-arquitetura.md §4](docs/03-arquitetura.md#4-organização-dos-módulos)).

## Como o projeto será desenvolvido

1. **F0 — Planejamento técnico** (esta entrega).
2. **F1 — Protótipo React** com os componentes do Design System documentados no Storybook e dados simulados.
3. **F2 — Backend** NestJS + PostgreSQL: API, WebSocket, algoritmo de distribuição, tickets, pagamento mock.
4. **F3 — Sensores e sinalização:** simulador MQTT → maquete com ESP32 + HC-SR04 e painel de LED.
5. **F4 — Testes:** unitários, integração, simulação de carga do algoritmo, acessibilidade.
6. **F5 — MVP:** demonstração ponta a ponta.

Cronograma, riscos e organização no Geproj: [docs/07-roadmap.md](docs/07-roadmap.md).
