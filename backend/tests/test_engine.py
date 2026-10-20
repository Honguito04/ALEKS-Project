import pytest
from app.engine import solve, expression, Unsupported, bounded_solve
from app.simulator import PROBLEMS, ANSWERS


@pytest.mark.parametrize("expression,answer", [
    ("3/4+2/3", "17/12"), ("0.1+0.2", "3/10"), ("-2^2", "-4"),
    ("sqrt(8)/2", "sqrt(2)"), ("(12-3)*2", "18")
])
def test_exact_arithmetic(make_exercise, expression, answer):
    assert solve(make_exercise({"family": "arithmetic", "expression": expression})).answer == answer


@pytest.mark.parametrize("text", ["__import__('os').system('id')", "x.__class__", "[1][0]", "2**9999", "sqrt(-1)", "1/0", "(1-1)^-1", "x+1", "True", "9e99", "2**(2**8)"])
def test_reject_unsafe_or_unbounded_grammar(text):
    with pytest.raises((Unsupported, ValueError)): expression(text)


def test_all_original_simulator_answers(make_exercise):
    for problem in PROBLEMS:
        kwargs = {k: v for k, v in problem.items() if k in ("format", "decimal_places", "units", "choices")}
        if problem.get("choices"): kwargs["fields"] = [{"id": "answer", "kind": "radio"}]
        result = solve(make_exercise(problem["math"], **kwargs))
        assert result.status == "verified"
        assert result.answer.replace(" ", "") == ANSWERS[problem["id"]]


def test_multiple_roots_and_restricted_denominator(make_exercise):
    assert solve(make_exercise({"family": "quadratic", "lhs": "x^2-5*x+6", "rhs": "0"})).values == ["2", "3"]
    assert solve(make_exercise({"family": "quadratic", "lhs": "(x^2-1)/(x-1)", "rhs": "0"})).values == ["-1"]


def test_domain_and_rounding(make_exercise):
    with pytest.raises(Unsupported): solve(make_exercise({"family": "quadratic", "lhs": "x^2-2", "rhs": "0"}, domain="rational"))
    assert solve(make_exercise({"family": "arithmetic", "expression": "-1.005"}, format="decimal", decimal_places=2)).answer == "-1.01"
    close_to_half = "(1005-1/10^8/10^8/10^8/10^8/10^8/10^8)/1000"
    assert solve(make_exercise({"family": "arithmetic", "expression": close_to_half}, format="decimal", decimal_places=2)).answer == "1.00"


def test_ambiguous_duplicate_choices_and_wrong_degree(make_exercise):
    with pytest.raises(Unsupported): solve(make_exercise(ambiguities=["No se puede leer el denominador"]))
    with pytest.raises(Unsupported): solve(make_exercise({"family": "linear", "lhs": "x^2", "rhs": "1"}))
    with pytest.raises(Unsupported): solve(make_exercise({"family": "single_choice", "expression": "1/2"}, fields=[{"id":"answer","kind":"radio"}], choices=[{"id":"a","expression":"1/2"},{"id":"b","expression":"2/4"}]))


def test_process_boundary_and_timeout(make_exercise):
    assert bounded_solve(make_exercise()).answer == "2"
    with pytest.raises(Unsupported, match="tiempo"): bounded_solve(make_exercise(), timeout=0)
