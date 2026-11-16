import {api,errorMessage} from "./errors";
import LayerTree from "./LayerTree";
import {planGroup,layerGroups,displayedElement} from "./planGroups";
import {useDesktopState} from "./desktopBridge";
import usePlanWindow from "./usePlanWindow";
import usePlanCamera from "./usePlanCamera";
import PlanStatusBar,{type PlanStatusHandle} from "./PlanStatusBar";
import useRafState from "./useRafState";
import usePreference from "./usePreference";
import {VertexIndex,orthogonal,selectionHits,measuredLength} from "./planGeometry";
import PlanLegend,{type LegendEntry} from "./PlanLegend";
import {shareProject} from "./projectState";
import PlanScene from "./PlanScene";
import useStableCallback from "./useStableCallback";
import {isElectrical,isPowerSupply,isLedStrip,isTrack} from "./planDomain";
import CategoryEditor,{type Category} from "./CategoryEditor";
import ImageField,{imagePaste,prepareImage,imageDrop,imageDragOver} from "./ImageField";
import SearchInput from "./SearchInput";
import ToolRail, {ToolButton,ActionIcon} from "./ToolRail";
import {AppearanceEditor,CustomFieldsEditor,CoordinateEditor,PlanSymbol,PointMarker,appearanceKeys} from "./PlanAppearance";
import SearchSelect, {matchesSearch,SearchHighlight} from "./SearchSelect";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import QuotationEditor from "./QuotationEditor";
import QuotationHub from "./QuotationHub";
export type Point = { x: number; y: number };
export type Page = {
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
export type Layer = {
  seed_key?:string|null;
  hidden_groups?:string[];
  id: number;
  name: string;
  visible: boolean;
  locked: boolean;
  export: boolean;
  opacity: number;
};
export type Kind = {
  active: boolean;
  seed_key: string | null;
  wet_min_ip: number | null;
  id: number;
  name: string;
  category: string;
  group?: string;
  unit: string;
  color: string;
  defaults: Record<string, unknown>;
};
function groupKinds(types:Kind[]) {
  const groups=new Map<string,Kind[]>();
  for(const type of types) {
    const group=type.group ?? type.category;
    if(!groups.has(group))groups.set(group,[]);
    groups.get(group)!.push(type);
  }
  return [...groups].map(([label,items])=>({label,items}));
}
const KindOptions=memo(function KindOptions({types,showUnits=false}:{types:Kind[];showUnits?:boolean}) {
  return <>{groupKinds(types).map(group=><optgroup key={group.label} label={group.label}>{group.items.map(type=><option key={type.id} value={type.id} data-symbol-name={type.name} data-symbol-category={type.category} data-symbol-unit={type.unit} data-symbol-seed={type.seed_key??''} data-symbol-color={type.color}>{type.name}{showUnits ? ` (${type.unit})` : ""}</option>)}</optgroup>)}</>;
});
export type Item = {
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
export type Project = {
  history?:{undo:number;redo:number};
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
  categories?:Category[];
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

const labels: Record<string, string> = {
  power_watts: "Мощность, Вт",
  led_strip: "Питает ленты",
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
  keys: "Клавиш",
  contact_type: "Контакт",
  switch_action: "Механизм",
  backlight: "Подсветка",
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
function powerStripIds(parameters:Record<string,unknown>):number[] {
  return Array.isArray(parameters.led_strip_ids) ? parameters.led_strip_ids.map(Number) : parameters.led_strip_id ? [Number(parameters.led_strip_id)] : [];
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
function nearestSegmentInsertion(point: Point, polygon: Point[], dimensions = { x: 1, y: 1 }) {
  point = { x: point.x * dimensions.x, y: point.y * dimensions.y };
  polygon = polygon.map(vertex => ({ x: vertex.x * dimensions.x, y: vertex.y * dimensions.y }));
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
  const on = (p: Point, q: Point, r: Point) => orientation(p, q, r) === 0 &&
    r.x >= Math.min(p.x, q.x) - 1e-10 && r.x <= Math.max(p.x, q.x) + 1e-10 &&
    r.y >= Math.min(p.y, q.y) - 1e-10 && r.y <= Math.max(p.y, q.y) + 1e-10;
  return (orientation(a, b, c) !== orientation(a, b, d) &&
    orientation(c, d, a) !== orientation(c, d, b)) ||
    on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}
function polygonSelfIntersects(points: Point[]) {
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  if (Math.abs(area) <= 1e-10 || new Set(points.map(point => `${point.x}:${point.y}`)).size !== points.length) return true;
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
function makeLegend(
  project: Project,
  pageIds: Set<number>,
  types: Kind[],
): LegendEntry[] {
  const entries = new Map<string, LegendEntry>();
  const frameCounts=new Map<number,Set<string>>();
  const kinds=new Map(types.map(type=>[type.id,type])),layers=new Map(project.layers.map(layer=>[layer.id,layer])),ranks=new Map(types.map((type,index)=>[type.name,index]));
  for (const item of project.elements) {
    if (
      !pageIds.has(item.page_id) ||
      !layers.get(item.layer_id)?.visible
    )
      continue;
    const kind = kinds.get(item.type_id);
    if (!kind) continue;
    const icon = String(item.parameters.plan_icon ?? "").trim(),
      symbol = isPowerSupply(kind) ? "▭" : icon || (isTrack(kind) ? "➜" : kind.unit === "м" ? "━" : "●"),
      color = String(item.parameters.plan_color ?? kind.color),
      key = `${kind.id}:${symbol}:${color}:${item.parameters.plan_shape??''}:${item.parameters.display_name??''}`;
    const previous=entries.get(key);
    entries.set(key, { key, name: String(item.parameters.display_name||kind.name), color, symbol,kind,parameters:item.parameters,count:(previous?.count??0)+1 });
    if (item.parameters.frame_group) {
      const posts = Number(item.parameters.frame_posts),
        ending = posts === 1 ? "пост" : posts < 5 ? "поста" : "постов";
      const frames=frameCounts.get(posts)??new Set<string>();frames.add(String(item.parameters.frame_group));frameCounts.set(posts,frames);
      entries.set(`frame:${posts}`, {
        key: `frame:${posts}`,
        name: `Рамка на ${posts} ${ending}`,
        color: "#fb923c",
        symbol: "▭",posts,count:frames.size,
      });
    }
  }
  return [...entries.values()].sort((a,b) => {
    const rank=(name:string) => ranks.get(name)??types.length;
    return rank(a.name)-rank(b.name) || a.name.localeCompare(b.name,"ru",{numeric:true});
  });
}
function ToolIcon({name}:{name:"settings"|"pdf"|"folder"|"trash"}) {return <ActionIcon name={name} className="tool-icon"/>;}
function AppModal({title,onClose,busy=false,children,className="",returnFocus}:{title:string;onClose:()=>void;busy?:boolean;children:React.ReactNode;className?:string;returnFocus?:HTMLElement|null}) {
  const modal=useRef<HTMLDivElement>(null);
  useEffect(()=> {
    const previous=returnFocus??document.activeElement as HTMLElement|null;
    const frame=requestAnimationFrame(()=>modal.current?.querySelector<HTMLElement>('[data-dialog-autofocus],button,input,select')?.focus());
    return ()=> {cancelAnimationFrame(frame);if(previous?.isConnected)previous.focus();};
  },[]);
  useEffect(()=> {
    const keyboard=(event:KeyboardEvent)=> {
      if(event.key==="Escape" && !(event.target as HTMLElement)?.closest("[data-search-popup]")) {event.preventDefault();event.stopImmediatePropagation();if(!busy)onClose();}
      if(event.key==="Tab" && !modal.current?.contains(document.activeElement)) {
        event.preventDefault();modal.current?.querySelector<HTMLElement>('button:not([disabled]),input:not([disabled]),select')?.focus();
      }
    };
    window.addEventListener("keydown",keyboard,true);
    return()=>window.removeEventListener("keydown",keyboard,true);
  },[busy,onClose]);
  return <div className="modal-backdrop" ref={modal} role="dialog" aria-modal="true" aria-label={title} onPointerDown={event=> {if(event.target===event.currentTarget && !busy)onClose();}} onKeyDown={event=> {
    if(event.key==="Escape") {event.preventDefault();event.stopPropagation();if(!busy)onClose();}
    if(event.key==="Tab") {
      const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]')].filter(item=>item.getClientRects().length);
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey && document.activeElement===first) {event.preventDefault();last?.focus();}
      else if(!event.shiftKey && document.activeElement===last) {event.preventDefault();first?.focus();}
    }
  }}>
    <section className={`catalog-modal app-modal ${className}`}>
      <div className="app-modal-title"><h2>{title}</h2><button type="button" aria-label={`Закрыть: ${title}`} disabled={busy} onClick={onClose}>×</button></div>
      {children}
    </section>
  </div>;
}
type AppSettings={version:string;can_open_data_folder:boolean;data_directory:string|null;instance:string;can_backup_all?:boolean;rollback_version?:string|null;rollback_directory?:string|null;rollback_has_data?:boolean;rollback_warning?:string};
function SettingsDialog({onClose,onBusyChange,backupBlocked=false,returnFocus}:{onClose:()=>void;onBusyChange:(busy:boolean)=>void;backupBlocked?:boolean;returnFocus?:HTMLElement|null}) {
  const [adaptiveLabels,setAdaptiveLabels]=usePreference<boolean>('adaptive-labels',true),[showGrid,setShowGrid]=usePreference<boolean>('canvas-grid',true);
  const [info,setInfo]=useState<AppSettings|null>(null),[error,setError]=useState(""),[message,setMessage]=useState(""),[opening,setOpening]=useState(false);
  useEffect(()=>{onBusyChange(opening);return()=>onBusyChange(false);},[opening,onBusyChange]);
  useEffect(()=> {let active=true;api<AppSettings>("/settings").then(info=> {if(active)setInfo(info);}).catch(error=> {if(active)setError(errorMessage(error,"Не удалось загрузить настройки"));});return()=>{active=false;};},[]);
  return <AppModal title="Настройки" onClose={onClose} returnFocus={returnFocus} busy={opening} className="settings-modal">
    <div className="settings-heading"><ToolIcon name="folder"/><div><h3>Данные и перенос на другой компьютер</h3><p>Здесь хранятся все проекты, общий каталог, PDF-планы и изображения.</p></div></div>
    {!info && !error && <p role="status">Загрузка настроек…</p>}
    {info?.data_directory && <label>Папка всех данных<input aria-label="Папка всех данных" readOnly value={info.data_directory} onFocus={event=>event.target.select()} /></label>}
    {info && <button className="primary icon-button open-data-folder" disabled={opening || !info.can_open_data_folder} onClick={()=>void(async()=> {
      setOpening(true);setError("");setMessage("");
      try {await api("/settings/open-data-folder","POST",{instance:info.instance});setMessage("Папка данных открыта в Проводнике");}
      catch(error){setError(errorMessage(error,"Не удалось открыть папку"));}
      finally {setOpening(false);}
    })()}><ToolIcon name="folder"/>{opening ? "Открытие…" : "Открыть папку данных"}</button>}
    {info && !info.can_open_data_folder && <p className="hint">Открытие папки доступно в автономном приложении Smart Home Calc для Windows.</p>}
    {error && <p className="catalog-error" role="alert">{error}</p>}
    {message && <p className="catalog-success" role="status">{message}</p>}
    <section className="settings-backup"><h3>Рабочая область</h3><label className="check"><input type="checkbox" checked={adaptiveLabels} onChange={event=>setAdaptiveLabels(event.target.checked)}/>Автоматически упрощать большие планы</label><p className="hint">При отдалении плана или более чем 500 видимых объектах остаются компактные цветные контуры; подробности и подписи видны у выбранных элементов. При увеличении детали возвращаются.</p><label className="check"><input type="checkbox" checked={showGrid} onChange={event=>setShowGrid(event.target.checked)}/>Фоновая сетка рабочей области</label></section>
    <section className="settings-backup"><div className="settings-heading"><ActionIcon name="save"/><div><h3>Полная резервная копия</h3><p>Все проекты, каталог, товары с фотографиями, коммерческие предложения и планы — в одном ZIP.</p></div></div>
      <button type="button" className="tool-action" disabled={opening||!info?.can_backup_all||backupBlocked} onClick={()=>void(async()=>{
        if(!info)return;setOpening(true);setError('');setMessage('Подготовка полной копии…');
        try{const backup=await api<{url:string;filename:string;size:number}>('/settings/backups','POST',{instance:info.instance});const link=document.createElement('a');link.href=backup.url;link.download=backup.filename;link.click();setMessage('Копия готова: '+(backup.size/1024/1024).toLocaleString('ru-RU',{maximumFractionDigits:1})+' МБ. Дождитесь загрузки ZIP перед закрытием приложения.');}
        catch(error){setMessage('');setError(errorMessage(error,'Не удалось подготовить копию'));}
        finally{setOpening(false);}
      })()}><ActionIcon name="save"/><span>{opening?'Подготовка…':'Скачать полную копию ZIP'}</span></button>
      {backupBlocked&&<p className="hint">Сохраните КП или завершите редактирование плана перед созданием полной копии. Копия включает сохранённые данные.</p>}
      {!info?.can_backup_all&&<p className="hint">Полная копия доступна в автономной Windows-версии. Для переноса также можно скопировать папку данных целиком.</p>}
    </section>
    <section className="settings-backup"><div className="settings-heading"><ActionIcon name="undo"/><div><h3>Откат версии</h3><p>При обновлении предыдущий выпуск сохраняется отдельно. Для возврата к v1.0.51 используйте копию данных до обновления.</p></div></div>
      {info?.rollback_version&&<><p className="hint">На компьютере сохранена версия {info.rollback_version}{info.rollback_has_data?' и копия данных перед обновлением':''}.</p><button type="button" disabled={opening} onClick={()=>void(async()=>{if(!info)return;setOpening(true);setError('');try{await api('/settings/open-rollback-folder','POST',{instance:info.instance});setMessage('Папка предыдущей версии открыта. Закройте приложение и запустите Start-previous-version.cmd.');}catch(error){setError(errorMessage(error,'Не удалось открыть папку'));}finally{setOpening(false);}})()}><ActionIcon name="folder" className="tool-icon"/> Открыть папку предыдущей версии</button></>}
      <p className="hint">Для отката закройте калькулятор и запустите предыдущий EXE либо Start-previous-version.cmd из его папки. Если нужно вернуть данные на момент обновления, сохраните текущую папку data и замените её копией из папки предыдущей версии.</p>
      <a href="https://github.com/drvitalek-ops/Smart-Calc-for-electricity-projects/releases/tag/v1.0.51" target="_blank" rel="noreferrer">Открыть релиз v1.0.51</a>
      {info?.rollback_warning&&<p role="alert" className="catalog-error">Не удалось создать автоматическую копию данных: {info.rollback_warning}. Создайте полную копию ZIP или сохраните папку data вручную.</p>}
    </section>
    <div className="transfer-instructions"><h3>Как перенести всё</h3><ol>
      <li>Откройте папку данных кнопкой выше и закройте калькулятор.</li>
      <li>В Проводнике нажмите <strong>Alt + ↑</strong> и скопируйте папку <strong>data целиком</strong>: файл <strong>smart-home-calc.db</strong> и папку <strong>storage</strong> с планами. Каталог и все проекты находятся в базе.</li>
      <li>На другом ПК запустите актуальную версию калькулятора и откройте эту же папку через настройки. Закройте приложение и замените папку <strong>data</strong> своей копией.</li>
      <li>Запустите калькулятор — проекты и планы появятся автоматически.</li>
    </ol><p>Если на другом ПК уже есть нужные проекты, сначала сохраните его папку данных: замена папки переносит всю базу целиком.</p></div>
    <small>Smart Home Calc {info?.version ?? ""}</small>
  </AppModal>;
}
function NomenclatureEditor({types,categories=[],onChanged,onDirtyChange,onBusyChange}:{types:Kind[];categories?:Category[];onChanged:()=>Promise<void>;onDirtyChange?:(dirty:boolean)=>void;onBusyChange?:(busy:boolean)=>void}) {
  const empty=()=>({id:0,name:"",category:"Электроустановки",unit:"шт",color:"#f97316",wet_min_ip:"",defaults:{quantity:1} as Record<string,unknown>});
  const [form,setForm]=useState(empty), [search,setSearch]=useState(""), [showDeleted,setShowDeleted]=useState(false),
    [groupFilter,setGroupFilter]=useState(""),
    [message,setMessage]=useState(""), [error,setError]=useState(""), [saving,setSaving]=useState(false), [parameter,setParameter]=useState("ip");
  const original=types.find(item=>item.id===form.id),baseline=original?{id:original.id,name:original.name,category:original.category,unit:original.unit,color:original.color,wet_min_ip:original.wet_min_ip==null?'':String(original.wet_min_ip),defaults:original.defaults}:empty();
  const dirty=JSON.stringify(form)!==JSON.stringify(baseline);
  useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false);},[dirty,onDirtyChange]);
  useEffect(()=>{onBusyChange?.(saving);return()=>onBusyChange?.(false);},[saving,onBusyChange]);
  async function work(action:()=>Promise<void>) {
    setSaving(true);setError("");setMessage("");
    try {await action();} catch(error) {setError(errorMessage(error,"Ошибка"));} finally {setSaving(false);}
  }
  const groups=groupKinds(types.filter(item=>item.active || showDeleted));
  const visible=types.filter(item => (item.active || showDeleted) && (!groupFilter || (item.group ?? item.category)===groupFilter) && `${item.name} ${item.category} ${item.group ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section className="nomenclature-manager" aria-label="Управление номенклатурой">
    {message && <p className="catalog-success" role="status">{message}</p>}
    {error && <p className="catalog-error" role="alert">{error}</p>}
    <div className="nomenclature-grid">
      <form className="nomenclature-form" onSubmit={event => {
        event.preventDefault();void work(async()=> {
          const body={...form,wet_min_ip:form.wet_min_ip ? Number(form.wet_min_ip) : null,active:true};
          await api(form.id ? `/types/${form.id}` : "/types",form.id ? "PUT" : "POST",body);
          await onChanged();setForm(empty());setMessage(form.id ? "Позиция сохранена" : "Позиция добавлена");
        });
      }}>
        <h3>{form.id ? "Редактирование позиции" : "Новая позиция"}</h3>
        <label>Название<input aria-label="Название номенклатуры" required maxLength={200} value={form.name} onChange={event=>setForm({...form,name:event.target.value})} /></label>
        <label>Категория<SearchInput aria-label="Категория номенклатуры" required maxLength={200} options={[...new Set(["Электроустановки","Освещение","LED-подсветка","Датчики","Электрокарнизы","Умные устройства","Профиль",...types.map(item=>item.category),...categories.map(item=>item.name)])]} value={form.category} onChange={category=>setForm({...form,category})}/></label>
        <label>Единица измерения<SearchSelect aria-label="Единица номенклатуры" value={form.unit} onChange={event=>setForm({...form,unit:event.target.value,defaults:{...Object.fromEntries(Object.entries(form.defaults).filter(([key])=>!["length","quantity"].includes(key))),...(event.target.value === "м" ? {length:1} : {quantity:1})}})}><option value="шт">Штуки</option><option value="м">Метры</option></SearchSelect></label>
        <label>Цвет на плане<input aria-label="Цвет номенклатуры" type="color" value={form.color} onChange={event=>setForm({...form,color:event.target.value})} /></label>
        <label>Рекомендуемый IP во влажной зоне<input aria-label="Минимальный IP номенклатуры" type="number" min="0" max="69" placeholder="Не задан" value={form.wet_min_ip} onChange={event=>setForm({...form,wet_min_ip:event.target.value})} /></label>
        <details className="manual-properties"><summary>Значок по умолчанию для новых объектов</summary><AppearanceEditor kind={{name:form.name,category:form.category,unit:form.unit}} value={form.defaults} onChange={defaults=>setForm({...form,defaults})} color={form.color} allowName={false} line={form.unit==="м"}/></details><CustomFieldsEditor value={form.defaults} onChange={defaults=>setForm({...form,defaults})}/><h3>Параметры по умолчанию</h3>
        {Object.entries(form.defaults).filter(([key])=>!appearanceKeys.includes(key)&&!key.startsWith("custom:")).map(([key,value])=><label key={key} className="nomenclature-param">{labels[key] ?? (key.startsWith("custom:")?key.slice(7):key)}<span><input aria-label={`По умолчанию: ${labels[key] ?? (key.startsWith("custom:")?key.slice(7):key)}`} type={typeof value === "number" ? "number" : "text"} step="any" value={String(value)} onChange={event=>setForm({...form,defaults:{...form.defaults,[key]:typeof value === "number" ? Number(event.target.value) : event.target.value}})} /><button type="button" aria-label={`Убрать параметр ${labels[key] ?? (key.startsWith("custom:")?key.slice(7):key)}`} onClick={()=> {const defaults={...form.defaults};delete defaults[key];setForm({...form,defaults});}}>×</button></span></label>)}
        <label>Добавить характеристику<SearchSelect aria-label="Новая характеристика" value={parameter} onChange={event=>setParameter(event.target.value)}>{Object.entries(labels).filter(([key])=>!["led_strip","frame_posts","contact_type"].includes(key)).map(([key,label])=><option key={key} value={key}>{label}</option>)}</SearchSelect></label>
        <button type="button" onClick={()=>setForm({...form,defaults:{...form.defaults,[parameter]:form.defaults[parameter] ?? (["quantity","length","ip","voltage","keys","power_watts","connectors","end_caps"].includes(parameter) ? 1 : "")}})}>Добавить характеристику</button>
        <button className="primary" disabled={saving}>{form.id ? "Сохранить позицию" : "Добавить позицию"}</button>
        {form.id>0 && <button type="button" onClick={()=>setForm(empty())}>Отменить редактирование позиции</button>}
        <p className="hint">Название и цвет обновляются во всех проектах. Для используемой позиции категория и единица измерения защищены.</p>
      </form>
      <div className="nomenclature-list">
        <label>Группа<SearchSelect aria-label="Группа номенклатуры" value={groupFilter} onChange={event=>setGroupFilter(event.target.value)}><option value="">Все группы</option>{groups.map(group=><option key={group.label} value={group.label}>{group.label}</option>)}</SearchSelect></label>
        <label>Поиск<input aria-label="Поиск номенклатуры" type="search" value={search} onChange={event=>setSearch(event.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={showDeleted} onChange={event=>setShowDeleted(event.target.checked)} />Показывать удалённые</label>
        <div className="nomenclature-rows">{groupKinds(visible).map(group=><section className="nomenclature-group" key={group.label} aria-label={`Группа ${group.label}`}><h4>{group.label}<small>{group.items.length}</small></h4>{group.items.map(item=><article key={item.id} className={!item.active ? "inactive" : ""} data-type-id={item.id}>
          <div><strong><i style={{background:item.color}} />{item.name}</strong><small>{item.category} · {item.unit}{!item.active ? " · удалена из библиотеки" : ""}</small></div>
          <ToolButton type="button" icon="copy" aria-label={`Создать копию ${item.name}`} onClick={()=>{setForm({id:0,name:item.name+' — копия',category:item.category,unit:item.unit,color:item.color,wet_min_ip:item.wet_min_ip==null?'':String(item.wet_min_ip),defaults:{...item.defaults}});setError('');setMessage('');}}>Копия</ToolButton>
          <button type="button" disabled={saving} aria-label={`Редактировать ${item.name}`} onClick={()=> {setForm({id:item.id,name:item.name,category:item.category,unit:item.unit,color:item.color,wet_min_ip:item.wet_min_ip==null ? "" : String(item.wet_min_ip),defaults:{...item.defaults}});setError("");setMessage("");}}>Редактировать</button>
          {item.active ? <button type="button" className="danger" disabled={saving} aria-label={`Удалить ${item.name}`} onClick={()=> {
            if(!confirm(`Удалить «${item.name}» из библиотеки? Уже размещённые объекты и отчёты сохранятся.`)) return;
            void work(async()=> {await api(`/types/${item.id}`,"DELETE");await onChanged();if(form.id===item.id)setForm(empty());setMessage("Позиция удалена из библиотеки");});
          }}>Удалить</button> : <button type="button" disabled={saving} aria-label={`Восстановить ${item.name}`} onClick={()=>void work(async()=> {await api(`/types/${item.id}`,"PUT",{...item,active:true});await onChanged();setMessage("Позиция восстановлена");})}>Восстановить</button>}
        </article>)}</section>)}</div>
        {!visible.length && <p className="hint">Подходящих позиций нет.</p>}
      </div>
    </div>
  </section>;
}
function CatalogManager({
  catalog,
  types,
  onClose,
  onChanged,onBusyChange,onDirtyChange,
}: {
  catalog: Catalog;
  onBusyChange:(busy:boolean)=>void;
  onDirtyChange:(dirty:boolean)=>void;
  types: Kind[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [tab,setTab]=useState<"types"|"products"|"categories">("types");
  const [databaseSearch,setDatabaseSearch]=useState(""),[productLimit,setProductLimit]=useState(100);
  const [typeDirty,setTypeDirty]=useState(false),[categoryDirty,setCategoryDirty]=useState(false),[typeBusy,setTypeBusy]=useState(false),[categoryBusy,setCategoryBusy]=useState(false);
  const blank = {
    id: 0,
    name: "",
    sku: "",
    manufacturer_id: catalog.manufacturers[0]?.id ?? 0,
    supplier_id: 0,
    type_id: types.find(item=>item.active)?.id ?? 0,
    price: 0,
    currency: "RUB",
    active: true,
    parameters:{} as Record<string,unknown>,
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
  const originalProduct=catalog.products.find(item=>item.id===form.id),originalMaker=catalog.manufacturers.find(item=>item.id===manufacturerId),originalSupplier=catalog.suppliers.find(item=>item.id===supplierId);
  const productDirty=originalProduct?['name','sku','manufacturer_id','type_id','price','currency','active'].some(key=>form[key as keyof typeof form]!==originalProduct[key as keyof Product])||form.supplier_id!==(originalProduct.supplier_id??0)||JSON.stringify(form.parameters)!==JSON.stringify(originalProduct.parameters):Boolean(form.name||form.sku||form.price||Object.keys(form.parameters).length);
  const dirty=typeDirty||categoryDirty||productDirty||manufacturer!==(originalMaker?.name??'')||supplier!==(originalSupplier?.name??'')||contact!==(originalSupplier?.contact??'');
  const anyBusy=saving||typeBusy||categoryBusy;
  useEffect(()=>{onBusyChange(anyBusy);return()=>onBusyChange(false);},[anyBusy,onBusyChange]);
  useEffect(()=>{onDirtyChange(dirty);return()=>onDirtyChange(false);},[dirty,onDirtyChange]);
  useEffect(()=>setProductLimit(100),[databaseSearch]);
  const kindLookup=useMemo(()=>new Map(types.map(kind=>[kind.id,kind])),[types]);
  const filteredProducts=useMemo(()=>catalog.products.filter(item=>{const kind=kindLookup.get(item.type_id);return matchesSearch([item.name,item.sku,item.manufacturer,item.supplier,kind?.name,kind?.category].join(' '),databaseSearch);}),[catalog.products,kindLookup,databaseSearch]);
  function closeCatalog(){if(anyBusy)return;if(!dirty||confirm('В каталоге есть несохранённые изменения. Закрыть без сохранения?'))onClose();}

  async function work(action: () => Promise<void>) {
    setLocalError("");
    setMessage("");
    setSaving(true);
    try {
      await action();
    } catch (e) {
      setLocalError(errorMessage(e,"Ошибка"));
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
        parameters: form.parameters,
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
      parameters:{...product.parameters},
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
          <button aria-label="Закрыть каталог" disabled={anyBusy} onClick={closeCatalog}>
            ×
          </button>
        </div>
        {localError && <p className="catalog-error">{localError}</p>}
        {message && <p className="catalog-success">{message}</p>}
        <nav className="catalog-tabs" aria-label="Раздел каталога">
          <button className={tab==="types" ? "active" : ""} onClick={()=>setTab("types")}>Номенклатура</button>
          <button className={tab==="products" ? "active" : ""} onClick={()=>setTab("products")}>Товары и цены</button>
          <button className={tab==="categories"?"active":""} onClick={()=>setTab('categories')}>Категории</button>
        </nav>
        <div hidden={tab!=='categories'}><CategoryEditor categories={catalog.categories??[]} onChanged={onChanged} onDirtyChange={setCategoryDirty} onBusyChange={setCategoryBusy}/></div>
        <div hidden={tab!=='types'}><NomenclatureEditor types={types} categories={catalog.categories} onChanged={onChanged} onDirtyChange={setTypeDirty} onBusyChange={setTypeBusy}/></div>
        <div hidden={tab!=='products'}>
        <label>Поиск в базе<input type="search" aria-label="Поиск в базе товаров" placeholder="Название, артикул, производитель, категория…" value={databaseSearch} onChange={event=>setDatabaseSearch(event.target.value)}/></label>
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
              {catalog.manufacturers.filter(item=>matchesSearch(item.name,databaseSearch)).map((item) => (
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
              {catalog.suppliers.filter(item=>matchesSearch(item.name+" "+item.contact,databaseSearch)).map((item) => (
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
            <form data-image-target onDragOver={imageDragOver} onDrop={event=>imageDrop(event,file=>{void prepareImage(file).then(image=>setForm(current=>current.id===form.id?({...current,parameters:{...current.parameters,image}}):current)).catch(error=>setLocalError(errorMessage(error,'Ошибка изображения')));})} onPasteCapture={event=>imagePaste(event,file=>{void prepareImage(file).then(image=>setForm(current=>current.id===form.id?({...current,parameters:{...current.parameters,image}}):current)).catch(error=>setLocalError(errorMessage(error,'Ошибка изображения')));})} onSubmit={(e) => void saveProduct(e)}>
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
                <SearchSelect
                  required
                  value={form.type_id || ""}
                  onChange={(e) =>
                    setForm({ ...form, type_id: +e.target.value })
                  }
                >
                  <KindOptions types={types.filter(item=>item.active || item.id===form.type_id)} showUnits />
                </SearchSelect>
              </label>
              <label>
                Производитель
                <SearchSelect
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
                </SearchSelect>
              </label>
              <label>
                Поставщик
                <SearchSelect
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
                </SearchSelect>
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
              <ImageField key={form.id} label="Фото товара каталога" value={String(form.parameters.image??'')} disabled={saving} onChange={image=>setForm(current=>({...current,parameters:{...current.parameters,image}}))}/>
              <button type="button" onClick={()=>setTab('types')}>＋ Создать номенклатуру или категорию</button>
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
              <label>Описание товара<textarea aria-label="Описание товара в каталоге" value={String(form.parameters.description??'')} onChange={event=>setForm({...form,parameters:{...form.parameters,description:event.target.value}})}/></label>
              <CustomFieldsEditor value={form.parameters} onChange={parameters=>setForm({...form,parameters})}/>
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
              {form.id>0 && <button type="button" className="danger" disabled={saving} onClick={()=> {
                if(!confirm("Удалить товар из выбора? Его данные и стоимость в проектах сохранятся."))return;
                void work(async()=>{await api(`/products/${form.id}`,"DELETE");await onChanged();setForm(blank);setMessage("Товар удалён из выбора");});
              }}>Удалить товар</button>}
            </form>
          </div>
          <div className="product-list">
            <h3>Товары · {catalog.products.length}</h3>
            {filteredProducts.slice(0,productLimit).map((item) => (
              <button
                type="button"
                key={item.id}
                className={!item.active ? "inactive" : ""}
                onClick={() => edit(item)}
              >
                <strong><SearchHighlight text={item.name} query={databaseSearch}/></strong>
                <span>
                  <SearchHighlight text={item.manufacturer+" · "+(item.sku || "без артикула")} query={databaseSearch}/>
                </span>
                <span>
                  {item.price} {item.currency} / {item.unit}
                  {!item.active ? " · архив" : ""}
                </span>
              </button>
            ))}
            {filteredProducts.length>productLimit&&<button type="button" onClick={()=>setProductLimit(value=>value+100)}>Показать ещё · {filteredProducts.length-productLimit}</button>}
            {!filteredProducts.length&&catalog.products.length>0&&<p className="hint">По запросу ничего не найдено.</p>}
            {!catalog.products.length && (
              <p className="hint">
                Создайте товар вручную или импортируйте CSV.
              </p>
            )}
          </div>
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
  const pendingActions=useRef(0),elementSaveQueue=useRef<Promise<void>>(Promise.resolve());
  const [leftTool,setLeftTool]=useState<string|null>(null),[rightTool,setRightTool]=useState<string|null>(null);
  const [batchStyle,setBatchStyle]=useState<Record<string,unknown>>({});
  function selectLeftTool(id:string){if(roomMode&&id!=="rooms"){setError("Сначала завершите или отмените контур помещения");return;}if(placing&&id!=="objects"&&linePoints.length){setError("Сначала завершите или отмените линию");return;}if(id!=="objects")setPlacing(false);setLeftTool(current=>current===id?null:id);if(window.innerWidth<1100)setRightTool(null);}
  function selectRightTool(id:string){setRightTool(current=>current===id?null:id);if(window.innerWidth<1100)setLeftTool(null);if(id==='layers')setElementLayersExpanded(true);}
  const groupDrafts=useRef(new Map<number,string[]>()),groupPending=useRef(new Map<number,string[]>()),groupSaving=useRef(false);
  const [savingGroups,setSavingGroups]=useState(false);
  const [adaptiveLabels]=usePreference<boolean>('adaptive-labels',true),[showGrid]=usePreference<boolean>('canvas-grid',true);
  const [objectSnap,setObjectSnap]=usePreference<boolean>('object-snap',false),[ortho,setOrtho]=usePreference<boolean>('ortho',false);
  const [snapTarget,setSnapTarget]=useRafState<Point|null>(null);
  const planStatus=useRef<PlanStatusHandle>(null);
  const [libraryGroup,setLibraryGroup]=useState("");
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
  const [settingsOpen,setSettingsOpen]=useState(false),[draggingPdf,setDraggingPdf]=useState(false),
    [pdfImport,setPdfImport]=useState<{file:File;name:string}|null>(null),[pdfImportError,setPdfImportError]=useState("");
  const [deletingProject,setDeletingProject]=useState<Project|null>(null),[deleteProjectError,setDeleteProjectError]=useState("");
  const settingsTrigger=useRef<HTMLElement|null>(null);
  const dragDepth=useRef(0),pdfInput=useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null),sheetRef = useRef<HTMLDivElement | null>(null);
  const {zoom,zoomAt,reset:setZoom,fit:fitPlan,current:cameraZoom}=usePlanCamera(viewportRef,sheetRef);
  const [symbolScale, setSymbolScale] = useState(1),
    [labelsVisible, setLabelsVisible] = useState(true),
    [elementsVisible, setElementsVisible] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [placing, setPlacing] = useState(false),
    [calibrating, setCalibrating] = useState(false),
    [catalogOpen, setCatalogOpen] = useState(false),
    [view, setView] = useState<"plan" | "report" | "quote" | "quotations">("plan");
  const [quoteDirty,setQuoteDirty]=useState(false),[quoteBusy,setQuoteBusy]=useState(false),[settingsBusy,setSettingsBusy]=useState(false),[catalogBusy,setCatalogBusy]=useState(false),[catalogDirty,setCatalogDirty]=useState(false);
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
    [elementLayersExpanded, setElementLayersExpanded] = useState(false),
    [checkedPageIds, setCheckedPageIds] = useState<number[]>([]);
  const [supplyLinking,setSupplyLinking]=useState<{body:Record<string,unknown>;editId?:number;stripIds:number[];undo:number[][];redo:number[][];resumePlacing:boolean}|null>(null);
  const [lineRedo, setLineRedo] = useState<Point[]>([]);
  const pendingHistory = useRef<boolean[]>([]);
  const [linePoints, setLinePoints] = useState<Point[]>([]),
    [lineCursor, setLineCursor] = useRafState<Point | null>(null),
    [calibrationStart, setCalibrationStart] = useState<Point | null>(null);
  const [selectionBox, setSelectionBox] = useState<{
    start: Point;
    current: Point;
    additive: boolean;
  } | null>(null);
  const [roomUndo, setRoomUndo] = useState<Point[][]>([]),
    [roomRedo, setRoomRedo] = useState<Point[][]>([]),
    [showRoomContours, setShowRoomContours] = useState(true),
    [roomSnap, setRoomSnap] = useState(true);
  const roomDragStart = useRef<Point[] | null>(null);
  const [roomMode, setRoomMode] = useState<"new" | "edit" | null>(null),
    [roomPoints, setRoomPoints] = useState<Point[]>([]),
    [roomCursor, setRoomCursor] = useRafState<Point | null>(null),
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
  const planWindow=usePlanWindow(viewportRef,sheetRef,view==='plan'?pageId:null,zoom);
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
  const typeMap=useMemo(()=>new Map(types.map(item=>[item.id,item])),[types]);
  const pageMap=useMemo(()=>new Map(project?.pages.map(item=>[item.id,item])??[]),[project?.pages]);
  const layerMap=useMemo(()=>new Map(project?.layers.map(item=>[item.id,item])??[]),[project?.layers]);
  const typeGroups=useMemo(()=>new Map(types.map(type=>[type.id,planGroup(type)])),[types]);
  const hiddenLayerGroups=useMemo(()=>new Map(project?.layers.map(layer=>[layer.id,new Set(layer.hidden_groups??[])])??[]),[project?.layers]);
  const layerGroupEntries=useMemo(()=>layerGroups(project?.layers??[],project?.elements??[],types,typeGroups),[project?.layers,project?.elements,types,typeGroups]);
  const elementMap=useMemo(()=>new Map(project?.elements.map(item=>[item.id,item])??[]),[project?.elements]);
  useEffect(()=>{
    if(busy)return;
    const shown=selectedIds.filter(id=>{const item=elementMap.get(id);return item&&displayedElement(item,layerMap,typeGroups,hiddenLayerGroups);});
    if(shown.length!==selectedIds.length){setSelectedIds(shown);setSelected(current=>current&&shown.includes(current.id)?current:shown.length?elementMap.get(shown[0])??null:null);}
  },[busy,selectedIds,elementMap,layerMap,typeGroups,hiddenLayerGroups]);
  const selectionSet=useMemo(()=>new Set(selectedIds),[selectedIds]);
  const linkedStripSet=useMemo(()=>new Set(supplyLinking?.stripIds??[]),[supplyLinking?.stripIds]);
  const pendingDraft=Boolean(view==='plan'&&selected&&elementMap.get(selected.id)&&!sameItem(selected,elementMap.get(selected.id)!));
  const unsavedWorkbench=quoteDirty||catalogDirty||pendingDraft||Boolean(roomMode&&roomPoints.length||placing&&linePoints.length||supplyLinking);
  useDesktopState(unsavedWorkbench,busy||quoteBusy||settingsBusy||catalogBusy);
  const availableTypes=useMemo(()=>types.filter(item=>item.active),[types]);
  const libraryTypes=useMemo(()=>availableTypes.filter(item=>!libraryGroup || (item.group ?? item.category)===libraryGroup),[availableTypes,libraryGroup]);
  useEffect(()=> {
    if(libraryGroup && !types.some(item=>item.active && item.id===typeId && (item.group ?? item.category)===libraryGroup))setLibraryGroup("");
  },[types,typeId,libraryGroup]);
  const page = pageMap.get(pageId??0),
    kind = typeMap.get(typeId??0),
    layer = layerMap.get(layerId??0);
  async function run(work: () => Promise<void>) {
    setError("");
    pendingActions.current+=1;setBusy(true);
    try {
      await work();
    } catch (e) {
      setError(errorMessage(e,"Ошибка"));
    } finally {
      pendingActions.current-=1;if(!pendingActions.current)setBusy(false);
    }
  }
  function openCatalog(){
    void run(async()=>{const [nextCatalog,nextTypes]=await Promise.all([api<Catalog>('/catalog'),api<Kind[]>('/types?include_inactive=true')]);setCatalog(nextCatalog);setTypes(nextTypes);setCatalogOpen(true);});
  }
  function openSettings(){settingsTrigger.current=document.activeElement as HTMLElement|null;void run(async()=>{await saveDraftBeforeNavigation();setSettingsOpen(true);});}
  function canLeaveQuote() {
    return !["quote","quotations"].includes(view) || !quoteDirty || confirm("В КП есть несохранённые изменения. Выйти без сохранения?");
  }
  async function saveDraftBeforeNavigation(){
    if(view!=="plan"||!selected||selectedIds.length!==1)return;
    const stored=project?.elements.find(item=>item.id===selected.id);
    if(stored&&!sameItem(selected,stored))await save({...selected});
  }
  function changeView(next:"plan"|"report"|"quote"|"quotations") {
    if(busy||quoteBusy||next===view||!canLeaveQuote())return;
    void run(async()=>{await saveDraftBeforeNavigation();setView(next);});
  }
  useEffect(()=>{
    const stored=selected&&project?.elements.find(item=>item.id===selected.id);
    const unload=(event:BeforeUnloadEvent)=>{if(view==='plan'&&selected&&stored&&!sameItem(selected,stored)){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload);
  },[selected,project,view]);
  function requestPdfImport(files:File[]) {
    if(busy || quoteBusy) {setError("Дождитесь завершения сохранения или загрузки");return;}
    if(["quote","quotations"].includes(view) && quoteDirty){setError("Сначала сохраните изменения КП");return;}
    if(supplyLinking){setError("Сначала завершите или отмените привязку LED-лент");return;}
    if(settingsOpen || catalogOpen || pdfImport || deletingProject) {setError("Закройте открытое окно перед импортом PDF");return;}
    if(files.length!==1) {setError("Перетащите один PDF-файл проекта");return;}
    const file=files[0];
    if(!/\.pdf$/i.test(file.name) && file.type!=="application/pdf") {setError("Для нового проекта нужен PDF-файл");return;}
    if(file.size===0) {setError("PDF-файл пуст");return;}
    if(file.size>500*1024*1024) {setError("Максимальный размер PDF — 500 МБ");return;}
    setError("");setPdfImportError("");
    setPdfImport({file,name:file.name.replace(/\.pdf$/i,"").trim().slice(0,200) || "Новый проект"});
  }
  function resetPdfDrag() {dragDepth.current=0;setDraggingPdf(false);}
  useEffect(()=> {
    const clear=()=> {dragDepth.current=0;setDraggingPdf(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape" && dragDepth.current>0){event.preventDefault();event.stopImmediatePropagation();clear();}};
    window.addEventListener("dragend",clear);window.addEventListener("blur",clear);window.addEventListener("keydown",escape);
    return()=>{window.removeEventListener("dragend",clear);window.removeEventListener("blur",clear);window.removeEventListener("keydown",escape);};
  },[]);
  async function importPdfProject() {
    if(!pdfImport || !pdfImport.name.trim())return;
    const stored=selected && project?.elements.find(item=>item.id===selected.id);
    if(selected && stored && !sameItem(selected,stored))await save(selected);
    const form=new FormData();form.append("name",pdfImport.name.trim());form.append("file",pdfImport.file);
    let created:{id:number};
    try {created=await api<{id:number}>("/projects/from-pdf","POST",form);}
    catch(error){setPdfImportError(errorMessage(error,"Не удалось загрузить PDF"));return;}
    setPdfImport(null);setPdfImportError("");setProjects(await api("/projects"));await open(created.id);setPlacing(false);setCalibrating(false);
  }
  async function refresh(id: number) {
    const [next,nextReport]=await Promise.all([api<Project>(`/projects/${id}`),api<Report>(`/projects/${id}/report`)]);
    const value=groupDrafts.current.size?{...next,layers:next.layers.map(layer=>groupDrafts.current.has(layer.id)?{...layer,hidden_groups:groupDrafts.current.get(layer.id)!}:layer)}:next;
    setProject(previous=>shareProject(previous,value));setReport(nextReport);return value;
  }
  async function open(id: number) {
    const p = await refresh(id);
    setSymbolScale(savedSymbolScale(id));
    setPageId(p.pages[0]?.id ?? null);
    setLayerId(p.layers[0]?.id ?? null);
    setRoomId(null);
    setLibraryGroup("");
    setSelected(null);
    setSelectedIds([]);
    setTypeEditorOpen(false);
    setView("plan");
    setElementLayersExpanded(false);
    setCheckedPageIds([]);
    setSupplyLinking(null);
    pendingHistory.current = [];
    setAlignPageId(null);
    setAlignOriginal(null);
    setRoomMode(null);
    setRoomPoints([]);
    setEditingRoomId(null);
    setRoomMenu(null);
    setRoomPointMenu(null);
    setLinePoints([]);
    setLineRedo([]);
    setLineCursor(null);
    setCalibrationStart(null);
    setElementsVisible(true);
    setZoom(1);
  }
  function clearProject() {
    setProject(null);setPageId(null);setLayerId(null);setRoomId(null);
    setSelected(null);setSelectedIds([]);setTypeEditorOpen(false);
    setReport({rows:[],warnings:[],summary:{categories:[],rooms:[]}});
    setView("plan");setCheckedPageIds([]);setSupplyLinking(null);
    pendingHistory.current=[];
    setAlignPageId(null);setAlignOriginal(null);
    setRoomMode(null);setRoomPoints([]);setRoomCursor(null);setRoomUndo([]);setRoomRedo([]);setEditingRoomId(null);
    setRoomMenu(null);setRoomPointMenu(null);setObjectMenu(null);
    setLinePoints([]);setLineRedo([]);setLineCursor(null);setCalibrationStart(null);
    setPlacing(false);setCalibrating(false);setSelectionBox(null);
    drag.current=null;nodeDrag.current=null;pan.current=null;alignDrag.current=null;
    roomDragStart.current=null;roomNodeDrag.current=null;lastObjectClick.current=null;
    setRoomName("");setWet(false);setZoom(1);setSymbolScale(1);setElementsVisible(true);
  }
  async function deleteCurrentProject() {
    if(!deletingProject)return;
    const id=deletingProject.id;
    let result:{cleanup_failed:boolean};
    try {result=await api(`/projects/${id}`,"DELETE");}
    catch(error){setDeleteProjectError(errorMessage(error,"Не удалось удалить проект"));return;}
    try {localStorage.removeItem(symbolScaleKey(id));}catch{}
    clearProject();setDeletingProject(null);setDeleteProjectError("");
    setProjects(current=>current.filter(item=>item.id!==id));
    const remaining=await api<{id:number;name:string}[]>("/projects");
    setProjects(remaining);
    if(remaining.length)await open(remaining[0].id);
    if(result.cleanup_failed)setError("Проект удалён. Часть его файлов занята другой программой и осталась в папке данных.");
  }
  useEffect(() => {
    void run(async () => {
      setProjects(await api("/projects"));
      const ts = await api<Kind[]>("/types?include_inactive=true");
      setTypes(ts);
      setTypeId(ts.find(item=>item.active)?.id ?? null);
      setCatalog(await api("/catalog"));
    });
  }, []);
  async function save(item: Item) {
    const projectId=project!.id,original=project!.elements.find(current=>current.id===item.id);
    const persist=async()=>{
      const saved=await api<Item>(`/elements/${item.id}`,"PUT",{...item,geometry:item.geometry??{}});
      setSelected(current=>current?.id===item.id&&(sameItem(current,item)||(original&&sameItem(current,original)))?saved:current);
      await refresh(projectId);
    };
    const task=elementSaveQueue.current.then(persist,persist);
    elementSaveQueue.current=task.catch(()=>{});
    await task;
  }
  function stripLabel(item: Item) {
    const sheet=project?.pages.find(sheet => sheet.id === item.page_id);
    const room=project?.rooms.find(room => room.id === item.room_id);
    return `LED-линия №${item.id} · ${room?.name ?? "Без помещения"} · ${Number(item.parameters.length ?? 0).toLocaleString("ru-RU")} м · ${sheet?.name || `Лист ${sheet?.number}`}`;
  }
  async function removeSelected() {
    const ids = selectedIds.length ? selectedIds : selected ? [selected.id] : [];
    // Remove dependent supplies before their strips when both are selected.
    for (const id of [...ids].sort((a,b) => Number(isPowerSupply(types.find(type=>type.id===project?.elements.find(item=>item.id===b)?.type_id))) - Number(isPowerSupply(types.find(type=>type.id===project?.elements.find(item=>item.id===a)?.type_id)))))
      await api(`/elements/${id}`, "DELETE");
    setSelected(null);
    setSelectedIds([]);
    setTypeEditorOpen(false);
    await refresh(project!.id);
  }
  function startSupplyLinking(body:Record<string,unknown>,editId?:number) {
    if(roomMode){setError("Сначала завершите или отмените редактирование контура помещения");return;}
    cancelAlignment();
    setSupplyLinking({body,editId,stripIds:powerStripIds((body.parameters ?? {}) as Record<string,unknown>),undo:[],redo:[],resumePlacing:!editId && placing});
    setPlacing(false);setCalibrating(false);setCalibrationStart(null);setElementsVisible(true);
    setObjectMenu(null);setTypeEditorOpen(false);setSelectionBox(null);drag.current=null;nodeDrag.current=null;
  }
  function cancelSupplyLinking() {if(!supplyLinking)return;setPlacing(supplyLinking.resumePlacing);setSupplyLinking(null);}
  function toggleSupplyStrip(id:number) {
    if(!supplyLinking || busy)return;
    const ids=supplyLinking.stripIds.includes(id) ? supplyLinking.stripIds.filter(value=>value!==id) : [...supplyLinking.stripIds,id];
    if(ids.length>1000){setError("К блоку можно привязать до 1000 LED-лент");return;}
    setSupplyLinking({...supplyLinking,stripIds:ids,undo:[...supplyLinking.undo,supplyLinking.stripIds],redo:[]});
  }
  function undoSupplyLinking(redo=false) {
    if(!supplyLinking)return;
    const history=redo ? supplyLinking.redo : supplyLinking.undo,ids=history.at(-1);
    if(!ids){if(!redo)cancelSupplyLinking();return;}
    setSupplyLinking({...supplyLinking,stripIds:ids,undo:redo ? [...supplyLinking.undo,supplyLinking.stripIds] : history.slice(0,-1),redo:redo ? history.slice(0,-1) : [...supplyLinking.redo,supplyLinking.stripIds]});
  }
  async function finishSupplyLinking() {
    if(!project || !supplyLinking || !supplyLinking.stripIds.length)return;
    const draft=supplyLinking,parameters={...(draft.body.parameters as Record<string,unknown>),led_strip_ids:draft.stripIds};
    delete (parameters as Record<string,unknown>).led_strip_id;
    const item=await api<Item>(draft.editId ? `/elements/${draft.editId}` : `/projects/${project.id}/elements`,draft.editId ? "PUT" : "POST",{...draft.body,parameters});
    setSelected(item);setSelectedIds([item.id]);setPageId(item.page_id);setSupplyLinking(null);setPlacing(draft.resumePlacing);
    await refresh(project.id);
  }
  function editPowerWatts(item:Item) {
    const current=selected?.id===item.id ? selected : item;
    const input=prompt("Укажите мощность W (в ваттах). Пустое поле — убрать мощность.",String(current.parameters.power_watts ?? ""));
    if(input===null)return;
    const parameters={...current.parameters},value=input.trim().replace(/\s/g,"").replace(",",".");
    if(!value)delete parameters.power_watts;
    else {
      const watts=Number(value);
      if(!Number.isFinite(watts) || watts<=0 || watts>1000000){setError("Мощность должна быть положительным числом ватт");return;}
      parameters.power_watts=watts;
    }
    const changed={...current,parameters};setObjectMenu(null);setSelected(changed);setSelectedIds([changed.id]);
    void run(()=>save(changed));
  }
  async function undoLast(redo = false) {
    if (!project) return;
    const stored =
      selected && project.elements.find((item) => item.id === selected.id);
    if (!redo && selected && stored && !sameItem(selected, stored)) {
      await save(selected);
    }
    const result = await api<{ undone: boolean }>(
      `/projects/${project.id}/elements/${redo ? "redo" : "undo"}`,
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
    if (!selected || selectedIds.length!==1 || !project || busy || ["quote","quotations"].includes(view) || deletingProject || drag.current || nodeDrag.current)
      return;
    const stored = project.elements.find((item) => item.id === selected.id);
    if (!stored || sameItem(selected, stored)) return;
    const timeout = window.setTimeout(
      () => void run(() => save(selected)),
      600,
    );
    return () => window.clearTimeout(timeout);
  }, [selected, selectedIds.length, project, busy, deletingProject, view]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (["quote","quotations"].includes(view) || settingsOpen || pdfImport || deletingProject || catalogOpen || (event.target as HTMLElement|null)?.closest('[role="dialog"],[data-search-popup]')) return;
      if(supplyLinking) {
        if((event.target as HTMLElement|null)?.matches('input,textarea,[contenteditable="true"]'))return;
        const modifier=event.ctrlKey || event.metaKey,key=event.key.toLowerCase();
        if(event.key==="Escape") {event.preventDefault();if(!busy)cancelSupplyLinking();}
        else if(event.key==="Enter") {event.preventDefault();if(!busy && supplyLinking.stripIds.length)void run(finishSupplyLinking);}
        else if(modifier && ["z","я","y","н"].includes(key)) {
          event.preventDefault();const redo=event.shiftKey || ["y","н"].includes(key);
          if(busy)pendingHistory.current.push(redo);else undoSupplyLinking(redo);
        }
        return;
      }
      if (event.key === "F7") {
        event.preventDefault();
        setElementsVisible((value) => !value);
        return;
      }
      if (event.key === "Escape" && alignPageId) {
        cancelAlignment();
        return;
      }
      const target = event.target as HTMLElement | null;
      if(!target?.matches('input,textarea,select,[contenteditable="true"]')){
        if((event.ctrlKey||event.metaKey)&&event.key==='0'){event.preventDefault();fitPlan();return;}
        if(event.key==='F3'){event.preventDefault();if(roomMode)setRoomSnap(value=>!value);else setObjectSnap(value=>!value);return;}
        if(event.key==='F8'){event.preventDefault();setOrtho(value=>!value);return;}
        if(event.key==='Enter'&&placing&&kind?.unit==='м'&&linePoints.length>=2&&!busy){event.preventDefault();finishLine();return;}
        if((event.ctrlKey||event.metaKey)&&['a','ф'].includes(event.key.toLowerCase())&&!roomMode&&!placing){event.preventDefault();const ids=visibleElements.map(item=>item.id);setSelectedIds(ids);setSelected(ids.length?elementMap.get(ids[0])??null:null);return;}
        if(event.key==='Escape'&&!roomMode&&!busy){
          event.preventDefault();setObjectMenu(null);setRoomMenu(null);setRoomPointMenu(null);setSnapTarget(null);
          if(calibrating){setCalibrating(false);setCalibrationStart(null);setLineCursor(null);return;}
          if(placing){setPlacing(false);setLinePoints([]);setLineRedo([]);setLineCursor(null);return;}
          void run(async()=>{await saveDraftBeforeNavigation();setSelected(null);setSelectedIds([]);});return;
        }
      }
      if ((event.ctrlKey || event.metaKey) && ["z", "y", "я", "н"].includes(event.key.toLowerCase())) {
        if (target?.matches('input:not([type="checkbox"]):not([type="range"]),textarea,[contenteditable="true"]')) return;
        if (roomMode) return;
        event.preventDefault();
        const redo = event.shiftKey || ["y", "н"].includes(event.key.toLowerCase());
        if (alignPageId) { cancelAlignment(); return; }
        if (calibrationStart) { setCalibrationStart(null); return; }
        if (placing && kind?.unit === "м" && (linePoints.length || lineRedo.length)) {
          if (redo) {
            const point = lineRedo.at(-1);
            if (point) { setLinePoints([...linePoints,point]); setLineRedo(lineRedo.slice(0,-1)); }
          } else if (linePoints.length) {
            setLineRedo([...lineRedo,linePoints.at(-1)!]); setLinePoints(linePoints.slice(0,-1));
          }
          setLineCursor(null);
          return;
        }
        if (busy) { pendingHistory.current.push(redo); pendingHistory.current = pendingHistory.current.slice(-50); }
        else void run(() => undoLast(redo));
        return;
      }
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
  }, [selected, selectedIds, busy, project, alignPageId, roomMode, calibrationStart, placing, kind, linePoints, lineRedo, supplyLinking, settingsOpen, pdfImport, deletingProject, view,catalogOpen,elementMap,elementsVisible,zoom]);
  useEffect(() => {
    if (!busy && !["quote","quotations"].includes(view) && !deletingProject && pendingHistory.current.length) {
      const redo = pendingHistory.current.shift()!;
      void run(() => undoLast(redo));
    }
  }, [busy, selected, project, deletingProject, view]);
  useEffect(() => {
    function wheel(event: WheelEvent) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const viewport = viewportRef.current,
        target = event.target;
      if (!viewport || !(target instanceof Node) || !viewport.contains(target))
        return;
      zoomAt(cameraZoom.current*(event.deltaY<0?1.15:1/1.15),event.clientX,event.clientY);
    }
    window.addEventListener("wheel", wheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", wheel, { capture: true });
  }, [zoom, project]);
  function finishLine() {
    if (!project || !page || !kind || !layer || linePoints.length < 2) return;
    void run(async () => {
      const points=linePoints.filter((point,index)=>index===0||point.x!==linePoints[index-1].x||point.y!==linePoints[index-1].y);
      if(points.length<2)throw Error("Укажите две разные точки линии");
      const first = points[0];
      const item = await api<Item>(`/projects/${project.id}/elements`, "POST", {
        page_id: page.id,
        layer_id: layer.id,
        type_id: kind.id,
        product_id: null,
        room_id: roomId,
        x: first.x,
        y: first.y,
        parameters: kind.defaults,
        geometry: { points },
      });
      setSelected(item);
      setLinePoints([]);
      setLineRedo([]);
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
    await saveDraftBeforeNavigation();
    await api(`/layers/${l.id}`, "PATCH", { [field]: !l[field] });
    await refresh(project!.id);
  }
  function changeLayerGroups(layer:Layer,hidden:string[]){
    if(!project)return;
    const pid=project.id,value=[...new Set(hidden)];groupDrafts.current.set(layer.id,value);groupPending.current.set(layer.id,value);
    setProject(current=>current?{...current,layers:current.layers.map(item=>item.id===layer.id?{...item,hidden_groups:value}:item)}:current);
    if(groupSaving.current)return;
    groupSaving.current=true;setSavingGroups(true);
    void run(async()=>{
      try{
        await saveDraftBeforeNavigation();
        while(true){
          while(groupPending.current.size){const [id,groups]=groupPending.current.entries().next().value!;groupPending.current.delete(id);await api(`/layers/${id}`,'PATCH',{hidden_groups:groups});}
          groupDrafts.current.clear();await refresh(pid);
          if(!groupPending.current.size)break;
        }
      }catch(error){groupPending.current.clear();groupDrafts.current.clear();await refresh(pid).catch(()=>{});throw error;}
      finally{groupSaving.current=false;setSavingGroups(false);}
    });
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
  function changeRoomPoints(points: Point[]) {
    if (points.length > 1000) { setError("В контуре допускается до 1000 вершин"); return; }
    setRoomUndo(history => [...history, roomPoints]);
    setRoomRedo([]);
    setRoomPoints(points);
  }
  function undoRoomPoint(redo = false) {
    const history = redo ? roomRedo : roomUndo;
    const points = history.at(-1);
    if (!points) return;
    if (redo) {
      setRoomRedo(history.slice(0, -1));
      setRoomUndo(history => [...history, roomPoints]);
    } else {
      setRoomUndo(history.slice(0, -1));
      setRoomRedo(history => [...history, roomPoints]);
    }
    setRoomPoints(points);
    setRoomCursor(null);
  }
  function cancelRoom() {
    setRoomUndo([]);
    setRoomRedo([]);
    roomDragStart.current = null;
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
        ["quote","quotations"].includes(view) || settingsOpen || pdfImport || supplyLinking || deletingProject ||
        busy ||
        (event.target as HTMLElement | null)?.matches(
          'input:not([type="checkbox"]):not([type="range"]),textarea,[contenteditable="true"]',
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
        ((event.ctrlKey || event.metaKey) && ["z", "я"].includes(event.key.toLowerCase()))
      ) {
        event.preventDefault();
        undoRoomPoint(event.shiftKey);
      } else if ((event.ctrlKey || event.metaKey) && ["y", "н"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        undoRoomPoint(true);
      }
    }
    window.addEventListener("keydown", roomKeys);
    return () => window.removeEventListener("keydown", roomKeys);
  }, [roomMode, roomPoints, roomUndo, roomRedo, busy, project, page, editingRoomId, settingsOpen, pdfImport, supplyLinking, deletingProject, view]);
  function editRoomArea(room: Room) {
    setLeftPanelVisible(true);setLeftTool("rooms");
    setRoomUndo([]);
    setRoomRedo([]);
    setCalibrating(false);
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
    setLineRedo([]);
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
    const source = pageMap.get(id),
      scale = source?.scale ?? 1;
    return {
      x: 0.5 + (point.x - 0.5) * scale + (source?.offset_x ?? 0),
      y: 0.5 + (point.y - 0.5) * scale + (source?.offset_y ?? 0),
    };
  }
  function sourcePoint(point: Point, id: number) {
    const source = pageMap.get(id),
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
  const endpointIndex=useMemo(()=>new VertexIndex([
    ...(project?.elements.filter(item=>item.page_id===pageId&&displayedElement(item,layerMap,typeGroups,hiddenLayerGroups)).flatMap(item=>item.geometry?.points?.length?item.geometry.points:[{x:item.x,y:item.y}])??[]),
    ...(project?.rooms.filter(room=>room.page_id===pageId).flatMap(room=>room.polygon??[])??[]),
  ]),[project?.elements,project?.rooms,pageId,layerMap,typeGroups,hiddenLayerGroups]);
  function drawingCandidate(display:Point,shift=false,alt=false){
    if(!page)return display;
    const anchor=linePoints.at(-1),axis=shift||ortho;
    let point=sourcePoint(display,page.id);
    if(axis)point=orthogonal(point,anchor,page.width/page.height);
    const rect=sheetRef.current?.getBoundingClientRect();
    const snapped=objectSnap&&!alt&&rect?endpointIndex.nearest(point,8/(rect.width*(page.scale??1)),8/(rect.height*(page.scale??1)),target=>!axis||!anchor||target.x===anchor.x||target.y===anchor.y):null;
    setSnapTarget(snapped);return snapped??point;
  }
  function roomCandidate(point: Point, orthogonal = false, moving: number | null = null) {
    let candidate = sourcePoint(point, page!.id);
    const anchor = moving === null ? roomPoints.at(-1) : roomPoints[(moving - 1 + roomPoints.length) % roomPoints.length];
    const width = 850 * zoom * (page?.scale ?? 1), height = width * page!.height / page!.width;
    if (orthogonal && anchor) {
      candidate = Math.abs((candidate.x - anchor.x) * width) >= Math.abs((candidate.y - anchor.y) * height)
        ? { x: candidate.x, y: anchor.y } : { x: anchor.x, y: candidate.y };
    }
    if (roomSnap) {
      const vertices = [
        ...roomPoints.filter((_, index) => index !== moving && (moving !== null || index !== roomPoints.length - 1)),
        ...(project?.rooms.filter(room => room.page_id === page!.id && room.id !== editingRoomId)
          .flatMap(room => room.polygon ?? []) ?? []),
      ];
      const target = vertices.find(vertex => Math.hypot((vertex.x - candidate.x) * width, (vertex.y - candidate.y) * height) <= 8 &&
        (!orthogonal || !anchor || vertex.x === anchor.x || vertex.y === anchor.y));
      if (target) candidate = target;
    }
    return candidate;
  }
  function showObjectMenu(item: Item, event: React.MouseEvent<SVGGElement>) {
    event.preventDefault();
    event.stopPropagation();
    if(supplyLinking)return;
    if (!selectedIds.includes(item.id)) {
      setSelectedIds([item.id]);
      setFramePosts(1);
    }
    setSelected(item);
    setTypeEditorOpen(false);
    setObjectMenu({
      itemId: item.id,
      x: Math.min(event.clientX, window.innerWidth - 230),
      y: Math.max(8,Math.min(event.clientY, window.innerHeight - (isPowerSupply(types.find(type=>type.id===item.type_id)) ? 365 : isLedStrip(types.find(type=>type.id===item.type_id)) ? 310 : 260))),
    });
    setRoomMenu(null);
    setRoomPointMenu(null);
  }
  function choose(item: Item, additive: boolean) {
    const stored=selected&&project?.elements.find(current=>current.id===selected.id);
    if(selected&&stored&&selected.id!==item.id&&!sameItem(selected,stored))void run(()=>save({...selected}));
    setLeftPanelVisible(true);
    setLeftTool(current=>current==="frames"||current==="style"?current:"properties");
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
    setLineRedo([]);
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
    setLeftTool("frames");
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
    for(const [key,value] of Object.entries(selected.parameters))if(appearanceKeys.includes(key)||key.startsWith("custom:"))parameters[key]=value;
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
    if(nextKind.unit==="м"&&selected.parameters.manual_length!==undefined)parameters.manual_length=selected.parameters.manual_length;
    if (isPowerSupply(nextKind)) {
      if (isPowerSupply(currentKind)) {
        parameters.led_strip_ids = powerStripIds(selected.parameters);
        if (selected.parameters.power_watts) parameters.power_watts = selected.parameters.power_watts;
      } else {
        startSupplyLinking({...selected,type_id:typeId,product_id:null,parameters,geometry:{}},selected.id);
        return;
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
  const sceneContextMenu=useStableCallback((item:Item,event:React.MouseEvent<SVGGElement>)=>showObjectMenu(item,event));
  const sceneDoubleClick=useStableCallback((item:Item)=>{if(!supplyLinking)selectSameType(item);});
  const scenePointerDown=useStableCallback((item:Item,event:React.PointerEvent<SVGGElement>)=>{
    if(supplyLinking){if(isLedStrip(typeMap.get(item.type_id)))toggleSupplyStrip(item.id);return;}
    if(objectDoubleClick(item))return;
    choose(item,event.ctrlKey||event.metaKey);
    if(!item.geometry?.points?.length&&!event.ctrlKey&&!event.metaKey&&!layerMap.get(item.layer_id)?.locked&&!busy){
      event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
      drag.current={x:item.x,y:item.y};
    }
  });
  const sceneNodeDrag=useStableCallback((item:Item,index:number,point:Point,event:React.PointerEvent<SVGElement>)=>{
    if(busy)return;choose(item,false);event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);nodeDrag.current={index,point};
  });
  const previewPoints =
      (lineCursor && linePoints.length ? [...linePoints,lineCursor]:linePoints).map(point=>page?pagePoint(point,page.id):point),
    selectedKind = types.find((t) => t.id === selected?.type_id);
  const displayedPages=useMemo(()=>page&&project?[page,...project.pages.filter(item=>item.id!==page.id&&item.overlay_visible)]:[],[page,project?.pages]);
  const displayedPageIds=useMemo(()=>new Set(displayedPages.map(item=>item.id)),[displayedPages]);
  const visibleElements=useMemo(()=>elementsVisible?(project?.elements.filter(item=>displayedPageIds.has(item.page_id)&&item.id!==supplyLinking?.editId&&displayedElement(item,layerMap,typeGroups,hiddenLayerGroups))??[]):[],[project?.elements,elementsVisible,displayedPageIds,layerMap,supplyLinking?.editId,typeGroups,hiddenLayerGroups]);
  const legend=useMemo(()=>project&&elementsVisible?makeLegend({...project,elements:visibleElements},displayedPageIds,types):[],[project,visibleElements,displayedPageIds,types,elementsVisible]);
  const renderedElements=useMemo(()=>visibleElements.length<=500||!planWindow?visibleElements:visibleElements.filter(item=>{
    if(selectionSet.has(item.id))return true;
    const points=(item.geometry?.points?.length?item.geometry.points:[item]).map(point=>pagePoint(point,item.page_id));
    const x1=Math.min(...points.map(point=>point.x)),x2=Math.max(...points.map(point=>point.x)),y1=Math.min(...points.map(point=>point.y)),y2=Math.max(...points.map(point=>point.y));
    return x2>=planWindow.x1&&x1<=planWindow.x2&&y2>=planWindow.y1&&y1<=planWindow.y2;
  }),[visibleElements,planWindow,pageMap,selectionSet]);
  const denseLabels=adaptiveLabels&&(zoom<.8||renderedElements.length>500);
  const pageRooms=useMemo(()=>project?.rooms.filter(room=>room.page_id===pageId&&room.polygon&&room.polygon.length>=3)??[],[project?.rooms,pageId]);
  const protectedPageIds = useMemo(()=>new Set(
    project?.elements
      .filter((item) => {
        const itemType = typeMap.get(item.type_id);
        return (
          itemType &&
          ["Электроустановки", "Освещение", "LED-подсветка"].includes(
            itemType.category,
          )
        );
      })
      .map((item) => item.page_id) ?? [],
  ),[project?.elements,typeMap]);
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
  const frameVisuals=useMemo(()=>{
    const groups=new Map<string,Item[]>();
    for(const item of visibleElements){const group=String(item.parameters.frame_group??'');if(group){const list=groups.get(group)??[];list.push(item);groups.set(group,list);}}
    return [...groups].flatMap(([group,members])=>{
      const posts=Number(members[0]?.parameters.frame_posts??0);if(members.length!==posts)return [];
      const points=members.map(item=>pagePoint(item,item.page_id)),padding=20*symbolScale;
      const x1=Math.min(...points.map(item=>item.x*1000))-padding,x2=Math.max(...points.map(item=>item.x*1000))+padding;
      const y1=Math.min(...points.map(item=>item.y*1000))-padding,y2=Math.max(...points.map(item=>item.y*1000))+padding;
      return [{group,members,x:x1,y:y1,width:Math.max(40*symbolScale,x2-x1),height:Math.max(40*symbolScale,y2-y1),opacity:Math.min(...members.map(item=>pageMap.get(item.page_id)?.opacity??1))}];
    });
  },[visibleElements,pageMap,symbolScale]);
  return (
    <div className="app-shell" data-grid={showGrid} onDragEnterCapture={event=> {
      if(Array.from(event.dataTransfer.items).some(item=>item.type.startsWith('image/')))return;
      if((event.target as HTMLElement).closest("[data-image-dropzone],[data-image-target]")||!event.dataTransfer.types.includes("Files"))return;
      event.preventDefault();dragDepth.current++;setDraggingPdf(true);
    }} onDragOverCapture={event=> {
      if(Array.from(event.dataTransfer.items).some(item=>item.type.startsWith('image/'))){event.preventDefault();event.dataTransfer.dropEffect=(event.target as HTMLElement).closest('[data-image-dropzone],[data-image-target]')?'copy':'none';return;}
      if((event.target as HTMLElement).closest("[data-image-dropzone],[data-image-target]")||!event.dataTransfer.types.includes("Files"))return;
      event.preventDefault();event.dataTransfer.dropEffect=busy ? "none" : "copy";
    }} onDragLeaveCapture={event=> {
      if(!dragDepth.current)return;
      event.preventDefault();dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDraggingPdf(false);
    }} onDropCapture={event=> {
      if(Array.from(event.dataTransfer.items).some(item=>item.type.startsWith('image/'))){event.preventDefault();resetPdfDrag();if(!(event.target as HTMLElement).closest('[data-image-dropzone],[data-image-target]')){event.stopPropagation();requestPdfImport([...event.dataTransfer.files]);}return;}
      if((event.target as HTMLElement).closest("[data-image-dropzone],[data-image-target]")||!event.dataTransfer.types.includes("Files"))return;
      event.preventDefault();event.stopPropagation();resetPdfDrag();requestPdfImport([...event.dataTransfer.files]);
    }}>
      {draggingPdf && <div className="pdf-drop-overlay" role="status"><div><ToolIcon name="pdf"/><h2>Отпустите PDF здесь</h2><p>Создадим новый проект и предложим задать имя</p></div></div>}
      <input ref={pdfInput} hidden type="file" aria-label="PDF для нового проекта" accept=".pdf,application/pdf" disabled={busy} onChange={event=> {requestPdfImport([...event.target.files ?? []]);event.target.value="";}} />
      <header className="app-header">
        <div className="logo">SH</div>
        <div className="brand">
          <h1>Smart Home Calc</h1>
          <small>Проектирование комплектации · рабочая версия</small>
        </div>
        <nav className="app-tabs" aria-label="Разделы приложения">
          <button
            className={view === "plan" ? "active" : ""}
            onClick={() => changeView("plan")}
            disabled={busy || quoteBusy}
          >
            План
          </button>
          <button
            className={view === "report" ? "active" : ""}
            disabled={!project || busy || quoteBusy}
            onClick={() => changeView("report")}
          >
            Спецификация
          </button>
          <button className={view==="quote" ? "active" : ""} disabled={busy || quoteBusy} onClick={()=>changeView(project ? "quote" : "quotations")}>КП</button>
          <button className={view==="quotations" ? "active" : ""} disabled={busy || quoteBusy} onClick={()=>changeView("quotations")}>Все КП</button>
        </nav>
        <div className="header-actions">
        <button className="icon-button" disabled={busy || quoteBusy} onClick={()=>pdfInput.current?.click()} title="Создать новый проект из PDF"><ToolIcon name="pdf"/>Новый из PDF</button>
        <button disabled={busy || quoteBusy} onClick={() => openCatalog()}>Каталог и цены</button>
        <button className="icon-button settings-button" aria-label="Настройки" title="Настройки и папка данных" disabled={busy || quoteBusy} onClick={openSettings}><ToolIcon name="settings"/>Настройки</button>
        <label className="restore-project">
          Восстановить ZIP
          <input
            type="file"
            accept=".zip,application/zip"
            disabled={busy || quoteBusy}
            onChange={(e) => {
              if(!canLeaveQuote()){e.target.value="";return;}
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
        </div>
        <div className="project-controls">
        <SearchSelect
          aria-label="Проект"
          disabled={busy || quoteBusy}
          value={project?.id ?? ""}
          onChange={(e) => {
            if(!canLeaveQuote()){e.target.value=String(project?.id ?? "");return;}
            const id=+e.target.value;void run(async()=>{await saveDraftBeforeNavigation();await open(id);});
          }}
        >
          <option value="" disabled>
            Выберите проект
          </option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SearchSelect>
        <ToolButton icon="edit" aria-label="Переименовать проект" disabled={busy||quoteBusy||!project} onClick={()=>{if(!project)return;const name=prompt('Название проекта',project.name);if(name?.trim())void run(async()=>{await api(`/projects/${project.id}`,"PATCH",{name:name.trim()});setProjects(await api('/projects'));await refresh(project.id);});}}>Название</ToolButton>
        <button className="icon-button delete-project" disabled={busy || quoteBusy || !project} onClick={()=>{setDeleteProjectError("");setDeletingProject(project);}} title="Удалить выбранный проект"><ToolIcon name="trash"/>Удалить проект</button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if(!canLeaveQuote())return;
            void run(async () => {
              await saveDraftBeforeNavigation();
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
          <button disabled={busy || quoteBusy}>Создать</button>
        </form>
        </div>
      </header>
      {deletingProject && <AppModal title="Удалить проект?" onClose={()=>setDeletingProject(null)} busy={busy} className="delete-project-modal">
        <p className="delete-project-name">{deletingProject.name}</p>
        <p>Будут удалены все листы PDF, помещения, размещённые объекты, расчёты и КП этого проекта.</p>
        <p className="hint">Отменить удаление через Ctrl+Z нельзя. Общий каталог и другие проекты сохранятся.</p>
        <a href={`/api/projects/${deletingProject.id}/backup`} download>Скачать резервную копию проекта ZIP</a>
        {deleteProjectError && <p className="catalog-error" role="alert">{deleteProjectError}</p>}
        <div className="modal-actions"><button type="button" data-dialog-autofocus disabled={busy} onClick={()=>setDeletingProject(null)}>Отмена</button><button className="confirm-delete" disabled={busy} onClick={()=>{setDeleteProjectError("");void run(deleteCurrentProject);}}>{busy ? "Удаление…" : "Удалить навсегда"}</button></div>
      </AppModal>}
      {settingsOpen && <SettingsDialog onClose={()=>setSettingsOpen(false)} returnFocus={settingsTrigger.current} onBusyChange={setSettingsBusy} backupBlocked={unsavedWorkbench}/>}
      {pdfImport && <AppModal title="Новый проект из PDF" onClose={()=>setPdfImport(null)} busy={busy} className="pdf-import-modal">
        <div className="pdf-import-file"><ToolIcon name="pdf"/><div><strong>{pdfImport.file.name}</strong><small>{(pdfImport.file.size/(pdfImport.file.size<1024*1024 ? 1024 : 1024*1024)).toLocaleString("ru-RU",{maximumFractionDigits:1})} {pdfImport.file.size<1024*1024 ? "КБ" : "МБ"} · все страницы PDF</small></div></div>
        <form onSubmit={event=> {event.preventDefault();setPdfImportError("");void run(importPdfProject);}}>
          <label>Имя проекта<input data-dialog-autofocus aria-label="Имя нового проекта из PDF" required maxLength={200} disabled={busy} value={pdfImport.name} onChange={event=>setPdfImport({...pdfImport,name:event.target.value})} onFocus={event=>event.target.select()} /></label>
          <p className="hint">PDF будет загружен в новый проект. Каждый лист станет отдельной страницей плана.</p>
          {pdfImportError && <p className="catalog-error" role="alert">{pdfImportError}</p>}
          <div className="modal-actions"><button type="button" disabled={busy} onClick={()=>setPdfImport(null)}>Отмена</button><button className="primary" disabled={busy || !pdfImport.name.trim()}>{busy ? "Загрузка PDF…" : "Создать проект"}</button></div>
        </form>
      </AppModal>}
      {catalogOpen && (
        <CatalogManager
          catalog={catalog}
          onBusyChange={setCatalogBusy}
          onDirtyChange={setCatalogDirty}
          types={types}
          onClose={() => setCatalogOpen(false)}
          onChanged={async () => {
            const updatedTypes=await api<Kind[]>("/types?include_inactive=true");
            setTypes(updatedTypes);setCatalog(await api("/catalog"));
            if(!updatedTypes.find(item=>item.id===typeId)?.active) {
              setTypeId(updatedTypes.find(item=>item.active)?.id ?? null);setPlacing(false);setLinePoints([]);setLineRedo([]);setLineCursor(null);
            }
            if(project) {const updated=await refresh(project.id);setSelected(current=>current ? updated.elements.find(item=>item.id===current.id) ?? null : null);}
          }}
        />
      )}
      {error && (
        <div role="alert" className="error">
          {error}
          <button onClick={() => setError("")}>×</button>
        </div>
      )}
      {view==="quotations" ? <QuotationHub types={types} onDirtyChange={setQuoteDirty} onBusyChange={setQuoteBusy}
        onChanged={async()=>{setCatalog(await api("/catalog"));setTypes(await api<Kind[]>("/types?include_inactive=true"));}}
        onOpenProject={async(id)=>{await open(id);setView("quote");}}/> : !project ? (
        <main className="welcome">
          <div className="welcome-content">
            <div className="eyebrow">ОТ ПЛАНА К ВЕДОМОСТИ</div>
            <h2>
              Каждая деталь
              <br />
              на своём месте.
            </h2>
            <p>
              Перетащите PDF-план в окно и задайте имя проекта.
              Разместите оборудование — ведомость заполнится автоматически.
            </p>
            <button className="welcome-import icon-button" disabled={busy} onClick={()=>pdfInput.current?.click()}><ToolIcon name="pdf"/><span><strong>Перетащите PDF сюда</strong><small>или нажмите, чтобы выбрать файл · до 500 МБ и 100 страниц</small></span></button>
            <button className="welcome-quote" disabled={busy || quoteBusy} onClick={()=>changeView("quotations")}>КП без проекта — создать или открыть</button>
            <div className="steps">
              <span>01 / PDF-план</span>
              <span>02 / Элементы и слои</span>
              <span>03 / Ведомость</span>
            </div>
          </div>
        </main>
      ) : (
        <>
          {view === "quote" ? (
            <QuotationEditor key={project.id} projectId={project.id} projectName={project.name} rooms={project.rooms} types={types}
              onBrowse={()=>changeView("quotations")}
              onDirtyChange={setQuoteDirty} onBusyChange={setQuoteBusy} onChanged={async()=>{
                setCatalog(await api("/catalog"));
                setTypes(await api<Kind[]>("/types?include_inactive=true"));
                const updated=await refresh(project.id);
                setSelected(current=>current ? updated.elements.find(item=>item.id===current.id) ?? null : null);
              }}/>
          ) : view === "plan" ? (
            <main
              className={`workspace ${leftPanelVisible ? "" : "left-collapsed"} ${rightPanelVisible ? "" : "right-collapsed"}`}
              style={{gridTemplateColumns:[...(leftPanelVisible?[leftTool?"310px":"56px"]:[]),"minmax(0,1fr)",...(rightPanelVisible?[rightTool?"325px":"56px"]:[])].join(" ")}}
            >
              {leftPanelVisible && (
                <aside aria-label="Объекты и рамки" className={"objects-panel tool-panel "+(!leftTool?'tool-closed':'')} data-active-tool={leftTool??''} inert={Boolean(supplyLinking)}>
                  <ToolRail label="Инструменты объектов" active={leftTool} onSelect={selectLeftTool} items={[{id:'objects',label:'Объекты'},{id:'properties',label:'Свойства',icon:'edit'},{id:'style',label:'Оформление',icon:'palette'},{id:'frames',label:'Рамки',icon:'frame'},{id:'rooms',label:'Помещения',icon:'room'},{id:'catalog',label:'Каталог',icon:'catalog',command:()=>openCatalog()}]}/>
                  <div className="tool-panel-content">
<section data-tool-section="objects"><h3>Библиотека</h3>
                  <label>Группа<SearchSelect aria-label="Группа элементов" value={libraryGroup} onChange={event=> {
                    const group=event.target.value;
                    setLibraryGroup(group);
                    const items=availableTypes.filter(item=>!group || (item.group ?? item.category)===group);
                    if(!items.some(item=>item.id===typeId))setTypeId(items[0]?.id ?? null);
                    setPlacing(false);setCalibrating(false);setCalibrationStart(null);setLinePoints([]);setLineRedo([]);setLineCursor(null);
                  }}><option value="">Все группы</option>{groupKinds(availableTypes).map(group=><option key={group.label} value={group.label}>{group.label}</option>)}</SearchSelect></label>
                  <SearchSelect
                    aria-label="Тип элемента"
                    value={typeId ?? ""}
                    onChange={(e) => {
                      setTypeId(+e.target.value);
                      setLinePoints([]);
                      setLineRedo([]);
                      setLineCursor(null);
                    }}
                  >
                    <KindOptions types={libraryTypes} />
                  </SearchSelect>
                  <p className="hint">
                    {kind?.group ?? kind?.category} · {kind?.unit}
                    {kind?.unit === "м" && !page?.meters_per_point
                      ? " · нужен масштаб"
                      : ""}
                  </p>
                  <label>
                    Помещение
                    <SearchSelect
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
                    </SearchSelect>
                  </label>
                  <button
                    className="primary"
                    disabled={!page || !kind || layer?.locked || busy}
                    onClick={() => {
                      setPlacing(!placing);
                      setCalibrating(false);
                      setCalibrationStart(null);
                      setLinePoints([]);
                      setLineRedo([]);
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
                        setLineRedo([]);
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
                  </section><section data-tool-section="rooms"><h3>Помещения</h3><div className="room-drawing-tools">                    {page &&
                      (roomMode ? (
                        <>
                          <ToolButton icon="room"
                            className="active"
                            disabled={roomPoints.length < 3 || busy}
                            onClick={() => void run(finishRoom)}
                          >
                            Замкнуть область · Enter
                          </ToolButton>
                          <ToolButton icon="undo"
                            disabled={!roomUndo.length || busy}
                            onClick={() => undoRoomPoint()}
                          >
                            ↶ Отменить точку
                          </ToolButton>
                          <ToolButton icon="redo" disabled={!roomRedo.length || busy} onClick={() => undoRoomPoint(true)}>↷ Вернуть</ToolButton>
                          <label><input type="checkbox" checked={roomSnap} onChange={event => setRoomSnap(event.target.checked)} /> Привязка углов</label>
                          <ToolButton icon="room" onClick={cancelRoom}>Отмена · Esc</ToolButton>
                        </>
                      ) : (
                        <ToolButton icon="room"
                          onClick={() => {
                            setLeftTool("rooms");setRoomMode("new");
                            setRoomUndo([]);
                            setRoomRedo([]);
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
                        </ToolButton>
                      ))}
</div>{roomMode&&<><label>Название помещения<input aria-label="Название контура помещения" maxLength={200} value={roomName} onChange={event=>setRoomName(event.target.value)}/></label><label className="check"><input type="checkbox" checked={wet} onChange={event=>setWet(event.target.checked)}/>Влажная зона</label><p className="hint">Отмечайте углы на плане. Первая точка или Enter замыкает контур. Ctrl+Z отменяет точку.</p></>}{!roomMode&&<details open>
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
                  </details>}
                  </section><section data-tool-section="frames"><h3>Выбранные объекты</h3>
                  {selectedIds.length > 0 ? (
                    <div className="frame-editor">
                      <strong>Выбрано: {selectedIds.length}</strong>
                      <p className="hint">
                        Выделяйте рамкой мыши или Ctrl + щелчок. Для рамки число
                        объектов должно совпадать с числом постов.
                      </p>
                      <label>
                        Количество постов
                        <SearchSelect
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
                        </SearchSelect>
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
                  </section><section data-tool-section="properties"><h3>Свойства объекта</h3>
                  {selected && selectedIds.length === 1 ? (
                    <fieldset disabled={busy||project.layers.find(layer=>layer.id===selected.layer_id)?.locked} style={{border:0,padding:0}}>
                      <div className="object-title">
                        <button
                          type="button"
                          className="object-focus"
                          title="Показать объект на плане. Двойной щелчок — выбрать все объекты этой номенклатуры"
                          onClick={() => focusItem(selected)}
                          onDoubleClick={() => selectSameType(selected)}
                        >
                          {String(selected.parameters.display_name || selectedKind?.name || "")}
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
                          <SearchSelect
                            autoFocus
                            aria-label="Номенклатура объекта"
                            value={selected.type_id}
                            onChange={(e) => {
                              changeSelectedType(+e.target.value);
                              setTypeEditorOpen(false);
                            }}
                          >
                            {selectedKind?.active === false && <option value={selectedKind.id} disabled>{selectedKind.name} · удалена из библиотеки</option>}
                            <KindOptions types={types.filter(type=>type.active && type.unit===selectedKind?.unit)} />
                          </SearchSelect>
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
                        <SearchSelect
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
                        </SearchSelect>
                      </label>
                      <label>
                        Товар
                        <SearchSelect
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
                              (p) => p.type_id === selected.type_id && (p.active || p.id === selected.product_id),
                            )
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.manufacturer} · {p.name} · {p.price}{" "}
                                {p.currency}
                              </option>
                            ))}
                        </SearchSelect>
                      </label>
                      {isPowerSupply(selectedKind) && <div className="supply-linked-list">
                        <label>Питает LED-ленты</label>
                        <ul>{powerStripIds(selected.parameters).map(id=> {const strip=project.elements.find(item=>item.id===id);return <li key={id}>{strip ? stripLabel(strip) : `Лента №${id} не найдена`}</li>;})}</ul>
                        <button type="button" onClick={()=>startSupplyLinking({...selected},selected.id)}>Выбрать ленты на плане</button>
                      </div>}
                      {(isPowerSupply(selectedKind) || isLedStrip(selectedKind)) && <label>Мощность, Вт (необязательно)<input aria-label={isPowerSupply(selectedKind) ? "Мощность блока питания, Вт" : "Мощность ленты, Вт"} type="number" min="0.01" max="1000000" step="any" value={String(selected.parameters.power_watts ?? "")} onChange={event=> {
                        const parameters={...selected.parameters};if(event.target.value)parameters.power_watts=Number(event.target.value);else delete parameters.power_watts;setSelected({...selected,parameters});
                      }} /></label>}
                      {Object.entries(selected.parameters)
                        .filter(
                          ([key]) =>
                            ![
                              ...appearanceKeys,"manual_length","measured_length",
                              "frame_posts",
                              "frame_group",
                              "plan_icon",
                              "plan_color",
                              "led_strip_id", "led_strip_ids",
                              ...((isPowerSupply(selectedKind) || isLedStrip(selectedKind)) ? ["power_watts"] : []),
                            ].includes(key) && !key.startsWith("custom:"),
                        )
                        .map(([key, value]) => (
                          <label key={key}>
                            {labels[key] ?? (key.startsWith("custom:")?key.slice(7):key)}
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
                      <label>Название этой позиции<input aria-label="Своё название объекта" maxLength={200} value={String(selected.parameters.display_name??'')} placeholder={selectedKind?.name} onChange={event=>setSelected({...selected,parameters:{...selected.parameters,display_name:event.target.value}})}/></label>
                      {selectedKind?.unit==='м'&&Boolean(selected.geometry?.points?.length)&&<div className="manual-properties">
                        <label className="check"><input aria-label="Ручной метраж" type="checkbox" checked={selected.parameters.manual_length!==undefined} onChange={event=>{const parameters={...selected.parameters};if(event.target.checked)parameters.manual_length=Number(parameters.length)||1;else delete parameters.manual_length;setSelected({...selected,parameters});}}/>Указать метраж вручную</label>
                        {selected.parameters.manual_length!==undefined&&<><label>Длина для расчёта, м<input aria-label="Ручная длина, м" type="number" min=".001" max="1000000" step=".001" value={String(selected.parameters.manual_length)} onChange={event=>setSelected({...selected,parameters:{...selected.parameters,manual_length:Number(event.target.value)||.001}})}/></label><small>По геометрии: {String(selected.parameters.measured_length??selected.parameters.length)} м. Калибровка сохраняет ручное значение.</small></>}
                      </div>}
                      <CoordinateEditor key={selected.id} item={selected} page={project.pages.find(p=>p.id===selected.page_id)!} onChange={change=>setSelected({...selected,...change})}/>
                      <CustomFieldsEditor value={selected.parameters} onChange={parameters=>setSelected({...selected,parameters})}/>
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
                    </fieldset>
                  ) : selectedIds.length > 1 ? (
                    <p className="hint">
                      Для нескольких объектов доступны рамки, оформление и
                      удаление.
                    </p>
                  ) : (
                    <p className="hint">
                      Выберите объект на плане, чтобы изменить параметры.
                    </p>
                  )}
                </section><section data-tool-section="style"><h3>Оформление на плане</h3>
                  {selected&&selectedIds.length===1 ? <fieldset disabled={busy||project.layers.find(layer=>layer.id===selected.layer_id)?.locked} style={{border:0,padding:0}}><AppearanceEditor kind={selectedKind} value={selected.parameters} onChange={parameters=>setSelected({...selected,parameters})} color={selectedKind?.color??'#38bdf8'} power={isPowerSupply(selectedKind)} line={selectedKind?.unit==='м'} electrical={isElectrical(selectedKind)} allowName={false}/><p className="autosave-note">Изменения сохраняются автоматически</p></fieldset> : selectedIds.length>1 ? <>
                    <p>Выбрано объектов: {selectedIds.length}. Применятся только изменённые настройки.</p><AppearanceEditor partial value={batchStyle} onChange={setBatchStyle} color="#38bdf8" line allowName={false}/>
                    <div className="appearance-actions"><ToolButton icon="save" disabled={busy||!Object.keys(batchStyle).length} onClick={()=>void run(async()=>{await api(`/projects/${project.id}/elements/appearance`,"PATCH",{element_ids:selectedIds,changes:batchStyle});setBatchStyle({});const updated=await refresh(project.id);setSelected(current=>current?updated.elements.find(item=>item.id===current.id)??null:null);})}>Применить к выбранным</ToolButton>
                    <ToolButton icon="refresh" disabled={busy} onClick={()=>void run(async()=>{await api(`/projects/${project.id}/elements/appearance`,"PATCH",{element_ids:selectedIds,changes:Object.fromEntries(appearanceKeys.filter(key=>key!=='display_name').map(key=>[key,null]))});setBatchStyle({});const updated=await refresh(project.id);setSelected(current=>current?updated.elements.find(item=>item.id===current.id)??null:null);})}>Сбросить оформление выбранных</ToolButton></div></> : <p className="hint">Выберите объект на плане или несколько объектов с Ctrl.</p>}
</section></div></aside>
              )}
              <section className="plan-area">
                {supplyLinking && <div className="supply-link-toolbar" role="region" aria-label="Привязка LED-лент">
                  <div><strong>{supplyLinking.editId ? "Изменение привязки блока питания" : "Блок размещён — выберите LED-ленты на плане"}</strong><small>Щёлкайте по лентам: повторный щелчок снимает выбор. Выбрано: {supplyLinking.stripIds.length}</small></div>
                  <button className="primary" disabled={busy || !supplyLinking.stripIds.length} onClick={()=>void run(finishSupplyLinking)}>Готово · Enter</button>
                  <button disabled={busy} onClick={cancelSupplyLinking}>Отмена · Esc</button>
                  <span>{project.elements.some(item=>isLedStrip(types.find(type=>type.id===item.type_id))) ? "Ctrl+Z — отменить выбор · можно выбрать несколько лент и переключать листы" : "В проекте ещё нет LED-лент. Отмените привязку, разместите ленты и повторите."}</span>
                </div>}
                <div className="toolbar" style={{display:supplyLinking ? "none" : undefined}}>
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
                <button
                  className={
                    "label-toggle " + (labelsVisible ? "" : "inactive")
                  }
                  aria-pressed={labelsVisible}
                  onClick={() => setLabelsVisible((value) => !value)}
                >
                  {labelsVisible ? denseLabels?"Подписи: авто":"Скрыть надписи" : "Показать надписи"}
                </button>
                    {page && <button aria-pressed={showRoomContours} onClick={() => setShowRoomContours(value => !value)}>Контуры помещений</button>}
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
                    <ToolButton icon="undo" aria-label="Отменить действие на плане" title="Отменить · Ctrl+Z" disabled={busy||!project.history?.undo&&!(selected&&elementMap.get(selected.id)&&!sameItem(selected,elementMap.get(selected.id)!))} onClick={()=>void run(()=>undoLast())}/>
                    <ToolButton icon="redo" aria-label="Повторить действие на плане" title="Повторить · Ctrl+Shift+Z" disabled={busy||!project.history?.redo} onClick={()=>void run(()=>undoLast(true))}/>
                    <button aria-label="Уменьшить план" title="Уменьшить · Ctrl+колесо" disabled={zoom<=.1} onClick={() => zoomAt(zoom / 1.25)}>
                      −
                    </button>
                    <span className="zoom-percentage" aria-label="Масштаб плана">{Math.round(zoom * 100)}%</span>
                    <button aria-label="Увеличить план" title="Увеличить · Ctrl+колесо" disabled={zoom>=16} onClick={() => zoomAt(zoom * 1.25)}>＋</button>
                    <button title="Масштаб 100%" onClick={() => zoomAt(1)}>Сброс</button>
                    <ToolButton icon="fit" aria-label="Вписать план" title="Вписать лист · Ctrl+0" onClick={fitPlan}/>
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
                          setLineRedo([]);
                          setLineCursor(null);
                        }}
                      >
                        {calibrating
                          ? calibrationStart
                            ? "Укажите вторую точку"
                            : "Укажите первую точку"
                          : "Масштаб, мм"}
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

                  </div>
                </div>

                {legend.length>0&&<PlanLegend entries={legend}/>}
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
                          { x: page!.width, y: page!.height },
                        );
                        changeRoomPoints([
                          ...roomPoints.slice(0, index),
                          roomPointMenu.point,
                          ...roomPoints.slice(index),
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
                        changeRoomPoints(roomPoints.filter((_, itemIndex) => itemIndex !== index));
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
                        {(isPowerSupply(types.find(type=>type.id===item.type_id)) || isLedStrip(types.find(type=>type.id===item.type_id))) && <button className="power-watts-action" disabled={busy || project.layers.find(layer=>layer.id===item.layer_id)?.locked} onClick={()=>editPowerWatts(item)}>Укажите мощность W</button>}
                        {isPowerSupply(types.find(type=>type.id===item.type_id)) && <button disabled={busy || project.layers.find(layer=>layer.id===item.layer_id)?.locked} onClick={()=>startSupplyLinking({...(selected?.id===item.id ? selected : item)},item.id)}>Привязать LED-ленты</button>}
                        <button
                          onClick={() => {
                            setSelectedIds([item.id]);
                            setSelected(item);
                            setLeftPanelVisible(true);setLeftTool("properties");
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
                        tabIndex={0}
                        aria-label="План проекта"
                        onPointerDownCapture={event => event.currentTarget.focus({preventScroll:true})}
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
                          if(supplyLinking)return;
                          const pos = position(e);
                          setRoomMenu(null);
                          setRoomPointMenu(null);
                          setObjectMenu(null);
                          if (roomMode && !busy) {
                            const candidate = roomCandidate(pos, e.shiftKey||ortho),
                              first =
                                roomPoints[0] &&
                                pagePoint(roomPoints[0], page.id);
                            if (
                              roomMode === "new" && roomPoints.length >= 3 && first &&
                              Math.hypot((pos.x - first.x) * 850 * zoom,
                                (pos.y - first.y) * 850 * zoom * page.height / page.width) <= 9
                            ) {
                              void run(finishRoom);
                              return;
                            }
                            if (roomMode === "edit") {
                              const index = nearestSegmentInsertion(candidate, roomPoints, { x: page.width, y: page.height });
                              changeRoomPoints([...roomPoints.slice(0, index), candidate, ...roomPoints.slice(index)]);
                            } else if (!roomPoints.some(point => point.x === candidate.x && point.y === candidate.y)) {
                              changeRoomPoints([...roomPoints, candidate]);
                            }
                            setRoomCursor(candidate);
                            return;
                          }
                          if (calibrating && !busy) {
                            if (!calibrationStart) {
                              setCalibrationStart(sourcePoint(pos,page.id));
                              return;
                            }
                            const raw = prompt(
                              "Реальное расстояние между точками, мм (например, 5000)",
                            );
                            if (raw === null) return;
                            const real = Number(
                              raw.trim().replace(/\s/g, "").replace(",", "."),
                            );
                            if (!Number.isFinite(real) || real <= 0) {
                              setError("Введите положительную длину в миллиметрах");
                              return;
                            }
                            void run(async () => {
                              const stored =
                                selected && project.elements.find((item) => item.id === selected.id);
                              if (selected && stored && !sameItem(selected, stored))
                                await save(selected);
                              await api(`/pages/${page.id}/calibrate`, "POST", {
                                x1: calibrationStart.x,
                                y1: calibrationStart.y,
                                x2: sourcePoint(pos,page.id).x,
                                y2: sourcePoint(pos,page.id).y,
                                real_length_mm: real,
                              });
                              setCalibrating(false);
                              setCalibrationStart(null);
                              const updated = await refresh(project.id);
                              setSelected((current) =>
                                current
                                  ? (updated.elements.find((item) => item.id === current.id) ?? null)
                                  : null,
                              );
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
                              const candidate=drawingCandidate(pos,e.shiftKey,e.altKey);
                              setLinePoints([...linePoints,candidate]);
                              setLineRedo([]);
                              setLineCursor(candidate);
                              return;
                            }
                            const candidate=drawingCandidate(pos,false,e.altKey);
                            if (isPowerSupply(kind)) {
                              startSupplyLinking({page_id:page.id,layer_id:layer.id,type_id:kind.id,product_id:null,room_id:roomId,x:candidate.x,y:candidate.y,geometry:{},parameters:kind.defaults,comment:""});
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
                                  x: candidate.x,
                                  y: candidate.y,
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
                            additive: e.ctrlKey||e.metaKey,
                          });
                          if (!e.ctrlKey&&!e.metaKey) {
                            setSelected(null);
                            setSelectedIds([]);
                          }
                          e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                          const pos = position(e);
                          planStatus.current?.update(sourcePoint(pos,page!.id));
                          if(calibrating&&calibrationStart)setLineCursor(sourcePoint(pos,page!.id));
                          if (roomMode)
                            setRoomCursor(roomCandidate(pos, e.shiftKey||ortho));
                          if (roomNodeDrag.current !== null) {
                            const index = roomNodeDrag.current;
                            setRoomPoints((points) =>
                              points.map((point, itemIndex) =>
                                itemIndex === index
                                  ? roomCandidate(pos, e.shiftKey||ortho, index)
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
                            setLineCursor(drawingCandidate(pos,e.shiftKey,e.altKey));
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
                          setRoomCursor(null);setSnapTarget(null);planStatus.current?.update(null);
                        }}
                        onPointerUp={() => {
                          if (roomNodeDrag.current !== null) {
                            const start = roomDragStart.current;
                            if (start && JSON.stringify(start) !== JSON.stringify(roomPoints)) {
                              setRoomUndo(history => [...history, start]);
                              setRoomRedo([]);
                            }
                            roomDragStart.current = null;
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
                              inside = visibleElements.filter(item=>selectionHits((item.geometry?.points?.length?item.geometry.points:[item]).map(point=>pagePoint(point,item.page_id)),{x1,y1,x2,y2},selectionBox.current.x<selectionBox.start.x))
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
                          if (roomDragStart.current) setRoomPoints(roomDragStart.current);
                          roomDragStart.current = null;
                          setSelectionBox(null);
                          setLineCursor(null);
                          setRoomCursor(null);setSnapTarget(null);planStatus.current?.update(null);
                        }}
                      >
                        {(showRoomContours || roomMode) && pageRooms.filter(room => room.id !== editingRoomId).map(room => (
                          <g className="saved-room-contour" key={room.id} data-room-id={room.id}>
                            <polygon points={room.polygon!.map(point => {
                              const display = pagePoint(point, room.page_id!);
                              return `${display.x * 1000},${display.y * 1000}`;
                            }).join(" ")} />
                            <text x={pagePoint(room.polygon![0], room.page_id!).x * 1000 + 7}
                              y={pagePoint(room.polygon![0], room.page_id!).y * 1000 - 8}>{room.name}</text>
                          </g>
                        ))}
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
                            {roomCursor && roomMode === "new" &&
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
                            {roomMode === "edit" && roomPoints.map((point, index) => {
                              const next = roomPoints[(index + 1) % roomPoints.length];
                              const midpoint = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
                              const display = pagePoint(midpoint, page.id);
                              const width = 850 * zoom, height = width * page.height / page.width;
                              return <ellipse className="room-edge-handle" key={`edge-${index}`} aria-label={`Добавить вершину на ребре ${index + 1}`}
                                cx={display.x * 1000} cy={display.y * 1000} rx={5 * 1000 / width} ry={5 * 1000 / height}
                                onPointerDown={event => {
                                  if (event.button !== 0 || busy) return;
                                  event.preventDefault(); event.stopPropagation();
                                  const insertion = index + 1;
                                  changeRoomPoints([...roomPoints.slice(0, insertion), midpoint, ...roomPoints.slice(insertion)]);
                                  // Insertion has its own undo entry; dragging it continues the same edit.
                                  roomNodeDrag.current = insertion;
                                  roomDragStart.current = null;
                                  event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
                                }} />;
                            })}
                            {roomPoints.map((point, index) => {
                              const display = pagePoint(point, page.id),
                                radius = 7 * 1000 / (850 * zoom),
                                radiusY = radius * page.width / page.height;
                              return (
                                <g key={index}>
                                  <ellipse
                                    aria-label={`Вершина ${index + 1}`}
                                    className={
                                      index === 0 ? "room-close-node room-vertex" : "room-vertex"
                                    }
                                    cx={display.x * 1000}
                                    cy={display.y * 1000}
                                    rx={radius}
                                    ry={radiusY}
                                    onPointerDown={(e) => {
                                      if (e.button !== 0 || busy) return;
                                      e.preventDefault();
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
                                      roomDragStart.current = roomPoints;
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
                              · вершин: {roomPoints.length} · Shift — по оси · Enter — сохранить
                              {roomMode === "edit" ? " · точки на рёбрах — добавить вершину" : " · точка 1 — замкнуть"}
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
                        {supplyLinking && displayedPageIds.has(Number(supplyLinking.body.page_id)) && (()=> {
                          const point=pagePoint({x:Number(supplyLinking.body.x),y:Number(supplyLinking.body.y)},Number(supplyLinking.body.page_id));
                          return <g className="power-supply-preview" transform={`translate(${point.x*1000},${point.y*1000})`} pointerEvents="none"><PointMarker scale={symbolScale} color="#dc2626" selected={true} icon="" powerSupply={true}/><text x={29*symbolScale} y="5" fontSize="14" fill="#b91c1c" stroke="white" strokeWidth="3" paintOrder="stroke">Блок питания · выберите ленты</text></g>;
                        })()}
                        <g className="plan-elements" style={{ pointerEvents: roomMode||calibrating||placing&&kind?.unit==='м'&&!supplyLinking ? "none" : undefined }}>
                        <PlanScene elements={renderedElements} types={typeMap} pages={pageMap} layers={layerMap}
                          selection={selectionSet} draft={selected} scale={symbolScale} labels={labelsVisible} dense={denseLabels} adaptive={adaptiveLabels} pixelScale={850*zoom/1000} grip={8*1000/(850*zoom)}
                          linking={Boolean(supplyLinking)} picked={linkedStripSet} busy={busy} aspect={page.width/page.height}
                          onContextMenu={sceneContextMenu} onDoubleClick={sceneDoubleClick} onPointerDown={scenePointerDown} onNodeDrag={sceneNodeDrag}/>

                        </g>
                        {selectionBox && (
                          <rect
                            className={"selection-box"+(selectionBox.current.x<selectionBox.start.x?" selection-box-crossing":"")}
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
                              ? linePoints.map(point=>pagePoint(point,page.id)).map((point, index) => (
                                  <path
                                    key={index}
                                    d={`M ${-12 * symbolScale} ${-8 * symbolScale} L ${12 * symbolScale} 0 L ${-12 * symbolScale} ${8 * symbolScale} Z`}
                                    transform={`translate(${point.x * 1000} ${point.y * 1000}) rotate(${pointAngle(previewPoints, index)})`}
                                    fill="#16a085"
                                  />
                                ))
                              : linePoints.map(point=>pagePoint(point,page.id)).map((point, index) => (
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
                        {snapTarget&&<rect className="snap-indicator" x={pagePoint(snapTarget,page.id).x*1000-6*1000/(850*zoom)} y={pagePoint(snapTarget,page.id).y*1000-6*1000/(850*zoom)*page.width/page.height} width={12*1000/(850*zoom)} height={12*1000/(850*zoom)*page.width/page.height}/>}
                        {calibrating&&calibrationStart&&lineCursor&&<line className="calibration-guide" x1={pagePoint(calibrationStart,page.id).x*1000} y1={pagePoint(calibrationStart,page.id).y*1000} x2={pagePoint(lineCursor,page.id).x*1000} y2={pagePoint(lineCursor,page.id).y*1000}/>}
                        {calibrationStart && (
                          <circle
                            cx={pagePoint(calibrationStart,page.id).x*1000}
                            cy={pagePoint(calibrationStart,page.id).y*1000}
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
                <PlanStatusBar ref={planStatus} page={page} mode={roomMode?'Помещение':calibrating?'Масштаб':supplyLinking?'Привязка лент':placing?(kind?.unit==='м'?'Линия':'Размещение'):'Выбор'}
                  hint={roomMode?'Щелчок — вершина · Shift — по оси · Enter — завершить':calibrating?'Укажите две точки известного расстояния':supplyLinking?'Укажите ленты, затем подтвердите привязку':placing?(kind?.unit==='м'?'Щелчок — узел · Enter — завершить · Ctrl+Z — назад · Esc — отмена':'Щелчок — разместить · Esc — выбор'):'Средняя кнопка — панорама · Ctrl+колесо — масштаб · Ctrl — добавить к выделению'}
                  count={visibleElements.length} selected={selectedIds.length} snap={roomMode?roomSnap:objectSnap} ortho={ortho} onSnap={()=>roomMode?setRoomSnap(value=>!value):setObjectSnap(value=>!value)} onOrtho={()=>setOrtho(value=>!value)}
                  length={page&&linePoints.length?measuredLength(lineCursor?[...linePoints,lineCursor]:linePoints,page):null}/>
              </section>
              {rightPanelVisible && (
                <aside className={"right layers-panel tool-panel "+(!rightTool?'tool-closed':'')} aria-label="Слои и страницы" data-active-tool={rightTool??''}><div className="tool-panel-content"><section data-tool-section="layers"><h3 className="element-layers-heading">
                    <button type="button" aria-expanded={elementLayersExpanded} aria-controls="element-layers-list" onClick={()=>setElementLayersExpanded(expanded=>!expanded)} title={elementLayersExpanded ? "Свернуть список слоёв" : "Развернуть список слоёв"}>
                      <span>Слои элементов</span>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                    </button>
                  </h3>
                  <div id="element-layers-list" hidden={!elementLayersExpanded}>
                  <LayerTree layers={project.layers} groups={layerGroupEntries} active={layerId} busy={busy} savingGroups={savingGroups}
                    onSelect={setLayerId} onGroups={changeLayerGroups} onGroupToggle={(layer,key,visible)=>{const next=new Set(groupDrafts.current.get(layer.id)??layer.hidden_groups??[]);if(visible)next.delete(key);else next.add(key);changeLayerGroups(layer,[...next]);}} onToggle={(layer,field)=>void run(()=>patch(layer,field))}
                    onRename={layer=>{const name=prompt('Название слоя',layer.name);if(name?.trim())void run(async()=>{await api(`/layers/${layer.id}`,'PATCH',{name:name.trim()});await refresh(project.id);});}}/>
                  <p className="hint">
                    Видимость · блокировка · включение в ведомость
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
                  </div>
                  </section><section data-tool-section="pages"><div className="page-file-tools">                    <label className="upload">
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
                    </label>                    {page && (
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
</div>
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
                          onClick={()=>void run(async()=>{await saveDraftBeforeNavigation();
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
                            setLineRedo([]);
                            setLineCursor(null);
                            setCalibrationStart(null);
                          })}
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
                                    errorMessage(error,"Ошибка"),
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
                </section></div><ToolRail label="Инструменты слоёв и страниц" side="right" active={rightTool} onSelect={selectRightTool} items={[{id:'layers',label:'Слои',icon:'layers'},{id:'pages',label:'Страницы PDF',icon:'pages'},{id:'settings',label:'Настройки',icon:'settings',command:openSettings}]}/></aside>
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
                                          `${labels[key] ?? (key.startsWith("custom:")?key.slice(7):key)}: ${value}`,
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
        <span>SMART HOME CALC / 1.0.52</span>
        <span>
          {busy ? "Сохранение…" : "Офлайн-режим · данные на этом компьютере"}
        </span>
      </footer>
    </div>
  );
}
