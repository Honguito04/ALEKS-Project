"""Ejercicios originales. El oráculo de calificación no usa el motor de resolución."""
import time
import json
from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import Field
from .database import db
from .models import Strict

router = APIRouter(prefix="/api/simulator")
PROBLEMS = [
    {"id": "fracciones", "statement": "Calcula 3/4 + 2/3. Da una fracción exacta.", "math": {"family": "arithmetic", "expression": "3/4+2/3"}},
    {"id": "decimales", "statement": "Calcula 0.1 + 0.2. Da el valor exacto.", "math": {"family": "arithmetic", "expression": "0.1+0.2"}},
    {"id": "porcentaje", "statement": "¿Cuánto es el 15 % de 240 euros? Escribe solo el número; la unidad ya está indicada.", "units": "EUR", "math": {"family": "percentage", "percent": "15", "base": "240"}},
    {"id": "proporcion", "statement": "Resuelve la proporción 3/5 = 9/x.", "math": {"family": "proportion", "a": "3", "b": "5", "c": "9"}},
    {"id": "lineal", "statement": "Resuelve 3*x + 5 = 20.", "math": {"family": "linear", "lhs": "3*x+5", "rhs": "20"}},
    {"id": "cuadratica", "statement": "Resuelve x^2 - 5*x + 6 = 0 en los reales. Separa las soluciones con punto y coma.", "math": {"family": "quadratic", "lhs": "x^2-5*x+6", "rhs": "0"}},
    {"id": "restriccion", "statement": "Resuelve (x^2 - 1)/(x - 1) = 0, con x distinto de 1.", "math": {"family": "quadratic", "lhs": "(x^2-1)/(x-1)", "rhs": "0"}},
    {"id": "alternativa", "statement": "Selecciona el valor equivalente a 2/3 + 1/6.", "math": {"family": "single_choice", "expression": "2/3+1/6"}, "choices": [{"id": "a", "expression": "1/2"}, {"id": "b", "expression": "5/6"}, {"id": "c", "expression": "1"}]},
    {"id": "redondeo", "statement": "Calcula 2/3 y redondea a dos decimales.", "format": "decimal", "decimal_places": 2, "math": {"family": "arithmetic", "expression": "2/3"}},
    {"id": "raices", "statement": "Resuelve x^2 - 2 = 0 en los reales. Separa las soluciones con punto y coma.", "math": {"family": "quadratic", "lhs": "x^2-2", "rhs": "0"}},
]
CYLINDER_PROBLEMS = [
    {"id": "cilindro-cm", "statement": "Un cilindro oblicuo tiene radio de 3 cm y altura perpendicular de 10 cm. Calcula su volumen usando pi = 3,14. Redondea al entero más cercano y selecciona la unidad cúbica.",
     "math": {"family": "cylinder_volume", "radius": "3", "height": "10", "pi_value": "3.14", "radius_unit": "cm", "height_unit": "cm", "height_is_perpendicular": True},
     "units": "cm^3", "format": "decimal", "decimal_places": 0},
    {"id": "cilindro-m", "statement": "Un depósito cilíndrico tiene radio de 1,5 m y altura perpendicular de 8 m. Usa pi = 3,14 y expresa su volumen al entero más cercano, con su unidad cúbica.",
     "math": {"family": "cylinder_volume", "radius": "1.5", "height": "8", "pi_value": "3.14", "radius_unit": "m", "height_unit": "m", "height_is_perpendicular": True},
     "units": "m^3", "format": "decimal", "decimal_places": 0},
]
# Conjunto de respuestas canónicas del simulador, independiente de SymPy.
ANSWERS = {"fracciones": "17/12", "decimales": "3/10", "porcentaje": "36", "proporcion": "15", "lineal": "5",
           "cuadratica": "2;3", "restriccion": "-1", "alternativa": "b", "redondeo": "0.67", "raices": "-sqrt(2);sqrt(2)",
           "cilindro-cm": "283", "cilindro-m": "57"}
ANSWER_UNITS = {"cilindro-cm": "cm^3", "cilindro-m": "m^3"}


@router.get("/problems")
def problems(activity: Literal["basic", "cylinder"] = "basic"):
    return CYLINDER_PROBLEMS if activity == "cylinder" else PROBLEMS


class Grade(Strict):
    problem_id: str = Field(max_length=40)
    answer: str = Field(max_length=200)
    operation_id: str = Field(min_length=1, max_length=180)
    unit: str = Field(default="", max_length=30)


@router.post("/grade")
def grade(body: Grade):
    if body.problem_id not in ANSWERS: raise HTTPException(404, "Ejercicio inexistente")
    with db() as conn:
        conn.execute("DELETE FROM grades WHERE created < ?", (time.time() - 86400,))
        accepted = body.answer.replace(" ", "") == ANSWERS[body.problem_id] and body.unit == ANSWER_UNITS.get(body.problem_id, "")
        # La clave de idempotencia también cubre cambios de unidad. No requiere migración.
        stored_answer = json.dumps([body.answer, body.unit], ensure_ascii=True, separators=(",", ":"))
        inserted = conn.execute("INSERT OR IGNORE INTO grades VALUES(?,?,?,?,?)", (body.operation_id, body.problem_id, stored_answer, int(accepted), time.time())).rowcount
        row = conn.execute("SELECT * FROM grades WHERE operation=?", (body.operation_id,)).fetchone()
        if row["problem"] != body.problem_id or row["answer"] != stored_answer:
            raise HTTPException(409, "Operación ya utilizada con otra respuesta")
    return {"accepted": bool(row["accepted"]), "replayed": not bool(inserted)}
