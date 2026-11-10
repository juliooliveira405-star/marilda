"""SEC-003: only Estoque applies counts; counting limited to own sectors."""


def test_apply_counts_forbidden_for_chefe_cozinha(chefe_client):
    r = chefe_client.post("/counts/2026-01/apply")
    assert r.status_code == 403, r.text


def test_counts_outside_op_sector_forbidden_for_chefe(chefe_client):
    # chefe Cozinha op_sectors = Cozinha + Quiosque -> Bar must be rejected
    r = chefe_client.post("/counts", json={
        "month": "2026-01", "item": "TSCHECK-SEC003", "descricao": "tscheck sec003 item", "um": "UN",
        "qty": 1, "sector": "Bar",
    })
    assert r.status_code == 403, r.text


def test_counts_within_op_sector_allowed_for_chefe(chefe_client):
    r = chefe_client.post("/counts", json={
        "month": "2026-01", "item": "TSCHECK-SEC003", "descricao": "tscheck sec003 item", "um": "UN",
        "qty": 1, "sector": "Cozinha",
    })
    assert r.status_code == 200, r.text
