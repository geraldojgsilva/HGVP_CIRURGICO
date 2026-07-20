# Documento Executivo - IRSSL Chatbot API

## Visao Geral

O IRSSL Chatbot API foi refatorado para uma Web API em Node.js/Express, substituindo a base Python/Flask. A nova API centraliza os fluxos de autenticacao, envio de mensagens via Positus, consulta de respostas no Oracle, geracao de relatorios Excel e diagnostico de erros.

## Objetivo

Modernizar a aplicacao de mensageria e respostas de pacientes, deixando o backend orientado a API, com melhor integracao para frontends, automacoes e ferramentas externas.

## Escopo Entregue

- API Node.js/Express como backend principal.
- Remocao da estrutura Python do projeto.
- Autenticacao JWT com usuarios por empresa.
- Consulta paginada de respostas no Oracle.
- Geracao de relatorio Excel.
- Envio individual e em lote via Positus.
- Logs estruturados em arquivo.
- Endpoint administrativo para consulta de erros recentes.
- Docker principal ajustado para Node.js.

## Principais Rotas

- `GET /api/health`: verifica disponibilidade da API.
- `POST /api/login`: autentica usuario e retorna token JWT.
- `GET /api/me`: retorna dados do usuario autenticado.
- `POST /api/envio/individual`: envia mensagem individual.
- `POST /api/envio/lote`: envia mensagens por planilha.
- `GET /api/envio/modelo-lote`: baixa modelo de planilha.
- `GET /api/respostas`: consulta respostas paginadas.
- `GET /api/respostas/analytics`: retorna indicadores por periodo.
- `POST /api/respostas/report`: gera relatorio Excel.
- `GET /api/logs/errors`: consulta erros recentes, restrito a admin.

## Validacoes Realizadas

- API iniciou corretamente em `http://localhost:5000`.
- Health check retornou `status=ok`.
- Login com JWT validado.
- Consulta `/api/me` validada.
- Conexao Oracle validada com usuario de empresa.
- Consulta de respostas retornou dados reais.
- Relatorio Excel extraido com sucesso.
- Logs de erro foram gerados e consultados durante troubleshooting.

## Arquitetura Atual

```text
Cliente / Frontend / Automacao
        |
        v
Node.js Express API
        |
        |-- JWT Auth
        |-- Positus API
        |-- Oracle Database
        |-- Excel Report Service
        `-- Structured Logs
```

## Beneficios

- Backend preparado para consumo por frontend separado.
- Melhor padronizacao de respostas HTTP/JSON.
- Logs estruturados para investigacao de falhas.
- Deploy simplificado via Docker.
- Reducao da dependencia da interface server-side antiga.
- Base mais adequada para evolucao de APIs e integracoes.

## Riscos e Pontos de Atencao

- O Oracle exige Oracle Instant Client em modo Thick para alguns usuarios/bancos.
- Em Windows, a variavel `ORACLE_CLIENT_LIB_DIR` deve apontar para a pasta do Instant Client.
- O usuario `admin` possui `empresa_id=0`; por isso consulta logs, mas pode nao ver dados de empresas.
- Rotas de envio dependem da disponibilidade da Positus e das variaveis `POSITUS_TOKEN` e `POSITUS_URL`.

## Recomendacoes

- Definir usuarios reais e politica de senha fora do codigo.
- Armazenar credenciais somente em `.env` ou cofre de segredos.
- Configurar monitoramento dos arquivos `logs/error.log` e `logs/app.log`.
- Validar envio individual e envio em lote em ambiente homologado antes de producao.
- Publicar documentacao OpenAPI/Swagger em uma etapa futura.

## Status

A refatoracao para Node.js foi concluida e os principais fluxos de leitura e relatorio foram validados com sucesso.
