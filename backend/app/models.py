from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_max_length=500)


class MathSpec(Strict):
    family: Literal["arithmetic", "percentage", "proportion", "linear", "quadratic", "single_choice"]
    expression: str | None = None
    lhs: str | None = None
    rhs: str | None = None
    percent: str | None = None
    base: str | None = None
    a: str | None = None
    b: str | None = None
    c: str | None = None


class Choice(Strict):
    id: str = Field(min_length=1, max_length=40)
    expression: str = Field(min_length=1, max_length=240)


class AnswerField(Strict):
    id: str = Field(min_length=1, max_length=40)
    kind: Literal["text", "radio"]


class Exercise(Strict):
    source: Literal["simulator", "aleks"]
    activity_id: str = Field(min_length=1, max_length=80)
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    statement: str = Field(min_length=1, max_length=2000)
    math: MathSpec | None
    fields: list[AnswerField] = Field(min_length=1, max_length=1)
    choices: list[Choice] = Field(default_factory=list, max_length=12)
    domain: Literal["real", "rational", "integer"] = "real"
    units: str = Field(default="", max_length=30)
    format: Literal["exact", "decimal"] = "exact"
    decimal_places: int = Field(default=2, ge=0, le=8)
    evidence: list[str] = Field(min_length=1, max_length=10)
    ambiguities: list[str] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def coherent(self):
        if len({c.id for c in self.choices}) != len(self.choices):
            raise ValueError("Alternativas repetidas")
        radio = self.fields[0].kind == "radio"
        if radio != bool(self.choices):
            raise ValueError("No coincide el campo con las alternativas")
        return self


class SolveRequest(Strict):
    exercise: Exercise
    allow_ai: bool = False


class Solution(Strict):
    status: Literal["verified", "unverifiable"]
    answer: str
    values: list[str]
    explanation: str
    provider: Literal["deterministic", "openai"] = "deterministic"
    proposed_by_ai: bool = False
    provider_calls: int = 0


class AIProposal(Strict):
    math: MathSpec
    proposed_answer: str
    explanation: str
