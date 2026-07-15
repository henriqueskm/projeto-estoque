# AGENTS.md — Negócios K

## 1. Sobre o projeto

Negócios K é um aplicativo web de controle de estoque especializado em servoembreagens.

O sistema será utilizado principalmente pelo celular, mas também deve funcionar muito bem em computadores.

O estoque é único e compartilhado por vários usuários.

Todos os usuários possuem as mesmas permissões.

O login individual existe principalmente para registrar quem realizou cada operação no estoque.

O sistema não é um SaaS neste momento.

Não implementar:
- múltiplas empresas;
- múltiplos estoques;
- planos;
- assinaturas;
- cobrança;
- permissões complexas por usuário.

---

## 2. Stack principal

Utilizar:

- Next.js
- TypeScript
- App Router
- Tailwind CSS
- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Storage
- OpenAI API
- GitHub
- Vercel

Não adicionar bibliotecas ou dependências sem necessidade clara.

Antes de instalar uma nova dependência, verificar se a funcionalidade pode ser implementada com as ferramentas já existentes.

---

## 3. Princípios de desenvolvimento

Priorizar:

- simplicidade;
- legibilidade;
- código organizado;
- tipagem forte com TypeScript;
- componentes reutilizáveis quando fizer sentido;
- funções pequenas e claras;
- nomes descritivos;
- baixo acoplamento;
- segurança;
- integridade dos dados.

Não criar abstrações complexas antes de existir necessidade real.

Evitar overengineering.

Não implementar funcionalidades fora do escopo solicitado pelo prompt atual.

Ao receber uma tarefa:

1. analisar os arquivos existentes;
2. entender os padrões já utilizados;
3. apresentar um plano curto quando a alteração for relevante;
4. implementar somente o escopo solicitado;
5. executar verificações apropriadas;
6. informar os arquivos alterados e o resultado dos testes.

---

## 4. Interface e experiência do usuário

O nome exibido no sistema é:

Negócios K

O design deve ser:

- claro;
- moderno;
- simples;
- responsivo;
- mobile first;
- com alto contraste;
- fácil de ler;
- fácil de operar.

Usar predominantemente:

- fundo claro;
- cartões claros;
- textos escuros;
- bom espaçamento;
- botões grandes;
- áreas de toque confortáveis no celular.

Cores podem ajudar a identificar operações:

- verde para entradas e confirmações;
- vermelho para saídas e alertas críticos;
- amarelo ou laranja para atenção e estoque baixo;
- azul para ações e informações gerais.

Nunca depender somente da cor para comunicar uma informação.

O usuário deve conseguir executar as operações principais com poucos cliques.

---

## 5. Tela inicial

A tela inicial deve priorizar ações operacionais.

Elementos principais:

- título "Negócios K";
- pesquisa por código, descrição ou modelo;
- botão Entrada;
- botão Saída;
- botão Pedido por foto;
- botão Assistente IA.

Também pode apresentar de forma secundária:

- estoque baixo;
- itens zerados;
- últimas movimentações;
- peças mais movimentadas;
- resumo do estoque.

Não transformar a tela inicial em um dashboard excessivamente carregado.

---

## 6. Tipos principais de itens

O estoque trabalha com:

1. Servoembreagens
2. Kits de instalação
3. Jogos de reparo
4. Peças avulsas

Cada item físico possui um código próprio.

O catálogo será relativamente fixo.

Depois da carga inicial dos produtos, novos cadastros deverão acontecer raramente.

---

## 7. Servoembreagens

Cada modelo de servoembreagem possui:

- código;
- descrição;
- modelo.

Exemplo:

Código:
2

Descrição:
SERVO MBF-025

O código "2" identifica o modelo do servo sem kit.

---

## 8. Kits de instalação

Cada kit de instalação é um item físico independente e possui seu próprio código.

Exemplo:

Código do kit:
KT-18

Um kit pode estar:

- avulso no estoque;
- associado a um servo dentro de uma caixa.

O sistema deve manter controle dessas duas situações.

---

## 9. Configurações comerciais

Existem códigos utilizados pela operação para representar uma combinação específica entre servo e kit.

Exemplo:

Código comercial:
2A

Representa:

SERVO MBF-025
+
Kit de instalação KT-18

Portanto:

2A NÃO é o código físico do kit.

2A é o código de uma configuração comercial.

KT-18 é o código físico do kit.

A estrutura deve permitir:

- pesquisar 2A;
- pesquisar MBF-025;
- pesquisar KT-18.

Essas buscas devem permitir encontrar as relações correspondentes.

Exemplo conceitual:

2A
├── Servo: MBF-025
└── Kit: KT-18

---

## 10. Regra de modelagem de configurações

Nunca tratar "Servo MBF-025 + Kit KT-18" como um novo item físico independente.

Existem fisicamente:

- 1 servo;
- 1 kit.

A configuração 2A representa a associação desses dois itens.

Isso é necessário porque o kit pode ser retirado do servo ou um kit avulso pode ser adicionado ao servo.

---

## 11. Servo sem kit

Um servo pode estar armazenado sem kit.

Exemplo:

MBF-025 sem kit:
10 unidades.

---

## 12. Servo com kit

Um servo pode estar armazenado com um kit compatível.

Exemplo:

Configuração 2A:

Servo MBF-025
+
Kit KT-18

Quantidade montada:
5 unidades.

A consulta do servo MBF-025 deve conseguir mostrar:

- total de servos;
- quantidade sem kit;
- quantidade em cada configuração comercial.

---

## 13. Kits avulsos

O sistema deve controlar a quantidade de kits disponíveis de forma avulsa.

Exemplo:

KT-18 avulsos:
3 unidades.

O total físico de kits KT-18 pode ser calculado considerando:

kits KT-18 avulsos
+
kits KT-18 atualmente associados a servos.

---

## 14. Montagem de kit

Montagem é uma movimentação interna.

Exemplo:

Montar 1 configuração 2A.

Operação:

- MBF-025 sem kit: -1
- KT-18 avulso: -1
- Configuração 2A: +1

O total físico de servos não muda.

O total físico de kits não muda.

A operação apenas altera a configuração do estoque.

Montagem não deve ser contabilizada como venda ou saída externa.

---

## 15. Desmontagem de kit

Desmontagem é uma movimentação interna.

Exemplo:

Desmontar 1 configuração 2A.

Operação:

- Configuração 2A: -1
- MBF-025 sem kit: +1
- KT-18 avulso: +1

O total físico dos itens não muda.

Desmontagem não deve ser contabilizada como venda ou entrada externa.

---

## 16. Regra fundamental de consistência

Montar ou desmontar um kit nunca pode criar ou destruir itens físicos.

Toda operação composta deve ocorrer dentro de uma transação no banco de dados.

Se qualquer parte da operação falhar, nenhuma alteração deve permanecer.

Quantidades nunca podem ficar negativas.

---

## 17. Jogos de reparo

Jogos de reparo são itens independentes.

Cada jogo possui:

- código;
- descrição;
- quantidade.

Pode existir relação de compatibilidade entre um jogo de reparo e um ou mais modelos de servo.

Um jogo de reparo pode ser vendido separadamente.

---

## 18. Peças avulsas

Peças avulsas são itens independentes.

Possuem:

- código;
- descrição;
- quantidade.

Quando aplicável, podem possuir relação com determinados modelos de servo.

---

## 19. Entrada de estoque

O fluxo principal de entrada ocorre quando o usuário retira peças no fornecedor.

Existem duas formas principais.

### Entrada por conversa

Exemplo:

"Peguei 10 servos MBF-025 e 5 kits KT-18."

A IA interpreta.

O backend valida.

O sistema apresenta uma prévia.

O usuário confirma.

Somente então o estoque é alterado.

### Entrada por foto

O usuário envia uma foto do pedido realizado ao fornecedor e informa que retirou aqueles itens.

A IA deve tentar identificar:

- códigos;
- descrições;
- quantidades.

Depois deve relacionar os itens ao catálogo existente.

O usuário deve revisar e confirmar antes da entrada.

---

## 20. Saída de estoque

O fluxo principal de saída ocorre após vendas realizadas pelo Mercado Livre.

Depois de levar os pedidos ao Correio, o usuário pode informar à IA os itens enviados no dia.

Exemplo:

"Hoje saíram 2 unidades de 2A e 3 reparos X."

A IA interpreta.

O backend valida.

O usuário confere.

O usuário confirma.

Somente então a baixa é executada.

---

## 21. Venda de servo sem kit a partir de servo com kit

Pode acontecer de não haver um servo sem kit disponível, mas existir um servo montado com kit.

O usuário pode retirar o kit e enviar somente o servo.

Exemplo:

Desmontar 1 configuração 2A e enviar somente o MBF-025.

Resultado:

- servo sai fisicamente do estoque;
- KT-18 fica no estoque como kit avulso.

Essa operação deve manter o kit corretamente contabilizado.

---

## 22. Venda de servo com kit usando kit avulso

Pode acontecer de existir:

- servo sem kit;
- kit compatível avulso.

O usuário pode montar a configuração e realizar a saída.

Exemplo:

Venda de 1 unidade 2A.

O sistema pode utilizar:

- 1 MBF-025 sem kit;
- 1 KT-18 avulso.

Depois registrar a saída da configuração comercial 2A.

Tudo deve ocorrer de forma transacional.

---

## 23. Usuários e auditoria

Todos os usuários têm acesso a todas as funcionalidades.

Não implementar níveis de permissão inicialmente.

Toda alteração no estoque deve registrar:

- usuário responsável;
- data;
- horário;
- tipo de operação;
- origem da operação;
- item;
- quantidade anterior;
- alteração;
- quantidade posterior.

O histórico não deve ser apagado.

Desfazer uma operação deve gerar uma nova movimentação inversa.

---

## 24. Tipos de movimentação

Diferenciar:

- entrada;
- saída;
- ajuste;
- montagem;
- desmontagem;
- reversão.

Também registrar a origem:

- manual;
- IA;
- foto do pedido.

Movimentações internas de montagem e desmontagem não devem entrar nas estatísticas de vendas ou saídas externas.

---

## 25. Inteligência Artificial

A IA funciona como interface para interpretar comandos e consultar informações.

A IA pode:

- consultar estoque;
- pesquisar códigos;
- consultar modelos;
- consultar kits;
- consultar configurações comerciais;
- consultar reparos;
- consultar compatibilidades;
- preparar entradas;
- preparar saídas;
- preparar montagens;
- preparar desmontagens;
- consultar histórico;
- consultar estatísticas.

A IA NUNCA deve alterar diretamente o banco de dados.

Fluxo obrigatório:

usuário faz pedido
→ IA interpreta
→ backend valida
→ sistema gera proposta
→ usuário confere
→ usuário confirma
→ backend executa
→ histórico é registrado.

---

## 26. Ações da IA

Toda ação que altere estoque deve ser inicialmente uma proposta.

Estados sugeridos:

- pending;
- confirmed;
- cancelled;
- expired;
- error.

Somente uma ação confirmada pelo usuário pode gerar movimentação real.

---

## 27. Estatísticas

As estatísticas devem utilizar movimentações externas reais.

Exemplos:

- servos que mais saem;
- modelos que mais saem;
- configurações comerciais que mais saem;
- servos vendidos com kit;
- servos vendidos sem kit;
- kits vendidos avulsos;
- kits mais utilizados;
- reparos que mais saem;
- peças avulsas que mais saem;
- quantidade de saídas por período;
- itens sem movimentação;
- estoque baixo;
- estoque zerado;
- comparação entre períodos;
- média diária;
- média semanal;
- média mensal.

Nunca contar montagem ou desmontagem interna como venda.

---

## 28. Banco de dados

Usar PostgreSQL no Supabase.

Usar:

- UUIDs como identificadores internos;
- códigos de negócio em campos próprios;
- foreign keys;
- constraints;
- índices quando necessários;
- migrations para alterações estruturais.

Não alterar manualmente o schema de produção sem migration correspondente.

Os códigos de negócio devem ser preservados exatamente como cadastrados.

Exemplos:

- 2
- 2INV
- 2A
- KT-18

Não assumir que códigos similares representam o mesmo item.

---

## 29. Segurança dos dados

Nunca expor:

- SUPABASE_SERVICE_ROLE_KEY;
- OPENAI_API_KEY;
- secrets;
- tokens privados.

Secrets devem existir apenas no servidor ou em variáveis de ambiente apropriadas.

Nunca colocar secrets no código do frontend.

---

## 30. Testes e validação

Após alterações relevantes:

- verificar TypeScript;
- executar lint;
- executar testes existentes;
- executar build quando apropriado.

Não considerar uma tarefa concluída quando existem erros conhecidos relacionados à alteração.

Não corrigir problemas não relacionados ao escopo sem autorização, a menos que impeçam diretamente a tarefa atual.

---

## 31. Regra de escopo para o Codex

Não implementar antecipadamente funcionalidades futuras.

Quando receber um prompt específico:

implementar somente o solicitado.

Não:

- redesenhar toda a arquitetura;
- trocar tecnologias;
- adicionar bibliotecas sem necessidade;
- implementar funcionalidades futuras;
- modificar banco sem necessidade;
- remover código existente sem entender seu uso.

Quando houver dúvida relevante sobre uma regra de negócio, parar e perguntar antes de assumir.

---

## 32. Prioridade atual do desenvolvimento

A ordem geral do projeto é:

1. Estrutura inicial
2. Supabase
3. Banco de dados
4. Autenticação
5. Estoque básico
6. Configurações comerciais
7. Montagem e desmontagem
8. Histórico
9. Interface e dashboard
10. Estatísticas
11. Assistente IA
12. Entrada por foto
13. Testes
14. Deploy

Não pular etapas sem solicitação explícita.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
