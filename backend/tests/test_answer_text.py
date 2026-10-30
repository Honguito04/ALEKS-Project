import pytest

from app.answer_text import normalize_numeric_answer
from app.local_assistant import AssistAnswer, AssistProposal, AssistResult


@pytest.mark.parametrize(("raw", "expected"), [
    ("15/64", "15/64"), (" 15 / 64 ", "15/64"), ("30/128", "15/64"),
    ("015/064", "15/64"), ("15⁄64", "15/64"), ("15∕64", "15/64"),
    ("15\u00a0/\u00a064", "15/64"), (r"\frac{15}{64}", "15/64"),
    (r"$\frac{30}{128}$", "15/64"), (r"\(\dfrac { 15 } { 64 }\)", "15/64"),
    (r"\[\tfrac{15}{64}\]", "15/64"), (r"\(15/64\)", "15/64"),
    (" 00012 ", "12"), ("$12$", "12"), ("0/20", "0/1"),
    ("20/20", "1/1"), ("20/2", "10/1"), ("999999999999/3", "333333333333/1"),
])
def test_complete_numeric_representation_is_exact_and_idempotent(raw, expected):
    assert normalize_numeric_answer(raw) == expected
    assert normalize_numeric_answer(expected) == expected


@pytest.mark.parametrize("raw", [
    "La respuesta es 15/64", "15/64 = 0.234375", "15/64 cm", "15/64%", "15/0",
    "-15/64", "15/-64", "0.234375", "(3/8)*(5/8)", "1 5/64", "15/6 4",
    "15²/64", "¹⁵/₆₄", "１５/６４", "15\u200b/64", "15\u202e/64",
    "1234567890123/1234567890123", "0000000000015/64", "9999999999999",
    r"\frac{1+14}{64}", r"\frac{-15}{64}", r"\frac{15}{64}x", r"\frac{15}{0}",
    r"$\frac{15}{64}", "$$15/64$$", "`15/64`", "[15/64]", "15/64; alert(1)",
    r"\frac{15}{64}\frac{1}{2}", "", " ",
])
def test_unsupported_or_ambiguous_representation_stays_available_for_diagnosis(raw):
    assert normalize_numeric_answer(raw) == raw


def test_normalization_does_not_grant_mathematical_verification_or_drop_units():
    answer = AssistAnswer(field_key="answer", value=r"$\frac{30}{128}$", unit=" cm² ")
    result = AssistResult(fingerprint="a" * 64, model="qwen3-vl:4b", provider_calls=1,
        proposal=AssistProposal(status="proposed", answers=[answer], explanation="Candidato del modelo.", missing_information=[]))
    assert result.proposal.answers[0].value == "15/64"
    assert result.proposal.answers[0].unit == "cm²"
    assert result.verified is False
    assert result.verification == "none"
    assert result.provider == "ollama"


def test_only_whitespace_is_removed_from_empty_unit():
    answer = AssistAnswer(field_key="answer", value="15 / 64", unit=" \t ")
    assert answer.unit == ""
    assert answer.value == "15/64"
