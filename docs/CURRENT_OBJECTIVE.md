# Objetivo atual

- **ID:** NK-ORD-008B
- **Título:** Foto → Gemini → validação → preview
- **Prioridade:** alta
- **Fase:** aplicação sem criação real de Pedido
- **Estado:** `IMPLEMENTED / WAITING_HUMAN_PHOTO_REVIEW`
- **Classificação:** **B — ajustes de aplicação sobre contratos aprovados**
- **Dependências:** NK-ORD-008 `ARCHITECTURE_APPROVED`; MIG-ORD-008A
  `DONE / APPLIED_REMOTE / VERIFIED`
- **Base:** `56cf09f9a0e7bcb7503ef58512112969aa19af7b`
- **Branch:** `agent/assistant-photo-order-preview`
- **PR:** [#24](https://github.com/henriqueskm/projeto-estoque/pull/24) (draft)

## Implementação NK-ORD-008B

O gap entre o `File` local e o provider multimodal foi fechado sem habilitar
qualquer escrita operacional:

- câmera, galeria e arquivo desktop preparam uma única imagem no browser;
- JPEG/PNG/WebP são decodificados com orientação, limitados a 2.800 px e
  convertidos em JPEG progressivamente até o alvo de 3,5 MB;
- HEIC/HEIF seguem diretamente apenas dentro do limite seguro do servidor;
- `POST /api/assistant/order-photo/interpret` aceita multipart estrito com um
  único campo `image`, exige same-origin, sessão e profile interno ativo;
- MIME declarado e magic bytes são comparados antes do provider;
- Gemini recebe a imagem somente em memória, com `store: false`, nenhuma
  ferramenta e schema JSON fechado;
- o texto visual é explicitamente tratado como dado não confiável;
- negociação, data, códigos e quantidades são revalidados no servidor;
- o catálogo oficial resolve códigos exatos, preserva aliases identificados e
  não usa fuzzy matching;
- duplicidade global é consultada em modo read-only;
- o block `supplier_order_photo_preview` persiste apenas dados visuais seguros;
- blob, base64, URL local, chave, IDs internos e conteúdo integral da imagem
  não entram na conversa ou em logs;
- a UI tradicional e a Server Action passaram a antecipar o contrato
  digits-only da negociação sem converter o texto nem remover zeros à esquerda.

Todas as prévias mostram “Somente prévia — nenhum Pedido foi criado.”. Não
existe botão Criar Pedido, proposal token operacional, rota de confirmação,
RPC mutável ou import do contrato de criação neste fluxo.

Próxima etapa: NK-ORD-008C, validação humana controlada com fotos reais no
Preview. NK-ORD-008D permanece bloqueada até essa aprovação e exigirá objetivo
separado para confirmação segura e criação.

## Rollout remoto concluído — MIG-ORD-008A

Em 2026-08-12, a migration
`20260812133046_enforce_supplier_order_negotiation_identity.sql` foi aplicada
uma única vez no projeto `EstoqueNK` (`isdjboconmwaqipjrjvp`) pela Supabase CLI
`2.112.0`. O histórico ficou alinhado e o dry-run posterior confirmou zero
migrations pendentes.

Os quatro IDs aprovados foram preservados e receberam as identidades
`99990000`, `99990001`, `99990003` e `99990004`. Foram criados exatamente
quatro eventos técnicos `ORDER_HEADER_UPDATED`; itens, quantidades, lifecycle,
relações Safisa, entradas, lotes, movimentos e saldos mantiveram contagens e
fingerprints. O banco agora impõe `TEXT NOT NULL`, formato ASCII digits-only de
1–120 caracteres e unicidade global não parcial.

## Implementação local MIG-ORD-008A

A auditoria read-only no projeto `isdjboconmwaqipjrjvp` encontrou sete
Pedidos, nenhuma duplicata exata e quatro negociações históricas de teste não
numéricas. A decisão humana aprovou o mapeamento fechado abaixo:

| Supplier order ID | Valor anterior | Identidade aprovada |
|---|---|---|
| `26e08e22-a2fb-4e8d-8605-4ccdb57d4773` | `teste 00` | `99990000` |
| `db02621b-b6c1-4e7a-8fef-b63fc3e60d50` | `teste 01` | `99990001` |
| `e92bc06f-5721-4082-b77a-def6954e3300` | `teste 03` | `99990003` |
| `af7a39f6-c4a2-4e92-b183-d8196aa775d1` | `Teste 04` | `99990004` |

A pré-validação remota confirmou os quatro pares e a ausência dos quatro
números novos. O rollout posterior converteu exclusivamente esse conjunto e
registrou os eventos técnicos previstos.

A migration incremental
`20260812133046_enforce_supplier_order_negotiation_identity.sql`:

- aceita uma instalação limpa sem os quatro registros ou exige o conjunto
  completo e exato; qualquer presença parcial ou divergência aborta;
- atualiza somente os quatro UUIDs aprovados, dentro de transação explícita;
- preserva itens, quantidades, status, finalização, relações Safisa e snapshots
  históricos;
- adiciona um `ORDER_HEADER_UPDATED` técnico por transição, com `user_id =
  NULL`, snapshot `MIG-ORD-008A` e valores anterior/novo no `details`;
- mantém `negotiation_number` como `TEXT NOT NULL`, exige `^[0-9]+$` e
  comprimento de 1–120;
- adiciona UNIQUE global sem filtro de lifecycle e remove o índice comum apenas
  depois da garantia única;
- preserva as assinaturas, autenticação, profile, grants, `SECURITY DEFINER` e
  `search_path` dos wrappers públicos de criação/edição;
- preserva o replay idempotente no worker e traduz somente a violação da nova
  UNIQUE para erro de domínio sanitizado.

As colunas `negotiation_number` nas duas views de resumo são leituras dinâmicas
por `supplier_order_id`. Os JSONs em `supplier_order_events.details` são
snapshots históricos imutáveis e não foram reescritos; os novos eventos técnicos
registram a transição de identidade.

A UI tradicional ainda usa um campo textual livre e pode permitir que o usuário
tente valores como `teste 05`, `12-12` ou `ABC`. O banco passa a rejeitar esses
valores; o alinhamento preventivo da UX fica para uma etapa de aplicação posterior
e não foi misturado nesta migration.

Testes locais descartáveis comprovaram rollback integral, aplicação sobre os
quatro legados, aplicação sobre instalação limpa, preservação de dados,
leading zeros, rejeição de formato, reserva em cancelados/finalizados, replay,
conflito idempotente e corrida com duas conexões. O gate final executou a
migration pelo runner real da Supabase CLI 2.112.0: o history foi registrado
uma única vez, o segundo `db push --local --dry-run` não encontrou pendências e
uma precondição deliberadamente inválida reverteu SQL e history integralmente.

`KEEP_EXPLICIT_TRANSACTION = YES`: não houve warning de `BEGIN`, `COMMIT`,
pipeline ou migration history. O lock `SHARE ROW EXCLUSIVE` bloqueia escritas
concorrentes e preserva leituras; com sete Pedidos e janela controlada, a seção
crítica é curta. Não foi adicionado `lock_timeout`, evitando tornar o rollout
sensível a um limite arbitrário depois de o SQL ter sido validado. A regra
interna `v_legacy_order_count in (0, 4)` permanece intencional para rebuild
limpo e produção atual; o preflight do rollout remoto exigiu exatamente os
quatro pares aprovados e a aplicação remota foi concluída e verificada.

## Conclusão executiva

O fluxo é tecnicamente viável sem armazenar a foto e pode reutilizar o contrato
oficial transacional de criação de Pedido. O provider atual, Gemini Developer
API com `gemini-3.6-flash`, já suporta imagem e saída estruturada. A regra de
identidade da negociação foi aprovada e exige uma migration para impor formato
e unicidade de maneira atômica no PostgreSQL.

Consequentemente:

- `MIGRATION_REQUIRED = YES`, atendido por MIG-ORD-008A;
- MIG-ORD-008A está `DONE / APPLIED_REMOTE / VERIFIED`;
- a próxima etapa é NK-ORD-008B — foto, Gemini, validação de catálogo e preview;
- NK-ORD-008B não cria Pedido real e não habilita confirmação operacional;
- a criação segura permanece em fase posterior, depois da validação visual da
  interpretação.

## Estado atual de câmera e galeria

### Browser

- existe um input de câmera real com `type="file"`, `accept="image/*"` e
  `capture="environment"`;
- `capture` é apenas uma indicação ao navegador móvel: em aparelhos compatíveis
  abre a câmera traseira, enquanto desktop e alguns navegadores podem abrir o
  seletor de arquivos;
- a galeria usa outro input `type="file"` com `accept="image/*"`;
- apenas o primeiro arquivo é considerado;
- há preview local por `URL.createObjectURL`, removido/revogado pelo componente;
- a seleção atual valida apenas se `File.type` começa com `image/`;
- não há limite de bytes, inspeção da assinatura real, validação de dimensões,
  decodificação segura, rotação, resize ou compressão;
- `image/*` não limita o MVP a JPEG/PNG.

### Backend

- a foto **não é enviada** ao backend nem ao provider;
- `/api/assistant/chat` recebe JSON estrito e somente dados textuais/tipados;
- `/api/assistant/media` serve para consultar/renovar fotos do catálogo por
  código, não para upload;
- não existe endpoint multipart, parsing de imagem, base64 de upload, limpeza
  temporária nem chamada multimodal;
- ao enviar a mensagem com anexo, a própria UI informa que apenas o texto foi
  enviado.

O gap atual é completo: “usuário escolheu uma foto” termina em um `File` e uma
URL local no browser; “modelo multimodal recebeu essa foto” ainda não existe.

## Evidência das amostras reais

As duas fotos foram inspecionadas localmente apenas como referência visual. Não
foram enviadas ao Supabase, ao Gemini ou a qualquer storage, nem copiadas para o
repositório.

Campos que parecem extraíveis com boa foto e ainda exigem validação:

- negociação, no bloco superior direito;
- `Data Negociação`, distinguindo-a de `Data Entrega` e `Hora Impressão`;
- linhas nas colunas `Cód.`, `Descrição`, `Qtde.` e `Unidade`;
- ordem das linhas e total impresso como conferência, não como autoridade;
- códigos numéricos e alfanuméricos, inclusive `R066`, `10A`, `7AC` e `11C`;
- quantidades impressas com vírgula e casas decimais zero, como `5,00`.

Campos/situações que exigem revisão humana:

- anotações manuscritas sobre descrição, quantidade ou unidade;
- marcações como `PCS-1`, `PCS OK`, números de referência e carimbos;
- caracteres visualmente próximos (`0/O`, `1/I`, `6/G`);
- cabeçalho ou bordas cortados, como ocorre parcialmente na segunda amostra;
- texto com baixo contraste, sombra, desfoque, inclinação ou perspectiva;
- diferença entre a descrição lida e a descrição oficial do código;
- observações manuscritas ou impressas sem semântica inequívoca.

O documento real comporta uma página no MVP, mas uma fotografia pode cortar o
cabeçalho ou a tabela. O servidor deve rejeitar preview operacional quando não
conseguir comprovar negociação, data e todas as linhas obrigatórias.

## Provider e modelo

- **Provider atual:** Google Gemini Developer API via `@google/genai` e
  Interactions API.
- **Modelo atual padrão:** `gemini-3.6-flash`, configurável por `GEMINI_MODEL`.
- **Chave server-side:** `GEMINI_API_KEY`.
- **Configuração atual:** `store: false`, `tool_choice: none`, timeout e zero
  retry automático; somente texto é enviado hoje.
- **PROVIDER_RECOMMENDED:** Google Gemini Developer API no plano pago.
- **MODEL_RECOMMENDED:** `gemini-3.6-flash`.
- **WHY:** modelo GA já usado pelo projeto, multimodal, adequado a tarefas
  visuais complexas e com structured output nativo; evita introduzir um segundo
  provider antes de medir o dataset real.
- **FALLBACK:** pedir nova foto/revisão humana. `gemini-3.5-flash-lite` pode ser
  avaliado posteriormente como alternativa de custo para documentos fáceis,
  mas não deve receber fallback automático sem comparação controlada.

Fontes oficiais consultadas em 2026-08-12:

- [modelos Gemini mais recentes](https://ai.google.dev/gemini-api/docs/latest-model);
- [Gemini 3.6 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash);
- [entendimento de imagens](https://ai.google.dev/gemini-api/docs/image-understanding);
- [preços da Gemini Developer API](https://ai.google.dev/gemini-api/docs/pricing);
- [termos adicionais e tratamento de dados](https://ai.google.dev/gemini-api/terms).

## Contrato de extração multimodal

A interpretação deve usar schema estrito nativo e nova validação server-side:

```ts
type SupplierOrderPhotoExtraction = {
  documentType: "supplier_order" | "unknown";
  negotiationNumber: string | null;
  orderDate: string | null;
  lines: Array<{
    position: number;
    rawCode: string | null;
    rawDescription: string | null;
    quantity: number | null;
    needsReview: boolean;
    warning: string | null;
  }>;
  documentWarnings: string[];
};
```

Regras de validação:

- nenhum Markdown ou texto livre como contrato interno;
- objeto fechado, tipos e limites revalidados no servidor;
- no máximo 1.000 linhas, alinhado ao contrato oficial, com limite menor de
  upload recomendado para o MVP (por exemplo, 100 linhas por foto);
- quantidade inteira entre 1 e `2_147_483_647`;
- `5,00` pode virar `5` somente quando a parte fracionária for exatamente zero;
- `0`, negativo, fração, overflow e ilegível ficam em revisão;
- ausência ou inconsistência de campos obrigatórios invalida a confirmação;
- o total impresso pode detectar divergência, mas não corrige linhas sozinho.

## Prompt injection visual

O prompt deve declarar que todo conteúdo da imagem é dado não confiável e que o
modelo deve apenas preencher o schema. Texto na folha nunca escolhe ferramenta,
RPC, UUID, SQL ou confirmação. A resposta do modelo permanece sem tools e passa
por validação de schema, resolução de catálogo e revisão humana. Instruções como
“ignore as instruções anteriores” devem aparecer, no máximo, como texto/warning
do documento.

## Catálogo como autoridade

O catálogo oficial separa:

- `ITEM`: Servo sem kit, Kit de instalação, Kit de reparo ou Peça avulsa;
- `COMMERCIAL_CONFIGURATION`: Servo com kit, opcionalmente ligado ao código
  comercial específico identificado no documento.

`items.code` e `commercial_configuration_codes.code` são únicos no schema, mas
a resolução deve ocorrer no backend e exigir correspondência exata após uma
normalização conservadora de caixa e espaços. Não usar fuzzy match para escolher
automaticamente. O modelo nunca fornece IDs confiáveis.

Resultado da resolução por linha:

- `MATCH`: código exato e descrição compatível;
- `CONFLICT`: código existe, mas descrição lida indica outro produto;
- `ZERO_MATCH`: código inexistente;
- `AMBIGUOUS`: mais de um alvo válido após a regra oficial.

Somente `MATCH` é confirmável. `CONFLICT`, `ZERO_MATCH` e `AMBIGUOUS` exigem
correção. Para aliases que apontam à mesma configuração física, preservar o
código comercial efetivamente lido e seu `commercial_configuration_code_id`,
como já faz a interface tradicional; não trocar silenciosamente pelo alias
preferido.

Texto impresso tem precedência para extração. Manuscrito conflitante produz
warning e revisão, nunca sobrescrita silenciosa.

## Contrato oficial de criação encontrado

A interface atual chama a Server Action `createSupplierOrder`, que autentica a
sessão, exige `profiles.is_active = true` e nome não vazio e chama somente:

```text
public.create_supplier_order(
  p_negotiation_number text,
  p_order_date date,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key uuid
) returns jsonb
```

O worker privado normaliza o payload, valida todo o catálogo ativo antes da
primeira escrita, cria Pedido e linhas, tira snapshots oficiais, grava o evento
`ORDER_CREATED` e retorna recibo na mesma transação. A idempotência é por usuário
e UUID; mesma chave com payload diferente é rejeitada. A Assistente deve
reutilizar esse contrato, não criar `.insert()` ou SQL paralelo.

Pedidos novos são normais/ativos. Pelo ciclo Safisa automático vigente, todos os
Pedidos não cancelados participam do portal sem publicação individual; criar o
Pedido pelo contrato oficial preserva essa integração sem lógica adicional.

### Identidade aprovada da negociação

O contrato de negócio aprovado é:

1. `negotiation_number` continua armazenado como texto/identificador;
2. aceita somente caracteres ASCII `0–9` depois de `trim` externo;
3. é único globalmente, inclusive entre Pedidos pendentes, parciais,
   concluídos e cancelados;
4. Pedido cancelado não libera a negociação;
5. a comparação é exata depois do trim externo;
6. zeros à esquerda são preservados e não normalizados: `001212` é diferente
   de `1212`;
7. letras, espaços internos, hífens, barras e quaisquer outros caracteres são
   inválidos;
8. não existe fuzzy matching para negociação;
9. uma negociação usada nunca cria silenciosamente outro Pedido.

Exemplos válidos: `1212`, `54821`, `000123`. Exemplos inválidos:
`Pedido 1212`, `12-12`, `12/12`, `12 12`, `ABC123`.

O schema remoto vigente antes da aplicação da migration ainda aceita 1–120
caracteres após `trim`, possui apenas índice comum e permite duplicatas. A
aplicação deve fazer consulta preflight para uma
UX amigável (`Este Pedido já existe` / `Abrir Pedido`), mas isso não substitui a
constraint de formato e o índice/constraint único no PostgreSQL. Somente a
migration garante atomicidade diante de confirmações concorrentes.

### Estado de MIG-ORD-008A

A auditoria, a implementação local e o rollout remoto foram concluídos com o
mapeamento humano explícito dos quatro legados. O histórico remoto, as
constraints, os wrappers, os eventos e a preservação operacional foram
verificados. NK-ORD-008B está liberado para implementação sem escrita.

## Preview e correção

O preview deve mostrar negociação, data, total e cada linha com leitura bruta,
código oficial, descrição oficial, quantidade e estado textual. UUIDs, prompt,
token e payload não aparecem.

- tudo resolvido: botões `Criar Pedido` e `Cancelar`;
- qualquer pendência: ocultar/desabilitar criação e oferecer busca no catálogo;
- negociação existente: mostrar `Este Pedido já existe` e `Abrir Pedido`, sem
  transformar o fluxo em edição;
- documento/foto inseguro: pedir nova foto mostrando a folha inteira.

Para o MVP, a correção mais simples e segura é editar a linha dentro do preview
por busca oficial do catálogo. A seleção revalida o alvo no backend e emite nova
proposta; resposta textual não altera linhas operacionais. Tirar nova foto fica
como alternativa quando vários campos estão ruins.

## Proposal token e endpoints futuros

### Interpretação

`POST /api/assistant/order-photo/interpret`

- autenticação e profile interno ativo;
- multipart com exatamente um arquivo e sem campos operacionais livres;
- validação de origem, bytes, MIME real, decode e dimensões;
- processamento em memória e envio inline ao Gemini;
- structured output, validação, resolução agrupada do catálogo e preview;
- zero escrita de Pedido e zero proposal token confirmável enquanto houver
  pendência.

### Confirmação

`POST /api/assistant/actions/supplier-order-create`

Recebe somente `{ proposalToken }`. O token HMAC deve conter versão, ação
`supplier_order_create`, userId, negociação, data, notas sanitizadas, linhas
resolvidas com IDs server-side e quantidades, idempotencyKey, issuedAt e
expiresAt (máximo recomendado de 10 minutos). A rota valida usuário/expiração,
recarrega catálogo e duplicidade, chama uma vez o contrato oficial e trata o
retorno da RPC como definitivo. “sim”, “criar” e “confirmar” nunca executam.

O token não deve ser persistido no `sessionStorage`; após reload o preview fica
expirado. Alterar uma linha exige nova resolução e novo token.

## Arquivo, privacidade e retenção

Decisão recomendada para o MVP: **imagem descartável, sem Storage**.

- processar em memória e enviar inline, evitando Google Files API;
- não gravar base64, bytes, OCR integral ou foto em logs/sessão/banco;
- limpar buffers/referências ao concluir ou falhar;
- `store: false` na Interactions API;
- usar projeto Gemini com billing ativo: nos serviços pagos, a documentação
  afirma que o conteúdo não é usado para melhorar produtos, embora prompts e
  respostas possam ser registrados por período limitado para segurança;
- a foto pode conter cliente, cidade, transportadora e representante; isso deve
  integrar a avaliação de privacidade/contrato com o provider antes do piloto.

## Upload, qualidade, performance e custo

Recomendação inicial:

- formatos aceitos no MVP: JPEG e PNG;
- máximo bruto: 10 MiB; máximo processado: 4 MiB;
- validar assinatura real, decode, rotação EXIF e dimensões;
- não aceitar vazio, corrompido, PDF, animação ou extensão/MIME divergente;
- preservar detalhe: lado maior de até 2.400–2.560 px, sem upscale, JPEG em
  qualidade aproximada de 85%, com teste específico de códigos pequenos;
- uma interpretação concorrente por usuário; 5/minuto e 30/hora por usuário;
- sem retry automático; botão bloqueado durante `Analisando Pedido...`.

O Gemini contabiliza imagens maiores por tiles de 768×768, 258 tokens por tile.
Com uma foto processada de documento, prompt curto, JSON compacto e preço
standard do `gemini-3.6-flash` em 2026-08-12 (US$ 1,50/M tokens de entrada e
US$ 7,50/M de saída, incluindo thinking), a ordem de grandeza recomendada para
orçamento é **US$ 0,005–0,02 por foto**. Isso equivale aproximadamente a
**US$ 0,50–2 por 100 fotos** e **US$ 5–20 por 1.000 fotos**. A faixa não é uma
cotação: deve ser substituída por métricas reais de tokens/latência do dataset.

## Foto ruim

Não gerar preview confirmável se houver corte estrutural, desfoque, reflexo,
sombra forte, perspectiva extrema, resolução insuficiente, texto pequeno
ilegível, total divergente ou documento desconhecido. Resposta recomendada:

> Não consegui ler este Pedido com segurança. Tire outra foto mostrando a
> folha inteira, com boa iluminação e sem cortar os códigos.

## Plano de implementação recomendado

### NK-ORD-008B — interpretação sem escrita

Upload, validação, resize, Gemini multimodal, schema estrito, resolução de
catálogo, conflitos, preview e correção por busca. Nenhum botão cria Pedido.
Validar com dataset sintético/controlado e depois com fotos reais sob aprovação
humana.

### Fase posterior — confirmação segura

Com a migration de unicidade já aplicada: proposal token, rota fixa, releitura,
contrato oficial, idempotência e card de resultado. Nenhuma criação por texto.

### NK-ORD-008C — validação visual controlada

Câmera, galeria, desktop, fotos inclinadas/ruins/manuscritas, correção de linha,
acessibilidade e responsividade. Sem operação real até autorização.

### NK-ORD-008D — teste operacional controlado

Uma criação real previamente definida, confirmada uma vez pelo usuário, com
auditoria de Pedido, linhas, evento, Safisa e idempotência.

## Dataset futuro obrigatório

Cobrir: foto perfeita, inclinação, sombra, baixa resolução, muitas linhas,
códigos numéricos/alfanuméricos, desconhecido e quase igual, descrição
conflitante, quantidade ilegível, negociação ausente/duplicada, documento
desconhecido, manuscrito, prompt injection visual, arquivo enorme, MIME inválido,
token adulterado e double click/replay.

## Riscos restantes

- auditoria dos dados legados e implantação controlada da unicidade global;
- precisão real em códigos pequenos e manuscritos;
- retenção/privacidade do provider para documentos comerciais;
- rate limit compartilhado entre instâncias serverless;
- expiração e edição segura da proposta;
- custo/latência reais com thinking e media resolution;
- impedir preview parcial de parecer completo;
- garantir resolução agrupada, sem N+1 e sem enviar catálogo integral ao modelo.

## Limites desta auditoria

ZERO migration criada; ZERO RPC alterada; ZERO Pedido criado; ZERO escrita
remota; ZERO imagem sensível persistida; ZERO merge.
