"""Gerente Geral manages users: role/sector switch, temp substitution, self-delete guard,
non-gerente forbidden. Does NOT delete/restore the seeded alimentador/chefe accounts (real
accounts other checks depend on) -- only exercises role PATCH (switch sector then restore)
and the temp PUT/DELETE, both of which are idempotent and explicitly sanctioned for testing
in the briefing.
"""

def _alimentador_id(gerente_client):
    users = gerente_client.get("/users").json()["users"]
    return next(u for u in users if u["email"] == "alimentador+clerk_test@madrila.com")["user_id"]


def test_gerente_can_switch_alimentador_sector_and_restore(gerente_client):
    uid = _alimentador_id(gerente_client)
    r = gerente_client.patch(f"/users/{uid}/role", json={"role": "alimentador", "sector": "Cozinha"})
    assert r.status_code == 200, r.text
    assert r.json()["sector"] == "Cozinha"
    # restore
    r2 = gerente_client.patch(f"/users/{uid}/role", json={"role": "alimentador", "sector": "Estoque"})
    assert r2.status_code == 200, r2.text
    assert r2.json()["sector"] == "Estoque"


def test_temp_substitution_past_end_rejected_and_cleared(gerente_client):
    uid = _alimentador_id(gerente_client)
    r = gerente_client.put(f"/users/{uid}/temp", json={"role": "chefe", "sector": "Bar", "start": "2020-01-01", "end": "2020-01-02", "motivo": "tscheck"})
    assert r.status_code in (422, 400), r.text
    # ensure no stray temp substitution left behind
    r2 = gerente_client.delete(f"/users/{uid}/temp")
    assert r2.status_code == 200, r2.text


def test_non_gerente_forbidden_on_user_role_patch(chefe_client, gerente_client):
    uid = _alimentador_id(gerente_client)
    r = chefe_client.patch(f"/users/{uid}/role", json={"role": "alimentador", "sector": "Estoque"})
    assert r.status_code == 403, r.text


def test_gerente_cannot_delete_self(gerente_client):
    me = gerente_client.get("/me").json()
    r = gerente_client.delete(f"/users/{me['user_id']}")
    assert r.status_code == 409, r.text
