from flask import Blueprint, render_template, request, redirect, url_for, flash, send_file
import pandas as pd
import os
import logging
from datetime import datetime
from config import UPLOAD_DIR
from services.oracle_service import conectar_oracle
from services.positus_service import enviar_confirmacao, enviar_confirmacao_cirurgica
import io
import time

envio_bp = Blueprint("envio", __name__)

# ---------------- FUNÇÕES AUXILIARES ---------------- #

def parse_data(data_str):
    try:
        if not data_str:
            return None

        data = pd.to_datetime(data_str, errors="coerce")

        if pd.isna(data):
            return None

        return data.to_pydatetime()

    except Exception as e:
        logging.error(f"Erro ao converter data: {data_str} | {e}")
        return None


def parse_hora(hora_str):
    try:
        if not hora_str:
            return None

        if isinstance(hora_str, (datetime, pd.Timestamp)):
            return hora_str.strftime("%H:%M")

        hora_str = str(hora_str).strip()

        if " " in hora_str:
            hora_str = hora_str.split(" ")[-1]

        partes = hora_str.split(":")

        if len(partes) >= 2:
            hh = partes[0].zfill(2)
            mm = partes[1].zfill(2)
            return f"{hh}:{mm}"

        return None

    except Exception as e:
        logging.error(f"Erro ao converter hora: {hora_str} | {e}")
        return None


def normalizar_numero(numero):
    if not numero:
        return None

    numero = "".join(filter(str.isdigit, str(numero)))

    if not numero.startswith("55"):
        numero = "55" + numero

    return numero


# ---------------- FUNÇÃO COMPARTILHADA ---------------- #

def _enviar_wrapper(numero, variaveis):
    try:
        # Normaliza variáveis (nunca None)
        variaveis = [(v.strip() if isinstance(v, str) else "") if v else "" for v in variaveis]

        nome = variaveis[0] if variaveis[0] else "Paciente"

        data_dt = parse_data(variaveis[1])
        data_tpl = data_dt.strftime("%d/%m/%Y") if data_dt else "Data a confirmar"

        hora_db = parse_hora(variaveis[2])
        hora_tpl = hora_db if hora_db else "Horario a confirmar"

        unidade = variaveis[3] if variaveis[3] else "Unidade nao informada"

        observacao = variaveis[4] if len(variaveis) > 4 else ""
        especialidade = variaveis[5] if len(variaveis) > 5 else ""
        tipo_internacao = variaveis[12] if len(variaveis) > 12 else ""

        # Extra: novas colunas (ainda não usadas para bloquear envio — só transporte)
        qtd_permitida        = variaveis[6] if len(variaveis) > 6 else ""
        valid_digitos        = variaveis[7] if len(variaveis) > 7 else ""
        valid_nome           = variaveis[8] if len(variaveis) > 8 else ""
        valid_datas          = variaveis[9] if len(variaveis) > 9 else ""
        valid_hora           = variaveis[10] if len(variaveis) > 10 else ""
        valid_unidade        = variaveis[11] if len(variaveis) > 11 else ""

        if tipo_internacao:
            st, txt = enviar_confirmacao_cirurgica(
                numero=numero,
                nome=nome,
                especialidade=especialidade,
                data=data_tpl,
                hora=hora_tpl,
                unidade=unidade,
                obs=observacao,
                tipo_internacao=tipo_internacao,
                id_empresa=1
            )
        else:
            st, txt = enviar_confirmacao(
                numero=numero,
                nome=nome,
                especialidade=especialidade,
                data=data_tpl,
                hora=hora_tpl,
                unidade=unidade,
                obs=observacao,
                id_empresa=1,
                id_template=1
            )

        conn = conectar_oracle()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO DBAMV.tb_mensagem_envio
            (numero, nome, data_consulta, hora_consulta, unidade,
             status_envio, id_template, id_empresa, especialidade, dt_envio)
            VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, CASE WHEN :10 = 200 THEN SYSDATE ELSE NULL END)
            """,
            (
                numero,
                nome,
                data_dt,
                hora_db,
                unidade,
                "S" if st == 200 else "N",
                3 if tipo_internacao == "hospital_dia" else 4 if tipo_internacao == "hospital_pernoite" else 1,
                1,
                especialidade,
                st
            )
        )
        conn.commit()
        conn.close()

        return st, txt

    except Exception as e:
        logging.error(f"Erro no envio para {numero}: {e}")
        return 500, str(e)


# ---------------------- ROTAS ---------------------- #

@envio_bp.route("/")
@envio_bp.route("/envio")
def envio():
    return render_template("envio.html", title="Envio")


@envio_bp.route("/enviar_individual", methods=["POST"])
def enviar_individual():
    numero = normalizar_numero(request.form.get("numero"))

    if not numero:
        flash("Informe o numero.")
        return redirect(url_for("envio.envio"))

    variaveis = [
        request.form.get("nome"),
        request.form.get("data"),
        request.form.get("hora"),
        request.form.get("unidade"),
        request.form.get("observacao"),
        request.form.get("especialidade"),
        request.form.get("qtd_permitida"),
        request.form.get("validacao_digitos"),
        request.form.get("validacao_nome"),
        request.form.get("validacao_datas"),
        request.form.get("validacao_hora"),
        request.form.get("validacao_unidade"),
        request.form.get("tipo_internacao")
    ]

    status, retorno = _enviar_wrapper(numero, variaveis)

    resultados = [{
        "numero": numero,
        "nome": variaveis[0],
        "data": variaveis[1],
        "hora": variaveis[2],
        "unidade": variaveis[3],
        "observacao": variaveis[4],
        "especialidade": variaveis[5],
        "qtd_permitida": variaveis[6],
        "validacao_digitos": variaveis[7],
        "validacao_nome": variaveis[8],
        "validacao_datas": variaveis[9],
        "validacao_hora": variaveis[10],
        "validacao_unidade": variaveis[11],
        "tipo_internacao": variaveis[12],
        "status": status,
        "retorno": retorno
    }]

    return render_template("envio_resultado.html", resultados=resultados, title="Resultado")


@envio_bp.route("/enviar_lote", methods=["POST"])
def enviar_lote():
    f = request.files.get("arquivo")

    if not f:
        flash("Envie um arquivo .xlsx, .xls ou .csv")
        return redirect(url_for("envio.envio"))

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    save_path = os.path.join(UPLOAD_DIR, f.filename)
    f.save(save_path)

    try:
        if f.filename.lower().endswith(".csv"):
            df = pd.read_csv(save_path, dtype=str).fillna("")
        else:
            df = pd.read_excel(save_path, dtype=str).fillna("")
    except Exception as e:
        flash(f"Falha ao ler arquivo: {e}")
        return redirect(url_for("envio.envio"))

    if "numero" not in df.columns:
        flash("A planilha deve conter a coluna 'numero'.")
        return redirect(url_for("envio.envio"))

    resultados = []

    for row in df.to_dict(orient="records"):
        time.sleep(0.1)
        numero = normalizar_numero(row.get("numero"))
        if not numero:
            continue

        variaveis = [
            row.get("nome"),
            row.get("data"),
            row.get("hora"),
            row.get("unidade"),
            row.get("OBS"),
            row.get("especialidade"),
            row.get("QTD_PERMITIDA"),
            row.get("VALIDACAO_DIGITOS"),
            row.get("VALIDACAO_NOME"),
            row.get("VALIDACAO_DATAS"),
            row.get("VALIDACAO_HORA"),
            row.get("VALIDACAO_UNIDADE")
        ]

        if len(numero) < 12:
            logging.log(f"Número {numero} inválido. Processo ignorado.")
            resultados.append({
                "numero": numero,
                "nome": variaveis[0],
                "data": variaveis[1],
                "hora": variaveis[2],
                "unidade": variaveis[3],
                "observacao": variaveis[4],
                "especialidade": variaveis[5],
                "qtd_permitida": variaveis[6],
                "validacao_digitos": variaveis[7],
                "validacao_nome": variaveis[8],
                "validacao_datas": variaveis[9],
                "validacao_hora": variaveis[10],
                "validacao_unidade": variaveis[11],
                "status": "Ignorado",
                "retorno": "Ignorado"
            })

        status, retorno = _enviar_wrapper(numero, variaveis)

        resultados.append({
            "numero": numero,
            "nome": variaveis[0],
            "data": variaveis[1],
            "hora": variaveis[2],
            "unidade": variaveis[3],
            "observacao": variaveis[4],
            "especialidade": variaveis[5],
            "qtd_permitida": variaveis[6],
            "validacao_digitos": variaveis[7],
            "validacao_nome": variaveis[8],
            "validacao_datas": variaveis[9],
            "validacao_hora": variaveis[10],
            "validacao_unidade": variaveis[11],
            "status": status,
            "retorno": retorno
        })

    return render_template("envio_resultado.html", resultados=resultados, title="Resultado")


# ---------------- MODELO PARA DOWNLOAD ---------------- #

@envio_bp.route("/download-modelo-lote")
def download_modelo_lote():
    try:
        caminho = os.path.join("uploads", "modelo_envio_lote.xlsx")

        if not os.path.exists(caminho):
            logging.error(f"Modelo não encontrado em: {caminho}")
            return "Arquivo de modelo não encontrado", 404

        return send_file(
            caminho,
            as_attachment=True,
            download_name="modelo_envio_lote.xlsx"
        )

    except Exception as e:
        logging.error(f"Erro ao baixar modelo: {e}")
        return "Erro ao gerar download", 500
