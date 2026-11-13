| Portas de acesso de pedestres ao shopping | ✅ Entrada principal (sul), entrada C&A (norte), escadas rolantes e galeria subterrânea || Restrições (altura, motos, carga/descarga) | ⚠️ Motos com rampa própria; docas de carga identificadas; altura não informada || Escala/dimensões | ❌ Não constam na planta (não estimar) || Quantidade e tipo de vagas por área | ⚠️ SS1 = 140 e SS2 = 216 (com PNE/idoso/neurodiverso/gestante); pátios e motos a contar || Sentidos de circulação e rampas | ⚠️ Subsolos com sentido desenhado (serpentina no SS1, anel no SS2); ligação entre subsolos e rampas de carro a confirmar || Entradas/saídas e posição das cancelas | ⚠️ Acessos identificados (nordeste/Av. LO 2A, rotatória norte, dois acessos pela Av. NS-05); cancelas a confirmar || Número de pavimentos e níveis | ✅ Térreo (pátios norte e sul), Subsolo 1 e Subsolo 2; 2º pavimento sem estacionamento |# Adaptação à Planta do Estacionamento 🗺️

> **Situação em 13/11/2026:** planta **recebida** (Capim Dourado Shopping — Planta Mix, 3 folhas, em [`planta/`](planta/)). A análise e a proposta de zonas estão em **[10-analise-planta.md](10-analise-planta.md)**. Este documento acompanha o que ainda falta adaptar. A simulação Z1–Z4 do protótipo continua rotulada como **EXEMPLO** até a Fase 1.

## 1. O que já está pronto para receber a planta

| Elemento | Como foi preparado |
|---|---|
| Modelo de dados | Hierarquia genérica `Estabelecimento → Pavimento → Zona → Setor → Vaga` sem quantidades fixas ([schema.prisma](../backend/prisma/schema.prisma)) |
| Posição no mapa | `Vaga.posX/posY/rotacao`, `Zona.poligono` e `Pavimento.plantaUrl` (a planta vira o fundo do mapa) |
| Circulação | Grafo dirigido `NoCirculacao` / `ArestaCirculacao` com sentido, distância, bloqueio e restrição (altura, moto) |
| Algoritmo | Usa distância **pela rota** do grafo, não em linha reta ([09](09-distribuicao-inteligente.md)) |
| Interface | Componentes `ParkingSpot`, `ZoneOverlay`, `RouteLine` desenham qualquer layout a partir dos dados ([04](04-design-system.md)) |

## 2. Roteiro de análise quando a planta chegar

1. **Inventário físico:** identificar pavimentos/níveis, rampas, entradas, saídas, cancelas, corredores, sentidos de circulação, áreas de pedestre, acessos ao shopping (portas, elevadores, escadas).
2. **Vagas:** contar por pavimento e tipo (comum, PcD, idoso, moto, outras). Registrar apenas o que for legível; o que estiver ilegível ou ausente vai para a tabela de pendências (seção 4).
3. **Proposta de zonas:** agrupar vagas contíguas que compartilham o mesmo corredor de acesso e a mesma porta de pedestre mais próxima; equilibrar capacidade; limites em pontos naturais (pilares, rampas, mudança de corredor).
4. **Nomenclatura:** escolher a mais adequada ao local (ex.: por pavimento + cor, por referência de loja âncora, ou código alfanumérico) — o código definido vira `Zona.codigo` e aparece no ticket e nos painéis.
5. **Setores:** subdividir zonas por corredor/fileira, de forma que "Zona + Setor" seja localizável a pé.
6. **Grafo de circulação:** nós em acessos, bifurcações, rampas e entradas de zona; arestas com sentido permitido e distância **medida na escala da planta** (sem estimativas inventadas).
7. **Pontos estratégicos:** painéis em cada ponto de decisão do grafo (antes de bifurcações/rampas e na entrada de cada pavimento/zona); contadores nas entradas de zona; sensores por vaga nas zonas monitoradas; totem em cada entrada; posição de *gateways*/APs de rede.
8. **Atualizar artefatos:** mapa (Tela 2), mini-mapa da distribuição (Tela 3), diagramas de fluxo de entrada e de circulação, parâmetros `capacidadeVazaoPorMin` por zona, `seed` do banco.

## 3. Artefatos que serão alterados

| Artefato | Alteração |
|---|---|
| `prototype/index.html` — Tela 2 (Mapa) e Tela 3 (Distribuição) | Substituir a planta conceitual pela planta real e remover o selo "EXEMPLO" |
| [05-telas.md](05-telas.md) | Descrever as zonas reais |
| [09-distribuicao-inteligente.md](09-distribuicao-inteligente.md) | Exemplo numérico com distâncias reais; capacidade de vazão por zona |
| [03-arquitetura.md](03-arquitetura.md) §7 | Pontos de instalação de sensores/painéis; escolha de rede (Wi-Fi, RS-485, LoRaWAN) |
| [diagrams/](diagrams/) | Diagramas de entrada/circulação com acessos e sentidos reais |
| Dados iniciais (seed) do banco | Pavimentos, zonas, setores, vagas, grafo |

## 4. Pendências de informação (atualizado após a análise da planta)

| Informação | Status |
|---|---|
| Número de pavimentos e níveis | ⏳ aguardando planta |
| Entradas/saídas e posição das cancelas | ⏳ aguardando planta |
| Sentidos de circulação e rampas | ⏳ aguardando planta |
| Quantidade e tipo de vagas por área | ⏳ aguardando planta |
| Escala/dimensões | ⏳ aguardando planta (não estimar) |
| Restrições (altura, motos, carga/descarga) | ⏳ aguardando planta |
| Portas de acesso de pedestres ao shopping | ⏳ aguardando planta |
| Infraestrutura elétrica/rede disponível | ⏳ provavelmente não consta na planta — confirmar com a administração |
