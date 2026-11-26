"""Project-owned display preferences and the last page edited on the plan."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool
from sqlalchemy import select

from .models import Element, Page


class ViewSettings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    savedAt: int | None = Field(default=None, ge=0, le=9_007_199_254_740_991)
    symbolScale: float | None = Field(default=None, ge=.1, le=2, allow_inf_nan=False)
    labelsVisible: StrictBool | None = None
    roomLabelsVisible: StrictBool | None = None
    showRoomContours: StrictBool | None = None
    elementsVisible: StrictBool | None = None
    objectSnap: StrictBool | None = None
    ortho: StrictBool | None = None
    adaptiveLabels: StrictBool | None = None
    showGrid: StrictBool | None = None
    roomSnap: StrictBool | None = None
    elementLayersExpanded: StrictBool | None = None
    highlightUnframed: StrictBool | None = None
    leftExpanded: StrictBool | None = None
    rightExpanded: StrictBool | None = None
    leftTool: Literal['objects', 'list', 'properties', 'style', 'frames', 'rooms'] | None = None
    rightTool: Literal['layers', 'pages'] | None = None


def last_worked_page(db, project):
    if project.last_worked_page_id is not None and db.scalar(select(Page.id).where(
        Page.id == project.last_worked_page_id, Page.project_id == project.id,
    )) is not None:
        return project.last_worked_page_id
    # Older versions did not record edits. Their newest placed object is the
    # best available indication of a working page; viewing a sheet is irrelevant.
    return db.scalar(select(Element.page_id).join(Page, Element.page_id == Page.id).where(
        Element.project_id == project.id, Page.project_id == project.id,
    ).order_by(Element.id.desc()).limit(1))
