# 工具・機材貸出管理

管理者が窓口で工具・機材の貸出・返却を処理するためのシステム。

## 構成

- `app/` Nuxt 4 + Vue 3 + Vuetify
- `api/` FastAPI + SQLAlchemy + Alembic
- MySQL 8.4

## 開発サーバー

### API

```bash
cd /Users/yoshimihiroto/tool-rental/api
source .venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8001
```

### Nuxt

```bash
cd /Users/yoshimihiroto/tool-rental/app
npm run dev
```

Nuxt: http://localhost:3000

API: http://127.0.0.1:8001
