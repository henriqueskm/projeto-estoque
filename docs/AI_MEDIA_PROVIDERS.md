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

A listagem do projeto não contém `OPENAI_API_KEY` para Preview. Portanto:
**Provider OpenAI real não testado no Preview por ausência de OPENAI_API_KEY.**
Ausência, HTTP 429/5xx, schema e deadlines são testados com mocks locais;
nenhuma chave é criada/configurada por esta PR.

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

Provider real OpenAI e latência real permanecem pendentes de configuração
humana e teste sanitizado. Sessão/perfil, CONFIGURATION seguro e respostas de
erro foram exercitados executando as rotas reais com mocks isolados, sem
contornar autenticação do app nem usar service_role.

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
