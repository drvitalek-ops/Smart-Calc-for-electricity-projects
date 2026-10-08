# Smart Home Calc

Рабочая первая версия по Professional Developer Specification v3.0: React + TypeScript + Tailwind CSS, FastAPI, PostgreSQL.

## Возможности

- Создание проектов и помещений, признак влажной зоны.
- Загрузка PDF до 20 МБ и 100 страниц; каждая страница — отдельный рабочий лист. Просмотр растровой копии, масштабирование, прокрутка и перетаскивание плана средней кнопкой мыши.
- Независимые слои: видимость, блокировка, включение в ведомость; добавление собственных слоёв.
- Размещение, перетаскивание, редактирование и удаление элементов. Координаты нормализованы в диапазон 0–1 и сохраняются в PostgreSQL.
- Каталог из БД: электроустановки, светильники, треки, LED, датчики и карнизы. Можно добавлять типы и категории через UI/API.
- Параметры LED, треков, карнизов; группировка по помещениям, категориям, типам и параметрам. Метраж не смешивается с количеством оборудования.
- Рекомендации IP для влажных помещений (это подсказки комплектации, не проверка соответствия электротехническим нормам).
- Экспорт общей ведомости Excel/PDF, браузерная печать текущего листа и ведомости.

## Быстрый запуск в подготовленной облачной среде

Используйте существующий checkout, отдельный worktree не нужен.

```bash
bash /workspace/smart-home-calc-dev/start-db.sh
source /workspace/smart-home-calc-dev/env.sh
cd /workspace/Smart-Calc-for-electricity-projects/backend
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

В другом терминале:

```bash
cd /workspace/Smart-Calc-for-electricity-projects/frontend
npm ci
npm run dev -- --port 5173
```

Frontend обращается к `/api` через proxy Vite на backend порта 8000. API-документация доступна на пути `/docs` backend; проверка состояния — `/api/health`. Процессы запускаются заново после восстановления среды. PostgreSQL — отдельный кластер локальной разработки с Unix-сокетом, не публичный сервер.

## Запуск на своём компьютере через Docker

Это основной способ локального тестирования на Windows, macOS и Linux. Установите Docker Desktop, скачайте репозиторий через **Code → Download ZIP**, распакуйте его и откройте терминал в папке проекта.

```bash
docker compose up --build
```

Когда контейнеры перейдут в состояние `healthy`, откройте <http://localhost:5173>. Документация API доступна на <http://localhost:8000/docs>.

Остановка без удаления данных:

```bash
docker compose down
```

Повторный запуск использует те же проекты, PDF и базу данных:

```bash
docker compose up
```

Данные находятся в именованных Docker volumes `smart-home-calc_postgres_data` и `smart-home-calc_project_files`. Команда `docker compose down -v` удалит оба хранилища без возможности восстановления, поэтому не используйте флаг `-v` для обычной остановки.

Локальные значения предназначены только для тестового компьютера. Чтобы изменить пароль, скопируйте `.env.docker.example` в `.env`, измените `POSTGRES_PASSWORD` и пароль внутри `DATABASE_URL` до первого запуска. Не добавляйте `.env` в Git.

## Ручной запуск вне облачной среды

Нужны Node.js 22.12+ (или 24), Python 3.12+, PostgreSQL 17 и шрифт с кириллицей. Путь к шрифту задаётся через `PDF_FONT_PATH`; приложение также ищет DejaVu Sans в Linux и Arial в Windows. Docker-образ уже содержит нужный шрифт.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
# Создайте отдельную PostgreSQL БД и установите строку подключения.
export DATABASE_URL='postgresql+psycopg://USER:PASSWORD@HOST:5432/DATABASE'
export PDF_FONT_PATH='/path/to/DejaVuSans.ttf'
cd backend
alembic upgrade head
uvicorn app.main:app --port 8000
```

Секреты вводите через настройки окружения или локальную `.env`, которая игнорируется Git. `.env` автоматически не загружается: экспортируйте переменные в процесс. `STORAGE_DIR` задаёт каталог PDF/PNG; по умолчанию `backend/storage` при запуске из `backend`. Хранилище и БД необходимо резервировать вместе.

## Проверки

```bash
cd frontend
npm run build
# Backend: тесты сбрасывают таблицы ТОЛЬКО в выделенной БД smart_calc_test.
source /workspace/smart-home-calc-dev/env.sh
createdb smart_calc_test # один раз
cd ../backend
DATABASE_URL='postgresql://smart_calc@/smart_calc_test?host=/workspace/smart-home-calc-dev/socket&port=55432' \
STORAGE_DIR=/tmp/smart-calc-test-files PYTHONPATH=. pytest -q
```

Миграции Alembic хранятся в `backend/migrations`. Начальная схема включает Users, Projects, Pages, Rooms, Layers, Elements, ElementTypes, Manufacturers, Products, Reports. Изменения схемы следует оформлять новой миграцией.

## Структура

- `backend/app/models.py`: модель данных; `db.py`: подключения и сессии.
- `backend/app/catalog.py`: начальное заполнение редактируемого каталога.
- `backend/app/main.py`: API проектов, PDF, редактора и ведомостей.
- `frontend/src/App.tsx`: редактор и ведомость, `style.css`: адаптивный интерфейс.
- `backend/tests/test_workflow.py`: интеграционный сценарий и ограничения.
- `compose.yaml`: локальный PostgreSQL, backend и готовый frontend через Nginx.

## Границы текущей версии

Это MVP для доверенной локальной среды, без регистрации, авторизации и разграничения доступа. Не публикуйте сервер в открытый интернет до добавления этих функций. Пользовательская таблица и таблицы товаров/производителей подготовлены, но управление ими ещё не реализовано.

Следующие этапы: геометрия LED/треков и измерение по масштабу чертежа; отдельные разделы/листы отчетов по категориям и помещениям; экспорт PDF-плана с наложенными элементами и независимыми настройками печати слоёв; цены, поставщики, автоматизация (MVP 5); тесты браузера и промышленное развертывание. Сейчас LED и треки обозначаются маркерами, длина вводится вручную; таблица ведомости содержит разбивку по категориям и помещениям. Изменение параметров сохраняется кнопкой «Сохранить», перетаскивание — при отпускании указателя.

Для коммерческого распространения проверьте условия PyMuPDF (AGPL/коммерческая лицензия).
