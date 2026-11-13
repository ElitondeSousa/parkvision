# Diagrama de arquitetura geral

Visão dos componentes de campo, servidor local, clientes web e gateway.

> Usado em [03-arquitetura.md](../03-arquitetura.md). Diagramas de localização/circulação serão atualizados após a análise da planta real.

```mermaid
flowchart LR
  subgraph Campo["Estacionamento (campo)"]
    S1["Sensores de vaga<br/>ESP32 + HC-SR04 / magnetômetro"]
    P1["Painéis de LED<br/>ESP32 + matriz"]
    T1["Totem de entrada<br/>quiosque + impressora térmica"]
    C1["Cancelas entrada/saída"]
  end

  subgraph Borda["Servidor local (shopping)"]
    MQ[("Broker MQTT<br/>Eclipse Mosquitto")]
    API["Backend NestJS<br/>regras de negócio"]
    DB[("PostgreSQL 16")]
  end

  subgraph Web["Clientes web"]
    ADM["Painel administrativo<br/>React + Vite"]
    PAY["Página de pagamento mobile<br/>/t/:token"]
  end

  GW["Gateway de pagamento<br/>Pix (futuro)"]

  S1 -- "MQTT: estado da vaga" --> MQ
  MQ -- "MQTT: display" --> P1
  MQ <--> API
  T1 -- "HTTPS/REST: nova entrada" --> API
  API -- "comando" --> C1
  API <--> DB
  API -- "WebSocket: ocupação ao vivo" --> ADM
  ADM -- "REST" --> API
  PAY -- "REST" --> API
  API -- "cobrança Pix" --> GW
  GW -- "webhook confirmação" --> API
```
