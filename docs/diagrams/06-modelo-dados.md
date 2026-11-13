# Modelo de dados (conceitual)

Entidades principais. Esquema físico: backend/prisma/schema.prisma.

> Usado em [03-arquitetura.md](../03-arquitetura.md). Diagramas de localização/circulação serão atualizados após a análise da planta real.

```mermaid
erDiagram
  ESTABELECIMENTO ||--o{ PAVIMENTO : possui
  PAVIMENTO ||--o{ ZONA : dividido_em
  ZONA ||--o{ SETOR : contem
  SETOR ||--o{ VAGA : contem
  CATEGORIA_VEICULO ||--o{ VAGA_CATEGORIA : aceita
  VAGA ||--o{ VAGA_CATEGORIA : compativel
  VAGA ||--o| SENSOR : monitorada_por
  VAGA ||--o{ EVENTO_VAGA : historico
  PAVIMENTO ||--o{ NO_CIRCULACAO : grafo
  NO_CIRCULACAO ||--o{ ARESTA_CIRCULACAO : origem
  ZONA ||--o{ PAINEL_SINALIZACAO : orienta
  ACESSO ||--o{ TICKET : entrada_por
  CATEGORIA_VEICULO ||--o{ TICKET : classifica
  TICKET ||--o{ MOVIMENTACAO : registra
  TICKET ||--o| RECOMENDACAO : recebe
  TICKET ||--o{ RESERVA_VAGA : pode_ter
  TICKET ||--o{ PAGAMENTO : pago_por
  TARIFA ||--o{ PAGAMENTO : aplica
  ZONA ||--o{ OCUPACAO_SNAPSHOT : historico
  USUARIO ||--o{ AUDITORIA : executa
```
