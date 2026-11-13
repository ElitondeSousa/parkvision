# Distribuição inteligente

Elegibilidade, score e escolha da zona (v1: recomendação de zona).

> Usado em [09-distribuicao-inteligente.md](../09-distribuicao-inteligente.md). Diagramas de localização/circulação serão atualizados após a análise da planta real.

```mermaid
flowchart TD
  A([Veículo no totem]) --> B[Categoria informada<br/>moto / carro pequeno / carro grande<br/>+ necessidade PcD/idoso]
  B --> C[Carregar zonas ativas do estabelecimento]
  C --> D{Para cada zona}
  D --> E{Tem vagas compatíveis?}
  E -- não --> X1[Inelegível: incompatível]
  E -- sim --> F{Saúde dos sensores ≥ 0,6?}
  F -- não --> X2[Inelegível: sensores com falha]
  F -- sim --> G[LivresEfetivas = livres − em trânsito]
  G --> H{LivresEfetivas > reserva mínima?}
  H -- não --> X3[Inelegível: sem vagas efetivas]
  H -- sim --> I[Rota no grafo dirigido<br/>Dijkstra, ignora arestas bloqueadas]
  I --> J{Existe rota permitida?}
  J -- não --> X4[Inelegível: sem rota]
  J -- sim --> K[Calcular Disp, DistNorm,<br/>FluxoNorm, Saude e Score]
  X1 & X2 & X3 & X4 --> L[Registrar motivo na justificativa]
  K --> M{Alguma zona elegível?}
  L --> M
  M -- não --> N[Totem: sem vagas para a categoria<br/>Painel de entrada: LOTADO<br/>Alerta ao operador]
  M -- sim --> O[Escolher maior score<br/>desempate: menor distância]
  O --> P[Setor sugerido: mais vagas efetivas<br/>descontando os em trânsito do setor]
  P --> Q[(Gravar Ticket + Recomendação<br/>com score de todas as zonas)]
  Q --> R[Imprimir ticket e atualizar<br/>painéis da rota]
```
