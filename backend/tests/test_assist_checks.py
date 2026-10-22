import pytest
from app.assist_checks import check_calculations
from app.engine import expression, Unsupported


@pytest.mark.parametrize("formula,answer,places,expected", [
    ("13*15*8 - 8*(15-7-7)*8", "1496", None, "consistent"),
    ("13*7*8 + 13*7*8 + (13-8)*(15-7-7)*8", "1496", None, "consistent"),
    ("8*7*13", "180", None, "mismatch"),
    ("13*15*8", "1496", None, "mismatch"),
    ("(3/5)*(2/7)", "6/35", None, "consistent"),
    ("(160/360)*2*pi*3", "8π/3", None, "consistent"),
    ("sqrt(2)", "1.41", 2, "consistent"),
    ("-1.005", "-1.01", 2, "consistent"),
    ("1.005", "1.00", 2, "mismatch"),
    ("1/0", "0", None, "unsupported"),
    ("2**1000", "0", None, "unsupported"),
    ("x+1", "2", None, "unsupported"),
    ("__import__('os').system('PRIVATE')", "0", None, "unsupported"),
])
def test_numeric_checks_are_exact_bounded_and_separate_from_geometry(formula, answer, places, expected):
    assert check_calculations([{"expression": formula, "answer": answer, "decimal_places": places}]) == expected


def test_timeout_and_missing_checks_never_count_as_consistency():
    assert check_calculations([]) == "unsupported"
    assert check_calculations([{"expression": "1+1", "answer": "2", "decimal_places": None}], timeout=0) == "timeout"


def test_pi_is_opt_in_and_does_not_broaden_the_original_solver_grammar():
    with pytest.raises(Unsupported): expression("pi")
