"""SEC-001: no Alimentador ever sees unit cost / CMV."""


def test_items_search_custo_null_for_alimentador(alimentador_client):
    r = alimentador_client.get("/items", params={"q": "a"})
    assert r.status_code == 200, r.text
    items = r.json()
    assert len(items) > 0
    assert all(it.get("custo") is None for it in items), f"custo leaked: {[it for it in items if it.get('custo') is not None][:2]}"


def test_qr_resolve_custo_null_for_alimentador(alimentador_client):
    r = alimentador_client.post("/qr/resolve", json={"raw": "produto: arroz"})
    assert r.status_code == 200, r.text
    body = r.json()
    for s in body.get("suggestions", []):
        assert s.get("custo") is None, f"custo leaked in suggestion: {s}"


def test_dashboard_forbidden_for_alimentador(alimentador_client):
    r = alimentador_client.get("/dashboard")
    assert r.status_code == 403, r.text


def test_cmv_sector_forbidden_for_alimentador(alimentador_client):
    r = alimentador_client.get("/cmv/sector", params={"sector": "Cozinha"})
    assert r.status_code == 403, r.text
