from flask import Blueprint, render_template, request
from services.oracle_service import conectar_oracle

webhook_bp = Blueprint("webhook_logs", __name__)


@webhook_bp.route("/webhook_logs")
def webhook_logs():
    page = request.args.get("page", 1, type=int)
    per_page = 10
    offset = (page - 1) * per_page

    conn = conectar_oracle()
    cur = conn.cursor(dictionary=True)

    cur.execute("SELECT COUNT(*) AS TOTAL FROM DBAMV.tb_mensagem_webhook WHERE ID_EMPRESA = 1 OR ID_EMPRESA IS NULL")
    total = list(cur.fetchone().values())[0]

    cur.execute("""
        SELECT id, numero, tipo_evento, texto_resposta, processado, data_evento
        FROM DBAMV.tb_mensagem_webhook
        WHERE ID_EMPRESA = 1 OR ID_EMPRESA IS NULL
        ORDER BY data_evento DESC
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
    """, {"offset": offset, "limit": per_page})

    rows = cur.fetchall()
    conn.close()

    total_pages = (total + per_page - 1) // per_page

    return render_template(
        "webhook_logs.html",
        logs=rows,
        page=page,
        total_pages=total_pages,
        title="Webhook Logs"
    )
