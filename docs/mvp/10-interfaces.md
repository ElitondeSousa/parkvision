# MVP 10 — Interfaces e mapa interativo (Etapa 3)

> Os números exibidos vêm da API. Quando há simulação ativa ou veículos simulados no banco, o painel mostra o selo **"Ambiente de demonstração · dados simulados"**.

## 1. As três interfaces

| Rota | Interface | Pensada para |
|---|---|---|
| `/totem?acesso=A_NE` | Totem de entrada. O acesso fica fixo por totem: `A_NE`, `A_ROT`, `A_S1` ou `A_S2` | Tela de toque, tema escuro, alvos de toque grandes |
| `/painel` | Dashboard administrativo | Desktop e notebook; o mapa é o centro |
| `/t/:token` | Localizador de veículo, aberto pelo QR Code do ticket | Celular |

Qualquer outra rota redireciona para `/painel`. Não há telas além dessas três.

### Totem

O fluxo tem cinco etapas:

1. **Início.**
2. **Categoria:** silhuetas próprias de carro pequeno, carro grande/SUV/picape e moto.
3. **Processamento:** três etapas que descrevem o que o algoritmo faz de fato.
4. **Recomendação:** placa da região, nome, nível, vagas livres e medidor, justificativa **do backend**, passos "Como chegar" e mapa com a rota.
5. **Ticket:** código, placa da região, categoria, data e hora, passos e QR Code com o `qrUrl` real.

Outros comportamentos:
- **Sem vagas para a categoria** (`409 SEM_REGIAO_ELEGIVEL`): mostra a mensagem do backend e oferece outra categoria.
- **Sem conexão:** orienta procurar o atendimento e oferece tentar de novo.
- **Acesso inválido na URL:** o atendimento não abre.
- **Retorno ao início:** depois de 60 s na tela do ticket e depois de 2 min sem toque.

> A entrada (`POST /api/entradas`) já registra o ticket e devolve a recomendação, como definido na Etapa 1. O botão **Emitir ticket** apenas apresenta o ticket. Nada disso ocupa vaga: a ocupação só muda na confirmação.

### Painel

- **Indicadores:**
  - capacidade total;
  - veículos estacionados, com a taxa;
  - vagas livres;
  - veículos entrando (com ticket, a caminho da vaga);
  - regiões congestionadas (fluxo elevado);
  - regiões indisponíveis.
- **Mapa:** tem abas por nível, cada uma com o número de vagas livres.
  - Destaca a última recomendação com a rota, que pode ser desligada.
  - Clicar numa região, ou navegar pelo teclado, seleciona a região.
  - Para não desorientar o operador, o painel não troca de nível sozinho.
- **Região selecionada:**
  - capacidade, ocupadas e livres;
  - categorias permitidas;
  - estado operacional e sensores;
  - fluxo, com a vazão de referência;
  - referência na planta e fonte da capacidade.
- **Simulação:**
  - estado (parada, rodando ou pausada), cenário, tempo simulado e veículos;
  - iniciar um cenário (A–E, com a descrição vinda da API), pausar, retomar, encerrar e mudar a velocidade;
  - reiniciar os dados simulados, com confirmação.
  - Usa os endpoints reais da Etapa 2, com o token do operador.
- **Movimentações recentes:** chegam por Socket.IO.
  - Mostram entrada, recomendação (incluindo a nova recomendação depois de uma rejeição), estacionamento confirmado, saída ou cancelamento.
  - Também mostram região lotada ou que voltou a ter vaga, mudança de disponibilidade, falha de sensor, congestionamento detectado e controle da simulação.
- **Tabela de regiões:** é a alternativa acessível ao mapa e também seleciona a região.

### Localizador

- **Antes de consultar:** confere o formato do token (base64url). Um formato inválido não chega a chamar a API.
- **Estados tratados:**

| Estado | Comportamento |
|---|---|
| Ticket inexistente | Mensagem de ticket não encontrado |
| QR inválido | Mensagem de QR inválido, sem consultar a API |
| Sem conexão | Mensagem com opção de tentar de novo |
| Estacionamento não confirmado | **Não** mostra localização nem destaca a região recomendada; informa a recomendada só como texto e deixa claro que ela não confirma onde o carro ficou |
| Veículo já saiu | Informa a saída |
| Ticket cancelado | Informa o cancelamento |

- **Ticket estacionado:** mostra a placa da região **registrada na confirmação**, o nível, o horário da confirmação, as orientações do backend e o mapa aproximado na região. O botão "Ver nível inteiro" abre o nível todo.
- **Sem GPS:** o localizador não rastreia o veículo. A tela diz isso explicitamente.
- **Expiração:** o backend não tem regra de expiração de ticket, então ela não foi inventada.

## 2. Design System aplicado

A base é o Design System da 1ª entrega (`design-system/tokens/tokens.json`), com o conceito "asfalto, placa e faixa". O app importa `tokens.css`, e o Tailwind 4 só usa nomes ligados aos tokens `--pv-*` (`@theme` em `apps/web/src/estilos/global.css`). Não há cor solta nas telas, exceto o branco do papel do ticket e do QR.

| Item | Definição |
|---|---|
| Paleta | **Asfalto** (neutros, superfícies, texto); **Vision** `#2148E8` (marca e ações, o azul das placas de estacionamento); **Faixa** `#F5A800` (âmbar, **exclusivo para orientação**: rotas, destino, acessos, passos); verde, laranja, vermelho e magenta para estados |
| Tipografia | **Barlow** para títulos, números e placas; **IBM Plex Sans** para texto; **IBM Plex Mono** para códigos de ticket. Números com algarismos tabulares |
| Espaçamento | Grade de 4 px (`--pv-space-*`) |
| Bordas e raios | 1 px; raio de 8 px em botões, 12 px em cartões, 16–18 px nas placas grandes |
| Hierarquia | Um número dominante por indicador; títulos curtos; legenda em `text-secondary` |
| Botões | Primário, secundário, fantasma e perigo; tamanhos sm, md, lg e xl (xl = 80 px de altura no totem); estado "Processando…" bloqueia o duplo clique |
| Campos | Altura de 40 px, borda forte e anel de foco de 3 px |
| Cartões e indicadores | `Cartao` (título e ação); a faixa de indicadores é uma única superfície com divisórias, em vez de seis cartões iguais |
| Ícones | Lucide (traço 1,75–2,25 px), sempre com rótulo ou `aria-label`; silhuetas próprias para as categorias |
| Carregando | Esqueleto com brilho (respeita `prefers-reduced-motion`) e spinner com texto |
| Erro | `Aviso` vermelho com ação ("Tentar de novo"); no totem, uma tela inteira com orientação |
| Sucesso | `Aviso` verde; no totem, "Ticket emitido" com ícone |
| Vazio | `EstadoVazio` com ícone, título e o que fazer (ex.: "Selecione uma região") |
| Navegação | Barra lateral escura com indicador âmbar no item ativo, que vira barra superior em telas menores; abas de nível no mapa; link "Pular para o conteúdo" |

**Elemento de identidade: a placa da região.** O código da região aparece numa placa azul de cantos arredondados, com filete branco, como a placa indicativa de estacionamento. É o mesmo componente (`Placa`) no totem, no ticket, no painel (mapa, tabela, movimentações) e no localizador.

**Extensão das faixas de ocupação** (o Design System tinha normal, alta e lotada ≥ 90%). Para distinguir "quase cheia" de "sem vagas":

| Faixa | Condição | Sinal no mapa |
|---|---|---|
| Com vagas | < 70% | verde |
| Ocupação alta | 70–89% | laranja |
| Quase lotada | ≥ 90% com vagas | vermelho |
| Lotada | 0 vagas | vermelho escuro com padrão xadrez e rótulo "Lotada" |
| Indisponível | região fora de operação | cinza com hachura |
| Falha de sensor | sensores com problema | magenta com pontos |

Fluxo elevado ganha um selo laranja com ondas. A cor nunca é o único sinal: cada estado tem rótulo, padrão e texto no `aria-label`.

**Temas:** claro e escuro, seguindo `prefers-color-scheme`. O totem é sempre escuro (`data-theme="dark"`), e o ticket sempre claro, como papel térmico.

### Componentes reutilizáveis (`apps/web/src/componentes/`, `mapa/`)

- **Base:** `Simbolo`, `Marca`, `Placa`, `Botao`, `Cartao`, `Selo`, `Medidor`, `Aviso`, `EstadoVazio`, `Esqueleto`, `Carregando`, `SeloDemonstracao`, `IconeCategoria`.
- **Mapa:** `MapaEstacionamento` (com abas de nível e legenda) e `LegendaMapa`.
- **Painel:** `FaixaIndicadores`, `RecomendacaoAtual`, `DetalheRegiao`, `ControleSimulador`, `ListaMovimentacoes`, `TabelaRegioes`, `SeloFaixa`.

## 3. Como o mapa foi construído

**Fonte única: o mapa digital aprovado na Etapa 0.** O arquivo é `packages/shared/src/mapa/capim-dourado.json`, o mesmo que a API usa para calcular as rotas, então a tela e o algoritmo não divergem. As coordenadas estão em pontos do PDF da planta (`docs/planta/2026_11_CDS_MIX.pdf`).

O componente desenha seis camadas:

1. **Traçado da planta:** as linhas vetoriais extraídas do próprio PDF na Etapa 0 (`apps/web/src/mapa/planta-base.json`, cópia de `docs/mvp/mapa/base-vetorial.json`), em tinta clara. A organização real fica reconhecível: fileiras e bolsões de vagas, setas de circulação, prédio, rotatórias e avenidas.
2. **Área fora da distribuição:** o pátio de serviço leste, com hachura e rótulo.
3. **Vias:** as arestas do grafo aprovado.
4. **Regiões:** os polígonos aprovados na Etapa 0, coloridos pela ocupação ao vivo.
5. **Rota:** em âmbar, desenhada **nó a nó pelo grafo**. Um salto que não exista no grafo é descartado (nunca há linha reta "por cima do prédio"). Quando a rota troca de nível, aparecem os avisos "Rampa para o subsolo X" e "Chegada pela rampa".
6. **Acessos:** marcadores âmbar com nome; os de posição a confirmar aparecem tracejados.

O SVG usa o `viewBox` de cada nível, igual ao recorte do PDF, com `width: 100%` e `preserveAspectRatio="xMidYMid meet"`, então escala sem distorcer. O texto e os traços são proporcionais ao tamanho de cada nível (os desenhos têm escalas muito diferentes). No localizador, o mapa abre enquadrado na região, com folga e sem sair do desenho.

**Orientação em texto** (`orientacaoDaRota`): usa só dados do mapa. Ela traz o nome do acesso, os nós rotulados (ex.: "Passe pela rotatória"), a troca de nível ("Desça ao subsolo 2 pela rampa") e a referência da região, que é a descrição registrada na Etapa 0.

### Interpretação da planta e comparação

| Elemento | Planta original | Mapa implementado |
|---|---|---|
| Regiões do térreo | 5 pátios descobertos: N1 (leque a oeste da C&A), N2 (bolsões em frente à entrada norte), N3 (fileiras longas entre a rotatória e o bloco Big/Wow Park), S1 e S2 (bolsões a oeste e a leste do retorno de embarque) | Os mesmos 5 polígonos, sobre as fileiras reais do traçado |
| Subsolo 1 | 4 ilhas com corredores de mão única + faixa leste em L; estacionamento de motos com rampa própria no canto nordeste | SS1 (contorno em L) e SS1M; setas e ilhas visíveis no traçado |
| Subsolo 2 | Anel de circulação anti-horário com rampa no lado leste | SS2O, SS2C e SS2L (divisão do anel em três blocos, aprovada na Etapa 0) |
| Acessos | Nordeste (Av. LO 2A), rotatória norte, dois pela Av. NS-05; entrada do SS1, rampa de motos, rampa do SS2 | Os 7 acessos, com o nome da planta; o do SS1 aparece tracejado (confiança baixa) |
| Vias | Via norte, contorno oeste, retorno de embarque sul, anel do SS2 | Grafo de 27 nós e 26 arestas desenhado sobre essas vias |
| Fora do MVP | Pátio de serviço leste (Cinemark / Av. LO 2A) | Hachurado como "Fora da distribuição" |

**O que foi simplificado (só detalhe):**
- vagas individuais (a unidade é a região);
- pilares;
- logotipos e nomes de lojas;
- sinalização miúda;
- texturas.

A geometria, a posição das áreas, os acessos e as conexões foram preservados.

Capturas: `docs/mvp/capturas/etapa3-mapa-terreo.png`, `etapa3-mapa-ss1.png`, `etapa3-mapa-ss2.png`. Para comparar com a planta original, use `docs/planta/pagina-1.png` e `pagina-2.png`, ou a sobreposição da Etapa 0 em `docs/mvp/mapa/proposta-mapa.html`.

### Ambiguidades que continuam em aberto (precisam da validação do grupo)

1. **Ligação térreo ↔ subsolos (D4).** As rampas para o SS1, o SS1M e o SS2 não aparecem ligadas ao térreo no desenho. O grafo usa ligações estimadas a partir do acesso nordeste. A interface mostra "Desça ao subsolo pela rampa" e marca a troca de nível, mas a posição exata da rampa no térreo não é desenhada.
2. **Grafo simplificado.**
   - No Subsolo 1, a serpentina de mão única é um único trecho (`n_A_SS1 → n_SS1`).
   - No térreo, o último trecho até cada região é uma reta do eixo da via até o centro da região.
   - A rota segue sempre o grafo aprovado, mas nesses trechos a linha passa por cima das fileiras de vagas.

   Refinar o grafo com nós ao longo dos corredores **mudaria as distâncias usadas pelo algoritmo** (e os testes da Etapa 1). Por isso a proposta é fazer isso com a aprovação do grupo, não por conta própria.
3. **Sentido de circulação no térreo (D6).** Ainda está "a confirmar", e o mapa não desenha setas de sentido.
4. **Posição do acesso do Subsolo 1** (confiança baixa): aparece tracejada.

## 4. Integração com o backend

Todas as chamadas passam por `apps/web/src/servicos/api.ts`. Os componentes não chamam `fetch` direto, e os erros chegam padronizados como `ErroServico` com o código da API ou `SEM_CONEXAO`. A web usa o proxy do Vite (`/api` e `/socket.io`), então fica na mesma origem que a API, sem CORS.

| Uso | Endpoint |
|---|---|
| Regiões e ocupação | `GET /api/regioes` |
| Indicadores | `GET /api/indicadores` |
| Recomendação mais recente | `GET /api/recomendacoes?limite=1` |
| Entrada, recomendação e ticket (totem) | `POST /api/entradas` |
| Localizador | `GET /api/localizador/:token` (**Etapa 3:** passou a devolver `estacionadoEm` e `saidaEm`) |
| Estado do simulador | `GET /api/simulacao` (**Etapa 3:** inclui `veiculosSimuladosAtivos`, para o selo de demonstração) |
| Cenários | `GET /api/simulacao/cenarios` (**novo na Etapa 3**: id, nome, descrição; evita repetir os cenários no front) |
| Controles | `POST /api/simulacao/cenario`, `POST /api/simulacao/{pausar,retomar,encerrar,reiniciar}`, `PATCH /api/simulacao/config`, todos com `x-simulador-token` |

A confirmação de estacionamento e a saída **não** têm botão nas interfaces. Na operação, elas acontecem na região (sensor ou leitura do ticket), e no MVP são feitas pelo simulador ou pela API: `POST /api/tickets/:codigo/estacionar`, `/saida`, `POST /api/sensores/eventos`. O painel mostra essas movimentações em tempo real.

**Eventos em tempo real** (namespace `/painel`, canal agregado `evento`, envelope com `id`, `tipo`, `ocorridoEm`, `entidadeId`, `simulado` e `dados`):
- `veiculo:entrou`, `veiculo:recomendado`, `veiculo:estacionou`, `veiculo:saiu`;
- `regiao:ocupacao`, `regiao:status`, `regiao:fluxo`;
- `indicadores:atualizados`;
- `simulador:estado`, `simulador:cenario`, `simulador:alerta`.

**Correção feita no backend durante a Etapa 3:** ao iniciar um cenário, o preenchimento inicial não avisava os painéis abertos. Agora o motor emite `regiao:ocupacao` para todas as regiões e `indicadores:atualizados` depois do preenchimento, e há teste para isso.

## 5. Como executar e demonstrar

Pré-requisitos: banco no ar com o schema (`pnpm db:up`, `pnpm db:push`, `pnpm db:seed`).

Terminal 1, a API:

```bash
pnpm dev:api
```

Terminal 2, a web:

```bash
pnpm dev:web
```

Abra os endereços:
- `http://localhost:5173/painel` (painel);
- `http://localhost:5173/totem?acesso=A_NE` (totem);
- o localizador abre pelo QR Code do ticket emitido no totem (`http://localhost:5173/t/<token>`).

**Roteiro sugerido:**

1. No painel, informe o token do operador (o `SIMULADOR_TOKEN` de `apps/api/.env`), escolha um cenário (ex.: D, congestionamento) e clique em **Iniciar cenário**.
2. Veja as movimentações e o mapa mudando.
3. Num celular na mesma rede, ou no navegador, use o totem para gerar um ticket e abra o link do QR Code. Ele dirá "Estacionamento ainda não confirmado".
4. Confirme o estacionamento pela API:

   ```bash
   curl -X POST localhost:3333/api/tickets/PV-0001/estacionar
   ```

5. Atualize o localizador: a região aparece destacada.
6. No fim, use **Reiniciar dados simulados** para apagar só o que é simulado.

### Testes

Testes de componente (Vitest + Testing Library):

```bash
pnpm --filter @parkvision/web test
```

Testes ponta a ponta (Playwright com o Edge instalado). Eles sobem a API no banco de teste, na porta 3334, e a web na porta 5174:

```bash
pnpm e2e
```

Capturas de tela do relatório:

```bash
CAPTURAS=1 pnpm --filter @parkvision/web e2e capturas
```

## 6. Responsividade e acessibilidade

- **Totem:** alvos de toque de 80 px nos botões principais e categorias com mais de 170 px. Testado em 1366×900 e 1080×1920 (retrato), sem rolagem horizontal.
- **Painel:** a grade se reorganiza.
  - Em telas grandes, mapa e coluna lateral ficam lado a lado (≥ 1280 px).
  - Em telas menores, a coluna desce para baixo do mapa, e a barra lateral vira barra superior abaixo de 1024 px.
  - O mapa sempre ocupa a largura disponível, mantendo a proporção (teste ponta a ponta em 768, 1024 e 1920 px).
- **Localizador:** projetado para 375 px; teste ponta a ponta confirma que não há rolagem horizontal e que os botões têm pelo menos 36 px.
- **Acessibilidade:**
  - foco visível de 3 px;
  - regiões do mapa como botões com `aria-label` completo e seleção por teclado (Enter/Espaço);
  - tabela de regiões como alternativa ao mapa;
  - `aria-live="polite"` nas movimentações e nas etapas do totem;
  - `role="alert"` nos erros;
  - link "Pular para o conteúdo";
  - `prefers-reduced-motion` respeitado (sem pulso, brilho nem rotação);
  - contraste dos tokens validado (26/26 pares ≥ 4,5:1, verificação da 1ª entrega).
