"""Shared Mongo handle — import `client`/`db` from here (server.py, routers, seed.py)."""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel

load_dotenv(Path(__file__).parent.parent / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logger = logging.getLogger(__name__)

# One entry per collection: every field a route filters, sorts, or dedupes on. Applied by ensure_indexes() at startup.
INDEXES: dict[str, list[IndexModel]] = {
    "users": [IndexModel([("user_id", ASCENDING)], name="user_id", unique=True)],
    "purchases": [
        IndexModel([("key", ASCENDING)], name="key", unique=True),
        IndexModel([("month", ASCENDING)], name="month"),
        IndexModel([("batch_id", ASCENDING)], name="batch_id"),
    ],
    "inventory": [
        IndexModel([("month", ASCENDING), ("item", ASCENDING)], name="month_item"),
        IndexModel([("batch_id", ASCENDING)], name="batch_id"),
    ],
    "costs": [IndexModel([("item", ASCENDING)], name="item", unique=True), IndexModel([("ref", DESCENDING)], name="ref")],
    "periods": [IndexModel([("month", ASCENDING)], name="month", unique=True)],
    "uploads": [IndexModel([("id", ASCENDING)], name="id", unique=True), IndexModel([("created_at", DESCENDING)], name="created")],
    "insights": [IndexModel([("created_at", DESCENDING)], name="created")],
    "invites": [IndexModel([("email", ASCENDING), ("status", ASCENDING)], name="email_status")],
    "qr_labels": [IndexModel([("code", ASCENDING)], name="code", unique=True)],
    "qr_aliases": [IndexModel([("alias", ASCENDING)], name="alias", unique=True)],
    "count_entries": [IndexModel([("month", ASCENDING), ("created_at", DESCENDING)], name="month_created")],
    "requisitions": [IndexModel([("id", ASCENDING)], name="id", unique=True), IndexModel([("created_at", DESCENDING)], name="created"),
                     IndexModel([("sector", ASCENDING), ("status", ASCENDING)], name="sector_status")],
    "audit": [IndexModel([("at", DESCENDING)], name="at")],
    "notifications": [IndexModel([("to", ASCENDING), ("read", ASCENDING), ("at", DESCENDING)], name="to_read_at")],
    "supplier_sectors": [IndexModel([("fornecedor", ASCENDING)], name="fornecedor", unique=True)],
    "ifood_orders": [IndexModel([("key", ASCENDING)], name="key", unique=True), IndexModel([("month", ASCENDING)], name="month")],
    "ifood_map": [IndexModel([("item", ASCENDING)], name="item", unique=True)],
}


async def ensure_indexes() -> None:
    for collection, models in INDEXES.items():
        for model in models:  # one at a time so a bad spec skips only itself
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:  # never block boot on an index; the log line names what to fix
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)
