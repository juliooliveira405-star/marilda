"""Chefe Cozinha sees CMV only of Cozinha + Quiosque + iFood (read)."""


def test_chefe_cmv_cozinha_and_quiosque_ok(chefe_client):
    for sector in ("Cozinha", "Quiosque"):
        r = chefe_client.get("/cmv/sector", params={"sector": sector})
        assert r.status_code == 200, f"{sector}: {r.text}"


def test_chefe_cmv_bar_forbidden(chefe_client):
    r = chefe_client.get("/cmv/sector", params={"sector": "Bar"})
    assert r.status_code == 403, r.text


def test_chefe_ifood_summary_ok_but_config_forbidden(chefe_client):
    r = chefe_client.get("/ifood/summary")
    assert r.status_code == 200, r.text
    r2 = chefe_client.get("/ifood/config")
    assert r2.status_code == 403, r2.text


def test_chefe_users_forbidden(chefe_client):
    r = chefe_client.get("/users")
    assert r.status_code == 403, r.text
