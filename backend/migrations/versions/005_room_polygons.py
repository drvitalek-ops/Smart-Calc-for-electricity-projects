"""add polygonal room areas

Revision ID: 005
Revises: 004
"""
from alembic import op
import sqlalchemy as sa

revision = '005'
down_revision = '004'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('rooms', sa.Column('page_id', sa.Integer(), nullable=True))
    op.add_column('rooms', sa.Column('polygon', sa.JSON(), nullable=True))
    op.create_foreign_key('fk_rooms_page_id_pages', 'rooms', 'pages', ['page_id'], ['id'])


def downgrade():
    op.drop_constraint('fk_rooms_page_id_pages', 'rooms', type_='foreignkey')
    op.drop_column('rooms', 'polygon')
    op.drop_column('rooms', 'page_id')
