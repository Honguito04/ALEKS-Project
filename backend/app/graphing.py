"""Puntos exactos para la plantilla de trazado de parábolas de ALEKS."""
import re


_PARABOLA_TASK = re.compile(
    r"traz(?:ar|a) el gráfico de la parábola y\s*=\s*(.+?) "
    r"para trazar la parábola, marcar el vértice y cuatro puntos más, dos a cada lado del vértice\. "
    r"luego hacer clic en el [ií]cono del gráfico\.",
    re.IGNORECASE,
)

_VERTEX_FORM = re.compile(
    r"""
    (?P<direction>[+-])?\s*
    (?:(?P<scale>[0-9]{1,4})\s*(?:[×*⋅]\s*)?)?
    (?P<base>\([^()]*\)|\(\s*\([^()]*\)\s*\)|x)
    \s*\^\s*(?:2|\(\s*2\s*\))\s*
    (?P<height>[+-]\s*[0-9]{1,4})?
    """,
    re.VERBOSE | re.IGNORECASE,
)

_BASE = re.compile(r"x(?:\s*(?P<shift>[+-]\s*[0-9]{1,4}))?", re.IGNORECASE)


def parabola_points(statement: str) -> list[tuple[int, int]] | None:
    """Devuelve el vértice y dos puntos a cada lado para y = a(x-h)^2 + k."""
    if len(statement) > 8000:
        return None
    task = _PARABOLA_TASK.fullmatch(" ".join(statement.split()))
    if not task:
        return None
    formula = _VERTEX_FORM.fullmatch(task[1].replace("−", "-"))
    if not formula:
        return None

    # El lector puede envolver una base ya agrupada: (( x - 3 ))^(2).
    base = _BASE.fullmatch(formula["base"].strip("() "))
    if not base:
        return None
    scale = int(formula["scale"] or "1")
    if scale == 0:
        return None
    a = -scale if formula["direction"] == "-" else scale
    h = -int((base["shift"] or "0").replace(" ", ""))
    k = int((formula["height"] or "0").replace(" ", ""))
    return [(h + dx, k + a * dx**2) for dx in (0, -2, -1, 1, 2)]
