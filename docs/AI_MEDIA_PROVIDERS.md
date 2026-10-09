# Assistente NK — providers OpenAI (NK-AI-OPENAI-001)

Base: main `6379bcafb937653fdfc4cd8c5151367786a957a2`, após merge #88.
Somente troca dos providers. Catálogo, matching, propostas, confirmações, writers,
Supabase, Safisa e push não mudam. Nenhuma alteração remota de ambiente.

## Configuração server-side

| Variável | Default | Uso |
| --- | --- | --- |
| `OPENAI_API_KEY` | nenhum | texto, router, foto e voz |
| `OPENAI_ASSISTANT_MODEL` | `gpt-6-luna` | conversa textual |
| `OPENAI_ASSISTANT_ROUTER_MODEL` | modelo textual, depois `gpt-6-luna` | classificação semântica |
| `OPENAI_PHOTO_MODEL` | override legado abaixo, depois `gpt-6-luna` | foto principal |
| `OPENAI_PHOTO_FALLBACK_MODEL` | `gpt-6-luna` | compatibilidade com configuração já existente; não é outro provider |
| `OPENAI_TRANSCRIPTION_MODEL` | `gpt-transcribe` | transcrição, sem mudança nesta tarefa |

Precedência foto: `OPENAI_PHOTO_MODEL` → `OPENAI_PHOTO_FALLBACK_MODEL` → default.
Os nomes novos são opcionais. Sem chave, o build funciona; a resposta de runtime
é segura e não inclui nomes de provider/model, chave ou corpo bruto upstream.
Não usar secrets `NEXT_PUBLIC_`. Não registrar prompt, texto do usuário,
resposta bruta, IDs privados, imagem/base64, áudio, Authorization ou valores de env.

`GEMINI_*` não é mais consumido por runtime/evals. Não removemos essas variáveis
remotas. O diagnóstico histórico da #88 observou `gemini-3.6-flash` e HTTP 429
por override de ambiente; não era falha da câmera/microfone. A limpeza remota
fica para autorização separada depois de merge e validação de produção.

## Texto e router

Responses API server-only, `store:false`, `reasoning.effort:none`, sem tools.
Texto preserva instruções, firstName confirmado, janela recente curta, contextos
canônicos e limite 300/700 tokens. Router: 1.200 tokens, deadline de 12 s, uma
chamada; resposta é envelope estrito `{ result: ... }` com raiz object e anyOf
somente dentro de result. Todos os objetos exigem required e
additionalProperties:false. Keywords de comprimento/uniqueItems são omitidas
no schema de transporte; o parser canônico continua exigindo limites,
unicidade, tipos/quantidades e até 12 linhas. Isso não relaxa as validações.
HELP/QUERY/ACTION/CHAT/CLARIFY preservados; negação, passado, hipótese e referência
insegura não autorizam operação. Falha do router volta ao caminho determinístico.
Consultas determinísticas continuam sem chamada ao provider quando resolvidas.
IA prepara proposta; nunca executa writer, SQL/RPC ou confirmação.

Parser REST lê status e output[].content[].output_text, não a conveniência
output_text de SDK. Refusal, incomplete, vazio, JSON/schema inválidos e HTTP
400/401/403/404/429/5xx têm classificação segura. Deadline cobre fetch e body,
mesmo transporte que ignore AbortSignal. Não há retry automático no runtime.
Telemetry: provider/model/tipo/duração/outcome e contadores de tokens numéricos.

## Foto: OpenAI primário, contrato único

JPEG/PNG/WebP validados → Responses OpenAI diretamente →
`parseSupplierOrderPhotoExtraction()` → `interpretSupplierOrderPhoto()` existente.
Uma tentativa, 12 s de provider (20 s globais incluindo conversão); não existe tentativa Gemini silenciosa ou loop entre
providers. Logs: primaryProvider/finalProvider=openai, fallbackUsed=false,
fallbackReason=null e providerAttempts reais. Schema/prompt compartilhados,
frete fora de lines, zeros preservados, códigos exatos, revisão de manuscrito,
duplicate negotiation e conflito de descrição permanecem canônicos.
Foto só cria preview estruturado. Nenhum Pedido/estoque é criado pela rota.

### HEIC/HEIF — conversão server-only autorizada

OpenAI não recebe HEIC com MIME falsificado: o servidor decodifica HEVC em worker
Node terminável e produz JPEG real. JPEG/PNG/WebP válidos passam intactos.
O usuário autorizou expressamente a dependência server-only, os avisos de licença
e os testes reais. Sharp já disponível só comprovava AVIF; não foi usado como
decoder HEVC. Versões exatas: heic-decode 2.1.0 (ISC), libheif-js 1.19.8
(LGPL-3.0, ~6,4 MB) e sharp 0.35.5 (Apache-2.0, já instalado via Next).
Instalação com --ignore-scripts; decoder/libheif não têm lifecycle de instalação.
Licenças e fontes upstream permanecem nos pacotes distribuídos, sem modificar o
decoder. Atualizações requerem PR revisável; não há updater automático.

O código fixo do worker nunca executa instruções da mídia. Caps: arquivo 3,9 MB,
12.000 px por lado, 60 MP, 8 s para conversão; worker encerrado também em falha.
Validação de assinatura e dimensões antes/depois, recursos do decoder liberados,
JPEG com teto 3,5 MB e qualidade 95/92/86 antes de reduzir dimensões. Metadados
EXIF/XMP são removidos do JPEG. libheif aplica irot/imir do container; rotação de
90° comprovada por comparação de pixels, sem aplicar EXIF novamente e duplicar
a transformação HEIF. Arquivos multi-imagem/sequências são rejeitados por
ambiguidade; orientação não padrão EXIF-only em HEIF requer amostra sanitizada
para comprovação específica. Não alegamos compatibilidade com todo encoder.
Falha/ambiguidade/timeout retorna 415 amigável pedindo JPEG/PNG/WebP; não envia
imagem parcialmente convertida ao provider. Nada é persistido.

Next externaliza decoder/libheif e inclui decoder/WASM/sharp/@img no trace da
rota de foto. Cache Components/Partial Prefetching continuam ativos.
Fixture pública, não comercial: [rainbow-451x461.heic](https://github.com/strukturag/libheif/blob/master/tests/data/rainbow-451x461.heic),
LGPL-3.0, SHA-256 `4b2ce727f093944975f143ba2b39c4c64511b766d94552f8d51a755916e7f983`.
Testes locais usam HEVC real em HEIC/HEIF, rotação, ausência de metadata, deadline
e rota autenticada simulada → REST JPEG → parser canônico. Preview real ainda
deve comprovar empacotamento/worker no ambiente alvo antes de fechar o gate.

Fontes oficiais consultadas em 09/10/2026:

- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Images/vision e formatos](https://developers.openai.com/api/docs/guides/images-vision)
- [heic-decode](https://github.com/catdad-experiments/heic-decode)
- [libheif-js, licença e fonte WASM](https://github.com/catdad-experiments/libheif-js)
- [sharp](https://github.com/lovell/sharp)

## Validação local — Issue #89

- 351 testes focados de providers/HEIC/router/foto/voz/contratos/contextos/Pedidos;
  159 Workspace State/Activity/Semantic Back/Instant Navigation/UI; 23 rotas.
- Attention: 23 passam, 1 falha preexistente em `assistant-attention.test.mjs:646`
  (contrato antigo da Home versus `loadAttentionOnNavigation()`/connection()).
  Home e teste idênticos à main; não corrigido fora do escopo. Total: 556 passam,
  1 falha preexistente, sem skips. Reexecuções focadas não somadas duas vezes.
- Evals determinísticos: 157/157 + held-out 40/40, sem chamadas reais; não são
  prova de qualidade semântica de provider. Negação/passado/hipótese preservados.
- TypeScript, ESLint dos arquivos alterados (zero warnings), diff-check,
  Webpack e build padrão Next passam. Trace Webpack: 7 arquivos heic-decode,
  18 libheif-js e WASM; Turbopack: 8/18 e WASM. Sem warnings de build.
- Conversão sintética local (fixture pública pequena): cerca de 262 ms numa
  execução; não representa latência de foto de câmera nem de produção.
- npm registra 23 vulnerabilidades na árvore (8 moderadas/15 altas); não foi
  executado audit fix nem atualização ampla fora do escopo.
- PR Draft #90 publicada. Deployment do commit de implementação
  `ad2d0d318c1da78e93fbdf0c1a65e62d838fa163` READY:
  [Preview](https://projeto-estoque-sp4o-d48rdhxhg-henrqueskms-projects.vercel.app/).
  A nova aba precisa de login humano; testes reais de texto/router/foto/HEIC,
  latência/custo e smoke autenticado 320/375/768/1440 ainda não foram executados
  neste deployment. Não declarar migração integralmente validada antes desse
  gate. Sem exportar sessão/chaves ou alterar env para o teste.

Preço oficial consultado para estimativa (não fatura): gpt-6-luna US$ 0,10/M
tokens de entrada e US$ 0,50/M de saída; usar contadores reais de usage. Não
atribuir custo/latência de produção a mocks ou evals locais.

## Voz: caminho curto

MediaRecorder (64 kbit/s solicitado) → Blob comprimido → File → multipart →
`POST /v1/audio/transcriptions` → `{ transcript }` → composer existente.
Nunca envia a mensagem automaticamente. Transcrever não executa operação.

| MIME aceito | Upload |
| --- | --- |
| audio/webm, audio/webm;codecs=opus | WEBM original |
| audio/ogg, audio/ogg;codecs=opus | OGG original |
| audio/mp4, audio/mp4;codecs=mp4a.40.2 | MP4 original |
| audio/wav, audio/x-wav | WAV original |
| Outro formato decodificável | Conversão local WAV mono 16 kHz como fallback |
| Outro formato impossível | Erro amigável |

O caminho normal não instancia AudioContext, não lê/decodeAudioData, não
resampleia e não gera WAV. `assistant-voice-audio.ts` mantém o fallback antigo.
O filename/extensão e Content-Type são canônicos por formato, sem nome privado.

Hard stop do recorder: 60 s. Teto por arquivo: 2.100.000 bytes para todos os
formatos; multipart limitado por streaming a esse teto + 64 KiB, mesmo sem
Content-Length ou com header falso. Allowlist MIME e assinatura do container,
same-origin, getClaims, perfil ativo e rate-limit por usuário são preservados.
WAV tem duração validada no servidor. Containers comprimidos não são
decodificados no servidor para medir duração: tamanho/rate-limit são defesa
adicional ao hard stop do cliente, não prova da duração de uploads arbitrários.
Não aceitamos os 25 MB máximos do provider. Nada é persistido.

Request: model, file, `languages[]=pt`, prompt contextual curto e `keywords[]`
(2A, 1B, 1H, MBF-025, MBF025, KT-18, 091, 091/VF, Safisa, Servo, Kit).
Dicas não obrigam palavras na transcrição. Trim, não vazio e máximo de 1.000
caracteres; sem pós-processamento que invente código ou interprete intenção.

Deadline provider: 22 s; cliente: 30 s, incluindo leitura da resposta. Sem
retry automático. 429 falha rapidamente. UX padrão passa direto de Parar para
“Transcrevendo...”; “Preparando áudio...” somente no fallback local.

Instrumentação: clientPreparationMs, uploadAndProviderMs, totalMs (cliente,
somente development); serverAuthMs, providerMs, totalMs (servidor) e
Server-Timing numérico. Não logar áudio/transcript ou dados privados.

## Verificação reproduzível

```powershell
node --experimental-strip-types --experimental-loader ./evals/assistant/node-alias-loader.mjs --test tests/ai-media-resilience.test.mjs tests/assistant-supplier-order-photo.test.mjs tests/assistant-voice-dictation.test.mjs
node --experimental-strip-types --experimental-loader ./tests/ai-media-route-loader.mjs --test tests/ai-media-route.test.mjs tests/ai-media-photo-route.test.mjs
```

O benchmark executa 100 preparações de Blob sintético WEBM de 480.000 bytes,
assertando ausência do conversor. Uma execução local mediu mediana 0,046 ms,
p95 0,104 ms. Resultado sintético/local, variável por máquina, **não** latência
real de upload/provider/produção. O teste imprime novas medições sem threshold
frágil. Não foram usadas gravações privadas nem Pedidos reais.

## Referências oficiais consultadas

- [Speech to text](https://developers.openai.com/api/docs/guides/speech-to-text)
- [Audio transcriptions API](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)
- [gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [Image inputs](https://developers.openai.com/api/docs/guides/images-vision)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

Sem migration, RPC, saldo, writer, Pedido, Safisa, push ou env remota alterados.

## Histórico #88 — gate local / pendências naquela entrega

Regressões executadas: mídia/providers/rotas, foto/Pedidos, ditado, câmera,
conversa contextual, ações de estoque existentes, Pedidos, Attention UI,
Workspace State, Activity/estado transitório, Semantic Back, Instant Navigation
e layouts. 477 testes passaram, incluindo 67 novos. TypeScript, ESLint com
zero warnings, diff-check, Webpack e build padrão Next passaram.

NOTE preexistente: `tests/assistant-attention.test.mjs:646` espera
`const attentionPromise = loadAssistantAttention()`, mas main já usa
`loadAttentionOnNavigation()` com `connection()`. Essa suíte resulta em
23 passed / 1 failed. A página Home e esse teste são idênticos a origin/main,
comprovado por `git diff --exit-code origin/main --` para os dois arquivos.
Não ajustamos esse contrato fora do escopo. Assim, não declaramos o gate
“todos os testes passam” integralmente aprovado nem a PR pronta para merge.

Provider real OpenAI foi validado pelo usuário/Lead posteriormente, conforme
registrado acima; não afirmamos uma medição independente de sua latência nesta
continuação. Sessão/perfil, CONFIGURATION seguro e respostas de erro foram
exercitados com rotas reais e mocks isolados, sem contornar auth/service_role.

Smoke autenticado read-only no Preview: Assistente/composer, controles de
foto/voz e abrir/fechar menu de imagem; viewports 320×800, 375×812, 768×1024 e
1440×900. scrollWidth igual à largura em todos; zero errors/warnings no console
durante o smoke. Nenhuma gravação privada, upload, envio de mensagem ou
confirmação operacional. O browser permitido do ambiente usa locators
Playwright via CUA; o CLI não foi usado em paralelo para controlar a sessão
humana. Teste de teclado físico/mobile real e latência de provider não são
inferidos da emulação. A skill mobile-native orientou o caminho direto para
“Transcrevendo...”; emil-design-eng foi usada somente para feedback/craft,
sem redesenho.

## Histórico #88 — qualidade da câmera integrada (comentário do Lead)

Base revisada: `d84b0d68356263a28cc75f301284c39424bd24df`.
Nenhum modelo, resolver de environment ou fallback de providers mudou.

- A câmera integrada permanece o padrão. `getUserMedia` solicita câmera
  traseira e **ideal** 3840×2160, nunca exact/min obrigatório.
- Feature detection verifica `ImageCapture`, track live e método `takePhoto`.
  Uma captura fotográfica real é tentada; rejeição/ausência/timeout usa o canvas
  atual automaticamente, sem abrir outro app. Sucesso não captura um segundo
  frame. Cada caminho tem limite de 5 s, incluindo validação do Blob.
- API nativa não aceita AbortSignal: close, retake, Activity/unmount,
  visibilitychange hidden e pagehide abortam a espera e invalidam a geração;
  resultados tardios não criam preview/URL nem iniciam fallback obsoleto.
  Tracks são encerrados e URLs revogadas. Um ref síncrono impede double capture.
- Arquivos válidos JPEG/PNG/WebP/HEIC/HEIF de até 3.900.000 bytes, dimensões
  até 12000 por lado e 60 milhões de pixels mantêm **os mesmos bytes/MIME**.
  O EXIF original fica intacto, sem recompressão da foto da galeria/câmera.
  Magic bytes/dimensões são validados antes de decodificar. Dimensões inseguras
  são rejeitadas; leitura local limitada a 40 MB. HEIC/HEIF oversized pede outra
  foto, sem converter ou retirar suporte. O servidor repete seus guards.
- JPEG/PNG/WebP oversized são decodificados com orientação EXIF, fundo branco
  para alpha/contraste e resolução inteira antes de tentar qualidade .95/.92/
  .86. Só depois, se necessário, reduzir dimensões (.8/.65) com qualidade .92
  para o alvo existente de 3.5 MB. Nunca reduzir toda foto para 2800 px.
- Telemetria **somente DOM local**, no dialog: `data-capture-source`,
  `data-video-width/height`, `data-photo-width/height/bytes`. Valores vêm das
  dimensões reais do vídeo e dos bytes do arquivo, não das constraints.
  Nenhuma imagem, descrição, nome de arquivo ou dado pessoal é logado/enviado.
- Matching não foi relaxado: o parser já aceita descrições equivalentes
  SEM KIT/S/KIT/REBAIX pelo código exato/modelo compatível. Divergência objetiva
  continua `DESCRIPTION_CONFLICT`. O card agora mostra **Lido na foto** e
  **Catálogo oficial** e permite **Confirmar / corrigir código** explicitamente,
  reutilizando `/resolve-code` read-only e o fluxo já existente de revisão.
  Não remove impedimentos de quantidade/revisão visual nem cria Pedido/estoque.

### Evidência reproduzível e limites

```powershell
node --experimental-strip-types --experimental-loader ./evals/assistant/node-alias-loader.mjs --test tests/assistant-photo-quality.test.mjs
npm run test:assistant-camera
node tests/assistant-camera-quality.visual.mjs
```

A fixture visual serve somente em `127.0.0.1:3088`, com React/componente reais,
stream sintético por canvas e foto fictícia; não usa câmera humana, catálogo,
Supabase, provider ou rede de negócio. Controles permitem rejeição/ausência/
timeout, pagehide/background simulado, Activity e unmount. Artefatos são locais.
Medição real **dessa fixture**, não Android/produção: vídeo 1920×1080;
foto ImageCapture simulada 4032×3024 PNG, 263172 bytes; fallback canvas
1920×1080 JPEG, 18098 bytes. `prepareSupplierOrderPhoto` manteve identidade
do File; uma captura → um stream encerrado → uma URL criada/revogada.

Fixture fictícia de sete códigos `1, 1H, 2, 9, 10RB, 10, 6`, quantidades
`10, 1, 1, 5, 10, 6, 10` totaliza 43, todos identificados. Unknown/ambiguous,
10R3 incerto, modelo diferente e quantidade ilegível continuam revisão.

Continuação: 13 testes novos passaram. Suítes de mídia/foto/câmera/voz e
regressões correlatas: 286 passed; Workspace/Activity/Back/Instant Navigation/
layout/Attention UI: 159 passed; rotas de mídia: 22 passed. Attention:
23 passed e a mesma falha preexistente na linha 646. Total **490 passed /
1 preexisting failed**, sem contar reexecuções dos mesmos testes. TypeScript,
ESLint zero warnings, diff-check, Webpack e build padrão Next passaram.
Screenshots da câmera/preview em 320/375/768/1440: scrollWidth igual à largura,
sem overflow. Console local sem errors/warnings. São emulação desktop e
ImageCapture simulado, não evidência de câmera/hardware Android.

[ImageCapture/takePhoto](https://developer.mozilla.org/en-US/docs/Web/API/ImageCapture/takePhoto)
tem disponibilidade limitada: não presumir suporte em Safari/Firefox ou por
existir constructor; o dispositivo/track ainda pode rejeitar. Chrome também
não garante resolução fotográfica maior que a do vídeo. Fallback canvas mantém
compatibilidade. Android/PWA físico, foco/exposição do hardware e qualidade OCR
de um Pedido real precisam de validação humana; emulação não prova isso.
