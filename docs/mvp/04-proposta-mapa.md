# MVP 04 — Proposta do mapa digital

> Etapa 0 · proposta para validação. **Abra o visualizador:** [`mapa/proposta-mapa.html`](mapa/proposta-mapa.html) (dois cliques; funciona sem internet, exceto as fontes). Ele sobrepõe as regiões, acessos e vias à planta, com controle de transparência e uma ferramenta de rota de teste.

## 1. Como o mapa foi construído

1. **Base geométrica extraída do próprio PDF.** A planta é vetorial. Os traços maiores (vias, rotatórias, contorno do shopping, fileiras de vagas) foram exportados direto do arquivo para [`mapa/base-vetorial.json`](mapa/base-vetorial.json). Por isso a geometria, as proporções e as posições são as da planta, sem redesenho à mão.
2. **Regiões, acessos e vias traçados por cima**, nas mesmas coordenadas do PDF, em [`mapa/capim-dourado.rascunho.json`](mapa/capim-dourado.rascunho.json).
3. **Conferência visual:** no visualizador, a planta original fica por baixo e dá para comparar camada por camada.

O que foi simplificado: vagas individuais, pilares, lojas e sinalização miúda. O que foi preservado: forma do terreno, pátios, fileiras, vias, rotatórias, acessos, subsolos e sentidos de circulação desenhados.

## 2. O que a planta mostra (resumo)

Análise completa em [`../10-analise-planta.md`](../10-analise-planta.md).

| Nível | Estacionamento | Capacidade | Fonte |
|---|---|---|---|
| Térreo — pátio norte | Fileiras em leque entre a C&A, a rotatória da via norte e o bloco Big/Wow Park | **378** | contado no desenho (N1 127 + N2 48 + N3 203) |
| Térreo — pátio sul | Bolsões dos dois lados do retorno de embarque, na Av. NS-05 | **161** | contado no desenho (S1 78 + S2 83) |
| Subsolo 1 — carros | 4 ilhas em serpentina de mão única + faixa leste em "L" | **140** | escrito na planta |
| Subsolo 1 — motos | Área própria com rampa de motos | **374** | contado no desenho (1 retângulo = 1 vaga) — confirmar |
| Subsolo 2 | Anel anti-horário, 3 blocos de ilhas, rampa no nordeste | **216** | escrito na planta |

## 3. Regiões propostas (10)

> Capacidades atualizadas na segunda leitura da planta ([06-revisao-planta.md](06-revisao-planta.md)). Área de serviço a leste (~20 vagas) fica fora da distribuição.

| Região | Nome | Nível | Categorias | Capacidade |
|---|---|---|---|---|
| N1 | Norte Oeste | Térreo | carros | 127 (desenho) |
| N2 | Norte Centro | Térreo | carros | 48 (desenho) |
| N3 | Norte Leste | Térreo | carros | 203 (desenho) |
| S1 | Sul Oeste | Térreo | carros | 78 (desenho) |
| S2 | Sul Leste | Térreo | carros | 83 (desenho) |
| SS1 | Subsolo 1 | Subsolo 1 | carros | 140 (planta) |
| SS1M | Subsolo 1 Motos | Subsolo 1 | motos | 374 (desenho) |
| SS2O | Subsolo 2 Oeste | Subsolo 2 | carros | 77 (de 216) |
| SS2C | Subsolo 2 Centro | Subsolo 2 | carros | 49 (de 216) |
| SS2L | Subsolo 2 Leste | Subsolo 2 | carros | 90 (de 216) |

**Critérios da divisão:** limites físicos (pátio, pavimento, ilhas), cada região alcançável por um trecho único de via (para a orientação fazer sentido) e nomes curtos para o ticket e os painéis.

## 4. Acessos e vias

| Acesso | Local | Confiança | Observação |
|---|---|---|---|
| A_NE | Nordeste, cruzamento da via norte com a Av. LO 2A | alta | Duas faixas entrando (sentido oeste), uma saindo (leste), PARE e faixas de pedestre; 'Acesso motos' em pista separada |
| A_ROT | Rotatória da via norte | alta | Abertura com seta para dentro do pátio norte: entrada do pátio norte |
| A_S1 / A_S2 | Dois ramos curvos pela Av. NS-05 | média | Ligam a avenida ao retorno de embarque; sentido não legível |
| A_SS1 | Canto noroeste do Subsolo 1 | baixa | Seta e símbolo de veículo; ligação com o térreo não aparece |
| A_SS1M | Rampa de motos (desce) | alta | Texto da planta |
| A_SS2 | Rampa nordeste do Subsolo 2 | alta | Rampa de mão dupla; destino da rampa fora do recorte |

O grafo tem 27 nós e 26 trechos. Nos subsolos os sentidos estão desenhados na planta: serpentina no SS1 e anel anti-horário no SS2. No térreo os trechos estão como **"sentido a confirmar"** (linhas tracejadas).

## 5. Distâncias relativas (menor caminho no grafo)

Unidades da planta (sem escala métrica). São esses valores que alimentam o critério "distância" do algoritmo.

| De \ Para | N1 | N2 | N3 | S1 | S2 |
|---|---|---|---|---|---|
| A_NE (nordeste) | 899 | 666 | **477** | 2160 | 2820 |
| A_S1 (sul oeste) | 1587 | 1773 | 1997 | **88** | 618 |
| A_S2 (sul leste) | 2184 | 2370 | 2594 | 686 | **76** |

| De \ Para | SS2O | SS2C | SS2L |
|---|---|---|---|
| Rampa do SS2 | 544 | 339 | **114** |

As distâncias entre níveis (térreo ↔ subsolos) ficam pendentes até a ligação das rampas ser confirmada.

## 6. Como o mapa será usado no MVP

- **Painel:** mapa como elemento principal, com cada região colorida por ocupação (com texto e percentual, não só cor), região recomendada destacada e rota da última recomendação.
- **Totem:** mapa reduzido com a rota do acesso até a região recomendada.
- **Localizador:** mapa do nível onde o carro está, com a região destacada e a orientação a pé.
- Componente único `MapaSVG`; atualizações em tempo real trocam só a cor e o rótulo da região afetada.

## 7. Simulação 3D (demonstração)

[`mapa/simulacao-3d.html`](mapa/simulacao-3d.html) mostra os três níveis com a geometria da planta e **veículos com aparência real** (hatch, sedã, SUV, picape e moto, com pintura metálica, vidros, rodas, faróis e lanternas; cores na proporção comum da frota brasileira). Os carros estacionam **alinhados nas vagas desenhadas na planta** (posição e orientação extraídas do PDF), circulam pelas vias em velocidade de estacionamento e recebem a região pelo algoritmo 50/30/20, com justificativa. Tem cenários (normal, pico, saída em massa), lotar/fechar região, comparação ParkVision × tradicional e vistas de perto dos pátios.

Endereço: `?auto` inicia sozinha; `?avancar=120` adianta 120 s de simulação; `?vista=norte|sul|subsolos`; `?sem-cores` esconde as cores de ocupação. Precisa de internet para baixar a biblioteca Three.js.

**Maquete do shopping:** o prédio também aparece em 3D (botão "Maquete do shopping" e vista "Shopping (perto)"), com galeria, lojas âncora (C&A, Riachuelo, Renner, Centauro, Marisa, bloco Big/Wow Park/Pernambucanas), Cinemark, Madero, claraboias das três praças e a praça de alimentação no 2º pavimento. Os contornos foram traçados sobre a planta e estão em [`mapa/maquete-shopping.json`](mapa/maquete-shopping.json) (gerado por `gerar-maquete.mjs`). A praça de alimentação foi posicionada sobre a ala oeste alinhando a fachada curva e o átrio das escadas rolantes da folha 2/2 com o térreo (escala ≈ 1:5,2, rotação −4°). As alturas são estimativas: a planta não informa alturas.

Limites: os modelos são procedurais (sem marcas ou modelos reais licenciados); a movimentação é simulada; os subsolos ficam abaixo do térreo em posição **ilustrativa** e a ligação das rampas (linha tracejada) é suposição a confirmar.

## 7.1 Localizador no celular (visão do cliente)

[`mapa/cliente-mobile.html`](mapa/cliente-mobile.html) mostra a página que o motorista abre ao ler o QR Code do ticket: região do carro em destaque na maquete 3D, marcador, caminho a pé a partir da entrada de pedestres mais próxima (entradas lidas na planta: C&A, acesso de pedestres ao lado do Big, entrada principal sul, Renner; para os subsolos, o "acesso galeria subterrânea" perto do Cinemark), passos em texto, dados do ticket e botões de pagamento e ajuda. No computador aparece dentro de uma moldura de celular, com um seletor para simular outros tickets; no celular ocupa a tela inteira e o mapa gira com o dedo. Endereço: `?regiao=N3` (qualquer região).

## 8. O que precisa de validação antes da implementação

Ver [`05-duvidas.md`](05-duvidas.md), itens D1 a D8.
