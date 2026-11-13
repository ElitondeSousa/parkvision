# 08 — Decisões Técnicas

Registro das decisões de arquitetura (formato ADR resumido). Critérios usados em todas as decisões, conforme o enunciado: **facilidade de desenvolvimento**, **baixo custo inicial**, **facilidade de demonstração**, **documentação disponível**, **possibilidade de expansão** e **compatibilidade com IoT**.

Legenda das notas: ●●● forte · ●●○ médio · ●○○ fraco.

---

## DT-01 — Linguagem: TypeScript em todo o projeto

| Opção | Facilidade | Custo | Docs | Expansão | IoT | Observação |
|---|---|---|---|---|---|---|
| **TypeScript (Node.js)** ✅ | ●●● | ●●● | ●●● | ●●● | ●●○ | Mesmo idioma no front, back, simulador e scripts de tokens |
| Python (FastAPI) | ●●● | ●●● | ●●● | ●●○ | ●●● | Ótimo para IoT/visão computacional, mas o front exigiria outra linguagem |
| Java (Spring Boot) | ●○○ | ●●○ | ●●● | ●●● | ●●○ | Robusto, porém verboso para o prazo acadêmico |

**Decisão:** TypeScript. **Justificativa:** uma única linguagem para a equipe inteira, tipos compartilhados entre camadas (ex.: `EstadoVaga` é o mesmo no Prisma, na API e nos componentes), ecossistema npm amplo. **Exceção prevista:** firmware do ESP32 em C++ (Arduino/PlatformIO); visão computacional futura poderá usar Python como serviço separado.

## DT-02 — Frontend: React 19 + Vite

| Opção | Prós | Contras |
|---|---|---|
| **React + Vite** ✅ | Maior ecossistema, componentização ideal para Design System, Storybook maduro, build/dev muito rápidos, deploy estático simples | SPA: SEO irrelevante aqui (painel interno) |
| Next.js | SSR, rotas por arquivo | Complexidade extra (server components) sem ganho para painel interno com dados em tempo real |
| Angular | Estrutura completa | Curva de aprendizado maior |
| Vue 3 | Simples | Ecossistema de Design System/Storybook menor; equipe tem menos familiaridade presumida com React |

**Estilo:** CSS Modules + variáveis CSS dos tokens (avaliado Tailwind: produtivo, mas duplicaria a fonte da verdade dos tokens e incentiva classes utilitárias fora do Design System; pode ser adotado depois mapeando o tema para `var(--pv-*)`). **Gráficos:** Recharts. **Ícones:** Lucide. **Documentação de componentes:** Storybook 9.

## DT-03 — Backend: Node.js 24 LTS + NestJS

| Opção | Prós | Contras |
|---|---|---|
| **NestJS** ✅ | Módulos e injeção de dependência (organização clara por domínio), **WebSocket Gateway** e **transporte MQTT** nativos, validação por DTO, OpenAPI automático | Mais conceitos que Express puro |
| Express/Fastify puro | Simples, leve | Organização fica a cargo da equipe; MQTT/WebSocket montados à mão |
| FastAPI (Python) | Ótimo desempenho e docs automáticas | Quebra a unificação de linguagem |

## DT-04 — Banco de dados: PostgreSQL 16 + Prisma

| Opção | Prós | Contras |
|---|---|---|
| **PostgreSQL** ✅ | ACID (tickets/pagamentos), `FOR UPDATE SKIP LOCKED` para reservas sem conflito, JSONB para justificativas e regras de tarifa, extensão TimescaleDB para séries temporais | Exige servidor (resolvido com Docker) |
| MongoDB | Esquema flexível | Transações e relacionamentos (ticket ↔ pagamento ↔ vaga) menos naturais |
| SQLite | Zero configuração | Concorrência limitada; não serve para múltiplos totens |
| InfluxDB (só histórico) | Excelente para séries temporais | Segundo banco cedo demais; snapshots por minuto no Postgres bastam na escala do projeto |

**ORM Prisma:** esquema declarativo legível (serve como documentação — [backend/prisma/schema.prisma](../backend/prisma/schema.prisma), validado com `prisma validate`), migrações e tipos gerados. Consultas críticas de concorrência em SQL puro (`$queryRaw`).

## DT-05 — Comunicação com dispositivos: MQTT (Mosquitto)

| Opção | Prós | Contras |
|---|---|---|
| **MQTT** ✅ | Leve (ideal ESP32), publish/subscribe, QoS 1, **mensagens retidas** (painel recupera estado ao religar), **Last Will** (detecção de sensor offline sem polling) | Requer broker |
| HTTP REST do sensor para o backend | Simples | Polling/overhead, sem detecção nativa de queda, sem push para painéis |
| WebSocket direto no ESP32 | Bidirecional | Mais pesado, sem QoS/retenção |
| LoRaWAN | Longo alcance, baixo consumo | Precisa de gateway e servidor de rede; **candidato para produção** em subsolos |

## DT-06 — Tempo real nas telas: WebSocket (Socket.IO)

MQTT fica restrito aos dispositivos (rede interna, ACL por tópico). Navegadores recebem eventos já **agregados e autorizados** pelo backend via Socket.IO (reconexão automática, salas por estabelecimento/pavimento). Alternativas: SSE (unidirecional, suficiente para o painel, mas Socket.IO facilita comandos futuros); MQTT sobre WebSocket direto no navegador (descartado: exporia o broker e a lógica de agregação ao cliente).

## DT-07 — Sensores de vaga

| Opção | Decisão |
|---|---|
| **Ultrassônico HC-SR04 + ESP32** | ✅ Protótipo/maquete — custo muito baixo, fácil de demonstrar |
| **Magnetômetro QMC5883L no piso** | ✅ Recomendado para produção — robusto, imune a luz |
| Ultrassônico industrial com LED | Alternativa de produção em áreas cobertas |
| Câmeras + visão computacional | Futuro (também viabiliza LPR) |

Detalhes e comparação: [03-arquitetura.md §7](03-arquitetura.md#7-iot-e-monitoramento).

## DT-08 — Distribuição: recomendação de zona na v1

Recomendação de **zona + setor sugerido** com score ponderado e desconto de veículos em trânsito; **reserva de vaga individual** fica como evolução (estrutura já modelada). Motivo: entrega valor com menos dependência de hardware por vaga e menor risco de vagas "presas". Ver [09-distribuicao-inteligente.md](09-distribuicao-inteligente.md).

## DT-09 — Classificação de veículos na v1: seleção no totem

| Opção | Decisão |
|---|---|
| **Botões no totem** (Moto / Carro pequeno / Carro grande / necessidade PcD) | ✅ v1 — zero custo de hardware, inclusivo |
| Barreira infravermelha de altura/comprimento na entrada | Planejado para validar a seleção (Fase 3) |
| Câmera + classificação por visão computacional / LPR | Fora do escopo desta etapa |

Faixas de motos podem ter entrada própria, se a planta indicar 🗺️.

## DT-10 — QR Code: token opaco

O QR leva apenas `https://<dominio>/t/{token}`, com token aleatório de 128 bits; o banco guarda só o hash SHA-256. Rejeitados: ID sequencial (enumerável), JWT com dados do ticket no QR (expõe informação e dificulta revogação), placa no QR (dado pessoal). Ver [03-arquitetura.md §8](03-arquitetura.md#8-ticket-e-qr-code).

## DT-11 — Pagamentos: adaptador + mock

Interface `PaymentProvider` com `MockProvider` na demonstração; gateway real com Pix escolhido no MVP entre **Mercado Pago**, **Pagar.me** e **Asaas** (critérios: taxa Pix, sandbox, webhook assinado, documentação em português). Sem dados de cartão no sistema. **Nada de pagamento real nesta etapa.**

## DT-12 — Infraestrutura

- **Desenvolvimento/demonstração:** Docker Compose (postgres, mosquitto, backend, frontend, simulador).
- **Demonstração online:** frontend estático (ex.: Vercel), backend + Postgres em PaaS (ex.: Render/Railway) — planos gratuitos/baratos.
- **Produção (visão):** servidor de borda no shopping, operação independente de internet, sincronização com nuvem.

## DT-13 — Design System com tokens em JSON (W3C) + script próprio

| Opção | Decisão |
|---|---|
| **`tokens.json` (formato W3C) + script Node próprio** | ✅ Sem dependências, entendível pela equipe, gera CSS e JSON resolvido para hardware, valida temas e contraste |
| Style Dictionary (Amazon) | Alternativa madura se o número de plataformas crescer — o formato do JSON já é compatível |
| Tokens só no Figma | Não versionado com o código; risco de divergência |

A arquitetura de 3 camadas (primitivo → semântico → componente) segue a prática consolidada de mercado para tokens (W3C Design Tokens).

## DT-14 — Gestão do projeto: Geproj (To Host)

Ferramenta patrocinadora ([geproj.tohost.io](https://geproj.tohost.io)). **Não foi verificada API pública/integração automática** — o uso previsto é manual (etapas, tarefas, responsáveis, cronograma, entregáveis vinculados aos arquivos do repositório). Ver [07-roadmap.md](07-roadmap.md).

---

## Limitações conhecidas

| Limitação | Impacto | Tratamento |
|---|---|---|
| **Planta recebida é comercial (Planta Mix), não executiva** | Sem escala geral, sem cotas nos subsolos, sem contagem dos pátios descobertos e de motos; ligação entre subsolos pouco legível | Proposta de zonas baseada no que está desenhado; pendências listadas em [10-analise-planta.md](10-analise-planta.md); modelo de dados genérico absorve a estrutura real |
| Classificação veicular depende do motorista na v1 | Possível seleção errada | Validação por barreira IR (Fase 3); operador pode corrigir |
| HC-SR04 não é adequado para ambiente real | Leituras falsas com poeira/temperatura | Usado só em maquete; produção com magnetômetro |
| Wi-Fi em subsolo | Perda de conectividade dos sensores | Avaliar RS-485/Ethernet ou LoRaWAN após a planta |
| Recomendação de zona não garante vaga | Motorista pode encontrar zona cheia em pico | Desconto de veículos em trânsito + atualização dos painéis; reserva individual como evolução |
| Pesos do algoritmo definidos por hipótese | Distribuição pode não ser ótima | Calibrar com simulação e dados reais |
| Integração Geproj não verificada | Sem automação de tarefas | Uso manual documentado |
| Protótipo de telas em HTML estático | Não é o frontend final | Serve como especificação visual; reconstrução em React na Fase 1 |

## Alternativas futuras

- **TimescaleDB** para histórico de alta frequência; **Redis** para estado ao vivo e filas leves.
- **LoRaWAN** ou cabeamento por corredor para sensores em produção.
- **Visão computacional** (câmeras por zona) substituindo sensores individuais em áreas abertas, e **LPR** para localizar o veículo pela placa.
- **App mobile / PWA** com localização do veículo e reserva antecipada.
- **Style Dictionary + Tokens Studio (Figma)** se o Design System passar a ter mais plataformas.
- **Multiunidade (vários shoppings)**: o modelo já tem `Estabelecimento`; tokens permitem tema por unidade.
