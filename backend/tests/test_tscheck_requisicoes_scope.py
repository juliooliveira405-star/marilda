"""Requisicoes respect sector scope.

Uses the alimentador test account temporarily switched to sector Cozinha (per briefing's
sanctioned procedure), restoring to Estoque afterwards even if an assertion fails.
"""

import pytest


def _alimentador_id(gerente_client):
    users = gerente_client.get("/users").json()["users"]
    return next(u for u in users if u["email"] == "alimentador+clerk_test@madrila.com")["user_id"]


@pytest.fixture
def alimentador_as_cozinha(gerente_client, alimentador_client):
    uid = _alimentador_id(gerente_client)
    r = gerente_client.patch(f"/users/{uid}/role", json={"role": "alimentador", "sector": "Cozinha"})
    assert r.status_code == 200, r.text
    try:
        yield alimentador_client
    finally:
        r2 = gerente_client.patch(f"/users/{uid}/role", json={"role": "alimentador", "sector": "Estoque"})
        assert r2.status_code == 200, r2.text


def test_alimentador_cozinha_can_create_for_cozinha_or_quiosque(alimentador_as_cozinha, gerente_client):
    r = alimentador_as_cozinha.post("/requisitions", json={
        "sector": "Cozinha", "items": [{"item": "TSCHECK-REQ", "descricao": "tscheck req item", "um": "UN", "qty": 1}],
        "note": "tscheck-requisicoes-scope", "submit": False,
    })
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    # soft-delete the draft we created (only Gerente can excluir)
    d = gerente_client.post(f"/requisitions/{rid}/action", json={"action": "excluir", "comment": "tscheck cleanup"})
    assert d.status_code == 200, d.text


def test_alimentador_cozinha_cannot_create_for_bar(alimentador_as_cozinha):
    r = alimentador_as_cozinha.post("/requisitions", json={
        "sector": "Bar", "items": [{"item": "TSCHECK-REQ", "descricao": "tscheck req item", "um": "UN", "qty": 1}],
        "note": "tscheck-requisicoes-scope", "submit": False,
    })
    assert r.status_code == 403, r.text


def test_chefe_cozinha_list_only_cozinha_and_quiosque(chefe_client):
    r = chefe_client.get("/requisitions")
    assert r.status_code == 200, r.text
    rows = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    assert all(row["sector"] in ("Cozinha", "Quiosque") for row in rows), [row["sector"] for row in rows if row["sector"] not in ("Cozinha", "Quiosque")]
