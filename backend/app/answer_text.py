"""Representación canónica de respuestas numéricas completas, sin evaluar prosa."""
import re
from fractions import Fraction


def normalize_numeric_answer(value: str) -> str:
    """Reduce fracciones equivalentes sin acreditar que resuelvan el ejercicio.

    El límite se aplica antes de convertir los componentes. No se extrae una
    respuesta de una explicación, ni se transforman decimales, unidades,
    superíndices o expresiones algebraicas en teclas para el editor.
    """
    text = value.strip()
    for start, end in (("$", "$"), (r"\(", r"\)"), (r"\[", r"\]")):
        if text.startswith(start) and text.endswith(end) and len(text) >= len(start) + len(end):
            text = text[len(start):-len(end)].strip()
            break
    if re.fullmatch(r"[0-9]{1,12}", text):
        return str(int(text))
    fraction = re.fullmatch(r"([0-9]{1,12})\s*[/⁄∕]\s*([0-9]{1,12})", text)
    if fraction is None:
        fraction = re.fullmatch(r"\\(?:frac|dfrac|tfrac)\s*\{\s*([0-9]{1,12})\s*\}\s*\{\s*([0-9]{1,12})\s*\}", text)
    if fraction is None or int(fraction[2]) == 0:
        return value
    reduced = Fraction(int(fraction[1]), int(fraction[2]))
    return f"{reduced.numerator}/{reduced.denominator}"
