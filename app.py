from flask import Flask
import logging, os

from config import LOG_PATH

from routes.envio_routes import envio_bp
from routes.resposta_routes import resposta_bp
from routes.webhook_routes import webhook_bp
# from routes.login_routes import login_bp

app = Flask(__name__)
app.secret_key = "a341b94a1f8946d45c8640c7763868685f87af93d6cb77a2429ddbe43b4472da"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_PATH, encoding="utf-8"),
        logging.StreamHandler()
    ]
)

logging.info("Serviço Flask inicializado — logs gravando em logs_flask.txt")

app.register_blueprint(envio_bp)
app.register_blueprint(resposta_bp)
app.register_blueprint(webhook_bp)
# app.register_blueprint(login_bp)   

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=9000)
