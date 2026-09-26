# Referência da API

Todas as respostas são JSON no formato `{ ok: true, data: ... }` ou `{ ok: false, erro: "mensagem" }`. A autenticação é por cookie de sessão; exceto onde indicado, as rotas exigem login e só enxergam os dados do usuário da sessão.

## Autenticação e conta — `/api/auth` (pública)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/config` | Se o cadastro de novas contas está aberto |
| POST | `/registro` | Cria a conta e já inicia a sessão (limite de 5 tentativas/hora por IP) |
| POST | `/login` | Login por usuário ou e-mail (limite de 10 tentativas/15 min por IP) |
| POST | `/logout` | Encerra a sessão |
| GET | `/me` | Perfil do usuário logado |
| PUT | `/trocar` | Altera nome, usuário, e-mail ou senha (exige a senha atual) |
| PUT | `/aparencia` | Tema e cor de destaque |
| PUT | `/onboarding` | Marca o tour de boas-vindas como visto |
| GET | `/primeiros-passos` | Progresso do checklist inicial |
| GET | `/exportar` | Baixa todos os dados do usuário em Excel |
| POST | `/esqueci` | Envia o link de redefinição de senha por e-mail |
| GET | `/redefinir/validar` | Confere se o token de redefinição ainda é válido |
| POST | `/redefinir` | Define a nova senha a partir do token |
| DELETE | `/conta` | Exclui a conta e todos os dados (exige a senha) |

## Transações — `/api/transacoes`

| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Lista com filtros (`mes`, `tipo`, `categoria`, `status`, `banco_id`, `busca`) |
| GET | `/totais?mes=YYYY-MM` | Totais do mês, saldo trazido, categorias e histórico de 6 meses |
| GET | `/pdf` | Extrato do mês em PDF |
| POST | `/` | Cria uma transação |
| PUT | `/:id` | Edita |
| PATCH | `/:id/status` | Altera só o status |
| DELETE | `/:id` | Exclui |
| POST | `/:id/duplicar` | Duplica uma transação |
| POST | `/duplicar-mes` | Copia todas as transações de um mês para o seguinte |
| PATCH | `/pagar-mes` | Marca todas as pendências do mês como pagas/recebidas |
| DELETE | `/mes` | Exclui todas as transações de um mês |
| POST | `/importar` | Importa extrato OFX, CSV, Excel ou PDF (multipart) |
| POST | `/foto` | Lê um comprovante por foto (multipart) |

## Planejamento

| Método | Rota | Descrição |
|---|---|---|
| GET / POST | `/api/parcelas` | Lista / cria compra parcelada (gera as transações de cada mês) |
| PATCH | `/api/parcelas/:id/pagar` | Registra o pagamento de uma parcela |
| DELETE | `/api/parcelas/:id` | Exclui a compra e as parcelas futuras (as já passadas ficam no histórico) |
| GET / POST | `/api/futuras` | Lista / cria conta futura |
| PATCH | `/api/futuras/:id/concluir` | Marca como concluída |
| DELETE | `/api/futuras/:id` | Exclui |
| GET / POST / DELETE | `/api/calendario` | Eventos recorrentes por dia do mês |
| GET / POST / DELETE | `/api/limite-gasto` | Limite de gasto mensal (com alerta por push) |

## Bancos — `/api/bancos`

| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Lista os bancos do usuário |
| GET | `/:id` | Detalhe |
| POST | `/` | Cria |
| PATCH | `/:id` | Edita nome, titular, cor |
| PATCH | `/:id/saldo` | Atualiza o saldo |
| DELETE | `/:id` | Exclui |

## Investimentos — `/api/investimentos`

| Método | Rota | Descrição |
|---|---|---|
| GET | `/mercado` | Dólar, euro, bitcoin e ethereum |
| GET | `/` | Posições com cotação atual |
| GET | `/resumo` | Total investido, valor atual e lucro/prejuízo |
| POST | `/` | Adiciona posição |
| PATCH | `/:id` | Edita |
| DELETE | `/:id` | Exclui |
| POST | `/recomendacao` | Análise da carteira e do saldo livre pelo assistente |

## Relatórios e assistente

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/relatorio` | Relatório do período (hoje, semana, mês ou total) |
| GET | `/api/relatorio/comparacao` | Comparação mês a mês (12 meses) |
| GET | `/api/relatorio/pdf` | Relatório em PDF |
| GET | `/api/inteligencia/painel` | Projeções e alertas automáticos |
| POST | `/api/ia/chat` | Pergunta ao assistente (ver [assistente.md](assistente.md)) |
| GET | `/api/ia/dicas` | Dicas curtas sobre o mês |
| GET | `/api/ia/tokens` | Consumo do modelo |

## Notificações — `/api/push`

| Método | Rota | Descrição |
|---|---|---|
| GET | `/vapid-public-key` | Chave pública VAPID (pública) |
| POST | `/subscribe` | Registra o dispositivo (o endpoint é validado para evitar SSRF) |
| DELETE | `/subscribe` | Remove o dispositivo |

## Administração — `/api/admin` (somente administrador)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/usuarios` | Usuários cadastrados, uso e quem está online |

## Saúde

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/health` | `{ ok: true }` — usado pelo CI e por monitoramento |

## Tempo real

`wss://<host>/ws` — exige a sessão. O servidor envia eventos como `{ type: "nova_transacao" }` sempre que um dado do usuário muda, e o front-end recarrega a área afetada.
