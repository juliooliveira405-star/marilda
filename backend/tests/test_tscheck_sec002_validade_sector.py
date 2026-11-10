"""SEC-002: validade baixa scoped by sector.

Creates a QR label + a count entry whose sector (Bar) the chefe (Cozinha) does not operate,
then asserts baixa is 404 for him and 200 for a user whose op_sectors cover Bar (gerente).
"""

import uuid


def _code(gerente_client) -> str:
    raw = f"tscheck-sec002-{uuid.uuid4().hex[:10]}"
    r = gerente_client.post("/qr/labels", json={
        "raw": raw, "item": "TSCHECK-SEC002", "descricao": "tscheck sec002 item", "um": "UN", "qty": 1,
    })
    assert r.status_code == 200, r.text
    code = r.json()["code"]
    # count entry in Bar sector (gerente may count any sector)
    r2 = gerente_client.post("/counts", json={
        "month": "2026-01", "item": "TSCHECK-SEC002", "descricao": "tscheck sec002 item", "um": "UN",
        "qty": 1, "qr_code": code, "sector": "Bar",
    })
    assert r2.status_code == 200, r2.text
    return code


def test_baixa_rejected_outside_op_sector(gerente_client, chefe_client):
    code = _code(gerente_client)
    r = chefe_client.post(f"/validades/{code}/baixa", json={"motivo": "consumido"})
    assert r.status_code == 404, r.text


def test_baixa_allowed_within_op_sector(gerente_client):
    code = _code(gerente_client)
    r = gerente_client.post(f"/validades/{code}/baixa", json={"motivo": "consumido"})
    assert r.status_code == 200, r.text
