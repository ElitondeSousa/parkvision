# Fluxo de entrada do veículo

Do totem à sinalização, sem exigir smartphone.

> Usado em [03-arquitetura.md](../03-arquitetura.md). Diagramas de localização/circulação serão atualizados após a análise da planta real.

```mermaid
sequenceDiagram
  autonumber
  actor M as Motorista
  participant T as Totem de entrada
  participant API as Backend
  participant DB as PostgreSQL
  participant MQ as Broker MQTT
  participant PN as Painéis

  M->>T: Para na cancela e escolhe categoria (moto / carro pequeno / carro grande)
  T->>API: POST /entradas {acessoId, categoria}
  API->>DB: Lê ocupação por zona + veículos em trânsito
  API->>API: Calcula score das zonas elegíveis
  API->>DB: Cria Ticket + Recomendação (transação)
  API-->>T: {ticket, token, codigoCurto, zona, setor, orientacao}
  T->>M: Imprime ticket (zona, setor, seta, QR Code)
  T->>API: Abrir cancela
  API->>MQ: publica display dos painéis da rota
  MQ->>PN: "Z2 → 48 LIVRES"
  Note over M,PN: Motorista segue a sinalização física — não precisa de celular
```
