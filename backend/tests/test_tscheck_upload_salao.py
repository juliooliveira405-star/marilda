"""Alimentador Salao uploads only faturamento.

Switches the alimentador test account to sector Salao (sanctioned temp switch), asserts
/me.perms.upload_kinds == ['faturamento'], a 'compras' upload is rejected (403), and restores
the account to Estoque even if an assertion fails.
"""

import io

import pytest


def _alimentador_id(gerente_client):
    users = gerente_client.get("/users").json()["users"]
    return next(u for u in users if u["email"] == "alimentador+clerk_test@madrila.com")["user_id"]


@pytest.fixture
def alimentador_as_salao(gerente_client, alimentador_client):
    uid = _alimentador_id(gerente_client)
    r = gerente_client.patch(f"/users/{uid}/role", json={"role": "alimentador", "sector": "Salão"})
    assert r.status_code == 200, r.text
    try:
        yield alimentador_client
    finally:
        r2 = gerente_client.patch(f"/users/{uid}/role", json={"role": "alimentador", "sector": "Estoque"})
        assert r2.status_code == 200, r2.text


def test_me_perms_upload_kinds_faturamento_only(alimentador_as_salao):
    r = alimentador_as_salao.get("/me")
    assert r.status_code == 200, r.text
    assert r.json()["perms"]["upload_kinds"] == ["faturamento"], r.json()["perms"]


def test_upload_compras_forbidden_for_salao(alimentador_as_salao):
    files = {"file": ("tscheck.csv", io.BytesIO(b"a,b\n1,2\n"), "text/csv")}
    r = alimentador_as_salao.post("/uploads", data={"kind": "compras"}, files=files)
    assert r.status_code == 403, r.text
