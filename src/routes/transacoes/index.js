// src/routes/transacoes/index.js — CRUD de transações financeiras
// Ponto de entrada montado em /api/transacoes (ver src/server.js). Só une
// os sub-routers abaixo — a lógica de cada grupo de rotas vive no seu
// próprio arquivo para não repetir o que aconteceu com o antigo
// transacoes.js de 600 linhas:
//   listagem.js   — GET / , GET /pdf , GET /totais
//   crud.js       — POST / , PUT /:id , PATCH /:id/status , DELETE /:id
//   lote.js       — ações em mais de uma transação (duplicar, pagar mês, etc.)
//   importacao.js — leitura de foto/extrato via IA e importação de arquivos
const express = require('express');
const router  = express.Router();
const { tratarErroUpload } = require('./helpers');

router.use('/', require('./listagem'));
router.use('/', require('./crud'));
router.use('/', require('./lote'));
router.use('/', require('./importacao'));

// Precisa vir por último e manter os 4 argumentos — é assim que o Express
// reconhece um middleware como tratador de erro (ex: erros do multer).
router.use(tratarErroUpload);

module.exports = router;
