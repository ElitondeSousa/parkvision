# Pagamento por QR Code

QR com token opaco → página mobile → Pix via PaymentProvider (mock nesta fase) → liberação da saída.

> Usado em [03-arquitetura.md](../03-arquitetura.md). Diagramas de localização/circulação serão atualizados após a análise da planta real.

```mermaid
sequenceDiagram
  autonumber
  actor M as Motorista
  participant PG as Página /t/:token
  participant API as Backend (pagamentos)
  participant PP as PaymentProvider
  participant GW as Gateway Pix (futuro)
  participant SA as Cancela de saída

  M->>PG: Lê o QR Code do ticket
  PG->>API: GET /t/{token}
  API-->>PG: tempo de permanência, valor calculado, status
  M->>PG: Escolhe Pix
  PG->>API: POST /t/{token}/pagamentos {metodo:"PIX"} + Idempotency-Key
  API->>PP: criarCobranca(valor, referencia)
  PP->>GW: cria cobrança Pix (v1: MockProvider responde)
  GW-->>API: QR Pix + copia-e-cola + idExterno
  API-->>PG: exibe QR Pix
  M->>GW: Paga no app do banco
  GW->>API: webhook pagamento confirmado (assinatura verificada)
  API->>API: marca Pagamento=CONFIRMADO (idempotente), Ticket=PAGO, libera saída por 15 min
  API-->>PG: comprovante (via polling/WebSocket)
  Note over PP,GW: Na v1 o MockProvider simula o gateway e o webhook — nenhuma cobrança real
  M->>SA: Insere ticket / lê QR na saída
  SA->>API: POST /saidas
  API-->>SA: liberar
```
