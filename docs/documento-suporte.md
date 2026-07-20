# Documento de Suporte - IRSSL Chatbot API

## Requisitos

- Node.js instalado.
- npm disponivel via `npm.cmd` no PowerShell.
- Oracle Instant Client instalado para conexao Oracle em modo Thick.
- Acesso de rede ao banco Oracle.
- Variaveis de ambiente configuradas no `.env`.

## Instalacao Local

No PowerShell:

```powershell
cd C:\Projetos\irssl-chatbot
npm.cmd install
```

Se o comando `npm install` falhar por politica de execucao do PowerShell, use:

```powershell
npm.cmd install
```

## Execucao Local

```powershell
npm.cmd start
```

A API sobe em:

```text
http://localhost:5000
```

## Variaveis de Ambiente

Arquivo `.env` esperado:

```text
PORT=5000
JWT_SECRET=troque-em-producao

POSITUS_TOKEN=
POSITUS_URL=

ORACLE_USER=
ORACLE_PASS=
ORACLE_HOST=
ORACLE_PORT=1521
DB_SERVICE=
ORACLE_CLIENT_LIB_DIR=C:\instantclient_23_0
```

Em Windows, se `ORACLE_CLIENT_LIB_DIR` nao estiver definido, a API tenta detectar automaticamente:

```text
C:\instantclient_23_0
C:\instantclient_19_29
```

## Health Check

```powershell
Invoke-RestMethod -Method Get `
  -Uri "http://localhost:5000/api/health"
```

Retorno esperado:

```json
{
  "status": "ok",
  "service": "irssl-chatbot-api",
  "timestamp": "..."
}
```

## Login

```powershell
$login = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:5000/api/login" `
  -ContentType "application/json" `
  -Body '{"username":"hgvp","password":"Irssl@2026"}'

$token = $login.token
```

Usuarios locais disponiveis:

```text
admin / admin
hgvp / Irssl@2026
amas / Irssl@2026
```

Observacao: `admin` e usado para administracao e logs. Para consultar dados de empresa, use `hgvp` ou `amas`.

## Validar Usuario Autenticado

```powershell
Invoke-RestMethod -Method Get `
  -Uri "http://localhost:5000/api/me" `
  -Headers @{ Authorization = "Bearer $token" }
```

## Consultar Respostas

```powershell
Invoke-RestMethod -Method Get `
  -Uri "http://localhost:5000/api/respostas?page=1&per_page=10" `
  -Headers @{ Authorization = "Bearer $token" }
```

Exibir em tabela:

```powershell
$result = Invoke-RestMethod -Method Get `
  -Uri "http://localhost:5000/api/respostas?page=1&per_page=10" `
  -Headers @{ Authorization = "Bearer $token" }

$result.data | Format-Table ID,NOME,NUMERO,DATA_CONSULTA,HORA_CONSULTA,UNIDADE,RESPOSTA -AutoSize
```

## Gerar Relatorio Excel

```powershell
Invoke-WebRequest -Method Post `
  -Uri "http://localhost:5000/api/respostas/report" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body '{"data_ini":"2026-05-01","data_fim":"2026-06-30"}' `
  -OutFile ".\respostas.xlsx"
```

## Consultar Logs de Erro

Esta rota exige usuario admin.

```powershell
$login = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:5000/api/login" `
  -ContentType "application/json" `
  -Body '{"username":"admin","password":"admin"}'

$adminToken = $login.token

Invoke-RestMethod -Method Get `
  -Uri "http://localhost:5000/api/logs/errors" `
  -Headers @{ Authorization = "Bearer $adminToken" }
```

Arquivos de log:

```text
logs/app.log
logs/error.log
```

## Envio Individual

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:5000/api/envio/individual" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body '{
    "numero": "11999999999",
    "nome": "Paciente Teste",
    "data": "2026-06-01",
    "hora": "08:00",
    "unidade": "HOSP VILA PENTEADO",
    "observacao": "Sem observacoes",
    "especialidade": "Cardiologia"
  }'
```

## Envio em Lote

Campo esperado no multipart:

```text
arquivo
```

Exemplo com `curl.exe`:

```powershell
curl.exe -X POST "http://localhost:5000/api/envio/lote" `
  -H "Authorization: Bearer $token" `
  -F "arquivo=@C:\caminho\arquivo.xlsx"
```

Baixar modelo:

```powershell
Invoke-WebRequest -Method Get `
  -Uri "http://localhost:5000/api/envio/modelo-lote" `
  -OutFile ".\modelo_envio_lote.xlsx"
```

## Docker

Subir ambiente:

```powershell
docker compose up -d --build
```

Parar ambiente:

```powershell
docker compose down
```

Ver logs:

```powershell
docker compose logs -f api
```

## Troubleshooting

### PowerShell bloqueia npm

Erro:

```text
npm.ps1 nao pode ser carregado porque a execucao de scripts foi desabilitada
```

Solucao rapida:

```powershell
npm.cmd install
npm.cmd start
```

### Erro Oracle NJS-116

Erro:

```text
NJS-116: password verifier type ... is not supported by node-oracledb in Thin mode
```

Causa: o driver esta tentando conectar em modo Thin, mas o banco exige Oracle Instant Client.

Solucao:

```text
ORACLE_CLIENT_LIB_DIR=C:\instantclient_23_0
```

Depois reinicie a API.

### Consulta retorna total zero

Verifique o usuario usado no login.

- `admin`: `empresa_id=0`, indicado para administracao.
- `hgvp`: `empresa_id=1`.
- `amas`: `empresa_id=2`.

Se usar `admin`, a consulta de respostas pode retornar zero registros.

### Erro interno no servidor

Consultar:

```powershell
Get-Content logs\error.log -Tail 20
```

Ou via API com token admin:

```powershell
Invoke-RestMethod -Method Get `
  -Uri "http://localhost:5000/api/logs/errors" `
  -Headers @{ Authorization = "Bearer $adminToken" }
```

## Checklist de Validacao

- `GET /api/health` retorna `ok`.
- `POST /api/login` retorna token.
- `GET /api/me` retorna usuario.
- `GET /api/respostas` retorna dados com usuario de empresa.
- `POST /api/respostas/report` gera `respostas.xlsx`.
- `GET /api/logs/errors` funciona com admin.
- Docker sobe com `docker compose up -d --build`.
