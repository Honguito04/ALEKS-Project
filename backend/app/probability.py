"""Probabilidad exacta para plantillas completas de cajas, ruletas y dados.

No se deduce independencia de palabras sueltas: las plantillas exigen elegir
al azar un artículo de cada caja o girar dos veces la misma ruleta con sectores
iguales. Las categorías se emparejan mediante vocabularios explícitos.
"""
import re
import unicodedata
from dataclasses import dataclass
from fractions import Fraction
from itertools import product
from operator import eq, ge, gt, le, lt


@dataclass(frozen=True)
class IndependentBoxes:
    answer: str
    explanation: str


@dataclass(frozen=True)
class IndependentSpins:
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


def _normalize_statement(statement: str) -> str:
    # Quitar tildes no debe convertir exponentes o símbolos de compatibilidad
    # en dígitos ordinarios: eso cambiaría las cantidades del enunciado.
    text = "".join(char for char in unicodedata.normalize("NFD", statement).casefold()
                   if not unicodedata.combining(char))
    text = " ".join(text.split())
    # Saltos y espacios de los fragmentos DOM no alteran los datos. Solo
    # normalizar separadores de frases; no borrar condiciones ni palabras.
    text = re.sub(r"\s+([.?!,])", r"\1", text)
    text = re.sub(r"([.?!])(?=[a-z¿])", r"\1 ", text)
    return re.sub(r"¿\s+", "¿", text)


def independent_boxes(statement: str) -> IndependentBoxes | None:
    if len(statement) > 8000:
        return None
    text = _normalize_statement(statement)
    number, noun = r"(0|[1-9]\d{0,4})", r"([a-z]{1,30})"
    match = re.fullmatch(
        rf"en (?:una|la primera) caja hay {number} {noun} y {number} {noun}\. "
        rf"en (?:una segunda|la segunda|otra) caja hay {number} {noun} y {number} {noun}\. "
        r"se (?:elige|selecciona) al azar un articulo de cada (?:una de las cajas|caja)\. "
        rf"¿?cual es la probabilidad de que de la primera caja se (?:elija|seleccione) (?:un|una) {noun} "
        rf"y (?:que )?de la segunda caja se (?:seleccione|elija) (?:un|una) {noun}\? "
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


# Etiquetas de color explícitas: no se deduce equivalencia de palabras libres.
COLORS = {
    "gris": "gris", "grises": "gris",
    "azul": "azul", "azules": "azul",
    "verde": "verde", "verdes": "verde",
    "rojo": "rojo", "roja": "rojo", "rojos": "rojo", "rojas": "rojo",
    "amarillo": "amarillo", "amarilla": "amarillo", "amarillos": "amarillo", "amarillas": "amarillo",
    "negro": "negro", "negra": "negro", "negros": "negro", "negras": "negro",
    "blanco": "blanco", "blanca": "blanco", "blancos": "blanco", "blancas": "blanco",
    "morado": "morado", "morada": "morado", "morados": "morado", "moradas": "morado",
    "naranja": "naranja", "naranjas": "naranja",
    "violeta": "violeta", "violetas": "violeta",
    "rosa": "rosa", "rosas": "rosa",
    "cafe": "cafe", "cafes": "cafe",
    "marron": "marron", "marrones": "marron",
}


def independent_spins(statement: str) -> IndependentSpins | None:
    """Dos giros independientes de la misma ruleta, en el orden indicado.

    El enunciado completo exige secciones iguales y solo dos colores que
    cubran toda la ruleta. No calcula para dibujos, sesgos, condiciones extra
    ni una unión de sucesos que no esté descrita por esta plantilla.
    """
    if len(statement) > 8000:
        return None
    text = _normalize_statement(statement)
    number, color = r"(0|[1-9][0-9]{0,4})", r"([a-z]{1,20})"
    match = re.fullmatch(
        rf"una ruleta esta dividida en {number} secciones (?:de igual|del mismo) tamano, "
        rf"de las cuales {number} son de color {color} y {number} son de color {color}\. "
        r"la ruleta se gira (?:dos|2) veces\. "
        rf"¿?cual es la probabilidad de que en el primer giro la ruleta (?:pare|se detenga) en {color} "
        rf"y (?:que )?en el segundo giro la ruleta (?:pare|se detenga) en {color}\? "
        r"escribir la respuesta como una fraccion en forma reducida\.", text)
    if not match:
        return None
    total_text, first_text, first_color, second_text, second_color, requested_first, requested_second = match.groups()
    total, first_count, second_count = int(total_text), int(first_text), int(second_text)
    if not 0 < total <= 10000 or first_count + second_count != total:
        return None
    names = [COLORS.get(name) for name in (first_color, second_color, requested_first, requested_second)]
    if any(name is None for name in names) or names[0] == names[1]:
        return None
    counts = {names[0]: first_count, names[1]: second_count}
    if names[2] not in counts or names[3] not in counts:
        return None
    favorable_first, favorable_second = counts[names[2]], counts[names[3]]
    probability = Fraction(favorable_first, total) * Fraction(favorable_second, total)
    rendered = f"{probability.numerator}/{probability.denominator}"
    explanation = (f"La ruleta tiene {total} secciones de igual tamaño. Para el primer giro hay "
                   f"{favorable_first} secciones favorables de {total}; para el segundo, {favorable_second} "
                   f"de {total}. Los giros son independientes y los colores se piden en ese orden: "
                   f"({favorable_first}/{total}) × ({favorable_second}/{total}) = {rendered}. "
                   "La fracción está reducida y no lleva unidad.")
    return IndependentSpins(rendered, explanation)


_TWO_DICE_EVENTS = re.compile(
    r"un dado ordinario \(regular\) es un cubo con los numeros del 1 al 6 "
    r"en los lados \(representado por puntos pintados\)\. "
    r"imaginemos que tal dado sea lanzado dos veces en sucesion y que los valores "
    r"de las caras en los dos lances son sumados\. "
    r"esta suma se registra como el resultado de un unico ensayo de un experimento aleatorio\. "
    r"calcular la probabilidad de cada uno de los siguientes sucesos:\s*"
    r"suceso ([a-z]):\s*la suma ([^.]+)\. "
    r"suceso ([a-z]):\s*la suma ([^.]+)\. "
    r"escribir las respuestas como fracciones exactas\."
)

_SUM_COMPARISONS = {
    "mayor que": gt, "mayor o igual que": ge,
    "menor que": lt, "menor o igual que": le, "igual a": eq,
}


def _favorable_sums(condition: str) -> set[int] | None:
    sums = range(2, 13)
    comparison = re.fullmatch(r"es (mayor que|mayor o igual que|menor que|menor o igual que|igual a) ([0-9]{1,2})",
                              condition)
    if comparison:
        relation, limit = comparison.groups()
        return {total for total in sums if _SUM_COMPARISONS[relation](total, int(limit))}
    parity = re.fullmatch(r"es (?:un numero )?(par|impar)", condition)
    if parity:
        remainder = int(parity[1] == "impar")
        return {total for total in sums if total % 2 == remainder}
    divisibility = re.fullmatch(r"es divisible entre ([1-9][0-9]?)(?: o ([1-9][0-9]?)(?: \(o ambos\))?)?",
                                condition)
    if divisibility:
        divisors = [int(value) for value in divisibility.groups() if value is not None]
        return {total for total in sums if any(total % divisor == 0 for divisor in divisors)}
    return None


def two_dice_events(statement: str) -> dict[str, tuple[int, Fraction]] | None:
    """Cuenta cada par ordenado una vez por suceso, incluso si cumple dos divisores."""
    if len(statement) > 8000:
        return None
    match = _TWO_DICE_EVENTS.fullmatch(_normalize_statement(statement))
    if not match:
        return None
    first, first_condition, second, second_condition = match.groups()
    if first == second:
        return None
    results = {}
    for event, condition in ((first, first_condition), (second, second_condition)):
        sums = _favorable_sums(condition)
        if sums is None:
            return None
        count = sum(a + b in sums for a, b in product(range(1, 7), repeat=2))
        results[event] = (count, Fraction(count, 36))
    return results
