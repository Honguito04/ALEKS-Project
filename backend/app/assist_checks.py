"""Comprueba cuentas propuestas, sin acreditar la lectura de una imagen."""
import multiprocessing as mp
import re

import sympy as s
from pydantic import Field

from .engine import expression
from .models import Strict


class VisualCalculation(Strict):
    field_key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,39}$")
    expression: str = Field(min_length=1, max_length=240)
    decimal_places: int | None = Field(default=None, ge=0, le=8, strict=True)


def numeric(text):
    text = text.strip().replace("π", "pi").replace("×", "*").replace("−", "-")
    text = re.sub(r"(?<=\d)\s*(?=pi\b)", "*", text)
    return s.simplify(expression(text, allow_pi=True))


def _check_worker(items, connection):
    try:
        try:
            import resource
            resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
            resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
        except ImportError:
            pass  # En Windows el padre impone el tiempo y termina el proceso.
        for item in items:
            expected, actual = numeric(item["expression"]), numeric(item["answer"])
            places = item["decimal_places"]
            if places is not None:
                expected = s.sign(expected) * s.floor(s.Abs(expected) * 10**places + s.Rational(1, 2)) / 10**places
            if expected.is_real is not True or actual.is_real is not True or s.simplify(expected - actual) != 0:
                connection.send("mismatch")
                return
        connection.send("consistent")
    except Exception:
        connection.send("unsupported")
    finally:
        connection.close()


def check_calculations(items, timeout=3.0):
    """items ya acotados por Pydantic; no ejecuta código del proveedor."""
    if not 1 <= len(items) <= 12:
        return "unsupported"
    ctx = mp.get_context("spawn")
    parent, child = ctx.Pipe(duplex=False)
    process = ctx.Process(target=_check_worker, args=(items, child), daemon=True)
    process.start()
    child.close()
    try:
        if not parent.poll(timeout):
            return "timeout"
        try:
            return parent.recv()
        except EOFError:
            return "unsupported"
    finally:
        if process.is_alive():
            process.terminate()
        process.join(timeout=1)
        if process.is_alive():
            process.kill()
            process.join()
        parent.close()
