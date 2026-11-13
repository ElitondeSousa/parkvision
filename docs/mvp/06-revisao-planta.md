# MVP 06 — Revisão da planta (segunda leitura)

> Etapa 0 · revisão feita a pedido da equipe, com leitura em alta resolução e análise do desenho vetorial do PDF. Substitui as estimativas da primeira leitura onde havia números "a contar".

## 1. Contagem das vagas pelo desenho

**Método.** No desenho, cada vaga é delimitada por traços paralelos: no térreo, traços de ~17 unidades espaçados ~8,3; nas fileiras duplas, um traço de ~33 atravessa as duas vagas de costas uma para a outra. Uma sequência de *k* traços alinhados forma *k − 1* vagas. O método foi automatizado sobre o PDF e calibrado contra os números escritos na planta:

| Validação | Escrito na planta | Detectado no desenho |
|---|---|---|
| Subsolo 2 | 216 | 212 (98%) |
| Subsolo 1 (bloco das ilhas) | 140 | 141 |

**Resultado no térreo** (mínimo detectado — algumas fileiras com traços irregulares escapam; estimativa de cobertura ~90%):

| Região | Vagas detectadas | Antes |
|---|---|---|
| N1 Norte Oeste | **127** | a contar |
| N2 Norte Centro (bolsões da entrada C&A) | **48** | a contar |
| N3 Norte Leste | **203** | a contar |
| S1 Sul Oeste | **78** | a contar |
| S2 Sul Leste | **83** | a contar |
| **Pátios descobertos** | **539** | — |

Os polígonos de N1, N2, N3 e S2 foram ampliados para incluir fileiras que a primeira leitura deixou de fora (oeste e sul de N1, bolsões em frente à C&A, ponta sul de N3, ponta leste de S2).

**Subsolo 2 por bloco** (216 da planta, divididos na proporção detectada 76 / 48 / 88): SS2O = 77, SS2C = 49, SS2L = 90.

**Motos:** 374 vagas (um retângulo por vaga no desenho).

**Capacidade total do MVP:** 539 (pátios) + 140 (SS1) + 216 (SS2) = **895 vagas de carro** + **374 de moto**.

## 2. Achados novos

1. **Subsolo 1 — divergência entre texto e desenho.** A planta escreve "140 vagas", mas o desenho tem cerca de **165 espaços** de vaga: as 4 ilhas somam ~140, e a faixa leste em "L" e a fileira junto à parede sul acrescentam ~25. Pode ser ampliação não refletida no texto, ou vagas reservadas (lojistas, carga). O MVP usa o número oficial (140) até a confirmação.
2. **Área de serviço a leste.** Entre o Cinemark e a Av. LO 2A há um pátio com centro de distribuição, depósito e lava-jato, com ~20 vagas. Provavelmente de serviço/funcionários: ficou **fora da distribuição** (registrado em `areasNaoDistribuidas`).
3. **Acesso nordeste esclarecido.** É o cruzamento da via norte com a Av. LO 2A. As setas indicam **duas faixas entrando no sentido oeste e uma saindo no sentido leste**, com placas "PARE" e faixas de pedestre. O "Acesso motos" é uma **pista separada**, com setas próprias, que desce ao longo da Av. LO 2A.
4. **Rotatória = entrada do pátio norte.** A rotatória fica sobre a via norte e tem abertura com seta apontando para dentro do pátio. Virou o acesso `A_ROT`.
5. **Acessos sul.** Dois ramos diagonais ligam a via marginal da Av. NS-05 aos retornos de embarque em frente à entrada principal. O sentido não está indicado.
6. **Pista sobre a posição dos subsolos.** A parede diagonal do Subsolo 1 tem **exatamente a mesma inclinação da via norte (−0,30)**, e a rampa de motos fica no canto nordeste do SS1, do mesmo lado do "Acesso motos". Hipótese: os subsolos ficam no lado norte, com acesso pelo nordeste. Registrada como hipótese `H_SUBSOLOS_NORTE` no mapa, **a confirmar**.

7. **Onde fica o 2º pavimento.** A fachada curva da praça de alimentação (folha 2/2) coincide com a fachada curva da Renner no térreo, e o átrio das escadas rolantes cai exatamente no átrio da praça de eventos ao lado da Renner. A praça de alimentação fica **sobre a ala oeste** (escala da folha 2/2 ≈ 5,2× maior que a do térreo).

## 3. O que continua sem resposta na planta

- Posição exata dos subsolos sob o terreno e onde as rampas de carro chegam ao térreo.
- Se há cancelas e totens, e em quais acessos.
- Sentido de cada corredor dos pátios descobertos (as setas existem, mas são pequenas e nem todas legíveis).
- Escala da implantação (distâncias continuam relativas).

## 4. Arquivos atualizados

| Arquivo | Mudança |
|---|---|
| `mapa/capim-dourado.rascunho.json` | Polígonos ampliados, capacidades contadas, acesso `A_ROT`, observações dos acessos, área de serviço, hipótese dos subsolos, retorno do anel do SS2 |
| `mapa/vagas-desenho.json` | **Novo:** posição e orientação de cada vaga detectada (térreo, SS1, SS2) e das 374 vagas de moto |
| `mapa/maquete-shopping.json` + `gerar-maquete.mjs` | **Novo:** volumetria do prédio (galeria, âncoras, cinema, praças, 2º pavimento) traçada sobre a planta |
| `mapa/simulacao-3d.html` | Carros com aparência real estacionando nas vagas do desenho (ver [04 §7](04-proposta-mapa.md)) |
