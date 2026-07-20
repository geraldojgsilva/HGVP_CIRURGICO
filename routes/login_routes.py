# from flask import Blueprint, render_template, request, redirect, session
# from services.oracle_service import conectar_oracle
# from services.auth_service import check_password

# login_bp = Blueprint("login", __name__)

# # 👉 Página de login
# @login_bp.route("/login", methods=["GET"])
# def login_page():
#     return render_template("login.html")

# # 👉 Processa login (POST)
# @login_bp.route("/login", methods=["POST"])
# def login_submit():
#     email = request.form.get("email")
#     senha = request.form.get("senha")

#     conn = conectar_oracle()
#     cur = conn.cursor()

#     cur.execute("""
#         SELECT id, nome, senha_hash, is_admin
#         FROM tb_usuario
#         WHERE email = :1 AND ativo = 'S'
#     """, (email,))
#     row = cur.fetchone()

#     conn.close()

#     if not row:
#         return "Usuário não encontrado"

#     user_id, nome, senha_hash, is_admin = row

#     if not check_password(senha, senha_hash):
#         return "Senha incorreta"

#     # 🔐 Criar sessão
#     session["user_id"] = user_id
#     session["user_name"] = nome
#     session["is_admin"] = (is_admin == "S")

#     return redirect("/")  # redireciona para home

# # 👉 Logout
# @login_bp.route("/logout")
# def logout():
#     session.clear()
#     return redirect("/login")
