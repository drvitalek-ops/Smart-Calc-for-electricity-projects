export const quotationColors = [
  {
    "key": "accent",
    "label": "Акцент",
    "color": "#00b83b"
  },
  {
    "key": "page",
    "label": "Фон страницы",
    "color": "#ffffff"
  },
  {
    "key": "text",
    "label": "Основной текст",
    "color": "#0e1418"
  },
  {
    "key": "muted",
    "label": "Второстепенный текст",
    "color": "#7a8796"
  },
  {
    "key": "border",
    "label": "Разделители",
    "color": "#d6dee6"
  },
  {
    "key": "header",
    "label": "Фон шапки",
    "color": "#0e1418"
  },
  {
    "key": "header_text",
    "label": "Название компании в шапке",
    "color": "#ffffff"
  },
  {
    "key": "slogan",
    "label": "Слоган",
    "color": "#b3babf"
  },
  {
    "key": "header_city",
    "label": "Город в шапке",
    "color": "#b3c4ba"
  },
  {
    "key": "header_contact",
    "label": "Телефон и почта",
    "color": "#00b83b"
  },
  {
    "key": "header_website",
    "label": "Сайт в шапке",
    "color": "#ffffff"
  },
  {
    "key": "title",
    "label": "Заголовок предложения",
    "color": "#0e1418"
  },
  {
    "key": "card",
    "label": "Фон информационной карточки",
    "color": "#ffffff"
  },
  {
    "key": "card_label",
    "label": "Подписи карточки",
    "color": "#00b83b"
  },
  {
    "key": "card_value",
    "label": "Значения карточки",
    "color": "#0e1418"
  },
  {
    "key": "customer",
    "label": "Получатель",
    "color": "#0e1418"
  },
  {
    "key": "total",
    "label": "Фон итоговой суммы",
    "color": "#0e1418"
  },
  {
    "key": "total_label",
    "label": "Подпись итоговой суммы",
    "color": "#b3babf"
  },
  {
    "key": "total_amount",
    "label": "Итоговая сумма",
    "color": "#00b83b"
  },
  {
    "key": "total_tax",
    "label": "Примечание к сумме",
    "color": "#7a8796"
  },
  {
    "key": "table_header",
    "label": "Фон заголовка таблицы",
    "color": "#f2f5f7"
  },
  {
    "key": "table_header_text",
    "label": "Текст заголовка таблицы",
    "color": "#7a8796"
  },
  {
    "key": "table_row",
    "label": "Фон строк таблицы",
    "color": "#ffffff"
  },
  {
    "key": "table_alternate",
    "label": "Фон чётных строк",
    "color": "#ffffff"
  },
  {
    "key": "table_name",
    "label": "Наименование товара",
    "color": "#0e1418"
  },
  {
    "key": "table_price",
    "label": "Цена",
    "color": "#7a8796"
  },
  {
    "key": "table_quantity",
    "label": "Количество",
    "color": "#0e1418"
  },
  {
    "key": "table_unit",
    "label": "Единица измерения",
    "color": "#7a8796"
  },
  {
    "key": "table_amount",
    "label": "Сумма позиции",
    "color": "#00b83b"
  },
  {
    "key": "group",
    "label": "Фон группы помещений",
    "color": "#edf7f2"
  },
  {
    "key": "group_text",
    "label": "Название помещения",
    "color": "#0e1418"
  },
  {
    "key": "benefit_background",
    "label": "Фон значков преимуществ",
    "color": "#f0fcf2"
  },
  {
    "key": "benefit_border",
    "label": "Контур значков преимуществ",
    "color": "#b8e6c4"
  },
  {
    "key": "benefit_icon",
    "label": "Значки преимуществ",
    "color": "#00b83b"
  },
  {
    "key": "benefit_title",
    "label": "Заголовки преимуществ",
    "color": "#0e1418"
  },
  {
    "key": "benefit_text",
    "label": "Текст преимуществ",
    "color": "#7a8796"
  },
  {
    "key": "footer_title",
    "label": "Компания в подвале",
    "color": "#0e1418"
  },
  {
    "key": "footer_text",
    "label": "Контакты в подвале",
    "color": "#7a8796"
  }
] as const;
export type QuoteStyle={font?:"Golos"|"DejaVuSans"|"DejaVuSerif";table_scale?:number;colors?:Record<string,string>};
