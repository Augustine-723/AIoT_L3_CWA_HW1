"""
api/index.py - Vercel Serverless Function Default Entrypoint
讓 Vercel 的 Python 自動偵測機制能精確識別 API 入口點
"""

try:
    from api.weather import handler, app
except ImportError:
    from weather import handler, app

__all__ = ["handler", "app"]
