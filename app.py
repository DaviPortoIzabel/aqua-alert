"""Entrada local do Aqua Alert. Execute: python app.py."""

from local_app import create_app

app = create_app()

if __name__ == "__main__":
    # Sem debugger e restrito ao computador por padrão.
    app.run(host="127.0.0.1", port=5000)
