"""Reconocimiento acotado de un reparto de premios por puestos distintos.

Se exige el enunciado completo: no se deducen restricciones de palabras sueltas
ni se interpreta el texto del modelo como evidencia del problema.
"""
import math
import re
import unicodedata
from dataclasses import dataclass


@dataclass(frozen=True)
class OrderedPrizes:
    participants: int
    prizes: int
    answer: str
    explanation: str


def ordered_prizes(statement: str) -> OrderedPrizes | None:
    text = "".join(char for char in unicodedata.normalize("NFKD", statement).casefold()
                   if not unicodedata.combining(char))
    text = " ".join(text.split())
    match = re.fullmatch(
        r"hay ([1-9]\d{0,3}) (?:nadadores|corredores|atletas|participantes|concursantes|jugadores|equipos|estudiantes|personas) "
        r"en (?:una|un|la|el) (?:carrera|competencia|concurso|torneo)\. "
        r"hay premios para ([a-z ,]{1,180})\. "
        r"¿?de cuantas maneras distintas se pueden otorgar los ([1-5]) premios\?", text)
    if not match:
        return None
    participants, ranks, prizes = int(match[1]), match[2], int(match[3])
    if participants > 1000:
        return None
    names = {"primer": 1, "primero": 1, "segundo": 2, "tercer": 3, "tercero": 3, "cuarto": 4, "quinto": 5}
    positions = []
    for rank in re.split(r",\s*(?:y\s+)?|\s+y\s+", ranks):
        position = re.fullmatch(r"(?:un|el) (primer|primero|segundo|tercer|tercero|cuarto|quinto) lugar", rank)
        if not position:
            return None
        positions.append(names[position[1]])
    if positions != list(range(1, prizes + 1)):
        return None
    answer = str(math.perm(participants, prizes))
    if participants < prizes:
        explanation = f"Hay {participants} participantes y {prizes} puestos distintos. No hay suficientes participantes para ocuparlos sin repetir: 0 maneras."
    else:
        factors = " × ".join(str(participants - index) for index in range(prizes))
        explanation = (f"Los {prizes} premios corresponden a puestos distintos: el orden importa y un participante no ocupa dos puestos. "
                       f"Las opciones se reducen una por cada premio: {factors} = {answer} maneras. "
                       "Elegir solo el grupo de ganadores con combinaciones no distingue quién recibe cada puesto.")
    return OrderedPrizes(participants, prizes, answer, explanation)
