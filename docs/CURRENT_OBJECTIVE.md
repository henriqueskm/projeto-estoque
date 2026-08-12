# Objetivo atual

- **ID:** NK-ORD-008
- **Título:** Criar Pedido a partir de foto pela Assistente
- **Prioridade:** alta
- **Fase:** auditoria
- **Estado:** `READY_FOR_AUDIT`
- **Dependência concluída:** NK-ORD-007 `DONE`

## Objetivo resumido

`foto/câmera → interpretação multimodal → validação com catálogo → preview → confirmação por botão → Pedido normal/ativo`

## Escopo da próxima auditoria

- identificar o contrato oficial para criação de Pedido normal/ativo;
- definir como a imagem será recebida e interpretada sem tornar o modelo fonte
  de verdade para códigos, quantidades ou identidades do catálogo;
- preservar preview e confirmação explícita antes de qualquer escrita;
- avaliar segurança, idempotência, concorrência, auditoria e limites do payload;
- não implementar nem executar operação real durante a auditoria.

## Prioridade registrada

NK-QA-001 permanece válido e `READY`, mas sua execução foi adiada até a
conclusão de NK-ORD-008 por decisão explícita de prioridade.

Os bloqueios de NK-ORD-002, NK-ORD-003 e NK-ORD-005 permanecem inalterados.
