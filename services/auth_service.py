# import bcrypt
# from flask_login import UserMixin

# class User(UserMixin):
#     def __init__(self, id, nome, email, ativo):
#         self.id = id
#         self.nome = nome
#         self.email = email
#         self.ativo = ativo


# # -------------------------------------------------------------
# # 🔐 Cria hash seguro da senha
# # -------------------------------------------------------------
# def hash_password(plain: str) -> str:
#     """
#     Gera um hash seguro usando bcrypt.
#     """
#     salt = bcrypt.gensalt(rounds=12)  # força ajustada
#     hashed = bcrypt.hashpw(plain.encode("utf-8"), salt)
#     return hashed.decode("utf-8")


# # -------------------------------------------------------------
# # 🔐 Compara senha digitada com hash salvo
# # -------------------------------------------------------------
# def check_password(plain: str, hashed: str) -> bool:
#     """
#     Verifica se a senha digitada corresponde ao hash armazenado.
#     Retorna False caso o hash esteja corrompido ou inválido.
#     """
#     if not plain or not hashed:
#         return False

#     try:
#         return bcrypt.checkpw(
#             plain.encode("utf-8"),
#             hashed.encode("utf-8")
#         )
#     except Exception:
#         # evita crash caso o hash seja inválido
#         return False
