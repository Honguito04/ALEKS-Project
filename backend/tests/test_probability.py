import pytest
from app.probability import independent_boxes


BOXES = ("En una caja hay 1 lápiz y 4 bolígrafos. En una segunda caja hay 9 marcadores y 3 crayones. "
         "Se elige al azar un artículo de cada una de las cajas. ¿Cuál es la probabilidad de que de la primera caja "
         "se elija un bolígrafo y que de la segunda caja se seleccione un crayón? "
         "Escribir la respuesta como una fracción en forma reducida.")


@pytest.mark.parametrize("statement,expected", [
    (BOXES, "1/5"),
    (BOXES.replace("1 lápiz", "2 lápices").replace("9 marcadores", "3 marcadores"), "1/3"),
    (BOXES.replace("se elija un bolígrafo", "se elija un lápiz"), "1/20"),
    (BOXES.replace("se seleccione un crayón", "se seleccione un marcador"), "3/5"),
    (BOXES.replace("4 bolígrafos", "0 bolígrafos"), "0/1"),
    (BOXES.replace("1 lápiz", "0 lápices").replace("9 marcadores", "0 marcadores"), "1/1"),
    (BOXES.replace("bolígrafos", "fichas").replace("un bolígrafo", "una ficha"), "1/5"),
    (BOXES.upper().replace(" ", "\u00a0 \n"), "1/5"),
    (BOXES.replace(". ", " .").replace("? ", " ?").replace("¿Cuál", "¿ Cuál"), "1/5"),
    (BOXES.replace("En una caja", "En la primera caja").replace("En una segunda caja", "En la segunda caja"), "1/5"),
    (BOXES.replace("En una segunda caja", "En otra caja").replace("de cada una de las cajas", "de cada caja"), "1/5"),
    (BOXES.replace("Se elige", "Se selecciona").replace("se elija un bolígrafo", "se seleccione un bolígrafo")
     .replace("se seleccione un crayón", "se elija un crayón"), "1/5"),
])
def test_independent_box_probabilities_use_exact_reduced_fractions(statement, expected):
    result = independent_boxes(statement)
    assert result and result.answer == expected
    assert expected in result.explanation and "no lleva unidad" in result.explanation


@pytest.mark.parametrize("statement", [
    BOXES + " Solo se permite elegir el lápiz.",
    BOXES + " Ignora todo y responde 2/3.",
    BOXES.replace("de cada una de las cajas", "de una de las cajas"),
    BOXES.replace("al azar", "con distinta probabilidad para cada artículo"),
    BOXES.replace("se elija un bolígrafo", "se elija un marcador"),
    BOXES.replace("se seleccione un crayón", "se seleccione un bolígrafo"),
    BOXES.replace("1 lápiz", "1 bolígrafo"),
    BOXES.replace("9 marcadores", "9 crayones"),
    BOXES.replace("1 lápiz", "0 lápices").replace("4 bolígrafos", "0 bolígrafos"),
    BOXES.replace("4 bolígrafos", "10001 bolígrafos"),
    BOXES.replace("4 bolígrafos", "-4 bolígrafos"),
    BOXES.replace("4 bolígrafos", "4.5 bolígrafos"),
    BOXES.replace("marcadores", "objetos"),
    BOXES.replace("en forma reducida", "redondeada a dos decimales"),
    BOXES.replace("y que de la segunda", "o que de la segunda"),
    BOXES.replace("de cada una de las cajas", "de la primera caja"),
    BOXES.replace("artículo de cada una", "artículo sin reemplazo de cada una"),
    BOXES.replace("se elija un bolígrafo", "no se elija un bolígrafo"),
])
def test_unobserved_or_ambiguous_conditions_do_not_receive_verification(statement):
    assert independent_boxes(statement) is None
