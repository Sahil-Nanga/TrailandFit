from fastapi import APIRouter

from app.api import account, health, photos, profiles, saved_items

v1_router = APIRouter(prefix="/v1")
v1_router.include_router(health.router)
v1_router.include_router(profiles.router)
v1_router.include_router(photos.router)
v1_router.include_router(saved_items.router)
v1_router.include_router(account.router)
