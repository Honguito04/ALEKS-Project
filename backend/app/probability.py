"""Probabilidad exacta para el enunciado completo observado de dos cajas.

No se deduce independencia de palabras sueltas: la plantilla exige elegir al
azar un artículo de cada caja. Las categorías se emparejan mediante un
vocabulario explícito, sin singularizar arbitrariamente sustantivos.
"""
import re
import unicodedata
from dataclasses import dataclass
from fractions import Fraction


@dataclass(frozen=True)
class IndependentBoxes:
    answer: str
    explanation: str


NOUNS = {
    "lapiz": "lapiz", "lapices": "lapiz",
    "boligrafo": "boligrafo", "boligrafos": "boligrafo",
    "marcador": "marcador", "marcadores": "marcador",
    "crayon": "crayon", "crayones": "crayon",
    "pluma": "pluma", "plumas": "pluma",
    "borrador": "borrador", "borradores": "borrador",
    "ficha": "ficha", "fichas": "ficha",
    "canica": "canica", "canicas": "canica",
}


def independent_boxes(statement: str) -> IndependentBoxes | None:
    if len(statement) > 8000:
        return None
    text = "".join(char for char in unicodedata.normalize("NFKD", statement).casefold()
                   if not unicodedata.combining(char))
    text = " ".join(text.split())
    number, noun = r"(0|[1-9]\d{0,4})", r"([a-z]{1,30})"
    match = re.fullmatch(
        rf"en una caja hay {number} {noun} y {number} {noun}\. "
        rf"en una segunda caja hay {number} {noun} y {number} {noun}\. "
        r"se elige al azar un articulo de cada una de las cajas\. "
        rf"¿?cual es la probabilidad de que de la primera caja se elija (?:un|una) {noun} "
        rf"y (?:que )?de la segunda caja se seleccione (?:un|una) {noun}\? "
        r"escribir la respuesta como una fraccion en forma reducida\.", text)
    if not match:
        return None
    groups = match.groups()
    counts = [int(groups[index]) for index in (0, 2, 4, 6)]
    names = [NOUNS.get(groups[index]) for index in (1, 3, 5, 7, 8, 9)]
    if any(name is None for name in names) or any(count > 10000 for count in counts):
        return None
    first, second = names[:2], names[2:4]
    if first[0] == first[1] or second[0] == second[1] or names[4] not in first or names[5] not in second:
        return None
    first_total, second_total = sum(counts[:2]), sum(counts[2:])
    if first_total == 0 or second_total == 0:
        return None
    first_count, second_count = counts[first.index(names[4])], counts[2 + second.index(names[5])]
    answer = Fraction(first_count, first_total) * Fraction(second_count, second_total)
    rendered = f"{answer.numerator}/{answer.denominator}"
    explanation = (f"En la primera caja hay {first_count} artículos favorables de {first_total}; "
                   f"en la segunda hay {second_count} de {second_total}. Se elige un artículo de cada caja: "
                   f"({first_count}/{first_total}) × ({second_count}/{second_total}) = {rendered}. "
                   "La fracción está reducida y no lleva unidad.")
    return IndependentBoxes(rendered, explanation)
