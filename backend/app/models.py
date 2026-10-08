from datetime import datetime, timezone
from sqlalchemy import String, ForeignKey, JSON, Float, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base

class User(Base):
    __tablename__ = 'users'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))

class Project(Base):
    __tablename__ = 'projects'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class Page(Base):
    __tablename__ = 'pages'
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey('projects.id'))
    number: Mapped[int]
    name: Mapped[str | None] = mapped_column(String(200))
    width: Mapped[float] = mapped_column(Float)
    height: Mapped[float] = mapped_column(Float)
    source_index: Mapped[int] = mapped_column(default=0)
    meters_per_point: Mapped[float | None] = mapped_column(Float)
    pdf_path: Mapped[str]
    image_path: Mapped[str]

class Room(Base):
    __tablename__ = 'rooms'
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey('projects.id'))
    name: Mapped[str] = mapped_column(String(200))
    wet: Mapped[bool] = mapped_column(Boolean, default=False)

class Layer(Base):
    __tablename__ = 'layers'
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey('projects.id'))
    name: Mapped[str] = mapped_column(String(200))
    visible: Mapped[bool] = mapped_column(Boolean, default=True)
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    export: Mapped[bool] = mapped_column(Boolean, default=True)

class ElementType(Base):
    __tablename__ = 'element_types'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str]
    unit: Mapped[str] = mapped_column(default='шт')
    color: Mapped[str] = mapped_column(default='#38bdf8')
    defaults: Mapped[dict] = mapped_column(JSON, default=dict)
    wet_min_ip: Mapped[int | None]

class Element(Base):
    __tablename__ = 'elements'
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey('projects.id'))
    page_id: Mapped[int] = mapped_column(ForeignKey('pages.id'))
    layer_id: Mapped[int] = mapped_column(ForeignKey('layers.id'))
    type_id: Mapped[int] = mapped_column(ForeignKey('element_types.id'))
    product_id: Mapped[int | None] = mapped_column(ForeignKey('products.id'))
    room_id: Mapped[int | None] = mapped_column(ForeignKey('rooms.id'))
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    parameters: Mapped[dict] = mapped_column(JSON, default=dict)
    geometry: Mapped[dict] = mapped_column(JSON, default=dict)
    comment: Mapped[str] = mapped_column(default='')

class Manufacturer(Base):
    __tablename__ = 'manufacturers'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]

class Supplier(Base):
    __tablename__ = 'suppliers'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    contact: Mapped[str] = mapped_column(default='')

class Product(Base):
    __tablename__ = 'products'
    id: Mapped[int] = mapped_column(primary_key=True)
    manufacturer_id: Mapped[int] = mapped_column(ForeignKey('manufacturers.id'))
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey('suppliers.id'))
    type_id: Mapped[int] = mapped_column(ForeignKey('element_types.id'))
    name: Mapped[str]
    sku: Mapped[str] = mapped_column(default='')
    unit: Mapped[str] = mapped_column(default='шт')
    price: Mapped[float] = mapped_column(Float, default=0)
    currency: Mapped[str] = mapped_column(default='RUB')
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    parameters: Mapped[dict] = mapped_column(JSON, default=dict)

class Report(Base):
    __tablename__ = 'reports'
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey('projects.id'))
    format: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
