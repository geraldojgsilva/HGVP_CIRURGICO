# HGVP_CIRURGICO

Web API Node.js/Express para envio de mensagens, consulta de respostas, relatorios e diagnostico de erros do chatbot IRSSL.

## Funcionalidades

- Envio individual e em lote via Positus por fila, com intervalo configuravel entre disparos.
- Consulta paginada de respostas.
- Analytics de confirmados, cancelados e pendentes.
- Relatorio Excel de respostas.
- Autenticacao JWT.
- Logs estruturados para investigacao de erros e travamentos.
- Integracao com banco Oracle.
- Cadastro de preparos cirurgicos para envio de segunda mensagem com PDF/link.
- Texto complementar do preparo armazenado em `TEXTO_PREPARO VARCHAR2(1000)`.

## Estrutura

```text
HGVP_CIRURGICO/
|-- src/
|   |-- app.js
|   |-- server.js
|   |-- config.js
|   |-- middleware/
|   |-- routes/
|   |-- services/
|   `-- utils/
|-- uploads/
|-- package.json
|-- package-lock.json
|-- Dockerfile
|-- docker-compose.yml
`-- README.md
```

## Configuracao

Configure as variaveis no `.env`:

```text
PORT=9000
JWT_SECRET=troque-em-producao

POSITUS_TOKEN=
POSITUS_URL=
POSITUS_PREPARO_TEMPLATE_NAME=preparo_cirurgia_pdf
POSITUS_PREPARO_TEMPLATE_NAMESPACE=
POSITUS_PREPARO_DOCUMENT_URL=
POSITUS_PREPARO_DOCUMENT_FILENAME=preparo-cirurgico.pdf
POSITUS_PREPARO_TEMPLATE_ID=2
ENVIO_QUEUE_PERSISTENCE=oracle
ENVIO_QUEUE_TABLE=DBAMV.TB_MENSAGEM_FILA_ENVIO
ENVIO_BATCH_TABLE=DBAMV.TB_MENSAGEM_LOTE_ENVIO
PREPARO_TABLE=DBAMV.TB_PREPARO_CIRURGICO
ENVIO_BATCH_STORAGE_PATH=uploads/envio-batches.json
ENVIO_QUEUE_DELAY_MS=3600000
EVIDENCE_DIR=uploads/evidencias
# opcional: ENVIO_QUEUE_STORAGE_PATH=C:\caminho\envio-queue.json

ORACLE_USER=
ORACLE_PASS=
ORACLE_HOST=
ORACLE_PORT=1521
DB_SERVICE=
ORACLE_CLIENT_LIB_DIR=C:\instantclient_23_0
```

No Windows, `ORACLE_CLIENT_LIB_DIR` deve apontar para a pasta do Oracle Instant Client. Sem isso, o driver pode tentar o modo Thin e falhar em bancos Oracle antigos com `NJS-116`.

## Rodar Localmente

```bash
npm install
npm start
```

A API sobe em:

```text
http://localhost:9000
```

## Rotas

- `GET /api/health`
- `POST /api/login`
- `GET /api/me`
- `POST /api/envio/individual`
- `POST /api/envio/lote`
- `GET /api/envio/fila`
- `GET /api/envio/lotes`
- `GET /api/envio/lotes/:id`
- `GET /api/envio/lotes/:id/arquivo`
- `GET /api/envio/modelo-lote`
- `GET /api/preparos`
- `POST /api/preparos`
- `PUT /api/preparos/:id`
- `DELETE /api/preparos/:id`
- `GET /api/respostas`
- `GET /api/respostas/analytics`
- `POST /api/respostas/report`
- `GET /api/logs/errors`

## Fila de Envios

Os envios entram em fila e sao disparados de hora em hora (`ENVIO_QUEUE_DELAY_MS=3600000`). A API responde `202 Accepted` somente depois que o envio foi gravado na fila.

Para persistir a fila no Oracle, execute o script unico `docs/sql/setup_persistencia_envio.sql` e configure:

```text
ENVIO_QUEUE_PERSISTENCE=oracle
ENVIO_QUEUE_TABLE=DBAMV.TB_MENSAGEM_FILA_ENVIO
```

Se a persistencia Oracle nao estiver habilitada ou falhar na inicializacao, a API usa o arquivo `uploads/envio-queue.json` como fallback local.

Para acompanhar a fila autenticado:

```text
GET /api/envio/fila
```

## Logs

Os logs ficam em:

```text
logs/app.log
logs/error.log
```

O endpoint `GET /api/logs/errors` exige token de usuario admin e retorna os erros recentes com resumo por mensagem, ajudando a identificar falhas repetidas e possiveis travamentos.

## Docker

```bash
docker compose up -d --build
```

O `Dockerfile` ja instala o Oracle Instant Client e executa `npm start`.
