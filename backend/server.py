import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
from lib.db import client, ensure_indexes
from lib.auth import move_retired_roles

try:  # launched as `backend.server` (the default)
    from backend.clerk_auth import clerk_router
except ModuleNotFoundError:  # launched from inside backend/ as `server`
    from clerk_auth import clerk_router

from routers import analytics, data, users


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.index_task = asyncio.create_task(ensure_indexes())  # background: a big index build must not block boot
    await move_retired_roles()
    yield
    client.close()


app = FastAPI(lifespan=lifespan)

api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "Madrila ERP API"}


api_router.include_router(users.router)
api_router.include_router(data.router)
api_router.include_router(analytics.router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app.include_router(clerk_router)  # /api/clerk/config and /api/__clerk/*
# Include the router in the main app — keep last
app.include_router(api_router)
