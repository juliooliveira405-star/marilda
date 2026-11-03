"""Print a Clerk session JWT (default) or sign-in ticket for a seeded test user.
Usage: python tests/clerk_tokens.py gerente|alimentador|chefe|pendente [ticket]"""

import json
import os
import sys
import urllib.parse
import urllib.request

from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
SK = os.environ["CLERK_SECRET_KEY"]


def bapi(path, body=None, method="POST"):
    req = urllib.request.Request(
        "https://api.clerk.com/v1" + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Authorization": "Bearer " + SK, "Content-Type": "application/json", "User-Agent": "emergent-test"},
    )
    return json.load(urllib.request.urlopen(req))


if __name__ == "__main__":
    role = sys.argv[1]
    email = f"{role}+clerk_test@madrila.com"
    user = bapi("/users?email_address=" + urllib.parse.quote(email), None, "GET")[0]
    if len(sys.argv) > 2 and sys.argv[2] == "ticket":
        print(bapi("/sign_in_tokens", {"user_id": user["id"], "expires_in_seconds": 600})["token"])
    else:
        sess = bapi("/sessions", {"user_id": user["id"]})
        print(bapi(f"/sessions/{sess['id']}/tokens", {"expires_in_seconds": 600})["jwt"])
