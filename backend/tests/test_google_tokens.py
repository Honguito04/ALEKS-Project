"""Firmas RSA reales con certificados locales; sin simular la validación criptográfica."""
import json
import time
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from google.auth import crypt, jwt
from app.auth import verified_identity
from app.config import settings


@pytest.fixture
def signed(monkeypatch):
    import app.auth as auth
    key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    pem=key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption())
    public=key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    class Response:
        status=200
        data=json.dumps({"test-key":public}).encode()
    monkeypatch.setattr(auth,"Request",lambda:lambda *args,**kwargs:Response())
    monkeypatch.setattr(settings,"google_client_id","audience")
    def sign(**updates):
        claims={"iss":"https://accounts.google.com","aud":"audience","sub":"stable-sub","nonce":"expected","iat":int(time.time())-10,"exp":int(time.time())+60,**updates}
        return jwt.encode(crypt.RSASigner.from_string(pem,key_id="test-key"),claims).decode()
    return sign


def test_valid_signature(signed):
    assert verified_identity(signed(),"expected")=="google:stable-sub"


@pytest.mark.parametrize("updates", [{"iss":"https://evil.example"},{"aud":"other-client"},{"exp":1},{"nonce":"wrong"},{"sub":""}])
def test_reject_claims(signed,updates):
    with pytest.raises(Exception): verified_identity(signed(**updates),"expected")


def test_reject_tampered_signature(signed):
    token=signed();parts=token.split('.');parts[2]=('a' if parts[2][0]!='a' else 'b')+parts[2][1:]
    with pytest.raises(Exception): verified_identity('.'.join(parts),"expected")
