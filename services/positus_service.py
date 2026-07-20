
import requests
import json
import logging
import os
from datetime import datetime
from services.oracle_service import conectar_oracle
from dotenv import load_dotenv
load_dotenv()

DEFAULT_TOKEN = os.environ.get("POSITUS_TOKEN")
DEFAULT_URL = os.environ.get("POSITUS_URL")
CIRURGIA_DOCUMENT_URL = (
    os.environ.get("POSITUS_CIRURGIA_DOCUMENT_URL")
    or os.environ.get("POSITUS_PREPARO_DOCUMENT_URL")
    or "https://cdn.positus.global/production/resources/samples/document.pdf"
)
CIRURGIA_DOCUMENT_FILENAME = (
    os.environ.get("POSITUS_CIRURGIA_DOCUMENT_FILENAME")
    or os.environ.get("POSITUS_PREPARO_DOCUMENT_FILENAME")
    or "document.pdf"
)
CIRURGIA_NAMESPACE = os.environ.get("POSITUS_CIRURGIA_TEMPLATE_NAMESPACE")
CIRURGIA_TEMPLATES = {
    "hospital_dia": {
        "name": os.environ.get("POSITUS_TEMPLATE_HOSPITAL_DIA") or "elpis_confirm_crur",
        "id": int(os.environ.get("POSITUS_TEMPLATE_HOSPITAL_DIA_ID") or 1),
        "document_url": (
            os.environ.get("POSITUS_CIRURGIA_HOSPITAL_DIA_DOCUMENT_URL")
            or "http://irssl.org.br/wp-content/uploads/2026/07/ORIENTACAO-PARA-PACIENTE-HOSPITAL-DIA.pdf"
        ),
        "document_filename": (
            os.environ.get("POSITUS_CIRURGIA_HOSPITAL_DIA_DOCUMENT_FILENAME")
            or "ORIENTACAO-PARA-PACIENTE-HOSPITAL-DIA.pdf"
        ),
    },
    "hospital_pernoite": {
        "name": os.environ.get("POSITUS_TEMPLATE_HOSPITAL_PERNOITE") or "elpis_cirur_hospital_pernoite",
        "id": int(os.environ.get("POSITUS_TEMPLATE_HOSPITAL_PERNOITE_ID") or 1),
        "document_url": (
            os.environ.get("POSITUS_CIRURGIA_HOSPITAL_PERNOITE_DOCUMENT_URL")
            or "http://irssl.org.br/wp-content/uploads/2026/07/ORIENTACOES-PARA-PACIENTES-PERNOITE.pdf"
        ),
        "document_filename": (
            os.environ.get("POSITUS_CIRURGIA_HOSPITAL_PERNOITE_DOCUMENT_FILENAME")
            or "ORIENTACOES-PARA-PACIENTES-PERNOITE.pdf"
        ),
    },
}

def _grava_log_envio(id_envio, id_empresa, id_template, numero_destino, status_http, response_text, payload_enviado, erro_texto=None):
    try:
        conn = conectar_oracle()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO DBAMV.tb_mensagem_log_envio
                (id_envio, id_empresa, id_template, numero_destino, status_http, response_text, payload_enviado, erro_texto, data_envio)
            VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9)
        """, (
            id_envio, id_empresa, id_template, numero_destino,
            status_http, response_text, json.dumps(payload_enviado, ensure_ascii=False),
            erro_texto, datetime.now()
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        logging.error(f"⚠️ Falha ao gravar log de envio: {e}")

def enviar_confirmacao(numero, nome, especialidade, data, hora, unidade,
                       obs, token_empresa=None, url_empresa=None,
                       nome_template=None, namespace=None,
                       numero_whatsapp=None,
                       id_envio=None, id_empresa=None, id_template=None):

    token = token_empresa or DEFAULT_TOKEN
    url = url_empresa or DEFAULT_URL
    template_name = nome_template or "elpis_v1"
    template_namespace = namespace or "fac54ef7_5fcf_4efb_a331_3b02438f176c"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    obs_formatted = obs and obs.strip() or "Sem observações."

    payload = {
        "from": numero_whatsapp or None,
        "to": numero,
        "type": "template",
        "template": {
            "namespace": template_namespace,
            "name": template_name,
            "language": {"policy": "deterministic", "code": "pt_BR"},
            "components": [{
                "type": "body",
                "parameters": [
                    {"type": "text", "text": nome or ""},
                    {"type": "text", "text": especialidade or ""},
                    {"type": "text", "text": data or ""},
                    {"type": "text", "text": hora or ""},
                    {"type": "text", "text": unidade or ""},
                    {"type": "text", "text": obs_formatted}
                ]
            }]
        },
        "messaging_product": "whatsapp"
    }

    # # SANDBOX TEST
    # payload_sandbox = {
    #     "from": numero_whatsapp or None,
    #     "to": numero,
    #     "type": "text",
    #     "text": {
    #         "body": "Oi, tudo bem? API SERVICE"
    #     }
    # }

    try:
        # # SANDBOX TEST
        # resp = requests.post(url, headers=headers, json=payload_sandbox, timeout=20) 
        resp = requests.post(url, headers=headers, json=payload, timeout=20)
        status_code = resp.status_code
        text = resp.text
        logging.info(f"Enviado para {numero}: {status_code} ({template_name})")

        _grava_log_envio(id_envio, id_empresa, id_template, numero, status_code, text, payload, None)
        return status_code, text

    except requests.RequestException as e:
        logging.error(f"Erro ao enviar para {numero}: {e}")
        _grava_log_envio(id_envio, id_empresa, id_template, numero, None, None, payload, str(e))
        return None, str(e)


def enviar_confirmacao_cirurgica(numero, nome, especialidade, data, hora, unidade,
                                 obs, tipo_internacao, token_empresa=None,
                                 url_empresa=None, namespace=None,
                                 numero_whatsapp=None, id_envio=None,
                                 id_empresa=None):
    template = CIRURGIA_TEMPLATES.get((tipo_internacao or "").strip().lower())
    if not template:
        return 400, "Selecione o tipo de internacao: hospital_dia ou hospital_pernoite."

    token = token_empresa or DEFAULT_TOKEN
    url = url_empresa or DEFAULT_URL
    template_name = template["name"]
    template_namespace = namespace or CIRURGIA_NAMESPACE
    obs_formatted = obs and obs.strip() or "Sem observacoes."

    payload_template = {
        "name": template_name,
        "language": {"policy": "deterministic", "code": "pt_BR"},
        "components": [
            {
                "type": "header",
                "parameters": [{
                    "type": "document",
                    "document": {
                        "link": template.get("document_url") or CIRURGIA_DOCUMENT_URL,
                        "filename": template.get("document_filename") or CIRURGIA_DOCUMENT_FILENAME
                    }
                }]
            },
            {
                "type": "body",
                "parameters": [
                    {"type": "text", "text": nome or ""},
                    {"type": "text", "text": especialidade or ""},
                    {"type": "text", "text": data or ""},
                    {"type": "text", "text": hora or ""},
                    {"type": "text", "text": unidade or ""},
                    {"type": "text", "text": obs_formatted}
                ]
            }
        ]
    }
    if template_namespace:
        payload_template["namespace"] = template_namespace

    payload = {
        "from": numero_whatsapp or None,
        "to": numero,
        "type": "template",
        "template": payload_template,
        "messaging_product": "whatsapp"
    }

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=20)
        status_code = resp.status_code
        text = resp.text
        logging.info(f"Enviado para {numero}: {status_code} ({template_name})")
        _grava_log_envio(id_envio, id_empresa, template["id"], numero, status_code, text, payload, None)
        return status_code, text

    except requests.RequestException as e:
        logging.error(f"Erro ao enviar para {numero}: {e}")
        _grava_log_envio(id_envio, id_empresa, template["id"], numero, None, None, payload, str(e))
        return None, str(e)
