from flask import Blueprint, render_template, request, redirect, flash, send_file
from services.oracle_service import conectar_oracle
from services.report_service import generate_automation_items_excel
from io import BytesIO
from datetime import datetime

resposta_bp = Blueprint("respostas", __name__)

@resposta_bp.route("/respostas")
def respostas():
    tipo = request.args.get("tipo_resposta", "TODOS")
    data_ini = request.args.get("data_ini")
    data_fim = request.args.get("data_fim")
    page = request.args.get("page", 1, type=int)

    per_page = 10
    offset = (page - 1) * per_page

    sql_base = """
        FROM DBAMV.TB_MENSAGEM_ENVIO
        WHERE ID_EMPRESA = 1 OR ID_EMPRESA IS NULL
    """

    filtros = []
    params = {}

    if tipo not in ("TODOS", "AGUARDANDO"):
        filtros.append("RESPOSTA = :tipo")
        params["tipo"] = tipo

    if tipo == "AGUARDANDO":
        filtros.append("RESPOSTA IS NULL")

    if data_ini:
        filtros.append("TRUNC(DT_RESPOSTA) >= TO_DATE(:data_ini, 'YYYY-MM-DD')")
        params["data_ini"] = data_ini

    if data_fim:
        filtros.append("TRUNC(DT_RESPOSTA) <= TO_DATE(:data_fim, 'YYYY-MM-DD')")
        params["data_fim"] = data_fim

    if filtros:
        sql_base += " AND " + " AND ".join(filtros)

    conn = conectar_oracle()
    cur = conn.cursor(dictionary=True)

    cur.execute(f"SELECT COUNT(*) AS TOTAL {sql_base}", params)
    total = list(cur.fetchone().values())[0]

    total_pages = (total + per_page - 1) // per_page

    if page < 1:
        page = 1
    elif page > total_pages and total_pages > 0:
        page = total_pages

    offset = (page - 1) * per_page

    sql_page = f"""
        SELECT *
        {sql_base}
        ORDER BY 
            DT_RESPOSTA DESC NULLS LAST,
            DT_ENVIO DESC,
            ID DESC
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
    """

    params.update({"offset": offset, "limit": per_page})
    cur.execute(sql_page, params)
    rows = cur.fetchall()

    conn.close()

    return render_template(
        "respostas.html",
        rows=rows,
        tipo=tipo,
        data_ini=data_ini,
        data_fim=data_fim,
        page=page,
        total_pages=total_pages,
        title="Respostas"
    )

@resposta_bp.route("/report", methods=["POST"])
def report():
    values = request.json

    if not values or "data_ini" not in values or "data_fim" not in values:
        return "Parametros Invalidos", 400

    try: 
        data_ini = datetime.fromisoformat(values["data_ini"])
        data_fim = datetime.fromisoformat(values["data_fim"])
    except:
        return "Parametros Invalidos", 400

    sql = """SELECT
        NOME,
        NUMERO,
        DATA_CONSULTA,
        HORA_CONSULTA,
        STATUS_ENVIO,
        RESPOSTA,
        ESPECIALIDADE,
        DT_RESPOSTA,
        DT_ENVIO
        FROM DBAMV.TB_MENSAGEM_ENVIO
        WHERE DT_ENVIO BETWEEN :data_ini AND :data_fim
        AND (ID_EMPRESA = 1 OR ID_EMPRESA IS NULL)"""

    conn = conectar_oracle()
    cur = conn.cursor(dictionary=True)
    cur.execute(sql, {"data_ini": data_ini, "data_fim": data_fim})
    rows = cur.fetchall()
    conn.close()

    excel_bytes = generate_automation_items_excel(rows)

    return send_file(
        BytesIO(excel_bytes),
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name="test.xlsx"
    )