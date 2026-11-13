# Comunicação sensores ↔ backend ↔ painel

MQTT (dispositivos) e WebSocket (telas), com debounce, heartbeat e Last Will.

> Usado em [03-arquitetura.md](../03-arquitetura.md). Diagramas de localização/circulação serão atualizados após a análise da planta real.

```mermaid
sequenceDiagram
  autonumber
  participant S as Sensor da vaga (ESP32)
  participant MQ as Broker MQTT
  participant API as Backend (sensores/ocupação)
  participant DB as PostgreSQL
  participant WS as WebSocket Gateway
  participant ADM as Painel admin
  participant PN as Painel de LED

  S->>S: Lê distância a cada 1 s e confirma mudança após 3 s estável (debounce)
  S->>MQ: PUBLISH parkvision/{u}/vaga/{id}/estado {estado:"OCUPADA", seq, ts} QoS1
  MQ->>API: entrega mensagem
  API->>API: Valida seq/ts, descarta duplicada, atualiza estado
  API->>DB: UPDATE vaga + INSERT evento_vaga
  API->>API: Recalcula contadores da zona
  API->>WS: emit "ocupacao:zona" {zonaId, livres, total}
  WS->>ADM: Atualiza dashboard e mapa (≤ 2 s)
  API->>MQ: PUBLISH parkvision/{u}/painel/{p}/display (retained)
  MQ->>PN: Atualiza contagem / seta
  loop a cada 30 s
    S->>MQ: heartbeat {bateria, rssi, fw}
  end
  Note over MQ,API: Se o ESP32 cair, o broker publica o Last Will "offline" → vaga vai para ERRO e sai do cálculo
```
