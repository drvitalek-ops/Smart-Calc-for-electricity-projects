"""add page overlay controls

Revision ID: 004
Revises: 003
"""
from alembic import op
import sqlalchemy as sa

revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('pages', sa.Column('overlay_visible', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('pages', sa.Column('opacity', sa.Float(), nullable=False, server_default='1'))
    op.add_column('pages', sa.Column('offset_x', sa.Float(), nullable=False, server_default='0'))
    op.add_column('pages', sa.Column('offset_y', sa.Float(), nullable=False, server_default='0'))
    op.add_column('pages', sa.Column('scale', sa.Float(), nullable=False, server_default='1'))


def downgrade():
    for column in ('scale','offset_y','offset_x','opacity','overlay_visible'):
        op.drop_column('pages', column)
