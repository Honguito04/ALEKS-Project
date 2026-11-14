"""Local launcher checks; does not read or print configuration secrets."""
import json
from pathlib import Path
import socket
import sys

ROOT = Path(__file__).resolve().parent.parent


def check_port(port=8000):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            probe.bind(("127.0.0.1", port))
        except OSError as exc:
            raise RuntimeError(
                f"El puerto {port} no esta disponible. Si hay otro servidor abierto, "
                "detenlo con Ctrl+C en su ventana y vuelve a ejecutar este archivo. "
                "No se ha cerrado ningun proceso."
            ) from exc


def describe_build(root=ROOT):
    manifest = json.loads((root / "dist/manifest.json").read_text(encoding="utf-8"))
    source = json.loads((root / "extension/public/manifest.json").read_text(encoding="utf-8"))
    if manifest.get("version") != source["version"]:
        raise RuntimeError("La extension compilada tiene otra version. Ejecuta start-web.cmd de nuevo.")
    for relative in ("dist/content.js", "dist/background.js", "web-dist/index.html"):
        path = root / relative
        if not path.is_file() or not path.stat().st_size:
            raise RuntimeError(f"Falta la compilacion de {relative}. No se iniciara una web incompleta.")
    print(f"Carpeta del proyecto: {root}")
    print(f"Extension compilada: {manifest['version']}")
    print(f"Carpeta que debe estar cargada en Chrome: {root / 'dist'}")
    print("En chrome://extensions pulsa Recargar en esa extension.")
    print("Si Chrome usa otra carpeta, quita esa copia y carga la carpeta indicada arriba.")
    print("Despues recarga las pestanas de ALEKS y de la web, y vuelve a vincularlas.")


def main():
    try:
        if sys.argv[1:] == ["port"]:
            check_port()
        elif sys.argv[1:] == ["build"]:
            describe_build()
        else:
            raise RuntimeError("Uso: local-web-check.py port|build")
    except (OSError, ValueError, KeyError, RuntimeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
