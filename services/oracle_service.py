import oracledb
import json
import logging
import traceback
import os
from datetime import datetime
from dotenv import load_dotenv
load_dotenv()

_pool = None

oracledb.init_oracle_client(lib_dir="/opt/oracle/instantclient")

def conectar_oracle(): 
    """
    Retorna um objeto compatível com o uso antigo de MySQL.
    Cada cursor retornará dicionários em vez de tuplas.
    Adiciona commit() e rollback() compatíveis.
    """
    global _pool
    if not _pool:
        wallet_dir = os.environ.get("ORACLE_WALLET_DIR")

        _pool = oracledb.create_pool(
            user=os.environ.get("ORACLE_USER"),
            password=os.environ.get("ORACLE_PASS"),
            host=os.getenv("ORACLE_HOST"),
            port=int(os.getenv("ORACLE_PORT")),
            service_name=os.getenv("DB_SERVICE")
        )

    class OracleConnWrapper:
        def __init__(self, pool):
            self.pool = pool
            self._conn = pool.acquire()

        def cursor(self, dictionary=True):
            cur = self._conn.cursor()
            if dictionary:
                return CursorDictWrapper(cur)
            return cur

        def commit(self):
            self._conn.commit()

        def rollback(self):
            self._conn.rollback()

        def close(self):
            self._conn.close()

    class CursorDictWrapper:
        def __init__(self, cursor):
            self._cursor = cursor

        def execute(self, *args, **kwargs):
            return self._cursor.execute(*args, **kwargs)

        def executemany(self, *args, **kwargs):
            return self._cursor.executemany(*args, **kwargs)

        def fetchone(self):
            row = self._cursor.fetchone()
            if row is None:
                return None
            return {desc[0].lower(): value for desc, value in zip(self._cursor.description, row)}

        def fetchall(self):
            columns = [desc[0].lower() for desc in self._cursor.description]
            return [dict(zip(columns, row)) for row in self._cursor.fetchall()]

        def close(self):
            return self._cursor.close()

        def __getattr__(self, name):
            """
            Encaminha qualquer atributo/método que o wrapper não tem
            diretamente para o cursor original (ex: var, lastrowid, etc.)
            """
            return getattr(self._cursor, name)


    return OracleConnWrapper(_pool)
