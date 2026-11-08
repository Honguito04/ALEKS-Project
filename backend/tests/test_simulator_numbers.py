import pytest


@pytest.mark.parametrize('answer,accepted', [
    ('0.3', True), ('0.30', True), ('3/10', True), ('30/100', True),
    ('0.30000000000000004', False), ('0.2999999999', False), ('3/0', False),
    ('NaN', False), ('Infinity', False), ('3e-1', False), ('0.1+0.2', False),
])
def test_decimal_exercise_compares_exact_numbers(client, answer, accepted):
    body = {'problem_id': 'decimales', 'answer': answer, 'operation_id': 'decimal-check'}
    assert client.post('/api/simulator/grade', json=body).json()['accepted'] is accepted


def test_numeric_equivalence_preserves_units_format_and_idempotency(client):
    decimal = {'problem_id': 'decimales', 'answer': '0.3', 'operation_id': 'decimal-check'}
    assert client.post('/api/simulator/grade', json=decimal).json() == {'accepted': True, 'replayed': False}
    assert client.post('/api/simulator/grade', json=decimal).json() == {'accepted': True, 'replayed': True}
    assert client.post('/api/simulator/grade', json={**decimal, 'answer': '3/10'}).status_code == 409
    assert client.post('/api/simulator/grade', json={**decimal, 'operation_id': 'unit-check', 'unit': 'cm'}).json()['accepted'] is False
    rounded = {'problem_id': 'redondeo', 'answer': '67/100', 'operation_id': 'format-check'}
    assert client.post('/api/simulator/grade', json=rounded).json()['accepted'] is False
