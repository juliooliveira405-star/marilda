"""Pre-scaffolded pytest fixtures for the FastAPI backend.

Tests hit the live uvicorn process managed by supervisor (not an in-process ASGI app), so
the app under test is the same one the frontend and Playwright see. Do NOT re-create this
file — add app-specific fixtures below the marker at the bottom.
"""

import os

import httpx
import pytest
import pytest_asyncio

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8001")
API_URL = f"{BACKEND_URL}/api"


def api_url(path: str = "") -> str:
    """Absolute URL for an /api route: api_url("/status") -> http://localhost:8001/api/status."""
    return f"{API_URL}{path}"


@pytest.fixture(scope="session")
def backend_url() -> str:
    return BACKEND_URL


@pytest.fixture
def client():
    """Sync httpx client rooted at /api — the default for endpoint tests.

    Example:
        def test_status(client):
            assert client.get("/status").status_code == 200
    """
    with httpx.Client(base_url=API_URL, timeout=30.0) as c:
        yield c


@pytest_asyncio.fixture
async def aclient():
    """Async variant, for tests that also await motor/backend helpers directly."""
    async with httpx.AsyncClient(base_url=API_URL, timeout=30.0) as c:
        yield c


# --- app-specific fixtures below this line ---

import functools
import subprocess

TESTS_DIR = os.path.dirname(__file__)


@functools.lru_cache(maxsize=None)
def _token(role: str) -> str:
    """Fresh ~10min Clerk session JWT for a seeded clerk_test user (gerente|alimentador|chefe|pendente)."""
    out = subprocess.run(["python", os.path.join(TESTS_DIR, "clerk_tokens.py"), role], capture_output=True, text=True, timeout=30, check=True)
    return out.stdout.strip()


def auth_client(role: str) -> httpx.Client:
    """httpx.Client rooted at /api with a fresh bearer token for the given seeded role."""
    return httpx.Client(base_url=API_URL, timeout=30.0, headers={"Authorization": f"Bearer {_token(role)}"})


@pytest.fixture
def gerente_client():
    with auth_client("gerente") as c:
        yield c


@pytest.fixture
def alimentador_client():
    with auth_client("alimentador") as c:
        yield c


@pytest.fixture
def chefe_client():
    with auth_client("chefe") as c:
        yield c
