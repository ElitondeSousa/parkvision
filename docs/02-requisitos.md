# 02 — Requisitos

> **Projeto:** ParkVision — Estacionamento Inteligente · **Etapa:** 1ª entrega — Planejamento Técnico (13/11/2026)
> **Status da planta:** **PENDENTE.** Requisitos que dependem da planta (quantidade de zonas, vagas, painéis, rotas) estão marcados com 🗺️ e serão refinados após o recebimento — ver [adaptacao-planta.md](adaptacao-planta.md).

---

## Sumário

1. [Convenções](#1-convenções)
2. [Requisitos Funcionais (RF)](#2-requisitos-funcionais-rf)
3. [Requisitos Não Funcionais (RNF)](#3-requisitos-não-funcionais-rnf)
4. [Restrições do projeto](#4-restrições-do-projeto)
5. [Regras de Negócio (RN)](#5-regras-de-negócio-rn)
6. [Matriz de rastreabilidade RF → Telas](#6-matriz-de-rastreabilidade-rf--telas)

---

## 1. Convenções

### 1.1 Identificadores

| Prefixo | Significado |
|---------|-------------|
| `RFxx` | Requisito Funcional |
| `RNFxx` | Requisito Não Funcional |
| `RTxx` | Restrição do projeto |
| `RNxx` | Regra de Negócio |
| 🗺️ | Depende da planta real (pendente) |

### 1.2 Prioridade (MoSCoW)

| Sigla | Significado |
|-------|-------------|
| **M** — *Must* | Obrigatório para o MVP. |
| **S** — *Should* | Importante; entra no MVP se o prazo permitir. |
| **C** — *Could* | Desejável; candidato a evolução. |
| **W** — *Won't (now)* | Fora desta versão; registrado para o futuro. |

### 1.3 Fases (ver [07-roadmap.md](07-roadmap.md))

| Fase | Nome |
|------|------|
| F0 | 1ª entrega — Planejamento técnico (13/11/2026) |
| F1 | Protótipo (front React + Design System + Storybook, dados simulados) |
| F2 | Backend (NestJS, Prisma, API, WebSocket, algoritmo) |
| F3 | Integração de sensores (simulador MQTT → ESP32 + HC-SR04 em maquete, painel de sinalização) |
| F4 | Testes |
| F5 | MVP (demonstração ponta a ponta) |
| EV | Evolução (pós-MVP) |

> Quando um requisito tem duas fases (ex.: "F1 → F2"), a primeira indica a versão com **dados simulados** (interface) e a segunda a versão **integrada** ao backend.

### 1.4 Estados de vaga (nomenclatura oficial — Design System)

| Estado | Código | Cor | Ícone |
|--------|--------|-----|-------|
| Livre | `L` | verde | check |
| Ocupada | `O` | vermelho | carro |
| Reservada | `R` | violeta | relógio |
| Indisponível | `X` | cinza + hachura | proibido |
| Em manutenção | `M` | laranja + listras diagonais | chave |
| Erro de sensor | `E` | magenta + borda tracejada | alerta |
| Carregamento *(estado de interface)* | — | skeleton shimmer + "Atualizando…" | — |

Ocupação de zona: **Normal** < 70% · **Alta** 70–89% · **Lotada** ≥ 90% (sempre com rótulo textual). Detalhes em [04-design-system.md](04-design-system.md).

---

## 2. Requisitos Funcionais (RF)

### 2.1 Monitoramento de vagas

| ID | Descrição | Prior. | Fase | Critério de aceite (resumo) |
|----|-----------|:------:|:----:|-----------------------------|
| RF01 | O sistema deve receber, via MQTT, o estado de cada vaga (livre/ocupada) informado pelo sensor e atualizar o estado da vaga no banco. 🗺️ | M | F2 → F3 | Mensagem publicada em `parkvision/{unidade}/vaga/{vagaId}/estado` altera o estado da vaga e gera um registro de evento; mensagens duplicadas (mesmo `seq`) são descartadas. |
| RF02 | O sistema deve detectar sensores sem comunicação (heartbeat ausente ou *Last Will* "offline") e colocar a vaga correspondente em **Erro de sensor**. | M | F2 → F3 | Sensor desligado aparece como offline e a vaga muda para `E` em ≤ 90 s (RNF06); um alerta é gerado. |
| RF03 | O sistema deve calcular, em tempo real, a ocupação por setor, zona, pavimento e estabelecimento, por categoria de vaga. | M | F2 | Contadores (livres/ocupadas/total e %) batem com a soma dos estados das vagas após cada evento. |
| RF04 | O sistema deve transmitir mudanças de estado e ocupação às telas conectadas via WebSocket, sem recarregar a página. | M | F2 | Dashboard e mapa refletem a mudança em ≤ 2 s (RNF01). |
| RF05 | O sistema deve disponibilizar um **simulador de sensores** que publique eventos MQTT realistas (entradas, saídas, falhas) para demonstração e testes. | M | F3 | Simulador configurável (taxa de chegada, falhas) publica nos mesmos tópicos dos sensores reais. |

### 2.2 Distribuição inteligente e classificação

| ID | Descrição | Prior. | Fase | Critério de aceite (resumo) |
|----|-----------|:------:|:----:|-----------------------------|
| RF06 | O totem deve permitir ao motorista selecionar a categoria do veículo: **Moto**, **Carro pequeno** ou **Carro grande**. | M | F1 → F2 | Botões grandes com ícone + texto; a categoria escolhida é registrada no ticket. |
| RF07 | O totem deve permitir indicar necessidade de **vaga preferencial** (PcD ou idoso). | M | F1 → F2 | Opção disponível em todo fluxo de entrada; quando marcada, a recomendação considera apenas vagas preferenciais compatíveis (RN02). |
| RF08 | O sistema deve verificar a categoria declarada por barreira infravermelha de altura/comprimento e sinalizar divergência ao operador. | S | F3 | Divergência gera alerta no painel; não bloqueia a entrada (decisão do operador). |
| RF09 | O sistema deve **recomendar a melhor zona** para o veículo no momento da entrada, segundo o algoritmo de pontuação (ver [09-distribuicao-inteligente.md](09-distribuicao-inteligente.md)). | M | F2 | Para um mesmo estado de entrada, o algoritmo retorna a zona de maior `Score(z)` entre as elegíveis (RN03–RN05); resposta em ≤ 500 ms (RNF03). |
| RF10 | O sistema deve descontar das vagas livres os veículos **já direcionados e ainda em trânsito** (LivresEfetivas). | M | F2 | Ao emitir N tickets seguidos para a mesma zona, as LivresEfetivas da zona diminuem N, até a conversão em ocupação ou expiração (RN06). |
| RF11 | O sistema deve registrar cada recomendação com o score e a justificativa de cada zona avaliada. | S | F2 | Para todo ticket é possível consultar por que a zona foi escolhida (transparência/auditoria). |
| RF12 | O sistema deve permitir **reserva temporária de vaga específica** na entrada, com expiração automática. | C | EV | Vaga passa de `L` para `R` por atualização atômica condicional; sem chegada em 5 min volta a `L`; duas entradas simultâneas nunca reservam a mesma vaga. |

### 2.3 Ticket, entrada e saída

| ID | Descrição | Prior. | Fase | Critério de aceite (resumo) |
|----|-----------|:------:|:----:|-----------------------------|
| RF13 | O totem deve emitir **ticket impresso** contendo: zona e setor recomendados, orientações de trajeto, data/hora de entrada, categoria, QR Code e código curto numérico. 🗺️ | M | F1 → F3 | Ticket impresso em impressora térmica 80 mm em ≤ 5 s (RNF02) com todos os campos legíveis; QR contém apenas a URL com token (RNF12). |
| RF14 | O sistema deve abrir a cancela de entrada após a emissão do ticket. | S | F3 | Comando de abertura enviado somente após confirmação de impressão (simulado na maquete). |
| RF15 | O sistema deve validar o ticket na saída (QR ou código curto) e liberar a cancela se o pagamento estiver confirmado e dentro da janela de saída. | M | F2 → F3 | Ticket pago e dentro da janela → saída liberada; caso contrário, orientação para pagamento/caixa (RN10). |
| RF16 | O operador deve poder buscar tickets por código curto, status e período. | M | F1 → F2 | Busca retorna o ticket em ≤ 1 s com status (Em andamento, Pagamento pendente, Pago, Finalizado — saída registrada, Cancelado, Extraviado — mesmo enum `StatusTicket` do banco). |
| RF17 | O sistema deve tratar **ticket perdido**: localizar a sessão (por horário/categoria/placa opcional), cobrar conforme regra e emitir comprovante. | S | F2 | Fluxo de ticket perdido executável pelo operador, auditado (RN11). |

### 2.4 Sinalização

| ID | Descrição | Prior. | Fase | Critério de aceite (resumo) |
|----|-----------|:------:|:----:|-----------------------------|
| RF18 | O sistema deve atualizar os **painéis luminosos** com quantidade de vagas livres por zona e setas de direção. 🗺️ | M | F3 | Mudança de ocupação é publicada no tópico retido `parkvision/{unidade}/painel/{painelId}/display`; painel reiniciado exibe o último estado. |
| RF19 | Os painéis devem exibir os modos **LOTADO** e **FALHA** com texto, não apenas cor. | M | F3 | Zona lotada exibe "LOTADO"; painel sem dados exibe estado de falha legível. |
| RF20 | O painel externo/entrada deve indicar quando não há vagas para uma categoria. | S | F3 | Mensagem por categoria ("MOTO: LOTADO") exibida quando nenhuma zona é elegível. |

### 2.5 Painel administrativo

| ID | Descrição | Prior. | Fase | Critério de aceite (resumo) |
|----|-----------|:------:|:----:|-----------------------------|
| RF21 | O painel deve exibir **dashboard** com ocupação geral e por zona (Normal/Alta/Lotada), entradas recentes e alertas. | M | F1 → F2 | Indicadores atualizados em tempo real; faixas de ocupação com cor + rótulo. |
| RF22 | O painel deve exibir **mapa de vagas** por pavimento/zona com os 6 estados de vaga (cor + ícone + rótulo + código). 🗺️ | M | F1 → F2 | Cada vaga exibe estado correto; legenda presente; mapa provisório rotulado "EXEMPLO — será substituída após análise da planta". |
| RF23 | O painel deve exibir **alertas operacionais**: sensor offline/erro, zona lotada, zona com saúde baixa, divergência de categoria, pagamento com falha. | M | F2 | Alerta aparece em ≤ 2 s após o evento; pode ser reconhecido pelo operador (registro de quem/quando). |
| RF24 | O operador deve poder alterar manualmente o estado de uma vaga para **Indisponível** ou **Em manutenção**, e fechar/reabrir uma zona. | M | F1 → F2 | Ação reflete no mapa, na distribuição e nos painéis em ≤ 2 s; registrada em auditoria (RN13). |
| RF25 | O painel deve exibir o **monitor da distribuição**: recomendações recentes, score por zona, veículos em trânsito. | S | F1 → F2 | Lista em tempo real das últimas recomendações com zona escolhida e scores. |
| RF26 | O painel deve oferecer lista de **sensores e painéis** com status, último heartbeat e localização. | S | F2 | Lista filtrável por status; clique localiza o dispositivo no mapa. |

### 2.6 Localização do veículo e pagamento

| ID | Descrição | Prior. | Fase | Critério de aceite (resumo) |
|----|-----------|:------:|:----:|-----------------------------|
| RF27 | A página mobile `/t/:token` (acessada pelo QR Code) deve exibir a **localização do veículo**: pavimento, zona e setor recomendados e orientações de retorno. | S | F1 → F2 | Página abre sem login, sem dados pessoais; mostra zona/setor do ticket. Na v1, a vaga exata só é exibida quando houver reserva (RF12). |
| RF28 | O motorista deve poder informar opcionalmente o código da vaga onde estacionou, para facilitar o retorno. | C | F2 | Campo opcional na página do ticket; valor exibido nas consultas seguintes. |
| RF29 | A página mobile deve exibir **tempo de permanência e valor** a pagar, calculado pela tarifa vigente. | M | F1 → F2 | Valor coincide com o cálculo da RN08 para o mesmo horário. |
| RF30 | A página mobile deve permitir **pagamento via Pix** (QR/copia-e-cola) por meio da interface `PaymentProvider` — `MockProvider` nesta etapa. | M | F1 → F2 | Pagamento simulado muda o ticket para "pago" e inicia a janela de saída; confirmação processada uma única vez (idempotência — RN12). |
| RF31 | O caixa/guichê deve permitir consulta e pagamento pelo **código curto** do ticket. | M | F2 | Operador digita o código, vê o valor e registra o pagamento (método CAIXA). |
| RF32 | Localização e valor do ticket também devem poder ser consultados no totem/caixa, sem smartphone. | S | F2 | Mesmas informações da RF27/RF29 disponíveis ao operador. |

### 2.7 Configurações, histórico e auditoria

| ID | Descrição | Prior. | Fase | Critério de aceite (resumo) |
|----|-----------|:------:|:----:|-----------------------------|
| RF33 | O gestor deve poder cadastrar a **estrutura do estacionamento**: estabelecimento, pavimentos, zonas, setores, vagas (tipo e categorias compatíveis) e grafo de circulação. 🗺️ | M | F2 | Estrutura criada sem alteração de código; importável a partir da planta (ver [adaptacao-planta.md](adaptacao-planta.md)). |
| RF34 | O gestor deve poder configurar **tarifas** (carência, frações, valores por categoria, teto diário), **tolerâncias** (janela de saída) e **taxa de ticket perdido**. | M | F2 | Alteração vale para novos cálculos; versão anterior preservada para tickets já pagos. |
| RF35 | O gestor deve poder ajustar **parâmetros da distribuição** (pesos do score, saúde mínima, janela de fluxo, expiração de trânsito) e limites de ocupação. | S | F2 | Pesos validados (soma = 1,0); alteração auditada. |
| RF36 | O gestor deve poder cadastrar **sensores e painéis**, associando-os a vagas/zonas/nós do grafo. | S | F2 | Dispositivo cadastrado passa a ser reconhecido nos tópicos MQTT. |
| RF37 | O sistema deve manter **histórico de ocupação** por zona (snapshots por minuto) e eventos de vaga. | S | F2 | Gráficos de ocupação por período carregam a partir do histórico. |
| RF38 | O painel deve exibir **relatórios**: ocupação por período/zona, horários de pico, permanência média, giro de vagas, receita por método de pagamento. | S | F2 | Relatórios filtráveis por período; números consistentes com tickets e pagamentos. |
| RF39 | O sistema deve permitir **exportar relatórios** em CSV. | C | EV | Arquivo CSV com os mesmos dados da tela. |
| RF40 | O sistema deve registrar **log de auditoria** de ações administrativas (alterações manuais, configurações, login), tratamentos de ticket perdido e eventos de pagamento. | M | F2 | Cada registro contém usuário, data/hora, ação, entidade, valor anterior e novo; logs não editáveis pela interface. |
| RF41 | O sistema deve ter **autenticação** e **perfis de acesso** (Operador, Gestor, Manutenção). | M | F2 | Cada perfil acessa apenas as funções permitidas (RNF14). |
| RF42 | A interface deve oferecer **tema claro** (padrão) e **tema escuro**. | C | F1 | Alternância preserva contraste ≥ 4.5:1 em ambos os temas. |

### 2.8 Registrados como fora desta versão

| ID | Descrição | Prior. | Fase |
|----|-----------|:------:|:----:|
| RF43 | Reconhecimento automático de placas (LPR) e classificação por câmera. | W | EV |
| RF44 | Aplicativo nativo Android/iOS. | W | — |
| RF45 | Reserva antecipada de vaga (antes de chegar ao shopping). | W | — |
| RF46 | Pagamento real com gateway (Pix/cartão) em produção. | W | EV |

---

## 3. Requisitos Não Funcionais (RNF)

### 3.1 Desempenho

| ID | Requisito | Métrica / verificação |
|----|-----------|-----------------------|
| RNF01 | Atualização do estado da vaga no painel administrativo em **≤ 2 s** após a leitura confirmada pelo sensor (pós-debounce). | p95 ≤ 2 s medido do `ts` da mensagem MQTT à renderização (teste de integração). |
| RNF02 | Emissão do ticket em **≤ 5 s**, do toque na categoria ao fim da impressão. | Medição no totem/maquete. |
| RNF03 | Cálculo da recomendação de zona em **≤ 500 ms**. | p95 ≤ 500 ms no teste de carga do algoritmo (Fase 4). |
| RNF04 | Página mobile de pagamento com primeira renderização útil em ≤ 3 s em rede 4G. | Lighthouse mobile (perfil 4G simulado). |
| RNF05 | O backend deve suportar picos de entradas simultâneas (ex.: várias cancelas) sem degradar RNF03. | Teste de carga com múltiplos totens simulados; valores-alvo a definir após a planta 🗺️. |

### 3.2 Disponibilidade e resiliência

| ID | Requisito | Métrica / verificação |
|----|-----------|-----------------------|
| RNF06 | Sensor offline detectado em **≤ 90 s** (heartbeat a cada 30 s; 3 ausências ou LWT do broker). | Teste: desligar sensor e medir tempo até o estado `E`. |
| RNF07 | **Operação degradada sem internet:** o servidor de borda local mantém entrada, distribuição, sinalização, ticket, caixa e saída funcionando; sincroniza com a nuvem ao restabelecer. | Teste com link externo desligado; nenhuma perda de tickets. |
| RNF08 | Pagamento via QR indisponível não bloqueia a saída: o caixa tradicional continua operando. | Teste com provedor de pagamento fora do ar. |
| RNF09 | Painéis de sinalização exibem o último estado válido após reinício (mensagem MQTT retida) e entram em modo FALHA se não houver dados. | Teste de reboot do painel. |
| RNF10 | Mensagens de sensores com QoS 1, idempotentes (descarte por `seq`) e debounce de 3 s no firmware. | Teste com mensagens duplicadas e oscilação de leitura. |
| RNF11 | Vagas em `E` são excluídas das LivresEfetivas (abordagem conservadora); zona com saúde < 0,6 não recebe recomendações. | Teste unitário do algoritmo. |

### 3.3 Segurança e privacidade

| ID | Requisito | Métrica / verificação |
|----|-----------|-----------------------|
| RNF12 | O QR Code contém **somente** a URL `https://<dominio>/t/{token}`; nenhum dado pessoal, placa ou valor. | Inspeção do conteúdo do QR. |
| RNF13 | O token é **opaco e aleatório** (128 bits, base62 ≈ 22 caracteres), gerado por fonte criptograficamente segura, e **expira após a saída**. | Teste: token de ticket finalizado retorna "ticket encerrado"; tokens não são sequenciais. |
| RNF14 | Painel administrativo com autenticação e **RBAC** (Operador, Gestor, Manutenção); princípio do menor privilégio. | Testes de autorização por rota/perfil. |
| RNF15 | Toda comunicação web via **HTTPS/TLS**; sessão por JWT em cookie `httpOnly`/`Secure`. | Verificação de configuração; nenhuma rota HTTP em produção. |
| RNF16 | **MQTT com autenticação** (usuário/senha ou certificado por dispositivo), **TLS** e ACL por tópico. | Cliente sem credencial é rejeitado; dispositivo não publica fora do seu tópico. |
| RNF17 | **LGPD:** placa é opcional e tratada como dado pessoal — finalidade definida, retenção limitada e configurável, acesso restrito e mascaramento em telas/relatórios. | Revisão de privacidade; relatórios sem placa completa. |
| RNF18 | **Logs de auditoria** imutáveis pela aplicação (somente inserção), com retenção definida. | Tentativa de edição/remoção pela API é negada. |
| RNF19 | **Nenhum dado de cartão** é armazenado ou trafega pelo backend; pagamentos são tratados pelo provedor (webhook com verificação de assinatura e idempotência). | Revisão de esquema e código; teste de webhook repetido. |
| RNF20 | Proteção contra força bruta no código curto e no token (limite de requisições por IP). | Teste de rate limiting. |

### 3.4 Acessibilidade

| ID | Requisito | Métrica / verificação |
|----|-----------|-----------------------|
| RNF21 | Interfaces web (painel e página mobile) em conformidade com **WCAG 2.2 nível AA**. | Auditoria automática (axe/Lighthouse) + revisão manual (teclado, leitor de tela) na Fase 4. |
| RNF22 | **Nenhuma funcionalidade essencial depende de smartphone**: entrada, orientação, pagamento e saída funcionam com ticket impresso, sinalização física e caixa. | Teste do fluxo completo sem celular. |
| RNF23 | **Informação nunca transmitida apenas por cor**: todo estado combina cor + ícone + rótulo + código (e padrões de hachura/listras/borda). | Revisão do Design System e teste em simulação de daltonismo. |
| RNF24 | Contraste de texto **≥ 4.5:1** em todos os pares de tokens de texto/fundo, nos temas claro e escuro, validado por `node design-system/scripts/check-contrast.mjs` (13 pares críticos × 2 temas; o script retorna erro se algum par ficar abaixo de 4.5:1); componentes não textuais ≥ 3:1 (verificação a incluir no script na Fase 1). | Script de contraste sem falhas (execução manual agora; pipeline de CI na Fase 1). |
| RNF25 | Alvos de toque ≥ 24 × 24 px (mínimo WCAG 2.2) na web, com meta do projeto de 44 px (48 px na página de pagamento mobile), e botões amplos no totem; totem com altura e alcance adequados a usuários de cadeira de rodas. | Revisão de componentes e do projeto físico do totem. |
| RNF26 | Sinalização física legível à distância (tipografia Barlow, alto contraste, setas + texto). | Teste em maquete. |
| RNF27 | **Atendimento humano** disponível em entrada, caixa e saída (botão/interfone de ajuda no totem). | Presente no projeto do totem e no fluxo operacional. |
| RNF28 | Vagas preferenciais (PcD e idoso) em quantidade e localização **conforme legislação vigente**, sinalizadas e consideradas pelo algoritmo. 🗺️ | Conferência na planta real. |
| RNF29 | Respeito a `prefers-reduced-motion` (animações como o *shimmer* de carregamento podem ser desativadas). | Teste com a preferência ativada. |

### 3.5 Escalabilidade

| ID | Requisito | Métrica / verificação |
|----|-----------|-----------------------|
| RNF30 | Modelo de dados suporta **múltiplos pavimentos e múltiplas unidades** (estabelecimentos) sem alteração de código. | Cadastro de 2+ unidades de teste. |
| RNF31 | Arquitetura suporta de **centenas a milhares de sensores** por unidade (tópicos MQTT hierárquicos, processamento assíncrono). | Teste de carga com simulador (ex.: 1.000 sensores simulados). |
| RNF32 | Caminho de evolução definido: Redis para estado ao vivo/cache e TimescaleDB para histórico, sem reescrever os módulos de domínio. | Registrado em [08-decisoes-tecnicas.md](08-decisoes-tecnicas.md). |

### 3.6 Usabilidade

| ID | Requisito | Métrica / verificação |
|----|-----------|-----------------------|
| RNF33 | O totem conclui a entrada em no máximo **2 interações** (categoria + confirmação opcional de vaga preferencial). | Teste de usabilidade. |
| RNF34 | Ticket compreensível sem explicação: zona em destaque, setor e orientação em linguagem simples. | Teste com participantes de perfis variados (H3). |
| RNF35 | Operador novato consegue bloquear uma vaga e localizar um ticket sem treinamento formal. | Teste de tarefa na Fase 4. |
| RNF36 | Mensagens de erro claras, em português, com ação sugerida. | Revisão de conteúdo. |

### 3.7 Manutenibilidade

| ID | Requisito | Métrica / verificação |
|----|-----------|-----------------------|
| RNF37 | Toda a interface é construída sobre o **Design System** (tokens `--pv-*` em 3 camadas; componentes documentados no Storybook 9). Proibido valor de cor/espaçamento "solto" no código. | Revisão de código / lint de estilos. |
| RNF38 | **TypeScript** em front, back, simulador e Design System, com `strict` habilitado e tipos compartilhados de contrato (MQTT/WebSocket/API). | Build sem erros de tipo. |
| RNF39 | Backend modular (NestJS) com regras de negócio isoladas e testáveis; cobertura mínima de testes do algoritmo de distribuição e do cálculo de tarifa ≥ 80%. | Relatório de cobertura. |
| RNF40 | Pagamento atrás da interface `PaymentProvider` (adapter): trocar de provedor não altera o domínio. | Teste com `MockProvider` e contrato do adapter. |
| RNF41 | Decisões técnicas registradas em [08-decisoes-tecnicas.md](08-decisoes-tecnicas.md). | Documento atualizado a cada decisão relevante. |

### 3.8 Portabilidade

| ID | Requisito | Métrica / verificação |
|----|-----------|-----------------------|
| RNF42 | Ambiente completo sobe com **Docker Compose** (PostgreSQL, Mosquitto, backend, frontend). | `docker compose up` em máquina limpa. |
| RNF43 | Frontend SPA executável em navegadores modernos (Chrome, Edge, Firefox, Safari) e responsivo (página de pagamento mobile-first). | Teste em navegadores e larguras de 360 px a desktop. |
| RNF44 | Implantação flexível: nuvem (frontend em Vercel; backend em Render/Railway) para demonstração e **servidor de borda local** no shopping para produção. | Documentado em [03-arquitetura.md](03-arquitetura.md). |
| RNF45 | Firmware independente do modelo de sensor (camada de leitura abstrata: HC-SR04 no protótipo, magnetômetro QMC5883L em produção). | Troca de sensor sem alterar o contrato MQTT. |

---

## 4. Restrições do projeto

| ID | Restrição |
|----|-----------|
| RT01 | **Planta recebida (13/11/2026):** zonas propostas em [10-analise-planta.md](10-analise-planta.md), ainda sujeitas à validação da operação. Quantidades não informadas na planta (pátios descobertos, motos), distâncias e grafo definitivo continuam pendentes; nenhum dado pode ser inventado. A simulação Z1–Z4 do protótipo segue rotulada como "EXEMPLO". |
| RT02 | **Design System** é a tecnologia sorteada e requisito central; deve estar presente e documentado desde a 1ª entrega. |
| RT03 | Stack definida: TypeScript; React 19 + Vite; NestJS (Node.js 24 LTS); Prisma; PostgreSQL 16; MQTT (Mosquitto); Socket.IO; Storybook 9. Ver [08-decisoes-tecnicas.md](08-decisoes-tecnicas.md). |
| RT04 | Hardware de baixo custo no protótipo (ESP32 + HC-SR04); validação em **maquete**, não em estacionamento real. |
| RT05 | **Sem transações financeiras reais** e sem dados de cartão nesta etapa (provedor simulado). |
| RT06 | Prazo acadêmico: cronograma estimado, a ajustar ao calendário da disciplina. |
| RT07 | Conformidade com LGPD e com a legislação vigente de acessibilidade/vagas preferenciais. |
| RT08 | Gestão do projeto no **Geproj (To Host)** com uso manual. |

---

## 5. Regras de Negócio (RN)

> Valores numéricos marcados como **configuráveis** são parâmetros definidos pelo shopping; os exemplos servem apenas para teste.

### 5.1 Distribuição e vagas

| ID | Regra |
|----|-------|
| RN01 | **Compatibilidade categoria × vaga:** um veículo só é direcionado a zonas com vagas compatíveis com sua categoria. Matriz padrão (configurável): Moto → vagas de moto; Carro pequeno → vagas padrão ou grandes; Carro grande → vagas grandes ou padrão marcadas como compatíveis. A compatibilidade é cadastrada por vaga (N:N). |
| RN02 | **Vagas preferenciais (PcD/idoso):** são recomendadas apenas a quem indicar a necessidade no totem; o sistema não as oferece a outros motoristas. A conferência de credencial segue a legislação vigente e é responsabilidade da operação. Quando não houver vaga preferencial livre, o sistema recomenda a zona elegível mais próxima dos acessos e alerta o operador. |
| RN03 | **Elegibilidade da zona:** uma zona só é elegível se possui vagas compatíveis com a categoria, `LivresEfetivas > ReservaMínima` (padrão 0, configurável por zona), `Saude ≥ 0,6` e não está fechada manualmente. |
| RN04 | **Pontuação:** entre as zonas elegíveis, recomenda-se a de maior `Score(z) = 0,40·Disp(z) + 0,25·(1 − DistNorm(z)) + 0,25·(1 − FluxoNorm(z)) + 0,10·Saude(z)`, onde `Disp = LivresEfetivas / total compatível`, `DistNorm = distância pela rota no grafo / maior distância`, `FluxoNorm = entradas direcionadas nos últimos 5 min / capacidade de vazão`, `Saude = sensores online / total`. Pesos configuráveis (soma = 1,0). Detalhes em [09-distribuicao-inteligente.md](09-distribuicao-inteligente.md). |
| RN05 | **Empate e ausência de zona:** em empate, vence a menor distância; persistindo, a de menor `FluxoNorm`. Se nenhuma zona for elegível para a categoria, o totem informa "sem vagas para esta categoria", o painel de entrada exibe LOTADO para a categoria e o operador é alertado. |
| RN06 | **Veículos em trânsito:** cada recomendação emitida conta como "em trânsito" na zona até ser convertida em ocupação ou expirar (tempo configurável; padrão 10 min — ver [03-arquitetura.md](03-arquitetura.md)). |
| RN07 | **Reserva temporária (evolução):** a reserva de vaga específica dura 5 min (configurável); só ocorre se a vaga estiver `L` no momento da atualização atômica; expirada, a vaga volta a `L` automaticamente. |

### 5.2 Tarifação, pagamento e saída

| ID | Regra |
|----|-------|
| RN08 | **Cálculo de tarifa (configurável):** permanência = saída (ou momento da consulta) − entrada. Se permanência ≤ **carência** → valor zero. Caso contrário: valor = tarifa da primeira fração + tarifa adicional × frações adicionais **iniciadas**, limitado ao **teto diário**; valores podem variar por categoria. A tarifa aplicada é a vigente no momento do pagamento e fica registrada no pagamento. |
| RN09 | **Carência/tolerância de entrada:** quem sai dentro da carência não paga, mas precisa validar o ticket na saída. |
| RN10 | **Janela de saída pós-pagamento:** após o pagamento confirmado, o motorista tem uma janela configurável (ex.: 15 min) para sair. Excedida a janela, cobra-se a diferença conforme RN08, contada a partir do fim da janela. |
| RN11 | **Ticket perdido:** cobra-se a taxa de ticket perdido configurada ou o valor calculado pela entrada localizada, conforme política do shopping; exige atendimento pelo operador, que registra a ocorrência (auditada). O ticket original é invalidado e um comprovante é emitido. |
| RN12 | **Idempotência de pagamento:** cada cobrança tem chave de idempotência; confirmações repetidas do provedor não geram pagamentos duplicados. Cobrança não confirmada expira e pode ser recriada. |
| RN13 | **Token de acesso:** o token do QR é válido enquanto o ticket estiver ativo; após a saída, a página informa "ticket encerrado" e não exibe dados. |

### 5.3 Operação e dados

| ID | Regra |
|----|-------|
| RN14 | **Precedência manual:** estados definidos manualmente (Indisponível, Em manutenção, zona fechada) prevalecem sobre a leitura do sensor até serem revertidos por usuário autorizado; toda alteração é auditada. |
| RN15 | **Confirmação de leitura:** uma mudança de estado só é considerada após 3 s de leitura estável (debounce no firmware). |
| RN16 | **Sensor sem comunicação:** sem heartbeat por 90 s (ou LWT "offline"), a vaga vai para Erro de sensor e deixa de contar como livre; ao voltar, retoma o estado lido. |
| RN17 | **Faixas de ocupação:** Normal < 70%, Alta 70–89%, Lotada ≥ 90%; exibidas sempre com rótulo textual. |
| RN18 | **Perfis:** Operador (monitorar, alterar estado de vaga, tickets, caixa); Manutenção (sensores, painéis, estado Em manutenção); Gestor (tudo, incluindo configurações, relatórios e auditoria). |
| RN19 | **Dados pessoais:** a placa não é coletada no fluxo padrão; quando informada (ex.: ticket perdido), é usada só para essa finalidade, com retenção limitada e exibição mascarada. |

---

## 6. Matriz de rastreabilidade RF → Telas

Telas do painel e da página mobile (ver [05-telas.md](05-telas.md)):

| Tela | Nome | Usuário |
|------|------|---------|
| **Tela 1** | Dashboard (visão geral de ocupação e alertas) | Operador, Gestor |
| **Tela 2** | Mapa de vagas (pavimento/zona) | Operador, Manutenção |
| **Tela 3** | Distribuição inteligente (monitor de recomendações e scores) | Operador, Gestor |
| **Tela 4** | Tickets (entradas, saídas, busca, caixa, ticket perdido) | Operador |
| **Tela 5** | Pagamento / localização — página mobile `/t/:token` | Motorista |
| **Tela 6** | Configurações (estrutura, tarifas, algoritmo, dispositivos, usuários, auditoria) | Gestor, Manutenção |

> A numeração segue as áreas funcionais do frontend definidas em [03-arquitetura.md](03-arquitetura.md) (`dashboard`, `mapa`, `distribuicao`, `tickets`, `pagamento`, `configuracoes`). Caso [05-telas.md](05-telas.md) adote outra numeração, prevalece a de 05. A coluna **Físico** indica requisitos atendidos por totem, ticket impresso ou painel de LED (fora das telas web).

| RF | Descrição curta | T1 | T2 | T3 | T4 | T5 | T6 | Físico |
|----|-----------------|:--:|:--:|:--:|:--:|:--:|:--:|:------:|
| RF01 | Estado da vaga via MQTT | ● | ● | | | | | Sensor |
| RF02 | Sensor offline → Erro | ● | ● | | | | ● | Sensor |
| RF03 | Ocupação por nível | ● | ● | ● | | | | |
| RF04 | Tempo real (WebSocket) | ● | ● | ● | ● | | | |
| RF05 | Simulador de sensores | ● | ● | ● | | | | |
| RF06 | Categoria no totem | | | ● | ● | | | Totem |
| RF07 | Vaga preferencial | | | ● | ● | | | Totem |
| RF08 | Verificação por barreira IR | ● | | | ● | | | Totem |
| RF09 | Recomendação de zona | | | ● | ● | | | Totem/ticket |
| RF10 | LivresEfetivas (trânsito) | | | ● | | | | |
| RF11 | Justificativa da recomendação | | | ● | ● | | | |
| RF12 | Reserva temporária (EV) | | ● | ● | ● | ● | | Ticket |
| RF13 | Ticket impresso | | | | ● | | | Totem/ticket |
| RF14 | Cancela de entrada | | | | ● | | | Cancela |
| RF15 | Validação na saída | | | | ● | | | Cancela |
| RF16 | Busca de tickets | | | | ● | | | |
| RF17 | Ticket perdido | | | | ● | | | |
| RF18 | Painéis luminosos | | | | | | ● | Painel LED |
| RF19 | Modos LOTADO/FALHA | ● | | | | | | Painel LED |
| RF20 | Lotação por categoria | ● | | ● | | | | Painel LED |
| RF21 | Dashboard | ● | | | | | | |
| RF22 | Mapa de vagas | | ● | | | | | |
| RF23 | Alertas operacionais | ● | ● | | | | | |
| RF24 | Override manual vaga/zona | | ● | | | | ● | |
| RF25 | Monitor da distribuição | | | ● | | | | |
| RF26 | Lista de sensores/painéis | | ● | | | | ● | |
| RF27 | Localização do veículo | | | | ● | ● | | |
| RF28 | Vaga informada pelo motorista | | | | | ● | | |
| RF29 | Tempo e valor | | | | ● | ● | | |
| RF30 | Pagamento Pix (mock) | | | | ● | ● | | |
| RF31 | Pagamento no caixa | | | | ● | | | Caixa |
| RF32 | Consulta sem smartphone | | | | ● | | | Totem/caixa |
| RF33 | Estrutura do estacionamento | | ● | | | | ● | |
| RF34 | Tarifas e tolerâncias | | | | | | ● | |
| RF35 | Parâmetros da distribuição | | | ● | | | ● | |
| RF36 | Cadastro de sensores/painéis | | | | | | ● | |
| RF37 | Histórico de ocupação | ● | | | | | | |
| RF38 | Relatórios | ● | | | | | | |
| RF39 | Exportar CSV (EV) | ● | | | | | | |
| RF40 | Auditoria | | | | | | ● | |
| RF41 | Autenticação e perfis | ● | ● | ● | ● | | ● | |
| RF42 | Tema claro/escuro | ● | ● | ● | ● | ● | ● | |

---

**Documentos relacionados:** [01-visao-geral.md](01-visao-geral.md) · [03-arquitetura.md](03-arquitetura.md) · [04-design-system.md](04-design-system.md) · [05-telas.md](05-telas.md) · [07-roadmap.md](07-roadmap.md) · [09-distribuicao-inteligente.md](09-distribuicao-inteligente.md)
