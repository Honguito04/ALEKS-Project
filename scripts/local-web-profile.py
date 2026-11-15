"""Keep the local Windows installation independent from downloaded source folders."""
import argparse
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
DATABASES = ("assistant.sqlite3", "assistant.sqlite3.web.sqlite3")


def profile_directory():
    base = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return base / "ALEKS-Project"


def local_configuration(path):
    values = dotenv_values(path) if path.is_file() else {}
    if values.get("WEB_DATABASE_URL") or (values.get("DATABASE_PATH") or ".runtime/assistant.sqlite3").replace("\\", "/") != ".runtime/assistant.sqlite3":
        raise RuntimeError("La configuracion usa una base de datos personalizada. Inicia ese despliegue con su configuracion habitual; el iniciador local no la sustituira ni importara.")


def account_count(path):
    if not path.is_file():
        return 0
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as connection:
        if not connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='web_users'").fetchone():
            return 0
        return connection.execute("SELECT COUNT(*) FROM web_users").fetchone()[0]


def snapshot(source, destination):
    # SQLite backup includes committed WAL pages; copying the .sqlite3 file alone does not.
    with sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True) as original:
        with sqlite3.connect(destination) as copied:
            original.backup(copied)
            if copied.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("La copia de la base de datos no paso la comprobacion de integridad.")


def has_panel_data(path):
    if not path.is_file():
        return False
    with sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True) as connection:
        tables = connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
        for (table,) in tables:
            quoted = '"' + table.replace('"', '""') + '"'
            if connection.execute(f"SELECT 1 FROM {quoted} LIMIT 1").fetchone():
                return True
    return False


def prepare_profile(project=ROOT, profile=None, import_from=None):
    project = Path(project).resolve()
    profile = Path(profile or profile_directory()).resolve()
    source = Path(import_from).resolve() if import_from else project
    if not source.is_dir():
        raise RuntimeError("La carpeta anterior no existe. Indica la carpeta que contiene .runtime y .env.")
    if import_from and not (source / ".runtime" / DATABASES[1]).is_file():
        raise RuntimeError("La carpeta indicada no contiene la base de cuentas web en .runtime.")
    if import_from or not (profile / ".env").exists():
        local_configuration(source / ".env")
    local_configuration(profile / ".env")
    if os.environ.get("WEB_DATABASE_URL") or os.environ.get("DATABASE_PATH"):
        raise RuntimeError("Hay una base de datos configurada en el entorno. Usa el iniciador de ese despliegue o retira esas variables antes de iniciar el perfil local.")
    target_web = profile / ".runtime" / DATABASES[1]
    if import_from and (account_count(target_web) or has_panel_data(profile / ".runtime" / DATABASES[0])):
        raise RuntimeError("El perfil persistente ya contiene cuentas o datos del panel. No se reemplazo ninguno. Conserva ambas carpetas para recuperar los datos sin sobrescribirlos.")
    profile.mkdir(parents=True, exist_ok=True)
    runtime = profile / ".runtime"
    runtime.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="import-", dir=profile) as staging:
        staging = Path(staging)
        pending = []
        for name in DATABASES:
            original, destination = source / ".runtime" / name, runtime / name
            if original.is_file() and original.resolve() != destination.resolve() and (import_from or not destination.exists()):
                temporary = staging / name
                snapshot(original, temporary)
                pending.append((temporary, destination))
        if any(destination.exists() and destination.with_name(destination.name + ".before-import").exists() for _, destination in pending):
            raise RuntimeError("Ya existe una copia anterior de recuperacion. Conserva o mueve ese archivo antes de importar otra vez.")
        for temporary, destination in pending:
            if destination.exists():
                # Explicit recovery into an empty profile keeps the old database as a backup.
                snapshot(destination, staging / (destination.name + ".before-import"))
                backup = destination.with_name(destination.name + ".before-import")
                os.replace(staging / (destination.name + ".before-import"), backup)
                snapshot(temporary, destination)
            else:
                os.replace(temporary, destination)
        config = profile / ".env"
        replace_example = bool(import_from and config.exists() and (project / ".env.example").is_file()
                               and config.read_bytes() == (project / ".env.example").read_bytes())
        if not config.exists() or replace_example:
            original = source / ".env"
            if not original.exists():
                original = project / ".env.example"
            # Only an explicit recovery may replace an unchanged example configuration.
            with config.open("wb" if replace_example else "xb") as output, original.open("rb") as input_file:
                shutil.copyfileobj(input_file, output)
    return profile


def main():
    parser = argparse.ArgumentParser(description="Iniciar la web local con cuentas y configuracion persistentes.")
    parser.add_argument("--import-from", type=Path, help="Carpeta de una instalacion anterior detenida")
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    try:
        profile = prepare_profile(import_from=args.import_from)
    except (OSError, ValueError, sqlite3.Error, RuntimeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(f"Cuentas y datos persistentes: {profile / '.runtime'}", flush=True)
    print(f"Configuracion de IA y Google: {profile / '.env'}", flush=True)
    print("Las siguientes actualizaciones ZIP usaran esta misma carpeta.", flush=True)
    if not account_count(profile / ".runtime" / DATABASES[1]):
        print("Si ya tenias una cuenta en otra carpeta, deten el servidor y arrastra esa carpeta sobre scripts\\restore-local-data.cmd para recuperarla.", flush=True)
    if args.prepare_only:
        return 0
    os.environ.update(ALEKS_ENV_FILE=str(profile / ".env"), DATABASE_PATH=str(profile / ".runtime" / DATABASES[0]),
                      WEB_DATABASE_URL="", WEB_PUBLIC_MODE="false", WEB_PUBLIC_URL="http://127.0.0.1:8000")
    os.chdir(ROOT)
    sys.path.insert(0, str(ROOT / "backend"))
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, access_log=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
