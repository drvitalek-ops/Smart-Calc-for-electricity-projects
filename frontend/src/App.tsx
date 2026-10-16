import { useEffect, useRef, useState } from "react";
type Point = { x: number; y: number };
type Page = {
  id: number;
  number: number;
  name: string | null;
  width: number;
  height: number;
  meters_per_point: number | null;
  overlay_visible: boolean;
  opacity: number;
  offset_x: number;
  offset_y: number;
  scale: number;
};
// Keep the current image visible while a sharper level loads in the background.
function PlanImage({ pageId, displayEdge, ...props }: {
  pageId: number;
  displayEdge: number;
} & React.ImgHTMLAttributes<HTMLImageElement>) {
  const base = `/api/pages/${pageId}/image`,
    [source, setSource] = useState(base),
    [pixelRatio, setPixelRatio] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    const update = () => setPixelRatio(window.devicePixelRatio || 1);
    window.addEventListener("resize", update);
    const query = window.matchMedia(`(resolution: ${pixelRatio}dppx)`);
    query.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      query.removeEventListener("change", update);
    };
  }, [pixelRatio]);
  const requested = Math.min(8192, Math.max(1, displayEdge * pixelRatio)),
    level = [1024, 2048, 4096, 8192].find((value) => value >= requested)!;
  useEffect(() => {
    let active = true;
    const image = new Image(),
      timer = window.setTimeout(() => {
        image.onload = () => {
          if (active) setSource(`${base}?edge=${level}`);
        };
        image.src = `${base}?edge=${level}`;
      }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
      image.onload = null;
      image.src = "";
    };
  }, [base, level]);
  return <img {...props} src={source} />;
}
type Room = {
  id: number;
  name: string;
  wet: boolean;
  page_id: number | null;
  polygon: Point[] | null;
};
type Layer = {
  id: number;
  name: string;
  visible: boolean;
  locked: boolean;
  export: boolean;
  opacity: number;
};
type Kind = {
  id: number;
  name: string;
  category: string;
  unit: string;
  color: string;
  defaults: Record<string, unknown>;
};
type Item = {
  id: number;
  page_id: number;
  layer_id: number;
  type_id: number;
  product_id: number | null;
  room_id: number | null;
  x: number;
  y: number;
  parameters: Record<string, unknown>;
  geometry: { points?: Point[] } | null;
  comment: string;
};
type Project = {
  id: number;
  name: string;
  pages: Page[];
  rooms: Room[];
  layers: Layer[];
  elements: Item[];
};
type Product = {
  id: number;
  type_id: number;
  manufacturer_id: number;
  supplier_id: number | null;
  name: string;
  sku: string;
  manufacturer: string;
  supplier: string;
  unit: string;
  price: number;
  currency: string;
  active: boolean;
  parameters: Record<string, unknown>;
};
type Catalog = {
  manufacturers: { id: number; name: string }[];
  suppliers: { id: number; name: string; contact: string }[];
  products: Product[];
};
type Row = {
  room: string;
  category: string;
  name: string;
  product: string;
  sku: string;
  manufacturer: string;
  supplier: string;
  quantity: number;
  unit: string;
  unit_price: number;
  currency: string;
  total: number;
  parameters: string;
};
type SummaryCategory = {
  category: string;
  items: { name: string; unit: string; quantity: number }[];
  totals: { unit: string; quantity: number }[];
  post_total?: number;
};
type ReportSummary = {
  categories: SummaryCategory[];
  rooms: { room: string; categories: SummaryCategory[] }[];
};
function ReportTotals({ categories }: { categories: SummaryCategory[] }) {
  const quantity = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
  return (
    <div className="summary-breakdown">
      {categories.map((section) => (
        <div className="summary-category" key={section.category}>
          <h4>{section.category}</h4>
          <div className="summary-category-totals">
            {section.totals.map((total) => (
              <strong key={total.unit}>{quantity(total.quantity)} {total.unit}</strong>
            ))}
            {section.post_total !== undefined && <span>Постов: {quantity(section.post_total)}</span>}
          </div>
          {section.items.map((item) => (
            <p key={`${item.name}:${item.unit}`}>
              <span>{item.name}</span>
              <strong>{quantity(item.quantity)} {item.unit}</strong>
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
type Report = { rows: Row[]; warnings: string[]; summary: ReportSummary };
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch("/api" + path, {
    method,
    headers:
      body instanceof FormData
        ? undefined
        : { "Content-Type": "application/json" },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  if (!r.ok) {
    const error = await r.json();
    throw Error(
      typeof error.detail === "string"
        ? error.detail
        : JSON.stringify(error.detail),
    );
  }
  return r.status === 204 ? (undefined as T) : r.json();
}
const labels: Record<string, string> = {
  quantity: "Количество",
  length: "Длина, м",
  ip: "Степень IP",
  voltage: "Напряжение, В",
  control: "Управление",
  zone: "Зона",
  strip_type: "Тип ленты",
  profile: "Профиль",
  track_type: "Тип трека",
  color: "Цвет",
  mount: "Монтаж",
  connectors: "Соединители",
  end_caps: "Заглушки",
  frame_posts: "Постов в рамке",
};
const symbolScaleKey = (projectId: number) =>
  `smart-home-calc:symbol-scale:${projectId}`;
function savedSymbolScale(projectId: number) {
  try {
    const value = Number(localStorage.getItem(symbolScaleKey(projectId)));
    return Number.isFinite(value) && value >= 0.1 && value <= 2 ? value : 1;
  } catch {
    return 1;
  }
}
function rememberSymbolScale(projectId: number, value: number) {
  try {
    localStorage.setItem(symbolScaleKey(projectId), String(value));
  } catch {}
}
function sameItem(first: Item, second: Item) {
  return JSON.stringify(first) === JSON.stringify(second);
}
function isElectrical(kind?: Kind) {
  return kind?.category === "Электроустановки";
}
function isTrack(kind?: Kind) {
  return kind?.name.toLocaleLowerCase().includes("трек") ?? false;
}
function pointAngle(points: Point[], index: number) {
  if (points.length < 2) return 0;
  const from = index === points.length - 1 ? points[index - 1] : points[index],
    to = index === points.length - 1 ? points[index] : points[index + 1];
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}
function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false,
    previous = polygon.at(-1)!;
  for (const current of polygon) {
    if (
      previous.y > point.y !== current.y > point.y &&
      point.x <
        ((current.x - previous.x) * (point.y - previous.y)) /
          (current.y - previous.y) +
          previous.x
    )
      inside = !inside;
    previous = current;
  }
  return inside;
}
function nearestVertex(point: Point, polygon: Point[]) {
  let index = 0,
    distance = Infinity;
  polygon.forEach((candidate, candidateIndex) => {
    const value = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (value < distance) {
      distance = value;
      index = candidateIndex;
    }
  });
  return { index, distance };
}
function nearestSegmentInsertion(point: Point, polygon: Point[]) {
  let insertion = polygon.length,
    distance = Infinity;
  for (let index = 0; index < polygon.length; index++) {
    const first = polygon[index],
      second = polygon[(index + 1) % polygon.length],
      dx = second.x - first.x,
      dy = second.y - first.y,
      length = dx * dx + dy * dy,
      t = length
        ? Math.max(
            0,
            Math.min(
              1,
              ((point.x - first.x) * dx + (point.y - first.y) * dy) / length,
            ),
          )
        : 0,
      x = first.x + t * dx,
      y = first.y + t * dy,
      value = Math.hypot(point.x - x, point.y - y);
    if (value < distance) {
      distance = value;
      insertion = index + 1;
    }
  }
  return insertion;
}
function orientation(a: Point, b: Point, c: Point) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  return Math.abs(value) < 1e-10 ? 0 : value > 0 ? 1 : 2;
}
function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
  return (
    orientation(a, b, c) !== orientation(a, b, d) &&
    orientation(c, d, a) !== orientation(c, d, b)
  );
}
function polygonSelfIntersects(points: Point[]) {
  for (let first = 0; first < points.length; first++) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second++) {
      const secondNext = (second + 1) % points.length;
      if (first === second || firstNext === second || secondNext === first)
        continue;
      if (
        segmentsIntersect(
          points[first],
          points[firstNext],
          points[second],
          points[secondNext],
        )
      )
        return true;
    }
  }
  return false;
}
function PointMarker({
  scale,
  color,
  selected,
  icon,
}: {
  scale: number;
  color: string;
  selected: boolean;
  icon: string;
}) {
  return (
    <g className={"point-symbol " + (selected ? "selected-object" : "")}>
      {selected && (
        <>
          <circle
            className="selection-halo"
            r={24 * scale}
            fill="#38bdf8"
            fillOpacity=".2"
            stroke="#0284c7"
            strokeWidth="5"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            className="selection-ring"
            r={17 * scale}
            fill="none"
            stroke="white"
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
      <circle
        r={12 * scale}
        fill={color}
        stroke={selected ? "#0f172a" : "white"}
        strokeWidth={selected ? 5 : 3}
        vectorEffect="non-scaling-stroke"
      />
      {icon && (
        <text
          className="custom-icon"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={Math.max(1, 12 * scale)}
          fill="white"
        >
          {icon}
        </text>
      )}
    </g>
  );
}
type LegendEntry = { key: string; name: string; color: string; symbol: string };
function makeLegend(
  project: Project,
  pageIds: Set<number>,
  types: Kind[],
): LegendEntry[] {
  const entries = new Map<string, LegendEntry>();
  for (const item of project.elements) {
    if (
      !pageIds.has(item.page_id) ||
      !project.layers.find((layer) => layer.id === item.layer_id)?.visible
    )
      continue;
    const kind = types.find((type) => type.id === item.type_id);
    if (!kind) continue;
    const icon = String(item.parameters.plan_icon ?? "").trim(),
      symbol = icon || (isTrack(kind) ? "➜" : kind.unit === "м" ? "━" : "●"),
      color = String(item.parameters.plan_color ?? kind.color),
      key = `${kind.id}:${symbol}:${color}`;
    entries.set(key, { key, name: kind.name, color, symbol });
    if (item.parameters.frame_group) {
      const posts = Number(item.parameters.frame_posts),
        ending = posts === 1 ? "пост" : posts < 5 ? "поста" : "постов";
      entries.set(`frame:${posts}`, {
        key: `frame:${posts}`,
        name: `Рамка на ${posts} ${ending}`,
        color: "#fb923c",
        symbol: "▭",
      });
    }
  }
  return [...entries.values()];
}
function CatalogManager({
  catalog,
  types,
  onClose,
  onChanged,
}: {
  catalog: Catalog;
  types: Kind[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const blank = {
    id: 0,
    name: "",
    sku: "",
    manufacturer_id: catalog.manufacturers[0]?.id ?? 0,
    supplier_id: 0,
    type_id: types[0]?.id ?? 0,
    price: 0,
    currency: "RUB",
    active: true,
  };
  const [form, setForm] = useState(blank),
    [manufacturer, setManufacturer] = useState(""),
    [manufacturerId, setManufacturerId] = useState(0),
    [supplier, setSupplier] = useState(""),
    [supplierId, setSupplierId] = useState(0),
    [contact, setContact] = useState(""),
    [message, setMessage] = useState(""),
    [localError, setLocalError] = useState(""),
    [saving, setSaving] = useState(false);
  async function work(action: () => Promise<void>) {
    setLocalError("");
    setMessage("");
    setSaving(true);
    try {
      await action();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }
  async function saveProduct(e: React.FormEvent) {
    e.preventDefault();
    await work(async () => {
      const kind = types.find((item) => item.id === form.type_id);
      if (!kind) throw Error("Выберите тип оборудования");
      if (!form.manufacturer_id) throw Error("Добавьте производителя");
      const body = {
        name: form.name,
        sku: form.sku,
        manufacturer_id: form.manufacturer_id,
        supplier_id: form.supplier_id || null,
        type_id: form.type_id,
        unit: kind.unit,
        price: Number(form.price),
        currency: form.currency.toUpperCase(),
        active: form.active,
        parameters: {},
      };
      await api(
        form.id ? `/products/${form.id}` : "/products",
        form.id ? "PUT" : "POST",
        body,
      );
      await onChanged();
      setForm({
        ...blank,
        manufacturer_id: form.manufacturer_id,
        type_id: form.type_id,
      });
      setMessage(form.id ? "Товар обновлён" : "Товар добавлен");
    });
  }
  function edit(product: Product) {
    setForm({
      id: product.id,
      name: product.name,
      sku: product.sku,
      manufacturer_id: product.manufacturer_id,
      supplier_id: product.supplier_id ?? 0,
      type_id: product.type_id,
      price: product.price,
      currency: product.currency,
      active: product.active,
    });
  }
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Каталог оборудования"
    >
      <section className="catalog-modal">
        <div className="catalog-title">
          <div>
            <div className="eyebrow">СПРАВОЧНИКИ И ЦЕНЫ</div>
            <h2>Каталог оборудования</h2>
          </div>
          <button aria-label="Закрыть каталог" onClick={onClose}>
            ×
          </button>
        </div>
        {localError && <p className="catalog-error">{localError}</p>}
        {message && <p className="catalog-success">{message}</p>}
        <div className="catalog-grid">
          <div>
            <h3>Производители</h3>
            <form
              className="compact-form"
              onSubmit={(e) => {
                e.preventDefault();
                void work(async () => {
                  await api(
                    manufacturerId
                      ? `/manufacturers/${manufacturerId}`
                      : "/manufacturers",
                    manufacturerId ? "PUT" : "POST",
                    { name: manufacturer },
                  );
                  setManufacturer("");
                  setManufacturerId(0);
                  await onChanged();
                  setMessage(
                    manufacturerId
                      ? "Производитель обновлён"
                      : "Производитель добавлен",
                  );
                });
              }}
            >
              <input
                required
                placeholder="Название"
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
              />
              <button disabled={saving}>
                {manufacturerId ? "Сохранить" : "Добавить"}
              </button>
            </form>
            <div className="tag-list">
              {catalog.manufacturers.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => {
                    setManufacturerId(item.id);
                    setManufacturer(item.name);
                  }}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3>Поставщики</h3>
            <form
              className="compact-form supplier-form"
              onSubmit={(e) => {
                e.preventDefault();
                void work(async () => {
                  await api(
                    supplierId ? `/suppliers/${supplierId}` : "/suppliers",
                    supplierId ? "PUT" : "POST",
                    { name: supplier, contact },
                  );
                  setSupplier("");
                  setSupplierId(0);
                  setContact("");
                  await onChanged();
                  setMessage(
                    supplierId ? "Поставщик обновлён" : "Поставщик добавлен",
                  );
                });
              }}
            >
              <input
                required
                placeholder="Название"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
              />
              <input
                placeholder="Контакты"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
              <button disabled={saving}>
                {supplierId ? "Сохранить" : "Добавить"}
              </button>
            </form>
            <div className="tag-list">
              {catalog.suppliers.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => {
                    setSupplierId(item.id);
                    setSupplier(item.name);
                    setContact(item.contact);
                  }}
                >
                  {item.name}
                  {item.contact && <small> · {item.contact}</small>}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="catalog-import">
          <div>
            <strong>Импорт прайс-листа CSV</strong>
            <p>
              Столбцы: name, sku, type, manufacturer, supplier, price, currency,
              active.
            </p>
          </div>
          <a className="tool-link" href="/api/catalog/import-template.csv">
            Шаблон CSV
          </a>
          <label className="upload">
            Импортировать
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={saving}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void work(async () => {
                    const data = new FormData();
                    data.append("file", file);
                    const result = await api<{
                      created: number;
                      updated: number;
                    }>("/catalog/import", "POST", data);
                    await onChanged();
                    setMessage(
                      `Создано: ${result.created}, обновлено: ${result.updated}`,
                    );
                  });
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <div className="catalog-products">
          <div className="product-editor">
            <h3>{form.id ? "Редактирование товара" : "Новый товар"}</h3>
            <form onSubmit={(e) => void saveProduct(e)}>
              <label>
                Название
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                Артикул
                <input
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                />
              </label>
              <label>
                Тип
                <select
                  required
                  value={form.type_id || ""}
                  onChange={(e) =>
                    setForm({ ...form, type_id: +e.target.value })
                  }
                >
                  {types.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.category} · {item.name} ({item.unit})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Производитель
                <select
                  required
                  value={form.manufacturer_id || ""}
                  onChange={(e) =>
                    setForm({ ...form, manufacturer_id: +e.target.value })
                  }
                >
                  <option value="" disabled>
                    Выберите
                  </option>
                  {catalog.manufacturers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Поставщик
                <select
                  value={form.supplier_id || ""}
                  onChange={(e) =>
                    setForm({ ...form, supplier_id: +e.target.value })
                  }
                >
                  <option value="">Не указан</option>
                  {catalog.suppliers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="price-fields">
                <label>
                  Цена
                  <input
                    required
                    min="0"
                    step="0.01"
                    type="number"
                    value={form.price}
                    onChange={(e) =>
                      setForm({ ...form, price: +e.target.value })
                    }
                  />
                </label>
                <label>
                  Валюта
                  <input
                    required
                    maxLength={3}
                    value={form.currency}
                    onChange={(e) =>
                      setForm({ ...form, currency: e.target.value })
                    }
                  />
                </label>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) =>
                    setForm({ ...form, active: e.target.checked })
                  }
                />
                Доступен для выбора
              </label>
              <button
                className="primary"
                disabled={saving || !catalog.manufacturers.length}
              >
                {form.id ? "Сохранить изменения" : "Добавить товар"}
              </button>
              {form.id > 0 && (
                <button type="button" onClick={() => setForm(blank)}>
                  Отменить редактирование
                </button>
              )}
            </form>
          </div>
          <div className="product-list">
            <h3>Товары · {catalog.products.length}</h3>
            {catalog.products.map((item) => (
              <button
                type="button"
                key={item.id}
                className={!item.active ? "inactive" : ""}
                onClick={() => edit(item)}
              >
                <strong>{item.name}</strong>
                <span>
                  {item.manufacturer} · {item.sku || "без артикула"}
                </span>
                <span>
                  {item.price} {item.currency} / {item.unit}
                  {!item.active ? " · архив" : ""}
                </span>
              </button>
            ))}
            {!catalog.products.length && (
              <p className="hint">
                Создайте товар вручную или импортируйте CSV.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
export default function App() {
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]),
    [project, setProject] = useState<Project | null>(null),
    [types, setTypes] = useState<Kind[]>([]),
    [catalog, setCatalog] = useState<Catalog>({
      manufacturers: [],
      suppliers: [],
      products: [],
    });
  const [pageId, setPageId] = useState<number | null>(null),
    [layerId, setLayerId] = useState<number | null>(null),
    [typeId, setTypeId] = useState<number | null>(null),
    [roomId, setRoomId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Item | null>(null),
    [selectedIds, setSelectedIds] = useState<number[]>([]),
    [typeEditorOpen, setTypeEditorOpen] = useState(false),
    [framePosts, setFramePosts] = useState(1),
    [report, setReport] = useState<Report>({
      rows: [],
      warnings: [],
      summary: {
        categories: [],
        rooms: [],
      },
    });
  const [zoom, setZoom] = useState(1),
    [symbolScale, setSymbolScale] = useState(1),
    [labelsVisible, setLabelsVisible] = useState(true),
    [elementsVisible, setElementsVisible] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [placing, setPlacing] = useState(false),
    [calibrating, setCalibrating] = useState(false),
    [catalogOpen, setCatalogOpen] = useState(false),
    [view, setView] = useState<"plan" | "report">("plan");
  const [alignPageId, setAlignPageId] = useState<number | null>(null);
  const [alignOriginal, setAlignOriginal] = useState<{
    overlay_visible: boolean;
    opacity: number;
    offset_x: number;
    offset_y: number;
    scale: number;
  } | null>(null);
  const [leftPanelVisible, setLeftPanelVisible] = useState(true),
    [rightPanelVisible, setRightPanelVisible] = useState(true),
    [checkedPageIds, setCheckedPageIds] = useState<number[]>([]);
  const [linePoints, setLinePoints] = useState<Point[]>([]),
    [lineCursor, setLineCursor] = useState<Point | null>(null),
    [calibrationStart, setCalibrationStart] = useState<Point | null>(null);
  const [selectionBox, setSelectionBox] = useState<{
    start: Point;
    current: Point;
    additive: boolean;
  } | null>(null);
  const [roomMode, setRoomMode] = useState<"new" | "edit" | null>(null),
    [roomPoints, setRoomPoints] = useState<Point[]>([]),
    [roomCursor, setRoomCursor] = useState<Point | null>(null),
    [editingRoomId, setEditingRoomId] = useState<number | null>(null),
    [roomMenu, setRoomMenu] = useState<{
      roomId: number;
      x: number;
      y: number;
    } | null>(null),
    [roomPointMenu, setRoomPointMenu] = useState<{
      point: Point;
      x: number;
      y: number;
    } | null>(null),
    [objectMenu, setObjectMenu] = useState<{
      itemId: number;
      x: number;
      y: number;
    } | null>(null);
  const [name, setName] = useState(""),
    [roomName, setRoomName] = useState(""),
    [wet, setWet] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const nodeDrag = useRef<{ index: number; point: Point } | null>(null);
  const pan = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const alignDrag = useRef<{
    clientX: number;
    clientY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const roomNodeDrag = useRef<number | null>(null);
  const lastObjectClick = useRef<{ id: number; time: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function closeMenus(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".object-context-menu,.room-context-menu")) return;
      setObjectMenu(null);
      setRoomMenu(null);
      setRoomPointMenu(null);
    }
    window.addEventListener("pointerdown", closeMenus);
    return () => window.removeEventListener("pointerdown", closeMenus);
  }, []);
  useEffect(() => {
    setFramePosts(Math.min(6, Math.max(1, selectedIds.length)));
  }, [selectedIds]);
  useEffect(() => {
    const activePageId = alignPageId;
    if (activePageId === null) return;
    const moveAlignment = (event: PointerEvent) => {
      if (!alignDrag.current) return;
      event.preventDefault();
      const rect = sheetRef.current?.getBoundingClientRect();
      if (!rect) return;
      localPage(activePageId, {
        offset_x: Math.max(
          -2,
          Math.min(
            2,
            alignDrag.current.offsetX +
              (event.clientX - alignDrag.current.clientX) / rect.width,
          ),
        ),
        offset_y: Math.max(
          -2,
          Math.min(
            2,
            alignDrag.current.offsetY +
              (event.clientY - alignDrag.current.clientY) / rect.height,
          ),
        ),
      });
    };
    const finishAlignmentDrag = () => {
      alignDrag.current = null;
    };
    window.addEventListener("pointermove", moveAlignment, { passive: false });
    window.addEventListener("pointerup", finishAlignmentDrag);
    window.addEventListener("pointercancel", finishAlignmentDrag);
    return () => {
      window.removeEventListener("pointermove", moveAlignment);
      window.removeEventListener("pointerup", finishAlignmentDrag);
      window.removeEventListener("pointercancel", finishAlignmentDrag);
      alignDrag.current = null;
    };
  }, [alignPageId]);
  const page = project?.pages.find((p) => p.id === pageId),
    kind = types.find((t) => t.id === typeId),
    layer = project?.layers.find((l) => l.id === layerId);
  async function run(work: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }
  async function refresh(id: number) {
    const p = await api<Project>(`/projects/${id}`);
    setProject(p);
    setReport(await api(`/projects/${id}/report`));
    return p;
  }
  async function open(id: number) {
    const p = await refresh(id);
    setSymbolScale(savedSymbolScale(id));
    setPageId(p.pages[0]?.id ?? null);
    setLayerId(p.layers[0]?.id ?? null);
    setRoomId(null);
    setSelected(null);
    setSelectedIds([]);
    setTypeEditorOpen(false);
    setView("plan");
    setCheckedPageIds([]);
    setAlignPageId(null);
    setAlignOriginal(null);
    setRoomMode(null);
    setRoomPoints([]);
    setEditingRoomId(null);
    setRoomMenu(null);
    setRoomPointMenu(null);
    setLinePoints([]);
    setLineCursor(null);
    setCalibrationStart(null);
    setElementsVisible(true);
    setZoom(1);
  }
  useEffect(() => {
    void run(async () => {
      setProjects(await api("/projects"));
      const ts = await api<Kind[]>("/types");
      setTypes(ts);
      setTypeId(ts[0]?.id ?? null);
      setCatalog(await api("/catalog"));
    });
  }, []);
  async function save(item: Item) {
    const e = await api<Item>(`/elements/${item.id}`, "PUT", {
      ...item,
      geometry: item.geometry ?? {},
    });
    setSelected((current) =>
      current?.id === item.id && sameItem(current, item) ? e : current,
    );
    await refresh(project!.id);
  }
  async function removeSelected() {
    for (const id of selectedIds.length
      ? selectedIds
      : selected
        ? [selected.id]
        : [])
      await api(`/elements/${id}`, "DELETE");
    setSelected(null);
    setSelectedIds([]);
    setTypeEditorOpen(false);
    await refresh(project!.id);
  }
  async function undoLast() {
    if (!project) return;
    const stored =
      selected && project.elements.find((item) => item.id === selected.id);
    if (selected && stored && !sameItem(selected, stored)) {
      setSelected(stored);
      return;
    }
    const result = await api<{ undone: boolean }>(
      `/projects/${project.id}/elements/undo`,
      "POST",
    );
    if (!result.undone) return;
    const selectedId = selected?.id,
      updated = await refresh(project.id);
    setSelected(
      selectedId
        ? (updated.elements.find((item) => item.id === selectedId) ?? null)
        : null,
    );
    setSelectedIds((ids) =>
      ids.filter((id) => updated.elements.some((item) => item.id === id)),
    );
  }
  useEffect(() => {
    if (!selected || !project || busy || drag.current || nodeDrag.current)
      return;
    const stored = project.elements.find((item) => item.id === selected.id);
    if (!stored || sameItem(selected, stored)) return;
    const timeout = window.setTimeout(
      () => void run(() => save(selected)),
      600,
    );
    return () => window.clearTimeout(timeout);
  }, [selected, project, busy]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.key === "F7") {
        event.preventDefault();
        setElementsVisible((value) => !value);
        return;
      }
      if (event.key === "Escape" && alignPageId) {
        cancelAlignment();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        if (roomMode) return;
        event.preventDefault();
        if (!busy) void run(undoLast);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        event.key !== "Delete" ||
        (!selected && selectedIds.length === 0) ||
        busy ||
        target?.matches('input,textarea,select,[contenteditable="true"]')
      )
        return;
      event.preventDefault();
      void run(removeSelected);
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [selected, selectedIds, busy, project, alignPageId, roomMode]);
  useEffect(() => {
    function wheel(event: WheelEvent) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const viewport = viewportRef.current,
        target = event.target;
      if (!viewport || !(target instanceof Node) || !viewport.contains(target))
        return;
      const rect = viewport.getBoundingClientRect(),
        localX = event.clientX - rect.left,
        localY = event.clientY - rect.top,
        next = event.deltaY < 0 ? zoom * 1.15 : Math.max(0.1, zoom / 1.15);
      if (next === zoom) return;
      const planX = (viewport.scrollLeft + localX) / zoom,
        planY = (viewport.scrollTop + localY) / zoom;
      setZoom(next);
      requestAnimationFrame(() => {
        viewport.scrollLeft = planX * next - localX;
        viewport.scrollTop = planY * next - localY;
      });
    }
    window.addEventListener("wheel", wheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", wheel, { capture: true });
  }, [zoom, project]);
  function finishLine() {
    if (!project || !page || !kind || !layer || linePoints.length < 2) return;
    void run(async () => {
      const first = linePoints[0];
      const item = await api<Item>(`/projects/${project.id}/elements`, "POST", {
        page_id: page.id,
        layer_id: layer.id,
        type_id: kind.id,
        product_id: null,
        room_id: roomId,
        x: first.x,
        y: first.y,
        parameters: kind.defaults,
        geometry: { points: linePoints },
      });
      setSelected(item);
      setLinePoints([]);
      setLineCursor(null);
      await refresh(project.id);
    });
  }
  function position(e: {
    currentTarget: SVGSVGElement;
    clientX: number;
    clientY: number;
  }) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  }
  async function patch(l: Layer, field: "visible" | "locked" | "export") {
    await api(`/layers/${l.id}`, "PATCH", { [field]: !l[field] });
    await refresh(project!.id);
  }
  function localPage(id: number, values: Partial<Page>) {
    setProject((value) =>
      value
        ? {
            ...value,
            pages: value.pages.map((item) =>
              item.id === id ? { ...item, ...values } : item,
            ),
          }
        : value,
    );
  }
  async function savePage(id: number, values: Partial<Page>) {
    await api(`/pages/${id}`, "PATCH", values);
  }
  function startAlignment(item: Page) {
    if (alignPageId && alignOriginal) localPage(alignPageId, alignOriginal);
    setAlignOriginal({
      overlay_visible: item.overlay_visible,
      opacity: item.opacity ?? 1,
      offset_x: item.offset_x ?? 0,
      offset_y: item.offset_y ?? 0,
      scale: item.scale ?? 1,
    });
    localPage(item.id, { overlay_visible: true });
    setAlignPageId(item.id);
  }
  function cancelAlignment() {
    if (alignPageId && alignOriginal) localPage(alignPageId, alignOriginal);
    alignDrag.current = null;
    setAlignPageId(null);
    setAlignOriginal(null);
  }
  async function applyAlignment() {
    if (!project || !alignPageId) return;
    const source = project.pages.find((item) => item.id === alignPageId);
    if (!source) return;
    await savePage(source.id, {
      overlay_visible: true,
      opacity: source.opacity,
      offset_x: source.offset_x,
      offset_y: source.offset_y,
      scale: source.scale,
    });
    alignDrag.current = null;
    setAlignPageId(null);
    setAlignOriginal(null);
  }
  function nudgeAlignment(x: number, y: number) {
    if (!project || !alignPageId) return;
    const source = project.pages.find((item) => item.id === alignPageId);
    if (!source) return;
    localPage(source.id, {
      offset_x: Math.max(-2, Math.min(2, (source.offset_x ?? 0) + x)),
      offset_y: Math.max(-2, Math.min(2, (source.offset_y ?? 0) + y)),
    });
  }
  async function deletePage(item: Page) {
    if (
      !confirm(
        `Удалить ${item.name || `лист ${item.number}`}? Страницу с электроустановками или освещением удалить нельзя.`,
      )
    )
      return;
    await api(`/pages/${item.id}`, "DELETE");
    const updated = await refresh(project!.id);
    if (pageId === item.id) setPageId(updated.pages[0]?.id ?? null);
    if (alignPageId === item.id) {
      setAlignPageId(null);
      setAlignOriginal(null);
    }
    setCheckedPageIds((ids) => ids.filter((id) => id !== item.id));
    setSelected(null);
    setSelectedIds([]);
  }
  async function deleteCheckedPages() {
    if (!project || !checkedPageIds.length) return;
    if (
      !confirm(
        `Удалить выбранные страницы (${checkedPageIds.length})? Отменить это действие нельзя.`,
      )
    )
      return;
    const deleting = new Set(checkedPageIds);
    await api(`/projects/${project.id}/pages/delete`, "POST", {
      page_ids: checkedPageIds,
    });
    const updated = await refresh(project.id);
    if (pageId && deleting.has(pageId)) setPageId(updated.pages[0]?.id ?? null);
    if (alignPageId && deleting.has(alignPageId)) {
      setAlignPageId(null);
      setAlignOriginal(null);
    }
    setCheckedPageIds([]);
    setSelected(null);
    setSelectedIds([]);
  }
  function cancelRoom() {
    setRoomMode(null);
    setRoomPoints([]);
    setRoomCursor(null);
    setEditingRoomId(null);
    setRoomPointMenu(null);
  }
  async function finishRoom() {
    if (!project || !page || roomPoints.length < 3)
      throw Error("Для помещения нужны минимум три точки");
    if (polygonSelfIntersects(roomPoints))
      throw Error("Контур помещения пересекает сам себя. Исправьте точки.");
    const existing = project.rooms.find((room) => room.id === editingRoomId);
    const name = existing?.name ?? prompt("Название помещения")?.trim();
    if (!name) return;
    const wet = existing?.wet ?? confirm("Это влажная зона?");
    if (existing)
      await api(`/rooms/${existing.id}`, "PUT", {
        name,
        wet,
        page_id: page.id,
        polygon: roomPoints,
      });
    else
      await api(`/projects/${project.id}/rooms`, "POST", {
        name,
        wet,
        page_id: page.id,
        polygon: roomPoints,
      });
    await refresh(project.id);
    cancelRoom();
    setRoomMenu(null);
  }
  useEffect(() => {
    function roomKeys(event: KeyboardEvent) {
      if (
        !roomMode ||
        busy ||
        (event.target as HTMLElement | null)?.matches(
          'input,textarea,select,[contenteditable="true"]',
        )
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        cancelRoom();
      } else if (event.key === "Enter" && roomPoints.length >= 3) {
        event.preventDefault();
        void run(finishRoom);
      } else if (
        event.key === "Backspace" ||
        (event.ctrlKey && event.key.toLowerCase() === "z")
      ) {
        event.preventDefault();
        setRoomPoints((points) => points.slice(0, -1));
        setRoomCursor(null);
      }
    }
    window.addEventListener("keydown", roomKeys);
    return () => window.removeEventListener("keydown", roomKeys);
  }, [roomMode, roomPoints, busy, project, page, editingRoomId]);
  function editRoomArea(room: Room) {
    setPageId(room.page_id);
    setRoomMode("edit");
    setEditingRoomId(room.id);
    setRoomPoints(room.polygon ?? []);
    setRoomCursor(null);
    setRoomMenu(null);
    setRoomPointMenu(null);
    setObjectMenu(null);
    setPlacing(false);
    setLinePoints([]);
  }
  async function renameRoom(room: Room) {
    const name = prompt("Название помещения", room.name)?.trim();
    if (!name) return;
    await api(`/rooms/${room.id}`, "PUT", {
      name,
      wet: room.wet,
      page_id: room.page_id,
      polygon: room.polygon,
    });
    await refresh(project!.id);
    setRoomMenu(null);
  }
  async function deleteRoom(room: Room) {
    if (!confirm(`Удалить помещение «${room.name}»?`)) return;
    await api(`/rooms/${room.id}`, "DELETE");
    await refresh(project!.id);
    setRoomMenu(null);
    if (editingRoomId === room.id) {
      setRoomMode(null);
      setRoomPoints([]);
      setEditingRoomId(null);
    }
  }
  function pagePoint(point: Point, id: number) {
    const source = project?.pages.find((item) => item.id === id),
      scale = source?.scale ?? 1;
    return {
      x: 0.5 + (point.x - 0.5) * scale + (source?.offset_x ?? 0),
      y: 0.5 + (point.y - 0.5) * scale + (source?.offset_y ?? 0),
    };
  }
  function sourcePoint(point: Point, id: number) {
    const source = project?.pages.find((item) => item.id === id),
      scale = source?.scale ?? 1;
    return {
      x: Math.max(
        0,
        Math.min(1, (point.x - 0.5 - (source?.offset_x ?? 0)) / scale + 0.5),
      ),
      y: Math.max(
        0,
        Math.min(1, (point.y - 0.5 - (source?.offset_y ?? 0)) / scale + 0.5),
      ),
    };
  }
  function roomCandidate(point: Point, orthogonal = false) {
    const candidate = sourcePoint(point, page!.id),
      last = roomPoints.at(-1);
    if (!orthogonal || !last) return candidate;
    return Math.abs(candidate.x - last.x) >= Math.abs(candidate.y - last.y)
      ? { x: candidate.x, y: last.y }
      : { x: last.x, y: candidate.y };
  }
  function showObjectMenu(item: Item, event: React.MouseEvent<SVGGElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedIds.includes(item.id)) {
      setSelectedIds([item.id]);
      setFramePosts(1);
    }
    setSelected(item);
    setTypeEditorOpen(false);
    setObjectMenu({
      itemId: item.id,
      x: Math.min(event.clientX, window.innerWidth - 230),
      y: Math.min(event.clientY, window.innerHeight - 260),
    });
    setRoomMenu(null);
    setRoomPointMenu(null);
  }
  function choose(item: Item, additive: boolean) {
    if (additive) {
      setSelectedIds((ids) =>
        ids.includes(item.id)
          ? ids.filter((id) => id !== item.id)
          : [...ids, item.id],
      );
      setSelected(item);
    } else {
      setSelectedIds([item.id]);
      setSelected(item);
    }
    setTypeEditorOpen(false);
    setPlacing(false);
    setLinePoints([]);
    setLineCursor(null);
  }
  function focusItem(item: Item) {
    setElementsVisible(true);
    setPageId(item.page_id);
    window.setTimeout(() => {
      const viewport = viewportRef.current,
        sheet = viewport?.querySelector<HTMLElement>(".sheet");
      if (!viewport || !sheet) return;
      const points = item.geometry?.points?.length
          ? item.geometry.points
          : [{ x: item.x, y: item.y }],
        center = {
          x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
          y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
        },
        display = pagePoint(center, item.page_id);
      viewport.scrollTo({
        left:
          sheet.offsetLeft +
          display.x * sheet.clientWidth -
          viewport.clientWidth / 2,
        top:
          sheet.offsetTop +
          display.y * sheet.clientHeight -
          viewport.clientHeight / 2,
        behavior: "smooth",
      });
    }, 50);
  }
  function selectSameType(item: Item) {
    if (!project) return;
    window.getSelection()?.removeAllRanges();
    const ids = project.elements
      .filter((candidate) => candidate.type_id === item.type_id)
      .map((candidate) => candidate.id);
    setSelectedIds(ids);
    setSelected(item);
    setFramePosts(Math.min(6, Math.max(1, ids.length)));
    focusItem(item);
  }
  function objectDoubleClick(item: Item) {
    const now = performance.now(),
      previous = lastObjectClick.current;
    lastObjectClick.current = { id: item.id, time: now };
    if (!previous || previous.id !== item.id || now - previous.time > 450)
      return false;
    lastObjectClick.current = null;
    selectSameType(item);
    return true;
  }
  function changeSelectedType(typeId: number) {
    if (!selected) return;
    const nextKind = types.find((type) => type.id === typeId),
      currentKind = types.find((type) => type.id === selected.type_id);
    if (!nextKind || nextKind.unit !== currentKind?.unit) return;
    const parameters = { ...nextKind.defaults };
    for (const key of Object.keys(nextKind.defaults)) {
      if (key in selected.parameters)
        parameters[key] = selected.parameters[key];
    }
    if (isElectrical(nextKind) && isElectrical(currentKind)) {
      for (const key of [
        "plan_icon",
        "plan_color",
        "frame_group",
        "frame_posts",
      ]) {
        if (key in selected.parameters)
          parameters[key] = selected.parameters[key];
      }
    }
    setSelected({ ...selected, type_id: typeId, product_id: null, parameters });
  }
  async function changeFrame(path: string, posts?: number) {
    if (!project) return;
    // Flush pending property edits before changing server-managed frame data.
    const stored =
      selected && project.elements.find((item) => item.id === selected.id);
    if (selected && stored && !sameItem(selected, stored)) await save(selected);
    await api(`/projects/${project.id}/frames${path}`, "POST", {
      element_ids: selectedIds,
      ...(posts === undefined ? {} : { posts }),
    });
    const updated = await refresh(project.id);
    // The autosave draft must include the new frame membership. Otherwise its
    // stale parameters are treated as edits and undo the frame operation.
    setSelected((current) =>
      current
        ? (updated.elements.find((item) => item.id === current.id) ?? null)
        : null,
    );
  }
  async function assignFrame(posts = framePosts) {
    await changeFrame("", posts);
  }
  async function removeFrame() {
    await changeFrame("/remove");
  }
  const previewPoints =
      lineCursor && linePoints.length
        ? [...linePoints, lineCursor]
        : linePoints,
    selectedKind = types.find((t) => t.id === selected?.type_id);
  const displayedPages =
      page && project
        ? [
            page,
            ...project.pages.filter(
              (item) => item.id !== page.id && item.overlay_visible,
            ),
          ]
        : [],
    displayedPageIds = new Set(displayedPages.map((item) => item.id)),
    legend =
      project && elementsVisible
        ? makeLegend(project, displayedPageIds, types)
        : [];
  const visibleElements = elementsVisible
    ? (project?.elements.filter(
        (item) =>
          displayedPageIds.has(item.page_id) &&
          project.layers.find((l) => l.id === item.layer_id)?.visible,
      ) ?? [])
    : [];
  const pageRooms =
    project?.rooms.filter(
      (room) =>
        room.page_id === pageId && room.polygon && room.polygon.length >= 3,
    ) ?? [];
  const protectedPageIds = new Set(
    project?.elements
      .filter((item) => {
        const itemType = types.find((type) => type.id === item.type_id);
        return (
          itemType &&
          ["Электроустановки", "Освещение", "LED-подсветка"].includes(
            itemType.category,
          )
        );
      })
      .map((item) => item.page_id) ?? [],
  );
  const deletablePageIds =
    project?.pages
      .filter((item) => !protectedPageIds.has(item.id))
      .map((item) => item.id) ?? [];
  const contextItems =
      objectMenu && project
        ? project.elements.filter((item) => selectedIds.includes(item.id))
        : [],
    contextCanFrame =
      contextItems.length > 0 &&
      contextItems.length <= 6 &&
      contextItems.every((item) =>
        isElectrical(types.find((type) => type.id === item.type_id)),
      ),
    contextHasFrame = contextItems.some((item) => item.parameters.frame_group);
  const frameVisuals = [
    ...new Set(
      visibleElements
        .map((item) => String(item.parameters.frame_group ?? ""))
        .filter(Boolean),
    ),
  ]
    .map((group) => {
      const members = visibleElements.filter(
          (item) => item.parameters.frame_group === group,
        ),
        posts = Number(members[0]?.parameters.frame_posts ?? 0);
      if (members.length !== posts) return null;
      const points = members.map((item) => pagePoint(item, item.page_id)),
        padding = 20 * symbolScale,
        x1 = Math.min(...points.map((item) => item.x * 1000)) - padding,
        x2 = Math.max(...points.map((item) => item.x * 1000)) + padding,
        y1 = Math.min(...points.map((item) => item.y * 1000)) - padding,
        y2 = Math.max(...points.map((item) => item.y * 1000)) + padding;
      return {
        group,
        members,
        x: x1,
        y: y1,
        width: Math.max(40 * symbolScale, x2 - x1),
        height: Math.max(40 * symbolScale, y2 - y1),
        opacity: Math.min(
          ...members.map(
            (item) =>
              project!.pages.find((source) => source.id === item.page_id)
                ?.opacity ?? 1,
          ),
        ),
      };
    })
    .filter((value) => value !== null);
  return (
    <div className="app-shell">
      <header>
        <div className="logo">SH</div>
        <div className="brand">
          <h1>Smart Home Calc</h1>
          <small>Проектирование комплектации · рабочая версия</small>
        </div>
        <nav className="app-tabs" aria-label="Разделы приложения">
          <button
            className={view === "plan" ? "active" : ""}
            onClick={() => setView("plan")}
          >
            План
          </button>
          <button
            className={view === "report" ? "active" : ""}
            disabled={!project}
            onClick={() => setView("report")}
          >
            Спецификация
          </button>
        </nav>
        <button onClick={() => setCatalogOpen(true)}>Каталог и цены</button>
        <label className="restore-project">
          Восстановить ZIP
          <input
            type="file"
            accept=".zip,application/zip"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                void run(async () => {
                  const form = new FormData();
                  form.append("file", file);
                  const restored = await api<{ id: number }>(
                    "/projects/import",
                    "POST",
                    form,
                  );
                  setProjects(await api("/projects"));
                  await open(restored.id);
                });
              e.target.value = "";
            }}
          />
        </label>
        <select
          aria-label="Проект"
          value={project?.id ?? ""}
          onChange={(e) => void run(() => open(+e.target.value))}
        >
          <option value="" disabled>
            Выберите проект
          </option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const p = await api<{ id: number }>("/projects", "POST", {
                name,
              });
              setProjects(await api("/projects"));
              await open(p.id);
              setName("");
            });
          }}
        >
          <input
            required
            placeholder="Новый проект"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button disabled={busy}>Создать</button>
        </form>
      </header>
      {catalogOpen && (
        <CatalogManager
          catalog={catalog}
          types={types}
          onClose={() => setCatalogOpen(false)}
          onChanged={async () => setCatalog(await api("/catalog"))}
        />
      )}
      {error && (
        <div role="alert" className="error">
          {error}
          <button onClick={() => setError("")}>×</button>
        </div>
      )}
      {!project ? (
        <main className="welcome">
          <div className="welcome-content">
            <div className="eyebrow">ОТ ПЛАНА К ВЕДОМОСТИ</div>
            <h2>
              Каждая деталь
              <br />
              на своём месте.
            </h2>
            <p>
              Создайте проект, загрузите PDF-план и разместите оборудование.
              Ведомость формируется автоматически.
            </p>
            <div className="steps">
              <span>01 / PDF-план</span>
              <span>02 / Элементы и слои</span>
              <span>03 / Ведомость</span>
            </div>
          </div>
        </main>
      ) : (
        <>
          {view === "plan" ? (
            <main
              className={`workspace ${leftPanelVisible ? "" : "left-collapsed"} ${rightPanelVisible ? "" : "right-collapsed"}`}
            >
              {leftPanelVisible && (
                <aside>
                  <h3>Слои элементов</h3>
                  {project.layers.map((l) => (
                    <div
                      className={"layer " + (l.id === layerId ? "active" : "")}
                      key={l.id}
                    >
                      <button onClick={() => setLayerId(l.id)}>{l.name}</button>
                      <button
                        title="Видимость"
                        onClick={() => void run(() => patch(l, "visible"))}
                      >
                        {l.visible ? "◉" : "○"}
                      </button>
                      <button
                        title="Блокировка"
                        onClick={() => void run(() => patch(l, "locked"))}
                      >
                        {l.locked ? "🔒" : "◇"}
                      </button>
                      <input
                        aria-label={`Экспорт ${l.name}`}
                        type="checkbox"
                        checked={l.export}
                        onChange={() => void run(() => patch(l, "export"))}
                      />
                    </div>
                  ))}
                  <p className="hint">
                    ◉ видимость · ◇ блокировка · ☑ ведомость
                  </p>
                  <button
                    onClick={() => {
                      const name = prompt("Название слоя");
                      if (name)
                        void run(async () => {
                          await api(`/projects/${project.id}/layers`, "POST", {
                            name,
                          });
                          await refresh(project.id);
                        });
                    }}
                  >
                    ＋ Слой
                  </button>
                  <h3>Библиотека</h3>
                  <select
                    aria-label="Тип элемента"
                    value={typeId ?? ""}
                    onChange={(e) => {
                      setTypeId(+e.target.value);
                      setLinePoints([]);
                      setLineCursor(null);
                    }}
                  >
                    {[...new Set(types.map((t) => t.category))].map((c) => (
                      <optgroup key={c} label={c}>
                        {types
                          .filter((t) => t.category === c)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                  <p className="hint">
                    {kind?.category} · {kind?.unit}
                    {kind?.unit === "м" && !page?.meters_per_point
                      ? " · нужен масштаб"
                      : ""}
                  </p>
                  <label>
                    Помещение
                    <select
                      value={roomId ?? ""}
                      onChange={(e) =>
                        setRoomId(e.target.value ? +e.target.value : null)
                      }
                    >
                      <option value="">Без помещения</option>
                      {project.rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                          {r.wet ? " · влажная зона" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="primary"
                    disabled={!page || layer?.locked || busy}
                    onClick={() => {
                      setPlacing(!placing);
                      setCalibrating(false);
                      setCalibrationStart(null);
                      setLinePoints([]);
                      setLineCursor(null);
                    }}
                  >
                    {placing
                      ? kind?.unit === "м"
                        ? `✓ Узлов линии: ${linePoints.length}`
                        : "✓ Размещение включено"
                      : "＋ Разместить элемент"}
                  </button>
                  {placing && kind?.unit === "м" && linePoints.length >= 2 && (
                    <button
                      className="primary finish-line"
                      disabled={busy}
                      onClick={finishLine}
                    >
                      Завершить линию
                    </button>
                  )}
                  {placing && kind?.unit === "м" && linePoints.length > 0 && (
                    <button
                      className="danger"
                      onClick={() => {
                        setLinePoints([]);
                        setLineCursor(null);
                      }}
                    >
                      Отменить линию
                    </button>
                  )}
                  <p className="hint">
                    {kind?.unit === "м"
                      ? isTrack(kind)
                        ? "Поставьте первый узел — трек будет тянуться за курсором. Добавляйте повороты щелчком и завершите линию. Длина вычисляется по масштабу."
                        : "Отметьте все узлы линии и нажмите «Завершить линию». Длина вычисляется по масштабу."
                      : "Нажмите на план для размещения. Перетаскивайте объекты левой кнопкой."}{" "}
                    План перемещается средней кнопкой.
                  </p>
                  <details>
                    <summary>Добавить помещение</summary>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(async () => {
                          const r = await api<Room>(
                            `/projects/${project.id}/rooms`,
                            "POST",
                            { name: roomName, wet },
                          );
                          await refresh(project.id);
                          setRoomId(r.id);
                          setRoomName("");
                        });
                      }}
                    >
                      <input
                        required
                        placeholder="Название помещения"
                        value={roomName}
                        onChange={(e) => setRoomName(e.target.value)}
                      />
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={wet}
                          onChange={(e) => setWet(e.target.checked)}
                        />
                        Влажная зона
                      </label>
                      <button disabled={busy}>Добавить</button>
                    </form>
                  </details>
                  <button
                    className="new-type"
                    onClick={() => {
                      const name = prompt("Название типа");
                      if (!name) return;
                      const category = prompt("Категория");
                      if (!category) return;
                      void run(async () => {
                        const t = await api<Kind>("/types", "POST", {
                          name,
                          category,
                        });
                        setTypes(await api("/types"));
                        setTypeId(t.id);
                      });
                    }}
                  >
                    ＋ Новый тип оборудования
                  </button>
                  <button
                    className="new-type"
                    onClick={() => setCatalogOpen(true)}
                  >
                    Каталог и цены
                  </button>
                </aside>
              )}
              <section className="plan-area">
                <div className="toolbar">
                  <strong>
                    {project.name}{" "}
                    <small>
                      /{" "}
                      {page ? page.name || `Лист ${page.number}` : "Нет плана"}{" "}
                      {page?.meters_per_point ? "· масштаб задан" : ""}
                    </small>
                  </strong>
                  <div>
                    <button
                      className="panel-toggle"
                      aria-label={
                        leftPanelVisible
                          ? "Скрыть левую панель"
                          : "Показать левую панель"
                      }
                      title={
                        leftPanelVisible
                          ? "Скрыть левую панель"
                          : "Показать левую панель"
                      }
                      onClick={() => setLeftPanelVisible((value) => !value)}
                    >
                      {leftPanelVisible ? "◀ Левая" : "Левая ▶"}
                    </button>
                    <button
                      className="panel-toggle"
                      aria-label={
                        rightPanelVisible
                          ? "Скрыть правую панель"
                          : "Показать правую панель"
                      }
                      title={
                        rightPanelVisible
                          ? "Скрыть правую панель"
                          : "Показать правую панель"
                      }
                      onClick={() => setRightPanelVisible((value) => !value)}
                    >
                      {rightPanelVisible ? "Правая ▶" : "◀ Правая"}
                    </button>
                    {page &&
                      (roomMode ? (
                        <>
                          <button
                            className="active"
                            disabled={roomPoints.length < 3 || busy}
                            onClick={() => void run(finishRoom)}
                          >
                            Замкнуть область · Enter
                          </button>
                          <button
                            disabled={!roomPoints.length}
                            onClick={() => {
                              setRoomPoints((points) => points.slice(0, -1));
                              setRoomCursor(null);
                            }}
                          >
                            ↶ Последняя точка
                          </button>
                          <button onClick={cancelRoom}>Отмена · Esc</button>
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            setRoomMode("new");
                            setRoomPoints([]);
                            setRoomCursor(null);
                            setEditingRoomId(null);
                            setRoomMenu(null);
                            setRoomPointMenu(null);
                            setObjectMenu(null);
                            setPlacing(false);
                            setCalibrating(false);
                          }}
                        >
                          ◇ Область помещения
                        </button>
                      ))}
                    <button
                      className={elementsVisible ? "" : "active clean-plan-toggle"}
                      aria-pressed={!elementsVisible}
                      title="Скрыть или показать все элементы · F7"
                      onClick={() => setElementsVisible((value) => !value)}
                    >
                      {elementsVisible
                        ? "Скрыть элементы · F7"
                        : "Показать элементы · F7"}
                    </button>
                    <button onClick={() => setZoom(Math.max(0.1, zoom / 1.25))}>
                      −
                    </button>
                    <span> {Math.round(zoom * 100)}% </span>
                    <button onClick={() => setZoom(zoom * 1.25)}>＋</button>
                    <button onClick={() => setZoom(1)}>Сброс</button>
                    <label className="symbol-scale">
                      Точки{" "}
                      <input
                        aria-label="Размер обозначений"
                        type="range"
                        min="0.1"
                        max="2"
                        step="0.1"
                        value={symbolScale}
                        onChange={(e) => {
                          const value = +e.target.value;
                          setSymbolScale(value);
                          rememberSymbolScale(project.id, value);
                        }}
                      />
                      <span>{Math.round(symbolScale * 100)}%</span>
                    </label>
                    {page && (
                      <button
                        className={calibrating ? "active" : ""}
                        onClick={() => {
                          setCalibrating(!calibrating);
                          setCalibrationStart(null);
                          setPlacing(false);
                          setLinePoints([]);
                          setLineCursor(null);
                        }}
                      >
                        {calibrating
                          ? calibrationStart
                            ? "Укажите вторую точку"
                            : "Укажите первую точку"
                          : "Масштаб"}
                      </button>
                    )}
                    {page && (
                      <button
                        onClick={() => {
                          const value = prompt(
                            "Название листа",
                            page.name ?? `Лист ${page.number}`,
                          );
                          if (value !== null)
                            void run(async () => {
                              await api(`/pages/${page.id}`, "PATCH", {
                                name: value,
                              });
                              await refresh(project.id);
                            });
                        }}
                      >
                        Название
                      </button>
                    )}
                    <a
                      className="tool-link"
                      href={`/api/projects/${project.id}/backup`}
                    >
                      Резервная копия
                    </a>
                    {page && (
                      <a
                        className="tool-link"
                        href={`/api/projects/${project.id}/pages/${page.id}/export.pdf`}
                      >
                        План PDF
                      </a>
                    )}
                    <label className="upload">
                      Загрузить PDF
                      <input
                        type="file"
                        accept="application/pdf"
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file)
                            void run(async () => {
                              const form = new FormData();
                              form.append("file", file);
                              const pages = await api<Page[]>(
                                `/projects/${project.id}/pdf`,
                                "POST",
                                form,
                              );
                              await refresh(project.id);
                              setPageId(pages[0].id);
                            });
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </div>
                <button
                  className={
                    "label-toggle " + (labelsVisible ? "" : "inactive")
                  }
                  aria-pressed={labelsVisible}
                  onClick={() => setLabelsVisible((value) => !value)}
                >
                  {labelsVisible ? "Скрыть надписи" : "Показать надписи"}
                </button>
                {legend.length > 0 && (
                  <div className="plan-legend">
                    <strong>Обозначения</strong>
                    {legend.map((entry) => (
                      <div key={entry.key}>
                        <span style={{ color: entry.color }}>
                          {entry.symbol}
                        </span>
                        {entry.name}
                      </div>
                    ))}
                  </div>
                )}
                {roomMenu &&
                  (() => {
                    const room = project.rooms.find(
                      (item) => item.id === roomMenu.roomId,
                    );
                    return room ? (
                      <div
                        className="room-context-menu"
                        style={{ left: roomMenu.x, top: roomMenu.y }}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <strong>{room.name}</strong>
                        <button onClick={() => editRoomArea(room)}>
                          Редактировать контур
                        </button>
                        <button
                          onClick={() => void run(() => renameRoom(room))}
                        >
                          Переименовать
                        </button>
                        <button
                          className="danger"
                          onClick={() => void run(() => deleteRoom(room))}
                        >
                          Удалить помещение
                        </button>
                        <button onClick={() => setRoomMenu(null)}>
                          Закрыть
                        </button>
                      </div>
                    ) : null;
                  })()}
                {roomPointMenu && (
                  <div
                    className="room-context-menu"
                    style={{ left: roomPointMenu.x, top: roomPointMenu.y }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <strong>Точки области · {roomPoints.length}</strong>
                    <button
                      onClick={() => {
                        const index = nearestSegmentInsertion(
                          roomPointMenu.point,
                          roomPoints,
                        );
                        setRoomPoints((points) => [
                          ...points.slice(0, index),
                          roomPointMenu.point,
                          ...points.slice(index),
                        ]);
                        setRoomPointMenu(null);
                      }}
                    >
                      Добавить точку здесь
                    </button>
                    <button
                      className="danger"
                      disabled={roomPoints.length <= 3}
                      onClick={() => {
                        const index = nearestVertex(
                          roomPointMenu.point,
                          roomPoints,
                        ).index;
                        setRoomPoints((points) =>
                          points.filter((_, itemIndex) => itemIndex !== index),
                        );
                        setRoomPointMenu(null);
                      }}
                    >
                      Удалить ближайшую точку
                    </button>
                    <button onClick={() => setRoomPointMenu(null)}>
                      Закрыть
                    </button>
                  </div>
                )}
                {objectMenu &&
                  (() => {
                    const item = project.elements.find(
                      (value) => value.id === objectMenu.itemId,
                    );
                    return item ? (
                      <div
                        className="object-context-menu"
                        style={{ left: objectMenu.x, top: objectMenu.y }}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <strong>
                          {contextItems.length > 1
                            ? `Выбрано объектов: ${contextItems.length}`
                            : types.find((type) => type.id === item.type_id)
                                ?.name}
                        </strong>
                        <button
                          onClick={() => {
                            setSelectedIds([item.id]);
                            setSelected(item);
                            setRightPanelVisible(true);
                            setObjectMenu(null);
                          }}
                        >
                          Изменить свойства
                        </button>
                        <button
                          disabled={busy || !contextCanFrame}
                          onClick={() => {
                            setFramePosts(contextItems.length);
                            setObjectMenu(null);
                            void run(() => assignFrame(contextItems.length));
                          }}
                        >
                          Объединить в рамку · {contextItems.length}
                        </button>
                        <button
                          disabled={busy || !contextHasFrame}
                          onClick={() => {
                            setObjectMenu(null);
                            void run(removeFrame);
                          }}
                        >
                          Убрать из рамки
                        </button>
                        <button
                          className="danger"
                          onClick={() => {
                            setObjectMenu(null);
                            void run(removeSelected);
                          }}
                        >
                          Удалить выбранные · Del
                        </button>
                        <button
                          onClick={() => {
                            setSelected(null);
                            setSelectedIds([]);
                            setObjectMenu(null);
                          }}
                        >
                          Снять выделение
                        </button>
                      </div>
                    ) : null;
                  })()}
                <div
                  className="viewport"
                  ref={viewportRef}
                  onPointerDown={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      pan.current = {
                        x: e.clientX,
                        y: e.clientY,
                        left: e.currentTarget.scrollLeft,
                        top: e.currentTarget.scrollTop,
                      };
                    }
                  }}
                  onPointerMove={(e) => {
                    if (pan.current) {
                      e.currentTarget.scrollLeft =
                        pan.current.left - (e.clientX - pan.current.x);
                      e.currentTarget.scrollTop =
                        pan.current.top - (e.clientY - pan.current.y);
                    }
                  }}
                  onPointerUp={() => {
                    pan.current = null;
                  }}
                  onPointerCancel={() => {
                    pan.current = null;
                  }}
                >
                  {page ? (
                    <div
                      ref={sheetRef}
                      className={
                        "sheet" + (alignPageId ? " alignment-active" : "")
                      }
                      style={{
                        width: 850 * zoom,
                        aspectRatio: `${page.width}/${page.height}`,
                      }}
                      onPointerDownCapture={(event) => {
                        if (!alignPageId || event.button !== 0) return;
                        const source = project.pages.find(
                          (item) => item.id === alignPageId,
                        );
                        if (!source) return;
                        event.preventDefault();
                        event.stopPropagation();
                        alignDrag.current = {
                          clientX: event.clientX,
                          clientY: event.clientY,
                          offsetX: source.offset_x ?? 0,
                          offsetY: source.offset_y ?? 0,
                        };
                      }}
                    >
                      {displayedPages.map((source, index) => (
                        <PlanImage
                          pageId={source.id}
                          displayEdge={850 * zoom * (source.scale ?? 1) * Math.max(1, page.height / page.width)}
                          className={
                            "page-overlay-image" +
                            (alignPageId === source.id
                              ? " alignment-target"
                              : "")
                          }
                          key={source.id}
                          draggable={false}
                          alt={`PDF-план, лист ${source.number}`}
                          style={{
                            opacity: source.opacity ?? 1,
                            zIndex: index,
                            transform: `translate(${(source.offset_x ?? 0) * 100}%, ${(source.offset_y ?? 0) * 100}%) scale(${source.scale ?? 1})`,
                          }}
                        />
                      ))}
                      <svg
                        viewBox="0 0 1000 1000"
                        preserveAspectRatio="none"
                        className={
                          placing || calibrating || roomMode ? "placing" : ""
                        }
                        onContextMenu={(e) => {
                          const clicked = sourcePoint(position(e), page.id);
                          setObjectMenu(null);
                          if (roomMode) {
                            e.preventDefault();
                            setRoomPointMenu({
                              point: clicked,
                              x: e.clientX,
                              y: e.clientY,
                            });
                            setRoomMenu(null);
                            return;
                          }
                          const room = [...pageRooms]
                            .reverse()
                            .find((item) =>
                              pointInPolygon(clicked, item.polygon!),
                            );
                          if (room) {
                            e.preventDefault();
                            setRoomMenu({
                              roomId: room.id,
                              x: e.clientX,
                              y: e.clientY,
                            });
                            setRoomPointMenu(null);
                          }
                        }}
                        onPointerDown={(e) => {
                          if (e.button !== 0 || e.target !== e.currentTarget)
                            return;
                          const pos = position(e);
                          setRoomMenu(null);
                          setRoomPointMenu(null);
                          setObjectMenu(null);
                          if (roomMode) {
                            const candidate = roomCandidate(pos, e.shiftKey),
                              first =
                                roomPoints[0] &&
                                pagePoint(roomPoints[0], page.id);
                            if (
                              roomPoints.length >= 3 &&
                              first &&
                              Math.hypot(pos.x - first.x, pos.y - first.y) <=
                                Math.max(0.012, 0.018 * symbolScale)
                            ) {
                              void run(finishRoom);
                              return;
                            }
                            setRoomPoints((points) => [...points, candidate]);
                            setRoomCursor(candidate);
                            return;
                          }
                          if (calibrating && !busy) {
                            if (!calibrationStart) {
                              setCalibrationStart(pos);
                              return;
                            }
                            const raw = prompt(
                              "Реальное расстояние между точками, м",
                            );
                            if (raw === null) return;
                            const real = Number(raw);
                            if (!Number.isFinite(real) || real <= 0) {
                              setError("Введите положительную длину");
                              return;
                            }
                            void run(async () => {
                              await api(`/pages/${page.id}/calibrate`, "POST", {
                                x1: calibrationStart.x,
                                y1: calibrationStart.y,
                                x2: pos.x,
                                y2: pos.y,
                                real_length_m: real,
                              });
                              setCalibrating(false);
                              setCalibrationStart(null);
                              await refresh(project.id);
                            });
                            return;
                          }
                          if (
                            placing &&
                            kind &&
                            layer &&
                            !layer.locked &&
                            !busy
                          ) {
                            if (kind.unit === "м") {
                              setLinePoints([...linePoints, pos]);
                              setLineCursor(pos);
                              return;
                            }
                            void run(async () => {
                              const item = await api<Item>(
                                `/projects/${project.id}/elements`,
                                "POST",
                                {
                                  page_id: page.id,
                                  layer_id: layer.id,
                                  type_id: kind.id,
                                  product_id: null,
                                  room_id: roomId,
                                  x: pos.x,
                                  y: pos.y,
                                  parameters: kind.defaults,
                                  geometry: {},
                                },
                              );
                              setSelected(item);
                              setSelectedIds([item.id]);
                              await refresh(project.id);
                            });
                            return;
                          }
                          setSelectionBox({
                            start: pos,
                            current: pos,
                            additive: e.ctrlKey,
                          });
                          if (!e.ctrlKey) {
                            setSelected(null);
                            setSelectedIds([]);
                          }
                          e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                          const pos = position(e);
                          if (roomMode)
                            setRoomCursor(roomCandidate(pos, e.shiftKey));
                          if (roomNodeDrag.current !== null) {
                            const index = roomNodeDrag.current;
                            setRoomPoints((points) =>
                              points.map((point, itemIndex) =>
                                itemIndex === index
                                  ? sourcePoint(pos, page.id)
                                  : point,
                              ),
                            );
                            return;
                          }
                          if (selectionBox) {
                            setSelectionBox({ ...selectionBox, current: pos });
                            return;
                          }
                          if (
                            placing &&
                            kind?.unit === "м" &&
                            linePoints.length
                          )
                            setLineCursor(pos);
                          if (nodeDrag.current && selected?.geometry?.points) {
                            const points = selected.geometry.points.map(
                              (point, index) =>
                                index === nodeDrag.current?.index
                                  ? sourcePoint(pos, selected.page_id)
                                  : point,
                            );
                            setSelected({
                              ...selected,
                              x:
                                nodeDrag.current.index === 0
                                  ? points[0].x
                                  : selected.x,
                              y:
                                nodeDrag.current.index === 0
                                  ? points[0].y
                                  : selected.y,
                              geometry: { ...selected.geometry, points },
                            });
                          } else if (drag.current && selected)
                            setSelected({
                              ...selected,
                              ...sourcePoint(pos, selected.page_id),
                            });
                        }}
                        onPointerLeave={() => {
                          setLineCursor(null);
                          setRoomCursor(null);
                        }}
                        onPointerUp={() => {
                          if (roomNodeDrag.current !== null) {
                            roomNodeDrag.current = null;
                            return;
                          }
                          if (selectionBox) {
                            const x1 = Math.min(
                                selectionBox.start.x,
                                selectionBox.current.x,
                              ),
                              x2 = Math.max(
                                selectionBox.start.x,
                                selectionBox.current.x,
                              ),
                              y1 = Math.min(
                                selectionBox.start.y,
                                selectionBox.current.y,
                              ),
                              y2 = Math.max(
                                selectionBox.start.y,
                                selectionBox.current.y,
                              ),
                              inside = visibleElements
                                .filter(
                                  (item) =>
                                    isElectrical(
                                      types.find(
                                        (type) => type.id === item.type_id,
                                      ),
                                    ) &&
                                    !item.geometry?.points?.length &&
                                    (() => {
                                      const point = pagePoint(
                                        item,
                                        item.page_id,
                                      );
                                      return (
                                        point.x >= x1 &&
                                        point.x <= x2 &&
                                        point.y >= y1 &&
                                        point.y <= y2
                                      );
                                    })(),
                                )
                                .map((item) => item.id),
                              ids = selectionBox.additive
                                ? [...new Set([...selectedIds, ...inside])]
                                : inside;
                            setSelectedIds(ids);
                            setSelected(
                              project.elements.find(
                                (item) => item.id === ids.at(-1),
                              ) ?? null,
                            );
                            setFramePosts(Math.min(6, Math.max(1, ids.length)));
                            setSelectionBox(null);
                            return;
                          }
                          if (nodeDrag.current && selected) {
                            nodeDrag.current = null;
                            void run(() => save(selected));
                            return;
                          }
                          if (drag.current && selected) {
                            const start = drag.current;
                            drag.current = null;
                            if (
                              start.x !== selected.x ||
                              start.y !== selected.y
                            )
                              void run(() => save(selected));
                          }
                        }}
                        onPointerCancel={() => {
                          drag.current = null;
                          nodeDrag.current = null;
                          roomNodeDrag.current = null;
                          setSelectionBox(null);
                          setLineCursor(null);
                          setRoomCursor(null);
                        }}
                      >
                        {roomMode && roomPoints.length > 0 && (
                          <g className="room-polygon-editor">
                            <polygon
                              points={roomPoints
                                .map((point) => {
                                  const display = pagePoint(point, page.id);
                                  return `${display.x * 1000},${display.y * 1000}`;
                                })
                                .join(" ")}
                            />
                            {roomCursor &&
                              (() => {
                                const last = pagePoint(
                                    roomPoints.at(-1)!,
                                    page.id,
                                  ),
                                  cursor = pagePoint(roomCursor, page.id);
                                return (
                                  <line
                                    className="room-preview-line"
                                    x1={last.x * 1000}
                                    y1={last.y * 1000}
                                    x2={cursor.x * 1000}
                                    y2={cursor.y * 1000}
                                  />
                                );
                              })()}
                            {roomPoints.map((point, index) => {
                              const display = pagePoint(point, page.id),
                                radius = Math.max(5, 11 * symbolScale);
                              return (
                                <g key={index}>
                                  <circle
                                    className={
                                      index === 0 ? "room-close-node" : ""
                                    }
                                    cx={display.x * 1000}
                                    cy={display.y * 1000}
                                    r={radius}
                                    onPointerDown={(e) => {
                                      if (e.button !== 0) return;
                                      e.stopPropagation();
                                      if (
                                        roomMode === "new" &&
                                        index === 0 &&
                                        roomPoints.length >= 3
                                      ) {
                                        void run(finishRoom);
                                        return;
                                      }
                                      e.currentTarget.ownerSVGElement?.setPointerCapture(
                                        e.pointerId,
                                      );
                                      roomNodeDrag.current = index;
                                    }}
                                  />
                                  <text
                                    className="room-node-number"
                                    x={display.x * 1000 + radius + 4}
                                    y={display.y * 1000 - radius - 3}
                                  >
                                    {index + 1}
                                  </text>
                                </g>
                              );
                            })}
                            <text x="500" y="34" textAnchor="middle">
                              {editingRoomId
                                ? `Редактирование: ${project.rooms.find((room) => room.id === editingRoomId)?.name}`
                                : "Новая область помещения"}{" "}
                              · точек: {roomPoints.length} · Shift — строго по
                              оси · клик по точке 1 — замкнуть
                            </text>
                          </g>
                        )}
                        {frameVisuals.map((frame) => (
                          <rect
                            className="frame-group-outline"
                            key={frame.group}
                            x={frame.x}
                            y={frame.y}
                            width={frame.width}
                            height={frame.height}
                            rx={8 * symbolScale}
                            fill="#fff7ed"
                            fillOpacity={0.35}
                            stroke="#fb923c"
                            strokeWidth={
                              selectedIds.some((id) =>
                                frame.members.some((item) => item.id === id),
                              )
                                ? 5
                                : 3
                            }
                            opacity={frame.opacity}
                            vectorEffect="non-scaling-stroke"
                          />
                        ))}
                        {visibleElements.map((original) => {
                          const item =
                              selected?.id === original.id
                                ? selected
                                : original,
                            t = types.find((type) => type.id === item.type_id),
                            points = item.geometry?.points ?? [],
                            transformed = points.map((point) =>
                              pagePoint(point, item.page_id),
                            ),
                            opacity =
                              project.pages.find(
                                (source) => source.id === item.page_id,
                              )?.opacity ?? 1,
                            isSelected = selectedIds.includes(item.id);
                          if (points.length > 1) {
                            const coords = transformed
                                .map((p) => `${p.x * 1000},${p.y * 1000}`)
                                .join(" "),
                              anchor = transformed[0],
                              editable =
                                isSelected &&
                                !project.layers.find(
                                  (l) => l.id === item.layer_id,
                                )?.locked,
                              track = isTrack(t);
                            return (
                              <g
                                key={item.id}
                                className={isSelected ? "selected-line-object" : ""}
                                opacity={isSelected ? 1 : opacity}
                                onContextMenu={(e) => showObjectMenu(item, e)}
                                onDoubleClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  selectSameType(item);
                                }}
                                onPointerDown={(e) => {
                                  if (e.button !== 0) return;
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (objectDoubleClick(item)) return;
                                  choose(item, e.ctrlKey);
                                }}
                              >
                                {isSelected && (
                                  <polyline
                                    className="selection-line-halo"
                                    points={coords}
                                    fill="none"
                                    stroke="#0284c7"
                                    strokeWidth="18"
                                    strokeOpacity=".45"
                                    vectorEffect="non-scaling-stroke"
                                  />
                                )}
                                <polyline
                                  points={coords}
                                  fill="none"
                                  stroke={t?.color}
                                  strokeWidth={isSelected ? 9 : 6}
                                  vectorEffect="non-scaling-stroke"
                                />
                                {track
                                  ? transformed.map((point, index) => (
                                      <path
                                        className={
                                          editable ? "line-node" : "track-arrow"
                                        }
                                        key={index}
                                        d={`M ${-13 * symbolScale} ${-9 * symbolScale} L ${13 * symbolScale} 0 L ${-13 * symbolScale} ${9 * symbolScale} Z`}
                                        transform={`translate(${point.x * 1000} ${point.y * 1000}) rotate(${pointAngle(transformed, index)})`}
                                        fill={t?.color}
                                        stroke="white"
                                        strokeWidth="3"
                                        vectorEffect="non-scaling-stroke"
                                        onPointerDown={(e) => {
                                          if (
                                            !editable ||
                                            e.button !== 0 ||
                                            busy
                                          )
                                            return;
                                          e.stopPropagation();
                                          choose(item, false);
                                          e.currentTarget.ownerSVGElement?.setPointerCapture(
                                            e.pointerId,
                                          );
                                          nodeDrag.current = { index, point };
                                        }}
                                      />
                                    ))
                                  : editable &&
                                    transformed.map((point, index) => (
                                      <circle
                                        className="line-node"
                                        key={index}
                                        cx={point.x * 1000}
                                        cy={point.y * 1000}
                                        r={13 * symbolScale}
                                        fill="white"
                                        stroke={t?.color}
                                        strokeWidth="5"
                                        vectorEffect="non-scaling-stroke"
                                        onPointerDown={(e) => {
                                          if (e.button !== 0 || busy) return;
                                          e.stopPropagation();
                                          choose(item, false);
                                          e.currentTarget.ownerSVGElement?.setPointerCapture(
                                            e.pointerId,
                                          );
                                          nodeDrag.current = { index, point };
                                        }}
                                      />
                                    ))}
                                {labelsVisible && (
                                  <text
                                    className="object-label"
                                    x={anchor.x * 1000 + 18 * symbolScale}
                                    y={anchor.y * 1000 - 10 * symbolScale}
                                    fontSize="14"
                                    fill="#0f172a"
                                    stroke="white"
                                    strokeWidth="3"
                                    paintOrder="stroke"
                                  >
                                    {t?.name} #{item.id} ·{" "}
                                    {String(item.parameters.length)} м
                                  </text>
                                )}
                              </g>
                            );
                          }
                          const marker = pagePoint(item, item.page_id),
                            planIcon = String(
                              item.parameters.plan_icon ?? "",
                            ).trim();
                          return (
                            <g
                              key={item.id}
                              className={isSelected ? "selected-point-object" : ""}
                              opacity={isSelected ? 1 : opacity}
                              transform={`translate(${marker.x * 1000},${marker.y * 1000})`}
                              onContextMenu={(e) => showObjectMenu(item, e)}
                              onDoubleClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                selectSameType(item);
                              }}
                              onPointerDown={(e) => {
                                if (e.button !== 0) return;
                                e.preventDefault();
                                e.stopPropagation();
                                if (objectDoubleClick(item)) return;
                                choose(item, e.ctrlKey);
                                if (
                                  !e.ctrlKey &&
                                  !project.layers.find(
                                    (l) => l.id === item.layer_id,
                                  )?.locked &&
                                  !busy
                                ) {
                                  e.currentTarget.ownerSVGElement?.setPointerCapture(
                                    e.pointerId,
                                  );
                                  drag.current = { x: item.x, y: item.y };
                                }
                              }}
                            >
                              <PointMarker
                                scale={symbolScale}
                                color={String(
                                  item.parameters.plan_color ??
                                    t?.color ??
                                    "#64748b",
                                )}
                                selected={isSelected}
                                icon={planIcon}
                              />
                              {labelsVisible && (
                                <text
                                  className="object-label"
                                  x={17 * symbolScale}
                                  y="5"
                                  fontSize="14"
                                  fill="#0f172a"
                                  stroke="white"
                                  strokeWidth="3"
                                  paintOrder="stroke"
                                >
                                  {t?.name} #{item.id}
                                </text>
                              )}
                            </g>
                          );
                        })}
                        {selectionBox && (
                          <rect
                            className="selection-box"
                            x={
                              Math.min(
                                selectionBox.start.x,
                                selectionBox.current.x,
                              ) * 1000
                            }
                            y={
                              Math.min(
                                selectionBox.start.y,
                                selectionBox.current.y,
                              ) * 1000
                            }
                            width={
                              Math.abs(
                                selectionBox.current.x - selectionBox.start.x,
                              ) * 1000
                            }
                            height={
                              Math.abs(
                                selectionBox.current.y - selectionBox.start.y,
                              ) * 1000
                            }
                          />
                        )}
                        {alignPageId && (
                          <g className="alignment-mode">
                            <rect
                              x="0"
                              y="0"
                              width="1000"
                              height="1000"
                              fill="transparent"
                            />
                            <text x="500" y="35" textAnchor="middle">
                              Перетаскивайте активный слой · затем нажмите ОК
                            </text>
                          </g>
                        )}
                        {linePoints.length > 0 && (
                          <g className="line-preview">
                            <polyline
                              points={previewPoints
                                .map(
                                  (point) =>
                                    `${point.x * 1000},${point.y * 1000}`,
                                )
                                .join(" ")}
                              fill="none"
                              stroke="#16a085"
                              strokeWidth="6"
                              strokeDasharray="12 8"
                              vectorEffect="non-scaling-stroke"
                            />
                            {isTrack(kind)
                              ? linePoints.map((point, index) => (
                                  <path
                                    key={index}
                                    d={`M ${-12 * symbolScale} ${-8 * symbolScale} L ${12 * symbolScale} 0 L ${-12 * symbolScale} ${8 * symbolScale} Z`}
                                    transform={`translate(${point.x * 1000} ${point.y * 1000}) rotate(${pointAngle(previewPoints, index)})`}
                                    fill="#16a085"
                                  />
                                ))
                              : linePoints.map((point, index) => (
                                  <circle
                                    key={index}
                                    cx={point.x * 1000}
                                    cy={point.y * 1000}
                                    r={10 * symbolScale}
                                    fill="#16a085"
                                  />
                                ))}
                          </g>
                        )}
                        {calibrationStart && (
                          <circle
                            cx={calibrationStart.x * 1000}
                            cy={calibrationStart.y * 1000}
                            r={12 * symbolScale}
                            fill="#dc2626"
                          />
                        )}
                      </svg>
                    </div>
                  ) : (
                    <div className="empty">
                      <div className="pdf-icon">PDF</div>
                      <h2>Добавьте план проекта</h2>
                      <p>
                        До 100 страниц · PDF до 500 МБ
                        <br />
                        Каждая страница станет рабочим листом
                      </p>
                    </div>
                  )}
                </div>
              </section>
              {rightPanelVisible && (
                <aside className="right">
                  <h3>Страницы-слои · {project.pages.length}</h3>
                  <div className="page-bulk-actions">
                    <button
                      disabled={!deletablePageIds.length || busy}
                      onClick={() => setCheckedPageIds(deletablePageIds)}
                    >
                      Выбрать без ЭУИ/света
                    </button>
                    <button
                      className="bulk-delete"
                      disabled={!checkedPageIds.length || busy}
                      onClick={() => void run(deleteCheckedPages)}
                    >
                      Удалить ({checkedPageIds.length})
                    </button>
                  </div>
                  <div className="pages page-layers">
                    {project.pages.map((p) => (
                      <div
                        className={
                          "page-layer " + (pageId === p.id ? "active" : "")
                        }
                        key={p.id}
                      >
                        <label
                          className="page-check"
                          title={
                            protectedPageIds.has(p.id)
                              ? "На странице есть электроустановки или освещение"
                              : "Выбрать страницу"
                          }
                        >
                          <input
                            aria-label={`Выбрать страницу ${p.name || `Лист ${p.number}`}`}
                            type="checkbox"
                            disabled={protectedPageIds.has(p.id)}
                            checked={checkedPageIds.includes(p.id)}
                            onChange={(e) =>
                              setCheckedPageIds((ids) =>
                                e.target.checked
                                  ? [...ids, p.id]
                                  : ids.filter((id) => id !== p.id),
                              )
                            }
                          />
                        </label>
                        <button
                          className="page"
                          onClick={() => {
                            cancelAlignment();
                            setPageId(p.id);
                            setRoomMode(null);
                            setRoomPoints([]);
                            setEditingRoomId(null);
                            setRoomMenu(null);
                            setRoomPointMenu(null);
                            setSelected(null);
                            setSelectedIds([]);
                            setLinePoints([]);
                            setLineCursor(null);
                            setCalibrationStart(null);
                          }}
                        >
                          <img src={`/api/pages/${p.id}/image`} alt="" />
                          <span>{p.name || `Лист ${p.number}`}</span>
                        </button>
                        <div className="page-layer-controls">
                          <button
                            aria-label={`Наложение ${p.name || `Лист ${p.number}`}`}
                            disabled={p.id === pageId || alignPageId === p.id}
                            title={
                              p.id === pageId
                                ? "Текущая основа"
                                : "Показывать поверх текущей страницы"
                            }
                            onClick={() => {
                              const overlay_visible = !p.overlay_visible;
                              localPage(p.id, { overlay_visible });
                              void savePage(p.id, { overlay_visible }).catch(
                                (error) =>
                                  setError(
                                    error instanceof Error
                                      ? error.message
                                      : "Ошибка",
                                  ),
                              );
                            }}
                          >
                            {p.id === pageId
                              ? "Основа"
                              : p.overlay_visible
                                ? "◉ Наложен"
                                : "○ Скрыт"}
                          </button>
                          <label>
                            Прозрачность{" "}
                            <input
                              aria-label={`Прозрачность страницы ${p.name || `Лист ${p.number}`}`}
                              type="range"
                              min="0.05"
                              max="1"
                              step="0.05"
                              disabled={alignPageId !== p.id}
                              value={p.opacity ?? 1}
                              onChange={(e) => {
                                const opacity = +e.target.value;
                                localPage(p.id, { opacity });
                              }}
                            />
                            <span>{Math.round((p.opacity ?? 1) * 100)}%</span>
                          </label>
                          <label>
                            Масштаб{" "}
                            <input
                              aria-label={`Масштаб страницы ${p.name || `Лист ${p.number}`}`}
                              type="range"
                              min="0.1"
                              max="5"
                              step="0.01"
                              disabled={alignPageId !== p.id}
                              value={p.scale ?? 1}
                              onChange={(e) => {
                                const scale = +e.target.value;
                                localPage(p.id, { scale });
                              }}
                            />
                            <span>{Math.round((p.scale ?? 1) * 100)}%</span>
                          </label>
                          {p.id !== pageId && (
                            <button
                              className={alignPageId === p.id ? "active" : ""}
                              onClick={() => {
                                if (alignPageId === p.id) cancelAlignment();
                                else startAlignment(p);
                              }}
                            >
                              {alignPageId === p.id
                                ? "Отмена"
                                : p.overlay_visible
                                  ? "Изменить наложение"
                                  : "Настроить наложение"}
                            </button>
                          )}
                          {alignPageId === p.id && (
                            <button
                              className="overlay-apply"
                              disabled={busy}
                              onClick={() => void run(applyAlignment)}
                            >
                              ✓ ОК
                            </button>
                          )}
                          {alignPageId === p.id && (
                            <div className="overlay-nudge">
                              <strong>
                                Зажмите левую кнопку на плане и тяните слой
                              </strong>
                              <label className="overlay-field">
                                Масштаб, %
                                <input
                                  aria-label={`Точный масштаб страницы ${p.name || `Лист ${p.number}`}`}
                                  type="number"
                                  min="10"
                                  max="500"
                                  step="1"
                                  value={Math.round((p.scale ?? 1) * 100)}
                                  onChange={(event) =>
                                    localPage(p.id, {
                                      scale: Math.max(
                                        0.1,
                                        Math.min(5, +event.target.value / 100),
                                      ),
                                    })
                                  }
                                />
                              </label>
                              <label className="overlay-field">
                                Прозрачность, %
                                <input
                                  aria-label={`Точная прозрачность страницы ${p.name || `Лист ${p.number}`}`}
                                  type="number"
                                  min="5"
                                  max="100"
                                  step="1"
                                  value={Math.round((p.opacity ?? 1) * 100)}
                                  onChange={(event) =>
                                    localPage(p.id, {
                                      opacity: Math.max(
                                        0.05,
                                        Math.min(1, +event.target.value / 100),
                                      ),
                                    })
                                  }
                                />
                              </label>
                              <span>
                                Сдвиг: X {Math.round((p.offset_x ?? 0) * 100)}% ·
                                Y {Math.round((p.offset_y ?? 0) * 100)}%
                              </span>
                              <button
                                aria-label="Сдвинуть наложение влево"
                                onClick={() => nudgeAlignment(-0.01, 0)}
                              >
                                ←
                              </button>
                              <button
                                aria-label="Сдвинуть наложение вверх"
                                onClick={() => nudgeAlignment(0, -0.01)}
                              >
                                ↑
                              </button>
                              <button
                                aria-label="Сдвинуть наложение вниз"
                                onClick={() => nudgeAlignment(0, 0.01)}
                              >
                                ↓
                              </button>
                              <button
                                aria-label="Сдвинуть наложение вправо"
                                onClick={() => nudgeAlignment(0.01, 0)}
                              >
                                →
                              </button>
                            </div>
                          )}
                          <button
                            disabled={alignPageId !== p.id}
                            onClick={() => {
                              localPage(p.id, {
                                offset_x: 0,
                                offset_y: 0,
                                scale: 1,
                              });
                            }}
                          >
                            Сброс
                          </button>
                          <button
                            className="delete-page"
                            title="Можно удалить только страницу без электроустановок и освещения"
                            onClick={() => void run(() => deletePage(p))}
                          >
                            Удалить страницу
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <h3>Выбранные объекты</h3>
                  {selectedIds.length > 0 ? (
                    <div className="frame-editor">
                      <strong>Выбрано: {selectedIds.length}</strong>
                      <p className="hint">
                        Выделяйте рамкой мыши или Ctrl + щелчок. Для рамки число
                        объектов должно совпадать с числом постов.
                      </p>
                      <label>
                        Количество постов
                        <select
                          aria-label="Количество постов рамки"
                          value={framePosts}
                          onChange={(e) => setFramePosts(+e.target.value)}
                        >
                          {[1, 2, 3, 4, 5, 6].map((posts) => (
                            <option key={posts} value={posts}>
                              {posts}{" "}
                              {posts === 1
                                ? "пост"
                                : posts < 5
                                  ? "поста"
                                  : "постов"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void run(assignFrame)}
                      >
                        Назначить рамку
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void run(removeFrame)}
                      >
                        Убрать рамку
                      </button>
                      <button
                        className="danger"
                        disabled={busy}
                        title="Delete"
                        onClick={() => void run(removeSelected)}
                      >
                        Удалить выбранные · Del
                      </button>
                    </div>
                  ) : (
                    <p className="hint">
                      Выделите объекты рамкой мыши или кликами с зажатым Ctrl.
                    </p>
                  )}
                  <h3>Свойства объекта</h3>
                  {selected && selectedIds.length === 1 ? (
                    <>
                      <div className="object-title">
                        <button
                          type="button"
                          className="object-focus"
                          title="Показать объект на плане. Двойной щелчок — выбрать все объекты этой номенклатуры"
                          onClick={() => focusItem(selected)}
                          onDoubleClick={() => selectSameType(selected)}
                        >
                          {selectedKind?.name}
                        </button>
                        <button
                          type="button"
                          className={typeEditorOpen ? "active" : ""}
                          aria-label="Изменить номенклатуру"
                          title="Изменить номенклатуру"
                          disabled={
                            busy ||
                            project.layers.find(
                              (layer) => layer.id === selected.layer_id,
                            )?.locked
                          }
                          onClick={() => setTypeEditorOpen((value) => !value)}
                        >
                          ✓
                        </button>
                      </div>
                      {typeEditorOpen && (
                        <label className="nomenclature-editor">
                          Номенклатура для замены
                          <select
                            autoFocus
                            aria-label="Номенклатура объекта"
                            value={selected.type_id}
                            onChange={(e) => {
                              changeSelectedType(+e.target.value);
                              setTypeEditorOpen(false);
                            }}
                          >
                            {[
                              ...new Set(
                                types
                                  .filter(
                                    (type) => type.unit === selectedKind?.unit,
                                  )
                                  .map((type) => type.category),
                              ),
                            ].map((category) => (
                              <optgroup key={category} label={category}>
                                {types
                                  .filter(
                                    (type) =>
                                      type.unit === selectedKind?.unit &&
                                      type.category === category,
                                  )
                                  .map((type) => (
                                    <option key={type.id} value={type.id}>
                                      {type.name}
                                    </option>
                                  ))}
                              </optgroup>
                            ))}
                          </select>
                          <small>
                            При замене привязка к товару будет сброшена.
                          </small>
                        </label>
                      )}
                      <small>
                        №{selected.id} · X {selected.x.toFixed(3)} / Y{" "}
                        {selected.y.toFixed(3)}
                        {selected.geometry?.points?.length
                          ? ` · ${selected.geometry.points.length} узла`
                          : ""}
                      </small>
                      {selected.geometry?.points?.length && (
                        <p className="hint">
                          Перетаскивайте{" "}
                          {isTrack(selectedKind) ? "стрелочные" : "белые"} узлы
                          линии на плане. Длина пересчитается автоматически.
                        </p>
                      )}
                      <label>
                        Помещение
                        <select
                          aria-label="Помещение объекта"
                          value={selected.room_id ?? ""}
                          onChange={(e) =>
                            setSelected({
                              ...selected,
                              room_id: e.target.value ? +e.target.value : null,
                            })
                          }
                        >
                          <option value="">Без помещения</option>
                          {project.rooms.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Товар
                        <select
                          aria-label="Товар объекта"
                          value={selected.product_id ?? ""}
                          onChange={(e) =>
                            setSelected({
                              ...selected,
                              product_id: e.target.value
                                ? +e.target.value
                                : null,
                            })
                          }
                        >
                          <option value="">Без привязки к товару</option>
                          {catalog.products
                            .filter(
                              (p) => p.type_id === selected.type_id && p.active,
                            )
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.manufacturer} · {p.name} · {p.price}{" "}
                                {p.currency}
                              </option>
                            ))}
                        </select>
                      </label>
                      {isElectrical(selectedKind) && (
                        <label>
                          Иконка на плане
                          <input
                            aria-label="Иконка электроустановки"
                            list="plan-icon-options"
                            maxLength={4}
                            placeholder="Например: R, TV, ⚡"
                            value={String(selected.parameters.plan_icon ?? "")}
                            onChange={(e) =>
                              setSelected({
                                ...selected,
                                parameters: {
                                  ...selected.parameters,
                                  plan_icon: e.target.value,
                                },
                              })
                            }
                          />
                          <datalist id="plan-icon-options">
                            <option value="R" />
                            <option value="S" />
                            <option value="TV" />
                            <option value="USB" />
                            <option value="HDMI" />
                            <option value="⚡" />
                            <option value="⊗" />
                            <option value="◉" />
                          </datalist>
                        </label>
                      )}
                      {isElectrical(selectedKind) && (
                        <label>
                          Цвет точки
                          <span className="color-editor">
                            <input
                              aria-label="Цвет обозначения электроустановки"
                              type="color"
                              value={String(
                                selected.parameters.plan_color ??
                                  selectedKind?.color ??
                                  "#64748b",
                              )}
                              onChange={(e) =>
                                setSelected({
                                  ...selected,
                                  parameters: {
                                    ...selected.parameters,
                                    plan_color: e.target.value,
                                  },
                                })
                              }
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const parameters = { ...selected.parameters };
                                delete parameters.plan_color;
                                setSelected({ ...selected, parameters });
                              }}
                            >
                              По умолчанию
                            </button>
                          </span>
                        </label>
                      )}
                      {Object.entries(selected.parameters)
                        .filter(
                          ([key]) =>
                            ![
                              "frame_posts",
                              "frame_group",
                              "plan_icon",
                              "plan_color",
                            ].includes(key),
                        )
                        .map(([key, value]) => (
                          <label key={key}>
                            {labels[key] ?? key}
                            <input
                              value={String(value)}
                              disabled={
                                key === "length" &&
                                Boolean(selected.geometry?.points?.length)
                              }
                              type={
                                typeof value === "number" ? "number" : "text"
                              }
                              min={typeof value === "number" ? 0 : undefined}
                              step="any"
                              onChange={(e) =>
                                setSelected({
                                  ...selected,
                                  parameters: {
                                    ...selected.parameters,
                                    [key]:
                                      typeof value === "number"
                                        ? Number(e.target.value)
                                        : e.target.value,
                                  },
                                })
                              }
                            />
                          </label>
                        ))}
                      <label>
                        Комментарий
                        <textarea
                          value={selected.comment}
                          onChange={(e) =>
                            setSelected({
                              ...selected,
                              comment: e.target.value,
                            })
                          }
                        />
                      </label>
                      <p className="autosave-note">
                        {busy ? "Сохранение…" : "Изменения сохраняются автоматически"}
                      </p>
                    </>
                  ) : selectedIds.length > 1 ? (
                    <p className="hint">
                      Для нескольких объектов доступны операции с рамкой и
                      удаление.
                    </p>
                  ) : (
                    <p className="hint">
                      Выберите объект на плане, чтобы изменить параметры.
                    </p>
                  )}
                </aside>
              )}
            </main>
          ) : (
            <section className="report report-view">
              <div className="report-head">
                <div>
                  <div className="eyebrow">СПЕЦИФИКАЦИЯ ПРОЕКТА</div>
                  <h2>
                    Ведомость оборудования{" "}
                    <small>{project.elements.length} объектов</small>
                  </h2>
                </div>
                <div>
                  <a href={`/api/projects/${project.id}/export/xlsx`}>
                    ↓ Excel
                  </a>
                  <a href={`/api/projects/${project.id}/export/pdf`}>↓ PDF</a>
                  <button onClick={() => window.print()}>Печать</button>
                </div>
              </div>
              {report.warnings.map((w) => (
                <p className="warning" key={w}>
                  ⚠ {w}
                </p>
              ))}
              <div className="report-rooms">
                {[...new Set(report.rows.map((row) => row.room))].map(
                  (room) => (
                    <section className="report-room" key={room}>
                      <h3>Помещение: {room}</h3>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Раздел</th>
                              <th>Оборудование / товар</th>
                              <th>Количество</th>
                              <th>Цена</th>
                              <th>Сумма</th>
                              <th>Параметры</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.rows
                              .filter((row) => row.room === room)
                              .map((row, index) => (
                                <tr
                                  className={
                                    row.category === "Рамки" ? "frame-row" : ""
                                  }
                                  key={index}
                                >
                                  <td>{row.category}</td>
                                  <td>
                                    {row.name}
                                    {row.product && (
                                      <small className="product">
                                        <br />
                                        {row.manufacturer} · {row.product} ·{" "}
                                        {row.sku}
                                      </small>
                                    )}
                                  </td>
                                  <td>
                                    {row.quantity} {row.unit}
                                  </td>
                                  <td>
                                    {row.unit_price
                                      ? `${row.unit_price} ${row.currency}`
                                      : "—"}
                                  </td>
                                  <td>
                                    {row.total
                                      ? `${row.total} ${row.currency}`
                                      : "—"}
                                  </td>
                                  <td className="params">
                                    {Object.entries(JSON.parse(row.parameters))
                                      .map(
                                        ([key, value]) =>
                                          `${labels[key] ?? key}: ${value}`,
                                      )
                                      .join(" · ") || "—"}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                      {report.summary.rooms.find((item) => item.room === room) && (
                        <div className="room-summary">
                          <h4>Итог по помещению: {room}</h4>
                          <ReportTotals categories={report.summary.rooms.find((item) => item.room === room)!.categories} />
                        </div>
                      )}
                    </section>
                  ),
                )}
                {!report.rows.length && (
                  <p className="hint">
                    Добавьте элементы на план — ведомость заполнится
                    автоматически.
                  </p>
                )}
              </div>
              {report.summary.categories.length > 0 && (
                <section className="report-summary">
                  <div className="eyebrow">ПОЛНЫЙ ИТОГ</div>
                  <h3>Итоги по всем помещениям</h3>
                  <ReportTotals categories={report.summary.categories} />
                </section>
              )}
            </section>
          )}
        </>
      )}
      <footer>
        <span>SMART HOME CALC / 1.0.27</span>
        <span>
          {busy ? "Сохранение…" : "Офлайн-режим · данные на этом компьютере"}
        </span>
      </footer>
    </div>
  );
}
