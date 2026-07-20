# Roteiro de habilitacao - WhatsApp direto pela Meta

Este roteiro serve para habilitar um projeto novo para enviar mensagens de WhatsApp sem Positus, usando a Meta WhatsApp Cloud API.

## Objetivo

Enviar mensagens ativas para pacientes, com texto curto aprovado em template e preparo cirurgico em PDF ou link seguro.

## Ordem recomendada

Siga nesta ordem:

1. Entrar no Business Manager da instituicao.
2. Confirmar se o negocio esta verificado.
3. Confirmar quem tem permissao de administrador.
4. Criar ou localizar o app no Meta for Developers.
5. Adicionar o produto WhatsApp ao app.
6. Criar ou localizar a WhatsApp Business Account (WABA).
7. Verificar se o numero de WhatsApp pode ser usado direto na Cloud API.
8. Identificar e anotar:
   - `META_BUSINESS_ACCOUNT_ID`
   - `META_WHATSAPP_BUSINESS_ACCOUNT_ID`
   - `META_PHONE_NUMBER_ID`
9. Gerar um token temporario para primeiro teste.
10. Criar um System User para token definitivo.
11. Gerar o token definitivo com permissoes de WhatsApp.
12. Definir se o preparo sera enviado como PDF ou link seguro.
13. Criar o template de mensagem na Meta.
14. Aguardar aprovacao do template.
15. Separar um numero interno para teste.
16. Testar envio direto pela Graph API.
17. Configurar webhook para status e respostas.
18. Registrar logs de envio, entrega, erro e resposta.
19. Criar o servico paralelo neste projeto.
20. Depois dos testes, trocar a Positus pelo envio direto.

## Sites oficiais por etapa

Use estes links como ponto de partida:

| Etapa | Site |
| --- | --- |
| Business Manager / configuracoes da empresa | https://business.facebook.com/settings |
| Meta Business Suite | https://business.facebook.com |
| Meta for Developers | https://developers.facebook.com |
| Criar ou gerenciar apps | https://developers.facebook.com/apps |
| Documentacao inicial da WhatsApp Cloud API | https://developers.facebook.com/docs/whatsapp/cloud-api/get-started |
| Referencia de envio de mensagens | https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages |
| Referencia de midia/anexos | https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media |
| Webhooks da Cloud API | https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks |
| Templates de mensagem | https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates |
| Visao geral da plataforma WhatsApp Business | https://developers.facebook.com/docs/whatsapp |

## 1. Preparar acessos da Meta

1. Acessar o Meta Business Suite / Business Manager da instituicao.
2. Confirmar se o negocio esta verificado.
3. Confirmar quem tera permissao de administrador.
4. Criar ou identificar o app no Meta for Developers.
5. Adicionar o produto WhatsApp ao app.

Links oficiais:

- https://developers.facebook.com/docs/whatsapp/cloud-api/get-started
- https://business.facebook.com/settings
- https://developers.facebook.com/apps

## 2. Preparar a conta WhatsApp Business

1. Criar ou localizar a WhatsApp Business Account (WABA).
2. Vincular o numero que sera usado para envio.
3. Validar se o numero pode ser conectado direto na Cloud API.
4. Guardar os identificadores:
   - `META_BUSINESS_ACCOUNT_ID`
   - `META_WHATSAPP_BUSINESS_ACCOUNT_ID`
   - `META_PHONE_NUMBER_ID`

Observacao: se o numero estiver sob controle de um provedor atual, pode ser necessario migrar ou desvincular antes do uso direto.

## 3. Gerar credencial de API

Para teste inicial, a Meta fornece token temporario no painel do app.

Para homologacao/producao, usar token de System User:

1. Criar System User no Business Manager.
2. Dar permissao ao app e ao ativo WhatsApp.
3. Gerar token com permissoes de WhatsApp.
4. Guardar em ambiente seguro:
   - `META_WHATSAPP_TOKEN`

Permissoes normalmente envolvidas:

- `whatsapp_business_messaging`
- `whatsapp_business_management`

## 4. Criar templates de mensagem

Como o envio ativo para paciente inicia conversa, a mensagem precisa usar template aprovado.

Template recomendado para preparo cirurgico:

```text
Ola, {{1}}. Seu procedimento esta agendado para {{2}} em {{3}}.
As orientacoes de preparo estao disponiveis no arquivo/link enviado nesta mensagem.
```

Variaveis sugeridas:

- `{{1}}`: nome do paciente
- `{{2}}`: data do procedimento
- `{{3}}`: unidade

Opcoes de entrega do preparo:

- PDF no header do template, quando o preparo for padrao.
- Botao ou link seguro, quando houver dado sensivel ou conteudo personalizado.

## 5. Escolher modelo de preparo

### Opcao A - PDF anexado

Boa para orientacoes padronizadas, sem dados sensiveis do paciente.

Requisitos:

- PDF hospedado em URL HTTPS publica ou previamente enviado como media.
- Template aprovado com header de documento.
- Nome de arquivo claro para o paciente.

### Opcao B - Link seguro

Melhor para saude, principalmente quando houver informacao personalizada.

Requisitos:

- URL HTTPS.
- Token unico por paciente.
- Expiracao do link.
- Registro de acesso.
- Pagina sem indexacao publica.

Recomendacao inicial: usar link seguro para preparos personalizados e PDF para preparos genericos.

## 6. Testar envio direto

Endpoint base:

```text
POST https://graph.facebook.com/vXX.X/{META_PHONE_NUMBER_ID}/messages
```

Variaveis minimas para teste:

```env
META_GRAPH_VERSION=v20.0
META_PHONE_NUMBER_ID=
META_WHATSAPP_TOKEN=
META_TEMPLATE_PREPARO=
META_TEMPLATE_LANGUAGE=pt_BR
```

Payload de exemplo com documento:

```json
{
  "messaging_product": "whatsapp",
  "to": "5511999999999",
  "type": "template",
  "template": {
    "name": "preparo_cirurgia_pdf",
    "language": { "code": "pt_BR" },
    "components": [
      {
        "type": "header",
        "parameters": [
          {
            "type": "document",
            "document": {
              "link": "https://seu-dominio/preparos/preparo.pdf",
              "filename": "preparo-cirurgico.pdf"
            }
          }
        ]
      },
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "Maria" },
          { "type": "text", "text": "02/07/2026" },
          { "type": "text", "text": "Hospital" }
        ]
      }
    ]
  }
}
```

## 7. Configurar webhooks

O webhook e necessario para receber:

- status de envio;
- status de entrega;
- leitura, quando disponivel;
- respostas do paciente;
- erros da plataforma.

Itens a definir:

- URL publica HTTPS do webhook.
- `VERIFY_TOKEN` interno.
- assinatura/validacao de origem.
- tabela de logs de eventos.

Link oficial:

- https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks

## 8. Checklist para homologacao

- Negocio Meta verificado.
- WABA ativa.
- Numero conectado.
- `PHONE_NUMBER_ID` identificado.
- Token de API gerado.
- Template aprovado.
- PDF ou link seguro definido.
- Endpoint de teste funcionando.
- Webhook recebendo eventos.
- Logs persistidos.
- Politica LGPD revisada.

## 9. Como usar este projeto como bancada

1. Criar um servico paralelo `src/services/metaWhatsappService.js`.
2. Manter `positusService.js` intacto no primeiro momento.
3. Criar uma rota de teste autenticada, separada do envio real.
4. Enviar para um numero interno da equipe.
5. Registrar request/response em log.
6. Depois de validar, trocar o adaptador de envio da fila.

## Dados que precisamos coletar

```text
META_GRAPH_VERSION=
META_PHONE_NUMBER_ID=
META_WHATSAPP_BUSINESS_ACCOUNT_ID=
META_WHATSAPP_TOKEN=
META_TEMPLATE_PREPARO=
META_TEMPLATE_LANGUAGE=pt_BR
NUMERO_TESTE_WHATSAPP=
URL_PREPARO_TESTE=
```
