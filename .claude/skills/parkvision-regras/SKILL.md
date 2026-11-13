---
name: parkvision-regras
description: Regras de negócio e de projeto do ParkVision (MVP de distribuição inteligente de veículos no estacionamento do Capim Dourado Shopping). Use antes de implementar ou revisar qualquer parte do algoritmo, da API, do simulador, do mapa digital ou das interfaces do ParkVision.
---

# Regras do ParkVision (MVP)

## Conceito
"O ParkVision não apenas mostra onde há vagas; ele distribui os veículos para melhorar a experiência do motorista." A unidade de distribuição é a **região**.

## Proibido no MVP
- Reserva temporária de vaga, bloqueio preventivo ou qualquer mecanismo semelhante. Uma recomendação **não** altera a ocupação.
- Recomendar região sem vaga livre, incompatível com a categoria, fora de operação ou com dados inválidos.
- Inventar regiões, corredores, entradas, saídas ou capacidades que não estejam na planta.
- Pagamentos, câmeras, reconhecimento de placa, GPS, sensores físicos, SENATRAN.
- Interfaces além de: totem (`/totem`), painel (`/painel`) e localizador (`/t/:token`).

## Categorias
`CARRO_PEQUENO`, `CARRO_GRANDE` (carro grande, SUV ou caminhonete) e `MOTO`. Motos vão para a região de motos (`SS1M`); carros para as demais, salvo restrição validada pela equipe.

## Algoritmo
1. Filtros: categoria compatível · região operacional · `livres > 0` · dados válidos (0 ≤ ocupadas ≤ capacidade; atualizados há menos de 60 s) · rota existente no grafo.
2. `Score = 0,50·Disp + 0,30·(1 − DistNorm) + 0,20·(1 − FluxoNorm)`
   - `Disp = livres / capacidade`
   - `DistNorm = custoRota / maior custoRota entre as elegíveis` (menor caminho no grafo do mapa)
   - `FluxoNorm = mín(1, recomendações + entradas dos últimos 5 min / vazão de referência)`
3. Desempate (diferença < 0,01): menor distância → mais vagas livres → código da região.
4. Justificativa em português, comparando a vencedora com a segunda colocada; sem região elegível, explicar os motivos.
5. Função pura e determinística em `packages/core`.

## Ocupação
- Confirmação de estacionamento: `ocupadas + 1` na região confirmada (padrão: a recomendada).
- Saída: `ocupadas − 1` na região onde o veículo estava.
- Toda mudança gera `evento_ocupacao` e o evento `regiao:atualizada` no Socket.IO.

## Mapa digital
- Fonte única: arquivo `MapaDigital` (rascunho em `docs/mvp/mapa/capim-dourado.rascunho.json`), em coordenadas da planta `docs/planta/2026_11_CDS_MIX.pdf`.
- Preservar geometria, posição das regiões, acessos, vias, conexões e proporções. Simplificar só detalhes (vagas individuais, pilares, sinalização miúda).
- Distâncias são relativas (a planta não tem escala geral).
- Elementos com `confianca: baixa` ou `sentido: a-confirmar` precisam de validação humana antes de virar regra.

## Dados
- Capacidade com fonte explícita: `planta` (escrito na planta: SS1 = 140, SS2 = 216), `desenho` (contado no desenho: motos SS1M = 374, a confirmar) ou `simulada`.
- Todo dado simulado aparece com o selo "simulado" nas telas e nas métricas de comparação.

## Processo
- Uma etapa por vez; não avançar sem validação da equipe.
- Ao fim de cada etapa: relatório com arquivos criados/alterados, testes executados, pendências e próximos passos.
- Não commitar sem autorização da equipe. Nunca adicionar a linha `Co-Authored-By` do Claude nos commits.
- Cada agente altera só os arquivos que lhe pertencem (ver `docs/mvp/03-plano-execucao.md`).
