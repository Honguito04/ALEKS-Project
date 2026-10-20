import pytest
from app.engine import solve, Unsupported
from app.simulator import CYLINDER_PROBLEMS, ANSWERS, ANSWER_UNITS


def cylinder(make_exercise, **updates):
    math = {"family": "cylinder_volume", "radius": "2", "height": "18", "pi_value": "3.14",
            "radius_unit": "cm", "height_unit": "cm", "height_is_perpendicular": True, **updates}
    return make_exercise(math, units="cm^3", fields=[{"id": "answer", "kind": "quantity"}],
                         format="decimal", decimal_places=0)


def test_supplied_dimensions_exact_then_round(make_exercise):
    result = solve(cylinder(make_exercise))
    assert result.values == ["5652/25"]  # 226,08 sin redondeo intermedio
    assert result.answer == "226" and result.unit == "cm^3"
    assert "altura perpendicular" in result.explanation


def test_original_cylinder_simulator_answers(make_exercise):
    for p in CYLINDER_PROBLEMS:
        exercise = make_exercise(p["math"], units=p["units"], format=p["format"], decimal_places=p["decimal_places"],
                                 fields=[{"id": "answer", "kind": "quantity"}])
        result = solve(exercise)
        assert result.answer == ANSWERS[p["id"]] and result.unit == ANSWER_UNITS[p["id"]]


@pytest.mark.parametrize("updates", [
    {"height_is_perpendicular": False}, {"height_is_perpendicular": None},
    {"height_unit": "m"}, {"radius_unit": None}, {"pi_value": None},
    {"radius": "-2"}, {"radius": "0"}, {"height": "0"}, {"pi_value": "-3.14"},
])
def test_reject_incomplete_or_invalid_dimensions(make_exercise, updates):
    with pytest.raises(Unsupported): solve(cylinder(make_exercise, **updates))


def test_reject_area_or_missing_unit_and_ambiguity(make_exercise):
    for unit in ("cm", "cm^2", "", "m^3"):
        data = cylinder(make_exercise).model_copy(update={"units": unit})
        with pytest.raises(Unsupported): solve(data)
    with pytest.raises(Unsupported):
        solve(cylinder(make_exercise).model_copy(update={"ambiguities": ["No se distingue altura de longitud inclinada"]}))


def test_api_solution_and_real_platform_still_blocked(client, demo_headers, make_exercise):
    data = cylinder(make_exercise).model_dump()
    result = client.post("/solve", json={"exercise": data}, headers=demo_headers)
    assert result.status_code == 200 and result.json()["answer"] == "226" and result.json()["unit"] == "cm^3"
    data["source"] = "aleks"
    assert client.post("/solve", json={"exercise": data}, headers=demo_headers).status_code == 409


def test_grade_requires_unit_and_includes_it_in_idempotency(client):
    base = {"problem_id": "cilindro-cm", "answer": "283", "operation_id": "volume:1"}
    assert client.post("/api/simulator/grade", json=base).json()["accepted"] is False
    assert client.post("/api/simulator/grade", json={**base, "unit": "cm^3"}).status_code == 409
    correct = {**base, "unit": "cm^3", "operation_id": "volume:2"}
    assert client.post("/api/simulator/grade", json=correct).json() == {"accepted": True, "replayed": False}
    assert client.post("/api/simulator/grade", json=correct).json() == {"accepted": True, "replayed": True}
    collision = {**correct, "answer": '["283","cm^3"]', "unit": ""}
    assert client.post("/api/simulator/grade", json=collision).status_code == 409
    wrong = {**base, "unit": "m^3", "operation_id": "volume:3"}
    assert client.post("/api/simulator/grade", json=wrong).json()["accepted"] is False
