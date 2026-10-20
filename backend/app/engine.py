"""Gramática cerrada; nunca eval/sympify/parse_expr sobre texto no confiable."""
import ast
import multiprocessing as mp
import re
import sympy as s
from .models import Exercise, Solution

X = s.Symbol("x", real=True)


class Unsupported(ValueError):
    pass


def expression(text: str, variable: bool = False):
    if not text or len(text) > 240:
        raise Unsupported("Expresión vacía o demasiado larga")
    text = text.replace("^", "**")
    try:
        root = ast.parse(text, mode="eval")
    except (SyntaxError, ValueError, RecursionError) as e:
        raise Unsupported("Expresión matemática no admitida") from e
    if sum(1 for _ in ast.walk(root)) > 80:
        raise Unsupported("Expresión demasiado compleja")

    def visit(node):
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            token = ast.get_source_segment(text, node)
            if len(token) > 20 or abs(node.value) > 1_000_000 or not re.fullmatch(r"(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)", token):
                raise Unsupported("Número fuera de límites")
            return s.Rational(token)
        if isinstance(node, ast.Name) and node.id == "x" and variable:
            return X
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            v = visit(node.operand)
            return -v if isinstance(node.op, ast.USub) else v
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "sqrt" and len(node.args) == 1 and not node.keywords:
            v = visit(node.args[0])
            if v.free_symbols or v < 0:
                raise Unsupported("Solo raíces constantes reales")
            return s.sqrt(v)
        if isinstance(node, ast.BinOp):
            left, right = visit(node.left), visit(node.right)
            if isinstance(node.op, ast.Add): return s.Add(left, right, evaluate=False)
            if isinstance(node.op, ast.Sub): return s.Add(left, -right, evaluate=False)
            if isinstance(node.op, ast.Mult): return s.Mul(left, right, evaluate=False)
            if isinstance(node.op, ast.Div):
                if not right.free_symbols and s.simplify(right) == 0: raise Unsupported("Denominador nulo")
                return s.Mul(left, s.Pow(right, -1, evaluate=False), evaluate=False)
            if isinstance(node.op, ast.Pow):
                if right.free_symbols or right.is_Integer is not True or abs(right) > 8:
                    raise Unsupported("Exponente no admitido")
                if not left.free_symbols and s.simplify(left) == 0 and right <= 0: raise Unsupported("Potencia indefinida")
                return s.Pow(left, right, evaluate=False)
        raise Unsupported("Operación fuera de la gramática permitida")

    result = visit(root.body)
    inspected = s.simplify(result) if not result.free_symbols else result
    if inspected.has(s.zoo, s.nan, s.oo, -s.oo): raise Unsupported("Resultado indefinido")
    return result


def format_value(v, exercise: Exercise):
    if exercise.format == "exact": return s.sstr(s.simplify(v))
    places = exercise.decimal_places
    rounded = s.floor(s.Abs(v) * 10**places + s.Rational(1, 2))
    if rounded.is_Integer is not True: raise Unsupported("No se pudo verificar el redondeo exacto")
    number = int(rounded) * (-1 if v < 0 else 1)
    digits = str(abs(number)).zfill(places + 1)
    return ("-" if number < 0 else "") + (digits[:-places] + "." + digits[-places:] if places else digits)


def solve(exercise: Exercise) -> Solution:
    if exercise.ambiguities: raise Unsupported("Lectura ambigua: " + exercise.ambiguities[0])
    m = exercise.math
    if m is None: raise Unsupported("Se necesita interpretación del enunciado")
    values = []
    unit = exercise.units
    explanation = "Cálculo exacto y equivalencia simbólica comprobados."
    if m.family in ("arithmetic", "single_choice"):
        values = [s.simplify(expression(m.expression or ""))]
    elif m.family == "percentage":
        values = [s.simplify(expression(m.percent or "") * expression(m.base or "") / 100)]
    elif m.family == "proportion":
        a, b, c = [expression(t or "") for t in (m.a, m.b, m.c)]
        if s.simplify(a) == 0 or s.simplify(b) == 0: raise Unsupported("Proporción con denominador nulo")
        values = [s.simplify(b * c / a)]  # a / b = c / x
        if values[0] == 0 or s.simplify(a / b - c / values[0]) != 0:
            raise Unsupported("Proporción degenerada")
    elif m.family == "cylinder_volume":
        if m.height_is_perpendicular is not True:
            raise Unsupported("Falta confirmar la altura perpendicular; la longitud inclinada no basta")
        if m.radius_unit is None or m.radius_unit != m.height_unit:
            raise Unsupported("Radio y altura deben tener la misma unidad de longitud; no se convierten unidades")
        unit = m.radius_unit + "^3"
        if exercise.units != unit:
            raise Unsupported("El volumen requiere la unidad cúbica correspondiente al radio y la altura")
        if not m.pi_value:
            raise Unsupported("Falta el valor de pi indicado por el enunciado")
        radius, height, pi = [s.simplify(expression(v or "")) for v in (m.radius, m.height, m.pi_value)]
        if any(v.is_positive is not True for v in (radius, height, pi)):
            raise Unsupported("Radio, altura perpendicular y valor de pi deben ser positivos")
        volume = s.simplify(pi * radius**2 * height)
        # Contraste con área de la base por altura, manteniendo valores exactos.
        base_area = s.simplify(pi * radius * radius)
        if s.simplify(volume / height - base_area) != 0:
            raise Unsupported("No se pudo verificar el volumen")
        values = [volume]
        explanation = (
            f"V = pi × r² × h = {s.sstr(pi)} × ({s.sstr(radius)})² × {s.sstr(height)} "
            f"= {s.sstr(volume)} {unit}. Se usa la altura perpendicular y se redondea solo al final."
        )
    else:
        lhs, rhs = expression(m.lhs or "", True), expression(m.rhs or "", True)
        numerator, _ = s.fraction(s.together(lhs - rhs))
        try: poly = s.Poly(numerator, X)
        except s.PolynomialError as e: raise Unsupported("Ecuación no polinómica") from e
        expected = 1 if m.family == "linear" else 2
        if poly.degree() != expected: raise Unsupported("El grado no coincide con la familia")
        candidates = s.solve(poly.as_expr(), X)
        for candidate in candidates:
            # Sustituir en las expresiones originales conserva los polos excluidos.
            l, r = lhs.subs(X, candidate), rhs.subs(X, candidate)
            if l.has(s.zoo, s.nan, s.oo, -s.oo) or r.has(s.zoo, s.nan, s.oo, -s.oo): continue
            if candidate.is_real is not True: continue
            if s.simplify(l - r) == 0: values.append(s.simplify(candidate))
        explanation = "Raíces comprobadas por sustitución en ambos miembros; se excluyen denominadores nulos."
    if exercise.domain == "integer": values = [v for v in values if v.is_integer is True]
    if exercise.domain == "rational": values = [v for v in values if v.is_rational is True]
    values = sorted(set(values), key=lambda v: float(v))
    if any(v.is_real is not True or v.has(s.zoo, s.nan, s.oo, -s.oo) for v in values):
        raise Unsupported("Resultado fuera del dominio real")
    if not values: raise Unsupported("Sin soluciones en el dominio; el campo de conjunto vacío aún no es compatible")
    if exercise.choices:
        if m.family != "single_choice" or len(values) != 1: raise Unsupported("Selección incompatible")
        matches = [c.id for c in exercise.choices if s.simplify(expression(c.expression) - values[0]) == 0]
        if len(matches) != 1: raise Unsupported("Ninguna alternativa única verificable")
        answer = matches[0]
    else:
        if m.family == "single_choice": raise Unsupported("Faltan alternativas")
        answer = "; ".join(format_value(v, exercise) for v in values)
    return Solution(status="verified", answer=answer, values=[s.sstr(v) for v in values], explanation=explanation, unit=unit)


def _worker(payload, connection):
    try:
        try:
            import resource
            resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
            resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
        except ImportError:
            pass  # Windows: el padre conserva el límite temporal y termina el proceso.
        connection.send((True, solve(Exercise.model_validate(payload)).model_dump()))
    except Exception as e:
        connection.send((False, str(e)[:300]))
    finally:
        connection.close()


def bounded_solve(exercise: Exercise, timeout: float = 3.0) -> Solution:
    ctx = mp.get_context("spawn")
    parent, child = ctx.Pipe(duplex=False)
    process = ctx.Process(target=_worker, args=(exercise.model_dump(), child), daemon=True)
    process.start()
    child.close()
    try:
        if not parent.poll(timeout): raise Unsupported("El cálculo superó el límite de tiempo")
        try: ok, result = parent.recv()
        except EOFError: raise Unsupported("El cálculo excedió sus recursos o se interrumpió") from None
        if not ok: raise Unsupported(result)
        return Solution.model_validate(result)
    finally:
        if process.is_alive(): process.terminate()
        process.join(timeout=1)
        if process.is_alive(): process.kill(); process.join()
        parent.close()
