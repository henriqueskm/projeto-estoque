# Assistente NK — providers de mídia (PR #88)

Somente interpretação/transcrição. Nenhum writer, Pedido, estoque, catálogo,
push ou contrato de operação foi alterado. Nenhuma dependência adicionada.

## Configuração server-side

| Variável | Default de código | Uso |
| --- | --- | --- |
| `GEMINI_API_KEY` | nenhum | Foto principal |
| `GEMINI_PHOTO_MODEL` | `gemini-3.7-flash` | Override da foto principal |
| `OPENAI_API_KEY` | nenhum | Foto fallback e voz |
| `OPENAI_TRANSCRIPTION_MODEL` | `gpt-transcribe` | Voz exclusiva OpenAI |
| `OPENAI_PHOTO_FALLBACK_MODEL` | `gpt-6-luna` | Responses vision fallback |

Todas as chaves são privadas; nunca usar `NEXT_PUBLIC_`. Não registrar valores
de secrets nem enviar ao browser. Sem chave OpenAI, build permanece válido e a
foto Gemini continua normal. Voz retorna 503 com classificação interna
`CONFIGURATION` e mensagem amigável, sem nome do provider na resposta.

### Modelo efetivo observado em produção

O diagnóstico de produção fornecido para esta PR registrou foto e voz com
`gemini-3.6-flash`, HTTP 429, em aproximadamente 733/796 ms respectivamente.
Isso não indica defeito de câmera/microfone. O resolver antigo prioriza
`GEMINI_PHOTO_MODEL` / `GEMINI_TRANSCRIPTION_MODEL` sobre os defaults.

Inspeção read-only da Management API Vercel em 08/10/2026 confirmou ambas as
variáveis específicas em Production e Preview, além de overrides de uma branch
antiga. Elas estão classificadas como sensitive; seus valores não foram
disponibilizados pela leitura. Logo, a precedência + os logs explicam o modelo
efetivo; não afirmamos ter lido/decriptado o valor remoto. Esta PR não altera
variáveis remotas. `GEMINI_TRANSCRIPTION_MODEL` deixa de ser consumida pela voz.

Na primeira validação (08/10/2026), a listagem não continha a chave OpenAI
para Preview e o provider real não foi testado naquele momento. Isso é
histórico, não o estado atual: o comentário do Lead de 09/10/2026 registra
testes reais bem-sucedidos de foto `gpt-6-luna` e voz `gpt-transcribe`.
Não lemos nem configuramos chaves nesta continuação. Os testes automatizados
continuam isolados, incluindo ausência de chave, HTTP 429/5xx e deadlines.

## Foto: um contrato, dois providers

Imagem validada + sessão/perfil ativo → Gemini Interactions → generateContent
somente nos casos já admitidos → OpenAI se o fluxo Gemini terminar em falha
operacional elegível. O sucesso de qualquer provider passa pelo mesmo
`parseSupplierOrderPhotoExtraction()` e `interpretSupplierOrderPhoto()`.
Matching, detecção de Pedido duplicado e structured block permanecem iguais.

| Resultado final Gemini | Fallback externo OpenAI |
| --- | --- |
| Sucesso | Nunca |
| Rate limit, server, timeout, model, auth/configuration | Uma vez, se chave e formato suportados |
| HTTP 400 genérico, schema/JSON inválido final, saída vazia | Não |
| Origem/sessão/perfil/arquivo inválido, catálogo ou lookup falhou | Não |

O fallback interno Interactions → generateContent continua preservado,
inclusive para JSON inválido no primeiro caminho. Não há loop entre providers.
429 encerra imediatamente, sem retry nem espera pelo budget. Budget Gemini
12 s (Interactions até 7 s); OpenAI até 12 s, limitado pelo tempo restante;
deadline global dos providers 24 s. O deadline cobre resposta/body e transportes
que ignoram AbortSignal. Upload, autenticação e leituras posteriores não estão
incluídos nesse budget de extração.

Responses API: `store: false`, reasoning `none`, schema estrito compartilhado,
sem tools/web/file search/code interpreter. A imagem é dado não confiável,
nunca instrução executável. Parser rejeita campos extras, quantidades inválidas,
resposta vazia, refusal e resposta incompleta. Não devolve IDs/SQL/RPC/URLs
escolhidos pelo modelo. Regras de frete, zeros à esquerda, manuscrito e revisão
continuam na fonte compartilhada de instruções.

JPEG/PNG/WEBP têm fallback. HEIC/HEIF permanecem aceitos e processados no Gemini;
não há conversor novo. Se Gemini falhar nesses formatos, solicitar nova
tentativa ou JPEG/PNG/WEBP; não remover suporte existente.

Logs `assistant_order_photo`: primaryProvider, finalProvider, fallbackUsed
(externo), fallbackReason, model, providerPath, providerAttempts,
providerDurationMs e durationMs. Tentativas registram somente provider/path,
classificação e status. Nenhuma resposta bruta, prompt, imagem/base64, header,
secret ou descrição do Pedido é registrada.

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

## Gate local / pendências

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

## Continuação — qualidade da câmera integrada (comentário do Lead)

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
