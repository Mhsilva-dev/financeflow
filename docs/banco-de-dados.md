# Banco de dados

SQLite em modo WAL, com `foreign_keys` ativado. Todas as tabelas de dados pertencem a um usuário (`usuario_id`, com `ON DELETE CASCADE`): excluir a conta apaga tudo o que ela tem.

```mermaid
erDiagram
    usuarios ||--o{ bancos : possui
    usuarios ||--o{ transacoes : lanca
    usuarios ||--o{ parcelas : possui
    usuarios ||--o{ despesas_futuras : preve
    usuarios ||--o{ investimentos : possui
    usuarios ||--o{ push_subscriptions : recebe
    usuarios ||--o{ redefinicoes_senha : solicita
    bancos ||--o{ transacoes : "origem de"
    bancos ||--o{ investimentos : custodia
    parcelas ||--o{ transacoes : gera

    usuarios {
        int id PK
        text usuario UK
        text nome
        text email UK
        text senha_hash
        text papel "usuario | admin"
        real limite_gasto
        text tema
        text cor
        text ultimo_acesso
    }
    bancos {
        int id PK
        int usuario_id FK
        text nome
        text titular
        real saldo
        text cor
    }
    transacoes {
        int id PK
        int usuario_id FK
        int banco_id FK
        int parcela_id FK
        text descricao
        text tipo "entrada | saida"
        text categoria
        real valor
        text data "YYYY-MM-DD"
        text status "pago | recebido | pendente | a_pagar | a_receber"
        text origem "manual | importado | parcela"
        text id_externo "deduplicação de importação"
    }
    parcelas {
        int id PK
        int usuario_id FK
        text descricao
        real valor_total
        int num_parcelas
        int parcelas_pagas
        text data_inicio
    }
    despesas_futuras {
        int id PK
        int usuario_id FK
        text descricao
        real valor
        text data_prevista
        text prioridade "alta | media | baixa"
        int concluida
    }
    investimentos {
        int id PK
        int usuario_id FK
        int banco_id FK
        text tipo "acao | fii | cripto | renda_fixa"
        text ticker
        real quantidade
        real preco_medio
        real valor_aplicado
    }
    push_subscriptions {
        int id PK
        int usuario_id FK
        text endpoint UK
        text p256dh
        text auth
    }
    redefinicoes_senha {
        int id PK
        int usuario_id FK
        text token_hash UK
        int expira_em
        int usado_em
    }
```

Tabelas de apoio, sem vínculo com usuário: `cotacoes_cache` (última cotação de cada ativo) e `gemini_uso` / `gemini_erros` (consumo e falhas do modelo, exibidos no painel administrativo).

## Índices

| Índice | Motivo |
|---|---|
| `transacoes(usuario_id)`, `(data)`, `(strftime('%Y-%m', data))`, `(status)` | Painel e extrato são sempre filtrados por usuário e mês |
| `transacoes(parcela_id)` | Pagar ou excluir uma compra parcelada |
| `UNIQUE transacoes(usuario_id, COALESCE(banco_id,0), id_externo)` | Reimportar o mesmo extrato não duplica lançamentos, mas dois bancos (ou dois usuários) podem ter lançamentos idênticos |
| `UNIQUE usuarios(email)` parcial | E-mail é opcional para contas antigas, mas único quando existe |

## Saldo trazido

O "saldo anterior" de um mês considera apenas dinheiro que de fato entrou ou saiu: entradas `recebido`/`pago` e saídas `pago` de todos os meses anteriores. Lançamentos pendentes não contaminam o saldo acumulado.
